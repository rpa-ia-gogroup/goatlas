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

/**
 * O que uma varredura de usuários devolve — e o que ela NÃO conseguiu afirmar.
 *
 * ⚠️ Não é `UsuarioOrganizacao[]` porque duas informações se perdiam nesse formato, e
 * as duas mudam a leitura do console:
 *
 * - **`parcial`** — o teto de páginas era atingido **em silêncio**. Inventário
 *   incompleto vira recomendação de rebaixar quem a página seguinte mostraria ativo,
 *   e a tela não tinha como saber que estava vendo um pedaço.
 * - **`suspensaoConhecida`** — ver `listarUsuarios`. O filtro de suspensão é o único
 *   jeito de saber quem está suspenso, e ele pode não estar filtrando.
 */
export interface ResultadoUsuarios {
  /** **Só as contas não suspensas** — são as que consomem licença. */
  readonly usuarios: readonly UsuarioOrganizacao[]
  /** Quantas contas suspensas a varredura encontrou. `0` com
   * `suspensaoConhecida: false` significa "não deu para saber", não "nenhuma". */
  readonly suspensas: number
  /** `false` = o filtro `isSuspended` não pôde ser confirmado nesta varredura. */
  readonly suspensaoConhecida: boolean
  /** `true` = o teto de páginas foi atingido e a lista está incompleta. */
  readonly parcial: boolean
}

export interface ClienteOrganizacao {
  /** `POST /admin/v1/orgs/{orgId}/users/search` (RF-51, T-122). */
  listarUsuarios(orgId: string): Promise<ResultadoUsuarios>

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
    metodo: 'POST',
    caminho: '/admin/v1/orgs/{orgId}/users/search',
    risco:
      '✅ VERIFICADO contra a Atlassian real em 07/08/2026: devolve 54 contas, campos em camelCase, `expand:["NAME","EMAIL"]` obrigatório para nome/e-mail. 🚨 O que FALTA não é verificação, é caminho: **o produto atribuído a cada conta não existe neste endpoint** (`expand:["PRODUCT_ACCESS"]` responde 400). Sem ele o inventário de assentos grava zero linha, e portanto custo (`RF-53`) e assento ocioso (`RF-52`) não têm insumo. A via provável é derivar de grupos (`jira-servicedesk`/`jira-software`/`conf`), que é proxy imperfeito — ver T-133 e `D-22`.',
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

/**
 * Um produto como `last-active-dates` devolve — **snake_case**, medido em 07/08/2026.
 *
 * ⚠️ **A mesma API usa DUAS convenções.** `users/search` responde em camelCase
 * (`accountId`); este endpoint responde em snake_case (`product_access`, `last_active`).
 * Normalizar "para ficar consistente" quebra um dos dois — e o sintoma é lista vazia com
 * HTTP 200, nunca uma exceção.
 *
 * 🚨 **É AQUI que o produto atribuído vive**, e não em `users/search`. É o que torna o
 * inventário possível: `listarUsuarios` dá conta/nome/e-mail, este dá produto + último
 * acesso. Quem escrever "o produto vem da listagem" está reabrindo um inventário vazio.
 */
interface ProdutoBruto {
  key?: unknown
  name?: unknown
  /** Só a data (`"2026-08-03"`). */
  last_active?: unknown
  /** ISO completo — preferido sobre `last_active`. */
  last_active_timestamp?: unknown
}

/**
 * A conta como o `users/search` devolve — **camelCase**, medido em 07/08/2026.
 *
 * 🚨 Este contrato foi escrito em `snake_case` (`account_id`, `account_status`) seguindo a
 * documentação, e a API responde em **camelCase**. O efeito era silencioso e total:
 * `accountId` ausente descarta a linha, então **todas** as 54 contas eram descartadas e o
 * inventário vinha vazio — HTTP 200, nenhuma exceção. Terceira ocorrência da mesma classe
 * de bug neste projeto (`env.DB` devolvendo `{}` e o `GET /users` vazio foram as outras).
 *
 * ⚠️ `name` e `email` **só existem com `expand: ["NAME","EMAIL"]`** no corpo. Sem o expand
 * a resposta traz apenas `accountId`, `accountType`, `accountStatus` e `statusInUserbase`.
 */
interface UsuarioBruto {
  accountId?: unknown
  email?: unknown
  name?: unknown
  accountStatus?: unknown
  /**
   * ⚠️ **NÃO existe neste endpoint.** `expand: ["PRODUCT_ACCESS"]` responde
   * **400 INVALID_PARAM** — medido. Declarado aqui para que ninguém volte a mapeá-lo
   * achando que só faltava pedir; de onde o produto atribuído vem de verdade é problema
   * aberto, ver `ENDPOINTS_NAO_VERIFICADOS`.
   */
  productAccess?: unknown
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

