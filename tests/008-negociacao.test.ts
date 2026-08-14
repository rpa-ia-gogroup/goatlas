/**
 * O merge de três pontas: o que a IA mudou aparece, o que a pessoa mexeu fica — `RN-13`.
 *
 * ## O que este arquivo existe para reprovar
 *
 * Duas metades erradas, igualmente ruins:
 *
 * - **adotar a proposta inteira** apaga o que a pessoa digitou (`SC-7`);
 * - **preservar tudo** faz o ajuste que ela pediu não aparecer (`FR-8`) — o defeito medido em
 *   13/08/2026, quando argumentar não mudava nada na tela.
 *
 * 🚨 **E a armadilha silenciosa é a BASE do diff.** Se `alterados` for calculado contra a
 * proposta **vigente**, ela já carrega a edição da pessoa (`PUT /proposta`, `RF-16`): a pessoa
 * baixa a prioridade para `normal`, a IA repete `alta` sem ter mudado de opinião, o diff diz
 * *"a IA mudou a prioridade"* e a tela atropela a escolha dela. Nenhum erro, nenhum log,
 * nenhum teste vermelho — a feature "funcionando". Por isso a base é `proposta_ia_json`, e por
 * isso os dois casos marcados 🚨 abaixo existem.
 *
 * ⚠️ **Um produtor só de `alterados`** (servidor), dois consumidores (a resposta HTTP e a
 * auditoria de `FR-23`). Calcular no cliente faria a tela mesclar por um critério e o console
 * contar por outro — a divergência que `D-52` e `D-70` já custaram.
 *
 * _Requirements: RN-13, RF-69, RF-16, FR-8, FR-9, FR-10, FR-23_
 */

import { describe, expect, it } from 'vitest'
import type { PropostaDaIa } from '@/lib/agent/estado'
import { diffDeProposta, houveAjusteDeProposta } from '@/lib/tickets/diff-de-proposta'
import { mesclarNaTela } from '@/app/negociacao'

const BASE: PropostaDaIa = {
  titulo: 'Relatório de vendas não atualizou',
  descricao: 'O relatório diário não trouxe os dados de ontem.',
  tipoChamadoId: '70',
  prioridade: 'alta',
  area: null,
  componente: null,
  motivoPrioridade: 'O relatório não carregou e há contorno manual. Nenhuma venda parada.',
  campos: { customfield_10050: 'Factory' },
}

/* ---------- o diff ---------------------------------------------------------- */

describe('diffDeProposta — o que a IA mudou nesta volta', () => {
  it('proposta idêntica não produz campo nenhum', () => {
    expect(diffDeProposta(BASE, BASE)).toEqual([])
  })

  it('prioridade mudada entra na lista', () => {
    expect(diffDeProposta(BASE, { ...BASE, prioridade: 'critica' })).toEqual(['prioridade'])
  })

  it('título e descrição entram pelos próprios nomes', () => {
    const nova = { ...BASE, titulo: 'Outro título aqui', descricao: 'Outra descrição bem maior.' }
    expect([...diffDeProposta(BASE, nova)].sort()).toEqual(['descricao', 'titulo'])
  })

  it('assunto mudado entra como `tipoChamadoId`', () => {
    expect(diffDeProposta(BASE, { ...BASE, tipoChamadoId: '134' })).toEqual(['tipoChamadoId'])
  })

  it('campo de formulário entra prefixado, para não colidir com campo da proposta', () => {
    const nova = { ...BASE, campos: { customfield_10050: 'Chaplin' } }
    expect(diffDeProposta(BASE, nova)).toEqual(['campo:customfield_10050'])
  })

  it('campo novo (que a base não tinha) também entra', () => {
    const nova = { ...BASE, campos: { ...BASE.campos, customfield_10071: '10127' } }
    expect(diffDeProposta(BASE, nova)).toEqual(['campo:customfield_10071'])
  })

  it('base ausente (primeira proposta da conversa) não inventa mudança de nada', () => {
    expect(diffDeProposta(null, BASE)).toEqual([])
  })

  it('o motivo é campo como os outros — a tela precisa saber que ele mudou', () => {
    const nova = { ...BASE, motivoPrioridade: 'Outra redação do mesmo julgamento.' }
    expect(diffDeProposta(BASE, nova)).toEqual(['motivoPrioridade'])
  })
})

describe('houveAjusteDeProposta — motivo reescrito sozinho NÃO é ajuste (ScC-9)', () => {
  it('só o motivo mudou: não conta como proposta ajustada', () => {
    expect(houveAjusteDeProposta(['motivoPrioridade'])).toBe(false)
  })

  it('motivo + prioridade conta', () => {
    expect(houveAjusteDeProposta(['motivoPrioridade', 'prioridade'])).toBe(true)
  })

  it('campo de formulário conta', () => {
    expect(houveAjusteDeProposta(['campo:customfield_10050'])).toBe(true)
  })

  it('lista vazia não conta', () => {
    expect(houveAjusteDeProposta([])).toBe(false)
  })
})

