/**
 * O que mudou no cartão — spec 013, `FR-25`, `FR-26`.
 *
 * ## Por que isto é uma tela, e não um campo
 *
 * A spec 008 (`D-71`) fez a proposta ser **rederivada a cada turno**, e gravou no evento
 * `proposta_rederivada` tudo o que seria preciso para explicar o resultado: a proposta nova,
 * a **base** (a última que a IA produziu) e a lista `alterados`. Nada disso chegava à tela —
 * saía como JSON, e responder *"por que o cartão ficou assim?"* exigia comparar dois objetos
 * a olho, um dentro do outro.
 *
 * ## 🚨 A base é a última proposta DA IA, nunca a vigente
 *
 * É a decisão de `D-71` e ela é a razão de o diff significar alguma coisa. A **vigente**
 * carrega a edição da pessoa (`PUT /proposta`, `RF-16`): diffar contra ela faria a IA
 * "mudar" a prioridade só por **repetir** a sugestão que a pessoa tinha rebaixado, e a tela
 * diria *"a IA mudou a prioridade"* sobre uma opinião que não mudou.
 *
 * Aqui isso é de graça: o evento já traz `baseAnterior`, que é exatamente
 * `conversas.proposta_ia_json`. Este arquivo **não escolhe** a base — ele lê a que foi
 * gravada, e há teste afirmando que a edição da pessoa não vira mudança da IA.
 *
 * ⚠️ **Puro, sem React.** Mesma razão de `eventos.ts`: a suíte roda em `environment: 'node'`,
 * e a exportação da sessão (`FR-31`) reaproveita a mesma comparação.
 */

/** Alterado, adicionado ou removido. Campo igual não vira mudança — some da lista. */
export type StatusDaMudanca = 'alterado' | 'adicionado' | 'removido'

export interface MudancaDeCampo {
  /** O nome do campo em português — nunca a chave do JSON (`RNF-30`). */
  readonly rotulo: string
  readonly status: StatusDaMudanca
  readonly antes: string | null
  readonly depois: string | null
  /** Texto que não cabe numa linha: a tela desenha antes×depois em dois blocos. */
  readonly longo: boolean
}

type Dados = Readonly<Record<string, unknown>>

function objeto(v: unknown): Dados | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Dados) : null
}

/** String não vazia, ou `null`. Vazio **é** ausência aqui: título em branco não é título. */
function texto(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t === '' ? null : t
}

/**
 * Os campos fixos da proposta, na ordem em que se lê o cartão.
 *
 * ⚠️ **`campos` fica fora desta lista** — ele é um mapa `fieldId → valor` e é comparado
 * chave a chave logo abaixo. Tratá-lo como um campo só faria toda a linha aparecer como
 * "alterado" porque **um** campo do formulário mudou.
 */
const CAMPOS_FIXOS: readonly { readonly chave: string; readonly rotulo: string; readonly longo: boolean }[] = [
  { chave: 'titulo', rotulo: 'título', longo: false },
  { chave: 'descricao', rotulo: 'descrição', longo: true },
  { chave: 'tipoChamadoId', rotulo: 'assunto (id do request type)', longo: false },
  { chave: 'prioridade', rotulo: 'prioridade', longo: false },
  { chave: 'motivoPrioridade', rotulo: 'motivo da prioridade', longo: true },
  { chave: 'area', rotulo: 'área', longo: false },
  { chave: 'componente', rotulo: 'componente', longo: false },
]

/** Acima disto o valor vira bloco antes×depois em vez de caber na linha. */
const LONGO_A_PARTIR_DE = 80

function mudanca(
  rotulo: string,
  antes: string | null,
  depois: string | null,
  longoPorNatureza: boolean,
): MudancaDeCampo | null {
  if (antes === depois) return null
  const status: StatusDaMudanca =
    antes === null ? 'adicionado' : depois === null ? 'removido' : 'alterado'
  const longo =
    longoPorNatureza ||
    (antes?.length ?? 0) > LONGO_A_PARTIR_DE ||
    (depois?.length ?? 0) > LONGO_A_PARTIR_DE
  return { rotulo, status, antes, depois, longo }
}

/**
 * O diff entre a base e a proposta nova.
 *
 * Devolve **só o que mudou**. Lista vazia é resposta legítima e a tela diz isso em palavras —
 * uma tabela de diff vazia se lê como defeito (`ScB-02`).
 */
export function compararPropostas(base: unknown, nova: unknown): readonly MudancaDeCampo[] {
  const a = objeto(base)
  const b = objeto(nova)
  // Sem base não há comparação possível: é a **primeira** derivação da conversa, e tudo nela
  // seria "adicionado" — o que é verdade e não é informação.
  if (a === null || b === null) return []

  const fora: MudancaDeCampo[] = []
  for (const c of CAMPOS_FIXOS) {
    const m = mudanca(c.rotulo, texto(a[c.chave]), texto(b[c.chave]), c.longo)
    if (m !== null) fora.push(m)
  }

  // Os campos do formulário, um a um. A chave é o `fieldId`, e ele **aparece** — aqui, ao
  // contrário do cartão da pessoa, é justamente o que se quer conferir contra o schema.
  const camposA = objeto(a.campos) ?? {}
  const camposB = objeto(b.campos) ?? {}
  for (const chave of [...new Set([...Object.keys(camposA), ...Object.keys(camposB)])].sort()) {
    const m = mudanca(`campo ${chave}`, texto(camposA[chave]), texto(camposB[chave]), false)
    if (m !== null) fora.push(m)
  }
  return fora
}

// --- a trilha das versões ----------------------------------------------------

export interface VersaoDoCartao {
  /** 1, 2, 3… na ordem em que a IA derivou. */
  readonly numero: number
  readonly quando: string
  readonly titulo: string | null
  readonly prioridade: string | null
  readonly assunto: string | null
  /** O que a IA mudou nesta versão, já em português. Vazio na primeira. */
  readonly mudancas: readonly MudancaDeCampo[]
  /** `true` quando a versão nasceu do botão "montar o chamado agora" (`D-76`). */
  readonly forcada: boolean
}

/** O que a trilha precisa de cada evento — o mínimo, para o teste não montar a tela inteira. */
export interface EventoDeProposta {
  readonly tipo: string
  readonly dados_json: string | null
  readonly criado_em: string
}

/**
 * A trilha `v1 → v2 → v3` de uma sessão — `FR-26`.
 *
 * ⚠️ **Lê os eventos, nunca a conversa.** A tabela `conversas` guarda só o **último** estado;
 * a pergunta *"em que turno o assunto mudou?"* só tem resposta no registro. É a mesma razão
 * pela qual o Investigador existe.
 */
export function trilhaDoCartao(eventos: readonly EventoDeProposta[]): readonly VersaoDoCartao[] {
  const fora: VersaoDoCartao[] = []
  for (const e of eventos) {
    if (e.tipo !== 'proposta_rederivada' || e.dados_json === null) continue
    let d: Dados
    try {
      d = objeto(JSON.parse(e.dados_json)) ?? {}
    } catch {
      continue
    }
    const p = objeto(d.proposta)
    if (p === null) continue
    fora.push({
      numero: fora.length + 1,
      quando: e.criado_em,
      titulo: texto(p.titulo),
      prioridade: texto(p.prioridade),
      assunto: texto(p.tipoChamadoId),
      mudancas: compararPropostas(d.baseAnterior, d.proposta),
      forcada: d.forcado === true,
    })
  }
  return fora
}
