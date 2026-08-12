/**
 * Cliente HTTP da fonte organizacional — transporte PRÓPRIO (`RNF-04`).
 *
 * ⚠️ Não reaproveita `atlassian/http.ts`. Outro host, outro esquema de auth (Bearer), outra
 * credencial. "Economizar" ali transformaria um bug de roteamento comum em vazamento de
 * credencial, que é exatamente o raciocínio já registrado para `atlassian/organizacao.ts`.
 *
 * ## Uma chamada, não a árvore inteira — e isto é decisão
 *
 * `GET /employees/refs?unpaged=true` devolve a base inteira numa requisição, e cada pessoa
 * já vem com `contactEmail` e `teams: ["RPA"]`. É o **time folha** da pessoa.
 *
 * 🚨 **O godocs deriva outra coisa** — o "nó-área canônico", subindo a árvore de `/teams`
 * até um filho de domínio, com sete nomes de líder embutidos no código para achar as raízes
 * e os nós passthrough. **Não copiei, e o motivo não é preguiça:**
 *
 * - aqui a área é **guardada, nunca enviada** (`FR-7`), e não precisa casar com vocabulário
 *   nenhum — o campo `Setor Gocase` do Jira sequer está publicado num formulário;
 * - aquela derivação embute **nomes de sete pessoas** no repositório, que mudam quando
 *   alguém sai, e a falha seria silenciosa (raiz não encontrada → área errada para todos);
 * - custaria uma segunda chamada e a lógica de árvore inteira, para um dado de apoio.
 *
 * **Caminho de saída, se um dia a área precisar casar com um vocabulário fixo:** é aqui que
 * a árvore entra, e `godocs-main/src/lib/areas/teamguide.server.ts` já tem a regra pronta.
 *
 * ## Cache por isolate, com TTL obrigatório
 *
 * Mesmo lugar e mesmo raciocínio de `cachesAtlassianDoIsolate`: sem cache, cada chamado
 * aberto custaria uma ida de rede (`RNF-36`); sem TTL, um isolate quente serviria o retrato
 * velho da organização para sempre. Compartilhar entre pessoas é seguro **porque o dado é o
 * mesmo para todas** — é a base da empresa, e a resolução por e-mail acontece depois, em
 * memória.
 *
 * ⚠️ **Aqui a cache guarda a PROMESSA, não o valor** — ao contrário das três de
 * `novasCachesAtlassian`, que guardam valor. É o que dá dedupe de leitura em voo, e é
 * também a única coisa neste arquivo que atravessa o limite de uma requisição. A fase
 * `promessa` de `D-40` existe para essa hipótese aparecer no registro em vez de ser
 * suposta.
 *
 * ## Diagnóstico: quem responde "foi o nosso timeout?" é o SINAL, não o nome do erro
 *
 * 🚨 A classificação antiga perguntava `e.name === 'AbortError'` — e ela **não é confiável
 * para o caso que mais importa**: abortar uma resposta cujo corpo já começou a chegar
 * derruba a conexão no meio da leitura, e o que sobe daí não é `AbortError`, é o erro
 * genérico de rede do runtime. Um timeout nosso apareceria como `erro_de_rede`, ou seja,
 * a hipótese mais provável seria a única que o registro nunca acusaria. Quem sabe a
 * resposta é `controle.signal.aborted`: se o nosso relógio disparou, foi timeout — não
 * importa a classe que o runtime escolheu lançar.
 *
 * _Requirements: RF-19, RNF-01, RNF-04, RNF-13, RNF-18, RNF-30, RNF-36, RF-59_
 */

import type {
  ClienteTeamGuide,
  FalhaTeamGuide,
  FaseTeamGuide,
  ResultadoArea,
} from './contrato'
import { rotuloDaFalha } from './contrato'

const BASE = 'https://api.teamguide.app'
/** A base muda devagar; 10 min é o mesmo TTL que o godocs usa, pelo mesmo motivo. */
const TTL_MS = 10 * 60 * 1000
const TIMEOUT_MS = 8000
/** Teto de cada pedaço de `classe`. Ver `rotular` — é o que a torna rótulo por construção. */
const TETO_ROTULO = 24

