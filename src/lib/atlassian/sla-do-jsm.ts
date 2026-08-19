/**
 * O SLA de **primeira resposta do JSM** — o que a Atlassian já mandava e o app jogava
 * fora (`D-48`).
 *
 * ## O que estava errado
 *
 * `obterChamado` pede `?expand=requestType,sla,status` desde a Fase 1 e devolvia
 * `slaPrimeiraResposta: null` **literal**. Ou seja: a resposta vinha, custava a mesma
 * requisição, e era descartada na última linha. `RF-29` e a metade de SLA do `RF-31` não
 * estavam por desenhar — estavam sem dado.
 *
 * ## 🚨 Este SLA NÃO é o nosso, e a distinção é a única coisa que importa aqui
 *
 * `notificacoes/sla.ts` calcula o **compromisso do atlas** (`RN-08`, `R-05`): primeira
 * resposta, hora corrida, e as 24h são **piso garantido**. O que este arquivo lê é o
 * relógio que o **JSM** mantém, com o calendário e as metas que o time de tech
 * configurou lá.
 *
 * Os dois podem discordar, e `D-20` já decidiu o que fazer quando isso acontece: **duas
 * fontes de verdade sobre o mesmo prazo é pior que uma**. Por isso este módulo se chama
 * `sla-do-jsm` e não `sla`, e por isso quem mostrar este valor na tela tem de dizer de
 * quem ele é. Nada aqui substitui, corrige ou "concilia" o nosso — conciliar seria
 * inventar uma terceira verdade.
 *
 * ## Por que o nome do SLA decide, e por que ele pode não decidir
 *
 * Um request type carrega vários SLAs ("tempo até a primeira resposta", "tempo até a
 * resolução", e o que mais o time criar). O único dado que os distingue na resposta é o
 * **nome**, que é configurado por instalação e depende do idioma do site.
 *
 * 🚨 Então: nome que não reconhecemos devolve **`null`**, nunca "o primeiro da lista".
 * Um chamado com um SLA só, que por acaso seja o de **resolução**, mostraria um prazo de
 * dias onde a pessoa lê "alguém te responde até". Prazo errado é pior que prazo ausente —
 * é o mesmo critério de `D-42` (*"palpite aqui é pior que ausência"*), agravado por a
 * pessoa planejar em cima dele.
 *
 * ⚠️ **Os nomes reais do site da Gocase não foram medidos.** A lista abaixo cobre os
 * defaults do JSM em inglês e em português; se a instalação renomeou, a leitura devolve
 * `null` — honesto, visível e corrigível numa linha, sem nunca ter mostrado data errada.
 *
 * _Requirements: RF-29, RF-31, RN-08, RNF-18, RNF-30_
 */

/** O SLA como o resto do app o consome — as três incertezas explícitas. */
export interface SlaDoJsm {
  /** Quando o prazo estoura (ISO). `null` = a resposta não trouxe o carimbo. */
  readonly prazo: string | null
  /**
   * Foi cumprido? `true`/`false` só quando **está decidido**.
   *
   * ⚠️ `null` é o estado comum de um chamado recém-aberto: o ciclo está correndo e
   * ninguém ainda respondeu. `false` ali diria "estourou", que é afirmação sobre o
   * futuro.
   */
  readonly cumprido: boolean | null
}

/**
 * Nomes que significam "primeira resposta", normalizados.
 *
 * Casamento por **conteúdo** e não por igualdade: o default em inglês é *"Time to first
 * response"* e o em português *"Tempo até a primeira resposta"* — nenhum dos dois é o
 * pedaço que importa. E "tempo de resposta", sozinho, ficou **fora** de propósito: é
 * vago o bastante para nomear um SLA de resolução.
 */
const NOMES_DE_PRIMEIRA_RESPOSTA: readonly string[] = [
  'first response',
  'first reply',
  'primeira resposta',
  'primeiro retorno',
]

function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
}

interface CicloBruto {
  breachTime?: { iso8601?: unknown }
  breached?: unknown
}

interface SlaBruto {
  name?: unknown
  ongoingCycle?: CicloBruto
  /** ⚠️ A doc usa **as duas** grafias, conforme o endpoint. Aceitar uma só perde metade. */
  completedCycles?: unknown
  completedCycle?: unknown
}

function carimbo(ciclo: CicloBruto | undefined): string | null {
  const iso = ciclo?.breachTime?.iso8601
  return typeof iso === 'string' && iso.length > 0 ? iso : null
}

/** Só booleano decide; qualquer outra coisa é "não sei", nunca `false`. */
function estourou(ciclo: CicloBruto | undefined): boolean | null {
  return typeof ciclo?.breached === 'boolean' ? ciclo.breached : null
}

function ciclosConcluidos(sla: SlaBruto): CicloBruto[] {
  const bruto = Array.isArray(sla.completedCycles)
    ? sla.completedCycles
    : Array.isArray(sla.completedCycle)
      ? sla.completedCycle
      : []
  return bruto as CicloBruto[]
}

/**
 * O SLA de primeira resposta dentro do `sla` expandido — ou `null`.
 *
 * `null` cobre três coisas que **não** se distinguem a partir da resposta e que levam à
 * mesma tela: o campo não veio, o tipo não tem SLA, e nenhum SLA foi reconhecido como o
 * de primeira resposta. As três significam "não afirme prazo nenhum".
 *
 * Já **SLA reconhecido sem ciclo** devolve `{ prazo: null, cumprido: null }`: existe o
 * compromisso, o relógio ainda não começou. É a mesma distinção de `{ conhecido: false }`
 * × `{ conhecido: true, campos: [] }` em `declaracao-anexo.ts`.
 */
export function slaDePrimeiraResposta(bruto: unknown): SlaDoJsm | null {
  const valores = (bruto as { values?: unknown } | null | undefined)?.values
  if (!Array.isArray(valores)) return null

  const sla = (valores as SlaBruto[]).find((v) => {
    const nome = typeof v?.name === 'string' ? normalizar(v.name) : ''
    return nome !== '' && NOMES_DE_PRIMEIRA_RESPOSTA.some((n) => nome.includes(n))
  })
  if (!sla) return null

  // O ciclo CONCLUÍDO decide, quando existe: ele é o fato consumado. O último da lista é
  // o mais recente — um chamado reaberto tem mais de um, e o primeiro descreveria um
  // atendimento que já acabou.
  const concluidos = ciclosConcluidos(sla)
  const ultimoConcluido = concluidos[concluidos.length - 1]
  if (ultimoConcluido) {
    const breached = estourou(ultimoConcluido)
    return {
      prazo: carimbo(ultimoConcluido),
      cumprido: breached === null ? null : !breached,
    }
  }

  const emCurso = sla.ongoingCycle
  if (!emCurso) return { prazo: null, cumprido: null }
  // ⚠️ Ciclo em curso: só `breached === true` decide (já estourou). `false` significa
  // "ainda dentro do prazo", que **não** é "cumprido" — ninguém respondeu ainda.
  return { prazo: carimbo(emCurso), cumprido: estourou(emCurso) === true ? false : null }
}
