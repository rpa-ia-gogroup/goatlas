/**
 * `D-20` — as decisões tomadas para o MVP, e o que cada uma se recusa a fazer.
 *
 * Estes testes existem porque as decisões de `D-20` são **defaults**, e default é a coisa
 * mais fácil de mudar por engano numa refatoração: ninguém escreve "vou trocar o
 * comportamento quando a config falta", só mexe num `??`.
 *
 * _Requirements: RF-19, RF-45, RF-55, R-06, RNF-25, RNF-33_
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { SqliteLocal } from '@/lib/db/sqlite-local'
import { migrar } from '@/lib/db/schema'
import { CONFIG_PADRAO, Config, valoresDoBootstrap } from '@/lib/config'
import { montarContexto, type Contexto } from '@/lib/contexto'
import { tratarRequisicao } from '@/lib/http/rotas'
import { HEADER_EMAIL } from '@/lib/auth'
import { ClienteAtlassianFake } from '@/lib/atlassian/fake'
import { linhasComoObjetos } from '@/lib/db/tipos'
import { JANELA_DEFLEXAO_DIAS, VIES_DEFLEXAO } from '@/lib/governanca/painel'
import { ClienteIAHttp } from '@/lib/ia/cliente'

const ANA = 'ana@gocase.com'
const CHEFE = 'chefe@gocase.com'
const AGORA = '2026-08-06T12:00:00.000Z'
const CRON_KEY = 'chave-cron'

describe('bootstrap por env — o que D-20 configura sem deploy', () => {
  it('`GOATLAS_BASE_PUBLICA` entra na config, sem a barra final', () => {
    // Quem copia URL do navegador copia COM barra. Sem normalizar, o link sai
    // `https://host//?chamado=X`.
    const v = valoresDoBootstrap({ GOATLAS_BASE_PUBLICA: 'https://goatlas.devgogroup.com/' })
    expect(v.base_publica_app).toBe('https://goatlas.devgogroup.com')
  })

  it('`GOATLAS_CANAL_NOTIFICACAO` aceita os três valores válidos', () => {
    for (const canal of ['chat', 'email', 'nenhum'] as const) {
      expect(valoresDoBootstrap({ GOATLAS_CANAL_NOTIFICACAO: canal }).canal_notificacao_padrao).toBe(
        canal,
      )
    }
    expect(valoresDoBootstrap({ GOATLAS_CANAL_NOTIFICACAO: ' EMAIL ' }).canal_notificacao_padrao).toBe(
      'email',
    )
  })

  it('⚠️ valor DESCONHECIDO é ignorado, não "corrigido" para um canal', () => {
    // `e-mail` com hífen virando `email` mandaria aviso por um caminho que ninguém pediu.
    // Ignorar deixa o estado em "ninguém decidiu", que a tela mostra.
    for (const errado of ['e-mail', 'emails', 'slack', 'sim', '']) {
      expect(
        'canal_notificacao_padrao' in
          valoresDoBootstrap({ GOATLAS_CANAL_NOTIFICACAO: errado }),
      ).toBe(false)
    }
  })

  it('o default do CÓDIGO continua `null` — instalação nova não finge ter decidido', () => {
    // ⚠️ `D-20` decidiu para ESTE app, por env. Mudar `CONFIG_PADRAO` faria toda instalação
    // futura afirmar "alguém escolheu não enviar" quando ninguém escolheu nada.
    expect(CONFIG_PADRAO.canal_notificacao_padrao).toBeNull()
    expect(CONFIG_PADRAO.base_publica_app).toBeNull()
    expect(CONFIG_PADRAO.emails_piloto).toEqual([])
    expect(CONFIG_PADRAO.retencao_conversas_dias).toBeNull()
    expect(CONFIG_PADRAO.retencao_auditoria_dias).toBeNull()
  })
})

describe('`nenhum` DECIDIDO ≠ ninguém decidiu — os dois não enviam, e a tela distingue', () => {
  let db: SqliteLocal
  let ctx: Contexto
  let n = 0

  async function montar(env: Record<string, string> = {}) {
    ctx = await montarContexto(
      { DB: db, GOATLAS_USAR_FAKES: '1', ...env },
      () => AGORA,
      () => `id-${++n}`,
    )
  }

  beforeEach(async () => {
    db = new SqliteLocal()
    await migrar(db)
    n = 0
    const config = new Config(db)
    await config.definir('dominios_permitidos', ['gocase.com'], CHEFE, AGORA)
    await config.definir('admins', [CHEFE], CHEFE, AGORA)
  })

  const preferencia = async () =>
    (
      await tratarRequisicao(
        new Request('https://x/api/preferencias', { headers: { [HEADER_EMAIL]: ANA } }),
        ctx,
        { GODEPLOY_CRON_KEY: CRON_KEY },
      )
    ).json()

  it('sem env: `canalPadraoDefinido: false` — a tela cobra quem administra', async () => {
    await montar()
    const p = await preferencia()
    expect(p.canal).toBe('nenhum')
    expect(p.canalPadraoDefinido).toBe(false)
    expect(p.escolhidaPelaPessoa).toBe(false)
  })

  it('com `nenhum`: mesmo canal, mas `canalPadraoDefinido: true`', async () => {
    await montar({ GOATLAS_CANAL_NOTIFICACAO: 'nenhum' })
    const p = await preferencia()
    expect(p.canal).toBe('nenhum')
    // É este bit que muda a frase da tela de "ninguém definiu" para "os avisos vivem aqui".
    expect(p.canalPadraoDefinido).toBe(true)
  })
})

describe('T-235 — o proxy de deflexão, e o viés declarado com ele', () => {
  let db: SqliteLocal
  let ctx: Contexto
  let atlassian: ClienteAtlassianFake
  let n = 0

  beforeEach(async () => {
    db = new SqliteLocal()
    await migrar(db)
    n = 0
    atlassian = new ClienteAtlassianFake({
      tiposChamado: [{ id: 'rt-1', serviceDeskId: 'sd-1', nome: 'Suporte', descricao: null }],
      relogio: () => AGORA,
    })
    const config = new Config(db)
    await config.definir('dominios_permitidos', ['gocase.com'], CHEFE, AGORA)
    await config.definir('admins', [CHEFE], CHEFE, AGORA)
    await config.definir('service_desk_id', 'sd-1', CHEFE, AGORA)
    await config.definir('tipos_chamado_permitidos', ['rt-1'], CHEFE, AGORA)
    ctx = await montarContexto(
      { DB: db, GOATLAS_USAR_FAKES: '1' },
      () => AGORA,
      () => `id-${++n}`,
      { atlassian },
    )
  })

  /** Bloqueio direto no banco: montar uma conversa bloqueada de verdade exigiria roteirizar
   * a IA, e o que se testa aqui é a AGREGAÇÃO, não a Regra 1. */
  async function semearBloqueio(id: string, email: string, quando: string, override = false) {
    await db.exec(
      `INSERT INTO conversas (id, solicitante_email, estado, criado_em, atualizado_em)
       VALUES (?, ?, 'bloqueado', ?, ?)`,
      [`c-${id}`, email, quando, quando],
    )
    await db.exec(
      `INSERT INTO bloqueios (id, conversa_id, regra, motivo, houve_override, criado_em)
       VALUES (?, ?, 'regra1_confluence', 'tem página', ?, ?)`,
      [id, `c-${id}`, override ? 1 : 0, quando],
    )
  }

  async function semearChamado(issueKey: string, email: string, quando: string) {
    await db.exec(
      `INSERT INTO vinculos (issue_key, solicitante_email, via, verificado_regras, criado_em)
       VALUES (?, ?, 'formulario', 0, ?)`,
      [issueKey, email, quando],
    )
  }

  const painel = async () =>
    (
      await tratarRequisicao(
        new Request('https://x/api/admin/metricas', { headers: { [HEADER_EMAIL]: CHEFE } }),
        ctx,
        { GODEPLOY_CRON_KEY: CRON_KEY },
      )
    ).json()

  it('sem bloqueio nenhum, a taxa é `null` — nunca 0%', async () => {
    const corpo = await painel()
    expect(corpo.painel.deflexaoAparente.taxaPct).toBeNull()
    expect(corpo.painel.deflexaoAparente.bloqueiosSemOverride).toBe(0)
  })

  it('bloqueado e não voltou: conta como não-voltou', async () => {
    await semearBloqueio('b1', ANA, '2026-08-01T10:00:00.000Z')
    const d = (await painel()).painel.deflexaoAparente
    expect(d.bloqueiosSemOverride).toBe(1)
    expect(d.semChamadoDepois).toBe(1)
    expect(d.taxaPct).toBe(100)
  })

  it('bloqueado e abriu chamado DENTRO da janela: não conta', async () => {
    await semearBloqueio('b1', ANA, '2026-08-01T10:00:00.000Z')
    await semearChamado('GOATLAS-1', ANA, '2026-08-03T10:00:00.000Z')
    const d = (await painel()).painel.deflexaoAparente
    expect(d.bloqueiosSemOverride).toBe(1)
    expect(d.semChamadoDepois).toBe(0)
    expect(d.taxaPct).toBe(0)
  })

  it('chamado FORA da janela não desconta — a janela é o que dá sentido ao número', async () => {
    await semearBloqueio('b1', ANA, '2026-08-01T10:00:00.000Z')
    // Vinte dias depois: outro assunto, não "o bloqueio não resolveu".
    await semearChamado('GOATLAS-1', ANA, '2026-08-21T10:00:00.000Z')
    expect((await painel()).painel.deflexaoAparente.semChamadoDepois).toBe(1)
    expect(JANELA_DEFLEXAO_DIAS).toBe(7)
  })

  it('chamado de OUTRA pessoa não desconta o bloqueio da Ana', async () => {
    await semearBloqueio('b1', ANA, '2026-08-01T10:00:00.000Z')
    await semearChamado('GOATLAS-1', 'bruno@gocase.com', '2026-08-02T10:00:00.000Z')
    expect((await painel()).painel.deflexaoAparente.semChamadoDepois).toBe(1)
  })

  it('bloqueio COM override sai da conta — quem insistiu não foi defletido', async () => {
    await semearBloqueio('b1', ANA, '2026-08-01T10:00:00.000Z', true)
    expect((await painel()).painel.deflexaoAparente.bloqueiosSemOverride).toBe(0)
  })

  it('⚠️ o viés vai NO PAYLOAD, junto do número — não em rodapé de documento', async () => {
    const d = (await painel()).painel.deflexaoAparente
    expect(d.viesConhecido).toBe(VIES_DEFLEXAO)
    expect(d.viesConhecido).toMatch(/chat|canal antigo/i)
    // E o campo que diz "isto não é medição" continua `false`.
    expect((await painel()).painel.deflexaoResolvidaConhecida).toBe(false)
  })

  it('a auditoria não é tocada por isto — o painel só lê', async () => {
    await semearBloqueio('b1', ANA, '2026-08-01T10:00:00.000Z')
    await painel()
    const linhas = linhasComoObjetos<{ total: number }>(
      await db.query('SELECT COUNT(*) AS total FROM bloqueios', []),
    )
    expect(Number(linhas[0]?.total)).toBe(1)
  })
})

describe('LLM_BASE_URL com barra no fim não quebra a chamada', () => {
  it('a barra final é normalizada — `//chat/completions` seria 404 no proxy', async () => {
    const urls: string[] = []
    const cliente = new ClienteIAHttp({
      // É assim que a URL sai de um navegador, e é assim que alguém a cola no console.
      baseUrl: 'https://ai-proxy.gogroupbr.com/v1/',
      apiKey: 'token-de-teste',
      modelo: 'gpt-5.4-mini',
      fetchImpl: (async (url: string) => {
        urls.push(String(url))
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: 'ok' } }],
            usage: { prompt_tokens: 1, completion_tokens: 1 },
          }),
          { status: 200 },
        )
      }) as unknown as typeof fetch,
    })

    await cliente.chat({
      mensagens: [{ papel: 'user', conteudo: 'oi' }],
      toolsPermitidas: [],
    })
    expect(urls[0]).toBe('https://ai-proxy.gogroupbr.com/v1/chat/completions')
    expect(urls[0]).not.toContain('//chat')
  })
})
