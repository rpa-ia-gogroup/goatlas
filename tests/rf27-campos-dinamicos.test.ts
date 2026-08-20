/**
 * T-130 — RF-27 completo: o formulário sem IA (D-04) ganha campos adicionais
 * renderizados a partir do schema do request type, sem hardcode.
 *
 * O que este arquivo cobra:
 * - `GET /api/tipos-chamado/:id/campos` respeita a MESMA allowlist de RF-28
 *   (tipo fora dela responde como inexistente, sem consultar a Atlassian).
 * - Indisponibilidade da Atlassian não vira 404 (RNF-18/RNF-19) — a rota
 *   distingue "tipo não existe" de "não consegui buscar agora".
 * - Os valores preenchidos pela pessoa chegam a `criarChamado` — sem eles o
 *   requisito seria só "renderizar", não "formulário funcional".
 * - O caminho sem IA CONTINUA funcionando sem nenhum campo adicional
 *   preenchido — RF-27 é aditivo, não pode regredir o que já existia.
 *
 * _Requirements: RF-27, RF-28, RNF-18, RNF-25_
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { SqliteLocal } from '@/lib/db/sqlite-local'
import { migrar } from '@/lib/db/schema'
import { Config } from '@/lib/config'
import { montarContexto, type Contexto } from '@/lib/contexto'
import { tratarRequisicao } from '@/lib/http/rotas'
import { HEADER_EMAIL } from '@/lib/auth'
import { ClienteAtlassianFake } from '@/lib/atlassian/fake'

const ANA = 'ana@gocase.com'
const CHEFE = 'chefe@gocase.com'
const AGORA = '2026-08-05T12:00:00.000Z'

let db: SqliteLocal
let ctx: Contexto
let fake: ClienteAtlassianFake
let n = 0

beforeEach(async () => {
  db = new SqliteLocal()
  await migrar(db)
  n = 0
  const config = new Config(db)
  await config.definir('dominios_permitidos', ['gocase.com'], CHEFE, AGORA)
  await config.definir('admins', [CHEFE], CHEFE, AGORA)
  await config.definir('tipos_chamado_permitidos', ['rt-1', 'rt-livre'], CHEFE, AGORA)
  await config.definir('service_desk_id', 'sd-1', CHEFE, AGORA)
  ctx = await montarContexto(
    { DB: db, ATLAS_USAR_FAKES: '1' },
    () => AGORA,
    () => `id-${++n}`,
  )
  fake = ctx.atlassian as ClienteAtlassianFake
  fake.estado.tiposChamado = [
    { id: 'rt-1', serviceDeskId: 'sd-1', nome: 'Suporte', descricao: null },
    // ⚠️ Um tipo **sem campo obrigatório**, para os testes de "aditivo" e "malformado não
    // derruba" continuarem afirmando o que sempre afirmaram.
    //
    // Medido em 11/08/2026 contra a Atlassian real: criação **sem** um campo obrigatório
    // do request type **não abre chamado** — a pessoa recebe um 500 genérico e o chamado
    // se perde. Então "abre chamado mesmo faltando obrigatório" nunca foi verdade em
    // produção; era verdade só contra o fake, que não valida nada. O que a decisão original
    // protegia — campo **extra** não pode derrubar o caminho sem IA (`RNF-18`) — continua
    // valendo, e é o que estes testes passam a exercitar sem a confusão.
    { id: 'rt-livre', serviceDeskId: 'sd-1', nome: 'Sem obrigatório', descricao: null },
  ]
  fake.estado.camposPorTipo.set('rt-livre', [
    {
      fieldId: 'customfield_2',
      rotulo: 'Ambiente',
      obrigatorio: false,
      tipo: 'selecao',
      opcoes: [{ id: '1', rotulo: 'Produção' }],
    },
  ])
  fake.estado.camposPorTipo.set('rt-1', [
    { fieldId: 'customfield_1', rotulo: 'Sistema afetado', obrigatorio: true, tipo: 'texto', opcoes: [] },
    {
      fieldId: 'customfield_2',
      rotulo: 'Ambiente',
      obrigatorio: false,
      tipo: 'selecao',
      opcoes: [{ id: '1', rotulo: 'Produção' }],
    },
  ])
})

function req(
  caminho: string,
  opcoes: { metodo?: string; email?: string; corpo?: unknown } = {},
): Request {
  const headers: Record<string, string> = {}
  if (opcoes.email) headers[HEADER_EMAIL] = opcoes.email
  return new Request(`https://atlas.devgogroup.com${caminho}`, {
    method: opcoes.metodo ?? 'GET',
    headers,
    ...(opcoes.corpo === undefined ? {} : { body: JSON.stringify(opcoes.corpo) }),
  })
}

const chamar = (r: Request) => tratarRequisicao(r, ctx, {})

describe('GET /api/tipos-chamado/:id/campos', () => {
  it('devolve o schema do tipo liberado', async () => {
    const r = await chamar(req('/api/tipos-chamado/rt-1/campos', { email: ANA }))
    expect(r.status).toBe(200)
    const corpo = await r.json()
    expect(corpo.itens).toHaveLength(2)
    expect(corpo.itens[0].fieldId).toBe('customfield_1')
  })

  it('BURLA — tipo fora da allowlist responde 404, sem consultar a Atlassian', async () => {
    fake.estado.camposPorTipo.set('rt-fora', [
      { fieldId: 'customfield_9', rotulo: 'Vazou', obrigatorio: false, tipo: 'texto', opcoes: [] },
    ])
    const antes = fake.chamadas.length
    const r = await chamar(req('/api/tipos-chamado/rt-fora/campos', { email: ANA }))
    expect(r.status).toBe(404)
    expect(fake.chamadas.length).toBe(antes)
  })

  it('sem service_desk_id configurado: dados inválidos, não 500', async () => {
    await new Config(db).definir('service_desk_id', null, CHEFE, AGORA)
    const semSd = await montarContexto(
      { DB: db, ATLAS_USAR_FAKES: '1' },
      () => AGORA,
      () => `id-${++n}`,
    )
    const r = await tratarRequisicao(
      req('/api/tipos-chamado/rt-1/campos', { email: ANA }),
      semSd,
      {},
    )
    expect(r.status).toBe(400)
  })

  it('RNF-18 — Atlassian indisponível vira 503, não "não encontrado"', async () => {
    fake.estado.falhas.obterCamposDoTipo = 'indisponivel'
    const r = await chamar(req('/api/tipos-chamado/rt-1/campos', { email: ANA }))
    expect(r.status).toBe(503)
  })
})

describe('POST /api/chamados — camposDinamicos chega até criarChamado', () => {
  it('os valores preenchidos aparecem no NovoChamado recebido pelo cliente', async () => {
    const r = await chamar(
      req('/api/chamados', {
        metodo: 'POST',
        email: ANA,
        corpo: {
          titulo: 'Pipeline de vendas falhou',
          descricao: 'O pipeline diário não gerou os dados de ontem.',
          tipoChamadoId: 'rt-1',
          prioridade: 'alta',
          camposDinamicos: { customfield_1: 'Servidor de vendas', customfield_2: '1' },
        },
      }),
    )
    expect(r.status).toBe(201)
    const chamada = fake.chamadas.find((c) => c.operacao === 'criarChamado')
    const params = chamada?.params as { camposDinamicos?: Record<string, unknown> }
    // ⚠️ O de SELEÇÃO chega como objeto, não como a string que a tela mandou (`D-39`):
    // a string crua devolvia 400 na Atlassian, e 400 aqui é definitivo — chamado perdido.
    expect(params?.camposDinamicos).toEqual({
      customfield_1: 'Servidor de vendas',
      customfield_2: { id: '1' },
    })
  })

  it('RF-27 é ADITIVO — tipo SEM obrigatório abre chamado sem campo adicional nenhum', async () => {
    const r = await chamar(
      req('/api/chamados', {
        metodo: 'POST',
        email: ANA,
        corpo: {
          titulo: 'Pipeline de vendas falhou',
          descricao: 'O pipeline diário não gerou os dados de ontem.',
          tipoChamadoId: 'rt-livre',
          prioridade: 'alta',
        },
      }),
    )
    expect(r.status).toBe(201)
  })

  it('camposDinamicos malformado (array, string, etc.) não derruba a submissão', async () => {
    const r = await chamar(
      req('/api/chamados', {
        metodo: 'POST',
        email: ANA,
        corpo: {
          titulo: 'Pipeline de vendas falhou',
          descricao: 'O pipeline diário não gerou os dados de ontem.',
          tipoChamadoId: 'rt-livre',
          prioridade: 'alta',
          camposDinamicos: ['isso não é um objeto'],
        },
      }),
    )
    expect(r.status).toBe(201)
  })

  it('valor vazio, valor não-string e chave FORA DO SCHEMA são descartados', async () => {
    await chamar(
      req('/api/chamados', {
        metodo: 'POST',
        email: ANA,
        corpo: {
          titulo: 'Pipeline de vendas falhou',
          descricao: 'O pipeline diário não gerou os dados de ontem.',
          tipoChamadoId: 'rt-livre',
          prioridade: 'alta',
          // `customfield_3` NÃO está no schema deste tipo. Ele passava antes de
          // T-401 — a allowlist era de valor, não de chave. Ver
          // `tests/rf27-campos-fora-do-schema.test.ts` para o porquê.
          //
          // ⚠️ `customfield_2` vai com o **id** da opção (`'1'`), que é o que a tela
          // manda: o rótulo (`'Produção'`) não é valor válido e desde `D-39` é recusado
          // antes de qualquer efeito — quem cobra isso é `rf27-campo-de-selecao`.
          camposDinamicos: { customfield_1: '   ', customfield_2: '1', customfield_3: 'ok' },
        },
      }),
    )
    const chamada = fake.chamadas.find((c) => c.operacao === 'criarChamado')
    const params = chamada?.params as { camposDinamicos?: Record<string, unknown> }
    expect(params?.camposDinamicos).toEqual({ customfield_2: { id: '1' } })
  })

  it('🚨 obrigatório faltando é RECUSA com o rótulo, não 500 depois', async () => {
    // Medido em 11/08/2026 na staging: criar o tipo 70 sem os obrigatórios devolveu
    // **HTTP 500 "Algo deu errado do nosso lado"** e nenhum chamado. A pessoa perdia o
    // chamado e não sabia o que corrigir. A recusa vem ANTES de qualquer efeito.
    const r = await chamar(
      req('/api/chamados', {
        metodo: 'POST',
        email: ANA,
        corpo: {
          titulo: 'Pipeline de vendas falhou',
          descricao: 'O pipeline diário não gerou os dados de ontem.',
          tipoChamadoId: 'rt-1',
          prioridade: 'alta',
        },
      }),
    )
    expect(r.status).toBe(400)
    const corpo = (await r.json()) as { erro: string }
    // O RÓTULO, não o `fieldId` — quem lê é quem abre o chamado (`RNF-30`).
    expect(corpo.erro).toContain('Sistema afetado')
    expect(corpo.erro).not.toContain('customfield_')
    expect(fake.chamadas.some((c) => c.operacao === 'criarChamado')).toBe(false)
  })
})
