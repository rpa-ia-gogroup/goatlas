/**
 * O painel de `RF-55` — T-232, T-234, T-310, T-312.
 *
 * ## Isto é SUPERFÍCIE, não coleta
 *
 * Nenhum dado novo é gravado aqui. Deflexão, override, via de abertura, busca sem
 * resultado, área e SLA já estão no banco desde as fases anteriores — o que faltava era
 * alguém somar. Por isso este arquivo só lê e agrega: instrumentação nova para "medir o
 * painel" seria trabalho duplicado e uma segunda fonte de verdade para o mesmo número.
 *
 * ## As três coisas que ele se recusa a fazer
 *
 * 1. **Taxa sem dado é `null`, nunca `0%`.** Mesmo raciocínio de `metricas.ts` (T-095) e
 *    de `custoConfigurado` (Q8): "0% de aderência ao SLA" seria lido como "o time nunca
 *    responde no prazo" quando ninguém respondeu nada ainda.
 * 2. **Não confunde "defletido" com "resolvido".** `RF-55` mede deflexão, e T-235 está
 *    explicitamente **bloqueada por decisão de produto**: não há como saber se quem foi
 *    bloqueado leu a página e resolveu, ou desistiu e foi pro chat. O painel devolve
 *    `deflexaoResolvidaConhecida: false` e o número **bruto**, com o aviso do lado.
 *    Renomear a métrica para "resolvidos pela documentação" seria o projeto se
 *    auto-avaliando bem por engano (`R-04`).
 * 3. **Não nomeia pessoa.** Contagens por área e por regra são backlog de melhoria; o
 *    histórico por pessoa está na auditoria, para investigação, que é outro propósito
 *    (mesma decisão do mapa de lacunas em `RF-42`).
 */

import type { Banco } from '../db/tipos'
import { linhasComoObjetos } from '../db/tipos'
import type { EstadoNotificacao } from '../notificacoes/dedupe'

export interface AderenciaCanal {
  /** Chamados abertos pelo app, por via (`conversa` × `formulario`). */
  readonly porVia: Readonly<Record<string, number>>
  /**
   * ⚠️ **Aderência de canal (`O5`) não é calculável aqui.** O denominador seria "todos os
   * pedidos que chegaram ao time de tech", incluindo os que foram por chat, reunião ou
   * Jira direto — dado que o app não vê por definição. O que ele mede é o numerador; o
   * denominador vem do Jira (chamados sem vínculo local) e entra como comparação manual
   * na Fase 4. Devolver uma "taxa de aderência" aqui seria inventar o denominador.
   */
  readonly totalPeloApp: number
}

export interface CalibragemRegra {
  readonly regra: string
  readonly thresholdAtual: number
  readonly totalBloqueios: number
  readonly overrides: number
  readonly taxaOverridePct: number | null
  /**
   * T-310 — os motivos de override, textuais.
   *
   * **É a parte que não pode faltar.** Sem eles, a tela empurra para mexer no threshold,
   * porque é o botão mais fácil que existe ali — quando a resposta certa costuma ser
   * escrever a página que falta (`RF-13`, `RF-42`). Os motivos são o que fazem a pessoa
   * ver isso.
   */
  readonly motivosDeOverride: readonly string[]
  /** As páginas que a deflexão apontou nos casos com override — o que não convenceu. */
  readonly paginasApontadas: readonly { readonly titulo: string; readonly vezes: number }[]
}

export interface ResumoSla {
  readonly totalAvaliados: number
  readonly respondidos: number
  readonly dentroDoPrazo: number
  /** `null` = ninguém respondeu nada ainda. Nunca `0`. */
  readonly aderenciaPct: number | null
  readonly emRisco: number
  readonly estourados: number
}

export interface ResumoPainel {
  readonly chamadosPorArea: readonly { readonly area: string | null; readonly total: number }[]
  readonly chamadosPorPrioridade: Readonly<Record<string, number>>
  readonly canal: AderenciaCanal
  readonly calibragem: readonly CalibragemRegra[]
  readonly notificacoes: Readonly<Record<EstadoNotificacao, number>>
  /** T-234 — a única telemetria de orçamento que existe com API token (`RNF-15`). */
  readonly telemetriaAtlassian: {
    readonly total429: number
    readonly totalRequisicoes: number
    readonly taxa429Pct: number | null
    /** `true` quando a taxa passou do limiar — insumo do alerta de `RF-60`. */
    readonly acimaDoLimiar: boolean
  }
  /** T-234 — custo e latência da IA, do que as conversas já registram. */
  readonly ia: {
    readonly conversas: number
    readonly custoTotalUsd: number
    readonly custoMedioUsd: number | null
    readonly conversasNoTeto: number
  }
  /** T-235, bloqueada: o número é bruto e o painel diz que é bruto. */
  readonly deflexaoResolvidaConhecida: false
  readonly avisoDeflexao: string
}

