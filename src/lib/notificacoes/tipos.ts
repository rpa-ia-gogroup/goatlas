/**
 * Contrato da camada isolada de notificação — RF-45, RNF-23, T-220.
 *
 * ## Por que uma camada só para "enviar"
 *
 * **Q11 (qual canal) está em aberto.** Sem esta fronteira, a resposta de Q11 seria
 * um `if` espalhado por todo lugar que notifica: criação, mudança de status,
 * comentário, alerta de SLA. Com ela, a resposta de Q11 é **uma implementação nova
 * de `Canal`** e um campo de config — nada da lógica de *quando* notificar muda.
 *
 * É o mesmo raciocínio de `atlassian/tipos.ts` (`RNF-22`): a camada existe para que
 * a decisão que ainda não foi tomada não fique costurada no código que não depende
 * dela.
 *
 * ⚠️ Um canal **nunca** decide se deve notificar. Ele recebe destino e mensagem
 * prontos e entrega. Supressão de ação própria (`RF-48`), dedupe (`RF-47`) e
 * preferência (`RF-45`) acontecem acima — se um canal pudesse decidir, cada canal
 * novo reabriria a chance de notificar a pessoa do próprio comentário.
 */

/** Os quatro fatos que geram aviso. Nada além disso notifica (RF-44, RF-46). */
export type TipoEvento =
  | 'chamado_criado'
  | 'status_alterado'
  | 'comentario_publico'
  | 'sla_em_risco'

export type NomeCanal = 'chat' | 'email' | 'nenhum'

export const NOMES_CANAL: readonly NomeCanal[] = ['chat', 'email', 'nenhum']

export const ehNomeCanal = (v: unknown): v is NomeCanal =>
  typeof v === 'string' && (NOMES_CANAL as readonly string[]).includes(v)

export interface Mensagem {
  readonly titulo: string
  readonly corpo: string
  /** Link para a tela do chamado DENTRO do app — nunca `atlassian.net`, que o público
   * do app não consegue abrir (mesmo raciocínio da deflexão em `rules/`). */
  readonly link: string | null
}

/**
 * Erro de canal. `transitorio` é o que separa "tenta de novo no próximo cron" de
 * "desiste" — mesma classificação do outbox de chamados (`RNF-17`): tratar
 * indisponibilidade como definitiva é perder o aviso numa queda de 30 segundos.
 */
export class ErroCanal extends Error {
  constructor(
    message: string,
    readonly detalhe: { readonly transitorio: boolean; readonly status?: number },
  ) {
    super(message)
    this.name = 'ErroCanal'
  }
}

export interface Canal {
  readonly nome: NomeCanal
  /**
   * Entrega a mensagem. `destino` já foi resolvido pela preferência (endereço de
   * e-mail, webhook de espaço no Chat, etc.) — a camada não descobre destino.
   */
  enviar(destino: string, mensagem: Mensagem): Promise<void>
  verificarSaude(): Promise<{ readonly ok: boolean; readonly detalhe: string }>
}
