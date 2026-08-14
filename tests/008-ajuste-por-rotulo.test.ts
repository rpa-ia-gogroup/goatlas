/**
 * A IA ajusta o campo do formulário a pedido — e o `fieldId` nunca sai do servidor (`RF-71`).
 *
 * ## Por que a tradução é por RÓTULO
 *
 * O modelo precisa saber quais campos existem para poder corrigi-los ("na verdade é o Chaplin,
 * não o Factory"). Mandar `fieldId` no prompt violaria `RNF-30` — e, pior, `D-36` mediu que um
 * id de campo **não significa nada** fora do request type: `customfield_10092` é
 * "Cargo/Função" no tipo 108 e "Em que sistema o Bug está ocorrendo?" no 70. O rótulo é o texto
 * que a pessoa já lê na tela; a volta é traduzida aqui, com casamento **exato**.
 *
 * ## As duas recusas, e por que elas são ditas
 *
 * Campo que o assunto não tem e valor fora das opções **não são gravados** — `ScC-6` proíbe
 * qualquer ajuste por texto que produza criação recusada (`D-38`, `D-39`). E a recusa é
 * **dita**, junto do cartão: silêncio aqui faria a pessoa achar que o pedido foi aceito, e
 * descobrir no chamado aberto.
 *
 * ⚠️ **A recusa fala por rótulo, nunca por id** — `RNF-30`, mesma disciplina de `D-38`/`D-48`.
 *
 * _Requirements: RF-71, FR-11, FR-13, FR-14, FR-15, FR-16, ScC-6, RNF-30_
 */

import { describe, expect, it } from 'vitest'
import type { CampoRequestType } from '@/lib/atlassian/tipos'
import {
  ajustarCamposPorRotulo,
  camposParaExtracao,
} from '@/lib/tickets/ajuste-por-rotulo'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const SISTEMA: CampoRequestType = {
  fieldId: 'customfield_10092',
  rotulo: 'Em que sistema o Bug está ocorrendo?',
  obrigatorio: true,
  tipo: 'texto',
  opcoes: [],
}

const AMBIENTE: CampoRequestType = {
  fieldId: 'customfield_10071',
  rotulo: 'Ambiente',
  obrigatorio: false,
  tipo: 'selecao',
  opcoes: [
    { id: '10127', rotulo: 'Produção' },
    { id: '10128', rotulo: 'Homologação' },
  ],
}

const ANEXO: CampoRequestType = {
  fieldId: 'attachment',
  rotulo: 'Anexo',
  obrigatorio: false,
  tipo: 'anexo',
  opcoes: [],
}

const SCHEMA = [SISTEMA, AMBIENTE, ANEXO]

describe('FR-11 — o rótulo casa e o valor é gravado por fieldId', () => {
  it('campo de texto: "é o Chaplin" grava no fieldId certo', () => {
    const r = ajustarCamposPorRotulo(
      [{ rotulo: 'Em que sistema o Bug está ocorrendo?', valor: 'Chaplin' }],
      SCHEMA,
    )
    expect(r.valores).toEqual({ customfield_10092: 'Chaplin' })
    expect(r.recusas).toEqual([])
  })

  it('campo de seleção: o rótulo da opção vira o ID do schema (D-39/D-48)', () => {
    const r = ajustarCamposPorRotulo([{ rotulo: 'Ambiente', valor: 'Homologação' }], SCHEMA)
    expect(r.valores).toEqual({ customfield_10071: '10128' })
  })

  it('o rótulo do campo casa ignorando caixa e espaço nas pontas', () => {
    const r = ajustarCamposPorRotulo([{ rotulo: '  ambiente ', valor: 'Produção' }], SCHEMA)
    expect(r.valores).toEqual({ customfield_10071: '10127' })
  })

  it('a opção casa ignorando caixa e acento — "producao" acha "Produção"', () => {
    const r = ajustarCamposPorRotulo([{ rotulo: 'Ambiente', valor: 'producao' }], SCHEMA)
    expect(r.valores).toEqual({ customfield_10071: '10127' })
  })

  it('pedido vazio não produz nada e não recusa nada', () => {
    const r = ajustarCamposPorRotulo([], SCHEMA)
    expect(r.valores).toEqual({})
    expect(r.recusas).toEqual([])
  })
})

