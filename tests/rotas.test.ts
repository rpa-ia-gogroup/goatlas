/**
 * As rotas HTTP — onde as travas são atacadas do lado de fora, como um atacante
 * faria: sem passar pelo modelo, sem passar pela UI, direto no endpoint.
 *
 * _Requirements: RF-01, RF-04, RF-05, RF-08, RF-13, RF-17, RF-24, RF-28, RF-29,
 * RF-30, RF-32, RF-59, RN-01, RN-02, RN-04, RNF-05, RNF-11, RNF-17, RNF-30_
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { SqliteLocal } from '@/lib/db/sqlite-local'
import { migrar } from '@/lib/db/schema'
import { Config } from '@/lib/config'
import { montarContexto, type Contexto } from '@/lib/contexto'
import { tratarRequisicao } from '@/lib/http/rotas'
import { HEADER_EMAIL } from '@/lib/auth'
import { ClienteAtlassianFake } from '@/lib/atlassian/fake'
import { ClienteTeamGuideFake } from '@/lib/teamguide/fake'

const ANA = 'ana@gocase.com'
const BRUNO = 'bruno@gocase.com'
const CHEFE = 'chefe@gocase.com'
const AGORA = '2026-08-03T12:00:00.000Z'
const CRON_KEY = 'chave-cron-secreta'

let db: SqliteLocal
let ctx: Contexto
let n = 0

beforeEach(async () => {
  db = new SqliteLocal()
  await migrar(db)
  n = 0
  ctx = await montarContexto(
    { DB: db, GOATLAS_USAR_FAKES: '1' },
    () => AGORA,
    () => `id-${++n}`,
  )
  const config = new Config(db)
  await config.definir('dominios_permitidos', ['gocase.com'], CHEFE, AGORA)
  await config.definir('admins', [CHEFE], CHEFE, AGORA)
  await config.definir('tipos_chamado_permitidos', ['rt-1'], CHEFE, AGORA)
  await config.definir('service_desk_id', 'sd-1', CHEFE, AGORA)
  // Recarrega o contexto para pegar a config nova (ele lê uma vez no boot).
  ctx = await montarContexto(
    { DB: db, GOATLAS_USAR_FAKES: '1' },
    () => AGORA,
    () => `id-${++n}`,
  )
})

function req(
  caminho: string,
  opcoes: { metodo?: string; email?: string; corpo?: unknown; headers?: Record<string, string> } = {},
): Request {
  const headers: Record<string, string> = { ...opcoes.headers }
  if (opcoes.email) headers[HEADER_EMAIL] = opcoes.email
  return new Request(`https://goatlas.devgogroup.com${caminho}`, {
    method: opcoes.metodo ?? 'GET',
    headers,
    ...(opcoes.corpo === undefined ? {} : { body: JSON.stringify(opcoes.corpo) }),
  })
}

const chamar = (r: Request) => tratarRequisicao(r, ctx, { GODEPLOY_CRON_KEY: CRON_KEY })

const PROPOSTA = {
  titulo: 'Pipeline de vendas falhou',
  descricao: 'O pipeline diário não gerou os dados de ontem.',
  tipoChamadoId: 'rt-1',
  prioridade: 'alta',
}

describe('RF-01 / RF-05 — nenhuma rota de dados responde sem identidade válida', () => {
  it('sem header do edge: 403 em rota de dados', async () => {
    const r = await chamar(req('/api/chamados'))
    expect(r.status).toBe(403)
    const corpo = await r.json()
    // RNF-30: linguagem de negócio, sem stack trace nem código HTTP na mensagem.
    expect(corpo.erro).toMatch(/conta/i)
    expect(JSON.stringify(corpo)).not.toMatch(/\bstack\b|Error:/)
  })

  it('domínio de fora: 403', async () => {
    expect((await chamar(req('/api/chamados', { email: 'x@gmail.com' }))).status).toBe(403)
  })

  it('o acesso negado é auditado, com o e-mail tentado', async () => {
    await chamar(req('/api/chamados', { email: 'x@gmail.com' }))
    const r = await db.query(
      `SELECT ator_email, acao, resultado FROM auditoria WHERE acao = 'acesso_negado'`,
      [],
    )
    expect(r.rows).toHaveLength(1)
    expect(r.rows[0]).toContain('x@gmail.com')
  })

  it('health check responde SEM identidade — é para isso que ele serve', async () => {
    const r = await chamar(req('/api/health'))
    expect([200, 503]).toContain(r.status)
    const corpo = await r.json()
    expect(corpo.dependencias).toHaveProperty('atlassian')
    expect(corpo.dependencias).toHaveProperty('ia')
    expect(corpo.dependencias).toHaveProperty('banco')
    expect(corpo.dependencias).toHaveProperty('sso')
    // `D-40` — a fonte organizacional entra aqui para que medi-la não custe abrir um
    // chamado numa fila real.
    expect(corpo.dependencias).toHaveProperty('teamguide')
  })

  it('🚨 fonte organizacional no chão NÃO derruba o health — ela é fail-open (D-37)', async () => {
    // Com a fonte caída os chamados continuam abrindo (`RNF-18`): um 503 aqui diria "o app
    // caiu" sobre um app inteiro de pé, e ensinaria o time a ignorar o health check.
    ;(ctx.teamguide as ClienteTeamGuideFake).falha = 'erro_de_rede · conexao · typeerror'
    const r = await chamar(req('/api/health'))
    expect(r.status).toBe(200)
    const corpo = await r.json()
    expect(corpo.ok).toBe(true)
    expect(corpo.dependencias.teamguide).toEqual({
      ok: false,
      detalhe: 'erro_de_rede · conexao · typeerror',
    })
  })
})

describe('RF-04 / RNF-05 — e-mail do corpo não substitui o do edge', () => {
  it('BURLA — corpo tenta abrir chamado como outra pessoa', async () => {
    const r = await chamar(
      req('/api/chamados', {
        metodo: 'POST',
        email: ANA,
        corpo: { ...PROPOSTA, solicitanteEmail: BRUNO, email: BRUNO, chaveIdempotencia: 'k1' },
      }),
    )
    expect(r.status).toBe(201)
    // O vínculo é da Ana, não do Bruno.
    expect(await ctx.vinculos.listarDoSolicitante(BRUNO, 10)).toHaveLength(0)
    expect(await ctx.vinculos.listarDoSolicitante(ANA, 10)).toHaveLength(1)
  })
})

describe('RF-08 / RF-17 — não existe rota que crie chamado sem passar pelo gate', () => {
  it('BURLA — confirmar sem as tools terem rodado: 409, e nada criado', async () => {
    const criada = await chamar(req('/api/conversas', { metodo: 'POST', email: ANA }))
    const { id } = await criada.json()

    // Monta a proposta e confirma direto, pulando a conversa inteira.
    await chamar(req(`/api/conversas/${id}/proposta`, { metodo: 'PUT', email: ANA, corpo: PROPOSTA }))
    const r = await chamar(req(`/api/conversas/${id}/confirmar`, { metodo: 'POST', email: ANA }))

    expect(r.status).toBe(409)
    const corpo = await r.json()
    expect(corpo.erro).toMatch(/verificar antes/i)
    const criacoes = (ctx.atlassian as ClienteAtlassianFake).chamadas.filter(
      (c) => c.operacao === 'criarChamado',
    )
    expect(criacoes).toHaveLength(0)
  })

  it('BURLA — confirmar conversa de OUTRA pessoa: 404', async () => {
    const criada = await chamar(req('/api/conversas', { metodo: 'POST', email: ANA }))
    const { id } = await criada.json()
    const r = await chamar(req(`/api/conversas/${id}/confirmar`, { metodo: 'POST', email: BRUNO }))
    expect(r.status).toBe(404)
  })

  it('confirmar sem proposta montada não passa', async () => {
    const criada = await chamar(req('/api/conversas', { metodo: 'POST', email: ANA }))
    const { id } = await criada.json()
    const r = await chamar(req(`/api/conversas/${id}/confirmar`, { metodo: 'POST', email: ANA }))
    expect(r.status).toBe(400)
  })
})

describe('RF-28 — só tipo de chamado da allowlist é aceito', () => {
  it('BURLA — tipo que existe no Jira mas não está liberado: recusado', async () => {
    const r = await chamar(
      req('/api/chamados', {
        metodo: 'POST',
        email: ANA,
        corpo: { ...PROPOSTA, tipoChamadoId: 'rt-999-fila-do-financeiro' },
      }),
    )
    expect(r.status).toBe(400)
    expect((await r.json()).erro).toMatch(/tipo de chamado da lista/i)
  })

  it('a listagem de tipos filtra pela allowlist (nada exposto por padrão)', async () => {
    const fake = ctx.atlassian as ClienteAtlassianFake
    fake.estado.tiposChamado = [
      { id: 'rt-1', serviceDeskId: 'sd-1', nome: 'Suporte', descricao: null },
      { id: 'rt-2', serviceDeskId: 'sd-1', nome: 'Fila interna', descricao: null },
    ]
    const r = await chamar(req('/api/tipos-chamado', { email: ANA }))
    expect((await r.json()).itens.map((t: { id: string }) => t.id)).toEqual(['rt-1'])
  })
})

describe('RF-30 / RN-04 — isolamento pela rota', () => {
  async function abrirComoAna(chave = 'k1') {
    const r = await chamar(
      req('/api/chamados', {
        metodo: 'POST',
        email: ANA,
        corpo: { ...PROPOSTA, chaveIdempotencia: chave },
      }),
    )
    return (await r.json()).issueKey as string
  }

  it('BURLA — detalhe de chamado alheio: 404, não 403', async () => {
    const issueKey = await abrirComoAna()
    const r = await chamar(req(`/api/chamados/${issueKey}`, { email: BRUNO }))
    // 404 de propósito: 403 diria "existe, mas não é seu" — informação sobre o
    // chamado de outra pessoa.
    expect(r.status).toBe(404)
  })

  it('BURLA — comentar em chamado alheio: 404 e nada é escrito', async () => {
    const issueKey = await abrirComoAna()
    const r = await chamar(
      req(`/api/chamados/${issueKey}/comentarios`, {
        metodo: 'POST',
        email: BRUNO,
        corpo: { texto: 'oi' },
      }),
    )
    expect(r.status).toBe(404)
    const fake = ctx.atlassian as ClienteAtlassianFake
    expect(fake.chamadas.filter((c) => c.operacao === 'comentar')).toHaveLength(0)
  })

  it('RF-33 / D-13 — o comentário público leva o nome real, capturado no login', async () => {
    const issueKey = await abrirComoAna()
    const r = await chamar(
      req(`/api/chamados/${issueKey}/comentarios`, {
        metodo: 'POST',
        email: ANA,
        corpo: { texto: 'O relatório não atualizou.' },
      }),
    )
    expect(r.status).toBe(201)
    const fake = ctx.atlassian as ClienteAtlassianFake
    const chamada = fake.chamadas.find((c) => c.operacao === 'comentar')
    // "Ana" vem de derivarNomeDeEmail(ana@gocase.com) — o header de nome do edge
    // não foi enviado nesta requisição, e é assim que o cliente é atribuído mesmo
    // sem o edge fornecer nome (D-02/T-021).
    expect(chamada?.params).toMatchObject({ autorEmail: ANA, autorNome: 'Ana' })
  })

  it('"Meus chamados" só devolve os do e-mail da sessão', async () => {
    await abrirComoAna('k1')
    await abrirComoAna('k2')
    await chamar(
      req('/api/chamados', {
        metodo: 'POST',
        email: BRUNO,
        corpo: { ...PROPOSTA, chaveIdempotencia: 'k3' },
      }),
    )
    const daAna = await (await chamar(req('/api/chamados', { email: ANA }))).json()
    const doBruno = await (await chamar(req('/api/chamados', { email: BRUNO }))).json()
    expect(daAna.itens).toHaveLength(2)
    expect(doBruno.itens).toHaveLength(1)
  })

  it('RF-32 — o detalhe nunca traz comentário interno', async () => {
    const issueKey = await abrirComoAna()
    const fake = ctx.atlassian as ClienteAtlassianFake
    fake.estado.comentarios.set(issueKey, [
      { id: '1', corpo: 'Estamos verificando.', autorNome: 'Tech', criadoEm: AGORA, publico: true },
      { id: '2', corpo: 'INTERNO: empurrar pra próxima sprint', autorNome: 'Tech', criadoEm: AGORA, publico: false },
    ])
    const corpo = await (await chamar(req(`/api/chamados/${issueKey}`, { email: ANA }))).json()
    expect(corpo.comentarios).toHaveLength(1)
    expect(JSON.stringify(corpo)).not.toContain('INTERNO')
  })
})

describe('RF-24 — idempotência pela rota', () => {
  it('a mesma chave enviada duas vezes gera UM chamado', async () => {
    const corpo = { ...PROPOSTA, chaveIdempotencia: 'duplo-clique' }
    const a = await (await chamar(req('/api/chamados', { metodo: 'POST', email: ANA, corpo }))).json()
    const b = await (await chamar(req('/api/chamados', { metodo: 'POST', email: ANA, corpo }))).json()
    expect(b.issueKey).toBe(a.issueKey)
    expect(b.duplicada).toBe(true)
  })

  it('a chave de idempotência é ESCOPADA por usuário', async () => {
    // Sem escopo, o Bruno reusando "k1" receberia o chamado da Ana.
    const corpo = { ...PROPOSTA, chaveIdempotencia: 'mesma-chave' }
    const daAna = await (await chamar(req('/api/chamados', { metodo: 'POST', email: ANA, corpo }))).json()
    const doBruno = await (await chamar(req('/api/chamados', { metodo: 'POST', email: BRUNO, corpo }))).json()
    expect(doBruno.issueKey).not.toBe(daAna.issueKey)
    expect(doBruno.duplicada).toBe(false)
  })
})

describe('D-04 / RN-08 — a resposta de criação diz o que precisa dizer', () => {
  it('traz chave, prioridade e SLA de PRIMEIRA RESPOSTA', async () => {
    const r = await chamar(
      req('/api/chamados', { metodo: 'POST', email: ANA, corpo: { ...PROPOSTA, chaveIdempotencia: 'k' } }),
    )
    const corpo = await r.json()
    expect(corpo.issueKey).toBeTruthy()
    expect(corpo.prioridade).toBe('alta')
    expect(corpo.slaPrimeiraRespostaHoras).toBe(12)
    // O formulário nasce como não verificado pelas regras.
    expect(corpo.verificadoRegras).toBe(false)
  })
})

describe('RF-13 — override pela rota', () => {
  it('exige motivo — é ele que alimenta o backlog de documentação', async () => {
    const criada = await chamar(req('/api/conversas', { metodo: 'POST', email: ANA }))
    const { id } = await criada.json()
    const r = await chamar(
      req(`/api/conversas/${id}/override`, { metodo: 'POST', email: ANA, corpo: { motivo: '  ' } }),
    )
    expect(r.status).toBe(400)
    expect((await r.json()).erro).toMatch(/não resolveu/i)
  })

  it('com motivo, registra e libera', async () => {
    const criada = await chamar(req('/api/conversas', { metodo: 'POST', email: ANA }))
    const { id } = await criada.json()
    const r = await chamar(
      req(`/api/conversas/${id}/override`, {
        metodo: 'POST',
        email: ANA,
        corpo: { motivo: 'a página fala de outro cenário' },
      }),
    )
    expect(r.status).toBe(200)
    const auditados = await db.query(
      `SELECT acao FROM auditoria WHERE acao = 'override_registrado'`,
      [],
    )
    expect(auditados.rows).toHaveLength(1)
  })
})

describe('RNF-11 — rate limit por usuário', () => {
  it('estourado o limite, POST é recusado com mensagem de negócio', async () => {
    const config = new Config(db)
    await config.definir('limite_requisicoes_por_minuto', 2, CHEFE, AGORA)
    ctx = await montarContexto({ DB: db, GOATLAS_USAR_FAKES: '1' }, () => AGORA, () => `id-${++n}`)

    for (let i = 0; i < 3; i += 1) {
      await chamar(
        req('/api/chamados', {
          metodo: 'POST',
          email: ANA,
          corpo: { ...PROPOSTA, chaveIdempotencia: `k${i}` },
        }),
      )
    }
    const r = await chamar(
      req('/api/chamados', { metodo: 'POST', email: ANA, corpo: { ...PROPOSTA, chaveIdempotencia: 'kx' } }),
    )
    expect(r.status).toBe(429)
    expect((await r.json()).erro).toMatch(/muitas solicitações/i)
  })

  it('o limite é POR USUÁRIO — um script não derruba os outros', async () => {
    const config = new Config(db)
    await config.definir('limite_requisicoes_por_minuto', 1, CHEFE, AGORA)
    ctx = await montarContexto({ DB: db, GOATLAS_USAR_FAKES: '1' }, () => AGORA, () => `id-${++n}`)

    await chamar(req('/api/chamados', { metodo: 'POST', email: ANA, corpo: { ...PROPOSTA, chaveIdempotencia: 'a1' } }))
    await chamar(req('/api/chamados', { metodo: 'POST', email: ANA, corpo: { ...PROPOSTA, chaveIdempotencia: 'a2' } }))
    // A Ana estourou; o Bruno não deve ser afetado.
    const doBruno = await chamar(
      req('/api/chamados', { metodo: 'POST', email: BRUNO, corpo: { ...PROPOSTA, chaveIdempotencia: 'b1' } }),
    )
    expect(doBruno.status).toBe(201)
  })
})

describe('cron — autenticado por header assinado da plataforma', () => {
  it('BURLA — sem o header: 403 e auditado', async () => {
    const r = await chamar(req('/api/cron/reprocessar-submissoes', { metodo: 'POST' }))
    expect(r.status).toBe(403)
    const auditados = await db.query(
      `SELECT ator_email FROM auditoria WHERE resultado = 'negado' AND ator_email = '(cron)'`,
      [],
    )
    expect(auditados.rows).toHaveLength(1)
  })

  it('BURLA — header com valor errado: 403', async () => {
    const r = await chamar(
      req('/api/cron/reprocessar-submissoes', {
        metodo: 'POST',
        headers: { 'x-godeploy-cron': 'chute' },
      }),
    )
    expect(r.status).toBe(403)
  })

  it('com o header correto, reprocessa o outbox (RNF-17)', async () => {
    const fake = ctx.atlassian as ClienteAtlassianFake
    fake.estado.falhas.criarChamado = 'indisponivel'
    const pendente = await chamar(
      req('/api/chamados', { metodo: 'POST', email: ANA, corpo: { ...PROPOSTA, chaveIdempotencia: 'kp' } }),
    )
    const corpoPendente = await pendente.json()
    expect(corpoPendente.estado).toBe('pendente')
    // A mensagem tranquiliza em vez de dizer "não consegui" (RNF-18).
    expect(corpoPendente.mensagem).toMatch(/nada se perdeu/i)

    fake.estado.falhas.criarChamado = 'nenhum'
    const r = await chamar(
      req('/api/cron/reprocessar-submissoes', {
        metodo: 'POST',
        headers: { 'x-godeploy-cron': CRON_KEY },
      }),
    )
    expect((await r.json()).criados).toBe(1)
  })

  it('sem GODEPLOY_CRON_KEY configurada, a rota é FECHADA (fail-closed)', async () => {
    const r = await tratarRequisicao(
      req('/api/cron/reprocessar-submissoes', {
        metodo: 'POST',
        headers: { 'x-godeploy-cron': CRON_KEY },
      }),
      ctx,
      {},
    )
    expect(r.status).toBe(403)
  })
})

describe('RF-49 / RF-50 — admin', () => {
  it('BURLA — não-admin em rota de admin: 403', async () => {
    expect((await chamar(req('/api/admin/config', { email: ANA }))).status).toBe(403)
    expect((await chamar(req('/api/admin/auditoria', { email: ANA }))).status).toBe(403)
  })

  it('admin altera threshold sem deploy, e a alteração é auditada', async () => {
    const r = await chamar(
      req('/api/admin/config', {
        metodo: 'PUT',
        email: CHEFE,
        corpo: { chave: 'regra1_threshold_score', valor: 0.9 },
      }),
    )
    expect(r.status).toBe(200)
    const config = new Config(db)
    expect(await config.obter('regra1_threshold_score')).toBe(0.9)
    const auditados = await db.query(`SELECT acao FROM auditoria WHERE acao = 'config_alterada'`, [])
    expect(auditados.rows).toHaveLength(1)
  })

  it('chave de config desconhecida é recusada', async () => {
    const r = await chamar(
      req('/api/admin/config', {
        metodo: 'PUT',
        email: CHEFE,
        corpo: { chave: 'apagar_tudo', valor: true },
      }),
    )
    expect(r.status).toBe(400)
  })
})

describe('RNF-25 — sem service desk configurado, não se inventa um', () => {
  it('a mensagem manda falar com o time de tech, e nada é criado', async () => {
    const dbLimpo = new SqliteLocal()
    await migrar(dbLimpo)
    const config = new Config(dbLimpo)
    await config.definir('dominios_permitidos', ['gocase.com'], CHEFE, AGORA)
    await config.definir('tipos_chamado_permitidos', ['rt-1'], CHEFE, AGORA)
    const ctxSemSd = await montarContexto(
      { DB: dbLimpo, GOATLAS_USAR_FAKES: '1' },
      () => AGORA,
      () => `id-${++n}`,
    )
    const r = await tratarRequisicao(
      req('/api/chamados', { metodo: 'POST', email: ANA, corpo: PROPOSTA }),
      ctxSemSd,
      { GODEPLOY_CRON_KEY: CRON_KEY },
    )
    expect(r.status).toBe(400)
    expect((await r.json()).erro).toMatch(/não foi configurada/i)
  })
})

describe('RF-56 — auditoria do admin mostra TUDO, não só as ações dele', () => {
  it('sem filtro, traz ações de todos os atores', async () => {
    // O default anterior era o próprio e-mail do admin, o que tornava o console
    // inútil para investigar: ele só via a si mesmo.
    await chamar(req('/api/chamados', { email: ANA }))
    await chamar(req('/api/chamados', { email: BRUNO }))

    const r = await chamar(req('/api/admin/auditoria', { email: CHEFE }))
    const atores = new Set(
      (await r.json()).itens.map((i: { ator_email: string }) => i.ator_email),
    )
    expect(atores.has(ANA)).toBe(true)
    expect(atores.has(BRUNO)).toBe(true)
  })

  it('com filtro, traz só o ator pedido', async () => {
    await chamar(req('/api/chamados', { email: ANA }))
    await chamar(req('/api/chamados', { email: BRUNO }))

    const r = await chamar(req(`/api/admin/auditoria?email=${encodeURIComponent(ANA)}`, { email: CHEFE }))
    const atores = new Set(
      (await r.json()).itens.map((i: { ator_email: string }) => i.ator_email),
    )
    expect([...atores]).toEqual([ANA])
  })

  it('BURLA — colaborador não alcança a auditoria, com ou sem filtro', async () => {
    expect((await chamar(req('/api/admin/auditoria', { email: ANA }))).status).toBe(403)
    expect(
      (await chamar(req(`/api/admin/auditoria?email=${encodeURIComponent(BRUNO)}`, { email: ANA })))
        .status,
    ).toBe(403)
  })
})
