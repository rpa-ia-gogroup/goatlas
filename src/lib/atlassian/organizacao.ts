/**
 * Organizations API — a credencial que dá medo (RNF-04).
 *
 * `ATLASSIAN_ORG_API_KEY` é **Org Admin**: enxerga a organização inteira, em vez de
 * um site só. Por isso este módulo é separado do cliente de Jira/Confluence
 * (`atlassian/cliente.ts`) desde a raiz — **transporte próprio**, não a mesma
 * instância. Um bug de roteamento aqui não pode fazer uma chamada de usuário comum
 * sair com esta credencial (RNF-22 aplicado a uma segunda camada isolada).
 *
 * A autenticação também é diferente: Bearer contra `api.atlassian.com/admin`, não
 * Basic contra `*.atlassian.net` — mais um motivo para não reaproveitar
 * `atlassian/http.ts`, que assume e-mail + API token.
 *
 * ⚠️ `listarUsuarios` e `ultimoAcesso` (T-122/T-123) e `revogarProduto` (T-131) são
 * bloqueadas por **Q1**: a credencial de Org Admin ainda não existe. O que este
 * arquivo entrega agora é o contrato (`ClienteOrganizacao`) e o transporte — a
 * infraestrutura que aqueles métodos vão usar quando a credencial chegar. Escrever
 * a chamada real contra um endpoint que ninguém pode testar hoje seria código não
 * verificável; o fake (`organizacao-fake.ts`) é o que permite construir e testar o
 * console inteiro antes disso.
 */

import { ErroAtlassian } from './tipos'

/** RF-52 — as limitações oficiais do dado. Vão NA TELA, não em rodapé de documento:
 * sem elas, alguém rebaixa o acesso de quem só estava de férias. */
export const LIMITACOES_ULTIMO_ACESSO = Object.freeze({
  atrasoMaximoHoras: 24,
  criterioAtivo:
    'Considerado "ativo" quem visualizou uma página do produto por ao menos 2 segundos.',
})

export interface ProdutoAtribuido {
  /** Chave do produto — ex.: `jira-servicedesk`, `confluence`. */
  readonly chave: string
  readonly nome: string
}

export interface UsuarioOrganizacao {
  readonly accountId: string
  readonly email: string
  readonly nome: string
  readonly produtos: readonly ProdutoAtribuido[]
}

export interface UltimoAcessoProduto {
  readonly produto: string
  /** `null` = nunca visto pela API, não "erro de leitura". */
  readonly ultimoAcessoEm: string | null
}

export interface UltimoAcesso {
  readonly accountId: string
  readonly porProduto: readonly UltimoAcessoProduto[]
  /** Quando ESTE app coletou o dado — a Organizations API é lenta demais para
   * consulta interativa (ver `inventario_assentos`, T-124). */
  readonly coletadoEm: string
}

/** Erro de domínio da camada. Mesma regra de `ErroAtlassian`: nunca expõe corpo
 * cru de resposta HTTP (RNF-01, RNF-30). Reaproveita a classe em vez de duplicá-la
 * — o formato do erro é o mesmo, só a origem muda. */
export const ErroOrganizacao = ErroAtlassian

export interface ClienteOrganizacao {
  /** `GET /admin/v1/orgs/{orgId}/users` (RF-51). **Bloqueado por Q1** (T-122). */
  listarUsuarios(orgId: string): Promise<readonly UsuarioOrganizacao[]>

  /** `GET /admin/v1/orgs/{orgId}/directory/users/{accountId}/last-active-dates`
   * (RF-52). **Bloqueado por Q1** (T-123). */
  ultimoAcesso(orgId: string, accountId: string): Promise<UltimoAcesso>

  /** RF-57 (P2) — a ÚNICA escrita desta credencial, com dupla confirmação e
   * auditoria acima desta camada. **Bloqueado por Q1** (T-131). */
  revogarProduto(orgId: string, accountId: string, produto: string): Promise<void>
}

export interface OpcoesTransporteOrganizacao {
  readonly baseUrl: string
  readonly apiKey: string
  /** Injetável para o teste não dormir de verdade. */
  readonly dormir?: (ms: number) => Promise<void>
  readonly fetchImpl?: typeof fetch
  readonly aleatorio?: () => number
  readonly maxTentativas?: number
}

const BASE_BACKOFF_MS = 2000
const TETO_BACKOFF_MS = 30_000
const MAX_TENTATIVAS_PADRAO = 4

/**
 * Transporte HTTP próprio da Organizations API.
 *
 * Backoff exponencial com jitter, igual a `atlassian/http.ts` (RNF-14) — a Atlassian
 * não anuncia orçamento por API token, então o único controle é cache + backoff +
 * medição empírica de 429. Duplicar essa lógica aqui é o preço de manter as duas
 * credenciais em transportes que nunca se cruzam; um `import` do transporte do
 * Jira/Confluence reabriria exatamente o risco que RNF-04 pede para fechar.
 */
export class TransporteOrganizacao {
  private readonly dormir: (ms: number) => Promise<void>
  private readonly fetchImpl: typeof fetch
  private readonly aleatorio: () => number
  private readonly maxTentativas: number

  constructor(private readonly opcoes: OpcoesTransporteOrganizacao) {
    this.dormir = opcoes.dormir ?? ((ms) => new Promise((r) => setTimeout(r, ms)))
    this.fetchImpl = opcoes.fetchImpl ?? fetch
    this.aleatorio = opcoes.aleatorio ?? Math.random
    this.maxTentativas = opcoes.maxTentativas ?? MAX_TENTATIVAS_PADRAO
  }

  calcularEspera(tentativa: number, retryAfterSeg: number | null): number {
    if (retryAfterSeg !== null && retryAfterSeg > 0) return retryAfterSeg * 1000
    const exponencial = Math.min(BASE_BACKOFF_MS * 2 ** (tentativa - 1), TETO_BACKOFF_MS)
    const jitter = exponencial * 0.25 * this.aleatorio()
    return Math.round(exponencial - exponencial * 0.125 + jitter)
  }

  async requisitar(
    caminho: string,
    init: { method?: string; body?: string } = {},
  ): Promise<unknown> {
    let ultimoErro: InstanceType<typeof ErroAtlassian> | null = null

    for (let tentativa = 1; tentativa <= this.maxTentativas; tentativa += 1) {
      const resposta = await this.fetchImpl(`${this.opcoes.baseUrl}${caminho}`, {
        method: init.method ?? 'GET',
        headers: {
          // Bearer, não Basic: é OUTRA credencial, com OUTRO esquema (RNF-04).
          Authorization: `Bearer ${this.opcoes.apiKey}`,
          Accept: 'application/json',
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(init.body === undefined ? {} : { body: init.body }),
      })

      if (resposta.ok) {
        const texto = await resposta.text()
        return texto.length > 0 ? (JSON.parse(texto) as unknown) : null
      }

      const transitorio = resposta.status === 429 || resposta.status >= 500
      // ⚠️ Nunca inclui o corpo da resposta na mensagem (RNF-01, RNF-30).
      ultimoErro = new ErroAtlassian(`Organizations API respondeu ${resposta.status}`, {
        status: resposta.status,
        transitorio,
        recurso: caminho,
      })

      if (!transitorio || tentativa === this.maxTentativas) throw ultimoErro

      const retryAfter = Number(resposta.headers.get('Retry-After'))
      await this.dormir(
        this.calcularEspera(tentativa, Number.isFinite(retryAfter) ? retryAfter : null),
      )
    }

    throw (
      ultimoErro ??
      new ErroAtlassian('falha desconhecida', { transitorio: true, recurso: caminho })
    )
  }
}