interface PessoaTeamGuide {
  readonly contactEmail?: string | null
  readonly teams?: readonly string[] | null
}

export interface OpcoesTeamGuide {
  readonly token: string
  readonly fetchImpl?: typeof fetch
  readonly agoraMs?: () => number
  /** Cache compartilhada do isolate. Omitir cria uma própria — é o que os testes querem. */
  readonly cache?: CacheDaBase
}

/** O retrato da base, com o instante em que foi tirado. */
export interface CacheDaBase {
  em: number
  promessa: Promise<ReadonlyMap<string, string>> | null
}

export function novaCacheTeamGuide(): CacheDaBase {
  return { em: 0, promessa: null }
}

export class ClienteTeamGuideHttp implements ClienteTeamGuide {
  private readonly cache: CacheDaBase
  private readonly agora: () => number
  private readonly fetchImpl: typeof fetch

  constructor(private readonly opcoes: OpcoesTeamGuide) {
    this.cache = opcoes.cache ?? novaCacheTeamGuide()
    this.agora = opcoes.agoraMs ?? (() => Date.now())
    this.fetchImpl = opcoes.fetchImpl ?? fetch
  }

  async areaDe(email: string): Promise<ResultadoArea> {
    const alvo = (email ?? '').trim().toLowerCase()
    if (!alvo) return { estado: 'nao_encontrada' }

    let base: ReadonlyMap<string, string>
    try {
      base = await this.baseCacheada()
    } catch (e) {
      // ⚠️ A mensagem NUNCA carrega o corpo da resposta nem o texto do erro (`RNF-01`,
      // `RNF-30`): os dois podem conter nome e e-mail de gente da empresa, e isto sobe
      // até a auditoria. O que sai daqui são rótulos — ver `falhaDe`.
      return { estado: 'indisponivel', ...falhaDe(e) }
    }

    const area = base.get(alvo)
    return area ? { estado: 'encontrada', area } : { estado: 'nao_encontrada' }
  }

  /**
   * `RF-59` — a mesma leitura da base, pelo mesmo caminho e com a mesma cache.
   *
   * ⚠️ De propósito **não** é uma requisição própria "só para a sonda": uma sonda que
   * exercita outro caminho responde sobre o caminho que ninguém usa. Sondar aqui é
   * gratuito quando a base está cacheada e, quando não está, mede exatamente o que a
   * abertura de chamado mediria.
   */
  async verificarSaude(): Promise<{ ok: boolean; detalhe: string }> {
    try {
      await this.baseCacheada()
      return { ok: true, detalhe: 'ok' }
    } catch (e) {
      return { ok: false, detalhe: rotuloDaFalha(falhaDe(e)) }
    }
  }

  private baseCacheada(): Promise<ReadonlyMap<string, string>> {
    const vencida = this.agora() - this.cache.em > TTL_MS
    if (!this.cache.promessa || vencida) {
      this.cache.em = this.agora()
      // ⚠️ Só o SUCESSO fica cacheado. Uma falha memoizada condenaria o isolate a
      // responder `indisponivel` até morrer — mesmo erro que `garantirMigracao` evita.
      this.cache.promessa = this.carregarBase().catch((e) => {
        this.cache.promessa = null
        this.cache.em = 0
        throw e
      })
    }
    return this.cache.promessa
  }

  private async carregarBase(): Promise<ReadonlyMap<string, string>> {
    const controle = new AbortController()
    const timer = setTimeout(() => controle.abort(), TIMEOUT_MS)
    try {
      let r: Response
      try {
        r = await this.fetchImpl(`${BASE}/employees/refs?unpaged=true&page=0`, {
          headers: { Authorization: `Bearer ${this.opcoes.token}`, Accept: 'application/json' },
          signal: controle.signal,
        })
      } catch (e) {
        throw doRuntime(e, 'conexao', controle.signal.aborted)
      }

      // `http_<status>` se explica sozinho: sem `fase`, sem `classe`.
      if (!r.ok) throw new ErroTeamGuide({ motivo: `http_${r.status}` })

      let bruto: unknown
      try {
        bruto = await r.json()
      } catch (e) {
        // 🚨 A separação que `D-40` compra: aqui os cabeçalhos JÁ chegaram. Falhar neste
        // ponto é a resposta se desfazendo no meio — grande demais, lenta demais ou
        // truncada —, e não "não alcancei o host".
        throw doRuntime(e, 'corpo', controle.signal.aborted)
      }

      if (!Array.isArray(bruto)) throw new ErroTeamGuide({ motivo: 'formato_inesperado' })
      return indexarPorEmail(bruto as PessoaTeamGuide[])
    } finally {
      clearTimeout(timer)
    }
  }
}

