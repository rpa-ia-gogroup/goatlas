/**
 * Exportação CSV das recomendações (RF-54).
 *
 * ⚠️ Nome, e-mail e motivo passam por dados de um sistema de terceiro (a
 * organização Atlassian, editável por quem tem assento) — vírgula ou aspas ali não
 * podem quebrar a coluna seguinte, e um campo começando com `=`, `+`, `-` ou `@`
 * não pode virar fórmula executada quando alguém abrir o arquivo no Excel/Sheets
 * (injeção de fórmula em CSV é uma classe de vulnerabilidade conhecida, e o campo
 * é literalmente o nome de alguém — não é hipotético).
 */

import type { Recomendacao } from './recomendacoes'

const CABECALHO = ['email', 'nome', 'tipo', 'motivo', 'produtos_afetados'] as const

function escaparCampoCsv(valor: string): string {
  const semFormula = /^[=+\-@]/.test(valor) ? `'${valor}` : valor
  return /[",\r\n]/.test(semFormula) ? `"${semFormula.replace(/"/g, '""')}"` : semFormula
}

export function recomendacoesParaCsv(recomendacoes: readonly Recomendacao[]): string {
  const linhas = recomendacoes.map((r) =>
    [r.email, r.nome, r.tipo, r.motivo, r.produtosAfetados.join('; ')]
      .map(escaparCampoCsv)
      .join(','),
  )
  return [CABECALHO.join(','), ...linhas].join('\r\n')
}