describe('FR-14 — campo que o assunto não tem: nada gravado, recusa dita', () => {
  it('"Recorrência" num assunto que não a tem devolve `campo_inexistente`', () => {
    const r = ajustarCamposPorRotulo([{ rotulo: 'Recorrência', valor: 'Sempre' }], SCHEMA)
    expect(r.valores).toEqual({})
    expect(r.recusas).toEqual([{ rotulo: 'Recorrência', motivo: 'campo_inexistente' }])
  })

  it('um pedido recusado não derruba o outro, que é válido', () => {
    const r = ajustarCamposPorRotulo(
      [
        { rotulo: 'Recorrência', valor: 'Sempre' },
        { rotulo: 'Ambiente', valor: 'Produção' },
      ],
      SCHEMA,
    )
    expect(r.valores).toEqual({ customfield_10071: '10127' })
    expect(r.recusas).toHaveLength(1)
  })
})

describe('FR-13 — valor fora das opções: nada gravado, opções ditas por rótulo', () => {
  it('devolve `opcao_inexistente` com os rótulos válidos', () => {
    const r = ajustarCamposPorRotulo([{ rotulo: 'Ambiente', valor: 'Sandbox' }], SCHEMA)
    expect(r.valores).toEqual({})
    expect(r.recusas).toEqual([
      {
        rotulo: 'Ambiente',
        motivo: 'opcao_inexistente',
        opcoes: ['Produção', 'Homologação'],
      },
    ])
  })

  it('🚨 a recusa NÃO carrega o id da opção nem o fieldId (RNF-30)', () => {
    const r = ajustarCamposPorRotulo([{ rotulo: 'Ambiente', valor: 'Sandbox' }], SCHEMA)
    const texto = JSON.stringify(r.recusas)
    expect(texto).not.toContain('10127')
    expect(texto).not.toContain('customfield')
  })
})

describe('ScC-6 — nenhum ajuste pode produzir criação recusada', () => {
  it('campo de ANEXO nunca é ajustável por texto (RN-11 não vira "anexe um arquivo")', () => {
    const r = ajustarCamposPorRotulo([{ rotulo: 'Anexo', valor: 'print.png' }], SCHEMA)
    expect(r.valores).toEqual({})
    expect(r.recusas).toEqual([{ rotulo: 'Anexo', motivo: 'campo_inexistente' }])
  })

  it('schema vazio (leitura falhou) ajusta ZERO campos e recusa em silêncio — fail-open D-27', () => {
    const r = ajustarCamposPorRotulo([{ rotulo: 'Ambiente', valor: 'Produção' }], [])
    expect(r.valores).toEqual({})
    expect(r.recusas).toEqual([])
  })
})

describe('FR-11 — o que o modelo VÊ do schema, e o que ele nunca vê', () => {
  it('os campos vão por rótulo, tipo e opções — jamais fieldId', () => {
    const vistos = camposParaExtracao(SCHEMA)
    expect(vistos).toEqual([
      { rotulo: 'Em que sistema o Bug está ocorrendo?', tipo: 'texto', opcoes: [] },
      { rotulo: 'Ambiente', tipo: 'selecao', opcoes: ['Produção', 'Homologação'] },
    ])
    expect(JSON.stringify(vistos)).not.toContain('customfield')
  })

  it('o campo de anexo fica fora do que o modelo vê — o agente não pede arquivo (D-59)', () => {
    expect(camposParaExtracao(SCHEMA).some((c) => c.rotulo === 'Anexo')).toBe(false)
  })
})

describe('FR-15 — identidade e área ficam fora deste caminho (teste estrutural)', () => {
  it('o módulo não conhece a palavra "área" nem os campos de identidade do solicitante', () => {
    const fonte = readFileSync(
      join(process.cwd(), 'src/lib/tickets/ajuste-por-rotulo.ts'),
      'utf8',
    )
    // Sem comentários: o que vale é o CÓDIGO — a explicação pode (e deve) citar a decisão.
    const codigo = fonte
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1')
    expect(codigo).not.toMatch(/\barea\b/i)
    expect(codigo).not.toMatch(/camposPreenchidosPeloApp|campos-do-solicitante/)
  })
})
