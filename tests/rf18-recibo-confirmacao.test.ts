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
import { SEM_MOTIVO_DE_PRIORIDADE } from '@/lib/tickets/motivo-da-prioridade'

const PROPOSTA: Proposta = {
  titulo: 'Relatório de vendas não atualizou',
  descricao: 'O relatório diário não trouxe os dados do dia anterior.',
  tipoChamadoId: 'rt-1',
  prioridade: 'alta',
  area: 'Growth',
  componente: null,
}

function render(
  proposta: Proposta = PROPOSTA,
  extras: {
    tipoNome?: string | null
    negociacao?: Parameters<typeof ReciboConfirmacao>[0]['negociacao']
  } = {},
): string {
  return renderToStaticMarkup(
    createElement(ReciboConfirmacao, {
      ...(extras.negociacao ? { negociacao: extras.negociacao } : {}),
      // A identidade preenche os campos do solicitante (`RF-21`); aqui ela só precisa
      // existir, porque este teste afirma sobre a copy do recibo, não sobre campo.
      eu: { email: 'ana@gocase.com', nome: 'Ana', isAdmin: false, modoDemo: false, somenteLeitura: false },
      conversaId: 'c1',
      propostaInicial: proposta,
      tipoNome: 'tipoNome' in extras ? (extras.tipoNome ?? null) : 'Relatar um problema (Sistema)',
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

  it('sem área, a linha aparece dizendo que ela não foi identificada (`D-52`)', () => {
    const saida = render({ ...PROPOSTA, area: null })
    // ⚠️ Este caso afirmava o contrário — que a linha **sumia**. Fazia sentido enquanto a
    // área do cartão era a extraída pela IA e não ia para lugar nenhum: linha vazia é
    // ruído. Com uma fonte só (`D-52`), esconder a área justamente quando ela é
    // desconhecida tira da tela o único caso em que a pessoa precisaria agir, e deixa
    // `RF-18` (que lista área entre os campos do resumo) incompleto sem nada indicando.
    // O que continua proibido é a linha **vazia**: ela diz o que houve, e o que fazer.
    expect(saida).toContain('Área')
    expect(saida).toContain('não identificada')
    expect(saida).toContain('corrigir depois de abrir o chamado')
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

  /**
   * 🚨 **Esta asserção mudou de objeto, e o caso NÃO foi apagado** (`T-753c`).
   *
   * A dica dizia `{critério}. Sugerimos alta — ajuste se não bate com o seu caso.` e as
   * duas metades faziam trabalhos diferentes: o **critério** responde *o que é Alta* — é o
   * que informa quem está mexendo no seletor, e já tinha descido para fora do `<option>`
   * porque truncava lá dentro. A outra metade não justificava nada; ela **finge**
   * justificar, e ocupava o lugar de quem justifica de verdade (`FR-2`, spec 008).
   *
   * ⚠️ O caso do **critério** continua logo acima, intocado: apagar este arquivo inteiro
   * devolveria o furo que ele fecha.
   */
  it('sem motivo do turno, a tela DECLARA que a sugestão não veio justificada (FR-5)', () => {
    const saida = render(PROPOSTA, {
      negociacao: {
        motivoPrioridade: null,
        motivoIndisponivel: SEM_MOTIVO_DE_PRIORIDADE,
        prioridadeSugerida: 'alta',
        recusasDeAjuste: [],
        assuntoMudou: false,
      },
    })
    expect(saida).toContain(SEM_MOTIVO_DE_PRIORIDADE)
    // A frase que fingia justificar saiu de vez.
    expect(saida).not.toContain('Sugerimos alta')
  })

  it('com motivo, ele aparece no lugar da frase genérica (FR-2)', () => {
    const saida = render(PROPOSTA, {
      negociacao: {
        motivoPrioridade: 'O relatório do dia não fecha e o time comercial trabalha sem ele.',
        motivoIndisponivel: null,
        prioridadeSugerida: 'alta',
        recusasDeAjuste: [],
        assuntoMudou: false,
      },
    })
    expect(saida).toContain('O relatório do dia não fecha')
    // ⚠️ O critério FICA: ele responde uma pergunta que o motivo não responde.
    expect(saida).toContain(CRITERIO_ALTA)
  })
})

/**
 * `RF-18` pede o **tipo** no resumo, e ele faltava — `D-53`.
 *
 * O assunto decide a fila que recebe o chamado. Confirmar sem vê-lo é confirmar o
 * roteamento no escuro, que é o que a Regra 1 e a allowlist de `RF-28` existem para
 * acertar.
 */
describe('RF-18 — o assunto aparece no resumo (D-53)', () => {
  it('mostra o NOME do assunto, nunca o id', () => {
    const saida = render()
    expect(saida).toContain('Assunto')
    expect(saida).toContain('Relatar um problema (Sistema)')
    // ⚠️ `RNF-30`: `134` não informa ninguém, e id de campo/tipo não vai à tela.
    expect(saida).not.toContain('>134<')
  })

  it('sem nome, diz que não identificou — e não inventa rótulo a partir do id', () => {
    const saida = render(undefined, { tipoNome: null })
    expect(saida).toContain('Assunto')
    expect(saida).toContain('não foi possível identificar o assunto agora')
    expect(saida).not.toContain('>134<')
  })
})
