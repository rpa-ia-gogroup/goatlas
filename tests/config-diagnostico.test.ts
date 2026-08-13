/**
 * T-134 — o console afirma o comportamento atual, e a afirmação tem contrato.
 *
 * O que este arquivo protege não é texto bonito: é a **correspondência** entre o
 * que o app faz e o que o console diz que ele faz. Uma allowlist vazia nega
 * (`RNF-07`) — se o diagnóstico disser "ligado", o admin não vai procurar o que
 * está errado, e o app fica desligado em silêncio, que é exatamente o estado que a
 * tela existia para tornar visível.
 *
 * O caso mais fácil de errar é o do meio: `parcial`. Governança sem preço
 * configurado **funciona** (conta assentos) e mesmo assim entrega menos do que
 * deveria. Colapsar isso em "ligado" esconde `Q8`; colapsar em "desligado" manda o
 * admin procurar um defeito que não existe.
 *
 * _Requirements: RF-49, RF-53, RNF-07_
 */

import { describe, expect, it } from 'vitest'
import { CONFIG_PADRAO, type ConfigValores } from '@/lib/config'
import {
  aberturaConfigurada,
  buscaConfigurada,
  diagnosticar,
  estadoDaSecao,
  type Capacidade,
} from '@/lib/config/diagnostico'

/** Uma instalação completa, para variar UMA coisa por vez a partir dela. */
const TUDO_LIGADO: ConfigValores = {
  ...CONFIG_PADRAO,
  dominios_permitidos: ['gocase.com'],
  admins: ['chefe@gocase.com'],
  service_desk_id: '12',
  tipos_chamado_permitidos: ['rt-1', 'rt-2'],
  espacos_confluence: ['TECH', 'RH'],
  regra2_exemplos_ajuste_operacional: ['trocar o CEP de um pedido'],
  org_id: 'org-abc',
  custo_mensal_por_produto: { jira: 7.5 },
}

function capacidade(valores: ConfigValores, id: Capacidade['id']): Capacidade {
  const achada = diagnosticar(valores).find((c) => c.id === id)
  if (!achada) throw new Error(`capacidade ${id} sumiu do diagnóstico`)
  return achada
}

describe('a instalação completa está ligada em tudo', () => {
  it('nenhuma capacidade aparece desligada ou parcial', () => {
    for (const c of diagnosticar(TUDO_LIGADO)) {
      expect(c.estado, `${c.id}: ${c.consequencia}`).toBe('ligado')
    }
  })

  it('toda capacidade diz uma consequência, nunca um nome de chave', () => {
    for (const c of diagnosticar(TUDO_LIGADO)) {
      expect(c.consequencia.length).toBeGreaterThan(20)
      expect(c.consequencia).not.toMatch(/_|customfield|threshold|allowlist|config/i)
      expect(c.nome).not.toMatch(/_/)
    }
  })
})

describe('RNF-07 — vazio nega, e o console diz que nega', () => {
  it('sem domínio, ninguém entra — e a frase não sugere "todos liberados"', () => {
    const c = capacidade({ ...TUDO_LIGADO, dominios_permitidos: [] }, 'entrada')
    expect(c.estado).toBe('desligado')
    expect(c.consequencia).toMatch(/ningu[ée]m/i)
  })

  it('sem espaço do Confluence, a busca está desligada e a deflexão junto', () => {
    const valores = { ...TUDO_LIGADO, espacos_confluence: [] }
    expect(capacidade(valores, 'documentacao').estado).toBe('desligado')
    // A Regra 2 continua rodando: por isso é parcial, não desligado.
    const interrupcao = capacidade(valores, 'interrupcao')
    expect(interrupcao.estado).toBe('parcial')
    expect(interrupcao.consequencia).toMatch(/hist[óo]rico/i)
  })

  it('sem tipo de chamado, nada é oferecido — nem pelo formulário', () => {
    const c = capacidade({ ...TUDO_LIGADO, tipos_chamado_permitidos: [] }, 'chamados')
    expect(c.estado).toBe('desligado')
    expect(c.consequencia).toMatch(/formul[áa]rio/i)
  })

  it('sem service desk, o agente conversa mas não abre', () => {
    const c = capacidade({ ...TUDO_LIGADO, service_desk_id: null }, 'chamados')
    expect(c.estado).toBe('desligado')
  })
})

