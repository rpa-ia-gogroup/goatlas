/**
 * Limpeza de dado de teste — `D-78`.
 *
 * O app foi anunciado para a empresa em 20/08/2026, e o banco de produção carrega o rastro
 * de duas semanas de desenvolvimento **dentro do mesmo banco** que agora tem gente de
 * verdade: chamados falsos (`GOATLAS-1`, `GOATLAS-2`, do `ClienteAtlassianFake`), chamados
 * reais abertos como teste numa fila real (`[TESTE atlas - ignorar]`), buscas de diagnóstico e
 * overrides encenados. Isso não é só sujeira de tela: `governanca/metricas.ts` deriva taxa de
 * deflexão, taxa de override e aderência a SLA **dessas mesmas linhas**, então o primeiro
 * retrato do uso real já nasceria envenenado.
 *
 * 🚨 **Apaga por CHAVE EXPLÍCITA, nunca por heurística.** A tentação é `WHERE criado_em <
 * '<data do anúncio>'` ou `WHERE solicitante_email = '<e-mail do dev>'` — e as duas apagariam
 * dado real, porque quem desenvolveu o app também o usa de verdade e porque gente de verdade
 * entrou antes do anúncio. Quem decide o que é teste é uma **lista**, montada olhando o
 * inventário; o código não adivinha.
 *
 * 🚨 **`auditoria` NUNCA é apagada aqui** (`D-17`, `RNF-33`). Ela é append-only, tem piso de
 * 180 dias clampado inclusive contra configuração menor, e é o único lugar onde fica o rastro
 * de quem apagou o quê — inclusive desta operação. Apagar a auditoria junto seria apagar a
 * prova da limpeza. `config` também fica fora: não é dado de uso, é a instalação.
 */

import type { Banco } from '../db/tipos'
import { linhasComoObjetos, primeiraLinha } from '../db/tipos'

/**
 * Tabelas de uso, na ordem em que o inventário as relata.
 *
 * ⚠️ `auditoria` e `config` estão fora **de propósito** — ver o cabeçalho. `meta_schema` e
 * `marca_agua_polling` também: são estado do próprio motor, não dado de ninguém.
 */
export const TABELAS_DE_USO = [
  'vinculos',
  'submissoes',
  'conversas',
  'mensagens',
  'bloqueios',
  'classificacoes_ticket',
  'buscas',
  'paginas_lidas',
  'notificacoes',
  'acoes_proprias',
  'alertas_sla',
  'avaliacoes_sla',
  'anexos_pendentes',
  'anexos_enviados',
  'analises_anexo',
  'investigador_requisicoes',
  'investigador_eventos',
] as const

export interface VinculoNoInventario {
  readonly issueKey: string
  readonly solicitanteEmail: string
  readonly conversaId: string | null
  readonly criadoEm: string
  /** `true` quando a chave é do `ClienteAtlassianFake` — chamado que não existe no Jira. */
  readonly ehChaveDeFake: boolean
}

export interface ConversaNoInventario {
  readonly id: string
  readonly solicitanteEmail: string
  readonly criadoEm: string
  readonly mensagens: number
  /** Chave do chamado que saiu dela, quando saiu algum. */
  readonly issueKey: string | null
}

export interface OverrideNoInventario {
  readonly regra: string
  readonly motivo: string
  readonly em: string
}

export interface Inventario {
  readonly contagens: Readonly<Record<string, number>>
  readonly vinculos: readonly VinculoNoInventario[]
  readonly conversas: readonly ConversaNoInventario[]
  readonly overrides: readonly OverrideNoInventario[]
  readonly termosBuscados: readonly { termo: string; buscas: number; ultimaEm: string }[]
}

