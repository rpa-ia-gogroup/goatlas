/**
 * Rate limit por usuário — RNF-11.
 *
 * "Para que um colaborador (ou um script) não consuma o orçamento de API nem o de
 * IA da organização inteira." Sob API token os burst limits da Atlassian **não são
 * publicados** (RNF-15), então limitar na entrada é a defesa que temos antes de o
 * 429 acontecer.
 *
 * Janela deslizante simples em banco. Não usa memória do Worker: cada requisição
 * pode cair numa instância diferente, e um limite por instância não limita nada.
 */

import type { Banco } from '../db/tipos'
import { primeiraLinha } from '../db/tipos'

export interface ResultadoLimite {
  readonly permitido: boolean
  readonly usadas: number
  readonly limite: number
}

export async function verificarLimite(
  db: Banco,
  email: string,
  limitePorMinuto: number,
  agoraMs: number,
): Promise<ResultadoLimite> {
  const inicioJanela = new Date(agoraMs - 60_000).toISOString()

  // A auditoria já registra toda ação relevante (RF-58), então ela é a fonte da
  // contagem — sem tabela extra e sem gravação a mais por requisição.
  const r = await db.query(
    `SELECT COUNT(*) AS n FROM auditoria
      WHERE ator_email = ? AND criado_em >= ?
        AND acao IN ('mensagem_enviada', 'busca_confluence', 'pagina_confluence_lida',
                     'anexo_servido', 'consulta_historico', 'chamado_criado', 'comentario_criado')`,
    [email, inicioJanela],
  )
  const usadas = Number(primeiraLinha<{ n: number }>(r)?.n ?? 0)

  return { permitido: usadas < limitePorMinuto, usadas, limite: limitePorMinuto }
}
