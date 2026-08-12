/**
 * O recibo de confirmação — `RF-16` (prioridade editável) e `RF-18` (a pessoa
 * reconhece o que vai sair dali antes de confirmar).
 *
 * O que está travado aqui não é aparência, é **conteúdo que já sumiu da tela uma
 * vez**: o critério da prioridade ("Funcionalidade comprometida, com solução
 * alternativa temporária") vinha dentro do `<option>`, junto do rótulo. Nenhuma
 * largura de select comporta isso — truncava no meio da palavra, e o texto perdido
 * era justamente o que responde "essa prioridade cabe no meu caso?". Ele desceu
 * para a dica, onde aparece inteiro e acompanha a seleção.
 *
 * Sem este teste, "voltar" o critério para dentro da `<option>` parece arrumação e
 * reintroduz o truncamento sem quebrar nada.
 *
 * _Requirements: RF-16, RF-18, RN-08_
 */

import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { ReciboConfirmacao } from '@/app/telas'
import { PRIORIDADES, type Proposta } from '@/app/api'

const PROPOSTA: Proposta = {
  titulo: 'Relatório de vendas não atualizou',
  descricao: 'O relatório diário não trouxe os dados do dia anterior.',
  tipoChamadoId: 'rt-1',
  prioridade: 'alta',
  area: 'Growth',
  componente: null,
}

function render(proposta: Proposta = PROPOSTA): string {
  return renderToStaticMarkup(
    createElement(ReciboConfirmacao, {
      // A identidade preenche os campos do solicitante (`RF-21`); aqui ela só precisa
      // existir, porque este teste afirma sobre a copy do recibo, não sobre campo.
      eu: { email: 'ana@gocase.com', nome: 'Ana', isAdmin: false, modoDemo: false, somenteLeitura: false },
      conversaId: 'c1',
      propostaInicial: proposta,
      aoCriar: () => {},
      // `D-46` — a saída da falha definitiva. Não participa da copy do recibo em si.
      aoRecomecar: () => {},
    }),
  )
}

const CRITERIO_ALTA = PRIORIDADES.find((p) => p.valor === 'alta')!.criterio

describe('RF-18 — o recibo mostra o que vai virar chamado', () => {
  it('traz título, descrição e área', () => {
    const saida = render()
    expect(saida).toContain('Relatório de vendas não atualizou')
    expect(saida).toContain('O relatório diário não trouxe os dados do dia anterior.')
    expect(saida).toContain('Growth')
  })

  it('sem área, a linha não aparece vazia', () => {
    const saida = render({ ...PROPOSTA, area: null })
    expect(saida).not.toContain('ÁREA')
    expect(saida).not.toContain('<dt>Área</dt>')
  })

  it('RN-08 — o prazo se declara de primeira resposta, nunca de solução', () => {
    const saida = render()
    expect(saida).toContain('12h')
    expect(saida).toContain('primeira resposta')
    expect(saida).toContain('não de solução')
  })
})

describe('RF-16 — a prioridade é editável, e o critério fica LEGÍVEL', () => {
  it('a opção do select tem só o rótulo: critério dentro dela trunca', () => {
    const saida = render()
    for (const op of PRIORIDADES) {
      expect(saida).toContain(`>${op.rotulo}</option>`)
    }
    // O critério não pode voltar para dentro da opção.
    expect(saida).not.toContain(`${PRIORIDADES[1]!.rotulo} — ${CRITERIO_ALTA}`)
  })

  it('o critério da prioridade selecionada aparece por extenso fora do select', () => {
    const saida = render()
    expect(saida).toContain(CRITERIO_ALTA)
  })

  it('a sugestão original é dita, para a pessoa saber que pode discordar', () => {
    const saida = render()
    expect(saida).toContain('Sugerimos alta')
    expect(saida).toContain('ajuste se não bate com o seu caso')
  })
})
