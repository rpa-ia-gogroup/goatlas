/**
 * O motivo da prioridade é exibível? — `RF-68`, `FR-3`/`FR-4`/`FR-5` da spec 008.
 *
 * ## Por que existe uma validação de servidor para um texto que nós mesmos pedimos
 *
 * O motivo sai da **mesma** operação que escolheu o nível (é isso que impede a contradição
 * medida em 13/08/2026: prosa dizendo Crítica/4h com o cartão em Alta/12h). Mas ele continua
 * sendo **texto gerado**: pode vir com três frases, em inglês, ou com `customfield_10071`
 * dentro. Chegar tipado não o torna confiável — a mesma razão pela qual `RF-08`/`RF-17` moram
 * em código e não no prompt (Princípio X).
 *
 * O que este módulo recusa cai em `FR-5`: nível e prazo aparecem, o botão continua vivo, e a
 * tela **declara** que a sugestão não veio justificada. É o precedente de `D-53` — sem nome do
 * tipo, a tela diz; rótulo inventado parece informação. Ausência declarada autoriza a pessoa a
 * desconfiar da sugestão; ausência disfarçada não.
 *
 * ## 🚨 O detector de idioma é CONSERVADOR e de mão única
 *
 * Ele recusa **inglês declarado** e nunca tenta provar que o texto é português. A razão é
 * medível: *"o PC desliga sozinho"* não tem um único acento, e é a forma do relato mais comum
 * do app. Um detector que exigisse acentuação — ou palavra-função em PT — reprovaria justamente
 * o caso normal, e o sintoma seria a tela dizendo "sem justificativa" em quase todo cartão,
 * com a suíte verde. Falso positivo aqui não é um erro que alguém percebe: é a feature
 * desligando sozinha.
 *
 * Por isso o critério é **duas ou mais** palavras-função inglesas com fronteira de palavra:
 * uma só não condena, porque "deploy", "report" e "Sales Report" são vocabulário do dia a dia
 * daqui.
 *
 * _Requirements: RF-68, RF-16, RNF-18, RNF-30_
 */

/** `FR-3` — o teto, e o número que o teste afirma para ninguém "arredondar" para três. */
export const MAX_FRASES_MOTIVO = 2

/**
 * Teto de caracteres. Duas frases podem ser absurdamente longas, e o cartão tem largura —
 * o motivo é uma linha ao lado do seletor, não um parágrafo.
 */
const MAX_CARACTERES_MOTIVO = 320

export type RazaoMotivoRecusado =
  | 'ausente'
  | 'acima_do_teto'
  | 'identificador_interno'
  | 'idioma'

export type MotivoAvaliado =
  | { readonly exibivel: true; readonly motivo: string }
  | { readonly exibivel: false; readonly razao: RazaoMotivoRecusado }

/**
 * Identificador interno que não pode chegar à tela (`RNF-30`).
 *
 * ⚠️ São **formas**, nunca "qualquer número": o relato da pessoa está cheio de número legítimo
 * (pedido, quantidade, código de erro), e recusar por dígito jogaria o caso comum em `FR-5`.
 */
const IDENTIFICADOR_INTERNO = [
  /\bcustomfield[_\s]?\d+/i,
  /\brequest[\s_-]?type\b/i,
  /\bissue[\s_-]?type\b/i,
  /\bservice[\s_-]?desk[\s_-]?id\b/i,
  /\bfield[iI]d\b/i,
  // Chave de configuração deste app: `regra1_threshold_score`, `teto_custo_conversa_usd`…
  /\b[a-z]+\d?(?:_[a-z]+){2,}\b/,
]

/**
 * Palavras-função do inglês. **Duas** bastam para condenar; uma, não.
 *
 * ⚠️ A lista é de palavras que praticamente não aparecem em português técnico brasileiro —
 * `the`, `is`, `and`… Nada de substantivo ("report", "deploy", "pipeline"), que é exatamente
 * o vocabulário que o time usa em português.
 */
const FUNCAO_INGLES =
  /\b(the|is|are|was|were|and|or|not|cannot|can't|doesn't|isn't|with|without|from|for|this|that|there|when|because|they|user|users|has|have|been)\b/gi

function contarFrases(texto: string): number {
  // Divide por terminador seguido de espaço + maiúscula/número, ou fim de texto. É o que
  // impede "3.000 pedidos" de virar duas frases — ali o ponto é interno ao número.
  const partes = texto
    .split(/(?<=[.!?])\s+(?=[A-ZÀ-Ý])/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
  return Math.max(partes.length, 1)
}

/**
 * Avalia o motivo como ele chegou do modelo.
 *
 * ⚠️ **Recusa, nunca coage.** Não trunca em duas frases nem apaga o `customfield_…` do meio:
 * texto remendado esconde de quem chamou que o modelo mandou a coisa errada, e o resultado
 * seria uma frase pela metade ao lado da prioridade. Mesma disciplina de `config/validar.ts`
 * (`"0.9"` não vira `0.9`).
 */
export function motivoExibivel(bruto: string | null | undefined): MotivoAvaliado {
  const motivo = typeof bruto === 'string' ? bruto.trim() : ''
  if (motivo.length === 0) return { exibivel: false, razao: 'ausente' }
  if (motivo.length > MAX_CARACTERES_MOTIVO) return { exibivel: false, razao: 'acima_do_teto' }
  if (contarFrases(motivo) > MAX_FRASES_MOTIVO) {
    return { exibivel: false, razao: 'acima_do_teto' }
  }
  if (IDENTIFICADOR_INTERNO.some((r) => r.test(motivo))) {
    return { exibivel: false, razao: 'identificador_interno' }
  }
  const funcao = motivo.match(FUNCAO_INGLES)
  if (funcao && funcao.length >= 2) return { exibivel: false, razao: 'idioma' }
  return { exibivel: true, motivo }
}

/**
 * A frase de `FR-5`, para a tela não a reinventar em cada superfície.
 *
 * ⚠️ Ela diz o que aconteceu (*a sugestão não veio justificada*) e **não** pede nada da pessoa:
 * não é culpa dela, e não há ação a tomar além de conferir o nível — que ela já podia editar.
 */
export const SEM_MOTIVO_DE_PRIORIDADE =
  'Esta sugestão não veio justificada — confira se o nível bate com o seu caso.'
