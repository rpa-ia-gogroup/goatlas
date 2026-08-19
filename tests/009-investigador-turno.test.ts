/**
 * O caso de 14/08/2026, virado em asserção — spec 009, `SC-1`, `SC-2`, `SC-5`, `SC-7`, `SC-10`.
 *
 * ## O relato
 *
 * Uma pessoa usou o app publicado por 70 minutos, mandou **seis mensagens** ao agente, o
 * cartão de confirmação **nunca apareceu**, ela tentou o formulário direto e foi embora sem
 * abrir chamado. Perguntado o motivo, o projeto inteiro não tinha resposta: `getAppLogs`
 * registra método e caminho de `/api/*` e mais nada, a `auditoria` sabe que houve seis
 * `mensagem_enviada` e **não pode** saber o resto (`RN-10`), e a tela já tinha ido embora
 * com a pessoa.
 *
 * O que este arquivo prova é que essa pergunta passa a ter resposta — e que a resposta
 * distingue **por que** não houve proposta, que é o ponto: `interpretarProposta` recusa em
 * quatro situações e as quatro chegam à tela idênticas.
 *
 * _Requirements: FR-5, FR-6, FR-9, FR-11, FR-18, FR-19, FR-20_
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { SqliteLocal } from '@/lib/db/sqlite-local'
import { migrar } from '@/lib/db/schema'
import { Config } from '@/lib/config'
import { montarContexto, type Contexto } from '@/lib/contexto'
import { tratarRequisicao } from '@/lib/http/rotas'
import { HEADER_EMAIL } from '@/lib/auth'
import { ClienteAtlassianFake } from '@/lib/atlassian/fake'
import { ClienteIAFake } from '@/lib/ia/fake'
import { ClienteIAHttp } from '@/lib/ia/cliente'
import { linhasComoObjetos } from '@/lib/db/tipos'
import { expurgarInvestigador, listarSessoes } from '@/lib/investigador/leitura'

const ANA = 'ana@gocase.com'
const CHEFE = 'chefe@gocase.com'
const AGORA = '2026-08-14T13:00:00.000Z'

let db: SqliteLocal
let ctx: Contexto
let ia: ClienteIAFake
let n = 0

async function montar(extras: Record<string, string> = {}, ligado = true) {
  db = new SqliteLocal()
  await migrar(db)
  n = 0
  const config = new Config(db)
  await config.definir('dominios_permitidos', ['gocase.com'], CHEFE, AGORA)
  await config.definir('admins', [CHEFE], CHEFE, AGORA)
  await config.definir('tipos_chamado_permitidos', ['rt-1'], CHEFE, AGORA)
  await config.definir('service_desk_id', 'sd-1', CHEFE, AGORA)
  if (!ligado) await config.definir('investigador_ligado', false, CHEFE, AGORA)
  ctx = await montarContexto(
    { DB: db, ATLAS_USAR_FAKES: '1', ...extras },
    () => AGORA,
    () => `id-${++n}`,
  )
  const atlassian = ctx.atlassian as ClienteAtlassianFake
  atlassian.estado.tiposChamado = [
    { id: 'rt-1', serviceDeskId: 'sd-1', nome: 'Relatar um problema', descricao: null },
  ]
  ia = ctx.ia as ClienteIAFake
  // O turno normal: o modelo pede as duas verificações e depois responde em texto.
  ia.definirRoteiro([
    {
      texto: 'Deixa eu conferir a documentação.',
      toolsPropostas: [
        { nome: 'search_confluence', argumentos: { topico: 'protheus fora do ar' } },
        { nome: 'check_jira_history', argumentos: { tipoProblema: 'protheus' } },
      ],
    },
    { texto: 'Entendi. Pode me contar mais?' },
  ])
  ia.repetirRoteiro = true
}

beforeEach(async () => {
  await montar()
})

function req(caminho: string, corpo?: unknown, metodo = 'POST', quem = ANA): Request {
  return new Request(`https://atlas.devgogroup.com${caminho}`, {
    method: metodo,
    headers: { [HEADER_EMAIL]: quem, ...(corpo === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(corpo === undefined ? {} : { body: JSON.stringify(corpo) }),
  })
}

const chamar = (r: Request) => tratarRequisicao(r, ctx, {})

async function conversar(texto: string): Promise<string> {
  const criada = await chamar(req('/api/conversas'))
  const { id } = (await criada.json()) as { id: string }
  await chamar(req(`/api/conversas/${id}/mensagens`, { texto }))
  return id
}

async function eventos(tipo?: string) {
  const r = await db.query(
    tipo
      ? `SELECT * FROM investigador_eventos WHERE tipo = ? ORDER BY criado_em, ordem`
      : `SELECT * FROM investigador_eventos ORDER BY criado_em, ordem`,
    tipo ? [tipo] : [],
  )
  return linhasComoObjetos<{
    tipo: string
    origem: string
    resumo: string
    dados_json: string | null
    conversa_id: string | null
  }>(r)
}

describe('SC-1 — por que o cartão não apareceu', () => {
  it('sem proposta, o registro diz QUAL das recusas aconteceu', async () => {
    // O modelo devolve uma proposta de um tipo que o admin não liberou: é uma das quatro
    // situações que `interpretarProposta` colapsa em `proposta: null`.
    ia.propostaSugerida = {
      titulo: 'Protheus fora do ar',
      descricao: 'Ninguém consegue emitir nota fiscal.',
      tipoChamadoId: 'rt-NAO-LIBERADO',
      prioridade: 'critica',
      area: null,
      motivoPrioridade: null,
      campos: [],
    }
    await conversar('o Protheus está fora do ar')

    const recusas = await eventos('ia_extracao_recusada')
    expect(recusas).toHaveLength(1)
    const dados = JSON.parse(recusas[0]!.dados_json!) as Record<string, unknown>
    expect(dados.motivo).toBe('extracao_sem_proposta')
    // 🚨 O campo que responde à pergunta: sem ele, "o modelo não achou que dava" e "o modelo
    // escolheu uma fila que o admin não liberou" seriam a mesma linha.
    expect(String(dados.respostaBrutaDoModelo)).toContain('rt-NAO-LIBERADO')
  })

  it('allowlist vazia é um motivo DIFERENTE — pede outro trabalho de quem investiga', async () => {
    await new Config(db).definir('tipos_chamado_permitidos', [], CHEFE, AGORA)
    ctx = await montarContexto({ DB: db, ATLAS_USAR_FAKES: '1' }, () => AGORA, () => `id-${++n}`)
    // ⚠️ As duas tools precisam rodar: sem as verificações concluídas o servidor nem tenta
    // montar proposta (`RF-08`), e o motivo que se quer medir é o do passo seguinte.
    ;(ctx.ia as ClienteIAFake).definirRoteiro([
      {
        texto: 'Deixa eu conferir.',
        toolsPropostas: [
          { nome: 'search_confluence', argumentos: { topico: 'pc desligando' } },
          { nome: 'check_jira_history', argumentos: { tipoProblema: 'hardware' } },
        ],
      },
      { texto: 'Me conta mais.' },
    ])
    await conversar('meu PC desliga sozinho')

    const dados = JSON.parse((await eventos('ia_extracao_recusada'))[0]!.dados_json!) as {
      motivo: string
    }
    expect(dados.motivo).toBe('allowlist_de_tipos_vazia')
  })

  it('a lista de sessões nomeia o motivo, sem ninguém abrir o banco', async () => {
    ia.propostaSugerida = null
    const conversaId = await conversar('meu PC desliga sozinho')
    const sessoes = await listarSessoes(db)
    const nossa = sessoes.find((s) => s.conversaId === conversaId)!
    expect(nossa.temProposta).toBe(false)
    expect(nossa.mensagensDaPessoa).toBe(1)
    expect(nossa.motivoSemProposta).toBe('extracao_sem_proposta')
  })
})

describe('SC-2 — a linha do tempo do turno', () => {
  it('registra mensagem, ida ao modelo, tools e resposta, nesta ordem', async () => {
    await conversar('o Protheus está fora do ar')
    const tipos = (await eventos()).map((e) => e.tipo)
    expect(tipos[0]).toBe('mensagem_usuario')
    expect(tipos).toContain('ia_chat')
    expect(tipos.filter((t) => t === 'tool_executada')).toHaveLength(2)
    expect(tipos[tipos.length - 1]).toBe('resposta_agente')
  })

  it('a ida ao modelo guarda os DOIS lados: o que foi enviado e o que voltou', async () => {
    await conversar('o Protheus está fora do ar')
    const chat = (await eventos('ia_chat'))[0]!
    const dados = JSON.parse(chat.dados_json!) as {
      historicoEnviado: { papel: string; conteudo: string }[]
      textoDoModelo: string
      toolsPermitidas: string[]
      toolsPropostas: unknown[]
    }
    expect(dados.historicoEnviado.some((m) => m.conteudo.includes('Protheus'))).toBe(true)
    expect(dados.textoDoModelo).toContain('documentação')
    expect(dados.toolsPermitidas).toContain('search_confluence')
    expect(dados.toolsPropostas).toHaveLength(2)
  })

  it('a chamada externa aparece com alvo, caminho e status — o ponto de ruptura', async () => {
    // O fake não faz rede; a prova de que o `fetch` embrulhado registra está em
    // `009-investigador-coleta.test.ts`. Aqui o que se afirma é que a coluna existe e que a
    // origem `atlassian` é uma das seis reconhecidas.
    const coleta = ctx.investigador
    coleta.observador()({
      alvo: 'atlassian',
      metodo: 'GET',
      caminho: '/rest/api/3/search',
      status: 429,
      duracaoMs: 2100,
    })
    await conversar('teste')
    const externas = await eventos('chamada_externa')
    expect(externas).toHaveLength(1)
    expect(externas[0]!.origem).toBe('atlassian')
    expect(externas[0]!.resumo).toContain('429')
  })

  it('cada requisição vira UMA linha, com status, duração e os dois corpos', async () => {
    await conversar('o Protheus está fora do ar')
    const linhas = linhasComoObjetos<{
      caminho: string
      metodo: string
      status: number
      req_json: string | null
      resp_json: string | null
    }>(await db.query(`SELECT * FROM investigador_requisicoes ORDER BY criado_em`, []))
    const mensagem = linhas.find((l) => l.caminho.endsWith('/mensagens'))!
    expect(mensagem.metodo).toBe('POST')
    expect(mensagem.status).toBe(200)
    expect(mensagem.req_json).toContain('Protheus')
    expect(mensagem.resp_json).toContain('verificacoes')
  })
})

describe('SC-8 — a lista de sessões não tem N+1', () => {
  /**
   * 🚨 **O Investigador do godocs pagou esta lição em produção.** Um `getChatMessages(p.id)`
   * dentro do laço de projetos virou uma ida ao banco **por projeto, com o texto completo das
   * mensagens**, e o endpoint passou a responder 500/503 — com a lista vazia e os contadores
   * mentindo na tela. A afirmação aqui é sobre **contagem de consultas**, e ela é constante:
   * três sessões custam o mesmo que trinta.
   */
  it('o número de consultas não cresce com o número de sessões', async () => {
    for (const texto of ['um', 'dois', 'três']) await conversar(texto)

    let consultas = 0
    const espiao = {
      query: (sql: string, params: readonly unknown[]) => {
        consultas += 1
        return db.query(sql, params)
      },
      exec: (sql: string, params: readonly unknown[]) => db.exec(sql, params),
    }
    const comTres = await listarSessoes(espiao)
    expect(comTres.length).toBe(3)
    const custoDeTres = consultas

    for (const texto of ['quatro', 'cinco', 'seis', 'sete']) await conversar(texto)
    consultas = 0
    const comSete = await listarSessoes(espiao)
    expect(comSete.length).toBe(7)
    expect(consultas).toBe(custoDeTres)
  })
})

