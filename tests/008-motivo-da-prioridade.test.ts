/**
 * O motivo da prioridade é exibível, ou a tela declara que não veio — spec 008.
 *
 * ## O que este arquivo existe para reprovar
 *
 * A prioridade chegava com uma frase que descrevia o **nível**, não o **caso**:
 * *"Funcionalidade comprometida, com solução alternativa temporária. Sugerimos alta — ajuste
 * se não bate com o seu caso."* Ela vale para qualquer chamado alto que já existiu, então
 * revisar (`RF-16`) era palpite contra palpite e `R-04` seguia sem mitigação.
 *
 * O motivo agora sai da **mesma** operação que escolheu o nível (`RF-68`). Mas texto do modelo
 * não fica confiável por ter chegado tipado: ele pode vir com três frases, em inglês, ou com
 * `customfield_10071` dentro (`RNF-30`). Quem julga é este módulo, e o que ele recusa cai em
 * `FR-5` — nível e prazo aparecem, o botão continua vivo, e a tela **declara** que a sugestão
 * não veio justificada (precedente de `D-53`: ausência declarada, nunca disfarçada).
 *
 * 🚨 **O caso mais importante deste arquivo é o que PASSA:** *"o PC desliga sozinho"* não tem
 * um acento. Um detector "de português" — que exigisse acentuação, ou palavra-função em PT —
 * reprovaria o motivo mais comum do app, e o sintoma seria a tela dizendo "sem justificativa"
 * em quase todo cartão. Por isso a checagem de idioma é **conservadora e de mão única**: ela
 * só recusa inglês declarado, e nunca tenta provar que o texto é português.
 *
 * _Requirements: RF-68, RF-16, RNF-18, RNF-30_
 */

import { describe, expect, it } from 'vitest'
import { motivoExibivel, MAX_FRASES_MOTIVO } from '@/lib/tickets/motivo-da-prioridade'

describe('FR-3 — o teto é de duas frases', () => {
  it('uma frase passa', () => {
    const r = motivoExibivel('O relatório de vendas não carregou e existe contorno manual.')
    expect(r.exibivel).toBe(true)
  })

  it('duas frases passam — é o teto, não o limite anterior a ele', () => {
    const r = motivoExibivel(
      'O relatório de vendas não carregou e há contorno manual. Nenhuma venda parada foi relatada.',
    )
    expect(r.exibivel).toBe(true)
    expect(MAX_FRASES_MOTIVO).toBe(2)
  })

  it('três frases recusam', () => {
    const r = motivoExibivel(
      'O relatório não carregou. Existe contorno manual. Nenhuma venda parada foi relatada.',
    )
    expect(r.exibivel).toBe(false)
    if (!r.exibivel) expect(r.razao).toBe('acima_do_teto')
  })

  it('conta frase por terminador, e "3.000 pedidos" não é duas frases', () => {
    const r = motivoExibivel(
      'O relatório deixou de trazer 3.000 pedidos do dia e há contorno manual.',
    )
    expect(r.exibivel).toBe(true)
  })

  it('a frase final sem ponto continua sendo uma frase', () => {
    const r = motivoExibivel('O relatório não carregou e existe contorno manual')
    expect(r.exibivel).toBe(true)
  })
})

describe('FR-5 — ausência e formato inválido caem na declaração', () => {
  it('`null` recusa, e o motivo da recusa é "ausente"', () => {
    const r = motivoExibivel(null)
    expect(r.exibivel).toBe(false)
    if (!r.exibivel) expect(r.razao).toBe('ausente')
  })

  it('string vazia ou só espaço recusa como ausente', () => {
    expect(motivoExibivel('   ').exibivel).toBe(false)
    expect(motivoExibivel('').exibivel).toBe(false)
  })

  it('texto absurdamente longo recusa mesmo dentro de duas frases', () => {
    const r = motivoExibivel(`${'palavra '.repeat(200)}.`)
    expect(r.exibivel).toBe(false)
  })
})

describe('FR-4 — nenhum identificador interno chega à tela (RNF-30)', () => {
  it('`customfield_10071` no meio do texto recusa', () => {
    const r = motivoExibivel('O campo customfield_10071 indica recorrência alta neste caso.')
    expect(r.exibivel).toBe(false)
    if (!r.exibivel) expect(r.razao).toBe('identificador_interno')
  })

  it('menção a request type interno recusa', () => {
    const r = motivoExibivel('O requesttype 70 costuma ter impacto alto.')
    expect(r.exibivel).toBe(false)
  })

  it('nome de chave de configuração recusa', () => {
    const r = motivoExibivel('Pelo regra1_threshold_score, o caso é de impacto alto.')
    expect(r.exibivel).toBe(false)
  })

  it('número comum do relato NÃO é identificador — o pedido 40321 passa', () => {
    const r = motivoExibivel('O pedido 40321 não foi faturado e a operação segue com contorno.')
    expect(r.exibivel).toBe(true)
  })
})

describe('FR-4 — o idioma: recusa o inglês declarado, nunca exige acento', () => {
  it('🚨 português sem um único acento PASSA', () => {
    const r = motivoExibivel('O PC desliga sozinho e nao existe outra maquina para usar.')
    expect(r.exibivel).toBe(true)
  })

  it('inglês com palavras-função recusa', () => {
    const r = motivoExibivel('The report is not loading and the user cannot work.')
    expect(r.exibivel).toBe(false)
    if (!r.exibivel) expect(r.razao).toBe('idioma')
  })

  it('uma palavra inglesa isolada não condena o texto — "deploy" é palavra do dia a dia aqui', () => {
    const r = motivoExibivel('O deploy de ontem derrubou o relatório e não há contorno.')
    expect(r.exibivel).toBe(true)
  })

  it('nome de sistema em inglês não condena — "Sales Report" passa', () => {
    const r = motivoExibivel('O Sales Report parou de atualizar e a operação segue manual.')
    expect(r.exibivel).toBe(true)
  })
})

describe('o que sai é o texto aparado, nunca o original cru', () => {
  it('espaço nas pontas é removido', () => {
    const r = motivoExibivel('  O relatório não carregou.  ')
    expect(r.exibivel).toBe(true)
    if (r.exibivel) expect(r.motivo).toBe('O relatório não carregou.')
  })
})
