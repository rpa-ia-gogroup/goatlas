/**
 * T-140 — o console de administração, nas partes que dá para checar sem navegador.
 *
 * O foco não é aparência: é **o que a tela diz**. Quatro coisas que só o teste
 * garante, porque as quatro voltam sozinhas na primeira pressa:
 *
 * 1. **Nenhum rótulo visível volta a ser nome de chave.** Foi assim que a aba
 *    antiga ficou indecifrável — cada requisito acrescentou o seu campo com o nome
 *    que ele tinha no banco. É o tipo de regressão que passa em qualquer teste de
 *    comportamento e some na revisão.
 * 2. **Todo campo diz o efeito do valor atual.** É a diferença entre um formulário
 *    e um console: "hoje ninguém entra" em vez de um campo de texto vazio.
 * 3. **Estado não é só cor.** Símbolo e palavra nos três casos (regra 9).
 * 4. **Nenhuma seção passa de três controles.** O critério que impede a página de
 *    voltar a acumular.
 *
 * _Requirements: RF-49, RF-50, RNF-18, RNF-28_
 */

import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { CONFIG_PADRAO } from '@/lib/config'
import { diagnosticar } from '@/lib/config/diagnostico'
import type { ConfigValores } from '@/app/api'
import {
  Campo,
  MarcaDeEstado,
  SECOES,
  doRascunho,
  paraRascunho,
  type DescritorCampo,
} from '@/app/admin/campos'
import { Quando } from '@/app/admin/paineis'

const VAZIO: ConfigValores = CONFIG_PADRAO as unknown as ConfigValores

const COMPLETO: ConfigValores = {
  ...VAZIO,
  dominios_permitidos: ['gocase.com'],
  admins: ['chefe@gocase.com'],
  service_desk_id: '12',
  tipos_chamado_permitidos: ['rt-1'],
  espacos_confluence: ['TECH'],
  regra2_exemplos_ajuste_operacional: ['trocar o CEP de um pedido faturado'],
  org_id: 'org-abc',
}

const CAMPOS: readonly DescritorCampo[] = SECOES.flatMap((s) => s.campos)

function campoRenderizado(descritor: DescritorCampo, config: ConfigValores): string {
  return renderToStaticMarkup(
    createElement(Campo, {
      descritor,
      config,
      rascunho: paraRascunho(config[descritor.chave as keyof ConfigValores], descritor.tipo),
      aoMudar: () => {},
      aoSalvar: () => {},
      aoDesfazer: () => {},
      salvando: false,
    }),
  )
}

describe('a linguagem é de decisão, não de banco de dados', () => {
  it('nenhum rótulo carrega nome de chave nem jargão de implementação', () => {
    for (const c of CAMPOS) {
      expect(c.rotulo, c.chave).not.toMatch(/_/)
      expect(c.rotulo, c.chave).not.toMatch(/score|threshold|customfield|payload|id\b/i)
    }
  })

  it('a ajuda não repete o rótulo — cada um faz um trabalho', () => {
    for (const c of CAMPOS) {
      expect(c.ajuda.toLowerCase(), c.chave).not.toBe(c.rotulo.toLowerCase())
      expect(c.ajuda.length, c.chave).toBeGreaterThan(30)
    }
  })

  it('tudo em português com acentuação (regra 4)', () => {
    const texto = CAMPOS.map((c) => `${c.rotulo} ${c.ajuda}`).join(' ')
    expect(texto).toMatch(/[áâãàéêíóôõúçÁÂÃÀÉÊÍÓÔÕÚÇ]/)
    // Uma palavra inglesa solta é o começo do jargão voltando.
    expect(texto).not.toMatch(/\b(score|threshold|payload|endpoint|allowlist)\b/i)
  })
})

describe('todo campo diz o que acontece com o valor de agora', () => {
  it('a frase de efeito muda quando o valor muda', () => {
    for (const c of CAMPOS) {
      const efeitoVazio = c.efeito(VAZIO)
      const efeitoCompleto = c.efeito(COMPLETO)
      expect(efeitoVazio.length, c.chave).toBeGreaterThan(20)
      expect(efeitoCompleto.length, c.chave).toBeGreaterThan(20)
    }
    // Os campos que o preenchimento muda precisam mudar de frase — senão o
    // "efeito" é só mais uma ajuda estática com outro nome.
    const mudaram = CAMPOS.filter((c) => c.efeito(VAZIO) !== c.efeito(COMPLETO))
    expect(mudaram.length).toBeGreaterThanOrEqual(6)
  })

  it('a frase de efeito chega ao HTML, junto do controle', () => {
    const dominios = CAMPOS.find((c) => c.chave === 'dominios_permitidos')!
    const html = campoRenderizado(dominios, VAZIO)
    expect(html).toContain('Hoje ningu')
    expect(html).toContain('campo-efeito')
    expect(html).toContain('<input')
  })

  it('lista mostra em pílulas o que será salvo, item a item', () => {
    const espacos = CAMPOS.find((c) => c.chave === 'espacos_confluence')!
    const html = campoRenderizado(espacos, { ...COMPLETO, espacos_confluence: ['TECH', 'RH'] })
    expect(html).toContain('TECH')
    expect(html).toContain('RH')
    expect(html).toContain('campo-pilulas')
  })

  it('o controle está descrito pela ajuda, para leitor de tela', () => {
    for (const c of CAMPOS) {
      expect(campoRenderizado(c, COMPLETO), c.chave).toContain(`aria-describedby="cfg-${c.chave}-ajuda"`)
    }
  })
})

