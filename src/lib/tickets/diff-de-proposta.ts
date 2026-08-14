/**
 * O que a IA mudou nesta volta — `RN-13`, e o **único** produtor dessa resposta.
 *
 * ## Por que o diff mora no servidor
 *
 * Ele tem dois consumidores: a resposta HTTP (a tela mescla com ele) e a auditoria de `FR-23`
 * ("em quais campos a argumentação pega?"). Calculado no cliente, a tela mesclaria por um
 * critério e o console contaria por outro — a divergência silenciosa que `D-52` (duas áreas) e
 * `D-70` (duas listas de tipos) já custaram. Uma pergunta, um lugar.
 *
 * ## 🚨 A base é a última proposta DA IA, nunca a vigente
 *
 * A vigente carrega a edição da pessoa (`PUT /proposta`, `RF-16`). Comparar contra ela produz o
 * pior tipo de defeito: a pessoa baixa a prioridade para `normal`, a IA devolve `alta` de novo
 * — sem ter mudado de opinião —, o diff diz *"a IA mudou a prioridade"* e a tela atropela a
 * escolha dela. `SC-7` proíbe, e não há sintoma nenhum: nenhum erro, nenhum log, nenhum teste
 * vermelho. Daí a coluna `conversas.proposta_ia_json`.
 *
 * _Requirements: RN-13, RF-69, FR-8, FR-9, FR-23_
 */

import type { PropostaDaIa } from '../agent/estado'

/**
 * Nome de campo alterado. Campo do formulário vai **prefixado**.
 *
 * ⚠️ O prefixo não é enfeite: sem ele um `fieldId` chamado `titulo` colidiria com o título da
 * proposta, e o merge adotaria o campo errado. Prefixo é o que torna os dois espaços de nome
 * disjuntos por construção.
 */
export type CampoAlterado =
  | 'titulo'
  | 'descricao'
  | 'tipoChamadoId'
  | 'prioridade'
  | 'motivoPrioridade'
  | `campo:${string}`

const CAMPOS_DA_PROPOSTA = [
  'titulo',
  'descricao',
  'tipoChamadoId',
  'prioridade',
  'motivoPrioridade',
] as const

/**
 * Compara a proposta nova com a **base** (a anterior da IA).
 *
 * ⚠️ **Base `null` devolve lista vazia**, nunca "tudo mudou". A primeira proposta da conversa
 * não é um ajuste: dizer que ela mudou cinco campos faria o primeiro cartão da vida contar como
 * "proposta ajustada por argumentação" em `ScC-9`, e a tela adotaria valores que ninguém tinha
 * para preservar de qualquer forma.
 */
export function diffDeProposta(
  base: PropostaDaIa | null,
  nova: PropostaDaIa,
): readonly CampoAlterado[] {
  if (!base) return []
  const mudou: CampoAlterado[] = []
  for (const campo of CAMPOS_DA_PROPOSTA) {
    if (base[campo] !== nova[campo]) mudou.push(campo)
  }
  // Campos do formulário: a união das duas chaves, porque campo que **apareceu** também mudou.
  const chaves = new Set([...Object.keys(base.campos ?? {}), ...Object.keys(nova.campos ?? {})])
  for (const chave of chaves) {
    if ((base.campos ?? {})[chave] !== (nova.campos ?? {})[chave]) mudou.push(`campo:${chave}`)
  }
  return mudou
}

/**
 * Isto conta como "proposta ajustada por argumentação"? — `FR-23`, `ScC-9`.
 *
 * ⚠️ **Motivo reescrito sozinho NÃO conta.** O modelo redige o motivo de novo a cada
 * rederivação, então contá-lo faria **toda** mensagem virar um evento `proposta_ajustada` e a
 * resposta de `ScC-9` ("quantas propostas foram ajustadas, e em quais campos?") mediria variação
 * de redação em vez de argumentação que mudou o chamado.
 */
export function houveAjusteDeProposta(alterados: readonly string[]): boolean {
  return alterados.some((c) => c !== 'motivoPrioridade')
}
