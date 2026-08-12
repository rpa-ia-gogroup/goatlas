/**
 * T-513 — a área do solicitante vinda da fonte organizacional.
 *
 * O que estes testes protegem: **fail-open**, a distinção entre "a fonte caiu" e "a pessoa
 * não está lá", e o fallback para `areas_por_email`. Os três se parecem no resultado
 * (chamado aberto, área talvez ausente) e pedem ações opostas de quem administra.
 *
 * _Requirements: RF-19, RNF-18, RF-58, FR-13_
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SqliteLocal } from '@/lib/db/sqlite-local'
import { migrar } from '@/lib/db/schema'
import { AuditoriaBanco } from '@/lib/audit'
import { ClienteTeamGuideFake } from '@/lib/teamguide/fake'
import { TeamGuideIndisponivel, type ClienteTeamGuide } from '@/lib/teamguide/contrato'
import { ClienteTeamGuideHttp, novaCacheTeamGuide } from '@/lib/teamguide/http'
import { resolverArea } from '@/lib/teamguide/area'
import { obterResumoMetricas } from '@/lib/governanca/metricas'

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

/**
 * `D-40` — `erro_de_rede` era o fim da linha.
 *
 * O que estes casos protegem: as **três** causas que aquele rótulo único cobria são
 * distinguíveis, e o timeout é decidido pelo **sinal**, não pelo nome do erro. Nenhum
 * deles afirma sobre a mensagem: o que sai da camada são rótulos (`RNF-01`, `RNF-30`).
 *
 * _Requirements: RF-19, RF-58, RF-59, RNF-01, RNF-30_
 */
