/**
 * Credencial que vai dentro de um cabeçalho HTTP: aparada nas pontas, verificada no resto.
 *
 * ## Por que isto não é higiene opcional (`D-50`)
 *
 * Os secrets deste app são colados à mão no console do GoDeploy. Um `\n` no fim é **invisível**
 * em qualquer inspeção — e basta para o runtime recusar o cabeçalho, com o `fetch` lançando
 * `TypeError` **antes de abrir conexão**. A assinatura é a **mesma** do `fetch` guardado sem
 * `bind`, o outro defeito de `D-50`, e é por isso que as duas causas precisam ser separadas por
 * construção: sem isso, o diagnóstico anda em círculo.
 *
 * Aparar as pontas é fronteira, não adivinhação — token nenhum tem espaço em branco na borda de
 * propósito. ⚠️ O que **não** dá para consertar (controle no meio, caractere fora do ASCII
 * imprimível) é **recusado com nome próprio**, antes de qualquer ida de rede: coagir ali seria
 * inventar uma credencial.
 *
 * ## Um lugar só, e o motivo
 *
 * 🚨 Isto nasceu dentro de `teamguide/http.ts` e foi **extraído** quando o segundo cliente
 * (`ocr/http.ts`, a quinta credencial) precisou da mesma coisa. Copiar era o caminho curto e o
 * errado: duas implementações de saneamento divergem na primeira correção, e a que não foi
 * corrigida falha **em silêncio** — com a credencial certa e o host no ar. É a mesma razão
 * pela qual os secrets são lidos em um lugar só (`RNF-01`, `contexto.ts`).
 *
 * ⚠️ **Nunca o valor, nem pedaço dele, nem o tamanho** sai daqui em rótulo (`RNF-01`,
 * `RNF-30`). O que sai é `'vazia'`, `'caractere_de_controle'` ou `'caractere_nao_ascii'`.
 *
 * _Requirements: RNF-01, RNF-30_
 */

export interface CredencialDeCabecalho {
  /** O valor pronto para o cabeçalho. */
  readonly valor: string
  /**
   * As pontas foram aparadas?
   *
   * ⚠️ **É denunciado inclusive no sucesso** (`ok · credencial_saneada`): pista que só aparece
   * na falha some justamente quando o problema passa a funcionar, e aí ninguém descobre que a
   * credencial gravada está torta.
   */
  readonly saneada: boolean
  /** Rótulo do que impede o valor de ir num cabeçalho, ou `null` se ele está pronto. */
  readonly invalida: string | null
}

export function prepararCredencialDeCabecalho(bruto: string): CredencialDeCabecalho {
  const cru = bruto ?? ''
  const valor = cru.trim()
  return { valor, saneada: valor !== cru, invalida: problemaEmCabecalho(valor) }
}

function problemaEmCabecalho(valor: string): string | null {
  if (!valor) return 'vazia'
  for (const caractere of valor) {
    const ponto = caractere.codePointAt(0)!
    if (ponto < 0x20 || ponto === 0x7f) return 'caractere_de_controle'
    if (ponto > 0x7e) return 'caractere_nao_ascii'
  }
  return null
}
