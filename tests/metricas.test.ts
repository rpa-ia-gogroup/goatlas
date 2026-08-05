/**
 * `governanca/metricas.ts` — funções PURAS (T-095, O1, R-04, RF-42).
 *
 * O ponto que mais importa: taxa sem dado é `null`, nunca `0%` — como `custo.ts`
 * nunca inventa dinheiro sem Q8, aqui a regra nunca "funciona 0%" quando na
 * verdade não há nenhum bloqueio ou busca para medir.
 *
 * _Requirements: O1, R-04, RF-42_
 */

import { describe, expect, it } from 'vitest'
import { calcularMetricas, type LinhaBloqueio } from '@/lib/governanca/metricas'

function bloqueio(over: Partial<LinhaBloqueio> = {}): LinhaBloqueio {
  return { regra: 'regra1_confluence', houveOverride: false, ...over }
}

describe('T-095 — deflexão por regra nunca mostra 0% por falta de dado', () => {
  it('sem nenhum bloqueio: as duas regras vêm com taxa null, não 0%', () => {
    const r = calcularMetricas([], [], [])
    expect(r.deflexaoPorRegra).toEqual([
      { regra: 'regra1_confluence', totalBloqueios: 0, overrides: 0, taxaDeflexaoPct: null },
      {
        regra: 'regra2_ajuste_operacional',
        totalBloqueios: 0,
        overrides: 0,
        taxaDeflexaoPct: null,
      },
    ])
    expect(r.taxaOverrideGlobalPct).toBeNull()
  })

  it('3 bloqueios da Regra 1, 1 override: 2 de 3 deflexão = 66.7%', () => {
    const r = calcularMetricas(
      [
        bloqueio({ regra: 'regra1_confluence', houveOverride: false }),
        bloqueio({ regra: 'regra1_confluence', houveOverride: false }),
        bloqueio({ regra: 'regra1_confluence', houveOverride: true }),
      ],
      [],
      [],
    )
    const regra1 = r.deflexaoPorRegra.find((d) => d.regra === 'regra1_confluence')!
    expect(regra1.totalBloqueios).toBe(3)
    expect(regra1.overrides).toBe(1)
    expect(regra1.taxaDeflexaoPct).toBeCloseTo((2 / 3) * 100, 5)
  })

  it('override em 100% dos bloqueios: deflexão 0% (aí sim, calculada, não ausente)', () => {
    const r = calcularMetricas(
      [bloqueio({ houveOverride: true }), bloqueio({ houveOverride: true })],
      [],
      [],
    )
    expect(r.deflexaoPorRegra.find((d) => d.regra === 'regra1_confluence')!.taxaDeflexaoPct).toBe(
      0,
    )
  })

  it('as duas regras contam separado, sem misturar', () => {
    const r = calcularMetricas(
      [
        bloqueio({ regra: 'regra1_confluence', houveOverride: false }),
        bloqueio({ regra: 'regra2_ajuste_operacional', houveOverride: true }),
      ],
      [],
      [],
    )
    expect(r.deflexaoPorRegra.find((d) => d.regra === 'regra1_confluence')).toMatchObject({
      totalBloqueios: 1,
      overrides: 0,
    })
    expect(r.deflexaoPorRegra.find((d) => d.regra === 'regra2_ajuste_operacional')).toMatchObject({
      totalBloqueios: 1,
      overrides: 1,
    })
  })
})

describe('T-095 — taxa de override global', () => {
  it('agrega as duas regras juntas', () => {
    const r = calcularMetricas(
      [
        bloqueio({ regra: 'regra1_confluence', houveOverride: true }),
        bloqueio({ regra: 'regra1_confluence', houveOverride: false }),
        bloqueio({ regra: 'regra2_ajuste_operacional', houveOverride: false }),
        bloqueio({ regra: 'regra2_ajuste_operacional', houveOverride: false }),
      ],
      [],
      [],
    )
    expect(r.totalBloqueios).toBe(4)
    expect(r.totalOverrides).toBe(1)
    expect(r.taxaOverrideGlobalPct).toBeCloseTo(25, 5)
  })
})

describe('T-095 — chamados por via', () => {
  it('conta cada via separadamente', () => {
    const r = calcularMetricas([], ['conversa', 'conversa', 'formulario'], [])
    expect(r.chamadosPorVia).toEqual({ conversa: 2, formulario: 1 })
  })

  it('sem nenhum vínculo ainda: objeto vazio, não zeros inventados', () => {
    const r = calcularMetricas([], [], [])
    expect(r.chamadosPorVia).toEqual({})
  })
})

describe('T-095 — buscas sem resultado', () => {
  it('conta quantas tiveram resultados = 0, com taxa', () => {
    const r = calcularMetricas([], [], [0, 0, 3, 5])
    expect(r.buscas).toEqual({ total: 4, semResultado: 2, taxaSemResultadoPct: 50 })
  })

  it('sem nenhuma busca ainda: null, não 0%', () => {
    const r = calcularMetricas([], [], [])
    expect(r.buscas).toEqual({ total: 0, semResultado: 0, taxaSemResultadoPct: null })
  })

  it('todas com resultado: 0% sem resultado, calculado de verdade', () => {
    const r = calcularMetricas([], [], [1, 2, 3])
    expect(r.buscas.taxaSemResultadoPct).toBe(0)
  })
})
