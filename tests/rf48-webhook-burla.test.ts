/**
 * T-201 a T-203 — **a trava da Fase 3.** Os testes de burla vêm antes.
 *
 * O webhook é a única rota pública do app: todo o resto fica atrás do SSO do edge ou do
 * header assinado do cron. As três coisas que precisam ser verdade:
 *
 * - **T-201** — sem segredo, com segredo errado, e com evento **forjado** sobre chamado
 *   que não é nosso: nada notifica ninguém, e a resposta não diz qual dos casos foi.
 * - **T-202** — webhook e polling vendo o **mesmo fato** geram **uma** notificação.
 * - **T-203** — quem comentou pelo app não é notificado do próprio comentário.
 *
 * _Requirements: RF-47, RF-48, RNF-05_
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { SqliteLocal } from '@/lib/db/sqlite-local'
import { migrar } from '@/lib/db/schema'
import { Config } from '@/lib/config'
import { montarContexto, type Contexto } from '@/lib/contexto'
import { tratarRequisicao } from '@/lib/http/rotas'
import { HEADER_EMAIL } from '@/lib/auth'
import { ClienteAtlassianFake } from '@/lib/atlassian/fake'
import { linhasComoObjetos } from '@/lib/db/tipos'
import { chaveDedupe, normalizarCarimbo } from '@/lib/notificacoes/dedupe'
import { HEADER_WEBHOOK, PARAM_WEBHOOK, segredoConfere, chaveDoPayload } from '@/lib/notificacoes/webhook'
import { prefixarAutoria } from '@/lib/atlassian/comentarios'

const ANA = 'ana@gocase.com'
const OUTRA = 'bruno@gocase.com'
const CHEFE = 'chefe@gocase.com'
const AGORA = '2026-08-06T12:00:00.000Z'
const CRON_KEY = 'chave-cron'
const SEGREDO = 'segredo-do-webhook-do-jira'

let db: SqliteLocal
let ctx: Contexto
let atlassian: ClienteAtlassianFake
let n = 0

async function montar(extra: Record<string, string> = {}) {
  ctx = await montarContexto(
    { DB: db, GOATLAS_USAR_FAKES: '1', GOATLAS_WEBHOOK_SEGREDO: SEGREDO, ...extra },
    () => AGORA,
    () => `id-${++n}`,
    { atlassian },
  )
}

beforeEach(async () => {
  db = new SqliteLocal()
  await migrar(db)
  n = 0
  atlassian = new ClienteAtlassianFake({
    tiposChamado: [{ id: 'rt-1', serviceDeskId: 'sd-1', nome: 'Suporte', descricao: null }],
  })
  const config = new Config(db)
  await config.definir('dominios_permitidos', ['gocase.com'], CHEFE, AGORA)
  await config.definir('admins', [CHEFE], CHEFE, AGORA)
  await config.definir('service_desk_id', 'sd-1', CHEFE, AGORA)
  await config.definir('tipos_chamado_permitidos', ['rt-1'], CHEFE, AGORA)
  // Q11 respondida no teste: sem canal, tudo nasceria `suprimida` e os testes de dedupe
  // não distinguiriam supressão de dedupe.
  await config.definir('canal_notificacao_padrao', 'chat', CHEFE, AGORA)
  await montar()
})

function req(
  caminho: string,
  opcoes: {
    metodo?: string
    email?: string
    headers?: Record<string, string>
    corpo?: unknown
  } = {},
): Request {
  const headers: Record<string, string> = { ...opcoes.headers }
  if (opcoes.email) headers[HEADER_EMAIL] = opcoes.email
  if (opcoes.corpo !== undefined) headers['content-type'] = 'application/json'
  return new Request(`https://goatlas.devgogroup.com${caminho}`, {
    method: opcoes.metodo ?? 'GET',
    headers,
    ...(opcoes.corpo === undefined ? {} : { body: JSON.stringify(opcoes.corpo) }),
  })
}

const chamar = (r: Request) => tratarRequisicao(r, ctx, { GODEPLOY_CRON_KEY: CRON_KEY })

/** Abre um chamado da Ana pelo formulário — o caminho mais curto até um vínculo. */
async function abrirChamadoDaAna(): Promise<string> {
  const r = await chamar(
    req('/api/chamados', {
      metodo: 'POST',
      email: ANA,
      corpo: {
        titulo: 'Impressora do RH não imprime',
        descricao: 'A impressora do segundo andar não responde desde ontem.',
        tipoChamadoId: 'rt-1',
        prioridade: 'normal',
        chaveIdempotencia: 'k1',
      },
    }),
  )
  const corpo = await r.json()
  return corpo.issueKey as string
}

