/**
 * Contrato da camada isolada da Atlassian — RNF-22.
 *
 * Esta interface é a ÚNICA porta para a Atlassian. Nenhuma URL de
 * `goengenharia.atlassian.net` ou `api.atlassian.com` pode aparecer fora de
 * `src/lib/atlassian/`. Se aparecer, a saída de emergência do R-01 deixou de
 * existir — e ela é o que torna a migração de identidade (D-01: proxy total →
 * `raiseOnBehalfOf` por usuário) uma mudança localizada.
 *
 * São métodos de DOMÍNIO, não um wrapper genérico de HTTP. `criarChamado` hoje
 * usa a conta de serviço como reporter; depois da migração, o MESMO método passa
 * `raiseOnBehalfOf` — e nada acima desta camada muda.
 */

/** Prioridade do goatlas com o SLA de PRIMEIRA RESPOSTA (RF-15, RN-08). */
export type Prioridade = 'critica' | 'alta' | 'normal'

/** SLA de primeira resposta em horas, por prioridade (RF-15). */
export const SLA_PRIMEIRA_RESPOSTA_HORAS: Readonly<Record<Prioridade, number>> = {
  critica: 4,
  alta: 12,
  normal: 24,
}

export interface TipoChamado {
  readonly id: string
  readonly serviceDeskId: string
  readonly nome: string
  readonly descricao: string | null
}

export interface NovoChamado {
  readonly serviceDeskId: string
  readonly tipoChamadoId: string
  readonly titulo: string
  readonly descricao: string
  readonly prioridade: Prioridade
  /**
   * E-mail do solicitante REAL. Vai para o campo customizado "Solicitante"
   * (RF-21) — sem ele todo chamado chega ao time de tech como aberto pelo robô
   * (R-03).
   */
  readonly solicitanteEmail: string
  /**
   * Chave de idempotência (RF-24). Vai TAMBÉM para o Jira, para que o pior caso
   * do sistema — criado no JSM, vínculo local perdido — seja reconciliável
   * (RNF-21) em vez de virar chamado invisível ao próprio autor.
   */
  readonly chaveIdempotencia: string
  /**
   * Valores dos campos ADICIONAIS do request type (RF-27, T-130) — chave é o
   * `fieldId` do schema. Só o formulário sem IA (`D-04`) preenche isto: o fluxo
   * conversacional não tem schema dinâmico. `undefined`/ausente = nenhum campo
   * adicional, nunca um objeto vazio inventado.
   */
  readonly camposDinamicos?: Readonly<Record<string, string>>
}

export interface ChamadoCriado {
  readonly issueKey: string
  readonly issueId: string
}

export interface Chamado {
  readonly issueKey: string
  readonly titulo: string
  readonly descricao: string
  readonly status: string
  readonly prioridade: Prioridade | null
  readonly criadoEm: string
  readonly atualizadoEm: string
  readonly slaPrimeiraResposta: {
    readonly prazo: string | null
    readonly cumprido: boolean | null
  } | null
}

/**
 * Comentário JÁ FILTRADO como público. A camada nunca devolve comentário interno
 * para cima — ver `listarComentariosPublicos` (RF-32, RN-05).
 */
export interface ComentarioPublico {
  readonly id: string
  readonly corpo: string
  readonly autorNome: string
  readonly criadoEm: string
}

export interface PaginaConfluence {
  readonly id: string
  readonly titulo: string
  readonly espaco: string
  readonly url: string
  /** Score de relevância — insumo da Regra 1 (RF-09), não ordenação visual. */
  readonly score: number
  readonly trecho: string
  readonly labels: readonly string[]
}

/**
 * O que basta para **decidir a exposição** de uma página (`RN-06`) sem trazer o
 * conteúdo dela.
 *
 * Existe separado de `PaginaConfluence` (resultado de busca) e do corpo porque a
 * ordem importa: metadados → decidir → conteúdo. Trazer o corpo antes de decidir
 * funciona hoje e vaza no dia em que um caminho esquecer o filtro — o conteúdo
 * restrito já estaria na memória do app.
 */
