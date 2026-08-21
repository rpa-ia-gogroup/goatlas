/**
 * **T-1320 a T-1323** — o que a IA mudou no cartão, e o que a pessoa mudou não conta.
 *
 * ## Por que este arquivo existe
 *
 * A spec 008 (`D-71`) já gravava tudo o que explica o cartão: a proposta nova, a **base** (a
 * última que a IA produziu) e a lista `alterados`. Nada disso chegava à tela — saía como
 * JSON, e responder *"por que o cartão ficou assim?"* exigia comparar dois objetos a olho.
 *
 * 🚨 **O caso que este arquivo protege é `SC-7` da 008, na superfície.** A base é a última
 * proposta **da IA**, nunca a vigente: diffar contra a vigente faria a IA "mudar" a
 * prioridade só por **repetir** a sugestão que a pessoa tinha rebaixado. O defeito não teria
 * erro, log nem teste vermelho — só uma tela dizendo que a IA mudou de opinião quando ela
 * não mudou.
 *
 * _Requirements: FR-25, FR-26, ScB-01, ScB-02, ScB-03, ScB-04 (spec 013)_
 */

import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { compararPropostas, trilhaDoCartao } from '@/app/investigador/proposta'
import { LinhaDoTempo } from '@/app/investigador'
import type { DetalheDeSessao, EventoRegistrado } from '@/app/api'

const BASE = {
  titulo: 'Protheus fora do ar',
  descricao: 'Ninguém consegue emitir nota fiscal desde as 9h.',
  tipoChamadoId: '134',
  prioridade: 'critica',
  area: 'RPA',
  componente: null,
  motivoPrioridade: 'Emissão de nota parada afeta o faturamento inteiro.',
  campos: { components: '10074' },
}

describe('compararPropostas', () => {
  it('só devolve o que mudou — campo igual não vira linha', () => {
    const m = compararPropostas(BASE, { ...BASE, prioridade: 'alta' })
    expect(m).toHaveLength(1)
    expect(m[0]).toMatchObject({ rotulo: 'prioridade', status: 'alterado', antes: 'critica', depois: 'alta' })
  })

  it('distingue alterado, adicionado e removido', () => {
    const m = compararPropostas(
      { ...BASE, componente: null, area: 'RPA' },
      { ...BASE, componente: 'Invoices', area: null },
    )
    const por = Object.fromEntries(m.map((x) => [x.rotulo, x.status]))
    expect(por['componente']).toBe('adicionado')
    expect(por['área']).toBe('removido')
  })

  it('a descrição é LONGA — a tela desenha antes×depois, não uma linha de tabela', () => {
    const m = compararPropostas(BASE, { ...BASE, descricao: 'Outra coisa.' })
    expect(m[0]?.longo).toBe(true)
  })

  it('valor curto que fica comprido vira longo pelo TAMANHO, não pelo nome do campo', () => {
    const m = compararPropostas(BASE, { ...BASE, titulo: 'x'.repeat(120) })
    expect(m[0]?.rotulo).toBe('título')
    expect(m[0]?.longo).toBe(true)
  })

  it('os campos do formulário são comparados UM a UM, nunca como um bloco só', () => {
    const m = compararPropostas(
      { ...BASE, campos: { components: '10074', recorrencia: '10127' } },
      { ...BASE, campos: { components: '10074', recorrencia: '10128' } },
    )
    // `components` não mudou e não aparece; só `recorrencia`.
    expect(m).toHaveLength(1)
    expect(m[0]?.rotulo).toBe('campo recorrencia')
  })

  it('sem base não há comparação — a primeira derivação não é "tudo adicionado"', () => {
    expect(compararPropostas(null, BASE)).toEqual([])
    expect(compararPropostas(undefined, BASE)).toEqual([])
  })

  it('vazio conta como ausência: título em branco não é título', () => {
    const m = compararPropostas({ ...BASE, titulo: '   ' }, BASE)
    expect(m[0]).toMatchObject({ rotulo: 'título', status: 'adicionado' })
  })
})

// --- a trilha ----------------------------------------------------------------

let n = 0
function evento(dados: unknown, tipo = 'proposta_rederivada'): EventoRegistrado {
  n += 1
  return {
    id: `e-${n}`,
    requisicao_id: `r-${n}`,
    conversa_id: 'c-1',
    ator_email: 'ana@gocase.com',
    tipo,
    origem: 'ia',
    resumo: null,
    dados_json: dados === null ? null : JSON.stringify(dados),
    custo_usd: null,
    duracao_ms: null,
    ordem: n,
    criado_em: `2026-08-20T12:0${n}:00.000Z`,
  }
}

