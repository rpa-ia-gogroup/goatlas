/**
 * **`D-59`** — o agente pedia anexo onde não havia onde anexar.
 *
 * ## O defeito, relatado por alguém usando o app de verdade
 *
 * *"o bot pediu um anexo pra ver o que tava rolando sendo que não tinha um campo pra
 * inserir anexo"*. A pessoa estava certa. Duas causas somadas:
 *
 * 1. **O controle vivia só no cartão de confirmação**, que existe depois das duas
 *    verificações e da proposta montada. Durante a conversa não havia clipe nenhum.
 * 2. **Em 4 dos 15 tipos do `GN`** (93, 108, 143, 144) o cartão condiciona a pergunta a
 *    `aceitaAnexo` e o controle **nunca** aparecia. ⚠️ E `aceitaAnexo` mede se o
 *    **formulário do request type** expõe campo de anexo — **não** se o chamado aceita
 *    arquivo: o `GN-6903` é do tipo 144 e tem a transcrição de `D-54` anexada. O app era
 *    mais restritivo que a Atlassian.
 *
 * ## O que estes testes travam
 *
 * O prompt **não pode voltar a pedir arquivo**. É a metade que nenhum teste de tela
 * alcança, e é a que causou o relato: instrução que promete o que a tela não oferece.
 *
 * _Requirements: RF-61, RF-62, RF-63, RN-11, RNF-30_
 */

import { describe, expect, it } from 'vitest'
import { montarPromptAgente } from '@/lib/ia/prompts'

const CTX = {
  buscaDocumentacaoDisponivel: true,
  historicoDisponivel: true,
}

const prompt = () => montarPromptAgente(CTX as never)

describe('o agente não pede arquivo (D-59)', () => {
  it('🚨 não manda pedir print, captura, anexo nem arquivo', () => {
    const p = prompt().toLowerCase()
    // A frase antiga era "Peça o que for específico do caso: print da tela, …".
    expect(p).not.toContain('peça o que for específico do caso: print')
    expect(p).toContain('nunca peça print')
  })

  it('continua pedindo o que é específico — em TEXTO', () => {
    // O pedido de evidência não sumiu: mudou de mídia. Sem isto, "não peça arquivo"
    // viraria "não peça nada", e o chamado voltaria a chegar sem detalhe nenhum.
    const p = prompt().toLowerCase()
    expect(p).toContain('mensagem de erro copiada')
    expect(p).toContain('número do pedido')
  })

  it('diz ao agente que a tela oferece o anexo sozinha', () => {
    // Sem esta frase o modelo tende a se desculpar ("não consigo receber arquivos"),
    // que é o erro oposto e igualmente falso.
    const p = prompt().toLowerCase()
    expect(p).toContain('clipe')
  })

  it('mantém a saída honesta para quem não tem material', () => {
    expect(prompt().toLowerCase()).toContain('o chamado abre sem anexo')
  })
})
