/**
 * O turno — spec 013, `FR-21`.
 *
 * ## Por que o turno é a unidade
 *
 * A linha do tempo era uma **lista plana**: uma conversa de seis mensagens virava ~80 itens em
 * sequência, e a pergunta que a aba existe para responder — *"o que aconteceu neste turno, e
 * por que ele levou 40 segundos?"* — só se respondia contando itens com o dedo.
 *
 * 🚨 **O dado para agrupar já estava gravado, e ninguém o usava.** `coleta.ts#gravar` escreve
 * `requisicao_id` em **todo** evento (é o segundo parâmetro de cada tupla), e `detalharSessao`
 * já devolve eventos **e** requisições da conversa. Uma requisição `/api/*` é um turno, por
 * construção: a coleta acumula em memória durante a requisição e grava tudo de uma vez
 * (`FR-10c`). Agrupar não custa uma consulta nova, uma coluna nova nem um byte a mais no
 * payload — custou não ter sido feito.
 *
 * ## As três decisões deste arquivo
 *
 * 1. ⚠️ **Evento sem requisição casada NÃO some.** Dado anterior ao `requisicao_id`, ou
 *    requisição fora do teto de 500 de `detalharSessao`, cai num grupo próprio ("fora de
 *    turno"). Sumir seria a tela afirmar que o app não fez nada.
 * 2. ⚠️ **As chamadas externas saem da narrativa e viram um agregado do turno.** Seis idas à
 *    Atlassian no meio da conversa é o ruído que fazia a linha do tempo parecer log; o número
 *    e o tempo somado, no cabeçalho, é o achado de `D-73` (*~2,6 s só para nomear os
 *    assuntos*) visível de relance. Elas continuam abríveis, uma a uma.
 * 3. ⚠️ **A ordem é a do registro** (`criado_em`, desempate por `ordem`), nunca a da
 *    gravação: dois eventos no mesmo milissegundo são o caso comum, e sem `ordem` o empate é
 *    indeterminado (`D-73`).
 *
 * Puro, sem React: é o que permite afirmar sobre a soma e sobre o agrupamento em
 * `environment: 'node'`.
 */

import type { EventoRegistrado, RequisicaoRegistrada } from '../api'

/** A chave do grupo dos órfãos. Não é id de requisição nenhuma, e é de propósito. */
export const FORA_DE_TURNO = 'fora-de-turno'

export interface Turno {
  readonly chave: string
  /** 1, 2, 3… na ordem em que aconteceram. `null` no grupo dos órfãos. */
  readonly numero: number | null
  readonly requisicao: RequisicaoRegistrada | null
  readonly criadoEm: string
  /** Os eventos da narrativa — tudo menos as chamadas externas. */
  readonly eventos: readonly EventoRegistrado[]
  readonly chamadasExternas: readonly EventoRegistrado[]
  readonly custoUsd: number
  /** Da requisição, quando houver: é o tempo que a pessoa esperou. */
  readonly duracaoMs: number | null
  /** Soma das chamadas externas — quanto do turno foi espera por terceiro. */
  readonly tempoExternoMs: number
  readonly toolsExecutadas: readonly string[]
  readonly toolsRecusadas: readonly string[]
  /** Uma frase curta com o que o turno produziu, ou `null` quando não produziu nada notável. */
  readonly desfecho: string | null
}

function nomeDaTool(e: EventoRegistrado, chave: string): string | null {
  if (e.dados_json === null) return null
  try {
    const d = JSON.parse(e.dados_json) as Record<string, unknown>
    const v = d[chave]
    return typeof v === 'string' && v !== '' ? v : null
  } catch {
    return null
  }
}

/**
 * O desfecho do turno em uma frase.
 *
 * ⚠️ **A ordem das perguntas é a ordem de importância**, e não é cosmética: um turno que
 * bloqueou **e** rederivou o cartão é, para quem investiga, um turno que bloqueou. Mostrar o
 * segundo fato faria a leitura de relance apontar para o lugar errado.
 */
