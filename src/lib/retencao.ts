/**
 * Retenção de dado pessoal — RNF-33, T-243.
 *
 * A Fase 3 é onde o volume de dado pessoal cresce: além de vínculo e conversa, passam a
 * existir preferência de canal, histórico de notificação e trecho de comentário
 * gravado no corpo da mensagem. Guardar isso para sempre por omissão é uma decisão
 * tomada por acidente.
 *
 * ## Três regras que este arquivo aplica
 *
 * 1. **`null` = guardar.** Nenhum expurgo acontece por default. Apagar é irreversível e
 *    precisa de alguém tendo decidido — não de um número que veio no código.
 * 2. **`vinculos` NUNCA é expurgado por aqui.** Apagar um vínculo é apagar o acesso da
 *    pessoa ao próprio chamado (`RF-30`, `RN-04`): o chamado continua no JSM e fica
 *    invisível para quem o abriu, que é exatamente o pior caso que `RNF-21` existe para
 *    impedir. Retenção de vínculo é decisão de negócio com aviso ao usuário, não uma
 *    linha de cron.
 * 3. **A auditoria tem PISO.** Ela é append-only (`RN-10`) e é o que responde "quem viu
 *    o quê" numa investigação. Um expurgo de 30 dias na auditoria apagaria a prova do
 *    incidente antes de alguém notar o incidente — daí `PISO_AUDITORIA_DIAS`.
 */

import type { Banco } from './db/tipos'

/**
 * Mínimo de dias de auditoria, mesmo que alguém configure menos.
 *
 * Seis meses é o horizonte em que uma pergunta de conformidade costuma chegar ("em
 * março alguém acessou a página X?"). Configurar 7 dias silenciosamente destruiria a
 * capacidade de responder — então o valor é **clampado**, e o console diz que foi.
 */
export const PISO_AUDITORIA_DIAS = 180

export interface PoliticaRetencao {
  readonly conversasDias: number | null
  readonly auditoriaDias: number | null
  readonly notificacoesDias: number | null
}

export interface ResultadoRetencao {
  readonly conversas: number
  readonly mensagens: number
  readonly notificacoes: number
  readonly auditoria: number
  /** `true` quando a política de auditoria foi elevada ao piso (ver acima). */
  readonly auditoriaClampada: boolean
}

function limite(agoraMs: number, dias: number): string {
  return new Date(agoraMs - dias * 86_400_000).toISOString()
}

/**
 * Aplica a política. Idempotente e limitada por data — não por contagem.
 *
 * ⚠️ Conversa expurgada leva as **mensagens** dela: mensagem órfã é conteúdo de conversa
 * sem a conversa, o que é o pior dos dois mundos (ocupa espaço e não serve para nada).
 */
export async function aplicarRetencao(
  db: Banco,
  politica: PoliticaRetencao,
  agoraMs: number,
): Promise<ResultadoRetencao> {
  let conversas = 0
  let mensagens = 0
  let notificacoes = 0
  let auditoria = 0
  let auditoriaClampada = false

  if (politica.conversasDias !== null) {
    const corte = limite(agoraMs, politica.conversasDias)
    // Mensagens primeiro: se o processo morrer no meio, sobra conversa sem mensagem
    // (recuperável) em vez de mensagem sem conversa (lixo invisível).
    const m = await db.exec(
      `DELETE FROM mensagens WHERE conversa_id IN
         (SELECT id FROM conversas WHERE criado_em < ?)`,
      [corte],
    )
    mensagens = m.rowsWritten
    const c = await db.exec(`DELETE FROM conversas WHERE criado_em < ?`, [corte])
    conversas = c.rowsWritten
  }

  if (politica.notificacoesDias !== null) {
    const r = await db.exec(
      // ⚠️ Só notificação JÁ RESOLVIDA. Apagar uma `pendente` é jogar no lixo um aviso
      // que ninguém recebeu — a fila é curta, e uma pendente antiga é sinal de canal
      // quebrado, que é justamente o que se quer ver.
      `DELETE FROM notificacoes WHERE criado_em < ? AND estado IN ('enviada', 'falha', 'suprimida')`,
      [limite(agoraMs, politica.notificacoesDias)],
    )
    notificacoes = r.rowsWritten
  }

  if (politica.auditoriaDias !== null) {
    const dias = Math.max(politica.auditoriaDias, PISO_AUDITORIA_DIAS)
    auditoriaClampada = dias !== politica.auditoriaDias
    const r = await db.exec(`DELETE FROM auditoria WHERE criado_em < ?`, [limite(agoraMs, dias)])
    auditoria = r.rowsWritten
  }

  return { conversas, mensagens, notificacoes, auditoria, auditoriaClampada }
}