describe('SC-5 — desligado não escreve', () => {
  it('nenhuma linha nova, e o app funciona igual', async () => {
    await montar({}, false)
    ia.propostaSugerida = null
    const r = await chamar(req('/api/conversas'))
    expect(r.status).toBe(201)
    await conversar('meu PC desliga sozinho')

    expect(await eventos()).toHaveLength(0)
    const req0 = await db.query(`SELECT COUNT(*) AS t FROM investigador_requisicoes`, [])
    expect(Number(linhasComoObjetos<{ t: number }>(req0)[0]!.t)).toBe(0)
  })
})

describe('SC-7 — o gate é do servidor', () => {
  it('colaborador comum é recusado nas quatro rotas de leitura', async () => {
    for (const caminho of [
      '/api/investigador/sessoes',
      '/api/investigador/sessoes/qualquer',
      '/api/investigador/requisicoes',
      '/api/investigador/resumo',
    ]) {
      const r = await chamar(req(caminho, undefined, 'GET', ANA))
      expect(r.status).toBe(403)
    }
  })

  it('admin lê', async () => {
    const r = await chamar(req('/api/investigador/sessoes', undefined, 'GET', CHEFE))
    expect(r.status).toBe(200)
    const corpo = (await r.json()) as { ligado: boolean; retencaoDias: number }
    expect(corpo.ligado).toBe(true)
    expect(corpo.retencaoDias).toBe(30)
  })
})

