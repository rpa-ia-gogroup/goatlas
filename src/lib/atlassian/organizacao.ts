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
 * ⚠️ **A implementação real (`ClienteOrganizacaoHttp`, T-122/T-123/T-131) existe e é
 * testada contra `fetch` simulado, mas nunca falou com a Atlassian de verdade** — a
 * credencial de Org Admin é **Q1** e ainda não foi emitida. O que os testes provam é
 * o que este arquivo controla: caminho montado, paginação seguida, formato de
 * resposta traduzido, erro sem corpo cru, backoff no 429. O que eles **não** provam é
 * o contrato do outro lado. `ENDPOINTS_NAO_VERIFICADOS` abaixo lista o que precisa de
 * uma passada com credencial real antes de valer em produção.
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
  /** `GET /admin/v1/orgs/{orgId}/users` (RF-51, T-122). */
  listarUsuarios(orgId: string): Promise<readonly UsuarioOrganizacao[]>

  /** `GET /admin/v1/orgs/{orgId}/directory/users/{accountId}/last-active-dates`
   * (RF-52, T-123). */
  ultimoAcesso(orgId: string, accountId: string): Promise<UltimoAcesso>

  /** RF-57 (P2, T-131) — a ÚNICA escrita desta credencial. A dupla confirmação e a
   * auditoria ficam ACIMA desta camada (rota de admin): a camada isolada não decide
   * política, só transporta. */
  revogarProduto(orgId: string, accountId: string, produto: string): Promise<void>
}

/**
 * O que ainda precisa de uma passada com credencial real (Q1) antes de virar produção.
 *
 * Está em código, e não só em documento, porque a tela de governança **mostra** esta
 * lista quando a credencial é de teste: um console que promete revogar assento e falha
 * no clique é pior que um console que avisa antes. O `/api/health` também expõe.
 */
export const ENDPOINTS_NAO_VERIFICADOS = Object.freeze([
  Object.freeze({
    metodo: 'GET',
    caminho: '/admin/v1/orgs/{orgId}/users',
    risco: 'Nome dos campos e forma da paginação (`links.next`) seguem a documentação, não uma resposta observada.',
  }),
  Object.freeze({
    metodo: 'GET',
    caminho: '/admin/v1/orgs/{orgId}/directory/users/{accountId}/last-active-dates',
    risco: 'Formato de `product_access[].last_active` (data ISO vs. epoch) não confirmado.',
  }),
  Object.freeze({
    metodo: 'DELETE',
    caminho: '/admin/v1/orgs/{orgId}/directory/users/{accountId}/manage/product-access',
    risco:
      'A revogação POR PRODUTO é a menos verificável das três: a documentação pública descreve a remoção de acesso do usuário, e não está confirmado que o filtro por produto é aceito no corpo. Enquanto isso, a rota de admin trata erro como recusa e NUNCA reporta sucesso otimista.',
  }),
])

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
    // ⚠️ **`fetch` PRECISA vir com `this` amarrado ao global.** Guardado numa propriedade e
    // chamado como `this.fetchImpl(...)`, o `this` passa a ser este objeto, e o runtime dos
    // Workers recusa com `Illegal invocation` — a chamada nem sai. No Node dos testes
    // funciona, porque lá o `fetch` não confere o `this`: por isso 643 testes verdes
    // conviviam com um cliente que não conseguia fazer uma única requisição em produção.
    // Descoberto em 07/08/2026, no instante em que o modo demonstração saiu.
    this.fetchImpl = opcoes.fetchImpl ?? fetch.bind(globalThis)
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

/** Base oficial da Organizations API — outro host, não o `*.atlassian.net` do site. */
export const BASE_ORGANIZACAO = 'https://api.atlassian.com'

/**
 * Teto de páginas seguidas na listagem de usuários.
 *
 * A organização inteira pode ter milhares de contas, e o Worker tem tempo de CPU
 * limitado por requisição. O teto não é preferência: sem ele, uma paginação que a
 * Atlassian mude (ou um `links.next` que aponte para si mesmo) vira laço infinito
 * dentro do cron. Estourar o teto é registrado como coleta **parcial** — nunca
 * silenciado, porque inventário incompleto vira recomendação de rebaixar quem a
 * página seguinte mostraria ativo.
 */
export const MAX_PAGINAS_USUARIOS = 40
const TAMANHO_PAGINA = 100

interface ProdutoBruto {
  key?: unknown
  name?: unknown
  last_active?: unknown
}

interface UsuarioBruto {
  account_id?: unknown
  email?: unknown
  name?: unknown
  account_status?: unknown
  product_access?: unknown
}

const texto = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null)

/**
 * `last_active` da Atlassian chega como data ISO em alguns endpoints e como epoch em
 * outros — e a diferença entre `1754400000` interpretado como milissegundos e como
 * segundos é 55 anos, que é a diferença entre "ocioso" e "acessou ontem". Na dúvida,
 * `null`: **não** ter o dado é honesto e a tela já sabe mostrar "sem informação"
 * (RF-52); ter o dado errado rebaixa o assento de quem estava trabalhando.
 */
