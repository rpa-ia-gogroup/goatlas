/**
 * Configuração em banco — RF-49, RF-50, RNF-25.
 *
 * Thresholds, allowlists e TTLs mudam SEM DEPLOY. É também o que impede o
 * hardcode de IDs proibido por RNF-25.
 *
 * ⚠️ **Os defaults são NEGAÇÃO POR PADRÃO** (RNF-07, RN-06). Toda allowlist nasce
 * VAZIA: com o banco recém-criado, nenhum espaço do Confluence é exposto, nenhum
 * tipo de chamado é oferecido e ninguém é admin. Um default "permissivo para
 * facilitar o desenvolvimento" aqui seria uma porta aberta em produção no dia em
 * que alguém esquecesse de configurar — e o requisito é explícito: nada exposto
 * por padrão.
 *
 * A única exceção deliberada é `dominios_permitidos`, cujo default é vazio e
 * significa **negar todo mundo** — ver `auth/`, que trata lista vazia como
 * "acesso negado", não como "libera todos".
 */

import type { Banco } from '../db/tipos'
import { linhasComoObjetos } from '../db/tipos'

export interface ConfigValores {
  /** Q7. Lista vazia = ninguém entra (fail-closed), nunca "todos entram". */
  dominios_permitidos: string[]
  /** RF-02, RN-09 — admin nunca é inferido, só concedido por lista explícita. */
  admins: string[]

  /** RF-38 — allowlist de espaços do Confluence. Q5. */
  espacos_confluence: string[]
  /** RF-38 — label que bloqueia a página mesmo em espaço liberado. */
  labels_bloqueadas: string[]
  /** RF-28 — tipos de chamado oferecidos. Nada exposto por padrão. */
  tipos_chamado_permitidos: string[]
  /** RNF-25 — service desk alvo, nunca hardcoded. Q1. */
  service_desk_id: string | null

  /** RF-09 — score acima disto bloqueia pela Regra 1. Começa conservador (R-04). */
  regra1_threshold_score: number
  /** RF-11 — quantos "ajuste operacional" recorrentes bloqueiam. Sugestão: 3. */
  regra2_threshold_recorrencia: number
  /** RF-11 — janela da recorrência em dias. Sugestão: 90. */
  regra2_janela_dias: number
  /** RF-11, Q2 — qual campo do Jira delimita "mesmo tipo". */
  regra2_campo_agrupamento: string
  /** RF-14, Q3 — exemplos REAIS da Gocase. Vazio = Regra 2 não roda (ver rules/). */
  regra2_exemplos_ajuste_operacional: string[]
  /** R-08 — limita quantos tickets a Regra 2 lê por conversa. */
  regra2_limite_tickets: number

  /** RNF-13 — TTL de cache. */
  ttl_metadados_seg: number
  ttl_conteudo_seg: number
  /** RNF-11 — rate limit por usuário. */
  limite_requisicoes_por_minuto: number
  /** RNF-16 — teto de custo de IA por conversa, em USD. */
  teto_custo_conversa_usd: number
}

export const CONFIG_PADRAO: Readonly<ConfigValores> = Object.freeze({
  dominios_permitidos: [],
  admins: [],
  espacos_confluence: [],
  labels_bloqueadas: ['confidencial'],
  tipos_chamado_permitidos: [],
  service_desk_id: null,
  regra1_threshold_score: 0.75,
  regra2_threshold_recorrencia: 3,
  regra2_janela_dias: 90,
  regra2_campo_agrupamento: 'labels',
  regra2_exemplos_ajuste_operacional: [],
  regra2_limite_tickets: 20,
  ttl_metadados_seg: 900,
  ttl_conteudo_seg: 300,
  limite_requisicoes_por_minuto: 30,
  teto_custo_conversa_usd: 0.5,
})

export type ChaveConfig = keyof ConfigValores

