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
  /**
   * RF-21, R-03 — id do campo customizado "Solicitante" no Jira, ex.:
   * `customfield_10050`. `null` = ainda não sabemos (Q4): o solicitante real
   * segue indo só na descrição (cinto e suspensório, ver
   * `atlassian/cliente.ts#montarCamposSolicitante`) — nunca vazio nem inventado.
   */
  campo_solicitante_id: string | null

  /** RNF-25 — organização Atlassian alvo da Organizations API (governança de
   * assentos). Q1: a credencial de Org Admin ainda não existe. */
  org_id: string | null
  /** RF-53 — "ocioso" é último acesso há N dias, N configurável. */
  assentos_ocioso_dias: number
  /** RF-53 — custo mensal (USD) por chave de produto. Vazio = Q8 em aberto: o
   * console mostra contagem, nunca dinheiro inventado. */
  custo_mensal_por_produto: Record<string, number>
  /**
   * T-134 — curva de preço por faixa, por produto. Vazio = sem curva, e aí a economia de
   * assento ocioso é tratada como **teto** (`economiaConfiavel: false`), não estimativa.
   *
   * ⚠️ Existe porque o preço do JSM é **escalonado**: cortar assento pode subir o preço
   * unitário dos que ficam, e `ociosos × preço` superestima a economia. Ver `D-23`.
   * Formato: `{ "jira-servicedesk": [{ "ate": 100, "precoUnitarioUsd": 9.05 }, …] }` —
   * `ate: null` na última faixa significa "daí para cima".
   */
  curva_preco_por_produto: Record<string, { ate: number | null; precoUnitarioUsd: number }[]>

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

  // --- Fase 3: notificações, SLA e métricas (spec 003) ----------------------
  /**
   * RF-45, Q11 — canal padrão de notificação. `null` = **Q11 não respondida**.
   *
   * ⚠️ Neste estado a notificação é registrada e **suprimida**, não descartada: o
   * console mostra "havia 40 avisos a dar e nenhum canal definido", e no dia da resposta
   * de Q11 basta preencher este campo (`RF-49`, sem deploy). O default **não** é
   * "e-mail para o corporativo": notificação não pedida em canal não combinado é o
   * começo do treinamento para ignorar as notificações do app.
   */
  canal_notificacao_padrao: 'chat' | 'email' | 'nenhum' | null
  /** RF-45, Q11 — webhook do espaço no Google Chat. Vazio = canal de chat indisponível. */
  chat_webhook_url: string | null
  /** RF-45, Q11 — endpoint HTTP do provedor de e-mail (Workers não têm SMTP). */
  email_endpoint: string | null
  email_remetente: string | null
  /**
   * Base pública do app, para o link nas notificações. `null` = mensagem sem link.
   *
   * Não é derivável no cron: lá não existe `Request` de onde tirar o host. E linkar
   * `atlassian.net` derrubaria o clique de quem não tem assento — o mesmo raciocínio da
   * deflexão em `rules/`.
   */
  base_publica_app: string | null
  /**
   * RF-46 — fração do prazo a partir da qual o SLA de **primeira resposta** entra em
   * risco. `0.75` = avisa aos 75%. Configurável porque o número certo só aparece com o
   * volume real da fila (Fase 4).
   */
  sla_fracao_aviso: number

  // --- Fase 4: piloto e rollout (spec 004) ---------------------------------
  /**
   * R-06, Q13 — e-mails do piloto. **Vazio tem significado especial aqui:** vazio =
   * piloto desligado, todo mundo pode abrir chamado (o comportamento das Fases 1-3).
   *
   * ⚠️ É a única allowlist do projeto cujo vazio NÃO nega. E é deliberado: as outras
   * governam **exposição de conteúdo** (`RNF-07`), onde vazio-nega evita vazamento;
   * esta governa **quem pode pedir ajuda**, onde vazio-nega significaria que um deploy
   * antes de alguém preencher a lista tranca a empresa inteira fora do canal de
   * suporte. O fail-closed correto para esta lista é o oposto do das outras.
   */
  emails_piloto: string[]
  /** RF-19, T-303 — mapa `e-mail → área`. Fora do mapa = **sem área**, nunca chutada. */
  areas_por_email: Record<string, string>
  /**
   * O2, T-311 — retrato de assentos antes do projeto, para o antes × depois.
   * `null` = Fase 0 não rodou; a tela mostra "sem baseline", nunca um número inventado.
   */
  baseline_assentos: { readonly coletadoEm: string; readonly porProduto: Record<string, number> } | null
  /**
   * RNF-33, T-243 — retenção em dias por tipo de dado. `null` = **guardar**.
   *
   * O default é guardar (e não um número "seguro") porque apagar vínculo é apagar o
   * acesso da pessoa ao próprio chamado (`RF-30`): a retenção precisa ser uma decisão
   * tomada, não um efeito colateral de um default. `conversas` e `auditoria` podem ser
   * expurgadas sem esse dano — e a auditoria tem piso próprio, ver `retencao.ts`.
   */
  retencao_conversas_dias: number | null
  retencao_auditoria_dias: number | null
  retencao_notificacoes_dias: number | null

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
  campo_solicitante_id: null,
  org_id: null,
  assentos_ocioso_dias: 90,
  custo_mensal_por_produto: {},
  curva_preco_por_produto: {},
  regra1_threshold_score: 0.75,
  regra2_threshold_recorrencia: 3,
  regra2_janela_dias: 90,
  regra2_campo_agrupamento: 'labels',
  regra2_exemplos_ajuste_operacional: [],
  regra2_limite_tickets: 20,
  canal_notificacao_padrao: null,
  chat_webhook_url: null,
  email_endpoint: null,
  email_remetente: null,
  base_publica_app: null,
  sla_fracao_aviso: 0.75,
  // Vazio = piloto DESLIGADO (ver o comentário do campo — é a exceção deliberada).
  emails_piloto: [],
  areas_por_email: {},
  baseline_assentos: null,
  retencao_conversas_dias: null,
  retencao_auditoria_dias: null,
  retencao_notificacoes_dias: null,
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
  readonly GOATLAS_CAMPO_SOLICITANTE_ID?: string
  readonly GOATLAS_TIPOS_CHAMADO?: string
  readonly GOATLAS_ESPACOS_CONFLUENCE?: string
  readonly GOATLAS_ORG_ID?: string
  /**
   * Endereço público do app, para o link das notificações (`D-20`).
   *
   * É env, não valor derivado: o cron não tem `Request` de onde tirar o host, e é lá que a
   * maioria das notificações nasce. E é por ambiente — staging e produção têm hosts
   * diferentes, então hardcodar um deles quebraria o outro em silêncio.
   */
  readonly GOATLAS_BASE_PUBLICA?: string
  /**
   * Canal de aviso padrão — `chat`, `email` ou `nenhum` (`D-20`, Q11).
   *
   * ⚠️ Aqui a diferença entre **ausente** e **`nenhum`** é a decisão, não o efeito: os dois
   * não enviam nada. Ausente = ninguém decidiu (a tela diz isso); `nenhum` = alguém decidiu
   * que o aviso vive na aba Avisos. Ver `notificacoes/preferencias.ts`.
   */
  readonly GOATLAS_CANAL_NOTIFICACAO?: string
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
  if (env.GOATLAS_CAMPO_SOLICITANTE_ID) {
    parcial.campo_solicitante_id = env.GOATLAS_CAMPO_SOLICITANTE_ID
  }
  if (env.GOATLAS_ORG_ID) parcial.org_id = env.GOATLAS_ORG_ID
  if (env.GOATLAS_BASE_PUBLICA) {
    // Barra final removida aqui pelo mesmo motivo de `LLM_BASE_URL`: quem copia URL do
    // navegador copia com barra, e `linkDoChamado` já concatena.
    parcial.base_publica_app = env.GOATLAS_BASE_PUBLICA.trim().replace(/\/+$/, '')
  }
  const canal = (env.GOATLAS_CANAL_NOTIFICACAO ?? '').trim().toLowerCase()
  // Valor desconhecido é **ignorado**, não corrigido para um canal qualquer: um typo
  // (`e-mail`, `emails`) que virasse `email` mandaria aviso por um caminho que ninguém
  // pediu. Ignorar deixa o estado em "ninguém decidiu", que é visível na tela.
  if (canal === 'chat' || canal === 'email' || canal === 'nenhum') {
    parcial.canal_notificacao_padrao = canal
  }
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