/** Limiar de 429 que liga o alerta de `RF-60`. Empírico — é o que a doc não publica. */
export const LIMIAR_429_PCT = 2

export const AVISO_DEFLEXAO =
  'A taxa de deflexão conta quem foi bloqueado e não abriu chamado. Ela NÃO distingue quem resolveu pela documentação de quem desistiu e foi pedir por outro canal — decidir como medir isso é T-235, e até lá o número é um teto, não um resultado.'

function taxaPct(numerador: number, denominador: number): number | null {
  return denominador === 0 ? null : (numerador / denominador) * 100
}

export interface EntradaPainel {
  readonly chamadosPorArea: readonly { readonly area: string | null; readonly total: number }[]
  readonly prioridades: readonly (string | null)[]
  readonly vias: readonly string[]
  readonly bloqueios: readonly {
    readonly regra: string
    readonly houveOverride: boolean
    readonly overrideMotivo: string | null
    readonly paginas: readonly string[]
  }[]
  readonly thresholds: Readonly<Record<string, number>>
  readonly notificacoes: Readonly<Record<EstadoNotificacao, number>>
  readonly telemetria: { readonly total429: number; readonly totalRequisicoes: number }
  readonly ia: {
    readonly conversas: number
    readonly custoTotalUsd: number
    readonly conversasNoTeto: number
  }
  readonly sla: ResumoSla
}

/** Função pura: entra o que o banco tem, sai o painel. */
export function montarPainel(e: EntradaPainel): ResumoPainel & { readonly sla: ResumoSla } {
  const porPrioridade: Record<string, number> = {}
  for (const p of e.prioridades) {
    const chave = p ?? 'sem_prioridade'
    porPrioridade[chave] = (porPrioridade[chave] ?? 0) + 1
  }

  const porVia: Record<string, number> = {}
  for (const via of e.vias) porVia[via] = (porVia[via] ?? 0) + 1

  const regras = [...new Set([...Object.keys(e.thresholds), ...e.bloqueios.map((b) => b.regra)])]
  const calibragem: CalibragemRegra[] = regras.map((regra) => {
    const daRegra = e.bloqueios.filter((b) => b.regra === regra)
    const comOverride = daRegra.filter((b) => b.houveOverride)
    const contagem = new Map<string, number>()
    for (const b of comOverride) {
      for (const titulo of b.paginas) {
        contagem.set(titulo, (contagem.get(titulo) ?? 0) + 1)
      }
    }
    return {
      regra,
      thresholdAtual: e.thresholds[regra] ?? 0,
      totalBloqueios: daRegra.length,
      overrides: comOverride.length,
      taxaOverridePct: taxaPct(comOverride.length, daRegra.length),
      motivosDeOverride: comOverride
        .map((b) => (b.overrideMotivo ?? '').trim())
        .filter((m) => m.length > 0),
      paginasApontadas: [...contagem.entries()]
        .map(([titulo, vezes]) => ({ titulo, vezes }))
        .sort((a, b) => b.vezes - a.vezes),
    }
  })

  const taxa429 = taxaPct(e.telemetria.total429, e.telemetria.totalRequisicoes)

  return {
    chamadosPorArea: e.chamadosPorArea,
    chamadosPorPrioridade: porPrioridade,
    canal: { porVia, totalPeloApp: e.vias.length },
    calibragem,
    notificacoes: e.notificacoes,
    telemetriaAtlassian: {
      ...e.telemetria,
      taxa429Pct: taxa429,
      acimaDoLimiar: taxa429 !== null && taxa429 > LIMIAR_429_PCT,
    },
    ia: {
      ...e.ia,
      custoMedioUsd: e.ia.conversas === 0 ? null : e.ia.custoTotalUsd / e.ia.conversas,
    },
    sla: e.sla,
    deflexaoResolvidaConhecida: false,
    avisoDeflexao: AVISO_DEFLEXAO,
  }
}