const webhook = (corpo: unknown, segredo: string | null, viaQuery = false) =>
  chamar(
    new Request(
      `https://goatlas.devgogroup.com/api/webhook/jira${
        viaQuery && segredo ? `?${PARAM_WEBHOOK}=${encodeURIComponent(segredo)}` : ''
      }`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(segredo && !viaQuery ? { [HEADER_WEBHOOK]: segredo } : {}),
        },
        body: JSON.stringify(corpo),
      },
    ),
  )

const polling = () =>
  chamar(
    req('/api/cron/polling-jira', {
      metodo: 'POST',
      headers: { 'x-godeploy-cron': CRON_KEY },
    }),
  )

async function notificacoesDe(email: string) {
  return linhasComoObjetos<Record<string, unknown>>(
    await db.query(
      `SELECT tipo_evento, estado, carimbo_mudanca, fonte, titulo FROM notificacoes
        WHERE destinatario_email = ? ORDER BY criado_em, tipo_evento`,
      [email],
    ),
  )
}

async function todasAsNotificacoes() {
  return linhasComoObjetos<Record<string, unknown>>(
    await db.query('SELECT destinatario_email, tipo_evento, estado FROM notificacoes', []),
  )
}

// =============================================================================
// T-201 — burla do webhook
// =============================================================================

describe('T-201 — o webhook não notifica ninguém sem segredo válido', () => {
  it('sem segredo nenhum: 403, e nada é sincronizado', async () => {
    const issueKey = await abrirChamadoDaAna()
    atlassian.simularMudancaDoTime(issueKey, { status: 'Em andamento' })
    const antes = (await todasAsNotificacoes()).length

    const r = await webhook({ issue: { key: issueKey } }, null)
    expect(r.status).toBe(403)
    expect((await todasAsNotificacoes()).length).toBe(antes)
  })

  it('com segredo errado: 403 — e do MESMO tamanho de erro que o ausente', async () => {
    const issueKey = await abrirChamadoDaAna()
    const semSegredo = await webhook({ issue: { key: issueKey } }, null)
    const errado = await webhook({ issue: { key: issueKey } }, 'quase-o-segredo-do-webhook')
    expect(errado.status).toBe(semSegredo.status)
    expect(await errado.text()).toBe(await semSegredo.text())
  })

  it('a tentativa recusada fica na auditoria — SEM o segredo enviado', async () => {
    await webhook({ issue: { key: 'GOATLAS-1' } }, 'segredo-chutado-pelo-atacante')
    const linhas = linhasComoObjetos<{ resultado: string; detalhe_json: string }>(
      await db.query(
        `SELECT resultado, detalhe_json FROM auditoria WHERE acao = 'webhook_recebido'`,
        [],
      ),
    )
    expect(linhas[0]?.resultado).toBe('negado')
    expect(linhas[0]?.detalhe_json).toContain('segredo_invalido')
    // ⚠️ Um segredo quase certo no log de auditoria é meio caminho andado para quem o lê.
    expect(linhas[0]?.detalhe_json).not.toContain('segredo-chutado-pelo-atacante')
  })

  it('sem `GOATLAS_WEBHOOK_SEGREDO` configurado, a rota NÃO funciona (fail-closed)', async () => {
    await montar({ GOATLAS_WEBHOOK_SEGREDO: '' })
    const r = await webhook({ issue: { key: 'GOATLAS-1' } }, SEGREDO)
    expect(r.status).toBe(403)
    const linhas = linhasComoObjetos<{ detalhe_json: string }>(
      await db.query(
        `SELECT detalhe_json FROM auditoria WHERE acao = 'webhook_recebido'`,
        [],
      ),
    )
    expect(linhas[0]?.detalhe_json).toContain('segredo_nao_configurado')
  })

  it('evento FORJADO sobre chamado sem vínculo local não notifica ninguém', async () => {
    // Segredo correto (o cenário do insider, ou do segredo que vazou), mas o chamado
    // não passou pelo goatlas: não existe a quem avisar.
    const r = await webhook({ issue: { key: 'TECH-9999' } }, SEGREDO)
    expect(r.status).toBe(202)
    expect(await todasAsNotificacoes()).toEqual([])
  })

  it('a resposta é a MESMA com e sem vínculo — não é oráculo de "está no goatlas?"', async () => {
    const issueKey = await abrirChamadoDaAna()
    const nosso = await webhook({ issue: { key: issueKey } }, SEGREDO)
    const alheio = await webhook({ issue: { key: 'TECH-9999' } }, SEGREDO)
    expect(alheio.status).toBe(nosso.status)
    expect(await alheio.text()).toBe(await nosso.text())
  })

  it('chave malformada no payload não vira consulta — e ainda responde 202', async () => {
    for (const chave of ['../../etc/passwd', "GOATLAS-1' OR 1=1", '', 'sem-numero']) {
      const r = await webhook({ issue: { key: chave } }, SEGREDO)
      expect(r.status).toBe(202)
    }
    expect(await todasAsNotificacoes()).toEqual([])
  })

  it('o segredo também é aceito na query (é o que o Jira permite configurar)', async () => {
    const issueKey = await abrirChamadoDaAna()
    atlassian.simularMudancaDoTime(issueKey, {
      status: 'Em andamento',
      atualizadoEm: '2026-08-06T13:00:00.000Z',
    })
    const r = await webhook({ issue: { key: issueKey } }, SEGREDO, true)
    expect(r.status).toBe(202)
    const avisos = await notificacoesDe(ANA)
    expect(avisos.some((a) => a.tipo_evento === 'status_alterado')).toBe(true)
  })
})

