/**
 * T-502 / T-509 — os campos do solicitante nas rotas, e a lista de tipos por desk.
 *
 * O teste de burla aqui é primo do de `RF-30`: o que se afirma é que **o cliente não
 * escolhe o próprio dado**. A diferença é que aqui o valor é *editável* por decisão
 * (`FR-3`, 11/08/2026) — então o que se protege não é "o servidor vence sempre", e sim
 * "o servidor preenche quando o cliente não mandou, e o vínculo continua sendo a
 * autoria verificável".
 *
 * _Requirements: RF-21, RF-28, RF-04, RNF-05, D-36_
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { SqliteLocal } from '@/lib/db/sqlite-local'
import { migrar } from '@/lib/db/schema'
import { Config } from '@/lib/config'
import { montarContexto } from '@/lib/contexto'
import { tratarRequisicao } from '@/lib/http/rotas'
import { HEADER_EMAIL } from '@/lib/auth'
import { ClienteAtlassianFake } from '@/lib/atlassian/fake'

const ANA = 'ana@gocase.com'
let db: SqliteLocal

beforeEach(async () => {
  db = new SqliteLocal()
  await migrar(db)
})

async function ctxCom(config: Record<string, unknown>) {
  const c = new Config(db)
  for (const [chave, valor] of Object.entries(config)) {
    await c.definir(chave as never, valor as never, 'chefe@gocase.com', '2026-08-11T00:00:00.000Z')
  }
  return montarContexto({ DB: db, GOATLAS_DOMINIOS: 'gocase.com' })
}

async function chamar(ctx: Awaited<ReturnType<typeof montarContexto>>, caminho: string, opcoes: {
  metodo?: string
  corpo?: unknown
} = {}) {
  const r = await tratarRequisicao(
    new Request(`https://goatlas.devgogroup.com${caminho}`, {
      method: opcoes.metodo ?? 'GET',
      headers: { [HEADER_EMAIL]: ANA },
      ...(opcoes.corpo === undefined ? {} : { body: JSON.stringify(opcoes.corpo) }),
    }),
    ctx,
    {},
  )
  return { status: r.status, corpo: (await r.json().catch(() => null)) as never }
}

describe('RF-28 / T-509 — a lista de tipos só devolve o service desk configurado', () => {
  it('tipo de OUTRO desk não aparece, mesmo estando na allowlist', async () => {
    // `listarTiposChamado` varre os 5 desks do site. Sem o filtro, um id de outro desk
    // aparece na tela, passa por `validarProposta` e falha só na criação.
    const ctx = await ctxCom({
      dominios_permitidos: ['gocase.com'],
      service_desk_id: 'sd-1',
      tipos_chamado_permitidos: ['rt-1', 'rt-outro'],
    })
    const fake = ctx.atlassian as ClienteAtlassianFake
    fake.estado.tiposChamado = [
      { id: 'rt-1', serviceDeskId: 'sd-1', nome: 'Do nosso desk', descricao: '' },
      { id: 'rt-outro', serviceDeskId: 'sd-9', nome: 'De outro desk', descricao: '' },
    ]
    const r = await chamar(ctx, '/api/tipos-chamado')
    expect((r.corpo as { itens: { id: string }[] }).itens.map((t) => t.id)).toEqual(['rt-1'])
  })

  it('sem service desk configurado a lista é vazia — a criação já recusa nesse estado', async () => {
    const ctx = await ctxCom({
      dominios_permitidos: ['gocase.com'],
      tipos_chamado_permitidos: ['rt-1'],
    })
    const fake = ctx.atlassian as ClienteAtlassianFake
    fake.estado.tiposChamado = [
      { id: 'rt-1', serviceDeskId: 'sd-1', nome: 'x', descricao: '' },
    ]
    const r = await chamar(ctx, '/api/tipos-chamado')
    expect((r.corpo as { itens: unknown[] }).itens).toEqual([])
  })
})

describe('RF-21 / T-502 — nome e e-mail no chamado do tipo 108', () => {
  async function ctxDoTipo108() {
    const ctx = await ctxCom({
      dominios_permitidos: ['gocase.com'],
      service_desk_id: 'sd-1',
      tipos_chamado_permitidos: ['108'],
    })
    const fake = ctx.atlassian as ClienteAtlassianFake
    fake.estado.camposPorTipo.set('108', [
      { fieldId: 'customfield_10089', rotulo: 'Nome do Colaborador', obrigatorio: true, tipo: 'texto', opcoes: [] },
      { fieldId: 'customfield_10091', rotulo: 'E-mail', obrigatorio: true, tipo: 'texto', opcoes: [] },
    ])
    return { ctx, fake }
  }

  const BASE = {
    titulo: 'Preciso de acesso ao Metabase',
    descricao: 'Vou montar o relatório de logística da semana.',
    tipoChamadoId: '108',
    prioridade: 'normal',
    declarouAnexo: false,
  }

  it('preenche do login quando o cliente não manda nada', async () => {
    const { ctx, fake } = await ctxDoTipo108()
    const r = await chamar(ctx, '/api/chamados', {
      metodo: 'POST',
      corpo: { ...BASE, chaveIdempotencia: 'k-preenche' },
    })
    expect(r.status).toBe(201)
    const criacao = fake.chamadas.find((c) => c.operacao === 'criarChamado')
    const campos = (criacao?.params as { camposDinamicos?: Record<string, string> })
      .camposDinamicos
    expect(campos?.customfield_10091).toBe(ANA)
    expect(campos?.customfield_10089).toBeTruthy()
  })

  it('o valor da PESSOA vence o do login — o 108 pode ser pedido para outra pessoa (FR-3)', async () => {
    const { ctx, fake } = await ctxDoTipo108()
    await chamar(ctx, '/api/chamados', {
      metodo: 'POST',
      corpo: {
        ...BASE,
        chaveIdempotencia: 'k-edita',
        camposDinamicos: { customfield_10091: 'novato@gocase.com' },
      },
    })
    const criacao = fake.chamadas.find((c) => c.operacao === 'criarChamado')
    const params = criacao?.params as {
      camposDinamicos?: Record<string, string>
      solicitanteEmail: string
      descricao: string
    }
    expect(params.camposDinamicos?.customfield_10091).toBe('novato@gocase.com')

    // 🚨 A metade que importa: editar o campo NÃO muda quem abriu. O que o cliente
    // manda é conteúdo do formulário; a autoria é o `solicitanteEmail`, que vem da
    // identidade resolvida no roteador e vira o vínculo de `RF-30`.
    //
    // ⚠️ O cabeçalho de `D-13` **não** aparece aqui de propósito: ele é montado dentro
    // de `montarCamposSolicitante`, no cliente real, a partir deste mesmo
    // `solicitanteEmail`. Quem o cobre é `cliente-atlassian.test.ts` — afirmar sobre ele
    // neste nível testaria o dublê, não o app.
    expect(params.solicitanteEmail).toBe(ANA)
  })

  it('tipo SEM os campos no schema não recebe nada — o mapa é interseção', async () => {
    const ctx = await ctxCom({
      dominios_permitidos: ['gocase.com'],
      service_desk_id: 'sd-1',
      tipos_chamado_permitidos: ['70'],
    })
    const fake = ctx.atlassian as ClienteAtlassianFake
    fake.estado.camposPorTipo.set('70', [])
    await chamar(ctx, '/api/chamados', {
      metodo: 'POST',
      corpo: { ...BASE, tipoChamadoId: '70', chaveIdempotencia: 'k-70' },
    })
    const criacao = fake.chamadas.find((c) => c.operacao === 'criarChamado')
    const campos = (criacao?.params as { camposDinamicos?: Record<string, string> })
      .camposDinamicos
    expect(campos).toBeUndefined()
  })
})
