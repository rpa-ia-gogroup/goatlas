/**
 * **T-400/T-401** — os campos adicionais são validados contra o SCHEMA do tipo.
 *
 * ## Por que isto existe
 *
 * `camposDinamicos` chega **do corpo da requisição** e ia direto para
 * `requestFieldValues` da criação, com allowlist de *valor* (só string) mas
 * **nenhuma allowlist de chave** — apenas `summary` e `description` eram removidos.
 *
 * Hoje o dano é contido: o Jira recusa campo que não pertence ao request type.
 * Mas o dano depende do Jira, não de nós — e a spec 005 vai colocar um **campo de
 * anexo** nesse schema. A partir daí, uma chave escolhida pelo cliente passaria a
 * ser o caminho mais curto para colar um anexo de outra pessoa no próprio chamado.
 * É o mesmo raciocínio de `RF-30` aplicado a arquivo, e o mesmo raciocínio de "a
 * allowlist nunca vem do cliente" que já vale para a busca no Confluence.
 *
 * ## A parte que decide se a correção é real
 *
 * **Schema indisponível descarta os campos adicionais.** Validação que se desliga
 * sob pressão não é validação: bastaria estrangular a chamada de schema para o furo
 * voltar. Perder campo extra numa indisponibilidade é aceitável — o chamado abre
 * mesmo assim (`RNF-18`), que é o que o caminho sem IA promete.
 *
 * _Requirements: RF-27, RF-30, RNF-18, RNF-25_
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

const ANA = 'ana@gocase.com'
const CHEFE = 'chefe@gocase.com'
const AGORA = '2026-08-07T12:00:00.000Z'

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
  await config.definir('tipos_chamado_permitidos', ['rt-1'], CHEFE, AGORA)
  await config.definir('service_desk_id', 'sd-1', CHEFE, AGORA)
  ctx = await montarContexto(
    { DB: db, ATLAS_USAR_FAKES: '1' },
    () => AGORA,
    () => `id-${++n}`,
  )
  fake = ctx.atlassian as ClienteAtlassianFake
  fake.estado.tiposChamado = [
    { id: 'rt-1', serviceDeskId: 'sd-1', nome: 'Suporte', descricao: null },
  ]
  fake.estado.camposPorTipo.set('rt-1', [
    {
      fieldId: 'customfield_sistema',
      rotulo: 'Sistema afetado',
      obrigatorio: true,
      tipo: 'texto',
      opcoes: [],
    },
  ])
})

function req(caminho: string, corpo: unknown): Request {
  return new Request(`https://atlas.devgogroup.com${caminho}`, {
    method: 'POST',
    headers: { [HEADER_EMAIL]: ANA },
    body: JSON.stringify(corpo),
  })
}

const BASE = {
  titulo: 'O pipeline de vendas falhou',
  descricao: 'O relatório diário não trouxe os dados de ontem.',
  tipoChamadoId: 'rt-1',
  prioridade: 'alta',
}

/** O `NovoChamado` que chegou ao cliente Atlassian na criação. */
function ultimaCriacao(): { camposDinamicos?: Record<string, string> } {
  const criacoes = fake.chamadas.filter((c) => c.operacao === 'criarChamado')
  return (criacoes[criacoes.length - 1]?.params ?? {}) as { camposDinamicos?: Record<string, string> }
}