describe('segredoConfere — comparação de tempo constante', () => {
  it('confere o igual e recusa o diferente', () => {
    expect(segredoConfere('abc', 'abc')).toBe(true)
    expect(segredoConfere('abd', 'abc')).toBe(false)
  })

  it('recusa por tamanho SEM atalho — prefixo correto não vale nada', () => {
    expect(segredoConfere('abc', 'abcdef')).toBe(false)
    expect(segredoConfere('abcdef', 'abc')).toBe(false)
  })

  it('sem esperado configurado, nada confere (fail-closed)', () => {
    expect(segredoConfere('abc', undefined)).toBe(false)
    expect(segredoConfere('abc', '')).toBe(false)
    expect(segredoConfere(null, 'abc')).toBe(false)
  })
})

describe('chaveDoPayload — o corpo do webhook é ponteiro, não conteúdo', () => {
  it('aceita `issue.key` e `issueKey`, no formato de chave do Jira', () => {
    expect(chaveDoPayload({ issue: { key: 'TECH-12' } })).toBe('TECH-12')
    expect(chaveDoPayload({ issueKey: 'GOATLAS-1' })).toBe('GOATLAS-1')
  })

  it('recusa o que não tem forma de chave', () => {
    expect(chaveDoPayload({ issue: { key: 'tech-12' } })).toBeNull()
    expect(chaveDoPayload({ issue: { key: '../../x' } })).toBeNull()
    expect(chaveDoPayload({ issue: { key: 'SEM-NUMERO-X' } })).toBeNull()
    expect(chaveDoPayload(null)).toBeNull()
    expect(chaveDoPayload('TECH-1')).toBeNull()
  })
})

// =============================================================================
// T-202 — dedupe entre as duas fontes
// =============================================================================