export function normalizarCarimbo(bruto: unknown): string | null {
  if (typeof bruto === 'string' && bruto.length > 0) {
    const ms = Date.parse(bruto)
    return Number.isFinite(ms) ? new Date(ms).toISOString() : null
  }
  if (typeof bruto === 'number' && Number.isFinite(bruto) && bruto > 0) {
    // Heurística explícita: epoch em segundos passa de 1e11 só no ano 5138.
    const ms = bruto < 1e11 ? bruto * 1000 : bruto
    return new Date(ms).toISOString()
  }
  return null
}

function produtosDe(bruto: unknown): ProdutoAtribuido[] {
  if (!Array.isArray(bruto)) return []
  const saida: ProdutoAtribuido[] = []
  for (const item of bruto as ProdutoBruto[]) {
    const chave = texto(item?.key)
    if (!chave) continue
    saida.push({ chave, nome: texto(item?.name) ?? chave })
  }
  return saida
}

/**
 * Implementação real (T-122, T-123, T-131).
 *
 * Duas decisões que não são estilo:
 *
 * 1. **Conta sem produto atribuído continua na lista.** Ela não consome licença
 *    (achado da seção 1.1 dos requisitos), e omiti-la faria o console parecer que a
 *    organização é menor do que é. O cálculo de custo já ignora quem não tem produto.
 * 2. **Campo faltando não vira string vazia.** `accountId` ausente descarta a linha:
 *    uma conta sem id é uma linha de inventário que não dá para recomendar nada
 *    sobre, e `''` no lugar dele agruparia contas distintas na mesma chave.
 */
export class ClienteOrganizacaoHttp implements ClienteOrganizacao {
  private readonly transporte: TransporteOrganizacao

  constructor(opcoes: Omit<OpcoesTransporteOrganizacao, 'baseUrl'> & { baseUrl?: string }) {
    this.transporte = new TransporteOrganizacao({
      ...opcoes,
      baseUrl: opcoes.baseUrl ?? BASE_ORGANIZACAO,
    })
  }

  async listarUsuarios(orgId: string): Promise<readonly UsuarioOrganizacao[]> {
    const saida: UsuarioOrganizacao[] = []
    let caminho: string | null =
      `/admin/v1/orgs/${encodeURIComponent(orgId)}/users?limit=${TAMANHO_PAGINA}`

    for (let pagina = 0; pagina < MAX_PAGINAS_USUARIOS && caminho !== null; pagina += 1) {
      const dados = (await this.transporte.requisitar(caminho)) as {
        data?: unknown
        links?: { next?: unknown }
      } | null

      for (const bruto of Array.isArray(dados?.data) ? (dados!.data as UsuarioBruto[]) : []) {
        const accountId = texto(bruto?.account_id)
        if (!accountId) continue
        // Conta desativada não consome assento e não é alvo de recomendação.
        if (texto(bruto?.account_status) === 'inactive') continue
        saida.push({
          accountId,
          email: texto(bruto?.email) ?? '',
          nome: texto(bruto?.name) ?? texto(bruto?.email) ?? accountId,
          produtos: produtosDe(bruto?.product_access),
        })
      }

      caminho = proximaPagina(dados?.links?.next)
    }

    return saida
  }

  async ultimoAcesso(orgId: string, accountId: string): Promise<UltimoAcesso> {
    const dados = (await this.transporte.requisitar(
      `/admin/v1/orgs/${encodeURIComponent(orgId)}/directory/users/${encodeURIComponent(
        accountId,
      )}/last-active-dates`,
    )) as { data?: { product_access?: unknown } } | null

    const bruto = Array.isArray(dados?.data?.product_access)
      ? (dados!.data!.product_access as ProdutoBruto[])
      : []
    const porProduto: UltimoAcessoProduto[] = []
    for (const item of bruto) {
      const produto = texto(item?.key)
      if (!produto) continue
      porProduto.push({ produto, ultimoAcessoEm: normalizarCarimbo(item?.last_active) })
    }
    return { accountId, porProduto, coletadoEm: new Date().toISOString() }
  }

  /**
   * RF-57 (P2) — a única escrita.
   *
   * ⚠️ Ver `ENDPOINTS_NAO_VERIFICADOS`: é a chamada de contrato menos confirmado das
   * três. Ela **não** engole erro: um `catch` aqui devolveria "revogado" para a tela
   * enquanto o assento segue ativo, e o admin marcaria a economia como capturada.
   */
  async revogarProduto(orgId: string, accountId: string, produto: string): Promise<void> {
    await this.transporte.requisitar(
      `/admin/v1/orgs/${encodeURIComponent(orgId)}/directory/users/${encodeURIComponent(
        accountId,
      )}/manage/product-access`,
      { method: 'DELETE', body: JSON.stringify({ productKey: produto }) },
    )
  }
}

/**
 * Extrai o caminho da próxima página.
 *
 * A Atlassian devolve `links.next` como URL **absoluta**; o transporte concatena com
 * a base. Repassar a URL absoluta produziria `https://api.atlassian.com https://…`.
 * E um `next` que aponte para outro host é descartado: seguir cegamente um link de
 * resposta mandaria a credencial de Org Admin para onde a resposta pedisse.
 */
function proximaPagina(bruto: unknown): string | null {
  const url = texto(bruto)
  if (!url) return null
  try {
    const alvo = new URL(url, BASE_ORGANIZACAO)
    if (alvo.origin !== new URL(BASE_ORGANIZACAO).origin) return null
    return `${alvo.pathname}${alvo.search}`
  } catch {
    return null
  }
}