/**
 * O prefixo que o fake usa para as chaves que inventa (`fake.ts`: `GOATLAS-${contador}`).
 *
 * ⚠️ Continua sendo `GOATLAS-`, e não `ATLAS-`, apesar do rename de `D-77`: as linhas em
 * produção foram escritas pela versão antiga do app. É a terceira ponte de compatibilidade
 * com o nome velho, junto com o prefixo `via goatlas:` nos comentários e os secrets.
 */
export const PREFIXO_CHAVE_DE_FAKE = 'GOATLAS-'

async function contar(db: Banco, tabela: string): Promise<number> {
  const r = await db.query(`SELECT COUNT(*) AS n FROM ${tabela}`, [])
  return Number(primeiraLinha<{ n: number }>(r)?.n ?? 0)
}

/** Retrato do que existe, para a lista de descarte ser montada olhando dado, não memória. */
export async function inventariar(db: Banco): Promise<Inventario> {
  const contagens: Record<string, number> = {}
  for (const t of TABELAS_DE_USO) contagens[t] = await contar(db, t)

  const v = await db.query(
    `SELECT issue_key, solicitante_email, conversa_id, criado_em
       FROM vinculos ORDER BY criado_em ASC`,
    [],
  )
  const vinculos = linhasComoObjetos<{
    issue_key: string
    solicitante_email: string
    conversa_id: string | null
    criado_em: string
  }>(v).map((l) => ({
    issueKey: l.issue_key,
    solicitanteEmail: l.solicitante_email,
    conversaId: l.conversa_id,
    criadoEm: l.criado_em,
    ehChaveDeFake: l.issue_key.startsWith(PREFIXO_CHAVE_DE_FAKE),
  }))

  const c = await db.query(
    `SELECT c.id, c.solicitante_email, c.criado_em,
            (SELECT COUNT(*) FROM mensagens m WHERE m.conversa_id = c.id) AS mensagens,
            (SELECT v2.issue_key FROM vinculos v2 WHERE v2.conversa_id = c.id) AS issue_key
       FROM conversas c ORDER BY c.criado_em ASC`,
    [],
  )
  const conversas = linhasComoObjetos<{
    id: string
    solicitante_email: string
    criado_em: string
    mensagens: number
    issue_key: string | null
  }>(c).map((l) => ({
    id: l.id,
    solicitanteEmail: l.solicitante_email,
    criadoEm: l.criado_em,
    mensagens: Number(l.mensagens),
    issueKey: l.issue_key,
  }))

  const o = await db.query(
    `SELECT regra, override_motivo, override_em
       FROM bloqueios
      WHERE houve_override = 1 AND override_motivo IS NOT NULL
      ORDER BY override_em DESC`,
    [],
  )
  const overrides = linhasComoObjetos<{
    regra: string
    override_motivo: string
    override_em: string
  }>(o).map((l) => ({ regra: l.regra, motivo: l.override_motivo, em: l.override_em }))

  const b = await db.query(
    `SELECT termo_normalizado, COUNT(*) AS n, MAX(criado_em) AS ultima
       FROM buscas GROUP BY termo_normalizado ORDER BY n DESC, ultima DESC`,
    [],
  )
  const termosBuscados = linhasComoObjetos<{
    termo_normalizado: string
    n: number
    ultima: string
  }>(b).map((l) => ({ termo: l.termo_normalizado, buscas: Number(l.n), ultimaEm: l.ultima }))

  return { contagens, vinculos, conversas, overrides, termosBuscados }
}

export interface AlvoDeLimpeza {
  /** Chamados a esquecer — leva vínculo, submissão, avisos, SLA e anexos daquela chave. */
  readonly issueKeys?: readonly string[]
  /** Conversas a esquecer — leva mensagens, bloqueios, anexos e registro do Investigador. */
  readonly conversaIds?: readonly string[]
  /** Termos de busca a esquecer (casados por `termo_normalizado`). */
  readonly termos?: readonly string[]
  /** Overrides a esquecer, pelo carimbo exato de `override_em`. */
  readonly overridesEm?: readonly string[]
}