describe('T-202 — webhook e polling para o MESMO fato geram UMA notificação', () => {
  it('mudança de status vista pelas duas fontes: um aviso só', async () => {
    const issueKey = await abrirChamadoDaAna()
    atlassian.simularMudancaDoTime(issueKey, {
      status: 'Em andamento',
      atualizadoEm: '2026-08-06T13:00:00.000Z',
    })

    await webhook({ issue: { key: issueKey } }, SEGREDO)
    await polling()
    await webhook({ issue: { key: issueKey } }, SEGREDO)

    const avisos = (await notificacoesDe(ANA)).filter((a) => a.tipo_evento === 'status_alterado')
    expect(avisos).toHaveLength(1)
  })

  it('comentário do time visto pelas duas fontes: um aviso só', async () => {
    const issueKey = await abrirChamadoDaAna()
    atlassian.simularMudancaDoTime(issueKey, {
      comentarioPublico: {
        corpo: 'Já estamos verificando com o fornecedor.',
        autorNome: 'Suporte Tech',
        criadoEm: '2026-08-06T13:30:00.000Z',
      },
    })

    await polling()
    await webhook({ issue: { key: issueKey } }, SEGREDO)

    const avisos = (await notificacoesDe(ANA)).filter(
      (a) => a.tipo_evento === 'comentario_publico',
    )
    expect(avisos).toHaveLength(1)
  })

  it('a chave de dedupe é a MESMA nas duas fontes — é isso que faz a dedupe funcionar', () => {
    // O webhook manda `Z`; o REST do Jira manda o mesmo instante com deslocamento. Sem
    // normalizar, as duas strings seriam chaves diferentes para o mesmo fato.
    const doWebhook = chaveDedupe('GOATLAS-1', 'status_alterado', '2026-08-06T13:00:00.000Z')
    const doRest = chaveDedupe('GOATLAS-1', 'status_alterado', '2026-08-06T10:00:00.000-0300')
    expect(doWebhook).toBe(doRest)
  })

  it('carimbo ilegível NÃO é inventado — vale como veio', () => {
    expect(normalizarCarimbo('ontem à tarde')).toBe('ontem à tarde')
  })

  it('o carimbo é o do JIRA, não o nosso relógio', async () => {
    const issueKey = await abrirChamadoDaAna()
    atlassian.simularMudancaDoTime(issueKey, {
      status: 'Resolvido',
      atualizadoEm: '2026-08-06T13:00:00.000Z',
    })
    await polling()
    const avisos = (await notificacoesDe(ANA)).filter((a) => a.tipo_evento === 'status_alterado')
    expect(avisos[0]?.carimbo_mudanca).toBe('2026-08-06T13:00:00.000Z')
    // `AGORA` é 12:00 — se a chave usasse o nosso relógio, seria este valor.
    expect(avisos[0]?.carimbo_mudanca).not.toBe(AGORA)
  })

  it('MUDANÇAS DIFERENTES continuam sendo dois avisos — a dedupe não engole fato novo', async () => {
    const issueKey = await abrirChamadoDaAna()
    atlassian.simularMudancaDoTime(issueKey, {
      status: 'Em andamento',
      atualizadoEm: '2026-08-06T13:00:00.000Z',
    })
    await polling()
    atlassian.simularMudancaDoTime(issueKey, {
      status: 'Resolvido',
      atualizadoEm: '2026-08-06T14:00:00.000Z',
    })
    await polling()

    const avisos = (await notificacoesDe(ANA)).filter((a) => a.tipo_evento === 'status_alterado')
    expect(avisos).toHaveLength(2)
  })

  it('`updated` que muda SEM o status mudar não gera aviso de status', async () => {
    const issueKey = await abrirChamadoDaAna()
    atlassian.simularMudancaDoTime(issueKey, {
      status: 'Em andamento',
      atualizadoEm: '2026-08-06T13:00:00.000Z',
    })
    await polling()
    // Alguém editou a descrição: `updated` mudou, o status não.
    atlassian.simularMudancaDoTime(issueKey, { atualizadoEm: '2026-08-06T15:00:00.000Z' })
    await polling()

    const avisos = (await notificacoesDe(ANA)).filter((a) => a.tipo_evento === 'status_alterado')
    expect(avisos).toHaveLength(1)
  })
})

// =============================================================================
// T-203 — ação própria
// =============================================================================

