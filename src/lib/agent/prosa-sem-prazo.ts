/**
 * A prosa do agente afirmou nível de prioridade ou horas de prazo? — `FR-6` da spec 008,
 * `RF-68`.
 *
 * ## Por que a prosa não pode falar disso
 *
 * A resposta que a pessoa lê e a proposta que ela vê no cartão saem de **duas chamadas
 * paralelas** (`D-32`, `orquestrador.ts#propostaEmVoo`): a prosa é escrita **antes** de a
 * extração voltar. Ou seja, o texto não tem como saber qual nível o cartão vai mostrar —
 * e, quando arrisca, produz o que foi medido em 13/08/2026: *"vou abrir como Crítica,
 * primeira resposta em 4h"* com o cartão logo abaixo em **Alta / 12h**. Duas verdades
 * diferentes na mesma tela, e a que vale é a de baixo, que a pessoa ainda pode editar
 * (`RF-16`).
 *
 * Serializar as duas chamadas resolveria — e é **Non-Goal** declarado no plano: seria uma
 * ida ao provedor a mais **em série** em todo turno, contra `RNF-12`.
 *
 * ## 🚨 Isto MEDE. Não trava, e não reescreve.
 *
 * `FR-6` é qualidade de produto, não gate de segurança — a mesma distinção que `D-27` faz
 * para `RF-62`. Quem escapa produz uma frase feia no **próprio** chamado: nenhuma
 * exposição (`RF-30`), nenhum chamado perdido (`RNF-17`). Por isso a saída daqui é um
 * **achado para a auditoria**, e o texto segue inteiro para a pessoa:
 *
 * - recortar a frase proibida mutila o parágrafo em volta (o texto vira um salto no meio
 *   de uma explicação), e
 * - o defeito volta na redação seguinte, porque o modelo continua achando que devia dizer.
 *
 * A escalada, se a medição mostrar vazamento recorrente, é recortar — **com dado**. Há
 * teste estrutural afirmando que este módulo não tem `.replace`/`.slice`: a promessa de não
 * reescrever é do código, não deste comentário.
 *
 * ## O detector é conservador, pelo mesmo motivo de `motivo-da-prioridade.ts`
 *
 * Falso positivo aqui não é um erro que alguém percebe: é uma linha de auditoria que não
 * corresponde a nada, e sinal que grita todo dia é sinal que ninguém lê (a lição de
 * `anexosIndisponiveis` em `D-56`). Daí as duas regras terem **contexto**, nunca a palavra
 * solta:
 *
 * - `alta` é adjetivo comum em português (*"a carga está alta"*), então só condena junto de
 *   `prioridade` ou de `como <nível>`;
 * - hora só condena com **forma de promessa** (*em 12h*, *dentro de 12 horas*) ou perto de
 *   uma palavra de prazo (*o SLA aqui é 4h*). *"o sistema caiu há 3 horas"* é o relato da
 *   pessoa sendo repetido de volta, e é exatamente o que o agente **deve** fazer.
 *
 * Custo aceito e declarado: *"não tive resposta há 2 horas"* pode cair na segunda regra. É
 * uma linha de auditoria a mais, sem efeito nenhum na tela.
 *
 * _Requirements: FR-6, ScC-2, RF-68, RN-08_
 */

/** O que a prosa afirmou. Vai à auditoria; a **frase** nunca vai (`RNF-30`, `RNF-01`). */
export type AchadoDeProsa = 'nivel' | 'horas'

/**
 * Os três níveis que este app escreve. `baixa` fica **fora** de propósito: `D-48` já diz
 * que `Low`/`Lowest` são lidas e nunca escritas, e incluí-la faria *"a fila está baixa"*
 * virar achado.
 */
const NIVEL = String.raw`cr[íi]tic[ao]|alta|normal`

/** `prioridade Alta` · `Prioridade: Normal` · `prioridade é crítica`. */
const NIVEL_APOS_PRIORIDADE = new RegExp(
  String.raw`\bprioridade\b\s*(?:[:\-–—]|\bé\b|\bcomo\b|\bem\b)?\s*(?:${NIVEL})\b`,
  'i',
)

/** `crítica prioridade` — a ordem inversa, que aparece em texto traduzido. */
const PRIORIDADE_APOS_NIVEL = new RegExp(String.raw`\b(?:${NIVEL})\s+prioridade\b`, 'i')

/**
 * `como Crítica` · `como nível alta`.
 *
 * ⚠️ Sem lista de verbos antes (`classifiquei`, `marquei`, `entra`, `abro`…): a lista fica
 * desatualizada na primeira redação nova e falha **em silêncio**, que é o modo de falha que
 * este arquivo inteiro existe para evitar. Em prosa sobre um chamado, `como <nível>` é
 * classificação — e o custo de errar é uma linha de auditoria.
 */
const COMO_NIVEL = new RegExp(String.raw`\bcomo\s+(?:n[íi]vel\s+)?(?:${NIVEL})\b`, 'i')

/** `12h` · `12 hs` · `4 horas` — o núcleo numérico das duas regras de hora. */
const HORAS = String.raw`\d{1,3}\s*(?:h|hs|horas?)\b`

/** Forma de promessa: `em 12h`, `até 4 horas`, `dentro de 12 horas`, `no prazo de 24h`. */
const PROMESSA_DE_HORAS = new RegExp(
  String.raw`\b(?:em|at[ée]|dentro\s+de|no\s+prazo\s+de)\s+(?:no\s+m[áa]ximo\s+)?${HORAS}`,
  'i',
)

/** Palavras que fazem a hora ser sobre atendimento, não sobre o relato da pessoa. */
const PALAVRA_DE_PRAZO = String.raw`prazo|resposta|respond\w*|retorn\w*|sla|atend\w*`

/**
 * Hora perto de palavra de prazo, nas duas ordens — `o SLA aqui é 4h`, `24 horas de prazo`.
 *
 * ⚠️ `[^.!?]` prende a vizinhança à **mesma frase**: sem isso, *"O prazo é curto. Ele caiu
 * há 3 horas"* viraria achado por duas frases que não se falam.
 */
const HORAS_PERTO_DE_PRAZO = [
  new RegExp(String.raw`\b(?:${PALAVRA_DE_PRAZO})\b[^.!?]{0,60}?${HORAS}`, 'i'),
  new RegExp(String.raw`${HORAS}[^.!?]{0,60}?\b(?:${PALAVRA_DE_PRAZO})\b`, 'i'),
]

/**
 * Lê a prosa e devolve o que ela afirmou. Lista vazia é o caso normal.
 *
 * A ordem é estável (`nivel` antes de `horas`) para a auditoria não gravar duas formas do
 * mesmo achado — quem agrupa por `detalhe` compararia strings diferentes para o mesmo fato.
 */
export function prosaAfirmaPrazo(texto: string): readonly AchadoDeProsa[] {
  const achados: AchadoDeProsa[] = []
  if (typeof texto !== 'string' || texto.trim().length === 0) return achados

  if (
    NIVEL_APOS_PRIORIDADE.test(texto) ||
    PRIORIDADE_APOS_NIVEL.test(texto) ||
    COMO_NIVEL.test(texto)
  ) {
    achados.push('nivel')
  }
  if (PROMESSA_DE_HORAS.test(texto) || HORAS_PERTO_DE_PRAZO.some((r) => r.test(texto))) {
    achados.push('horas')
  }
  return achados
}