describe('D-40 — a falha diz ONDE quebrou, e o timeout é o sinal', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  function clienteQue(fetchImpl: unknown): ClienteTeamGuideHttp {
    return new ClienteTeamGuideHttp({
      token: 'tok',
      fetchImpl: fetchImpl as typeof fetch,
      agoraMs: () => 1000,
      cache: novaCacheTeamGuide(),
    })
  }

  it('🚨 timeout NOSSO é `timeout` mesmo quando o runtime não lança `AbortError`', async () => {
    // 🚨 É o caso que motivou o `D-40`. Abortar uma resposta cuja leitura já começou
    // derruba a conexão, e o que sobe daí é o erro genérico de rede — não `AbortError`.
    // Perguntar `e.name` classificaria o nosso próprio timeout como `erro_de_rede`, ou
    // seja: a hipótese mais provável seria a única que o registro nunca acusaria.
    const cliente = clienteQue(
      (_u: string, init: RequestInit) =>
        new Promise((_ok, falhar) => {
          init.signal?.addEventListener('abort', () =>
            falhar(new TypeError('Network connection lost.')),
          )
        }),
    )

    vi.useFakeTimers()
    const emVoo = cliente.areaDe('ana@gocase.com')
    await vi.advanceTimersByTimeAsync(8000)

    expect(await emVoo).toEqual({
      estado: 'indisponivel',
      motivo: 'timeout',
      fase: 'conexao',
      classe: 'typeerror',
    })
  })

  it('falha ANTES da Response é `conexao`; falha DEPOIS dela é `corpo`', async () => {
    // A distinção que decide o conserto: `conexao` é "não alcancei o host"; `corpo` é
    // "a resposta veio e se desfez no meio" — grande demais, lenta demais ou truncada.
    const semConexao = clienteQue(() => {
      throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } })
    })
    expect(await semConexao.areaDe('ana@gocase.com')).toEqual({
      estado: 'indisponivel',
      motivo: 'erro_de_rede',
      fase: 'conexao',
      // O `cause.code` entra porque é ele que separa "recusado" de "derrubado no meio".
      classe: 'typeerror_econnrefused',
    })

    const corpoQuebrado = clienteQue(async () => ({
      ok: true,
      json: async () => {
        throw new TypeError('Network connection lost.')
      },
    }))
    expect(await corpoQuebrado.areaDe('ana@gocase.com')).toEqual({
      estado: 'indisponivel',
      motivo: 'erro_de_rede',
      fase: 'corpo',
      classe: 'typeerror',
    })
  })

  it('corpo que não é JSON quebra em `corpo`, não em `conexao`', async () => {
    // O caminho real (sem dublê de `Response`): os cabeçalhos chegaram, o corpo não presta.
    const cliente = clienteQue(async () => new Response('<html>erro</html>', { status: 200 }))
    const r = await cliente.areaDe('ana@gocase.com')
    expect(r).toMatchObject({ estado: 'indisponivel', motivo: 'erro_de_rede', fase: 'corpo' })
  })

  it('falha que NÃO veio da nossa chamada é `promessa` — a hipótese da cache entre requisições', async () => {
    // ⚠️ A cache do módulo guarda a **promessa**, não o valor: uma requisição pode acabar
    // esperando a leitura iniciada por **outra**, e a plataforma proíbe I/O entre contextos
    // de requisição. Sem esta fase, esse caso é indistinguível de "o host caiu".
    const cache = novaCacheTeamGuide()
    cache.em = 1000
    cache.promessa = Promise.reject(
      new Error('Cannot perform I/O on behalf of a different request.'),
    )
    cache.promessa.catch(() => {}) // não deixa a rejeição escapar antes da hora

    const cliente = new ClienteTeamGuideHttp({
      token: 'tok',
      fetchImpl: (() => {
        throw new Error('não deveria ir à rede: a promessa cacheada é que falha')
      }) as unknown as typeof fetch,
      agoraMs: () => 1000,
      cache,
    })
    expect(await cliente.areaDe('ana@gocase.com')).toEqual({
      estado: 'indisponivel',
      motivo: 'erro_de_rede',
      fase: 'promessa',
      classe: 'error',
    })
  })

  it('🚨 `classe` é RÓTULO: nunca a mensagem, mesmo quando ela carrega dado de gente', async () => {
    const cliente = clienteQue(() => {
      throw Object.assign(
        new TypeError('falha ao ler ana.silva@gocase.com da base, token Bearer abc123'),
        { cause: { code: 'A'.repeat(200) } },
      )
    })
    const r = await cliente.areaDe('ana@gocase.com')
    const texto = JSON.stringify(r)

    expect(texto).not.toContain('ana.silva@gocase.com')
    expect(texto).not.toContain('abc123')
    // Charset fechado e teto de tamanho: "isto é rótulo, não frase" por construção.
    expect((r as { classe: string }).classe).toMatch(/^[a-z0-9_]+$/)
    expect((r as { classe: string }).classe.length).toBeLessThan(60)
  })

  it('motivo que se explica sozinho NÃO ganha `fase` nem `classe`', async () => {
    // A invariante: os campos novos existem só onde `motivo` não diz nada. Espalhá-los por
    // toda falha encheria a auditoria de ruído e faria o sinal parar de saltar aos olhos.
    const cliente = clienteQue(async () => new Response('x', { status: 401 }))
    expect(await cliente.areaDe('ana@gocase.com')).toEqual({
      estado: 'indisponivel',
      motivo: 'http_401',
    })
  })

  it('a sonda de `RF-59` usa o MESMO caminho e a MESMA cache da abertura de chamado', async () => {
    // ⚠️ Sonda que exercita outro caminho responde sobre o caminho que ninguém usa.
    let leituras = 0
    const cliente = clienteQue(async () => {
      leituras++
      return new Response(JSON.stringify([{ contactEmail: 'ana@gocase.com', teams: ['RPA'] }]), {
        status: 200,
      })
    })
    expect(await cliente.verificarSaude()).toEqual({ ok: true, detalhe: 'ok' })
    await cliente.areaDe('ana@gocase.com')
    expect(leituras).toBe(1)
  })

  it('a sonda relata a falha inteira em uma linha, só com rótulos', async () => {
    const cliente = clienteQue(() => {
      throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } })
    })
    expect(await cliente.verificarSaude()).toEqual({
      ok: false,
      detalhe: 'erro_de_rede · conexao · typeerror_enotfound',
    })
  })
})