describe('T-203 — ninguém é notificado da própria ação', () => {
  it('o comentário que a Ana escreveu pelo app não volta como aviso para a Ana', async () => {
    const issueKey = await abrirChamadoDaAna()
    await chamar(
      req(`/api/chamados/${issueKey}/comentarios`, {
        metodo: 'POST',
        email: ANA,
        corpo: { texto: 'Segue o print do erro que aparece na tela.' },
      }),
    )

    await polling()
    await webhook({ issue: { key: issueKey } }, SEGREDO)

    const avisos = (await notificacoesDe(ANA)).filter(
      (a) => a.tipo_evento === 'comentario_publico',
    )
    // Registrado (para a dedupe reconhecer o fato) mas SUPRIMIDO — nunca `pendente`.
    expect(avisos).toHaveLength(1)
    expect(avisos[0]?.estado).toBe('suprimida')
  })

  it('mas o comentário do TIME sobre o mesmo chamado notifica normalmente', async () => {
    const issueKey = await abrirChamadoDaAna()
    await chamar(
      req(`/api/chamados/${issueKey}/comentarios`, {
        metodo: 'POST',
        email: ANA,
        corpo: { texto: 'Segue o print do erro.' },
      }),
    )
    atlassian.simularMudancaDoTime(issueKey, {
      comentarioPublico: {
        corpo: 'Recebemos o print, obrigado. Vamos trocar o cabo hoje.',
        autorNome: 'Suporte Tech',
        criadoEm: '2026-08-06T14:00:00.000Z',
      },
    })

    await polling()

    const avisos = (await notificacoesDe(ANA)).filter(
      (a) => a.tipo_evento === 'comentario_publico',
    )
    const pendentes = avisos.filter((a) => a.estado === 'pendente')
    expect(pendentes).toHaveLength(1)
  })

  it('o prefixo de autoria (D-13) não quebra o casamento da impressão digital', async () => {
    // Este é o ponto frágil e é de propósito explícito: o app grava o texto puro e
    // confere o corpo que voltou da Atlassian, que já tem o prefixo de `prefixarAutoria`.
    const issueKey = await abrirChamadoDaAna()
    const texto = 'O relatório de agosto não abre no Excel.'
    await ctx.acoesProprias.registrar({
      issueKey,
      atorEmail: ANA,
      tipoEvento: 'comentario_publico',
      conteudo: texto,
    })
    const comoVoltaDaAtlassian = prefixarAutoria(texto, 'Ana Souza', ANA)
    expect(
      await ctx.acoesProprias.ehAcaoPropria({
        issueKey,
        tipoEvento: 'comentario_publico',
        conteudo: comoVoltaDaAtlassian,
      }),
    ).toBe(true)
  })

  it('o mesmo texto em OUTRO chamado não é suprimido', async () => {
    const issueKey = await abrirChamadoDaAna()
    await ctx.acoesProprias.registrar({
      issueKey,
      atorEmail: ANA,
      tipoEvento: 'comentario_publico',
      conteudo: 'qualquer coisa',
    })
    expect(
      await ctx.acoesProprias.ehAcaoPropria({
        issueKey: 'GOATLAS-999',
        tipoEvento: 'comentario_publico',
        conteudo: 'qualquer coisa',
      }),
    ).toBe(false)
  })
})

// =============================================================================
// Isolamento (RF-30) na Fase 3
// =============================================================================

describe('RF-30 na Fase 3 — o aviso vai para quem abriu, e ninguém mais', () => {
  it('o chamado da Ana nunca gera notificação para o Bruno', async () => {
    const issueKey = await abrirChamadoDaAna()
    atlassian.simularMudancaDoTime(issueKey, {
      status: 'Em andamento',
      atualizadoEm: '2026-08-06T13:00:00.000Z',
      comentarioPublico: {
        corpo: 'Em análise.',
        autorNome: 'Suporte Tech',
        criadoEm: '2026-08-06T13:10:00.000Z',
      },
    })
    await polling()
    expect(await notificacoesDe(OUTRA)).toEqual([])
    expect((await notificacoesDe(ANA)).length).toBeGreaterThan(0)
  })

  it('`GET /api/notificacoes` só devolve as da própria pessoa', async () => {
    const issueKey = await abrirChamadoDaAna()
    atlassian.simularMudancaDoTime(issueKey, {
      status: 'Resolvido',
      atualizadoEm: '2026-08-06T13:00:00.000Z',
    })
    await polling()

    const daAna = await (await chamar(req('/api/notificacoes', { email: ANA }))).json()
    const doBruno = await (await chamar(req('/api/notificacoes', { email: OUTRA }))).json()
    expect(daAna.itens.length).toBeGreaterThan(0)
    expect(doBruno.itens).toEqual([])
  })
})

// =============================================================================
// T-210 — a marca-d'água
// =============================================================================