export interface EspacoConfluence {
  readonly chave: string
  readonly nome: string
  /** Página inicial do espaço — é ela que serve de raiz da árvore (`RF-41`). */
  readonly homepageId: string | null
}

export interface FilhosParams {
  readonly idPai: string
  /** Allowlist de espaços. Vai para a QUERY, como na busca (`RN-06`, `RNF-07`). */
  readonly espacosPermitidos: readonly string[]
  readonly labelsBloqueadas: readonly string[]
  readonly limite: number
}

export interface MetadadosPagina {
  readonly id: string
  /**
   * Id da página mãe, ou `null` na raiz. É a fonte dos breadcrumbs (`RF-41`) — e cada
   * ancestral ainda precisa passar por `RN-06` antes de ser nomeado.
   */
  readonly idPai: string | null
  /**
   * **Chave** do espaço (`TECH`), nunca o `spaceId` numérico da v2.
   *
   * ⚠️ A API v2 devolve `spaceId`; a allowlist é por **chave**. Comparar a
   * allowlist com o id numérico não dá erro — dá negação silenciosa de tudo, ou
   * pior, casamento acidental. A resolução id → chave é do cliente.
   */
  readonly espaco: string
  readonly titulo: string
  readonly labels: readonly string[]
  /** `status === 'current'`. Página em lixeira ou rascunho não é conteúdo publicado. */
  readonly atual: boolean
  readonly versao: number
  readonly atualizadoEm: string
  /** Link da página no Confluence — só serve a quem TEM assento (não é o caminho de leitura). */
  readonly url: string
}

/**
 * Anexo já resolvido em bytes.
 *
 * ⚠️ `tipoDeclarado` é o que a **Atlassian** diz, e a Atlassian repete o que estava
 * no upload de alguém. Ele nunca vai direto para a resposta do app: anexo
 * `text/html` servido do nosso domínio é XSS com a sessão do app. Ver
 * `confluence/anexo.ts`.
 */
export interface AnexoConfluence {
  readonly nomeArquivo: string
  readonly tipoDeclarado: string | null
  readonly bytes: ArrayBuffer
}

/**
 * Resultado de `obterAnexo`. União fechada em vez de `null` + exceção porque os
 * três casos levam a respostas diferentes, e "não encontrado" não é falha.
 */
export type ResultadoAnexo =
  | { readonly estado: 'ok'; readonly anexo: AnexoConfluence }
  | { readonly estado: 'nao_encontrado' }
  | { readonly estado: 'grande_demais'; readonly tamanhoBytes: number }

/**
 * Teto de bytes de um anexo servido pelo proxy.
 *
 * Não é preferência: o Worker não tem disco nem streaming aqui, então o arquivo
 * inteiro passa pela memória. Página editável por qualquer pessoa é entrada não
 * confiável **inclusive no tamanho** — derrubar o app não precisa de script, basta
 * anexar um arquivo enorme e pedir o proxy.
 */
export const MAX_ANEXO_BYTES = 12 * 1024 * 1024

/**
 * Um campo ADICIONAL do request type (RF-27, T-130) — além dos já cobertos pelo
 * formulário fixo (título=`summary`, descrição=`description`,
 * prioridade=`priority`). `camposAdicionais()` em `atlassian/cliente.ts` já
 * filtra esses três antes de qualquer campo chegar aqui.
 */
export type TipoCampoRequestType = 'texto' | 'texto_longo' | 'selecao'

export interface OpcaoCampoRequestType {
  readonly id: string
  readonly rotulo: string
}

export interface CampoRequestType {
  readonly fieldId: string
  readonly rotulo: string
  readonly obrigatorio: boolean
  readonly tipo: TipoCampoRequestType
  /** Só populado quando `tipo === 'selecao'`. */
  readonly opcoes: readonly OpcaoCampoRequestType[]
}

export interface TicketHistorico {
  readonly issueKey: string
  readonly titulo: string
  readonly criadoEm: string
  readonly resolvidoEm: string | null
  /** Campo usado para agrupar "mesmo tipo" — qual campo é isso vem de config (Q2). */
  readonly chaveAgrupamento: string | null
  readonly comentariosResolucao: readonly string[]
}

