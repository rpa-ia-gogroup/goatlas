/**
 * As consultas do painel — spec 009, `FR-12` a `FR-17`.
 *
 * ## A regra que governa este arquivo: nenhum N+1
 *
 * O Investigador do godocs pagou esta lição em produção: um `getChatMessages(p.id)` dentro
 * do laço de projetos virou uma ida ao banco **por projeto, com o texto completo das
 * mensagens**, e o endpoint passou a responder 500/503 — com a lista vazia e os contadores
 * mentindo na tela. Aqui a lista é montada com um número **constante** de consultas
 * agregadas, e `SC-8` é o teste que reprova quem reintroduzir o laço.
 *
 * ⚠️ **Toda leitura daqui é de admin** (o gate está nas rotas). Este arquivo não filtra por
 * e-mail de propósito, e por isso os nomes dizem isso: quem o usar numa rota de colaborador
 * comete um bug **visível na revisão**, que é o mesmo desenho de
 * `obterSemIsolamento_apenasReconciliacao`.
 */

import { linhasComoObjetos, type Banco } from '../db/tipos'

/** Teto de sessões e de linhas devolvidas — a tela mostra as recentes, nunca tudo. */
export const LIMITE_PADRAO = 60

export interface SessaoInvestigador {
  readonly conversaId: string
  readonly solicitanteEmail: string
  readonly estado: string
  readonly criadoEm: string
  readonly ultimaAtividade: string
  readonly custoUsd: number
  readonly mensagensDaPessoa: number
  readonly mensagensDoAgente: number
  readonly bloqueios: number
  readonly overrides: number
  /** `true` quando a conversa chegou a ter cartão — o que a pessoa precisa para confirmar. */
  readonly temProposta: boolean
  readonly confirmadoEm: string | null
  readonly issueKey: string | null
  readonly requisicoes: number
  readonly errosDeApi: number
  readonly duracaoMaximaMs: number | null
  /**
   * 🚨 O campo que existe por causa de 14/08/2026: por que não houve proposta.
   *
   * `null` quando houve proposta (ou quando a conversa ainda não chegou lá). Preenchido com
   * o **último** motivo registrado — os seis de `orquestrador.ts#semProposta`.
   */
  readonly motivoSemProposta: string | null
}

export interface FiltroDeSessoes {
  readonly email?: string | null
  /** `sem_proposta` · `com_bloqueio` · `com_erro` · `abandonada` — ver `FR-13`. */
  readonly recorte?: string | null
  readonly limite?: number | undefined
}

/** Uma linha do log de API. */
export interface RequisicaoInvestigador {
  readonly id: string
  readonly ator_email: string
  readonly conversa_id: string | null
  readonly metodo: string
  readonly caminho: string
  readonly status: number
  readonly duracao_ms: number
  readonly req_bytes: number | null
  readonly resp_bytes: number | null
  readonly req_json: string | null
  readonly resp_json: string | null
  readonly erro: string | null
  readonly criado_em: string
}

export interface EventoLido {
  readonly id: string
  readonly requisicao_id: string | null
  readonly conversa_id: string | null
  readonly ator_email: string
  readonly tipo: string
  readonly origem: string
  readonly resumo: string | null
  readonly dados_json: string | null
  readonly custo_usd: number | null
  readonly duracao_ms: number | null
  readonly ordem: number
  readonly criado_em: string
}