describe('estado nunca só por cor (regra 9)', () => {
  it.each(['ligado', 'parcial', 'desligado'] as const)('%s traz símbolo e palavra', (estado) => {
    const html = renderToStaticMarkup(createElement(MarcaDeEstado, { estado }))
    expect(html).toMatch(/Ligado|Parcial|Desligado/)
    expect(html).toContain('aria-hidden')
    expect(html).toContain(`data-estado="${estado}"`)
  })
})

describe('a estrutura não volta a acumular', () => {
  it('nenhuma seção passa de três controles', () => {
    for (const s of SECOES) {
      expect(s.campos.length, s.id).toBeLessThanOrEqual(3)
    }
  })

  it('toda seção se explica em uma frase', () => {
    for (const s of SECOES) {
      expect(s.resumo.length, s.id).toBeGreaterThan(30)
    }
  })

  it('toda capacidade do diagnóstico tem uma seção que a resolve', () => {
    const secoes = new Set(SECOES.map((s) => s.id))
    for (const c of diagnosticar(CONFIG_PADRAO)) {
      expect(secoes.has(c.secao), `${c.id} aponta para ${c.secao}`).toBe(true)
    }
  })

  it('as chaves editáveis existem de verdade na configuração', () => {
    for (const c of CAMPOS) {
      expect(Object.keys(CONFIG_PADRAO), c.chave).toContain(c.chave)
    }
  })

  it('o que saiu do console (D-25) continua fora dele', () => {
    const editaveis = new Set(CAMPOS.map((c) => c.chave as string))
    for (const fora of [
      'ttl_metadados_seg',
      'ttl_conteudo_seg',
      'limite_requisicoes_por_minuto',
      'regra2_limite_tickets',
    ]) {
      expect(editaveis.has(fora), `${fora} voltou à tela sem passar por D-25`).toBe(false)
    }
  })

  it('o que saiu do console em D-60 continua fora, e a chave continua existindo', () => {
    const editaveis = new Set(CAMPOS.map((c) => c.chave as string))
    for (const fora of ['regra2_exemplos_ajuste_operacional', 'teto_custo_conversa_usd']) {
      expect(editaveis.has(fora), `${fora} voltou à tela sem passar por D-60`).toBe(false)
      // A chave NÃO saiu da configuração: reabrir é preencher, não reescrever código —
      // e no caso do teto, a trava de `orquestrador.ts` depende dela continuar lá.
      expect(Object.keys(CONFIG_PADRAO)).toContain(fora)
    }
  })

  it('a seção de custo sobrevive sem campo, porque é a casa de dois painéis (D-49)', () => {
    const custo = SECOES.find((s) => s.id === 'custo')
    expect(custo, 'a seção custo sumiu — ia/telemetriaAtlassian ficariam sem casa').toBeDefined()
    expect(custo?.campos).toHaveLength(0)
    // Sem campo, ela deixou de ser lugar de decidir: anunciá-la em "configurar"
    // prometeria um ajuste que não está lá.
    expect(custo?.grupo).toBe('acompanhar')
  })
})

describe('a porcentagem da tela e a fração do banco são a mesma coisa', () => {
  it('0,75 aparece como 75 e volta como 0,75', () => {
    expect(paraRascunho(0.75, 'porcentagem')).toBe('75')
    expect(doRascunho('75', 'porcentagem')).toBe(0.75)
    // Sem o arredondamento, 70/100 devolveria 0.7000000000000001 à tela.
    expect(doRascunho('70', 'porcentagem')).toBe(0.7)
  })

  // O caso do tipo `linhas` SAIU com o campo (D-60): era o único descritor que o
  // usava, e teste sobre caminho que nenhuma tela alcança afirma o que ninguém
  // pode quebrar. Devolver o campo é devolver o tipo, o `textarea` e este caso.
})

describe('RNF-18 — um painel que falha não derruba o console', () => {
  it('a falha é dita, e não fica em "carregando" para sempre', () => {
    const html = renderToStaticMarkup(
      createElement(Quando<string>, {
        carga: { estado: 'falhou' },
        carregando: 'Carregando…',
        children: (d: string) => createElement('p', null, d),
      }),
    )
    expect(html).not.toContain('Carregando')
    expect(html).toMatch(/continua funcionando/i)
  })
})