export interface BuscaConfluenceParams {
  readonly termo: string
  /** Allowlist de espaços. Restringe a QUERY, não o resultado (RN-06, RNF-07). */
  readonly espacosPermitidos: readonly string[]
  /** Labels que bloqueiam a página mesmo em espaço liberado (RF-38). */
  readonly labelsBloqueadas: readonly string[]
  readonly limite: number
}

export interface HistoricoParams {
  readonly chaveAgrupamento: string
  /** Campo do Jira que delimita "mesmo tipo" (RF-11) — Q2. */
  readonly campoAgrupamento: string
  readonly janelaDias: number
  readonly limite: number
}

/** Erro de domínio da camada. Nunca expõe corpo cru de resposta HTTP (RNF-30). */
export class ErroAtlassian extends Error {
  constructor(
    message: string,
    readonly detalhe: {
      readonly status?: number
      readonly transitorio: boolean
      readonly recurso: string
    },
  ) {
    super(message)
    this.name = 'ErroAtlassian'
  }
}

export interface ClienteAtlassian {
  /** Tipos de chamado do site. A allowlist é aplicada ACIMA desta camada (RF-28). */
  listarTiposChamado(): Promise<readonly TipoChamado[]>

  /**
   * Schema de campos ADICIONAIS de um request type (RF-27, T-130) — o que falta
   * para o formulário sem IA (`D-04`) parar de ser hardcoded. `serviceDeskId` e
   * `requestTypeId` vêm de config/allowlist (RNF-25), nunca fixos no código.
   */
  obterCamposDoTipo(
    serviceDeskId: string,
    requestTypeId: string,
  ): Promise<readonly CampoRequestType[]>

  criarChamado(dados: NovoChamado): Promise<ChamadoCriado>

  obterChamado(issueKey: string): Promise<Chamado>

  /**
   * Comentários públicos, e SÓ públicos (RF-32, RN-05).
   *
   * A implementação encapsula a pegadinha: o parâmetro `internal` do JSM tem
   * default `true`, então passar só `public=true` retorna públicos E internos.
   * Envia `?public=true&internal=false` E filtra pelo campo `public` de cada
   * item — defesa em profundidade, duas camadas dentro de uma função.
   */
  listarComentariosPublicos(issueKey: string): Promise<readonly ComentarioPublico[]>

  /**
   * Comentário público atribuído de forma legível ao solicitante real (RF-33).
   *
   * `autorNome` é o nome capturado no login corporativo Google (obrigatório —
   * `RF-01`/`RF-05`), então o prefixo é confiável mesmo partindo da conta de
   * serviço: quem vê o ticket no Jira nativo já sabe quem pediu, sem precisar do
   * console do goatlas (decisão registrada em `docs/DECISOES.md`, D-13).
   */
  comentar(issueKey: string, corpo: string, autorEmail: string, autorNome?: string): Promise<void>

  buscarConfluence(params: BuscaConfluenceParams): Promise<readonly PaginaConfluence[]>

  /**
   * Metadados de uma página, para **decidir** exposição antes de ler (RF-40, RN-06).
   *
   * Lança quando a página não existe ou quando espaço/labels não puderam ser
   * resolvidos: sem eles não há como avaliar duas das três condições de `RN-06`, e
   * ausência de informação é negar (o gate em `confluence/acesso.ts` trata o erro
   * como recusa).
   */
  obterMetadadosPagina(idPagina: string): Promise<MetadadosPagina>

  /** Espaço por chave — nome e homepage, para a raiz da árvore (`RF-41`). */
  obterEspaco(chaveEspaco: string): Promise<EspacoConfluence>

  /**
   * Filhos diretos de uma página, **um nível** (`RF-41`).
   *
   * Um nível por vez não é preguiça: a árvore inteira exigiria uma consulta de
   * restrição por página, e um clique viraria dezenas de chamadas com a credencial
   * única (`R-02`). Espaço e label vão no CQL; só a restrição sobra por página, presa
   * ao `limite`.
   */
  listarFilhosDaPagina(params: FilhosParams): Promise<readonly PaginaConfluence[]>