/** Quantas linhas saíram, por tabela. Só as tabelas tocadas aparecem. */
export type ResultadoLimpeza = Readonly<Record<string, number>>

function marcadores(n: number): string {
  return Array.from({ length: n }, () => '?').join(', ')
}

/**
 * Apaga o que a lista nomeia, e nada além.
 *
 * ⚠️ **A conversa de um chamado descartado entra na conta automaticamente.** Apagar o vínculo
 * e deixar a conversa produziria o pior estado: a conversa continua nas estatísticas de
 * deflexão como uma que **não** virou chamado, o que é o oposto do que aconteceu. Quem lista
 * chamado lista a conversa dele — e o contrário não vale, porque conversa sem chamado é um
 * fato legítimo por si.
 *
 * ⚠️ **`anexos_conteudo` é apagada por subconsulta**, antes de `anexos_pendentes`: ela é
 * chaveada pelo id do anexo, não pela conversa, então apagar a pendência primeiro deixaria os
 * bytes órfãos para sempre — e são fatias de até 8 MB.
 */
export async function descartar(db: Banco, alvo: AlvoDeLimpeza): Promise<ResultadoLimpeza> {
  const chaves = [...new Set(alvo.issueKeys ?? [])]
  const termos = [...new Set(alvo.termos ?? [])]
  const overrides = [...new Set(alvo.overridesEm ?? [])]

  // A conversa que gerou um chamado descartado vai junto — ver a nota acima.
  const conversas = new Set(alvo.conversaIds ?? [])
  if (chaves.length > 0) {
    const r = await db.query(
      `SELECT conversa_id FROM vinculos WHERE issue_key IN (${marcadores(chaves.length)})
         AND conversa_id IS NOT NULL`,
      [...chaves],
    )
    for (const l of linhasComoObjetos<{ conversa_id: string }>(r)) conversas.add(l.conversa_id)
  }
  const ids = [...conversas]

  const resultado: Record<string, number> = {}
  const apagar = async (tabela: string, sql: string, params: unknown[]): Promise<void> => {
    const antes = await db.query(
      `SELECT COUNT(*) AS n FROM ${tabela} WHERE ${sql}`,
      params as never[],
    )
    const n = Number(primeiraLinha<{ n: number }>(antes)?.n ?? 0)
    if (n === 0) return
    await db.exec(`DELETE FROM ${tabela} WHERE ${sql}`, params as never[])
    resultado[tabela] = (resultado[tabela] ?? 0) + n
  }

  if (chaves.length > 0) {
    const m = marcadores(chaves.length)
    const p = [...chaves]
    for (const tabela of [
      'vinculos',
      'submissoes',
      'classificacoes_ticket',
      'notificacoes',
      'acoes_proprias',
      'alertas_sla',
      'avaliacoes_sla',
      'anexos_enviados',
    ]) {
      await apagar(tabela, `issue_key IN (${m})`, p)
    }
  }

  if (ids.length > 0) {
    const m = marcadores(ids.length)
    const p = [...ids]
    // Os bytes primeiro: `anexos_conteudo` só é alcançável pelo id da pendência.
    await apagar(
      'anexos_conteudo',
      `anexo_id IN (SELECT id FROM anexos_pendentes WHERE conversa_id IN (${m}))`,
      p,
    )
    for (const tabela of [
      'mensagens',
      'bloqueios',
      'anexos_pendentes',
      'analises_anexo',
      'investigador_eventos',
      'investigador_requisicoes',
    ]) {
      await apagar(tabela, `conversa_id IN (${m})`, p)
    }
    await apagar('conversas', `id IN (${m})`, p)
  }

  if (termos.length > 0) {
    await apagar('buscas', `termo_normalizado IN (${marcadores(termos.length)})`, [...termos])
  }

  if (overrides.length > 0) {
    await apagar('bloqueios', `override_em IN (${marcadores(overrides.length)})`, [...overrides])
  }

  return resultado
}