  /**
   * Inventário de contas da organização — RF-51, T-122.
   *
   * ## Por que `POST /users/search` e não `GET /users`
   *
   * `GET /admin/v1/orgs/{orgId}/users` lista **só contas gerenciadas**, e uma org só
   * tem contas gerenciadas depois de reivindicar um domínio. A org da Gocase não
   * reivindicou nenhum: aquele endpoint devolve `{"data": []}` — medido em
   * 31/07/2026. Zero contas, HTTP 200, nenhum erro. É a pior forma de estar errado,
   * porque o console mostraria "0 assentos" e ninguém desconfiaria da chamada.
   *
   * ## Três armadilhas medidas, e nenhuma dá erro
   *
   * 1. **`accountTypes: ['atlassian']` é obrigatório.** Sem ele entram ~83 contas de
   *    app/bot, que não são pessoas e não consomem assento de gente.
   * 2. **`query`, `groupIds` e `productAccess` NÃO filtram** — respondem 200 com a
   *    lista inteira. Usar um deles achando que restringe produz um resultado que
   *    parece filtrado e não é. Só `accountTypes`, `accountIds` e `isSuspended`
   *    filtram de verdade; por isso nenhum outro é enviado aqui.
   * 3. **`account_status` não é status de suspensão** — volta `"active"` até para
   *    conta suspensa. Quem responde é o **filtro** `isSuspended`, e é por isso que
   *    há duas varreduras.
   *
   * ## E se o filtro de suspensão também não filtrar?
   *
   * A armadilha 2 mostra que "filtro que não filtra" é um comportamento real desta
   * API. Se `isSuspended` for um deles, as duas varreduras devolvem o **mesmo
   * conjunto** — e isso é detectável: interseção não vazia significa que o filtro não
   * separou nada. Nesse caso o resultado sai com `suspensaoConhecida: false` em vez de
   * afirmar que ninguém está suspenso. Contar conta suspensa como assento ativo infla
   * o custo e gera recomendação de revogar acesso de quem já não tem acesso.
   */
  async listarUsuarios(orgId: string): Promise<ResultadoUsuarios> {
    const ativas = await this.varrer(orgId, false)
    const suspensas = await this.varrer(orgId, true)

    // Se `isSuspended` estivesse filtrando, os dois conjuntos seriam disjuntos por
    // construção. Qualquer sobreposição significa que ele devolveu a lista inteira
    // nas duas vezes — o mesmo comportamento já medido em `query`/`productAccess`.
    const idsAtivas = new Set(ativas.usuarios.map((u) => u.accountId))
    const sobrepostas = suspensas.usuarios.filter((u) => idsAtivas.has(u.accountId)).length
    const suspensaoConhecida = sobrepostas === 0

    return {
      usuarios: ativas.usuarios,
      // `0` sem `suspensaoConhecida` seria a afirmação errada; quem lê o campo tem de
      // olhar os dois juntos, e o nome do outro campo existe para forçar isso.
      suspensas: suspensaoConhecida ? suspensas.usuarios.length : 0,
      suspensaoConhecida,
      parcial: ativas.parcial || suspensas.parcial,
    }
  }

