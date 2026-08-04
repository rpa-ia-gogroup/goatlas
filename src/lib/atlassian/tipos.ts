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

  /** Comentário público atribuído de forma legível ao solicitante real (RF-33). */
  comentar(issueKey: string, corpo: string, autorEmail: string): Promise<void>

  buscarConfluence(params: BuscaConfluenceParams): Promise<readonly PaginaConfluence[]>

  /** Histórico para a Regra 2 (RF-10). */
  buscarHistoricoTickets(params: HistoricoParams): Promise<readonly TicketHistorico[]>

  /** Reconciliação de vínculos órfãos pelo campo "Solicitante" (RNF-21). */
  buscarChamadosPorChaveIdempotencia(chave: string): Promise<readonly ChamadoCriado[]>

  /** Health check (RF-59). */
  verificarSaude(): Promise<{ readonly ok: boolean; readonly detalhe: string }>
}