describe('a Regra 2 sem exemplos reais não roda (RF-14, Q3)', () => {
  it('e o console chama isso de parcial, não de ligado', () => {
    const c = capacidade(
      { ...TUDO_LIGADO, regra2_exemplos_ajuste_operacional: [] },
      'interrupcao',
    )
    expect(c.estado).toBe('parcial')
    expect(c.consequencia).toMatch(/desligada por decis[ãa]o/i)
    // ⚠️ `D-60`: a frase não pode mais falar de "exemplos" que faltam. O campo saiu
    // do console, então descrever a falta mandaria a pessoa procurar, na mesma
    // seção, um controle que não existe — e "está desligada por decisão" é o que de
    // fato aconteceu. O predicado continua sendo `regra2Disponivel`.
    expect(c.consequencia).not.toMatch(/exemplos/i)
  })

  it('sem exemplos E sem espaço, o agente não interrompe ninguém', () => {
    const c = capacidade(
      { ...TUDO_LIGADO, regra2_exemplos_ajuste_operacional: [], espacos_confluence: [] },
      'interrupcao',
    )
    expect(c.estado).toBe('desligado')
  })
})

describe('governança: as duas faltas são diferentes (Q1 e Q8)', () => {
  it('sem organização, nada é coletado', () => {
    const c = capacidade({ ...TUDO_LIGADO, org_id: null }, 'assentos')
    expect(c.estado).toBe('desligado')
    expect(c.consequencia).toMatch(/organiza[çc][ãa]o/i)
  })

  it('com organização e sem preço, conta assento mas não mostra dinheiro', () => {
    const c = capacidade({ ...TUDO_LIGADO, custo_mensal_por_produto: {} }, 'assentos')
    expect(c.estado).toBe('parcial')
    expect(c.consequencia).toMatch(/pre[çc]o|dinheiro/i)
  })
})

describe('o threshold vira porcentagem na frase, sem mudar de valor', () => {
  it('0,75 é dito como 75%', () => {
    const c = capacidade({ ...TUDO_LIGADO, regra1_threshold_score: 0.75 }, 'interrupcao')
    expect(c.consequencia).toContain('75%')
    expect(c.consequencia).not.toContain('0.75')
  })
})

describe('os predicados são os mesmos que o servidor aplica', () => {
  it('busca e abertura respondem como as rotas respondem', () => {
    expect(buscaConfigurada([])).toBe(false)
    expect(buscaConfigurada(['TECH'])).toBe(true)
    expect(aberturaConfigurada({ ...TUDO_LIGADO, service_desk_id: null })).toBe(false)
    expect(aberturaConfigurada({ ...TUDO_LIGADO, tipos_chamado_permitidos: [] })).toBe(false)
    expect(aberturaConfigurada(TUDO_LIGADO)).toBe(true)
  })
})

describe('a trilha do console mostra o estado de cada seção', () => {
  it('seção que edita tem estado; a auditoria, que só lê, não tem', () => {
    expect(estadoDaSecao('documentacao', { ...TUDO_LIGADO, espacos_confluence: [] })).toBe(
      'desligado',
    )
    expect(estadoDaSecao('auditoria', TUDO_LIGADO)).toBeNull()
  })
})

describe('o padrão de fábrica é fail-closed, e o console não disfarça', () => {
  it('instalação recém-criada mostra tudo o que falta', () => {
    const estados = diagnosticar(CONFIG_PADRAO).map((c) => c.estado)
    expect(estados).not.toContain('ligado')
  })
})
