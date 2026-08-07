/**
 * T-220 a T-225 — a camada de canal, as preferências e o despacho da fila.
 *
 * O que estes testes trancam:
 *
 * - **Q11 em aberto não vira canal inventado.** Sem `canal_notificacao_padrao`, o aviso é
 *   registrado como `suprimida` e o console consegue dizer "havia avisos e não havia
 *   canal" — em vez de silêncio que ninguém investiga.
 * - **Canal não configurado NEGA, não simula** (mesmo raciocínio de T-132 com a IA).
 * - **Falha de envio não perde a notificação**: transitório volta pendente, definitivo
 *   vira `falha`. Igual ao outbox de chamados (`RNF-17`).
 * - **Destino não é escolha livre do usuário** — seria transformar o app em relay.
 *
 * _Requirements: RF-44, RF-45, RNF-17, RNF-18, RNF-23_
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
import {
  CanalEmail,
  CanalFake,
  CanalGoogleChat,
  CanalIndisponivel,
} from '@/lib/notificacoes/canais'
import { validarPreferencia } from '@/lib/notificacoes/preferencias'
import { MAX_TENTATIVAS_ENVIO } from '@/lib/notificacoes/servico'
import { ErroCanal } from '@/lib/notificacoes/tipos'

const ANA = 'ana@gocase.com'
const CHEFE = 'chefe@gocase.com'
const AGORA = '2026-08-06T12:00:00.000Z'
const CRON_KEY = 'chave-cron'

let db: SqliteLocal
let ctx: Contexto
let atlassian: ClienteAtlassianFake
let n = 0

async function montar() {
  ctx = await montarContexto(
    { DB: db, GOATLAS_USAR_FAKES: '1' },
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
    relogio: () => AGORA,
  })
  const config = new Config(db)
  await config.definir('dominios_permitidos', ['gocase.com'], CHEFE, AGORA)
  await config.definir('admins', [CHEFE], CHEFE, AGORA)
  await config.definir('service_desk_id', 'sd-1', CHEFE, AGORA)
  await config.definir('tipos_chamado_permitidos', ['rt-1'], CHEFE, AGORA)
  await montar()
})

function req(caminho: string, o: { metodo?: string; email?: string; headers?: Record<string, string>; corpo?: unknown } = {}) {
  const headers: Record<string, string> = { ...o.headers }
  if (o.email) headers[HEADER_EMAIL] = o.email
  if (o.corpo !== undefined) headers['content-type'] = 'application/json'
  return new Request(`https://goatlas.devgogroup.com${caminho}`, {
    method: o.metodo ?? 'GET',
    headers,
    ...(o.corpo === undefined ? {} : { body: JSON.stringify(o.corpo) }),
  })
}

const chamar = (r: Request) => tratarRequisicao(r, ctx, { GODEPLOY_CRON_KEY: CRON_KEY })

async function abrirChamado(chave = 'k1'): Promise<string> {
  const r = await chamar(
    req('/api/chamados', {
      metodo: 'POST',
      email: ANA,
      corpo: {
        titulo: 'Notebook não liga',
        descricao: 'O notebook não liga nem na tomada desde hoje de manhã.',
        tipoChamadoId: 'rt-1',
        prioridade: 'alta',
        chaveIdempotencia: chave,
      },
    }),
  )
  return (await r.json()).issueKey as string
}

const enviarFila = () =>
  chamar(
    req('/api/cron/enviar-notificacoes', {
      metodo: 'POST',
      headers: { 'x-godeploy-cron': CRON_KEY },
    }),
  )

async function fila() {
  return linhasComoObjetos<Record<string, unknown>>(
    await db.query(
      'SELECT tipo_evento, estado, canal, destino, tentativas, ultimo_erro FROM notificacoes',
      [],
    ),
  )
}

// =============================================================================
// Q11 em aberto
// =============================================================================

describe('Q11 sem resposta: registra e SUPRIME — nunca inventa canal', () => {
  it('sem `canal_notificacao_padrao`, o aviso de criação nasce `suprimida`', async () => {
    await abrirChamado()
    const linhas = await fila()
    expect(linhas).toHaveLength(1)
    expect(linhas[0]?.tipo_evento).toBe('chamado_criado')
    expect(linhas[0]?.estado).toBe('suprimida')
    // ⚠️ Sem canal, sem destino. O default NÃO é "e-mail corporativo por conveniência".
    expect(linhas[0]?.canal).toBeNull()
    expect(linhas[0]?.destino).toBeNull()
  })

  it('o console consegue dizer que havia aviso e não havia canal', async () => {
    await abrirChamado()
    const corpo = await (await chamar(req('/api/admin/metricas', { email: CHEFE }))).json()
    expect(corpo.canalNotificacaoDefinido).toBe(false)
    expect(corpo.painel.notificacoes.suprimida).toBe(1)
    expect(corpo.painel.notificacoes.pendente).toBe(0)
  })

  it('com Q11 respondida (um campo de config), o MESMO código passa a enfileirar', async () => {
    const config = new Config(db)
    await config.definir('canal_notificacao_padrao', 'chat', CHEFE, AGORA)
    await montar()
    await abrirChamado('k2')
    const linhas = await fila()
    expect(linhas[0]?.estado).toBe('pendente')
    expect(linhas[0]?.canal).toBe('chat')
  })
})

// =============================================================================
// T-225 — despacho e retry
// =============================================================================

describe('T-225 — falha de envio não perde a notificação', () => {
  beforeEach(async () => {
    const config = new Config(db)
    await config.definir('canal_notificacao_padrao', 'chat', CHEFE, AGORA)
    await montar()
  })

  it('envio bem-sucedido marca `enviada` e audita SEM o corpo da mensagem', async () => {
    await abrirChamado()
    const r = await enviarFila()
    expect((await r.json()).enviadas).toBe(1)
    expect((await fila())[0]?.estado).toBe('enviada')

    const auditado = linhasComoObjetos<{ detalhe_json: string }>(
      await db.query(
        `SELECT detalhe_json FROM auditoria WHERE acao = 'notificacao_enviada'`,
        [],
      ),
    )
    expect(auditado[0]?.detalhe_json).toContain('chamado_criado')
    // ⚠️ O corpo carrega trecho de chamado, e a auditoria é lida por admin (RF-30).
    expect(auditado[0]?.detalhe_json).not.toContain('Notebook não liga')
  })

  it('falha TRANSITÓRIA volta para `pendente` — o cron tenta de novo', async () => {
    await abrirChamado()
    // Em modo fake, `ctx.canalPor` devolve sempre a MESMA instância — ver `contexto.ts`.
    const fake = ctx.canalPor('chat') as CanalFake
    fake.falha = 'transitorio'

    const r = await enviarFila()
    expect((await r.json()).falhas).toBe(1)
    const linhas = await fila()
    expect(linhas[0]?.estado).toBe('pendente')
    expect(linhas[0]?.tentativas).toBe(1)

    // Canal voltou: a MESMA notificação é entregue, nada se perdeu.
    fake.falha = 'nenhum'
    expect((await (await enviarFila()).json()).enviadas).toBe(1)
    expect((await fila())[0]?.estado).toBe('enviada')
  })

  it('falha DEFINITIVA vira `falha` na primeira tentativa — insistir não resolve', async () => {
    await abrirChamado()
    ;(ctx.canalPor('chat') as CanalFake).falha = 'definitivo'
    await enviarFila()
    const linhas = await fila()
    expect(linhas[0]?.estado).toBe('falha')
    expect(linhas[0]?.tentativas).toBe(1)
  })

  it('transitório repetido desiste no teto de tentativas, sem laço infinito', async () => {
    await abrirChamado()
    ;(ctx.canalPor('chat') as CanalFake).falha = 'transitorio'
    for (let i = 0; i < MAX_TENTATIVAS_ENVIO; i += 1) await enviarFila()
    const linhas = await fila()
    expect(linhas[0]?.estado).toBe('falha')
    expect(linhas[0]?.tentativas).toBe(MAX_TENTATIVAS_ENVIO)
  })

  it('o erro guardado NÃO cresce sem limite', async () => {
    await abrirChamado()
    const fake = ctx.canalPor('chat') as CanalFake
    fake.falha = 'transitorio'
    await enviarFila()
    const erro = String((await fila())[0]?.ultimo_erro ?? '')
    expect(erro.length).toBeLessThanOrEqual(500)
  })
})

// =============================================================================
// Os canais, isoladamente
// =============================================================================

describe('CanalIndisponivel — ausência de configuração nega e denuncia', () => {
  it('lança erro DEFINITIVO, nunca finge envio', async () => {
    const canal = new CanalIndisponivel()
    await expect(canal.enviar()).rejects.toThrow(/nenhum canal/i)
    await canal.enviar().catch((e: unknown) => {
      expect(e).toBeInstanceOf(ErroCanal)
      expect((e as ErroCanal).detalhe.transitorio).toBe(false)
    })
    expect((await canal.verificarSaude()).ok).toBe(false)
  })
})

describe('CanalGoogleChat — T-222', () => {
  it('posta no webhook do espaço, com título em destaque', async () => {
    const chamadas: { url: string; corpo: string }[] = []
    const canal = new CanalGoogleChat({
      endpoint: 'https://chat.googleapis.com/v1/spaces/AAA/messages?key=x',
      fetchImpl: (async (url: string, init?: RequestInit) => {
        chamadas.push({ url: String(url), corpo: String(init?.body ?? '') })
        return new Response('{}', { status: 200 })
      }) as unknown as typeof fetch,
    })
    await canal.enviar('', {
      titulo: 'Chamado GOATLAS-1 aberto',
      corpo: 'Prazo de **primeira resposta**: até 12h.',
      link: 'https://goatlas.devgogroup.com/?chamado=GOATLAS-1',
    })
    expect(chamadas[0]?.url).toContain('chat.googleapis.com')
    const enviado = JSON.parse(chamadas[0]!.corpo) as { text: string }
    expect(enviado.text).toContain('GOATLAS-1')
    expect(enviado.text).toContain('primeira resposta')
    expect(enviado.text).toContain('goatlas.devgogroup.com')
  })

  it('sem endpoint configurado, é DEFINITIVO — não retenta contra config inexistente', async () => {
    const canal = new CanalGoogleChat({ endpoint: null })
    await canal.enviar('', { titulo: 't', corpo: 'c', link: null }).catch((e: unknown) => {
      expect((e as ErroCanal).detalhe.transitorio).toBe(false)
    })
  })

  it('429 e 5xx são transitórios; 400 é definitivo', async () => {
    const comStatus = (status: number) =>
      new CanalGoogleChat({
        endpoint: 'https://chat.googleapis.com/x',
        fetchImpl: (async () => new Response('{}', { status })) as unknown as typeof fetch,
      })
    for (const [status, transitorio] of [
      [429, true],
      [503, true],
      [400, false],
    ] as const) {
      await comStatus(status)
        .enviar('d', { titulo: 't', corpo: 'c', link: null })
        .catch((e: unknown) => {
          expect((e as ErroCanal).detalhe.transitorio).toBe(transitorio)
        })
    }
  })

  it('RNF-01 — a mensagem de erro não carrega o corpo da resposta do provedor', async () => {
    const canal = new CanalGoogleChat({
      endpoint: 'https://chat.googleapis.com/x',
      fetchImpl: (async () =>
        new Response(JSON.stringify({ error: 'token AAA-secreto-123 inválido' }), {
          status: 403,
        })) as unknown as typeof fetch,
    })
    await expect(canal.enviar('d', { titulo: 't', corpo: 'c', link: null })).rejects.not.toThrow(
      /AAA-secreto-123/,
    )
  })
})

describe('CanalEmail — T-223', () => {
  it('manda pelo provedor HTTP, com remetente e assunto', async () => {
    let corpo = ''
    let auth: string | null = null
    const canal = new CanalEmail({
      endpoint: 'https://api.provedor.example/send',
      remetente: 'goatlas@gocase.com',
      apiKey: 'chave-de-teste',
      fetchImpl: (async (_u: string, init?: RequestInit) => {
        corpo = String(init?.body ?? '')
        auth = new Headers(init?.headers).get('Authorization')
        return new Response('{}', { status: 202 })
      }) as unknown as typeof fetch,
    })
    await canal.enviar('ana@gocase.com', {
      titulo: 'Chamado GOATLAS-1 aberto',
      corpo: 'Prazo de primeira resposta: 12h.',
      link: null,
    })
    const enviado = JSON.parse(corpo) as { to: string; from: string; subject: string }
    expect(enviado.to).toBe('ana@gocase.com')
    expect(enviado.from).toBe('goatlas@gocase.com')
    expect(enviado.subject).toContain('GOATLAS-1')
    expect(auth).toBe('Bearer chave-de-teste')
  })

  it('sem destinatário ou sem provedor, recusa como definitivo', async () => {
    const semProvedor = new CanalEmail({ endpoint: null })
    await semProvedor.enviar('a@b.com', { titulo: 't', corpo: 'c', link: null }).catch((e: unknown) => {
      expect((e as ErroCanal).detalhe.transitorio).toBe(false)
    })
    const semDestino = new CanalEmail({ endpoint: 'https://x/send' })
    await semDestino.enviar('', { titulo: 't', corpo: 'c', link: null }).catch((e: unknown) => {
      expect((e as ErroCanal).detalhe.transitorio).toBe(false)
    })
  })
})

// =============================================================================
// T-224 — preferências
// =============================================================================

describe('T-224 — preferência de canal', () => {
  it('GET distingue "escolhi não receber" de "ninguém definiu canal ainda"', async () => {
    const semQ11 = await (await chamar(req('/api/preferencias', { email: ANA }))).json()
    expect(semQ11.canal).toBe('nenhum')
    expect(semQ11.escolhidaPelaPessoa).toBe(false)
    expect(semQ11.canalPadraoDefinido).toBe(false)

    await chamar(
      req('/api/preferencias', { metodo: 'PUT', email: ANA, corpo: { canal: 'nenhum' } }),
    )
    const escolhido = await (await chamar(req('/api/preferencias', { email: ANA }))).json()
    expect(escolhido.canal).toBe('nenhum')
    expect(escolhido.escolhidaPelaPessoa).toBe(true)
  })

  it('a escolha da pessoa vence o default da config', async () => {
    const config = new Config(db)
    await config.definir('canal_notificacao_padrao', 'chat', CHEFE, AGORA)
    await montar()
    await chamar(
      req('/api/preferencias', { metodo: 'PUT', email: ANA, corpo: { canal: 'nenhum' } }),
    )
    await abrirChamado()
    expect((await fila())[0]?.estado).toBe('suprimida')
  })

  it('a preferência é POR PESSOA — a escolha da Ana não afeta ninguém', async () => {
    const config = new Config(db)
    await config.definir('canal_notificacao_padrao', 'chat', CHEFE, AGORA)
    await montar()
    await chamar(
      req('/api/preferencias', { metodo: 'PUT', email: ANA, corpo: { canal: 'nenhum' } }),
    )
    const doOutro = await (
      await chamar(req('/api/preferencias', { email: 'bruno@gocase.com' }))
    ).json()
    expect(doOutro.canal).toBe('chat')
    expect(doOutro.escolhidaPelaPessoa).toBe(false)
  })

  it('a auditoria registra a mudança SEM o endereço alternativo', async () => {
    await chamar(
      req('/api/preferencias', {
        metodo: 'PUT',
        email: ANA,
        corpo: { canal: 'email', destino: 'ana.pessoal@gmail.com' },
      }),
    )
    const linhas = linhasComoObjetos<{ detalhe_json: string }>(
      await db.query(
        `SELECT detalhe_json FROM auditoria WHERE acao = 'preferencia_alterada'`,
        [],
      ),
    )
    expect(linhas[0]?.detalhe_json).toContain('email')
    // Endereço pessoal não vai para o log que o admin lê.
    expect(linhas[0]?.detalhe_json).not.toContain('ana.pessoal@gmail.com')
  })
})

describe('validarPreferencia — o destino não é escolha livre (não somos relay)', () => {
  it('canal inválido é recusado', () => {
    expect(validarPreferencia({ canal: 'sms' })).toHaveProperty('erro')
    expect(validarPreferencia({})).toHaveProperty('erro')
  })

  it('destino só vale para e-mail, e tem de ser e-mail', () => {
    // ⚠️ Um destino livre viraria exfiltração: "notifique o chamado no webhook que eu
    // escolhi" manda conteúdo de chamado para fora com a nossa credencial.
    expect(validarPreferencia({ canal: 'chat', destino: 'https://evil.example/hook' })).toHaveProperty(
      'erro',
    )
    expect(validarPreferencia({ canal: 'email', destino: 'https://evil.example/hook' })).toHaveProperty(
      'erro',
    )
    expect(validarPreferencia({ canal: 'email', destino: 'ANA@Gocase.com' })).toEqual({
      canal: 'email',
      destino: 'ana@gocase.com',
    })
  })

  it('sem destino, usa o e-mail que o app já conhece', () => {
    expect(validarPreferencia({ canal: 'email' })).toEqual({ canal: 'email', destino: null })
  })
})
