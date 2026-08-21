/**
 * **T-1330 a T-1342** — os corpos saem da listagem, e a lista sabe contar.
 *
 * ## As duas perguntas
 *
 * 1. 🚨 **`SELECT *` mandava `req_json` e `resp_json` em toda listagem** — até 500 linhas com
 *    dois corpos de até 16 mil caracteres cada, para uma tela que lê **um par por vez**,
 *    quando alguém expande uma linha. Era o oposto do orçamento de `RNF-36`, na parte que
 *    ninguém vê até a conta chegar. Aqui se afirma que eles **não** viajam na lista e que a
 *    rota nova os entrega.
 * 2. O recorte `parada` e as contagens por recorte — e a razão de o predicado ser **um só**,
 *    exportado de `leitura.ts` e usado também pela tela: contar de um jeito e filtrar de
 *    outro produz "3" ao lado de uma lista de quatro.
 *
 * _Requirements: FR-30, FR-31, FR-32, ScC-05, ScD-01, ScD-02, SC-5 (spec 013)_
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { SqliteLocal } from '@/lib/db/sqlite-local'
import { migrar } from '@/lib/db/schema'
import { Config } from '@/lib/config'
import { montarContexto, type Contexto } from '@/lib/contexto'
import { tratarRequisicao } from '@/lib/http/rotas'
import { HEADER_EMAIL } from '@/lib/auth'
import { aplicarRecorte, PARADA_HA_MINUTOS, type SessaoInvestigador } from '@/lib/investigador/leitura'
import { montarExportacao } from '@/app/investigador'
import { agruparEmTurnos } from '@/app/investigador/turnos'
import type { DetalheDeSessao, EventoRegistrado, RequisicaoRegistrada } from '@/app/api'

const ANA = 'ana@gocase.com'
const CHEFE = 'chefe@gocase.com'
const AGORA = '2026-08-20T13:00:00.000Z'

let db: SqliteLocal
let ctx: Contexto
let n = 0

beforeEach(async () => {
  db = new SqliteLocal()
  await migrar(db)
  n = 0
  const config = new Config(db)
  await config.definir('dominios_permitidos', ['gocase.com'], CHEFE, AGORA)
  await config.definir('admins', [CHEFE], CHEFE, AGORA)
  ctx = await montarContexto({ DB: db, ATLAS_USAR_FAKES: '1' }, () => AGORA, () => `id-${++n}`)
})

function req(caminho: string, quem = CHEFE): Request {
  return new Request(`https://atlas.devgogroup.com${caminho}`, {
    method: 'GET',
    headers: { [HEADER_EMAIL]: quem },
  })
}

/** Uma linha de log com os dois corpos preenchidos, direto no banco. */
async function gravarChamada(id: string) {
  await db.exec(
    `INSERT INTO investigador_requisicoes
       (id, ator_email, conversa_id, metodo, caminho, status, duracao_ms,
        req_bytes, resp_bytes, req_json, resp_json, erro, criado_em)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, ANA, 'c-1', 'POST', '/api/conversas/c-1/mensagens', 200, 1200, 40, 900,
     '{"texto":"o Protheus caiu"}', '{"resposta":"entendi"}', null, AGORA],
  )
}

describe('os corpos saem da listagem — `FR-30`', () => {
  it('🚨 a lista NÃO carrega `req_json` nem `resp_json`', async () => {
    await gravarChamada('req-1')
    const r = await tratarRequisicao(req('/api/investigador/requisicoes'), ctx, {})
    const corpo = (await r.json()) as { itens: Record<string, unknown>[] }
    expect(corpo.itens).toHaveLength(1)
    expect(corpo.itens[0]).not.toHaveProperty('req_json')
    expect(corpo.itens[0]).not.toHaveProperty('resp_json')
    // …e o que a lista precisa continua lá.
    expect(corpo.itens[0]).toMatchObject({ metodo: 'POST', status: 200, resp_bytes: 900 })
  })

  it('o detalhe da sessão também não os carrega', async () => {
    await gravarChamada('req-1')
    const r = await tratarRequisicao(req('/api/investigador/sessoes/c-1'), ctx, {})
    const corpo = (await r.json()) as { requisicoes: Record<string, unknown>[] }
    expect(corpo.requisicoes[0]).not.toHaveProperty('req_json')
  })

  it('a rota de corpos entrega os dois, por id', async () => {
    await gravarChamada('req-1')
    const r = await tratarRequisicao(req('/api/investigador/requisicoes/req-1/corpos'), ctx, {})
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({
      req_json: '{"texto":"o Protheus caiu"}',
      resp_json: '{"resposta":"entendi"}',
    })
  })

  it('linha que já foi expurgada responde com os dois nulos, não 404', async () => {
    // ⚠️ Um 404 aqui viraria aviso de erro sobre um registro que só envelheceu (`FR-19`).
    const r = await tratarRequisicao(req('/api/investigador/requisicoes/nao-existe/corpos'), ctx, {})
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ req_json: null, resp_json: null })
  })

  it('e o gate de admin vale para ela como para o resto do bloco', async () => {
    await gravarChamada('req-1')
    const r = await tratarRequisicao(req('/api/investigador/requisicoes/req-1/corpos', ANA), ctx, {})
    expect(r.status).toBe(403)
  })
})

// --- os recortes -------------------------------------------------------------

function sessao(p: Partial<SessaoInvestigador>): SessaoInvestigador {
  return {
    conversaId: 'c-1',
    solicitanteEmail: ANA,
    estado: 'coletando',
    criadoEm: AGORA,
    ultimaAtividade: AGORA,
    custoUsd: 0,
    mensagensDaPessoa: 2,
    mensagensDoAgente: 2,
    bloqueios: 0,
    overrides: 0,
    temProposta: true,
    confirmadoEm: null,
    issueKey: 'GN-1',
    requisicoes: 2,
    errosDeApi: 0,
    duracaoMaximaMs: 1000,
    motivoSemProposta: null,
    ...p,
  }
}

describe('o recorte "parada" — `FR-32`', () => {
  const agora = '2026-08-20T13:00:00.000Z'
  const haDuasHoras = '2026-08-20T11:00:00.000Z'
  const haCincoMinutos = '2026-08-20T12:55:00.000Z'

  it('pega quem veio, não abriu chamado e sumiu', () => {
    const itens = [
      sessao({ conversaId: 'velha', issueKey: null, ultimaAtividade: haDuasHoras }),
      sessao({ conversaId: 'agora', issueKey: null, ultimaAtividade: haCincoMinutos }),
      sessao({ conversaId: 'com-chamado', ultimaAtividade: haDuasHoras }),
    ]
    expect(aplicarRecorte(itens, 'parada', agora).map((s) => s.conversaId)).toEqual(['velha'])
  })

  it('é mais estreito que "sem chamado" — quem está conversando AGORA não é quem desistiu', () => {
    const itens = [
      sessao({ conversaId: 'velha', issueKey: null, ultimaAtividade: haDuasHoras }),
      sessao({ conversaId: 'agora', issueKey: null, ultimaAtividade: haCincoMinutos }),
    ]
    expect(aplicarRecorte(itens, 'abandonada', agora)).toHaveLength(2)
    expect(aplicarRecorte(itens, 'parada', agora)).toHaveLength(1)
  })

  it('sem relógio devolve VAZIO em vez de adivinhar', () => {
    const itens = [sessao({ issueKey: null, ultimaAtividade: haDuasHoras })]
    expect(aplicarRecorte(itens, 'parada')).toEqual([])
  })

  it('carimbo ilegível não entra — "parada" é afirmação, e ela precisa de medida', () => {
    const itens = [sessao({ issueKey: null, ultimaAtividade: 'nao-e-data' })]
    expect(aplicarRecorte(itens, 'parada', agora)).toEqual([])
  })

  it('o corte é o declarado, e ele é usado pela tela para escrever o rótulo', () => {
    expect(PARADA_HA_MINUTOS).toBe(60)
  })
})

// --- a exportação ------------------------------------------------------------

function evento(p: Partial<EventoRegistrado>): EventoRegistrado {
  n += 1
  return {
    id: `e-${n}`,
    requisicao_id: 'r-1',
    conversa_id: 'c-1',
    ator_email: ANA,
    tipo: 'mensagem_usuario',
    origem: 'usuario',
    resumo: null,
    dados_json: null,
    custo_usd: null,
    duracao_ms: null,
    ordem: n,
    criado_em: AGORA,
    ...p,
  }
}

const REQUISICAO: RequisicaoRegistrada = {
  id: 'r-1',
  ator_email: ANA,
  conversa_id: 'c-1',
  metodo: 'POST',
  caminho: '/api/conversas/c-1/mensagens',
  status: 200,
  duracao_ms: 24_300,
  req_bytes: null,
  resp_bytes: null,
  erro: null,
  criado_em: AGORA,
}

describe('exportar a sessão — `FR-31`', () => {
  const eventos = [
    evento({ dados_json: JSON.stringify({ texto: 'o Protheus caiu', estadoDaConversa: 'coletando' }) }),
    evento({
      tipo: 'ia_chat',
      origem: 'ia',
      custo_usd: 0.012,
      dados_json: JSON.stringify({
        ciclo: 1,
        toolsPermitidas: ['search_confluence'],
        historicoEnviado: [{ papel: 'user', conteudo: 'x'.repeat(9000), toolNome: null }],
      }),
    }),
    evento({ tipo: 'chamada_externa', origem: 'atlassian', duracao_ms: 430 }),
  ]
  const dados = { eventos, requisicoes: [REQUISICAO], mensagens: [] } as unknown as DetalheDeSessao
  const saida = montarExportacao(dados, 'c-1', agruparEmTurnos(eventos, [REQUISICAO]))

  it('sai em turnos, com o que cada um custou e produziu', () => {
    expect(saida.conversa).toBe('c-1')
    expect(saida.turnos).toHaveLength(1)
    expect(saida.turnos[0]).toMatchObject({
      turno: 1,
      rota: 'POST /api/conversas/c-1/mensagens',
      status: 200,
      duracaoMs: 24_300,
    })
    expect(saida.turnos[0]?.custoUsd).toBeCloseTo(0.012, 6)
  })

  it('usa a MESMA tradução da tela — não um segundo vocabulário', () => {
    const titulos = saida.turnos[0]?.eventos.map((e) => e.o_que)
    expect(titulos).toContain('Mensagem da pessoa')
    expect(titulos?.some((t) => t?.startsWith('Ida ao modelo'))).toBe(true)
    // Nada em snake_case atravessa.
    expect(JSON.stringify(saida)).not.toContain('mensagem_usuario')
  })

  it('🚨 o texto longo vira MARCADOR de tamanho, nunca o conteúdo', () => {
    const bruto = JSON.stringify(saida)
    // O histórico tem 9 mil caracteres; ele não pode viajar dentro da exportação.
    expect(bruto).not.toContain('x'.repeat(200))
    expect(bruto).toContain('kB')
    expect(bruto.length).toBeLessThan(4000)
  })

  it('as idas para fora saem agregadas por destino, como no cabeçalho do turno', () => {
    expect(saida.turnos[0]?.chamadasExternas).toEqual([{ alvo: 'atlassian', total: 1, ms: 430 }])
  })
})
