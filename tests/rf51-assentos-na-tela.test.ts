/**
 * **T-128 / T-131** — o inventário de assentos CHEGA à tela, e revogar existe no console.
 *
 * ## O buraco que este arquivo tapa
 *
 * `GET /api/admin/assentos` devolve `itens` desde a T-124 e **nada em `src/app/` os
 * consumia**: o console dizia "N assentos parados" e nunca **quem**. `RF-57` tinha rota com
 * dupla confirmação e `api.adminRevogarAssento` no cliente, e **nenhum componente o
 * chamava** — a parte que protege existia só na camada que ninguém usava. Os dois achados
 * são da auditoria de `D-47`, e são o formato dominante dela: servidor pronto, tela
 * ausente, suíte verde — porque comportamento **ausente** não quebra teste.
 *
 * ## O que se afirma, e o que deliberadamente não
 *
 * Afirma-se que **o dado aparece** e que **a ação está lá com a confirmação**. Não se
 * afirma layout, classe de CSS nem ordem de elementos: teste que copia desenho reprova em
 * toda melhoria de tela, vira peso morto e é apagado — devolvendo o buraco (é a mesma
 * política de `tests/painel-do-console.test.ts`).
 *
 * _Requirements: RF-51, RF-52, RF-53, RF-54, RF-57, RN-10_
 */

import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import type { RespostaAssentos } from '@/app/api'
import { LinhaDePessoa, PainelAssentos } from '@/app/admin/paineis'
import { inventarioPorPessoa } from '@/lib/governanca/inventario-por-pessoa'

const AGORA = Date.parse('2026-08-12T12:00:00.000Z')
const DIA = 1000 * 60 * 60 * 24

const ITENS = [
  {
    accountId: 'a1',
    email: 'ana@gocase.com',
    nome: 'Ana Souza',
    produto: 'confluence',
    ultimoAcessoEm: new Date(AGORA - 90 * DIA).toISOString(),
  },
  {
    accountId: 'a1',
    email: 'ana@gocase.com',
    nome: 'Ana Souza',
    produto: 'jira-software',
    ultimoAcessoEm: null,
  },
  {
    accountId: 'b2',
    email: 'bruno@gocase.com',
    nome: 'Bruno Lima',
    produto: 'jira-servicedesk',
    ultimoAcessoEm: new Date(AGORA - 2 * DIA).toISOString(),
  },
]

const ASSENTOS: RespostaAssentos = {
  coletadoEm: '2026-08-12T06:00:00.000Z',
  ociosoDesdeDias: 30,
  limitacoesUltimoAcesso: {
    atrasoMaximoHoras: 24,
    criterioAtivo: 'Considerado "ativo" quem visualizou uma página do produto.',
  },
  itens: ITENS,
  custo: {
    porProduto: [{ produto: 'confluence', usuarios: 1, ociosos: 1, custoMensalUsd: null }],
    totalMensalUsd: null,
    custoConfigurado: false,
    ocioso: { usuarios: 1, custoMensalUsd: null, economiaConfiavel: false },
  } as RespostaAssentos['custo'],
  organizacaoConfigurada: true,
  usandoFakes: false,
  endpointsNaoVerificados: [],
  baseline: null,
}

function desenhar(assentos: RespostaAssentos = ASSENTOS, comRevogar = true) {
  return renderToStaticMarkup(
    createElement(PainelAssentos, {
      assentos,
      recomendacoes: { estado: 'pronto', dado: [] },
      agoraMs: AGORA,
      ...(comRevogar ? { aoRevogar: async () => 'revogado' } : {}),
    }),
  )
}

describe('inventarioPorPessoa — a leitura antes do desenho', () => {
  it('agrupa por conta: a Ana é UMA pessoa com dois produtos, não duas linhas', () => {
    const pessoas = inventarioPorPessoa(ITENS, 30, AGORA)
    expect(pessoas.map((p) => p.email)).toEqual(['ana@gocase.com', 'bruno@gocase.com'])
    expect(pessoas[0]?.produtos.map((p) => p.produto)).toEqual(['confluence', 'jira-software'])
  })

  it('ordena mais parado primeiro, e quem nunca acessou nada vem antes de todos', () => {
    const nunca = [
      { accountId: 'c3', email: 'caio@gocase.com', nome: 'Caio', produto: 'confluence', ultimoAcessoEm: null },
      ...ITENS,
    ]
    const pessoas = inventarioPorPessoa(nunca, 30, AGORA)
    expect(pessoas.map((p) => p.email)).toEqual([
      'caio@gocase.com',
      'ana@gocase.com',
      'bruno@gocase.com',
    ])
    expect(pessoas[0]?.diasDesdeUltimoAcesso).toBeNull()
  })

  it('🚨 "sem registro" NÃO vira número: `diasParado` é null, nunca 0', () => {
    const pessoas = inventarioPorPessoa(ITENS, 30, AGORA)
    const semRegistro = pessoas[0]?.produtos.find((p) => p.produto === 'jira-software')
    expect(semRegistro?.diasParado).toBeNull()
    // Mas continua contando como parado — é a decisão de `assentoOcioso`, não uma segunda.
    expect(semRegistro?.ocioso).toBe(true)
  })

  it('`todosParados` só é verdade quando NENHUM produto foi usado na janela', () => {
    const pessoas = inventarioPorPessoa(ITENS, 30, AGORA)
    expect(pessoas.find((p) => p.email === 'ana@gocase.com')?.todosParados).toBe(true)
    expect(pessoas.find((p) => p.email === 'bruno@gocase.com')?.todosParados).toBe(false)
  })

  it('empate é desfeito pelo e-mail — a mesma tela duas vezes mostra a mesma ordem', () => {
    const empatados = [
      { accountId: 'z', email: 'zeca@gocase.com', nome: 'Zeca', produto: 'confluence', ultimoAcessoEm: null },
      { accountId: 'a', email: 'aline@gocase.com', nome: 'Aline', produto: 'confluence', ultimoAcessoEm: null },
    ]
    expect(inventarioPorPessoa(empatados, 30, AGORA).map((p) => p.email)).toEqual([
      'aline@gocase.com',
      'zeca@gocase.com',
    ])
  })
})

