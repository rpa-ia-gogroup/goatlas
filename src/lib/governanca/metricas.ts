/**
 * Métricas mínimas — funções PURAS (T-095, O1, R-04, RF-42).
 *
 * "Mínimas" é a palavra que importa: não é o painel completo de `RF-55` (que
 * inclui aderência a SLA, ainda inexistente antes da Fase 3) — é só o que já dá
 * para calcular com o que a Fase 1 já grava, e sem instrumentação não há como
 * calibrar `regra1_threshold_score`/`regra2_threshold_recorrencia` com dado real
 * em vez de achismo.
 *
 * ⚠️ Taxa sem nenhum bloqueio/busca ainda é `null`, nunca `0%`. Zero por falta de
 * dado e zero por a regra nunca falhar são coisas opostas, e confundi-las é o
 * mesmo erro que `buscaConfigurada: false` existe para evitar em `custo.ts`.
 */

import type { Banco } from '../db/tipos'
import { linhasComoObjetos } from '../db/tipos'

const ORDEM_REGRAS = ['regra1_confluence', 'regra2_ajuste_operacional'] as const

export interface LinhaBloqueio {
  readonly regra: string
  readonly houveOverride: boolean
}

export interface DeflexaoPorRegra {
  readonly regra: string
  readonly totalBloqueios: number
  readonly overrides: number
  /** `null` = nenhum bloqueio ainda dessa regra. */
  readonly taxaDeflexaoPct: number | null
}

export interface ResumoBuscas {
  readonly total: number
  readonly semResultado: number
  /** `null` = nenhuma busca ainda. */
  readonly taxaSemResultadoPct: number | null
}

export interface ResumoMetricas {
  readonly deflexaoPorRegra: readonly DeflexaoPorRegra[]
  readonly totalBloqueios: number
  readonly totalOverrides: number
  /** `null` = nenhum bloqueio ainda, de nenhuma regra. */
  readonly taxaOverrideGlobalPct: number | null
  readonly chamadosPorVia: Readonly<Record<string, number>>
  readonly buscas: ResumoBuscas
}

function taxa(numerador: number, denominador: number): number | null {
  return denominador === 0 ? null : (numerador / denominador) * 100
}

export function calcularMetricas(
  bloqueios: readonly LinhaBloqueio[],
  vias: readonly string[],
  resultadosBuscas: readonly number[],
): ResumoMetricas {
  const porRegra = new Map<string, { total: number; overrides: number }>()
  for (const regra of ORDEM_REGRAS) porRegra.set(regra, { total: 0, overrides: 0 })
  for (const b of bloqueios) {
    const atual = porRegra.get(b.regra) ?? { total: 0, overrides: 0 }
    atual.total += 1
    if (b.houveOverride) atual.overrides += 1
    porRegra.set(b.regra, atual)
  }

  const deflexaoPorRegra: DeflexaoPorRegra[] = ORDEM_REGRAS.map((regra) => {
    const { total, overrides } = porRegra.get(regra)!
    // Deflexão é o OPOSTO do override: quem não abriu chamado apesar do
    // bloqueio é quem a Regra 1/2 conteve de verdade.
    return { regra, totalBloqueios: total, overrides, taxaDeflexaoPct: taxa(total - overrides, total) }
  })

  const totalBloqueios = bloqueios.length
  const totalOverrides = bloqueios.filter((b) => b.houveOverride).length

  const chamadosPorVia: Record<string, number> = {}
  for (const via of vias) chamadosPorVia[via] = (chamadosPorVia[via] ?? 0) + 1

  const totalBuscas = resultadosBuscas.length
  const semResultado = resultadosBuscas.filter((r) => r === 0).length

  return {
    deflexaoPorRegra,
    totalBloqueios,
    totalOverrides,
    taxaOverrideGlobalPct: taxa(totalOverrides, totalBloqueios),
    chamadosPorVia,
    buscas: {
      total: totalBuscas,
      semResultado,
      taxaSemResultadoPct: taxa(semResultado, totalBuscas),
    },
  }
}

/**
 * Lê as três tabelas e delega o cálculo — o único ponto que toca o banco aqui,
 * como `RepositorioInventario` faz para `calcularCusto`. Sem filtro de período:
 * "mínimas" é a palavra-chave (T-095) — desde o dia 1, agregado, sem paginação.
 */
export async function obterResumoMetricas(db: Banco): Promise<ResumoMetricas> {
  const bloqueiosBrutos = await db.query('SELECT regra, houve_override FROM bloqueios', [])
  const bloqueios: LinhaBloqueio[] = linhasComoObjetos<{
    regra: string
    houve_override: number
  }>(bloqueiosBrutos).map((l) => ({ regra: l.regra, houveOverride: l.houve_override === 1 }))

  const viasBrutas = await db.query('SELECT via FROM vinculos', [])
  const vias = linhasComoObjetos<{ via: string }>(viasBrutas).map((l) => l.via)

  const buscasBrutas = await db.query('SELECT resultados FROM buscas', [])
  const resultadosBuscas = linhasComoObjetos<{ resultados: number }>(buscasBrutas).map((l) =>
    Number(l.resultados),
  )

  return calcularMetricas(bloqueios, vias, resultadosBuscas)
}