  /**
   * A página tem **qualquer** restrição de leitura? — a terceira condição de
   * `RN-06`. Sob proxy total (`D-01`) qualquer restrição exclui, e falha ao
   * consultar também: na dúvida sobre exposição, não expor.
   */
  paginaRestrita(idPagina: string): Promise<boolean>

  /**
   * Storage format **cru** da página. ⚠️ **Não sanitizado.**
   *
   * Chamar isto sem ter passado pelas três condições de `RN-06` é o vazamento de
   * `RF-40`, e renderizar o retorno sem `sanitizarStorage` é o de `RNF-06`. Por
   * isso o único consumidor acima desta camada é `confluence/acesso.ts`, que só
   * chega aqui depois de autorizar — e há teste estrutural cobrando isso.
   */
  obterCorpoStorage(idPagina: string): Promise<string>

  /**
   * Anexo **daquela página**, casado por nome exato na lista de anexos dela.
   *
   * Receber `idPagina` não é conveniência: é o que amarra o anexo à página cuja
   * exposição foi verificada. Uma busca de anexo por nome solto serviria arquivo de
   * página restrita (`RF-40`).
   */
  obterAnexo(idPagina: string, nomeArquivo: string): Promise<ResultadoAnexo>

  /** Histórico para a Regra 2 (RF-10). */
  buscarHistoricoTickets(params: HistoricoParams): Promise<readonly TicketHistorico[]>

  /** Reconciliação de vínculos órfãos pelo campo "Solicitante" (RNF-21). */
  buscarChamadosPorChaveIdempotencia(chave: string): Promise<readonly ChamadoCriado[]>

  /**
   * Chamados alterados **desde** um instante — polling incremental (RF-47, T-210).
   *
   * ⚠️ `desde: null` NÃO significa "traga tudo". A implementação recua uma janela curta
   * a partir de agora: varredura completa é a forma mais fácil de descobrir os burst
   * limits não publicados da Atlassian do jeito ruim (`R-02`, `RNF-15`), e no primeiro
   * boot não há histórico de notificação para recuperar de qualquer forma.
   */
  buscarChamadosAtualizadosDesde(params: {
    readonly desde: string | null
    readonly limite: number
  }): Promise<readonly { readonly issueKey: string; readonly atualizadoEm: string }[]>

  /**
   * Anexa arquivo a um chamado — RF-25, RF-34, T-240.
   *
   * São **dois passos** no JSM e não há como pular: `attachTemporaryFile` devolve só
   * `temporaryAttachmentIds`, e é um segundo `POST` que os converte em anexo do
   * chamado. O primeiro passo é multipart e exige `X-Atlassian-Token: no-check`.
   */
  anexarArquivo(
    serviceDeskId: string,
    issueKey: string,
    arquivo: { readonly nome: string; readonly tipo: string; readonly bytes: ArrayBuffer },
  ): Promise<void>

  /**
   * Transições que o workflow do JSM oferece **ao cliente** (RF-36, T-242).
   *
   * Lista vazia é resposta normal, não erro: se o projeto não expõe transição ao
   * customer, a UI simplesmente não mostra o botão. O app não inventa transição que o
   * workflow não tem — isso é configuração do projeto, não do app.
   */
  listarTransicoes(issueKey: string): Promise<readonly { readonly id: string; readonly nome: string }[]>

  transicionar(issueKey: string, transicaoId: string): Promise<void>

  /**
   * RF-60 — taxa de 429 acumulada. Sob API token é a **única** telemetria de orçamento
   * que existe (`RNF-15`): a Atlassian não publica o limite e só manda os cabeçalhos
   * `X-RateLimit-*` em respostas 429.
   */
  telemetria(): { readonly total429: number; readonly totalRequisicoes: number }

  /** Health check (RF-59). */
  verificarSaude(): Promise<{ readonly ok: boolean; readonly detalhe: string }>
}
