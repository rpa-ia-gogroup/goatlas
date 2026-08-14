/**
 * A tela do Investigador — spec 009, `FR-12`, `FR-13`, `FR-14`.
 *
 * ⚠️ **Existe por causa de `D-47`**: o formato dominante de defeito neste projeto é
 * *servidor pronto, tela ausente*, e teste ausente não falha. A suíte roda em
 * `environment: 'node'` e não clica em nada, então o que se afirma aqui é o que a marcação
 * **diz** — nunca como ela é desenhada, que reprovaria em toda melhoria de tela (`D-49`).
 *
 * _Requirements: FR-12, FR-13, FR-14_
 */

import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { LinhaDeSessao, formatarMs } from '@/app/investigador'
import type { SessaoInvestigada } from '@/app/api'

const BASE: SessaoInvestigada = {
  conversaId: 'c-1',
  solicitanteEmail: 'ana@gocase.com',
  estado: 'coletando',
  criadoEm: '2026-08-14T12:43:24.000Z',
  ultimaAtividade: '2026-08-14T13:52:00.000Z',
  custoUsd: 0.03,
  mensagensDaPessoa: 6,
  mensagensDoAgente: 6,
  bloqueios: 0,
  overrides: 0,
  temProposta: false,
  confirmadoEm: null,
  issueKey: null,
  requisicoes: 9,
  errosDeApi: 0,
  duracaoMaximaMs: 38_000,
  motivoSemProposta: 'extracao_sem_proposta',
}

const desenhar = (s: SessaoInvestigada) =>
  renderToStaticMarkup(createElement(LinhaDeSessao, { sessao: s, aoAbrir: () => {} }))

describe('a linha da sessão', () => {
  it('o caso de 14/08 se lê na linha: seis mensagens, sem chamado, sem cartão', () => {
    const html = desenhar(BASE)
    expect(html).toContain('ana@gocase.com')
    expect(html).toContain('6 mensagens')
    expect(html).toContain('Sem chamado')
    expect(html).toContain('Sem cartão')
  })

  it('o motivo aparece em PORTUGUÊS, não como rótulo técnico', () => {
    const html = desenhar(BASE)
    // 🚨 Quem lê o console precisa saber o que fazer. `extracao_sem_proposta` na tela
    // devolveria metade do problema.
    expect(html).not.toContain('extracao_sem_proposta')
    expect(html).toContain('recusada na leitura')
  })

  it('com cartão, o motivo antigo NÃO aparece — ele explicaria algo que deixou de valer', () => {
    const html = desenhar({ ...BASE, temProposta: true, motivoSemProposta: null })
    expect(html).not.toContain('Sem cartão')
    expect(html).not.toContain('recusada na leitura')
  })

  it('chamado aberto aparece pela chave', () => {
    const html = desenhar({ ...BASE, temProposta: true, issueKey: 'GN-6910' })
    expect(html).toContain('GN-6910')
    expect(html).not.toContain('Sem chamado')
  })

  it('bloqueio e override são contados na mesma marca', () => {
    const html = desenhar({ ...BASE, bloqueios: 2, overrides: 1 })
    expect(html).toContain('2 bloqueios')
    expect(html).toContain('1 override')
  })

  it('erro de API é marca de DESTAQUE — é o que pede atenção', () => {
    const html = desenhar({ ...BASE, errosDeApi: 3 })
    expect(html).toContain('3 erros de API')
    expect(html).toContain('inv-marca-destaque')
  })

  it('turno lento é dito com a unidade certa', () => {
    expect(desenhar(BASE)).toContain('38,0 s')
  })

  it('turno rápido não vira marca de lentidão', () => {
    expect(desenhar({ ...BASE, duracaoMaximaMs: 900 })).not.toContain('Turno mais lento')
  })

  // ⚠️ "1 mensagens" apareceu na staging em 14/08. É o tipo de erro que nenhuma asserção de
  // comportamento pega e que todo leitor vê — a regra 4 vale para número também.
  it('uma mensagem é "1 mensagem", não "1 mensagens"', () => {
    const html = desenhar({ ...BASE, mensagensDaPessoa: 1 })
    expect(html).toContain('1 mensagem<')
    expect(html).not.toContain('1 mensagens')
  })
})

describe('formatação de duração', () => {
  it('milissegundos abaixo de um segundo', () => {
    expect(formatarMs(340)).toBe('340 ms')
  })
  it('segundos com vírgula acima de mil — é como se lê em português', () => {
    expect(formatarMs(1234)).toBe('1,2 s')
  })
})
