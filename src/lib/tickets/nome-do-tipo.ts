/**
 * O nome do assunto que a pessoa está prestes a abrir — `RF-18`, `D-53`.
 *
 * ## Por que isto não é cosmético
 *
 * `RF-18` lista o que o resumo tem de mostrar: *título, descrição, **tipo**, componente,
 * área, prioridade e SLA*. O cartão mostrava tudo menos o tipo — e o tipo é o que decide
 * **qual fila** recebe o chamado. Confirmar sem ver isso é confirmar o roteamento no
 * escuro; e o roteamento é o que a Regra 1 e a allowlist de `RF-28` existem para acertar.
 *
 * ⚠️ **O id não serve.** `tipoChamadoId` é `"68"`, `"70"`, `"134"` — número interno do
 * Jira, que não diz nada a quem lê e que `RNF-30` mantém fora da tela. Quem informa é o
 * **nome** do request type, o mesmo texto que aparece no formulário sem IA.
 *
 * ## Ausência é ausência
 *
 * Tipo que não está na lista devolve `null`, e a tela diz que o assunto não foi
 * identificado. ⚠️ Não se inventa um nome a partir do id nem se mostra o id "só para ter
 * alguma coisa ali": quem lê `68` conclui coisa nenhuma, e um rótulo inventado é pior —
 * ele parece informação. É o mesmo raciocínio de `D-52` para a área.
 *
 * A lista chega de quem já a tem — a rota que monta a resposta —, e por isso este módulo
 * é puro: nenhuma ida de rede nasce aqui.
 *
 * _Requirements: RF-18, RF-28, RNF-30_
 */

/** O mínimo que se precisa de um tipo para nomeá-lo. */
export interface TipoNomeavel {
  readonly id: string
  readonly nome: string
}

export function nomeDoTipo(
  tipoChamadoId: string,
  tipos: readonly TipoNomeavel[],
): string | null {
  const achado = tipos.find((t) => t.id === tipoChamadoId)
  const nome = (achado?.nome ?? '').trim()
  return nome.length > 0 ? nome : null
}