  /**
   * Uma varredura paginada, com o recorte de suspensão fixo.
   *
   * ⚠️ **O cursor volta em `links.next` e é reenviado no CORPO**, não seguido como
   * URL: é um `POST`, e a próxima página é o mesmo caminho com `cursor` no JSON.
   * Seguir `links.next` como caminho faria a segunda página virar um `POST` para uma
   * URL com query string que o endpoint não lê — 200 com a primeira página de novo, ou
   * seja, laço até o teto sem nunca avançar.
   */
  private async varrer(
    orgId: string,
    isSuspended: boolean,
  ): Promise<{ usuarios: UsuarioOrganizacao[]; parcial: boolean }> {
    const caminho = `/admin/v1/orgs/${encodeURIComponent(orgId)}/users/search`
    const usuarios: UsuarioOrganizacao[] = []
    let cursor: string | null = null
    let pagina = 0

    for (; pagina < MAX_PAGINAS_USUARIOS; pagina += 1) {
      const dados = (await this.transporte.requisitar(caminho, {
        method: 'POST',
        body: JSON.stringify({
          // Só os três filtros que a medição confirmou. Ver armadilha 2.
          accountTypes: ['atlassian'],
          isSuspended,
          limit: TAMANHO_PAGINA,
          // ⚠️ Sem este expand a resposta NÃO traz `name` nem `email` — só ids e status.
          // `PRODUCT_ACCESS` não entra na lista: responde 400 (ver `UsuarioBruto`).
          expand: ['NAME', 'EMAIL'],
          ...(cursor === null ? {} : { cursor }),
        }),
      })) as { data?: unknown; links?: { next?: unknown } } | null

      for (const bruto of Array.isArray(dados?.data) ? (dados!.data as UsuarioBruto[]) : []) {
        const accountId = texto(bruto?.accountId)
        if (!accountId) continue
        // ⚠️ Isto descarta conta DESATIVADA, e **não** é o teste de suspensão: quem
        // responde por suspensão é o filtro `isSuspended` da requisição, porque
        // `accountStatus` volta `"active"` até para conta suspensa — medido: as 54 contas
        // vieram `"active"`. Continua aqui porque só remove linha, nunca inventa uma.
        if (texto(bruto?.accountStatus) === 'inactive') continue
        usuarios.push({
          accountId,
          email: texto(bruto?.email) ?? '',
          nome: texto(bruto?.name) ?? texto(bruto?.email) ?? accountId,
          // ⚠️ **Sempre vazio hoje**, e isso é honesto em vez de inventado: o produto
          // atribuído NÃO vem deste endpoint (ver `UsuarioBruto.productAccess`). Enquanto
          // for assim, `registrarColeta` grava zero linha por conta — o inventário fica
          // vazio e a tela diz "sem coleta", que é melhor que um inventário que existe e
          // está errado. Resolver isto é T-133 (`D-22`).
          produtos: produtosDe(bruto?.productAccess),
        })
      }

      cursor = cursorDaProximaPagina(dados?.links?.next)
      if (cursor === null) return { usuarios, parcial: false }
    }

    // Saiu pelo teto com cursor ainda na mão: há mais páginas que não foram lidas.
    return { usuarios, parcial: true }
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
      // ⚠️ **`last_active_timestamp` vem primeiro, `last_active` é o fallback.** Medido em
      // 07/08/2026: os dois existem, e `last_active` é só a DATA (`"2026-08-03"`), que ao
      // ser normalizada vira meia-noite UTC. Perder as horas não muda "ocioso há 60 dias",
      // mas muda o limiar de quem acessou hoje de manhã.
      porProduto.push({
        produto,
        ultimoAcessoEm:
          normalizarCarimbo(item?.last_active_timestamp) ?? normalizarCarimbo(item?.last_active),
      })
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
 * Extrai o **valor do cursor** de `links.next`.
 *
 * A Atlassian devolve `links.next` como URL absoluta com o cursor na query string, mas
 * a próxima página de um `POST /users/search` se pede reenviando esse valor no
 * **corpo** — a URL em si não é para ser seguida. Daí extrair em vez de repassar.
 *
 * ⚠️ **`next` de outro host é descartado.** Aqui já não é risco de mandar a credencial
 * de Org Admin para fora (não seguimos mais a URL), e sim de correção: um cursor
 * emitido por outro host não é um cursor desta paginação, e reenviá-lo faria a
 * varredura repetir a primeira página até o teto.
 */
export function cursorDaProximaPagina(bruto: unknown): string | null {
  const url = texto(bruto)
  if (!url) return null
  try {
    const alvo = new URL(url, BASE_ORGANIZACAO)
    if (alvo.origin !== new URL(BASE_ORGANIZACAO).origin) return null
    const cursor = alvo.searchParams.get('cursor')
    return cursor !== null && cursor.length > 0 ? cursor : null
  } catch {
    return null
  }
}
