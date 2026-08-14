/**
 * O merge de três pontas, na tela — `RN-13`, `FR-8`/`FR-9`/`FR-10`.
 *
 * ## As duas metades erradas
 *
 * - **Adotar a proposta nova inteira** apaga o que a pessoa digitou e a prioridade que ela
 *   corrigiu à mão (`SC-7`).
 * - **Preservar tudo** faz o ajuste que ela pediu não aparecer (`FR-8`) — que é o defeito
 *   medido: argumentar não mudava nada na tela.
 *
 * O critério é por campo, e quem o produz é o servidor (`alterados`, em
 * `tickets/diff-de-proposta.ts`): campo que a IA mudou vale o dela; campo que ela não tocou
 * continua como a pessoa deixou.
 *
 * ## Por que é função pura, e não um `useEffect`
 *
 * A suíte roda em `environment: 'node'` e não clica em nada. Uma sequência de `setState` dentro
 * do componente funcionaria hoje e ficaria sem asserção — o padrão que `D-46` proíbe pelo mesmo
 * motivo ("recomeçar é remontar, nunca uma sequência de `setState`"). Aqui a regra é testável
 * sozinha, e o componente só a aplica.
 *
 * ⚠️ **E não é `key={revisao}` no cartão.** Remontar zeraria exatamente o que `FR-9` preserva
 * (valores digitados, prioridade corrigida, declaração de anexo) e refaria a leitura de schema a
 * cada turno (`R-02`). Por isso o estado **sobe** para a tela da conversa e passa por aqui.
 *
 * _Requirements: RN-13, RF-69, FR-8, FR-9, FR-10, FR-16_
 */

import type { Prioridade } from './api'

export interface EstadoNaTela {
  readonly prioridade: Prioridade
  readonly valoresCampos: Readonly<Record<string, string>>
}

export interface EntradaDoMerge {
  readonly naTela: EstadoNaTela
  /** A prioridade da proposta que acabou de voltar do servidor. */
  readonly prioridadeDaProposta: Prioridade
  /** O que a IA sugeriu para os campos do formulário, por `fieldId`. */
  readonly camposSugeridos: Readonly<Record<string, string>>
  /** O que a IA mudou, produzido pelo servidor. */
  readonly alterados: readonly string[]
  /** `FR-10` — o assunto mudou neste turno. */
  readonly assuntoMudou: boolean
}

const PREFIXO_CAMPO = 'campo:'

/**
 * Devolve o estado novo da tela. **Não** muda o que recebeu.
 *
 * ⚠️ `assuntoMudou` é avaliado **antes** de qualquer campo: mudou o assunto, mudou o formulário,
 * e os valores do anterior não têm onde morar (`FR-10`). E o formulário novo começa **vazio**
 * mesmo que a IA tenha sugerido campo no mesmo turno (`FR-16`) — os campos possíveis dependem do
 * assunto, e o assunto acabou de ser escolhido; preencher os dois de uma vez exigiria decidir o
 * assunto antes de saber quais campos existem.
 *
 * ⚠️ A **prioridade não é descartada** junto: ela não pertence ao formulário do assunto, e zerá-la
 * jogaria fora a correção da pessoa por um motivo que não tem nada a ver com ela.
 */
export function mesclarNaTela(entrada: EntradaDoMerge): EstadoNaTela {
  const { naTela, prioridadeDaProposta, camposSugeridos, alterados, assuntoMudou } = entrada

  const prioridade = alterados.includes('prioridade') ? prioridadeDaProposta : naTela.prioridade

  if (assuntoMudou) return { prioridade, valoresCampos: {} }

  const valoresCampos: Record<string, string> = { ...naTela.valoresCampos }
  for (const campo of alterados) {
    if (!campo.startsWith(PREFIXO_CAMPO)) continue
    const fieldId = campo.slice(PREFIXO_CAMPO.length)
    const sugerido = camposSugeridos[fieldId]
    // Campo marcado como alterado sem valor sugerido significa que a IA **deixou de** sugerir
    // algo que ela sugeria antes. Apagar o que está na tela seria destruir o valor da pessoa
    // por omissão do modelo — `FR-9` protege o que ninguém pediu para mudar.
    if (typeof sugerido === 'string') valoresCampos[fieldId] = sugerido
  }
  return { prioridade, valoresCampos }
}

/**
 * O cartão aparece agora? — `FR-7`.
 *
 * Durante o turno ele **sai da tela**: enquanto a IA reescreve o chamado, o que está ali é o
 * chamado de antes, e deixá-lo visível convida a pessoa a conferir e confirmar um resumo que
 * está prestes a mudar sozinho. Sumir é a forma honesta de dizer "isto está sendo refeito".
 *
 * ⚠️ Com bloqueio pendente ele também não existe (`RN-07`, `D-21`): ali o único caminho é o
 * botão de override, e a proposta só nasce depois dele.
 *
 * Predicado exportado, no estilo de `deveMostrarAtalhoDoFim` (`D-69`): a suíte roda em
 * `environment: 'node'` e renderiza sem clicar, então afirmar sobre a condição é mais barato
 * que sobre a marcação — e não reprova em melhoria de tela (`D-49`).
 */
export function deveMostrarCartao(estado: {
  readonly temProposta: boolean
  readonly enviando: boolean
  readonly bloqueado: boolean
}): boolean {
  return estado.temProposta && !estado.enviando && !estado.bloqueado
}

/**
 * O aviso de que conversar pode reescrever o cartão aparece agora? — `FR-18`, `FR-19`, `FR-21`.
 *
 * ⚠️ **"Uma vez por conversa" é disparado pela EXIBIÇÃO, nunca pela escolha.** Contar a
 * escolha faria o aviso voltar para quem fechou no `Esc` — e `Esc` é justamente a saída sem
 * efeito (`SC-20`). Quem já o viu não precisa vê-lo de novo, tenha respondido o que for.
 *
 * ⚠️ E ele **não existe** sem proposta nem com bloqueio pendente: nos dois casos não há
 * cartão para reescrever, e o aviso seria a parede que `RF-13` proíbe.
 */
export function deveAvisarNegociacao(estado: {
  readonly temProposta: boolean
  readonly bloqueioPendente: boolean
  readonly jaExibido: boolean
}): boolean {
  return estado.temProposta && !estado.bloqueioPendente && !estado.jaExibido
}