describe('FR-8 — a tela declara mudança de campo', () => {
  it('o TIPO do evento é fixado no servidor, não vem do corpo', async () => {
    await chamar(
      req('/api/investigador/formulario', {
        tela: 'formulario',
        campo: 'Prioridade',
        de: 'normal',
        para: 'critica',
        // Tentativa de escolher o tipo do evento pelo corpo — tem de ser ignorada.
        tipo: 'payload_final',
      }),
    )
    const linhas = await eventos()
    expect(linhas.map((e) => e.tipo)).toEqual(['formulario_alterado'])
    expect(JSON.parse(linhas[0]!.dados_json!)).toMatchObject({ de: 'normal', para: 'critica' })
  })
})

describe('SC-10 — o expurgo toca só o registro', () => {
  it('apaga o que passou da janela e deixa auditoria, vínculos e mensagens', async () => {
    await conversar('o Protheus está fora do ar')
    const antes = await eventos()
    expect(antes.length).toBeGreaterThan(0)

    // Trinta dias depois do carimbo gravado.
    const depois = new Date(Date.parse(AGORA) + 31 * 24 * 3600 * 1000).toISOString()
    const r = await expurgarInvestigador(db, 30, depois)
    expect(r.eventos).toBeGreaterThan(0)
    expect(await eventos()).toHaveLength(0)

    const auditoria = linhasComoObjetos<{ t: number }>(
      await db.query(`SELECT COUNT(*) AS t FROM auditoria`, []),
    )[0]!
    const mensagens = linhasComoObjetos<{ t: number }>(
      await db.query(`SELECT COUNT(*) AS t FROM mensagens`, []),
    )[0]!
    expect(Number(auditoria.t)).toBeGreaterThan(0)
    expect(Number(mensagens.t)).toBeGreaterThan(0)
  })
})

describe('FR-6 no cliente REAL — não só no fake', () => {
  /**
   * ⚠️ **A prova que vale afirma sobre o que o cliente real devolve** (`D-47`): o fake
   * também preenche `respostaBruta`, e um teste que só olhasse para ele provaria apenas que
   * o dublê é consistente consigo mesmo — a família de `D-38`, `D-39` e `D-43`.
   */
  it('a resposta crua do provedor chega ao resultado da extração', async () => {
    const bruto = '{"pronto":false,"porque":"ainda falta o sistema afetado"}'
    const cliente = new ClienteIAHttp({
      baseUrl: null,
      apiKey: 'k',
      modelo: 'm',
      apiKeyFallback: null,
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: bruto } }],
            usage: { prompt_tokens: 10, completion_tokens: 5 },
          }),
          { headers: { 'content-type': 'application/json' } },
        ),
    })
    const r = await cliente.extrairProposta({
      mensagens: [{ papel: 'user', conteudo: 'oi' }],
      tiposPermitidos: [{ id: 'rt-1', nome: 'Relatar um problema' }],
    })
    expect(r.proposta).toBeNull()
    expect(r.respostaBruta).toBe(bruto)
  })
})
