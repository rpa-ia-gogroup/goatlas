/**
 * T-120 a T-124 — a governança de assentos contra o FAKE da Organizations API.
 *
 * A credencial de Org Admin é Q1 e ainda não existe: tudo aqui roda contra
 * `ClienteOrganizacaoFake`, exatamente o raciocínio que já vale para Jira/Confluence
 * desde a Fase 1 (`RNF-22`) — a camada isolada é o que torna possível construir e
 * testar o console inteiro antes da credencial chegar.
 *
 * _Requirements: RF-51, RF-52, RNF-04, RNF-18_
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { SqliteLocal } from '@/lib/db/sqlite-local'
import { migrar } from '@/lib/db/schema'
import { Config } from '@/lib/config'
import { montarContexto, type Contexto } from '@/lib/contexto'
import { tratarRequisicao } from '@/lib/http/rotas'
import { HEADER_EMAIL } from '@/lib/auth'
import { ClienteOrganizacaoFake } from '@/lib/atlassian/organizacao-fake'
import { linhasComoObjetos } from '@/lib/db/tipos'

const CHEFE = 'chefe@gocase.com'
const AGORA = '2026-08-05T12:00:00.000Z'
const CRON_KEY = 'chave-cron-secreta'

let db: SqliteLocal
let ctx: Contexto
let org: ClienteOrganizacaoFake
let n = 0

beforeEach(async () => {
  db = new SqliteLocal()
  await migrar(db)
  n = 0
  const config = new Config(db)
  await config.definir('dominios_permitidos', ['gocase.com'], CHEFE, AGORA)
  await config.definir('admins', [CHEFE], CHEFE, AGORA)
  await config.definir('org_id', 'org-1', CHEFE, AGORA)
  ctx = await montarContexto(
    { DB: db, ATLAS_USAR_FAKES: '1' },
    () => AGORA,
    () => `id-${++n}`,
  )
  org = ctx.organizacao as ClienteOrganizacaoFake
  org.estado.usuarios = [
    {
      accountId: 'acc-1',
      email: 'ana@gocase.com',
      nome: 'Ana',
      produtos: [{ chave: 'confluence', nome: 'Confluence' }],
    },
    {
      accountId: 'acc-2',
      email: 'bruno@gocase.com',
      nome: 'Bruno',
      produtos: [{ chave: 'jira-servicedesk', nome: 'Jira Service Management' }],
    },
  ]
  org.estado.ultimoAcesso.set('acc-1', [
    { produto: 'confluence', ultimoAcessoEm: '2026-08-04T00:00:00.000Z' },
  ])
  // Bruno nunca acessou — entrada ausente de propósito.
})

function req(
  caminho: string,
  opcoes: { metodo?: string; email?: string; headers?: Record<string, string> } = {},
): Request {
  const headers: Record<string, string> = { ...opcoes.headers }
  if (opcoes.email) headers[HEADER_EMAIL] = opcoes.email
  return new Request(`https://atlas.devgogroup.com${caminho}`, {
    method: opcoes.metodo ?? 'GET',
    headers,
  })
}

const chamar = (r: Request) => tratarRequisicao(r, ctx, { GODEPLOY_CRON_KEY: CRON_KEY })
const coletar = () =>
  chamar(
    req('/api/cron/coletar-inventario', {
      metodo: 'POST',
      headers: { 'x-godeploy-cron': CRON_KEY },
    }),
  )
const assentos = () => chamar(req('/api/admin/assentos', { email: CHEFE }))

describe('T-124 — cron de coleta grava no cache histórico', () => {
  it('coleta os dois usuários com seus produtos e último acesso', async () => {
    const r = await coletar()
    expect(r.status).toBe(200)
    const corpo = await r.json()
    expect(corpo.ok).toBe(true)
    expect(corpo.registros).toBe(2) // 1 produto cada

    const linhas = linhasComoObjetos<Record<string, unknown>>(
      await db.query('SELECT * FROM inventario_assentos ORDER BY email', []),
    )
    expect(linhas).toHaveLength(2)
    expect(linhas[0]?.email).toBe('ana@gocase.com')
    expect(linhas[0]?.ultimo_acesso_em).toBe('2026-08-04T00:00:00.000Z')
    expect(linhas[1]?.email).toBe('bruno@gocase.com')
    expect(linhas[1]?.ultimo_acesso_em).toBeNull()
  })

  it('RNF-18 — `ultimoAcesso` fora do ar não derruba a coleta inteira', async () => {
    org.estado.falhas.ultimoAcesso = 'indisponivel'
    const r = await coletar()
    expect(r.status).toBe(200)
    expect((await r.json()).registros).toBe(2)
    const linhas = linhasComoObjetos<Record<string, unknown>>(
      await db.query('SELECT ultimo_acesso_em FROM inventario_assentos', []),
    )
    expect(linhas.every((l) => l.ultimo_acesso_em === null)).toBe(true)
  })

  it('`listarUsuarios` fora do ar: 503, e a falha fica auditada', async () => {
    org.estado.falhas.listarUsuarios = 'indisponivel'
    const r = await coletar()
    expect(r.status).toBe(503)
    const auditado = linhasComoObjetos<Record<string, unknown>>(
      await db.query(
        `SELECT resultado FROM auditoria WHERE acao = 'inventario_coletado'`,
        [],
      ),
    )
    expect(auditado[0]?.resultado).toBe('falha')
  })

  it('sem organização configurada, a coleta se declara indisponível SEM erro', async () => {
    // Token de Jira/Confluence presente (para sair do modo fake), mas SEM
    // `ATLASSIAN_ORG_API_KEY`: não existe `ClienteOrganizacaoHttp` ainda (Q1), então
    // fora dos fakes a governança é sempre `null`, nunca um erro de boot.
    const semOrg = await montarContexto(
      {
        DB: db,
        ATLASSIAN_API_TOKEN: 'token',
        ATLASSIAN_EMAIL: 'servico@gocase.com',
        ATLASSIAN_BASE_URL: 'https://goengenharia.atlassian.net',
      },
      () => AGORA,
      () => `id-${++n}`,
    )
    expect(semOrg.organizacao).toBeNull()
    const r = await tratarRequisicao(
      req('/api/cron/coletar-inventario', {
        metodo: 'POST',
        headers: { 'x-godeploy-cron': CRON_KEY },
      }),
      semOrg,
      { GODEPLOY_CRON_KEY: CRON_KEY },
    )
    expect(r.status).toBe(200)
    expect((await r.json()).motivo).toBe('organizacao_nao_configurada')
  })
})

describe('RF-51/RF-52 — GET /api/admin/assentos lê o cache, não a API ao vivo', () => {
  it('sem coleta ainda, responde vazio com `coletadoEm: null` — não erro', async () => {
    const r = await assentos()
    expect(r.status).toBe(200)
    const corpo = await r.json()
    expect(corpo.coletadoEm).toBeNull()
    expect(corpo.itens).toEqual([])
  })

  it('depois da coleta, devolve os itens e as chamadas contam nas `chamadas` do fake', async () => {
    await coletar()
    const corpo = await (await assentos()).json()
    expect(corpo.coletadoEm).toBe(AGORA)
    expect(corpo.itens).toHaveLength(2)
  })

  it('RF-52 — a limitação oficial do dado vai NO PAYLOAD, não só em documentação', async () => {
    const corpo = await (await assentos()).json()
    expect(corpo.limitacoesUltimoAcesso.atrasoMaximoHoras).toBe(24)
    expect(corpo.limitacoesUltimoAcesso.criterioAtivo).toMatch(/2 segundos/)
  })

  it('duas coletas seguidas: a leitura pega SÓ a mais recente', async () => {
    await coletar()
    org.estado.usuarios = [
      {
        accountId: 'acc-3',
        email: 'carla@gocase.com',
        nome: 'Carla',
        produtos: [{ chave: 'confluence', nome: 'Confluence' }],
      },
    ]
    ctx = await montarContexto(
      { DB: db, ATLAS_USAR_FAKES: '1' },
      () => '2026-08-06T12:00:00.000Z',
      () => `id-${++n}`,
      { organizacao: org },
    )
    await coletar()
    const corpo = await (await assentos()).json()
    expect(corpo.coletadoEm).toBe('2026-08-06T12:00:00.000Z')
    expect(corpo.itens).toHaveLength(1)
    expect(corpo.itens[0].email).toBe('carla@gocase.com')
  })
})

describe('RF-54 — GET /api/admin/assentos/recomendacoes', () => {
  it('Bruno (só service desk, nunca acessou) entra como rebaixar_para_customer', async () => {
    await coletar()
    const corpo = await (await chamar(req('/api/admin/assentos/recomendacoes', { email: CHEFE }))).json()
    expect(corpo.itens.some((i: { email: string; tipo: string }) =>
      i.email === 'bruno@gocase.com' && i.tipo === 'rebaixar_para_customer',
    )).toBe(true)
  })

  it('?formato=csv devolve texto CSV com Content-Type próprio', async () => {
    await coletar()
    const r = await chamar(
      req('/api/admin/assentos/recomendacoes?formato=csv', { email: CHEFE }),
    )
    expect(r.headers.get('Content-Type')).toMatch(/text\/csv/)
    const texto = await r.text()
    expect(texto).toContain('bruno@gocase.com')
  })
})
