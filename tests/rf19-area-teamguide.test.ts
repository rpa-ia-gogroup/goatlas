/**
 * T-513 — a área do solicitante vinda da fonte organizacional.
 *
 * O que estes testes protegem: **fail-open**, a distinção entre "a fonte caiu" e "a pessoa
 * não está lá", e o fallback para `areas_por_email`. Os três se parecem no resultado
 * (chamado aberto, área talvez ausente) e pedem ações opostas de quem administra.
 *
 * _Requirements: RF-19, RNF-18, RF-58, FR-13_
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { SqliteLocal } from '@/lib/db/sqlite-local'
import { migrar } from '@/lib/db/schema'
import { AuditoriaBanco } from '@/lib/audit'
import { ClienteTeamGuideFake } from '@/lib/teamguide/fake'
import { TeamGuideIndisponivel } from '@/lib/teamguide/contrato'
import { ClienteTeamGuideHttp, novaCacheTeamGuide } from '@/lib/teamguide/http'
import { resolverArea } from '@/lib/teamguide/area'

const ANA = 'ana@gocase.com'
let db: SqliteLocal
let auditoria: AuditoriaBanco
let n = 0

beforeEach(async () => {
  db = new SqliteLocal()
  await migrar(db)
  auditoria = new AuditoriaBanco(db, () => '2026-08-11T00:00:00.000Z', () => `id-${++n}`)
})

async function acoesAuditadas(): Promise<string[]> {
  return (await auditoria.listarRecentes(20)).map((r) => r.acao)
}

describe('resolverArea', () => {
  it('a fonte viva vence o mapa de configuração', async () => {
    const teamguide = new ClienteTeamGuideFake({ [ANA]: 'RPA' })
    const area = await resolverArea({
      email: ANA,
      teamguide,
      areasPorEmail: { [ANA]: 'Área antiga da planilha' },
      auditoria,
    })
    expect(area).toBe('RPA')
    expect(await acoesAuditadas()).toEqual([])
  })

  it('fonte fora do ar: chamado segue, área cai no mapa, e o motivo é auditado', async () => {
    const teamguide = new ClienteTeamGuideFake()
    teamguide.falha = 'http_500'
    const area = await resolverArea({
      email: ANA,
      teamguide,
      areasPorEmail: { [ANA]: 'Suporte' },
      auditoria,
    })
    expect(area).toBe('Suporte')
    expect(await acoesAuditadas()).toContain('area_indisponivel')
  })

  it('pessoa desconhecida na fonte é evento DIFERENTE de fonte fora do ar', async () => {
    // Os dois deixam a pessoa sem área; um é trabalho de cadastro, o outro é plantão.
    const area = await resolverArea({
      email: ANA,
      teamguide: new ClienteTeamGuideFake(),
      areasPorEmail: {},
      auditoria,
    })
    expect(area).toBeNull()
    expect(await acoesAuditadas()).toContain('area_nao_encontrada')
  })

  it('sem cliente configurado, o comportamento é exatamente o de antes', async () => {
    // `FR-13`: instalação sem a credencial nova não pode mudar de comportamento.
    const area = await resolverArea({
      email: ANA,
      teamguide: null,
      areasPorEmail: { [ANA]: 'Suporte' },
      auditoria,
    })
    expect(area).toBe('Suporte')
    expect(await acoesAuditadas()).toEqual([])
  })

  it('`TeamGuideIndisponivel` não simula: responde indisponível e é auditado', async () => {
    const area = await resolverArea({
      email: ANA,
      teamguide: new TeamGuideIndisponivel(),
      areasPorEmail: {},
      auditoria,
    })
    expect(area).toBeNull()
    expect(await acoesAuditadas()).toContain('area_indisponivel')
  })
})

describe('ClienteTeamGuideHttp', () => {
  const BASE_OK = [
    { contactEmail: 'ana@gocase.com', teams: ['RPA'], position: 'Analista' },
    { contactEmail: 'BRUNO@GOCASE.COM', teams: ['Suporte'] },
    { contactEmail: '', teams: ['Fantasma'] },
    { contactEmail: 'sem.time@gocase.com', teams: [] },
  ]

  function clienteCom(resposta: () => Response, agoraMs = () => 1000) {
    let chamadas = 0
    const fetchImpl = (async () => {
      chamadas++
      return resposta()
    }) as unknown as typeof fetch
    const cliente = new ClienteTeamGuideHttp({
      token: 'tok',
      fetchImpl,
      agoraMs,
      cache: novaCacheTeamGuide(),
    })
    return { cliente, chamadas: () => chamadas }
  }

  it('resolve pelo e-mail, sem diferenciar caixa', async () => {
    const { cliente } = clienteCom(() => new Response(JSON.stringify(BASE_OK), { status: 200 }))
    expect(await cliente.areaDe('ana@gocase.com')).toEqual({ estado: 'encontrada', area: 'RPA' })
    expect(await cliente.areaDe('bruno@gocase.com')).toEqual({
      estado: 'encontrada',
      area: 'Suporte',
    })
  })

  it('pessoa sem time não vira área vazia', async () => {
    const { cliente } = clienteCom(() => new Response(JSON.stringify(BASE_OK), { status: 200 }))
    expect(await cliente.areaDe('sem.time@gocase.com')).toEqual({ estado: 'nao_encontrada' })
  })

  it('a base é lida UMA vez por isolate — não uma por chamado (RNF-36)', async () => {
    const { cliente, chamadas } = clienteCom(
      () => new Response(JSON.stringify(BASE_OK), { status: 200 }),
    )
    await cliente.areaDe('ana@gocase.com')
    await cliente.areaDe('bruno@gocase.com')
    await cliente.areaDe('ana@gocase.com')
    expect(chamadas()).toBe(1)
  })

  it('a cache VENCE — isolate quente não serve retrato velho para sempre', async () => {
    let agora = 1000
    const { cliente, chamadas } = clienteCom(
      () => new Response(JSON.stringify(BASE_OK), { status: 200 }),
      () => agora,
    )
    await cliente.areaDe('ana@gocase.com')
    agora += 11 * 60 * 1000
    await cliente.areaDe('ana@gocase.com')
    expect(chamadas()).toBe(2)
  })

  it('HTTP de erro devolve `indisponivel` com rótulo, e NUNCA lança', async () => {
    const { cliente } = clienteCom(
      () => new Response('segredo-interno-que-nao-pode-vazar', { status: 401 }),
    )
    const r = await cliente.areaDe('ana@gocase.com')
    expect(r).toEqual({ estado: 'indisponivel', motivo: 'http_401' })
    expect(JSON.stringify(r)).not.toContain('segredo-interno')
  })

  it('falha NÃO fica memoizada — a tentativa seguinte volta a ir à rede', async () => {
    // Uma falha cacheada condenaria o isolate a responder `indisponivel` até morrer.
    let falhar = true
    let chamadas = 0
    const fetchImpl = (async () => {
      chamadas++
      return falhar
        ? new Response('x', { status: 500 })
        : new Response(JSON.stringify(BASE_OK), { status: 200 })
    }) as unknown as typeof fetch
    const cliente = new ClienteTeamGuideHttp({ token: 'tok', fetchImpl, agoraMs: () => 1000 })
    expect((await cliente.areaDe('ana@gocase.com')).estado).toBe('indisponivel')
    falhar = false
    expect(await cliente.areaDe('ana@gocase.com')).toEqual({ estado: 'encontrada', area: 'RPA' })
    expect(chamadas).toBe(2)
  })

  it('resposta em formato inesperado é indisponibilidade, não exceção', async () => {
    const { cliente } = clienteCom(() => new Response('{"data":[]}', { status: 200 }))
    expect(await cliente.areaDe('ana@gocase.com')).toEqual({
      estado: 'indisponivel',
      motivo: 'formato_inesperado',
    })
  })
})