/* ---------- o merge na tela ------------------------------------------------- */

const NA_TELA = {
  prioridade: 'alta' as const,
  valoresCampos: { customfield_10050: 'Factory', customfield_10099: 'digitado pela pessoa' },
}

describe('FR-8 — o que a IA mudou passa a valer o da IA', () => {
  it('prioridade em `alterados` vence a da tela', () => {
    const r = mesclarNaTela({
      naTela: NA_TELA,
      prioridadeDaProposta: 'critica',
      camposSugeridos: {},
      alterados: ['prioridade'],
      assuntoMudou: false,
    })
    expect(r.prioridade).toBe('critica')
  })

  it('campo em `alterados` vence o valor digitado', () => {
    const r = mesclarNaTela({
      naTela: NA_TELA,
      prioridadeDaProposta: 'alta',
      camposSugeridos: { customfield_10050: 'Chaplin' },
      alterados: ['campo:customfield_10050'],
      assuntoMudou: false,
    })
    expect(r.valoresCampos.customfield_10050).toBe('Chaplin')
  })
})

describe('FR-9 / SC-7 — o que a IA não tocou continua como a pessoa deixou', () => {
  it('🚨 prioridade baixada à mão SOBREVIVE quando a IA não mudou de opinião', () => {
    const r = mesclarNaTela({
      naTela: { ...NA_TELA, prioridade: 'normal' },
      // A IA devolveu `alta` outra vez — a opinião dela nunca mudou, então `alterados` é vazio.
      prioridadeDaProposta: 'alta',
      camposSugeridos: {},
      alterados: [],
      assuntoMudou: false,
    })
    expect(r.prioridade).toBe('normal')
  })

  it('🚨 e o campo digitado sobrevive ao mesmo turno', () => {
    const r = mesclarNaTela({
      naTela: { ...NA_TELA, prioridade: 'normal' },
      prioridadeDaProposta: 'alta',
      camposSugeridos: { customfield_10050: 'Factory' },
      alterados: [],
      assuntoMudou: false,
    })
    expect(r.valoresCampos).toEqual(NA_TELA.valoresCampos)
  })

  it('campo que a pessoa preencheu e a IA não mencionou permanece', () => {
    const r = mesclarNaTela({
      naTela: NA_TELA,
      prioridadeDaProposta: 'alta',
      camposSugeridos: { customfield_10050: 'Chaplin' },
      alterados: ['campo:customfield_10050'],
      assuntoMudou: false,
    })
    expect(r.valoresCampos.customfield_10099).toBe('digitado pela pessoa')
  })
})

describe('FR-10 — assunto mudou, formulário novo começa vazio', () => {
  it('os valores do assunto anterior são descartados', () => {
    const r = mesclarNaTela({
      naTela: NA_TELA,
      prioridadeDaProposta: 'alta',
      camposSugeridos: {},
      alterados: ['tipoChamadoId'],
      assuntoMudou: true,
    })
    expect(r.valoresCampos).toEqual({})
  })

  it('mas a prioridade não é descartada junto — ela não pertence ao formulário do assunto', () => {
    const r = mesclarNaTela({
      naTela: { ...NA_TELA, prioridade: 'normal' },
      prioridadeDaProposta: 'alta',
      camposSugeridos: {},
      alterados: ['tipoChamadoId'],
      assuntoMudou: true,
    })
    expect(r.prioridade).toBe('normal')
  })

  it('sugestão de campo no turno em que o assunto muda é ignorada (FR-16)', () => {
    const r = mesclarNaTela({
      naTela: NA_TELA,
      prioridadeDaProposta: 'alta',
      camposSugeridos: { customfield_10050: 'Chaplin' },
      alterados: ['tipoChamadoId', 'campo:customfield_10050'],
      assuntoMudou: true,
    })
    expect(r.valoresCampos).toEqual({})
  })
})

describe('o merge é PURO — não muda o objeto que recebeu', () => {
  it('o estado da tela entra intacto e sai copiado', () => {
    const entrada = { prioridade: 'alta' as const, valoresCampos: { a: '1' } }
    mesclarNaTela({
      naTela: entrada,
      prioridadeDaProposta: 'critica',
      camposSugeridos: { a: '2' },
      alterados: ['prioridade', 'campo:a'],
      assuntoMudou: false,
    })
    expect(entrada.valoresCampos).toEqual({ a: '1' })
    expect(entrada.prioridade).toBe('alta')
  })
})