describe('RF-27 — a chave dos campos adicionais vem do SCHEMA, nunca do cliente', () => {
  it('campo que está no schema continua passando (não pode regredir)', async () => {
    const r = await tratarRequisicao(
      req('/api/chamados', {
        ...BASE,
        chaveIdempotencia: 'k1',
        camposDinamicos: { customfield_sistema: 'Painel de vendas' },
      }),
      ctx,
      {},
    )
    expect(r.status).toBe(201)
    const enviado = ultimaCriacao()
    expect(enviado.camposDinamicos).toEqual({ customfield_sistema: 'Painel de vendas' })
  })

  it('BURLA — chave que NÃO está no schema é descartada, e o chamado abre mesmo assim', async () => {
    const r = await tratarRequisicao(
      req('/api/chamados', {
        ...BASE,
        chaveIdempotencia: 'k2',
        camposDinamicos: {
          customfield_sistema: 'Painel de vendas',
          customfield_inventado: 'valor que ninguém ofereceu',
          reporter: 'outra.pessoa@gocase.com',
        },
      }),
      ctx,
      {},
    )
    // Descartar campo extra não pode virar recusa de chamado: o caminho sem IA
    // existe justamente para continuar funcionando quando algo ao lado falha.
    expect(r.status).toBe(201)
    const enviado = ultimaCriacao()
    expect(enviado.camposDinamicos).toEqual({ customfield_sistema: 'Painel de vendas' })
    expect(enviado.camposDinamicos).not.toHaveProperty('customfield_inventado')
    expect(enviado.camposDinamicos).not.toHaveProperty('reporter')
  })

  it('BURLA — schema INDISPONÍVEL descarta todos, e ainda assim abre o chamado', async () => {
    fake.estado.falhas.obterCamposDoTipo = 'indisponivel'
    const r = await tratarRequisicao(
      req('/api/chamados', {
        ...BASE,
        chaveIdempotencia: 'k3',
        camposDinamicos: { customfield_sistema: 'Painel', customfield_inventado: 'x' },
      }),
      ctx,
      {},
    )
    expect(r.status).toBe(201)
    const enviado = ultimaCriacao()
    // Fail-closed no campo, fail-open no chamado. Se fosse o contrário, derrubar a
    // chamada de schema seria o caminho da burla.
    expect(enviado.camposDinamicos).toBeUndefined()
  })

  it('o descarte é AUDITADO — silêncio esconderia o schema quebrado', async () => {
    fake.estado.falhas.obterCamposDoTipo = 'indisponivel'
    await tratarRequisicao(
      req('/api/chamados', {
        ...BASE,
        chaveIdempotencia: 'k4',
        camposDinamicos: { customfield_sistema: 'Painel' },
      }),
      ctx,
      {},
    )
    const r = await db.query(
      `SELECT acao, resultado, detalhe_json FROM auditoria WHERE acao = 'campos_dinamicos_descartados'`,
      [],
    )
    const linhas = linhasComoObjetos<{ resultado: string; detalhe_json: string }>(r)
    expect(linhas).toHaveLength(1)
    expect(linhas[0]?.resultado).toBe('negado')
    expect(JSON.parse(linhas[0]!.detalhe_json).motivo).toBe('schema_indisponivel')
  })

  it('obrigatório do schema faltando: RECUSA nomeando o rótulo, sem tocar a Atlassian', async () => {
    // ⚠️ Este teste **afirmava 201** e foi trocado com base em medição, não em gosto:
    // em 11/08/2026, criar na staging um chamado do tipo 70 sem os campos obrigatórios do
    // request type devolveu **HTTP 500** e **nenhum chamado**. Ou seja, o 201 que este
    // teste protegia era verdade só contra o fake — que não valida nada — e em produção
    // significava chamado perdido com "algo deu errado" na tela.
    //
    // O que a decisão original protegia continua valendo e tem teste próprio em
    // `rf27-campos-dinamicos`: tipo **sem** obrigatório abre chamado sem campo nenhum, e
    // campo extra malformado não derruba a submissão (`RNF-18`).
    const r = await tratarRequisicao(req('/api/chamados', { ...BASE, chaveIdempotencia: 'k5' }), ctx, {})
    expect(r.status).toBe(400)
    const corpo = (await r.json()) as { erro: string }
    expect(corpo.erro).toContain('Sistema afetado')
    expect(corpo.erro).not.toContain('customfield_')
    expect(fake.chamadas.some((c) => c.operacao === 'criarChamado')).toBe(false)
  })
})
