/**
 * T-230 / T-231 — SLA de **primeira resposta** (RF-46, RN-08).
 *
 * O que estes testes trancam:
 *
 * - É **primeira resposta**, não resolução. O chamado pode ficar aberto por semanas
 *   depois de respondido sem violar nada.
 * - É **hora corrida** e **UTC**. Se um dia virar horário útil, é aqui que muda — e este
 *   teste é o que documenta a escolha atual.
 * - "Respondido" é comentário público **de outra pessoa**, e sob proxy total isso só é
 *   distinguível pelo prefixo que o próprio app escreve (`D-13`). O teste gera com
 *   `prefixarAutoria` e lê com `ehComentarioDoSolicitante` — divergir quebra a suíte em
 *   vez de inflar a aderência silenciosamente.
 * - Alerta **não repete** a cada rodada do cron.
 *
 * _Requirements: RF-46, RF-55, RN-08, R-05_
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
import { aderenciaSla, avaliarSla, prazoEmMs, primeiraRespostaDoTime } from '@/lib/notificacoes/sla'
import { ehComentarioDoSolicitante, prefixarAutoria } from '@/lib/atlassian/comentarios'
import { SLA_PRIMEIRA_RESPOSTA_HORAS } from '@/lib/atlassian/tipos'
import { mensagemChamadoCriado, mensagemSlaEmRisco } from '@/lib/notificacoes/mensagens'

const CRIADO = '2026-08-06T00:00:00.000Z'
const HORA = 3_600_000

describe('T-230 — o prazo é por prioridade, em hora corrida e em UTC', () => {
  it('crítica 4h, alta 12h, normal 24h', () => {
    const base = Date.parse(CRIADO)
    expect(prazoEmMs(base, 'critica') - base).toBe(4 * HORA)
    expect(prazoEmMs(base, 'alta') - base).toBe(12 * HORA)
    expect(prazoEmMs(base, 'normal') - base).toBe(24 * HORA)
  })

  it('conta HORA CORRIDA — atravessar a noite e o fim de semana não pausa o prazo', () => {
    // Sexta 22:00 UTC + 12h = sábado 10:00. Horário útil daria segunda; o requisito diz
    // hora corrida, e mudar isso é mudança de requisito.
    const sexta = Date.parse('2026-08-07T22:00:00.000Z')
    expect(new Date(prazoEmMs(sexta, 'alta')).toISOString()).toBe('2026-08-08T10:00:00.000Z')
  })

  it('o prazo não muda com o fuso de quem calcula — é sempre UTC', () => {
    const comZ = avaliarSla({
      criadoEm: '2026-08-06T00:00:00.000Z',
      prioridade: 'normal',
      primeiraRespostaEm: null,
      agoraMs: Date.parse('2026-08-06T01:00:00.000Z'),
      fracaoAviso: 0.75,
    })
    const comOffset = avaliarSla({
      criadoEm: '2026-08-05T21:00:00.000-0300',
      prioridade: 'normal',
      primeiraRespostaEm: null,
      agoraMs: Date.parse('2026-08-06T01:00:00.000Z'),
      fracaoAviso: 0.75,
    })
    expect(comOffset.prazoEm).toBe(comZ.prazoEm)
  })

  it('`ok` antes do limiar, `risco` depois dele, `estourado` passado o prazo', () => {
    const avaliar = (horasDecorridas: number) =>
      avaliarSla({
        criadoEm: CRIADO,
        prioridade: 'normal',
        primeiraRespostaEm: null,
        agoraMs: Date.parse(CRIADO) + horasDecorridas * HORA,
        fracaoAviso: 0.75,
      }).estado

    expect(avaliar(1)).toBe('ok')
    expect(avaliar(17)).toBe('ok')
    expect(avaliar(18)).toBe('risco') // 75% de 24h
    expect(avaliar(23)).toBe('risco')
    expect(avaliar(25)).toBe('estourado')
  })

  it('o limiar é configurável — é o que permite calibrar no piloto sem deploy', () => {
    const aos50 = avaliarSla({
      criadoEm: CRIADO,
      prioridade: 'normal',
      primeiraRespostaEm: null,
      agoraMs: Date.parse(CRIADO) + 13 * HORA,
      fracaoAviso: 0.5,
    })
    expect(aos50.estado).toBe('risco')
  })

  it('respondido é `respondido`, mesmo depois do prazo — o SLA é de PRIMEIRA RESPOSTA', () => {
    const r = avaliarSla({
      criadoEm: CRIADO,
      prioridade: 'normal',
      primeiraRespostaEm: '2026-08-06T02:00:00.000Z',
      // Cinco dias depois: o chamado segue aberto, e isso não viola este SLA.
      agoraMs: Date.parse(CRIADO) + 120 * HORA,
      fracaoAviso: 0.75,
    })
    expect(r.estado).toBe('respondido')
    expect(r.horasRestantes).toBeNull()
  })

  it('data de criação ilegível vira `ok`, nunca `estourado`', () => {
    // Alerta falso de SLA treina o time a ignorar o alerta. Dado ruim é problema de
    // leitura, não do chamado de alguém.
    const r = avaliarSla({
      criadoEm: 'ontem',
      prioridade: 'critica',
      primeiraRespostaEm: null,
      agoraMs: Date.parse(CRIADO),
      fracaoAviso: 0.75,
    })
    expect(r.estado).toBe('ok')
  })
})

describe('primeiraRespostaDoTime — o par de `prefixarAutoria` (D-13)', () => {
  it('comentário DO SOLICITANTE, gerado por `prefixarAutoria`, não conta como resposta', () => {
    // ⚠️ Este é o teste que acopla os dois lados: se alguém mudar o formato do prefixo em
    // `comentarios.ts` e não o reconhecimento, isto quebra — em vez de a aderência ao SLA
    // subir sem ninguém ter respondido nada.
    const doSolicitante = prefixarAutoria(
      'A impressora voltou a falhar.',
      'Ana Souza',
      'ana@gocase.com',
    )
    expect(ehComentarioDoSolicitante(doSolicitante)).toBe(true)
    expect(
      primeiraRespostaDoTime(
        [{ corpo: doSolicitante, criadoEm: '2026-08-06T01:00:00.000Z' }],
        ehComentarioDoSolicitante,
      ),
    ).toBeNull()
  })

  it('comentário do time (sem prefixo) conta, e vale o MAIS ANTIGO', () => {
    const r = primeiraRespostaDoTime(
      [
        { corpo: 'Vamos verificar.', criadoEm: '2026-08-06T05:00:00.000Z' },
        { corpo: 'Resolvido.', criadoEm: '2026-08-06T03:00:00.000Z' },
      ],
      ehComentarioDoSolicitante,
    )
    expect(r).toBe('2026-08-06T03:00:00.000Z')
  })

  it('carimbo inválido é descartado em vez de virar a primeira resposta', () => {
    const r = primeiraRespostaDoTime(
      [
        { corpo: 'Vamos verificar.', criadoEm: '' },
        { corpo: 'Ainda olhando.', criadoEm: '2026-08-06T06:00:00.000Z' },
      ],
      ehComentarioDoSolicitante,
    )
    expect(r).toBe('2026-08-06T06:00:00.000Z')
  })
})

describe('aderenciaSla — taxa sem dado é `null`, nunca 0%', () => {
  it('sem nenhum respondido, `null`', () => {
    expect(aderenciaSla([{ estado: 'ok', dentroDoPrazo: false }]).taxa).toBeNull()
  })

  it('com respondidos, calcula', () => {
    const r = aderenciaSla([
      { estado: 'respondido', dentroDoPrazo: true },
      { estado: 'respondido', dentroDoPrazo: false },
      { estado: 'ok', dentroDoPrazo: false },
    ])
    expect(r.total).toBe(2)
    expect(r.taxa).toBe(0.5)
  })
})

describe('RN-08 / R-05 — o texto diz "primeira resposta", e diz que é piso', () => {
  it('a mensagem de criação usa a expressão obrigatória', () => {
    const m = mensagemChamadoCriado({
      issueKey: 'ATLAS-1',
      titulo: 'Impressora',
      prioridade: 'normal',
      slaPrimeiraRespostaHoras: SLA_PRIMEIRA_RESPOSTA_HORAS.normal,
      baseApp: 'https://atlas.devgogroup.com',
    })
    expect(m.corpo).toMatch(/primeira resposta/i)
    // R-05: 24h é PISO GARANTIDO. Áreas que hoje respondem em 2h30 não podem ler isto
    // como "agora vai levar um dia".
    expect(m.corpo).toMatch(/prazo máximo|bem antes/i)
    expect(m.corpo).not.toMatch(/prazo de (solução|resolução) de \d+h/i)
  })

  it('o alerta de SLA também diz de QUE prazo está falando', () => {
    const m = mensagemSlaEmRisco({
      issueKey: 'ATLAS-1',
      horasRestantes: 4,
      estourado: false,
      baseApp: null,
    })
    expect(m.titulo).toMatch(/primeira resposta/i)
    expect(m.corpo).toMatch(/primeira resposta/i)
  })

  it('a mensagem linka para DENTRO do app, nunca para atlassian.net', () => {
    const m = mensagemChamadoCriado({
      issueKey: 'ATLAS-1',
      titulo: 'x',
      prioridade: 'alta',
      slaPrimeiraRespostaHoras: 12,
      baseApp: 'https://atlas.devgogroup.com/',
    })
    expect(m.link).toBe('https://atlas.devgogroup.com/?chamado=ATLAS-1')
    expect(m.link).not.toMatch(/atlassian\.net/)
  })

  it('sem base pública configurada, a mensagem vai SEM link (não com link quebrado)', () => {
    const m = mensagemChamadoCriado({
      issueKey: 'ATLAS-1',
      titulo: 'x',
      prioridade: 'alta',
      slaPrimeiraRespostaHoras: 12,
      baseApp: null,
    })
    expect(m.link).toBeNull()
  })
})

// =============================================================================
// T-231 — o cron
// =============================================================================

const ANA = 'ana@gocase.com'
const CHEFE = 'chefe@gocase.com'
const CRON_KEY = 'chave-cron'

let db: SqliteLocal
let ctx: Contexto
let atlassian: ClienteAtlassianFake
let n = 0
let agora = '2026-08-06T12:00:00.000Z'

async function montar() {
  ctx = await montarContexto(
    { DB: db, ATLAS_USAR_FAKES: '1' },
    () => agora,
    () => `id-${++n}`,
    { atlassian },
  )
}

beforeEach(async () => {
  db = new SqliteLocal()
  await migrar(db)
  n = 0
  agora = '2026-08-06T12:00:00.000Z'
  atlassian = new ClienteAtlassianFake({
    tiposChamado: [{ id: 'rt-1', serviceDeskId: 'sd-1', nome: 'Suporte', descricao: null }],
    // Chamado criado AGORA, não em 1970: é o que permite distinguir "dentro do prazo" de
    // "estourado por construção".
    relogio: () => agora,
  })
  const config = new Config(db)
  await config.definir('dominios_permitidos', ['gocase.com'], CHEFE, agora)
  await config.definir('admins', [CHEFE], CHEFE, agora)
  await config.definir('service_desk_id', 'sd-1', CHEFE, agora)
  await config.definir('tipos_chamado_permitidos', ['rt-1'], CHEFE, agora)
  await config.definir('canal_notificacao_padrao', 'chat', CHEFE, agora)
  await montar()
})

const chamar = (r: Request) => tratarRequisicao(r, ctx, { GODEPLOY_CRON_KEY: CRON_KEY })

function req(caminho: string, o: { metodo?: string; email?: string; headers?: Record<string, string>; corpo?: unknown } = {}) {
  const headers: Record<string, string> = { ...o.headers }
  if (o.email) headers[HEADER_EMAIL] = o.email
  if (o.corpo !== undefined) headers['content-type'] = 'application/json'
  return new Request(`https://atlas.devgogroup.com${caminho}`, {
    method: o.metodo ?? 'GET',
    headers,
    ...(o.corpo === undefined ? {} : { body: JSON.stringify(o.corpo) }),
  })
}

async function abrirChamado(prioridade = 'normal'): Promise<string> {
  const r = await chamar(
    req('/api/chamados', {
      metodo: 'POST',
      email: ANA,
      corpo: {
        titulo: 'Sistema fora do ar',
        descricao: 'Não consigo acessar o painel de pedidos desde as 9h.',
        tipoChamadoId: 'rt-1',
        prioridade,
        chaveIdempotencia: `k-${prioridade}`,
      },
    }),
  )
  return (await r.json()).issueKey as string
}

const rodarAlertas = () =>
  chamar(req('/api/cron/alertas-sla', { metodo: 'POST', headers: { 'x-godeploy-cron': CRON_KEY } }))

describe('T-231 — o cron de alerta de SLA', () => {
  it('chamado dentro do prazo não gera alerta', async () => {
    await abrirChamado()
    const r = await rodarAlertas()
    expect((await r.json()).alertados).toBe(0)
  })

  it('chamado em risco gera alerta UMA vez, não a cada rodada', async () => {
    const issueKey = await abrirChamado('critica')
    // Cinco horas depois: prioridade crítica tem prazo de 4h, então estourou.
    agora = '2026-08-06T17:00:00.000Z'
    await montar()

    const primeira = await rodarAlertas()
    expect((await primeira.json()).alertados).toBe(1)

    const segunda = await rodarAlertas()
    expect((await segunda.json()).alertados).toBe(0)

    const alertas = linhasComoObjetos<{ issue_key: string; limiar: string }>(
      await db.query('SELECT issue_key, limiar FROM alertas_sla', []),
    )
    expect(alertas).toEqual([{ issue_key: issueKey, limiar: 'estourado' }])
  })

  it('grava o RETRATO da avaliação mesmo quando não alerta — é o que o painel lê', async () => {
    const issueKey = await abrirChamado()
    atlassian.simularMudancaDoTime(issueKey, {
      comentarioPublico: {
        corpo: 'Já estamos olhando.',
        autorNome: 'Suporte Tech',
        criadoEm: '2026-08-06T12:30:00.000Z',
      },
    })
    await rodarAlertas()

    const linhas = linhasComoObjetos<Record<string, unknown>>(
      await db.query('SELECT issue_key, estado, dentro_do_prazo FROM avaliacoes_sla', []),
    )
    expect(linhas).toHaveLength(1)
    expect(linhas[0]?.estado).toBe('respondido')
    // Respondido 30 min depois de criado, prazo de 24h: dentro.
    expect(linhas[0]?.dentro_do_prazo).toBe(1)
  })

  it('a aderência aparece no painel de admin — sem chamar a Atlassian de novo', async () => {
    const issueKey = await abrirChamado()
    atlassian.simularMudancaDoTime(issueKey, {
      comentarioPublico: {
        corpo: 'Respondendo.',
        autorNome: 'Suporte Tech',
        criadoEm: '2026-08-06T12:10:00.000Z',
      },
    })
    await rodarAlertas()

    const antes = atlassian.chamadas.length
    const corpo = await (await chamar(req('/api/admin/metricas', { email: CHEFE }))).json()
    expect(corpo.painel.sla.respondidos).toBe(1)
    expect(corpo.painel.sla.aderenciaPct).toBe(100)
    // ⚠️ O painel NÃO toca a Atlassian: abrir o console não pode custar uma varredura.
    expect(atlassian.chamadas.length).toBe(antes)
  })

  it('sem nenhuma avaliação ainda, a aderência é `null` — nunca 0%', async () => {
    const corpo = await (await chamar(req('/api/admin/metricas', { email: CHEFE }))).json()
    expect(corpo.painel.sla.aderenciaPct).toBeNull()
  })

  it('Atlassian fora do ar não derruba a rodada', async () => {
    await abrirChamado()
    atlassian.estado.falhas.listarComentarios = 'indisponivel'
    const r = await rodarAlertas()
    expect(r.status).toBe(200)
    expect((await r.json()).alertados).toBe(0)
  })
})