describe('a lista chega à tela (RF-51, RF-52)', () => {
  it('nomeia quem está com assento — não só quantos', () => {
    const html = desenhar()
    expect(html).toContain('ana@gocase.com')
    expect(html).toContain('Ana Souza')
    expect(html).toContain('bruno@gocase.com')
  })

  it('🚨 diz "sem registro de acesso" em palavras, nunca um número inventado', () => {
    // Quem não tem registro em produto nenhum. O resumo da linha responde "há quanto tempo
    // esta pessoa não usa NADA" — e aqui a resposta honesta não é um número.
    const html = desenhar({
      ...ASSENTOS,
      itens: [
        {
          accountId: 'c3',
          email: 'caio@gocase.com',
          nome: 'Caio Dias',
          produto: 'confluence',
          ultimoAcessoEm: null,
        },
      ],
    })
    expect(html).toContain('sem registro de acesso')
    expect(html).not.toContain('parado há 0 dias')
  })

  it('quem usou recentemente não é anunciado como parado', () => {
    expect(desenhar()).toContain('usou há 2 dias')
  })

  it('a limitação oficial de RF-52 continua na tela, junto do dado', () => {
    expect(desenhar()).toContain('visualizou uma página do produto')
  })

  it('lista vazia com coleta feita não vira "ninguém tem assento"', () => {
    const html = desenhar({ ...ASSENTOS, itens: [] })
    expect(html).toContain('domínio reivindicado')
    expect(html).not.toContain('ana@gocase.com')
  })

  it('endpoint não verificado aparece ao lado da ação, não em rodapé', () => {
    const html = desenhar({
      ...ASSENTOS,
      endpointsNaoVerificados: [
        { metodo: 'DELETE', caminho: '/admin/v1/orgs/{orgId}/directory/users', risco: 'nunca exercitado' },
      ],
    })
    expect(html).toContain('/admin/v1/orgs/{orgId}/directory/users')
    expect(html).toContain('nunca exercitado')
  })
})

describe('a linha ABERTA: último acesso por produto (RF-52) e a ação (RF-57)', () => {
  const ana = inventarioPorPessoa(ITENS, 30, AGORA).find((p) => p.email === 'ana@gocase.com')!

  const abrir = (podeRevogar: boolean) =>
    renderToStaticMarkup(
      createElement(LinhaDePessoa, {
        pessoa: ana,
        aberta: true,
        aoAlternar: () => undefined,
        ociosoDesdeDias: 30,
        podeRevogar,
        ...(podeRevogar ? { aoRevogar: async () => 'revogado' } : {}),
      }),
    )

  it('mostra CADA produto com quando foi usado — é a metade de RF-52 que faltava', () => {
    const html = abrir(true)
    expect(html).toContain('confluence')
    expect(html).toContain('há 90 dias')
    expect(html).toContain('jira-software')
    // 🚨 O produto nunca acessado não vira "há 0 dias".
    expect(html).toContain('sem registro')
    expect(html).not.toContain('há 0 dias')
  })

  it('🚨 oferece revogar POR PRODUTO, nomeando o produto no botão', () => {
    const html = abrir(true)
    expect(html).toContain('Revogar confluence')
    expect(html).toContain('Revogar jira-software')
  })

  it('sem permissão de revogar, os produtos continuam visíveis e o botão não existe', () => {
    const html = abrir(false)
    expect(html).toContain('confluence')
    expect(html).not.toContain('Revogar confluence')
  })

  it('🚨 sem credencial de Org Admin a ação NÃO é oferecida — e a tela diz por quê', () => {
    const html = desenhar({ ...ASSENTOS, organizacaoConfigurada: false })
    expect(html).toContain('Revogar acesso está indisponível')
    // E a lista continua servindo para decidir (`RNF-18`: degradar, não virar parede).
    expect(html).toContain('ana@gocase.com')
  })

  it('sem callback de revogação a lista continua inteira', () => {
    const html = desenhar(ASSENTOS, false)
    expect(html).toContain('ana@gocase.com')
    expect(html).toContain('bruno@gocase.com')
  })
})
