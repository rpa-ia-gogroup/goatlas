/**
 * `RF-81` (spec 011) — "Montar o chamado agora", com o que a conversa já tem.
 *
 * ## O silêncio que isto acaba
 *
 * Medido **duas vezes**. Em 14/08/2026 uma pessoa passou 70 minutos no app, mandou seis
 * mensagens, nunca viu o cartão e foi embora sem chamado. Em 17/08/2026, reproduzindo o
 * mesmo relato na produção, foram outras seis mensagens com `"pronto": false` em **todas**
 * as extrações — o agente respondendo bem, e nunca fechando.
 *
 * Quem conversa não tem como saber disso: não há erro, não há aviso, a conversa parece
 * estar indo. O botão dá o caminho de saída, e ele é da pessoa.
 *
 * ## O que estes casos travam
 *
 * Forçar afrouxa **uma** coisa — a decisão do modelo sobre estar pronto. Tudo o mais fica:
 * título e descrição curtos continuam descartando, `tipoChamadoId` fora da allowlist
 * continua descartando a proposta inteira (`RF-28`), as duas verificações de `RF-08`
 * continuam sendo pré-condição, e criar continua exigindo a confirmação de `RF-17`.
 *
 * _Requirements: RF-81, RF-08, RF-17, RF-28, RN-07_
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { SqliteLocal } from '@/lib/db/sqlite-local'
import { migrar } from '@/lib/db/schema'
import { Config } from '@/lib/config'
import { montarContexto, type Contexto } from '@/lib/contexto'
import { tratarRequisicao } from '@/lib/http/rotas'
import { HEADER_EMAIL } from '@/lib/auth'
import { ClienteAtlassianFake } from '@/lib/atlassian/fake'
import { interpretarProposta } from '@/lib/ia/cliente'
import { linhasComoObjetos } from '@/lib/db/tipos'

const ANA = 'ana@gocase.com'
const CHEFE = 'chefe@gocase.com'
const AGORA = '2026-08-17T12:00:00.000Z'

const NAO_PRONTO = JSON.stringify({
  pronto: false,
  titulo: 'Falha intermitente ao salvar material no Factory',
  descricao: 'A alteração às vezes não reflete no site, sem mensagem de erro.',
  prioridade: 'alta',
  motivoPrioridade: null,
  tipoChamadoId: 'rt-1',
  campos: [],
})

describe('interpretarProposta — o que forçar afrouxa, e o que não', () => {
  it('🚨 sem forçar, `pronto: false` descarta — é o comportamento de sempre', () => {
    expect(interpretarProposta(NAO_PRONTO, ['rt-1'])).toBeNull()
  })

  it('forçando, a mesma resposta vira proposta', () => {
    const p = interpretarProposta(NAO_PRONTO, ['rt-1'], { aceitarNaoPronto: true })
    expect(p?.titulo).toBe('Falha intermitente ao salvar material no Factory')
    expect(p?.tipoChamadoId).toBe('rt-1')
  })

  it('🚨 forçar NÃO abre a allowlist de `RF-28` — id de fora continua descartando tudo', () => {
    const deOutraFila = JSON.stringify({ ...JSON.parse(NAO_PRONTO), tipoChamadoId: 'rt-99' })
    expect(interpretarProposta(deOutraFila, ['rt-1'], { aceitarNaoPronto: true })).toBeNull()
  })

  it('🚨 forçar NÃO aceita chamado vazio — título e descrição curtos continuam descartando', () => {
    const vazio = JSON.stringify({ ...JSON.parse(NAO_PRONTO), titulo: 'oi', descricao: 'nada' })
    expect(interpretarProposta(vazio, ['rt-1'], { aceitarNaoPronto: true })).toBeNull()
  })
})

let db: SqliteLocal
let ctx: Contexto
let n = 0

beforeEach(async () => {
  db = new SqliteLocal()
  await migrar(db)
  n = 0
  const config = new Config(db)
  await config.definir('dominios_permitidos', ['gocase.com'], CHEFE, AGORA)
  await config.definir('tipos_chamado_permitidos', ['rt-1'], CHEFE, AGORA)
  await config.definir('service_desk_id', 'sd-1', CHEFE, AGORA)
  ctx = await montarContexto({ DB: db, ATLAS_USAR_FAKES: '1' }, () => AGORA, () => `id-${++n}`)
  const fake = ctx.atlassian as ClienteAtlassianFake
  fake.estado.tiposChamado = [
    { id: 'rt-1', serviceDeskId: 'sd-1', nome: 'Relatar um bug', descricao: null },
  ]
})

const chamar = (r: Request) => tratarRequisicao(r, ctx, {})

function req(caminho: string, metodo = 'POST', quem = ANA): Request {
  return new Request(`https://atlas.devgogroup.com${caminho}`, {
    method: metodo,
    headers: { [HEADER_EMAIL]: quem },
  })
}

describe('POST /api/conversas/:id/montar-chamado', () => {
  it('🚨 sem as duas verificações, NÃO monta — `RF-08` continua sendo pré-condição', async () => {
    const c = await ctx.conversas.criar(ctx.novoId(), ANA)
    // Só uma das duas rodou: é exatamente o estado em que `RF-08` proíbe propor.
    await ctx.conversas.marcarConfluenceVerificado(c.id, false)

    const r = await chamar(req(`/api/conversas/${c.id}/montar-chamado`))
    expect(r.status).toBe(200)
    const corpo = await r.json()
    expect(corpo.ok).toBe(false)
    expect(corpo.proposta).toBeNull()
    // A frase existe: botão clicado sem efeito visível é o silêncio que ele veio acabar.
    expect(corpo.mensagem).toContain('Conte em uma frase')
  })

  it('com as verificações feitas, monta e devolve a proposta', async () => {
    const c = await ctx.conversas.criar(ctx.novoId(), ANA)
    await ctx.conversas.marcarConfluenceVerificado(c.id, false)
    await ctx.conversas.marcarHistoricoVerificado(c.id, false)
    await ctx.conversas.adicionarMensagem(
      ctx.novoId(),
      c.id,
      'user',
      'o factory não salva o material',
      null,
    )

    const r = await chamar(req(`/api/conversas/${c.id}/montar-chamado`))
    expect(r.status).toBe(200)
    const corpo = await r.json()
    expect(corpo.ok).toBe(true)
    expect(corpo.proposta.tipoChamadoId).toBe('rt-1')
  })

  it('🚨 conversa de OUTRA pessoa dá 404, nunca 403 (`RF-30`)', async () => {
    const c = await ctx.conversas.criar(ctx.novoId(), ANA)
    const r = await chamar(req(`/api/conversas/${c.id}/montar-chamado`, 'POST', 'outro@gocase.com'))
    expect(r.status).toBe(404)
  })

  it('o clique fica auditado, com o desfecho — é o que diz se o botão resolve', async () => {
    const c = await ctx.conversas.criar(ctx.novoId(), ANA)
    await ctx.conversas.marcarConfluenceVerificado(c.id, false)
    await ctx.conversas.marcarHistoricoVerificado(c.id, false)
    await chamar(req(`/api/conversas/${c.id}/montar-chamado`))

    const linhas = linhasComoObjetos<{ resultado: string }>(
      await db.query(`SELECT resultado FROM auditoria WHERE acao = 'proposta_forcada'`, []),
    )
    expect(linhas).toHaveLength(1)
  })
})
