/**
 * **`T-651`** — a visualização rápida, e as frases da leitura do anexo.
 *
 * A suíte roda em `environment: 'node'`: não há clique nem `<dialog>`. O que dá para travar é a
 * **decisão** — como exibir cada tipo, e qual frase cada estado produz. Mesmo desenho de
 * `ROTULOS_ENVIO` e `LinhaDePessoa`: extrair a regra da renderização é o que a torna testável.
 *
 * _Requirements: FR-5, FR-5b, FR-7, FR-11, FR-12, ScC-6_
 */

import { describe, expect, it } from 'vitest'
import { AVISO_NAO_EXIBIVEL, formaDeExibir } from '@/app/visualizador'
import { fraseDaLeitura } from '@/app/telas'

describe('como cada tipo é exibido (T-651)', () => {
  it('imagem, PDF e texto são exibidos aqui', () => {
    expect(formaDeExibir('image/png')).toBe('imagem')
    expect(formaDeExibir('image/webp')).toBe('imagem')
    expect(formaDeExibir('application/pdf')).toBe('pdf')
    // A transcrição de `D-54` é o anexo que TODO chamado tem.
    expect(formaDeExibir('text/markdown')).toBe('texto')
    expect(formaDeExibir('text/plain; charset=utf-8')).toBe('texto')
  })

  it('🚨 SVG NÃO é exibido — XML com script no nosso domínio (D-11)', () => {
    expect(formaDeExibir('image/svg+xml')).toBe('baixar')
  })

  it('🚨 HTML também não — markdown vira texto cru, nunca HTML renderizado (D-62)', () => {
    expect(formaDeExibir('text/html')).toBe('baixar')
  })

  it('o que não se exibe tem FRASE e caminho, nunca janela vazia (FR-12, ScC-6)', () => {
    expect(formaDeExibir('application/zip')).toBe('baixar')
    expect(formaDeExibir(null)).toBe('baixar')
    expect(AVISO_NAO_EXIBIVEL).toMatch(/baixe/i)
  })
})

describe('as frases da leitura do anexo (FR-5, FR-7)', () => {
  it('`pronta` mostra a DESCRIÇÃO, não uma frase nossa', () => {
    expect(fraseDaLeitura('pronta', 'a tela mostra o erro PIPELINE_TIMEOUT')).toBe(
      'a tela mostra o erro PIPELINE_TIMEOUT',
    )
  })

  it('🚨 os três "não li" são frases DIFERENTES — pedem ações diferentes', () => {
    const naoSei = fraseDaLeitura('tipo_nao_suportado', null)
    const semNada = fraseDaLeitura('sem_conteudo', null)
    const caiu = fraseDaLeitura('falhou', null)
    expect(new Set([naoSei, semNada, caiu]).size).toBe(3)
    // E as três dizem que o arquivo **está** no chamado: senão a pessoa reenvia o print.
    for (const frase of [naoSei, semNada, caiu]) {
      expect(frase, frase).toMatch(/anexado ao chamado/i)
    }
  })

  it('`analisando` diz que está lendo, no presente', () => {
    expect(fraseDaLeitura('analisando', null)).toMatch(/lendo/i)
  })

  it('`pronta` sem descrição não afirma ter lido', () => {
    // "Li o arquivo" sem dizer o que é pior que não dizer nada.
    expect(fraseDaLeitura('pronta', null)).not.toMatch(/li /i)
  })

  it('nenhuma frase é vazia', () => {
    for (const estado of ['pronta', 'analisando', 'tipo_nao_suportado', 'sem_conteudo', 'falhou']) {
      expect(fraseDaLeitura(estado, null).trim().length, estado).toBeGreaterThan(0)
    }
  })
})
