/**
 * Os campos ADICIONAIS que o formulário sem IA envia — `RF-27`, endurecido em T-401.
 *
 * ## A allowlist nunca vem do cliente
 *
 * O corpo da requisição diz *quais* campos preencher, e antes disso ia direto para
 * `requestFieldValues` da criação: havia allowlist de **valor** (só string) e
 * nenhuma de **chave** — apenas `summary` e `description` eram removidos lá no
 * cliente. Quem chamasse a rota podia nomear qualquer campo do Jira.
 *
 * O dano era contido porque o Jira recusa campo que não pertence ao request type —
 * mas a contenção era **do outro lado**, não nossa. É o mesmo raciocínio da busca no
 * Confluence, onde `?espacos=` é ignorado: quem consulta não escolhe o próprio
 * escopo.
 *
 * ## Duas regras, e a segunda é a que importa
 *
 * 1. **Só passa chave que o schema ofereceu.** O schema é a lista de campos que o
 *    request type realmente tem — a mesma que desenhou o formulário.
 * 2. **Campo de anexo nunca passa por aqui.** O arquivo entra pelo caminho próprio
 *    (upload → materialização depois da criação). Aceitá-lo como texto seria o
 *    caminho para colar o anexo de outra pessoa no próprio chamado — `RF-30`
 *    aplicado a arquivo.
 */

import type { CampoRequestType } from '../atlassian/tipos'

/**
 * Lê o objeto bruto do corpo. Ausente/malformado = nenhum campo, **nunca erro**:
 * o caminho sem IA (`D-04`) não pode regredir por causa de um campo extra torto.
 */
export function extrairCamposDinamicos(bruto: unknown): Record<string, string> | null {
  if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto)) return null
  const saida: Record<string, string> = {}
  for (const [chave, valor] of Object.entries(bruto as Record<string, unknown>)) {
    if (typeof valor !== 'string') continue
    const limpo = valor.trim()
    if (limpo.length === 0) continue
    saida[chave] = limpo
  }
  return Object.keys(saida).length > 0 ? saida : null
}

/**
 * Mantém só as chaves que o schema ofereceu, e nunca a de anexo.
 *
 * Função pura de propósito: o "quais chaves valem" é a regra, e regra que se pode
 * testar sem montar requisição é regra que continua testada quando a rota mudar.
 */
export function filtrarPeloSchema(
  campos: Record<string, string> | null,
  schema: readonly CampoRequestType[],
): Record<string, string> | null {
  if (!campos) return null
  const permitidas = new Set(schema.filter((c) => c.tipo !== 'anexo').map((c) => c.fieldId))
  const saida: Record<string, string> = {}
  for (const [chave, valor] of Object.entries(campos)) {
    if (permitidas.has(chave)) saida[chave] = valor
  }
  return Object.keys(saida).length > 0 ? saida : null
}
