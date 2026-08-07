/**
 * O caminho de override na TELA — a metade de `RN-07` que o servidor não garante.
 *
 * A trava de servidor vive em `tests/orquestrador.test.ts`: bloqueio sem override
 * não deixa proposta nascer. Aqui está o que só a interface resolve, e que já falhou
 * uma vez com usuário de verdade:
 *
 * 1. **A justificativa não pode parecer o compositor.** Foi lida como "outro chat"
 *    no primeiro teste — duas caixas de texto idênticas na mesma tela não têm como
 *    comunicar que uma vai para o agente e a outra para a auditoria.
 * 2. **O compositor fecha enquanto a justificativa está aberta.** Com as duas
 *    disponíveis, a pessoa escreve na de baixo — maior, já usada, onde o dedo espera
 *    — e o override nunca acontece.
 * 3. **Fechado ≠ escondido.** Sumir com o campo faz a página saltar; o motivo tem de
 *    estar escrito.
 *
 * _Requirements: RF-13, RN-07, RNF-28_
 */

import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { CaminhoOverride, Compositor } from '@/app/telas'

const nada = () => {}

function html(no: ReturnType<typeof createElement>): string {
  return renderToStaticMarkup(no)
}

describe('RN-07 — a justificativa não se confunde com a conversa', () => {
  it('fechada, oferece só o botão: nenhum campo de texto competindo com o compositor', () => {
    const saida = html(
      createElement(CaminhoOverride, {
        aberto: false,
        aoAbrir: nada,
        aoFechar: nada,
        aoConfirmar: nada,
      }),
    )
    expect(saida).toContain('Isso não resolve meu caso')
    expect(saida).not.toContain('<textarea')
  })

  it('aberta, se apresenta como correção da recomendação — não como mensagem', () => {
    const saida = html(
      createElement(CaminhoOverride, {
        aberto: true,
        aoAbrir: nada,
        aoFechar: nada,
        aoConfirmar: nada,
      }),
    )
    // O sobretítulo e o rótulo são o que dizem "isto não é o chat" antes de a
    // pessoa começar a escrever. A classe própria é o que sustenta a espinha lime.
    expect(saida).toContain('justificativa')
    expect(saida).toContain('Corrigir a recomendação')
    expect(saida).toContain('Por que essas páginas não resolvem o seu caso?')
    expect(saida).toContain('não é uma mensagem para o agente')
  })

  it('o botão de seguir nasce desabilitado: override sem motivo não existe', () => {
    const saida = html(
      createElement(CaminhoOverride, {
        aberto: true,
        aoAbrir: nada,
        aoFechar: nada,
        aoConfirmar: nada,
      }),
    )
    expect(saida).toMatch(/Seguir com o chamado/)
    expect(saida).toContain('disabled')
  })
})

describe('RN-07 — o compositor fecha enquanto a justificativa está aberta', () => {
  it('justificando: campo e botão desabilitados, com o motivo escrito na tela', () => {
    const saida = html(
      createElement(Compositor, {
        valor: 'quero abrir assim mesmo',
        aoMudar: nada,
        aoEnviar: nada,
        enviando: false,
        justificando: true,
      }),
    )
    // Dois `disabled`: o textarea e o submit. Só o botão não bastaria — dava para
    // digitar e mandar com Enter, que é justamente o gesto de quem está no chat.
    expect(saida.match(/disabled/g) ?? []).toHaveLength(2)
    expect(saida).toContain('Termine a justificativa acima')
    // Fechado, não escondido: o campo continua na página.
    expect(saida).toContain('<textarea')
    expect(saida).toContain('aria-describedby="mensagem-pausada"')
  })

  it('sem justificativa aberta, o compositor volta a funcionar e não explica nada', () => {
    const saida = html(
      createElement(Compositor, {
        valor: 'o relatório não atualizou',
        aoMudar: nada,
        aoEnviar: nada,
        enviando: false,
        justificando: false,
      }),
    )
    expect(saida).not.toContain('disabled')
    expect(saida).not.toContain('Termine a justificativa acima')
    expect(saida).not.toContain('aria-describedby')
  })

  it('campo vazio continua desabilitando só o botão — o textarea segue aberto', () => {
    const saida = html(
      createElement(Compositor, {
        valor: '',
        aoMudar: nada,
        aoEnviar: nada,
        enviando: false,
        justificando: false,
      }),
    )
    expect(saida.match(/disabled/g) ?? []).toHaveLength(1)
  })
})
