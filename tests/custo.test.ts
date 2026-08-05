/**
 * `governanca/custo.ts` e `governanca/recomendacoes.ts` e `governanca/csv.ts` —
 * funções PURAS (RF-53, RF-54).
 *
 * O ponto que mais importa aqui: **sem Q8, nunca um número inventado**. Um total
 * que soma só os produtos com preço e chama a si mesmo de "total" seria pior que
 * `null` — é o número com que alguém decide rebaixar o acesso de um colega.
 *
 * _Requirements: RF-53, RF-54_
 */

import { describe, expect, it } from 'vitest'
import { assentoOcioso, calcularCusto } from '@/lib/governanca/custo'
import { gerarRecomendacoes, PRODUTO_SERVICE_DESK_AGENTE } from '@/lib/governanca/recomendacoes'
import { recomendacoesParaCsv } from '@/lib/governanca/csv'
import type { ItemInventario } from '@/lib/governanca/inventario'

const AGORA = Date.parse('2026-08-05T12:00:00.000Z')
const OCIOSO_DIAS = 90

function item(over: Partial<ItemInventario> = {}): ItemInventario {
  return {
    accountId: 'acc-1',
    email: 'ana@gocase.com',
    nome: 'Ana',
    produto: 'confluence',
    ultimoAcessoEm: '2026-08-01T00:00:00.000Z',
    ...over,
  }
}

describe('RF-53 — assentoOcioso', () => {
  it('nunca visto pela API é o caso mais ocioso que existe', () => {
    expect(assentoOcioso(null, OCIOSO_DIAS, AGORA)).toBe(true)
  })

  it('acesso recente não é ocioso', () => {
    expect(assentoOcioso('2026-08-01T00:00:00.000Z', OCIOSO_DIAS, AGORA)).toBe(false)
  })

  it('acesso há mais de N dias é ocioso', () => {
    const antigo = new Date(AGORA - 91 * 24 * 60 * 60 * 1000).toISOString()
    expect(assentoOcioso(antigo, OCIOSO_DIAS, AGORA)).toBe(true)
  })

  it('exatamente N dias já conta como ocioso (limite inclusivo)', () => {
    const limite = new Date(AGORA - 90 * 24 * 60 * 60 * 1000).toISOString()
    expect(assentoOcioso(limite, OCIOSO_DIAS, AGORA)).toBe(true)
  })
})

describe('RF-53 — calcularCusto NUNCA inventa número (Q8)', () => {
  it('sem NENHUM preço configurado: contagem certa, dinheiro null', () => {
    const itens = [
      item({ accountId: 'a1', produto: 'confluence' }),
      item({ accountId: 'a2', produto: 'confluence', ultimoAcessoEm: null }),
      item({ accountId: 'a3', produto: 'jira-servicedesk' }),
    ]
    const r = calcularCusto(itens, {}, OCIOSO_DIAS, AGORA)
    expect(r.custoConfigurado).toBe(false)
    expect(r.totalMensalUsd).toBeNull()
    expect(r.ocioso.custoMensalUsd).toBeNull()
    expect(r.ocioso.usuarios).toBe(1)
    const confluence = r.porProduto.find((p) => p.produto === 'confluence')
    expect(confluence?.usuarios).toBe(2)
    expect(confluence?.custoMensalUsd).toBeNull()
  })

  it('preço PARCIAL (um produto sem preço) ainda não é "configurado" — não sub-conta em silêncio', () => {
    const itens = [
      item({ accountId: 'a1', produto: 'confluence' }),
      item({ accountId: 'a2', produto: 'jira-servicedesk' }),
    ]
    const r = calcularCusto(itens, { confluence: 5 }, OCIOSO_DIAS, AGORA)
    expect(r.custoConfigurado).toBe(false)
    expect(r.totalMensalUsd).toBeNull()
    // Mesmo sem total, o produto que TEM preço mostra o dele — informação parcial
    // não é a mesma coisa que dinheiro inventado.
    const confluence = r.porProduto.find((p) => p.produto === 'confluence')
    expect(confluence?.custoMensalUsd).toBe(5)
    const servicedesk = r.porProduto.find((p) => p.produto === 'jira-servicedesk')
    expect(servicedesk?.custoMensalUsd).toBeNull()
  })

  it('com TODOS os preços configurados, soma corretamente', () => {
    const itens = [
      item({ accountId: 'a1', produto: 'confluence' }),
      item({ accountId: 'a2', produto: 'confluence', ultimoAcessoEm: null }),
      item({ accountId: 'a3', produto: 'jira-servicedesk' }),
    ]
    const r = calcularCusto(itens, { confluence: 10, 'jira-servicedesk': 20 }, OCIOSO_DIAS, AGORA)
    expect(r.custoConfigurado).toBe(true)
    expect(r.totalMensalUsd).toBe(2 * 10 + 20)
    // 1 dos 2 assentos de confluence está ocioso.
    expect(r.ocioso.usuarios).toBe(1)
    expect(r.ocioso.custoMensalUsd).toBe(10)
  })

  it('sem itens no inventário: nada configurado, nada inventado', () => {
    const r = calcularCusto([], { confluence: 10 }, OCIOSO_DIAS, AGORA)
    expect(r.porProduto).toEqual([])
    expect(r.custoConfigurado).toBe(false)
    expect(r.totalMensalUsd).toBeNull()
  })
})