/** E-mail (minúsculo) → time folha. Função pura: **não lança**, para não virar `promessa`. */
function indexarPorEmail(pessoas: readonly PessoaTeamGuide[]): ReadonlyMap<string, string> {
  const porEmail = new Map<string, string>()
  for (const p of pessoas) {
    const email = (p?.contactEmail ?? '').trim().toLowerCase()
    if (!email || porEmail.has(email)) continue
    // Pessoa em mais de um time: o primeiro, e a ordem é a que a API devolveu. É
    // arbitrário e está registrado como tal — inventar um critério ("o mais
    // específico") seria uma regra que ninguém pediu e que ninguém consegue conferir.
    const time = (p?.teams ?? []).map((t) => (t ?? '').trim()).find((t) => t.length > 0)
    if (time) porEmail.set(email, time)
  }
  return porEmail
}

/**
 * Falha já rotulada, viajando como exceção.
 *
 * ⚠️ Substitui o teste `/^[a-z0-9_]+$/` sobre `e.message` que existia antes. Aquele
 * caminho tinha o defeito de **promover mensagem de terceiro a rótulo** sempre que ela
 * fosse uma palavra minúscula — o oposto do que `RNF-30` pede. Com o tipo, rótulo é o que
 * nós escrevemos, e o resto é genérico por construção.
 */
class ErroTeamGuide extends Error {
  constructor(readonly falha: FalhaTeamGuide) {
    super(falha.motivo)
    this.name = 'ErroTeamGuide'
  }
}

function doRuntime(e: unknown, fase: FaseTeamGuide, abortado: boolean): ErroTeamGuide {
  return new ErroTeamGuide({
    // 🚨 O SINAL decide, não `e.name`. Ver o cabeçalho do arquivo.
    motivo: abortado ? 'timeout' : 'erro_de_rede',
    fase,
    classe: classeDe(e),
  })
}

function falhaDe(e: unknown): FalhaTeamGuide {
  if (e instanceof ErroTeamGuide) return e.falha
  // 🚨 Não passou por `carregarBase` — logo não veio da chamada desta requisição. O
  // caminho que resta é a promessa cacheada de **outra**, que é a hipótese que a fase
  // `promessa` existe para nomear (ver `FaseTeamGuide`).
  return { motivo: 'erro_de_rede', fase: 'promessa', classe: classeDe(e) }
}

/**
 * O **nome** do erro, nunca a mensagem — `RNF-01`, `RNF-30`.
 *
 * Junta construtor, `name` e `cause.code` porque cada um responde uma coisa diferente e
 * nenhum responde sozinho: `DOMException`+`AbortError` é aborto, `TypeError`+`ECONNRESET`
 * é conexão derrubada, `SyntaxError` num corpo é JSON truncado.
 *
 * ⚠️ O saneamento e o teto **não** são zelo decorativo: `name` e `code` também são valores
 * vindos de fora, e é o charset mais o corte que fazem "isto é rótulo, não frase" ser
 * garantia estrutural em vez de promessa.
 */
function classeDe(e: unknown): string {
  const alvo = e as { name?: unknown; constructor?: { name?: unknown }; cause?: { code?: unknown } }
  const partes = [rotular(alvo?.constructor?.name), rotular(alvo?.name), rotular(alvo?.cause?.code)]
  return partes.filter((p, i) => p.length > 0 && partes.indexOf(p) === i).join('_') || 'desconhecida'
}

function rotular(bruto: unknown): string {
  if (typeof bruto !== 'string') return ''
  return bruto
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, TETO_ROTULO)
}
