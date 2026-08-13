/**
 * **`D-69`** — a conversa só acompanha o fim quando a pessoa já está no fim.
 *
 * Relato: *"ao enviar mensagem, a tela dá uma subida (o scroll do chat), sendo que eu fico com
 * a visualização na borda inferior"*. Duas causas somadas — a rolagem era **incondicional** e
 * o **alvo** era um sentinela que mora antes do compositor `sticky` de `D-68`, o que parava a
 * página 270 px acima do fim real, com a mensagem nova escondida atrás do campo.
 *
 * O que dá para afirmar sem DOM é a **decisão**: quem conta como estando no fim, e quando o
 * atalho de volta aparece. A rolagem em si é medida no navegador.
 *
 * _Requirements: RNF-12, RNF-28_
 */

import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import {
  deveMostrarAtalhoDoFim,
  ehRolagemNossa,
  estaNoFim,
  JANELA_ROLAGEM_PROPRIA_MS,
  TOLERANCIA_FIM_PX,
} from '@/app/rolagem'
import { Compositor } from '@/app/telas'

const pagina = (deslocamento: number) => ({
  deslocamento,
  alturaVisivel: 800,
  alturaTotal: 3000,
})

describe('quem está no fim da página (D-69)', () => {
  it('no fim exato, está no fim', () => {
    expect(estaNoFim(pagina(2200))).toBe(true)
  })

  it('a poucos pixels do fim, ainda está no fim', () => {
    // ⚠️ Sem tolerância, rolagem suave que para 3 px antes desligaria o acompanhamento
    // sozinho — e a conversa pararia de seguir sem ninguém ter rolado nada.
    expect(estaNoFim(pagina(2200 - (TOLERANCIA_FIM_PX - 10)))).toBe(true)
  })

  it('lendo o histórico, NÃO está no fim', () => {
    expect(estaNoFim(pagina(1000))).toBe(false)
    expect(estaNoFim(pagina(2200 - (TOLERANCIA_FIM_PX + 10)))).toBe(false)
  })

  it('🚨 página que não rola conta como fim', () => {
    // Conversa recém-aberta: o atalho aceso apontaria para onde a pessoa já está.
    expect(estaNoFim({ deslocamento: 0, alturaVisivel: 800, alturaTotal: 500 })).toBe(true)
    expect(estaNoFim({ deslocamento: 0, alturaVisivel: 800, alturaTotal: 800 })).toBe(true)
  })
})

describe('a rolagem que é nossa não conta como gesto da pessoa (D-69)', () => {
  it('dentro da janela, o evento é nosso', () => {
    // 🚨 Quem rola até o fim passa por posições longe do fim no caminho — e o evento de cada
    // quadro chegaria como se a pessoa tivesse subido para ler o histórico.
    expect(ehRolagemNossa(1_000, 1_000 + JANELA_ROLAGEM_PROPRIA_MS)).toBe(true)
    expect(ehRolagemNossa(1_500, 1_000 + JANELA_ROLAGEM_PROPRIA_MS)).toBe(true)
  })

  it('depois da janela, o evento é da pessoa', () => {
    expect(ehRolagemNossa(2_000, 1_000 + JANELA_ROLAGEM_PROPRIA_MS)).toBe(false)
    // Sem nenhuma rolagem nossa registrada, todo evento é da pessoa.
    expect(ehRolagemNossa(1, 0)).toBe(false)
  })
})

describe('o atalho de voltar ao fim (D-69)', () => {
  it('aparece só quando as DUAS condições valem', () => {
    expect(deveMostrarAtalhoDoFim({ longeDoFim: true, novidade: true })).toBe(true)
  })

  it('lendo o histórico numa conversa parada, não aparece', () => {
    // Botão que não resolve nada, competindo com o campo de mensagem pelo espaço fixo.
    expect(deveMostrarAtalhoDoFim({ longeDoFim: true, novidade: false })).toBe(false)
  })

  it('no fim, não aparece — a novidade já está à vista', () => {
    expect(deveMostrarAtalhoDoFim({ longeDoFim: false, novidade: true })).toBe(false)
    expect(deveMostrarAtalhoDoFim({ longeDoFim: false, novidade: false })).toBe(false)
  })
})

describe('o compositor desenha o atalho quando há para onde ir (D-69)', () => {
  const base = {
    valor: 'o relatório não atualizou',
    aoMudar: () => {},
    aoEnviar: () => {},
    enviando: false,
    justificando: false,
  }

  it('com atalho, o botão existe e diz em português para onde leva', () => {
    const saida = renderToStaticMarkup(
      createElement(Compositor, { ...base, atalhoDoFim: () => {} }),
    )
    expect(saida).toContain('Ir para a última mensagem')
    expect(saida).toContain('atalho-fim')
  })

  it('🚨 sem atalho, o botão NÃO existe — não é botão apagado', () => {
    // Apagado, ele continuaria ocupando altura no compositor fixo, que já é 32% da tela
    // (`D-68`).
    const saida = renderToStaticMarkup(createElement(Compositor, base))
    expect(saida).not.toContain('atalho-fim')
    expect(saida).not.toContain('Ir para a última mensagem')
  })
})
