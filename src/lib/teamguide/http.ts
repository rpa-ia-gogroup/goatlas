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
 * velho da organização para sempre, e quem mudou de time nunca apareceria. Compartilhar
 * entre pessoas é seguro **porque o dado é o mesmo para todas** — é a base da empresa, e a
 * resolução por e-mail acontece depois, em memória.
 *
 * _Requirements: RF-19, RNF-04, RNF-13, RNF-18, RNF-36_
 */

import type { ClienteTeamGuide, ResultadoArea } from './contrato'

const BASE = 'https://api.teamguide.app'
/** A base muda devagar; 10 min é o mesmo TTL que o godocs usa, pelo mesmo motivo. */
const TTL_MS = 10 * 60 * 1000
const TIMEOUT_MS = 8000

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
      // ⚠️ A mensagem NUNCA carrega o corpo da resposta (`RNF-01`, `RNF-30`): ele pode
      // conter nome e e-mail de gente da empresa, e este texto sobe até a auditoria.
      return { estado: 'indisponivel', motivo: motivoDe(e) }
    }

    const area = base.get(alvo)
    return area ? { estado: 'encontrada', area } : { estado: 'nao_encontrada' }
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
      const r = await this.fetchImpl(`${BASE}/employees/refs?unpaged=true&page=0`, {
        headers: { Authorization: `Bearer ${this.opcoes.token}`, Accept: 'application/json' },
        signal: controle.signal,
      })
      if (!r.ok) throw new Error(`http_${r.status}`)
      const bruto = (await r.json()) as unknown
      if (!Array.isArray(bruto)) throw new Error('formato_inesperado')

      const porEmail = new Map<string, string>()
      for (const p of bruto as PessoaTeamGuide[]) {
        const email = (p?.contactEmail ?? '').trim().toLowerCase()
        if (!email || porEmail.has(email)) continue
        // Pessoa em mais de um time: o primeiro, e a ordem é a que a API devolveu. É
        // arbitrário e está registrado como tal — inventar um critério ("o mais
        // específico") seria uma regra que ninguém pediu e que ninguém consegue conferir.
        const time = (p?.teams ?? []).map((t) => (t ?? '').trim()).find((t) => t.length > 0)
        if (time) porEmail.set(email, time)
      }
      return porEmail
    } finally {
      clearTimeout(timer)
    }
  }
}

/** Motivo curto e sem dado de pessoa — é o que vai para a auditoria. */
function motivoDe(e: unknown): string {
  if (e instanceof Error) {
    if (e.name === 'AbortError') return 'timeout'
    // `http_401`, `formato_inesperado`, … já são rótulos; qualquer outra coisa vira genérico
    // em vez de vazar texto de terceiro.
    return /^[a-z0-9_]+$/.test(e.message) ? e.message : 'erro_de_rede'
  }
  return 'erro_de_rede'
}