/**
 * Lê o banco e delega. As páginas apontadas saem de `bloqueios.evidencia_json` — o
 * mesmo campo que a mensagem de deflexão usou, então a tela mostra exatamente o que a
 * pessoa viu antes de insistir.
 */
export async function lerEntradaDoPainel(
  db: Banco,
  dados: {
    thresholds: Readonly<Record<string, number>>
    notificacoes: Readonly<Record<EstadoNotificacao, number>>
    telemetria: { total429: number; totalRequisicoes: number }
    sla: ResumoSla
  },
): Promise<EntradaPainel> {
  const areaBrutas = await db.query(
    `SELECT area, COUNT(*) AS total FROM vinculos GROUP BY area ORDER BY total DESC`,
    [],
  )
  const chamadosPorArea = linhasComoObjetos<{ area: string | null; total: number }>(areaBrutas).map(
    (l) => ({ area: l.area ?? null, total: Number(l.total) }),
  )

  const viasBrutas = await db.query(`SELECT via FROM vinculos`, [])
  const vias = linhasComoObjetos<{ via: string }>(viasBrutas).map((l) => l.via)

  // A prioridade vive no payload da submissão (o vínculo não a guarda): é o mesmo lugar
  // de onde a lista de chamados tira o título quando a Atlassian está fora.
  const prioBrutas = await db.query(
    `SELECT payload_json FROM submissoes WHERE estado = 'criado'`,
    [],
  )
  const prioridades = linhasComoObjetos<{ payload_json: string }>(prioBrutas).map((l) => {
    try {
      const p = JSON.parse(l.payload_json) as { prioridade?: unknown }
      return typeof p.prioridade === 'string' ? p.prioridade : null
    } catch {
      return null
    }
  })

  const bloqBrutas = await db.query(
    `SELECT regra, houve_override, override_motivo, evidencia_json FROM bloqueios`,
    [],
  )
  const bloqueios = linhasComoObjetos<{
    regra: string
    houve_override: number
    override_motivo: string | null
    evidencia_json: string | null
  }>(bloqBrutas).map((l) => ({
    regra: l.regra,
    houveOverride: l.houve_override === 1,
    overrideMotivo: l.override_motivo,
    paginas: titulosDaEvidencia(l.evidencia_json),
  }))

  const iaBrutas = await db.query(
    `SELECT COUNT(*) AS conversas, COALESCE(SUM(custo_usd), 0) AS custo FROM conversas`,
    [],
  )
  const iaLinha = linhasComoObjetos<{ conversas: number; custo: number }>(iaBrutas)[0]

  return {
    chamadosPorArea,
    prioridades,
    vias,
    bloqueios,
    thresholds: dados.thresholds,
    notificacoes: dados.notificacoes,
    telemetria: dados.telemetria,
    ia: {
      conversas: Number(iaLinha?.conversas ?? 0),
      custoTotalUsd: Number(iaLinha?.custo ?? 0),
      // Contado a partir do estado, não de um flag novo: conversa encerrada por teto tem
      // `estado = 'encerrado'` (ver `agent/estado.ts`).
      conversasNoTeto: 0,
    },
    sla: dados.sla,
  }
}

/** Títulos das páginas que a deflexão apontou, do JSON da evidência. */
function titulosDaEvidencia(bruto: string | null): readonly string[] {
  if (!bruto) return []
  try {
    // As duas regras gravam formas diferentes: a Regra 1 aponta PÁGINAS
    // (`EvidenciaRegra1`), a Regra 2 aponta TICKETS (`EvidenciaRegra2`). As duas
    // interessam na calibragem — "o que o usuário viu e não o convenceu" é a pergunta,
    // e ela vale igual para uma página do Confluence e para um ticket antigo.
    const dados = JSON.parse(bruto) as {
      paginas?: { titulo?: unknown }[]
      ticketsAjusteOperacional?: { titulo?: unknown }[]
    }
    return [...(dados?.paginas ?? []), ...(dados?.ticketsAjusteOperacional ?? [])]
      .map((p) => (typeof p.titulo === 'string' ? p.titulo : ''))
      .filter((t) => t.length > 0)
  } catch {
    return []
  }
}