describe('a trilha do cartão', () => {
  it('numera as versões na ordem e diz o que mudou em cada passo', () => {
    const trilha = trilhaDoCartao([
      evento({ proposta: BASE, baseAnterior: null }),
      evento({ proposta: { ...BASE, prioridade: 'alta' }, baseAnterior: BASE }),
      evento({ proposta: { ...BASE, prioridade: 'alta', tipoChamadoId: '70' }, baseAnterior: { ...BASE, prioridade: 'alta' } }),
    ])
    expect(trilha.map((v) => v.numero)).toEqual([1, 2, 3])
    expect(trilha[0]?.mudancas).toEqual([])
    expect(trilha[1]?.mudancas.map((m) => m.rotulo)).toEqual(['prioridade'])
    expect(trilha[2]?.mudancas.map((m) => m.rotulo)).toEqual(['assunto (id do request type)'])
  })

  it('o cartão montado pelo botão é marcado como tal — não é a IA mudando de opinião', () => {
    const trilha = trilhaDoCartao([evento({ proposta: BASE, forcado: true, montou: true })])
    expect(trilha[0]?.forcada).toBe(true)
  })

  it('evento de outro tipo, sem proposta ou com JSON quebrado não entra e não lança', () => {
    const trilha = trilhaDoCartao([
      evento({ proposta: BASE }, 'ia_chat'),
      evento({ alterados: [] }),
      { ...evento(null), dados_json: '{"proposta": {' },
    ])
    expect(trilha).toEqual([])
  })
})

// --- a trava de `SC-7`, na tela ----------------------------------------------

describe('🚨 a edição da PESSOA não vira mudança da IA', () => {
  /**
   * O cenário exato de `SC-7`: a IA sugeriu `critica`, a pessoa rebaixou para `normal` pelo
   * `PUT /proposta` (que mexe na **vigente** e não toca na base), e a IA repetiu `critica` no
   * turno seguinte — sem ter mudado de opinião.
   */
  it('a IA repetir a própria sugestão não aparece como mudança', () => {
    const m = compararPropostas(BASE, BASE)
    expect(m).toEqual([])
  })

  it('e o diff é contra a BASE, não contra o que estava na tela', () => {
    // `proposta` = o que a IA devolveu agora · `baseAnterior` = o que ela tinha devolvido
    // antes. A vigente (com o `normal` da pessoa) nem entra no evento — é essa assimetria
    // que faz `alterados` significar "a IA mudou de opinião".
    const trilha = trilhaDoCartao([
      evento({ proposta: BASE, baseAnterior: null }),
      evento({ proposta: BASE, baseAnterior: BASE }),
    ])
    expect(trilha[1]?.mudancas).toEqual([])
  })
})

// --- a tela ------------------------------------------------------------------

function desenhar(eventos: readonly EventoRegistrado[]): string {
  return renderToStaticMarkup(
    createElement(LinhaDoTempo, {
      dados: { eventos, requisicoes: [], mensagens: [] } as unknown as DetalheDeSessao,
    }),
  )
}

describe('o cartão desenhado', () => {
  it('a trilha aparece com as versões e o antes×depois', () => {
    const html = desenhar([
      evento({ proposta: BASE, baseAnterior: null }),
      evento({ proposta: { ...BASE, prioridade: 'alta' }, baseAnterior: BASE }),
    ])
    expect(html).toContain('Evolução do cartão')
    expect(html).toContain('v1')
    expect(html).toContain('v2')
    expect(html).toContain('prioridade')
    expect(html).toContain('critica')
    expect(html).toContain('alta')
    // Estado em palavra, nunca só em cor (regra 9).
    expect(html).toContain('alterado')
  })

  it('sem mudança, a tela DIZ isso — tabela de diff vazia se lê como defeito', () => {
    const html = desenhar([
      evento({ proposta: BASE, baseAnterior: null }),
      evento({ proposta: BASE, baseAnterior: BASE }),
    ])
    expect(html).toContain('A IA não mudou nada nesta versão')
  })

  it('a primeira versão não finge ter comparação', () => {
    const html = desenhar([evento({ proposta: BASE, baseAnterior: null })])
    expect(html).toContain('Primeira versão')
  })

  it('sessão sem rederivação nenhuma não desenha a trilha', () => {
    const html = desenhar([evento({ texto: 'oi' }, 'mensagem_usuario')])
    expect(html).not.toContain('Evolução do cartão')
  })
})