describe('T-210 — a marca-d\'água só avança no que deu certo', () => {
  it('polling com a Atlassian fora: 503 e a marca NÃO avança', async () => {
    await abrirChamadoDaAna()
    await polling()
    const antes = await ctx.marcaAguaPolling.obter()

    atlassian.estado.falhas.buscarAtualizados = 'indisponivel'
    const r = await polling()
    expect(r.status).toBe(503)
    expect(await ctx.marcaAguaPolling.obter()).toBe(antes)
  })

  it('chamado ilegível no meio da rodada não avança a marca além dele', async () => {
    const issueKey = await abrirChamadoDaAna()
    atlassian.simularMudancaDoTime(issueKey, {
      status: 'Em andamento',
      atualizadoEm: '2026-08-06T13:00:00.000Z',
    })
    atlassian.estado.falhas.listarComentarios = 'indisponivel'

    const r = await polling()
    expect((await r.json()).falhas).toBe(1)
    // A marca continua nula: nada foi processado com sucesso, então nada é dado por visto.
    expect(await ctx.marcaAguaPolling.obter()).toBeNull()
  })

  it('sem chamado nosso na janela, a marca avança para não crescer para sempre', async () => {
    const r = await polling()
    expect((await r.json()).nossos).toBe(0)
    expect(await ctx.marcaAguaPolling.obter()).toBe(AGORA)
  })
})

// =============================================================================
// Diagnóstico do cron — sem vazar segredo
// =============================================================================

describe('cron recusado registra o DIAGNÓSTICO, não o segredo', () => {
  async function tentarCron(headers: Record<string, string>, chave?: string) {
    return tratarRequisicao(
      new Request('https://x/api/cron/polling-jira', { method: 'POST', headers }),
      ctx,
      chave === undefined ? {} : { GODEPLOY_CRON_KEY: chave },
    )
  }

  async function ultimoDetalhe(): Promise<Record<string, unknown>> {
    const linhas = linhasComoObjetos<{ detalhe_json: string }>(
      await db.query(
        `SELECT detalhe_json FROM auditoria WHERE acao = 'acesso_negado'
          ORDER BY criado_em DESC, id DESC LIMIT 1`,
        [],
      ),
    )
    return JSON.parse(linhas[0]?.detalhe_json ?? '{}') as Record<string, unknown>
  }

  it('sem header: `headerAusente` — o cron não está batendo aqui', async () => {
    expect((await tentarCron({}, 'chave-certa')).status).toBe(403)
    const d = await ultimoDetalhe()
    expect(d.headerAusente).toBe(true)
    expect(d.chaveAusente).toBe(false)
  })

  it('sem secret: `chaveAusente` — falta configurar, não é chave errada', async () => {
    expect((await tentarCron({ 'x-godeploy-cron': 'qualquer' })).status).toBe(403)
    const d = await ultimoDetalhe()
    expect(d.chaveAusente).toBe(true)
  })

  it('tamanhos DIFERENTES apontam formato diferente (assinatura, p.ex.)', async () => {
    // É esta linha que responde "o header é a chave crua ou uma assinatura?" na primeira
    // rodada de cron em produção, sem ninguém precisar logar o valor.
    await tentarCron({ 'x-godeploy-cron': 'a'.repeat(64) }, 'gdk_curta')
    const d = await ultimoDetalhe()
    expect(d.tamanhoRecebido).toBe(64)
    expect(d.tamanhoEsperado).toBe('gdk_curta'.length)
  })

  it('⚠️ o VALOR e o PREFIXO nunca vão para a auditoria — só o comprimento', async () => {
    await tentarCron({ 'x-godeploy-cron': 'gdk_SEGREDO_QUE_NAO_PODE_VAZAR' }, 'gdk_OUTRO_SEGREDO')
    const linhas = linhasComoObjetos<{ detalhe_json: string }>(
      await db.query(`SELECT detalhe_json FROM auditoria WHERE acao = 'acesso_negado'`, []),
    )
    for (const linha of linhas) {
      expect(linha.detalhe_json).not.toContain('SEGREDO')
      expect(linha.detalhe_json).not.toContain('gdk_')
    }
  })

  it('com a chave certa, a rota funciona', async () => {
    expect((await tentarCron({ 'x-godeploy-cron': CRON_KEY }, CRON_KEY)).status).toBe(200)
  })
})