describe('D-40 — a auditoria ganha a pista, e continua com DUAS ações', () => {
  /** Dublê mínimo: o `ClienteTeamGuideFake` não encena `fase`/`classe` de propósito. */
  const fonteQueCaiuNoCorpo: ClienteTeamGuide = {
    async areaDe() {
      return { estado: 'indisponivel', motivo: 'erro_de_rede', fase: 'corpo', classe: 'typeerror' }
    },
    async verificarSaude() {
      return { ok: false, detalhe: 'erro_de_rede · corpo · typeerror' }
    },
  }

  it('`fase` e `classe` entram no detalhe de `area_indisponivel`', async () => {
    await resolverArea({
      email: ANA,
      teamguide: fonteQueCaiuNoCorpo,
      areasPorEmail: {},
      auditoria,
    })
    const registro = (await auditoria.listarRecentes(5))[0]!
    expect(registro.acao).toBe('area_indisponivel')
    expect(JSON.parse(registro.detalhe_json!)).toEqual({
      motivo: 'erro_de_rede',
      fase: 'corpo',
      classe: 'typeerror',
      caiuNoMapa: false,
    })
  })

  it('🚨 continuam sendo DUAS ações — a pista não virou uma terceira', async () => {
    await resolverArea({ email: ANA, teamguide: fonteQueCaiuNoCorpo, areasPorEmail: {}, auditoria })
    await resolverArea({
      email: ANA,
      teamguide: new ClienteTeamGuideFake(),
      areasPorEmail: {},
      auditoria,
    })
    expect(new Set(await acoesAuditadas())).toEqual(
      new Set(['area_indisponivel', 'area_nao_encontrada']),
    )
  })

  it('sem `fase`, o detalhe fica exatamente como era — nada de `null` sugerindo incerteza', async () => {
    const fonte = new ClienteTeamGuideFake()
    fonte.falha = 'http_401'
    await resolverArea({ email: ANA, teamguide: fonte, areasPorEmail: { [ANA]: 'X' }, auditoria })
    const registro = (await auditoria.listarRecentes(5))[0]!
    expect(JSON.parse(registro.detalhe_json!)).toEqual({ motivo: 'http_401', caiuNoMapa: true })
  })
})

describe('T-520 — o console relata a área, e SEPARA os dois motivos', () => {
  it('conta com/sem área pelo vínculo e os motivos pela auditoria', async () => {
    // ⚠️ Duas fontes de propósito: o vínculo diz o que **ficou gravado** (incluindo quem
    // caiu no `areas_por_email` depois de a fonte falhar), a auditoria diz **por quê**.
    // Contar só um dos dois esconde metade da informação que decide a ação.
    await db.exec(
      `INSERT INTO vinculos (issue_key, solicitante_email, via, verificado_regras, area, criado_em)
       VALUES ('GN-1', 'ana@gocase.com', 'formulario', 0, 'RPA', '2026-08-11T00:00:00.000Z'),
              ('GN-2', 'bruno@gocase.com', 'formulario', 0, NULL, '2026-08-11T00:00:00.000Z')`,
      [],
    )
    await resolverArea({
      email: 'ninguem@gocase.com',
      teamguide: new ClienteTeamGuideFake(),
      areasPorEmail: {},
      auditoria,
    })
    const fora = new ClienteTeamGuideFake()
    fora.falha = 'http_500'
    await resolverArea({ email: ANA, teamguide: fora, areasPorEmail: {}, auditoria })

    const r = await obterResumoMetricas(db)
    expect(r.area).toEqual({ comArea: 1, semArea: 1, naoEncontrada: 1, indisponivel: 1 })
  })

  it('sem chamado nenhum, os números são zero — a TELA é quem diz "sem dado"', async () => {
    const r = await obterResumoMetricas(db)
    expect(r.area).toEqual({ comArea: 0, semArea: 0, naoEncontrada: 0, indisponivel: 0 })
  })
})
