/**
 * A tela declarando que um campo mudou — spec 009, `FR-8`.
 *
 * ## Por que só campo de ESCOLHA, e não cada tecla
 *
 * O que se investiga num formulário é **decisão**, não digitação. Trocar o assunto do
 * chamado e rebaixar a prioridade são escolhas discretas, cada uma vale uma linha, e são
 * exatamente as duas que decidem para qual fila o chamado vai e com que prazo ele é cobrado.
 *
 * Registrar tecla a tecla custaria uma requisição por rajada de digitação — o custo que
 * `RNF-11` e `R-02` existem para conter — e responderia a uma pergunta que ninguém faz. O
 * texto que a pessoa escreveu chega inteiro por outros dois caminhos, que já existem: o
 * evento `confirmacao` (o que a tela mandou) e o `payload_final` (o que saiu daqui para o
 * Jira).
 *
 * ⚠️ **Nunca lança, nunca bloqueia.** `api.investigadorFormulario` já engole a falha; esta
 * função existe para o chamador não precisar lembrar disso — o mesmo motivo de
 * `INVESTIGADOR_DESLIGADO` ser um objeto e não `null` do lado do servidor.
 */

import { api } from './api'

export function registrarMudancaDeCampo(dados: {
  /** Qual tela — `formulario` · `cartao`. É o que separa os dois caminhos de criação. */
  tela: string
  /** O rótulo que a pessoa lê, nunca o `fieldId` (`RNF-30`, `D-36`). */
  campo: string
  de: unknown
  para: unknown
  conversaId?: string | null
}): void {
  // Mudança que não mudou nada não é evento: um `select` reemitindo o mesmo valor encheria
  // a tabela de linhas idênticas e faria "trocou de assunto três vezes" virar ruído.
  if (dados.de === dados.para) return
  void api.investigadorFormulario({
    tela: dados.tela,
    campo: dados.campo,
    de: dados.de,
    para: dados.para,
    conversaId: dados.conversaId ?? null,
  })
}