/**
 * Bootstrap por env — resolve o problema do primeiro boot.
 *
 * Como TODA allowlist nasce vazia e vazio significa negar (`RNF-07`), um app
 * recém-deployado nega **todo mundo**, inclusive quem precisaria entrar para
 * configurá-lo. Ovo e galinha.
 *
 * A saída é o mesmo padrão do godocs: env como **bootstrap**, banco como fonte
 * corrente. O env só vale enquanto a chave **não existe** no banco — no instante
 * em que um admin salva pelo console, o banco manda e o env vira irrelevante
 * (`RF-49`: mudança sem deploy).
 *
 * ⚠️ Isto **não** afrouxa o fail-closed: env vazio **e** banco vazio continua
 * negando. O bootstrap dá um caminho de entrada, não uma porta aberta.
 */
export interface BootstrapEnv {
  /** Lista separada por vírgula. Ex.: `gocase.com,gobeaute.com.br` (Q7). */
  readonly GOATLAS_DOMINIOS?: string
  /** Lista separada por vírgula de e-mails admin (RF-02, RN-09). */
  readonly GOATLAS_ADMINS?: string
  readonly GOATLAS_SERVICE_DESK_ID?: string
  readonly GOATLAS_TIPOS_CHAMADO?: string
  readonly GOATLAS_ESPACOS_CONFLUENCE?: string
}

function lista(bruto: string | undefined): string[] {
  return (bruto ?? '')
    .split(',')
    .map((v) => v.trim().toLowerCase())
    .filter((v) => v.length > 0)
}

export function valoresDoBootstrap(env: BootstrapEnv): Partial<ConfigValores> {
  const parcial: Partial<ConfigValores> = {}
  const dominios = lista(env.GOATLAS_DOMINIOS)
  if (dominios.length > 0) parcial.dominios_permitidos = dominios
  const admins = lista(env.GOATLAS_ADMINS)
  if (admins.length > 0) parcial.admins = admins
  const tipos = lista(env.GOATLAS_TIPOS_CHAMADO)
  if (tipos.length > 0) parcial.tipos_chamado_permitidos = tipos
  const espacos = (env.GOATLAS_ESPACOS_CONFLUENCE ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter((v) => v.length > 0)
  if (espacos.length > 0) parcial.espacos_confluence = espacos
  if (env.GOATLAS_SERVICE_DESK_ID) parcial.service_desk_id = env.GOATLAS_SERVICE_DESK_ID
  return parcial
}

export class Config {
  private cache: ConfigValores | null = null

  constructor(
    private readonly db: Banco,
    /** Bootstrap do primeiro boot. O banco, quando tem valor, sempre vence. */
    private readonly bootstrap: Partial<ConfigValores> = {},
  ) {}

  async carregar(): Promise<ConfigValores> {
    if (this.cache) return this.cache
    const r = await this.db.query('SELECT chave, valor_json FROM config', [])
    const linhas = linhasComoObjetos<{ chave: string; valor_json: string }>(r)
    // Ordem que importa: padrão (fail-closed) → bootstrap do env → BANCO.
    const valores: ConfigValores = { ...CONFIG_PADRAO, ...this.bootstrap }
    for (const linha of linhas) {
      if (!(linha.chave in CONFIG_PADRAO)) continue
      try {
        // Chave conhecida e JSON válido: confia no tipo gravado por definir().
        ;(valores as unknown as Record<string, unknown>)[linha.chave] = JSON.parse(
          linha.valor_json,
        )
      } catch {
        // JSON corrompido cai no default — que é fail-closed. Nunca derruba o boot.
      }
    }
    this.cache = valores
    return valores
  }

  async obter<K extends ChaveConfig>(chave: K): Promise<ConfigValores[K]> {
    return (await this.carregar())[chave]
  }

  async definir<K extends ChaveConfig>(
    chave: K,
    valor: ConfigValores[K],
    atorEmail: string,
    agora: string,
  ): Promise<void> {
    await this.db.exec(
      `INSERT INTO config (chave, valor_json, atualizado_em, atualizado_por)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (chave) DO UPDATE SET
         valor_json = excluded.valor_json,
         atualizado_em = excluded.atualizado_em,
         atualizado_por = excluded.atualizado_por`,
      [chave, JSON.stringify(valor), agora, atorEmail],
    )
    this.invalidar()
  }

  invalidar(): void {
    this.cache = null
  }
}