function inteiro(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/**
 * A lista de sessões — **seis** consultas, sempre, independentemente de quantas conversas
 * existirem. Nenhuma delas traz o texto das mensagens: a lista conta, o detalhe mostra.
 */
export async function listarSessoes(
  db: Banco,
  filtro: FiltroDeSessoes = {},
): Promise<readonly SessaoInvestigador[]> {
  const limite = Math.min(Math.max(filtro.limite ?? LIMITE_PADRAO, 1), 200)
  const porEmail = filtro.email?.trim().toLowerCase() || null

  const conversas = linhasComoObjetos<{
    id: string
    solicitante_email: string
    estado: string
    custo_usd: number
    proposta_json: string | null
    confirmado_em: string | null
    criado_em: string
    atualizado_em: string
  }>(
    await db.query(
      `SELECT id, solicitante_email, estado, custo_usd, proposta_json, confirmado_em,
              criado_em, atualizado_em
         FROM conversas
        ${porEmail ? 'WHERE lower(solicitante_email) = ?' : ''}
        ORDER BY criado_em DESC
        LIMIT ?`,
      porEmail ? [porEmail, limite] : [limite],
    ),
  )
  if (conversas.length === 0) return []

  const mensagens = new Map<string, { pessoa: number; agente: number; ultima: string }>()
  for (const m of linhasComoObjetos<{
    conversa_id: string
    papel: string
    total: number
    ultima: string
  }>(
    await db.query(
      `SELECT conversa_id, papel, COUNT(*) AS total, MAX(criado_em) AS ultima
         FROM mensagens GROUP BY conversa_id, papel`,
      [],
    ),
  )) {
    const atual = mensagens.get(m.conversa_id) ?? { pessoa: 0, agente: 0, ultima: '' }
    if (m.papel === 'user') atual.pessoa += inteiro(m.total)
    if (m.papel === 'assistant') atual.agente += inteiro(m.total)
    if (m.ultima > atual.ultima) atual.ultima = m.ultima
    mensagens.set(m.conversa_id, atual)
  }

  const bloqueios = new Map<string, { total: number; overrides: number }>()
  for (const b of linhasComoObjetos<{
    conversa_id: string
    total: number
    overrides: number
  }>(
    await db.query(
      `SELECT conversa_id, COUNT(*) AS total, SUM(houve_override) AS overrides
         FROM bloqueios GROUP BY conversa_id`,
      [],
    ),
  )) {
    bloqueios.set(b.conversa_id, { total: inteiro(b.total), overrides: inteiro(b.overrides) })
  }

  const api = new Map<string, { total: number; erros: number; maxMs: number }>()
  for (const r of linhasComoObjetos<{
    conversa_id: string
    total: number
    erros: number
    max_ms: number
  }>(
    await db.query(
      `SELECT conversa_id, COUNT(*) AS total,
              SUM(CASE WHEN status >= 400 THEN 1 ELSE 0 END) AS erros,
              MAX(duracao_ms) AS max_ms
         FROM investigador_requisicoes
        WHERE conversa_id IS NOT NULL
        GROUP BY conversa_id`,
      [],
    ),
  )) {
    api.set(r.conversa_id, {
      total: inteiro(r.total),
      erros: inteiro(r.erros),
      maxMs: inteiro(r.max_ms),
    })
  }

  const chamados = new Map<string, string>()
  for (const s of linhasComoObjetos<{ conversa_id: string; issue_key: string | null }>(
    await db.query(
      `SELECT conversa_id, issue_key FROM submissoes
        WHERE conversa_id IS NOT NULL AND issue_key IS NOT NULL`,
      [],
    ),
  )) {
    if (s.issue_key) chamados.set(s.conversa_id, s.issue_key)
  }

  /**
   * O último motivo de "não houve proposta", por conversa.
   *
   * ⚠️ Filtrado pelo **tipo** do evento, e o motivo sai do JSON com `json_extract`. Ler todos
   * os eventos e filtrar em memória traria os corpos inteiros de todas as conversas para o
   * Worker só para achar uma string.
   */
  const semProposta = new Map<string, string>()
  for (const e of linhasComoObjetos<{ conversa_id: string; motivo: string | null }>(
    await db.query(
      `SELECT conversa_id, json_extract(dados_json, '$.motivo') AS motivo
         FROM investigador_eventos
        WHERE tipo = 'ia_extracao_recusada' AND conversa_id IS NOT NULL
        ORDER BY criado_em ASC, ordem ASC`,
      [],
    ),
  )) {
    if (e.motivo) semProposta.set(e.conversa_id, e.motivo)
  }

  const itens = conversas.map((c) => {
    const msg = mensagens.get(c.id) ?? { pessoa: 0, agente: 0, ultima: '' }
    const blo = bloqueios.get(c.id) ?? { total: 0, overrides: 0 }
    const req = api.get(c.id) ?? { total: 0, erros: 0, maxMs: 0 }
    const temProposta = Boolean(c.proposta_json)
    return {
      conversaId: c.id,
      solicitanteEmail: c.solicitante_email,
      estado: c.estado,
      criadoEm: c.criado_em,
      ultimaAtividade: msg.ultima || c.atualizado_em,
      custoUsd: Number(c.custo_usd) || 0,
      mensagensDaPessoa: msg.pessoa,
      mensagensDoAgente: msg.agente,
      bloqueios: blo.total,
      overrides: blo.overrides,
      temProposta,
      confirmadoEm: c.confirmado_em,
      issueKey: chamados.get(c.id) ?? null,
      requisicoes: req.total,
      errosDeApi: req.erros,
      duracaoMaximaMs: req.maxMs || null,
      // Só faz sentido quando não houve proposta — com cartão na tela, o motivo antigo
      // seria uma explicação para algo que deixou de ser verdade.
      motivoSemProposta: temProposta ? null : (semProposta.get(c.id) ?? null),
    }
  })

  return aplicarRecorte(itens, filtro.recorte ?? null)
}

/** `FR-13` — os quatro recortes que respondem às perguntas caras. */
function aplicarRecorte(
  itens: readonly SessaoInvestigador[],
  recorte: string | null,
): readonly SessaoInvestigador[] {
  switch (recorte) {
    case 'sem_proposta':
      return itens.filter((s) => !s.temProposta)
    case 'com_bloqueio':
      return itens.filter((s) => s.bloqueios > 0)
    case 'com_erro':
      return itens.filter((s) => s.errosDeApi > 0)
    // "Abandonada" é conversa com mensagem e **sem chamado**: é a definição operacional de
    // quem veio pedir ajuda e foi embora sem ela.
    case 'abandonada':
      return itens.filter((s) => s.issueKey === null && s.mensagensDaPessoa > 0)
    default:
      return itens
  }
}

/** O detalhe: eventos e requisições daquela conversa, na ordem em que aconteceram. */
export async function detalharSessao(
  db: Banco,
  conversaId: string,
): Promise<{
  readonly eventos: readonly EventoLido[]
  readonly requisicoes: readonly RequisicaoInvestigador[]
  readonly mensagens: readonly {
    id: string
    papel: string
    conteudo: string
    tool_nome: string | null
    criado_em: string
  }[]
}> {
  const eventos = linhasComoObjetos<EventoLido>(
    await db.query(
      `SELECT * FROM investigador_eventos WHERE conversa_id = ?
        ORDER BY criado_em ASC, ordem ASC LIMIT 2000`,
      [conversaId],
    ),
  )
  const requisicoes = linhasComoObjetos<RequisicaoInvestigador>(
    await db.query(
      `SELECT * FROM investigador_requisicoes WHERE conversa_id = ?
        ORDER BY criado_em ASC LIMIT 500`,
      [conversaId],
    ),
  )
  /**
   * As mensagens vêm da tabela **de produção**, não do registro.
   *
   * ⚠️ De propósito: `mensagens` é a conversa de verdade — a mesma que o modelo lê e que a
   * transcrição de `D-54` anexa ao chamado. Reconstruí-la a partir dos eventos mostraria o
   * que o Investigador conseguiu gravar, que é uma pergunta diferente e pior.
   */
  const mensagens = linhasComoObjetos<{
    id: string
    papel: string
    conteudo: string
    tool_nome: string | null
    criado_em: string
  }>(
    await db.query(
      `SELECT id, papel, conteudo, tool_nome, criado_em FROM mensagens
        WHERE conversa_id = ? ORDER BY criado_em ASC LIMIT 500`,
      [conversaId],
    ),
  )
  return { eventos, requisicoes, mensagens }
}

export interface FiltroDeRequisicoes {
  readonly caminho?: string | null
  /** `erro` = 4xx e 5xx · `lento` = acima de `LENTO_MS` · `tudo`. */
  readonly recorte?: string | null
  readonly email?: string | null
  readonly limite?: number | undefined
}

/** Acima disto a chamada entra no recorte "lentas" e no contador do resumo. */
export const LENTO_MS = 5_000

export async function listarRequisicoes(
  db: Banco,
  filtro: FiltroDeRequisicoes = {},
): Promise<readonly RequisicaoInvestigador[]> {
  const limite = Math.min(Math.max(filtro.limite ?? 200, 1), 500)
  const condicoes: string[] = []
  const params: unknown[] = []
  if (filtro.caminho?.trim()) {
    condicoes.push('caminho LIKE ?')
    params.push(`%${filtro.caminho.trim()}%`)
  }
  if (filtro.email?.trim()) {
    condicoes.push('lower(ator_email) = ?')
    params.push(filtro.email.trim().toLowerCase())
  }
  if (filtro.recorte === 'erro') condicoes.push('status >= 400')
  if (filtro.recorte === 'lento') {
    condicoes.push('duracao_ms >= ?')
    params.push(LENTO_MS)
  }
  params.push(limite)
  return linhasComoObjetos<RequisicaoInvestigador>(
    await db.query(
      `SELECT * FROM investigador_requisicoes
        ${condicoes.length > 0 ? `WHERE ${condicoes.join(' AND ')}` : ''}
        ORDER BY criado_em DESC LIMIT ?`,
      params,
    ),
  )
}

export interface ResumoInvestigador {
  readonly totalRequisicoes: number
  readonly totalErros: number
  /** `null` sem nenhuma requisição — nunca `0%`, que se leria como "nada falha". */
  readonly taxaErro: number | null
  readonly duracaoMediaMs: number | null
  readonly lentas: number
  readonly porCaminho: readonly {
    readonly caminho: string
    readonly total: number
    readonly erros: number
    readonly duracaoMediaMs: number
    readonly duracaoMaximaMs: number
  }[]
  readonly totalEventos: number
  readonly custoIaUsd: number
}

/**
 * O resumo do topo — `FR-17`.
 *
 * ⚠️ **`taxaErro` é `null` sem dado, nunca `0`.** Mesmo raciocínio de
 * `governanca/metricas.ts` e de `custoConfigurado`: "0% de erro" numa instalação em que
 * ninguém usou nada afirma uma saúde que ninguém mediu.
 */
export async function resumoInvestigador(db: Banco): Promise<ResumoInvestigador> {
  const geral = linhasComoObjetos<{
    total: number
    erros: number
    media: number
    lentas: number
  }>(
    await db.query(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN status >= 400 THEN 1 ELSE 0 END) AS erros,
              AVG(duracao_ms) AS media,
              SUM(CASE WHEN duracao_ms >= ? THEN 1 ELSE 0 END) AS lentas
         FROM investigador_requisicoes`,
      [LENTO_MS],
    ),
  )[0]

  const porCaminho = linhasComoObjetos<{
    caminho: string
    total: number
    erros: number
    media: number
    maximo: number
  }>(
    await db.query(
      `SELECT caminho, COUNT(*) AS total,
              SUM(CASE WHEN status >= 400 THEN 1 ELSE 0 END) AS erros,
              AVG(duracao_ms) AS media, MAX(duracao_ms) AS maximo
         FROM investigador_requisicoes
        GROUP BY caminho ORDER BY total DESC LIMIT 40`,
      [],
    ),
  )

  const eventos = linhasComoObjetos<{ total: number; custo: number }>(
    await db.query(
      `SELECT COUNT(*) AS total, COALESCE(SUM(custo_usd), 0) AS custo FROM investigador_eventos`,
      [],
    ),
  )[0]

  const total = inteiro(geral?.total)
  return {
    totalRequisicoes: total,
    totalErros: inteiro(geral?.erros),
    taxaErro: total > 0 ? Math.round((inteiro(geral?.erros) / total) * 1000) / 10 : null,
    duracaoMediaMs: total > 0 ? Math.round(Number(geral?.media) || 0) : null,
    lentas: inteiro(geral?.lentas),
    porCaminho: porCaminho.map((c) => ({
      caminho: c.caminho,
      total: inteiro(c.total),
      erros: inteiro(c.erros),
      duracaoMediaMs: Math.round(Number(c.media) || 0),
      duracaoMaximaMs: inteiro(c.maximo),
    })),
    totalEventos: inteiro(eventos?.total),
    custoIaUsd: Number(eventos?.custo) || 0,
  }
}

/**
 * O expurgo — `FR-19`, `SC-10`.
 *
 * ⚠️ **Toca só as duas tabelas do Investigador.** `auditoria` tem piso próprio (`D-17`),
 * `vinculos` nunca é expurgada (apagar seria tirar da pessoa o acesso ao próprio chamado) e
 * `mensagens` é a conversa de verdade, governada por `retencao_conversas_dias`.
 */
export async function expurgarInvestigador(
  db: Banco,
  dias: number,
  agoraIso: string,
): Promise<{ readonly requisicoes: number; readonly eventos: number }> {
  const corte = new Date(Date.parse(agoraIso) - dias * 24 * 60 * 60 * 1000).toISOString()
  const req = await db.exec(`DELETE FROM investigador_requisicoes WHERE criado_em < ?`, [corte])
  const ev = await db.exec(`DELETE FROM investigador_eventos WHERE criado_em < ?`, [corte])
  return { requisicoes: req.rowsWritten ?? 0, eventos: ev.rowsWritten ?? 0 }
}