describe('RF-54 — gerarRecomendacoes', () => {
  it('caso central: só usa o assento para abrir chamado → rebaixar para customer', () => {
    const itens = [item({ accountId: 'a1', produto: PRODUTO_SERVICE_DESK_AGENTE })]
    const r = gerarRecomendacoes(itens, OCIOSO_DIAS, AGORA)
    expect(r).toHaveLength(1)
    expect(r[0]?.tipo).toBe('rebaixar_para_customer')
  })

  it('tem service desk E outro produto OCIOSO → ainda é o caso central', () => {
    const itens = [
      item({ accountId: 'a1', produto: PRODUTO_SERVICE_DESK_AGENTE }),
      item({ accountId: 'a1', produto: 'confluence', ultimoAcessoEm: null }),
    ]
    const r = gerarRecomendacoes(itens, OCIOSO_DIAS, AGORA)
    expect(r[0]?.tipo).toBe('rebaixar_para_customer')
    expect(r[0]?.produtosAfetados).toContain('confluence')
  })

  it('tem service desk E outro produto ATIVO → NÃO recomenda (uso legítimo)', () => {
    const itens = [
      item({ accountId: 'a1', produto: PRODUTO_SERVICE_DESK_AGENTE }),
      item({ accountId: 'a1', produto: 'confluence', ultimoAcessoEm: '2026-08-04T00:00:00.000Z' }),
    ]
    const r = gerarRecomendacoes(itens, OCIOSO_DIAS, AGORA)
    expect(r).toEqual([])
  })

  it('sem service desk, tudo ocioso → remover (não é o caso central, mas é lixo)', () => {
    const itens = [item({ accountId: 'a1', produto: 'confluence', ultimoAcessoEm: null })]
    const r = gerarRecomendacoes(itens, OCIOSO_DIAS, AGORA)
    expect(r[0]?.tipo).toBe('remover_ocioso')
  })

  it('uso ativo, sem service desk → nenhuma recomendação', () => {
    const itens = [item({ accountId: 'a1', produto: 'confluence' })]
    expect(gerarRecomendacoes(itens, OCIOSO_DIAS, AGORA)).toEqual([])
  })
})

describe('RF-54 — recomendacoesParaCsv escapa vírgula, aspas e fórmula', () => {
  it('vírgula e aspas no nome ficam entre aspas, com aspas duplicadas', () => {
    const csv = recomendacoesParaCsv([
      {
        accountId: 'a1',
        email: 'ana@gocase.com',
        nome: 'Ana, "a chefe"',
        tipo: 'remover_ocioso',
        motivo: 'sem uso',
        produtosAfetados: ['confluence'],
      },
    ])
    const linhas = csv.split('\r\n')
    expect(linhas[1]).toContain('"Ana, ""a chefe"""')
  })

  it('BURLA — campo começando com "=" não vira fórmula executável', () => {
    const csv = recomendacoesParaCsv([
      {
        accountId: 'a1',
        email: 'ana@gocase.com',
        nome: '=SOMA(A1:A9)',
        tipo: 'remover_ocioso',
        motivo: 'sem uso',
        produtosAfetados: [],
      },
    ])
    const linhas = csv.split('\r\n')
    // Prefixado com aspas simples: Excel/Sheets abre como TEXTO, não fórmula.
    expect(linhas[1]).toContain("'=SOMA(A1:A9)")
  })

  it('cabeçalho e ordem das colunas', () => {
    const csv = recomendacoesParaCsv([])
    expect(csv).toBe('email,nome,tipo,motivo,produtos_afetados')
  })
})