function desfechoDoTurno(eventos: readonly EventoRegistrado[]): string | null {
  const tipos = new Set(eventos.map((e) => e.tipo))
  if (tipos.has('erro_de_rota')) return 'a rota lançou'
  if (tipos.has('bloqueio')) return 'bloqueou'
  if (tipos.has('desfecho_criacao')) {
    const criou = eventos.some(
      (e) => e.tipo === 'desfecho_criacao' && nomeDaTool(e, 'issueKey') !== null,
    )
    return criou ? 'chamado criado' : 'a criação falhou'
  }
  if (tipos.has('ia_extracao_recusada')) return 'sem cartão'
  if (tipos.has('proposta_rederivada')) return 'cartão rederivado'
  if (tipos.has('resposta_agente')) return 'respondeu'
  return null
}

/**
 * Agrupa os eventos de uma sessão em turnos.
 *
 * A ordem de saída é cronológica pelo **primeiro evento** de cada grupo — não pela requisição,
 * que pode ter sido gravada depois (o carimbo dela é o do fim da requisição, `coleta.ts`).
 */
export function agruparEmTurnos(
  eventos: readonly EventoRegistrado[],
  requisicoes: readonly RequisicaoRegistrada[],
): readonly Turno[] {
  const porId = new Map<string, RequisicaoRegistrada>()
  for (const r of requisicoes) porId.set(r.id, r)

  const grupos = new Map<string, EventoRegistrado[]>()
  const ordemDeChegada: string[] = []
  const ordenados = [...eventos].sort(
    (a, b) => a.criado_em.localeCompare(b.criado_em) || a.ordem - b.ordem,
  )
  for (const e of ordenados) {
    const chave = e.requisicao_id ?? FORA_DE_TURNO
    const atual = grupos.get(chave)
    if (atual === undefined) {
      grupos.set(chave, [e])
      ordemDeChegada.push(chave)
    } else {
      atual.push(e)
    }
  }

  let numero = 0
  return ordemDeChegada.map((chave) => {
    const doGrupo = grupos.get(chave) ?? []
    const externas = doGrupo.filter((e) => e.tipo === 'chamada_externa')
    const narrativa = doGrupo.filter((e) => e.tipo !== 'chamada_externa')
    const requisicao = porId.get(chave) ?? null
    const ehOrfao = chave === FORA_DE_TURNO
    if (!ehOrfao) numero += 1
    return {
      chave,
      numero: ehOrfao ? null : numero,
      requisicao,
      criadoEm: doGrupo[0]?.criado_em ?? requisicao?.criado_em ?? '',
      eventos: narrativa,
      chamadasExternas: externas,
      // O custo do turno é a soma dos eventos, não o da requisição: quem paga é a ida ao
      // modelo, e um turno tem várias (um `ia_chat` por ciclo, mais a extração).
      custoUsd: doGrupo.reduce((s, e) => s + (e.custo_usd ?? 0), 0),
      duracaoMs: requisicao?.duracao_ms ?? null,
      tempoExternoMs: externas.reduce((s, e) => s + (e.duracao_ms ?? 0), 0),
      toolsExecutadas: narrativa
        .filter((e) => e.tipo === 'tool_executada')
        .map((e) => nomeDaTool(e, 'tool'))
        .filter((n): n is string => n !== null),
      toolsRecusadas: narrativa
        .filter((e) => e.tipo === 'tool_recusada')
        .map((e) => nomeDaTool(e, 'toolProposta'))
        .filter((n): n is string => n !== null),
      desfecho: desfechoDoTurno(narrativa),
    }
  })
}

/**
 * As chamadas externas de um turno, resumidas por destino.
 *
 * ⚠️ **Por destino, não por caminho.** Caminho é o que se abre para investigar; destino é o
 * que responde de relance *"o turno esperou por quem?"* — e é a pergunta que separa "o modelo
 * demorou" de "a Atlassian demorou", que o registro plano confundia.
 */
export function resumirChamadas(
  chamadas: readonly EventoRegistrado[],
): readonly { readonly alvo: string; readonly total: number; readonly ms: number }[] {
  const por = new Map<string, { total: number; ms: number }>()
  for (const c of chamadas) {
    // O alvo já está na origem do evento (`coleta.ts` mapeia `organizacao` → `atlassian`).
    const atual = por.get(c.origem) ?? { total: 0, ms: 0 }
    atual.total += 1
    atual.ms += c.duracao_ms ?? 0
    por.set(c.origem, atual)
  }
  return [...por.entries()]
    .map(([alvo, v]) => ({ alvo, total: v.total, ms: v.ms }))
    .sort((a, b) => b.ms - a.ms)
}
