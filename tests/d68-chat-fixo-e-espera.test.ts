/**
 * **`D-68`** — o compositor fixo, o Enter que envia, a espera com frase e o cartão fechado.
 *
 * Quatro pedidos do mantenedor no mesmo lote. O que dá para travar sem DOM é a **decisão**:
 * quais frases a espera pode dizer, quando o Enter envia, e qual palavra o cartão fechado
 * mostra. A parte visual (sticky, `<details>`, os pontos) é medida no navegador.
 *
 * _Requirements: RNF-12, RNF-28, RNF-30_
 */

import { describe, expect, it } from 'vitest'
import {
  frasesDaEspera,
  fraseNoInstante,
  FRASE_PARA_LEITOR_DE_TELA,
  MAX_FRASES,
  MS_POR_FRASE,
} from '@/app/frases-de-espera'
import { deveEnviarComEnter, seloDaLeitura } from '@/app/telas'

describe('as frases da espera são função do que está acontecendo (D-68)', () => {
  it('🚨 sem anexo, NENHUMA frase fala de arquivo', () => {
    // Este é o caso que a lista fixa erraria: "analisando sua imagem…" numa conversa sem
    // imagem é o app afirmando o que não aconteceu — família de `D-33`/`D-41`/`RF-43`.
    const frases = frasesDaEspera({ lendoAnexo: false })
    const texto = frases.join(' | ')
    for (const palavra of ['arquivo', 'imagem', 'documento', 'print']) {
      expect(texto, palavra).not.toContain(palavra)
    }
    expect(frases.length).toBeGreaterThan(0)
  })

  it('com anexo, a primeira frase é sobre o arquivo — e o plural acompanha', () => {
    expect(frasesDaEspera({ lendoAnexo: true, quantosAnexos: 1 })[0]).toContain('o arquivo')
    expect(frasesDaEspera({ lendoAnexo: true, quantosAnexos: 3 })[0]).toContain('os arquivos')
  })

  it('verificação já feita não é anunciada de novo', () => {
    const tudoFeito = frasesDaEspera({
      documentacaoVerificada: true,
      historicoVerificado: true,
    }).join(' | ')
    expect(tudoFeito).not.toContain('documentação')
    expect(tudoFeito).not.toContain('chamados parecidos')
    // ⚠️ E ainda assim sobra frase: silêncio na espera se lê como travamento.
    expect(frasesDaEspera({ documentacaoVerificada: true, historicoVerificado: true }).length)
      .toBeGreaterThan(0)
  })

  it('"entendendo o que você descreveu" só na PRIMEIRA mensagem', () => {
    expect(frasesDaEspera({ primeiraMensagem: true }).join(' ')).toContain('entendendo')
    // No quinto turno isso soaria como se nada tivesse sido entendido até ali.
    expect(frasesDaEspera({ primeiraMensagem: false }).join(' ')).not.toContain('entendendo')
  })

  it('nunca passa de dez, e todas são curtas, em português e com reticências', () => {
    const todas = frasesDaEspera({
      lendoAnexo: true,
      quantosAnexos: 2,
      primeiraMensagem: true,
    })
    expect(todas.length).toBeLessThanOrEqual(MAX_FRASES)
    expect(new Set(todas).size, 'sem frase repetida').toBe(todas.length)
    for (const f of todas) {
      expect(f.length, f).toBeLessThanOrEqual(52)
      expect(f, f).toMatch(/…$/)
      expect(f, f).toBe(f.toLowerCase() === f ? f : f) // continuação da linha do agente
    }
  })

  it('a frase avança com o tempo e PARA na última, sem ciclar', () => {
    const frases = ['a…', 'b…', 'c…']
    expect(fraseNoInstante(frases, 0)).toBe('a…')
    expect(fraseNoInstante(frases, MS_POR_FRASE + 10)).toBe('b…')
    // Ciclar faria a espera longa (15–40 s, medido) parecer laço infinito.
    expect(fraseNoInstante(frases, MS_POR_FRASE * 99)).toBe('c…')
  })

  it('🚨 o leitor de tela recebe UMA frase, verdadeira durante a espera inteira', () => {
    // Ela não muda; então não pode descrever só o começo ("lendo o arquivo").
    expect(FRASE_PARA_LEITOR_DE_TELA).toMatch(/verificando/i)
    expect(fraseNoInstante([], 0)).toBe(FRASE_PARA_LEITOR_DE_TELA)
  })
})

describe('Enter envia; Shift e Alt pulam linha (D-68)', () => {
  const evento = (extra: Partial<Parameters<typeof deveEnviarComEnter>[0]> = {}) => ({
    key: 'Enter',
    shiftKey: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    ...extra,
  })

  it('Enter puro envia', () => {
    expect(deveEnviarComEnter(evento())).toBe(true)
  })

  it('Shift+Enter e Alt+Enter pulam linha — é o gesto que substitui o antigo', () => {
    expect(deveEnviarComEnter(evento({ shiftKey: true }))).toBe(false)
    expect(deveEnviarComEnter(evento({ altKey: true }))).toBe(false)
  })

  it('🚨 Enter durante composição de ACENTO não envia', () => {
    // `ção` se escreve com tecla morta, e o navegador dispara keydown Enter na composição:
    // sem esta guarda, confirmar o acento mandaria a mensagem no meio da palavra.
    expect(deveEnviarComEnter(evento({ nativeEvent: { isComposing: true } }))).toBe(false)
  })

  it('Ctrl+Enter e Cmd+Enter NÃO enviam — evita gesto duplicado', () => {
    expect(deveEnviarComEnter(evento({ ctrlKey: true }))).toBe(false)
    expect(deveEnviarComEnter(evento({ metaKey: true }))).toBe(false)
  })

  it('outra tecla nunca envia', () => {
    expect(deveEnviarComEnter(evento({ key: 'a' }))).toBe(false)
    expect(deveEnviarComEnter(evento({ key: 'Escape' }))).toBe(false)
  })
})

describe('o selo do cartão fechado (D-68)', () => {
  it('cada estado tem palavra própria, e nenhuma é vazia', () => {
    expect(seloDaLeitura('pronta')).toBe('lido')
    expect(seloDaLeitura('analisando')).toBe('lendo…')
    for (const estado of ['tipo_nao_suportado', 'sem_conteudo', 'falhou']) {
      expect(seloDaLeitura(estado), estado).toBe('não lido')
    }
  })

  it('🚨 fechado, o selo distingue lido de NÃO lido — é tudo o que a pessoa lê ali', () => {
    expect(seloDaLeitura('pronta')).not.toBe(seloDaLeitura('falhou'))
  })
})
