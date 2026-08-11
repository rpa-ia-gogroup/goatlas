/**
 * T-501 / T-503 — o mapa de campos do solicitante é interseção com o schema.
 *
 * O que estes testes protegem é o bug de `D-36`: um id de campo aplicado a um request
 * type onde ele significa outra coisa. Lá o sintoma é **HTTP 201** com o dado no campo
 * errado — nada falha, ninguém vê.
 *
 * _Requirements: RF-21, RF-62, RNF-17, D-36_
 */

import { describe, expect, it } from 'vitest'
import type { CampoRequestType } from '../src/lib/atlassian/tipos'
import type { SchemaDoTipo } from '../src/lib/tickets/declaracao-anexo'
import {
  camposPreenchidosPeloApp,
  MAPA_CAMPOS_DO_SOLICITANTE,
  resolverCamposDoSolicitante,
} from '../src/lib/tickets/campos-do-solicitante'

const EU = { nome: 'Kaique Breno', email: 'kaique.breno@gocase.com' }

function campo(fieldId: string): CampoRequestType {
  return { fieldId, rotulo: fieldId, obrigatorio: true, tipo: 'texto', opcoes: [] }
}

function schemaCom(...ids: string[]): SchemaDoTipo {
  return { conhecido: true, campos: ids.map(campo) }
}

describe('resolverCamposDoSolicitante', () => {
  it('preenche nome e e-mail quando o schema do tipo 108 expõe os dois', () => {
    const r = resolverCamposDoSolicitante(
      '108',
      schemaCom('customfield_10089', 'customfield_10091'),
      EU,
    )
    expect(r).toEqual({
      customfield_10089: 'Kaique Breno',
      customfield_10091: 'kaique.breno@gocase.com',
    })
  })

  it('NÃO envia o campo que o mapa conhece mas o schema não expõe', () => {
    // O cenário real: alguém tira "E-mail" do formulário do portal. Mandá-lo assim
    // mesmo daria 400 = definitivo = chamado perdido (RNF-17).
    const r = resolverCamposDoSolicitante('108', schemaCom('customfield_10089'), EU)
    expect(r).toEqual({ customfield_10089: 'Kaique Breno' })
    expect(r).not.toHaveProperty('customfield_10091')
  })

  it('não envia nada para tipo sem mapa — é o caso de 14 dos 15 tipos do GN', () => {
    expect(resolverCamposDoSolicitante('70', schemaCom('customfield_10092'), EU)).toEqual({})
    expect(resolverCamposDoSolicitante('68', schemaCom('components'), EU)).toEqual({})
  })

  it('schema desconhecido não envia nada — fail-closed no campo (D-27)', () => {
    expect(resolverCamposDoSolicitante('108', { conhecido: false }, EU)).toEqual({})
  })

  it('identidade sem nome não manda string vazia num campo obrigatório', () => {
    const r = resolverCamposDoSolicitante('108', schemaCom('customfield_10089', 'customfield_10091'), {
      nome: '   ',
      email: 'x@gocase.com',
    })
    expect(r).toEqual({ customfield_10091: 'x@gocase.com' })
  })
})

describe('o mapa em si (D-36)', () => {
  it('nenhum fieldId é mapeado em mais de um request type com papéis diferentes', () => {
    // A trava contra reintroduzir o bug de `campo_solicitante_id`: um id só pode ter
    // um papel, e mesmo assim só dentro do tipo onde ele foi conferido.
    const papelPorId = new Map<string, string>()
    for (const mapa of Object.values(MAPA_CAMPOS_DO_SOLICITANTE)) {
      for (const [fieldId, papel] of Object.entries(mapa)) {
        const anterior = papelPorId.get(fieldId)
        expect(anterior === undefined || anterior === papel).toBe(true)
        papelPorId.set(fieldId, papel)
      }
    }
  })

  it('NÃO mapeia customfield_10092 — ele é "cargo" no 108 e "sistema do bug" no 70', () => {
    for (const mapa of Object.values(MAPA_CAMPOS_DO_SOLICITANTE)) {
      expect(mapa).not.toHaveProperty('customfield_10092')
      expect(mapa).not.toHaveProperty('customfield_10093')
    }
  })

  it('camposPreenchidosPeloApp devolve vazio para tipo sem mapa', () => {
    expect(camposPreenchidosPeloApp('108')).toHaveLength(2)
    expect(camposPreenchidosPeloApp('70')).toEqual([])
  })
})
