/**
 * Schema do goatlas. Idempotente (`CREATE TABLE IF NOT EXISTS`) — roda a cada
 * boot; `env.DB` é persistente entre deploys.
 *
 * Decisão de desenho: as invariantes críticas vivem no SCHEMA, não na aplicação.
 * Código com bug pode criar chamado duplicado; `UNIQUE` não pode.
 *   - `vinculos.issue_key UNIQUE`         → RN-03 (um chamado, um solicitante)
 *   - `submissoes.chave_idempotencia UNIQUE` → RF-24 (duplo clique não duplica)
 *   - `classificacoes_ticket` PK composta → cache da Regra 2 (R-08)
 */

import type { Banco } from './tipos'

export const TABELAS = [
  /**
   * O artefato mais crítico do sistema (RF-22, RNF-17). É o que permite
   * acompanhar chamado sem conta Atlassian, e é a base do isolamento (RF-30):
   * sem vínculo, sem acesso (RN-04).
   */
  `CREATE TABLE IF NOT EXISTS vinculos (
     issue_key           TEXT PRIMARY KEY,
     solicitante_email   TEXT NOT NULL,
     conversa_id         TEXT,
     via                 TEXT NOT NULL DEFAULT 'conversa',
     verificado_regras   INTEGER NOT NULL DEFAULT 1,
     criado_em           TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_vinculos_email ON vinculos (solicitante_email)`,

  /**
   * Outbox (RNF-17). A submissão é persistida ANTES da chamada à Atlassian e
   * reprocessada por cron. Perder o chamado de alguém destrói a confiança no app
   * de uma vez — try/catch não resolve isso num Worker sem processo longo.
   */
  `CREATE TABLE IF NOT EXISTS submissoes (
     id                   TEXT PRIMARY KEY,
     chave_idempotencia   TEXT NOT NULL UNIQUE,
     solicitante_email    TEXT NOT NULL,
     conversa_id          TEXT,
     via                  TEXT NOT NULL DEFAULT 'conversa',
     verificado_regras    INTEGER NOT NULL DEFAULT 1,
     payload_json         TEXT NOT NULL,
     estado               TEXT NOT NULL DEFAULT 'pendente',
     tentativas           INTEGER NOT NULL DEFAULT 0,
     ultimo_erro          TEXT,
     issue_key            TEXT,
     criado_em            TEXT NOT NULL,
     atualizado_em        TEXT NOT NULL,
     CHECK (estado IN ('pendente', 'criado', 'falha'))
   )`,
  `CREATE INDEX IF NOT EXISTS idx_submissoes_estado ON submissoes (estado, criado_em)`,

  /**
   * Estado do orquestrador (RF-08). Mora no BANCO, não na memória do Worker:
   * Worker é stateless, e estado em memória significa que basta abrir outra
   * requisição para burlar a ordem das tools.
   */
  `CREATE TABLE IF NOT EXISTS conversas (
     id                     TEXT PRIMARY KEY,
     solicitante_email      TEXT NOT NULL,
     estado                 TEXT NOT NULL DEFAULT 'coletando',
     confluence_verificado  INTEGER NOT NULL DEFAULT 0,
     historico_verificado   INTEGER NOT NULL DEFAULT 0,
     confluence_falhou      INTEGER NOT NULL DEFAULT 0,
     historico_falhou       INTEGER NOT NULL DEFAULT 0,
     confirmado_em          TEXT,
     proposta_json          TEXT,
     custo_usd              REAL NOT NULL DEFAULT 0,
     criado_em              TEXT NOT NULL,
     atualizado_em          TEXT NOT NULL,
     CHECK (estado IN ('coletando', 'bloqueado', 'aguardando_confirmacao', 'criado', 'encerrado'))
   )`,
  `CREATE INDEX IF NOT EXISTS idx_conversas_email ON conversas (solicitante_email, criado_em)`,

  `CREATE TABLE IF NOT EXISTS mensagens (
     id           TEXT PRIMARY KEY,
     conversa_id  TEXT NOT NULL,
     papel        TEXT NOT NULL,
     conteudo     TEXT NOT NULL,
     tool_nome    TEXT,
     criado_em    TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_mensagens_conversa ON mensagens (conversa_id, criado_em)`,

  /**
   * Bloqueios e overrides (RF-13). Alimenta a taxa de deflexão (O1), a taxa de
   * override (R-04) e o backlog de documentação (RF-42) — override é sinal de
   * documentação ruim, não de usuário teimoso.
   */
  `CREATE TABLE IF NOT EXISTS bloqueios (
     id             TEXT PRIMARY KEY,
     conversa_id    TEXT NOT NULL,
     regra          TEXT NOT NULL,
     motivo         TEXT NOT NULL,
     evidencia_json TEXT,
     houve_override INTEGER NOT NULL DEFAULT 0,
     override_em    TEXT,
     override_motivo TEXT,
     criado_em      TEXT NOT NULL,
     CHECK (regra IN ('regra1_confluence', 'regra2_ajuste_operacional'))
   )`,
  `CREATE INDEX IF NOT EXISTS idx_bloqueios_conversa ON bloqueios (conversa_id)`,

  /**
   * Cache de classificação da Regra 2 (R-08, RNF-16). Reclassificar o mesmo
   * ticket com o mesmo comentário é desperdício puro, e o custo da IA escala com
   * volume de tickets, não com número de usuários.
   */
  `CREATE TABLE IF NOT EXISTS classificacoes_ticket (
     issue_key       TEXT NOT NULL,
     hash_comentario TEXT NOT NULL,
     classe          TEXT NOT NULL,
     justificativa   TEXT,
     criado_em       TEXT NOT NULL,
     PRIMARY KEY (issue_key, hash_comentario)
   )`,

  /**
   * Auditoria append-only (RF-58, RN-10). Nenhum UPDATE ou DELETE nesta tabela
   * em código algum. Registra também as ações que FALHAM.
   */
  `CREATE TABLE IF NOT EXISTS auditoria (
     id            TEXT PRIMARY KEY,
     ator_email    TEXT NOT NULL,
     acao          TEXT NOT NULL,
     recurso       TEXT,
     resultado     TEXT NOT NULL,
     detalhe_json  TEXT,
     criado_em     TEXT NOT NULL,
     CHECK (resultado IN ('sucesso', 'falha', 'negado'))
   )`,
  `CREATE INDEX IF NOT EXISTS idx_auditoria_ator ON auditoria (ator_email, criado_em)`,
  `CREATE INDEX IF NOT EXISTS idx_auditoria_acao ON auditoria (acao, criado_em)`,

  /**
   * Buscas na documentação (RF-42, T-116) — o insumo do mapa de lacunas e de `O6`.
   *
   * ⚠️ `houve_clique` é o campo que faz a diferença entre "não existe documentação"
   * e "existe e não convence". Sem ele, o mapa só veria busca vazia — e o caso mais
   * interessante (a página apareceu, a pessoa leu o título e foi abrir chamado) ficaria
   * invisível.
   *
   * `termo_normalizado` existe para agrupar: "política" e "politica" são a mesma
   * pergunta, e agrupar no `SELECT` com função de normalização impediria o índice.
   */
  `CREATE TABLE IF NOT EXISTS buscas (
     id                TEXT PRIMARY KEY,
     solicitante_email TEXT NOT NULL,
     termo             TEXT NOT NULL,
     termo_normalizado TEXT NOT NULL,
     resultados        INTEGER NOT NULL,
     houve_clique      INTEGER NOT NULL DEFAULT 0,
     criado_em         TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_buscas_termo ON buscas (termo_normalizado, criado_em)`,
  `CREATE INDEX IF NOT EXISTS idx_buscas_solicitante ON buscas (solicitante_email, criado_em)`,

  /**
   * Páginas lidas (RF-58, T-116) — quem leu o quê e por qual caminho.
   *
   * É o que mede `O6` (uso da documentação por quem **não tem assento**) e o que
   * permite dizer se a busca resolveu. `via` é derivado no servidor, não recebido do
   * cliente: `busca` só quando o `?de=` aponta para uma busca **daquela pessoa**.
   */
  `CREATE TABLE IF NOT EXISTS paginas_lidas (
     id                TEXT PRIMARY KEY,
     solicitante_email TEXT NOT NULL,
     pagina_id         TEXT NOT NULL,
     titulo            TEXT NOT NULL,
     espaco            TEXT NOT NULL,
     via               TEXT NOT NULL,
     criado_em         TEXT NOT NULL,
     CHECK (via IN ('busca', 'direto'))
   )`,
  `CREATE INDEX IF NOT EXISTS idx_paginas_lidas_pagina ON paginas_lidas (pagina_id, criado_em)`,

  /**
   * Configuração em banco (RF-49, RF-50) — thresholds, allowlists e TTLs mudam
   * SEM DEPLOY. É também o que impede o hardcode de IDs proibido por RNF-25.
   */
  `CREATE TABLE IF NOT EXISTS config (
     chave         TEXT PRIMARY KEY,
     valor_json    TEXT NOT NULL,
     atualizado_em TEXT NOT NULL,
     atualizado_por TEXT
   )`,

  /**
   * Cache histórico do inventário de assentos (RF-51, RF-52, T-124). Uma linha por
   * (conta × produto atribuído) A CADA coleta — nunca `UPDATE` — porque o
   * histórico é o que torna o assento ocioso um dado que se acompanha ao longo do
   * tempo (O2, O7), não um retrato único. A Organizations API é lenta demais para
   * consulta interativa; por isso o console lê o CACHE (`MAX(coletado_em)`), nunca
   * a API ao vivo.
   */
  `CREATE TABLE IF NOT EXISTS inventario_assentos (
     id                TEXT PRIMARY KEY,
     account_id        TEXT NOT NULL,
     email             TEXT NOT NULL,
     nome              TEXT NOT NULL,
     produto           TEXT NOT NULL,
     ultimo_acesso_em  TEXT,
     coletado_em       TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_inventario_assentos_coletado ON inventario_assentos (coletado_em)`,
  `CREATE INDEX IF NOT EXISTS idx_inventario_assentos_conta ON inventario_assentos (account_id, produto, coletado_em)`,

  /**
   * Notificações (RF-44, RF-47, T-204).
   *
   * ⚠️ **A dedupe é do BANCO, não da aplicação.** Duas fontes independentes detectam
   * a mesma mudança de propósito (webhook + polling, RF-47: notificação não pode
   * depender de mecanismo único), e as duas chegam a instantes diferentes. Um
   * `SELECT` antes do `INSERT` tem a mesma janela de corrida do outbox — os dois
   * caminhos passam pelo `SELECT` e a pessoa recebe o aviso duas vezes.
   *
   * `carimbo_mudanca` é o carimbo **do Jira** (`updated`/`created` do evento), nunca
   * `agora()`: relógio nosso produziria chaves diferentes para o mesmo fato, e a
   * dedupe não deduparia nada.
   */
  `CREATE TABLE IF NOT EXISTS notificacoes (
     id                  TEXT PRIMARY KEY,
     issue_key           TEXT NOT NULL,
     destinatario_email  TEXT NOT NULL,
     tipo_evento         TEXT NOT NULL,
     carimbo_mudanca     TEXT NOT NULL,
     fonte               TEXT NOT NULL,
     canal               TEXT,
     destino             TEXT,
     titulo              TEXT NOT NULL,
     corpo               TEXT NOT NULL,
     estado              TEXT NOT NULL DEFAULT 'pendente',
     tentativas          INTEGER NOT NULL DEFAULT 0,
     ultimo_erro         TEXT,
     criado_em           TEXT NOT NULL,
     atualizado_em       TEXT NOT NULL,
     UNIQUE (issue_key, tipo_evento, carimbo_mudanca),
     CHECK (estado IN ('pendente', 'enviada', 'falha', 'suprimida')),
     CHECK (fonte IN ('webhook', 'polling', 'app')),
     CHECK (tipo_evento IN ('chamado_criado', 'status_alterado', 'comentario_publico', 'sla_em_risco'))
   )`,
  `CREATE INDEX IF NOT EXISTS idx_notificacoes_estado ON notificacoes (estado, criado_em)`,
  `CREATE INDEX IF NOT EXISTS idx_notificacoes_destinatario ON notificacoes (destinatario_email, criado_em)`,

  /**
   * Ações do próprio solicitante (RF-48, T-211).
   *
   * ⚠️ Comparar autor **não funciona** aqui: sob proxy total (`D-01`) todo comentário
   * sai da conta de serviço, então o autor do comentário da pessoa e o do agente do
   * time de tech são o mesmo. O que distingue é o app ter registrado a ação **no
   * momento em que a fez** — daí a impressão digital do corpo normalizado.
   */
  `CREATE TABLE IF NOT EXISTS acoes_proprias (
     id                 TEXT PRIMARY KEY,
     issue_key          TEXT NOT NULL,
     ator_email         TEXT NOT NULL,
     tipo_evento        TEXT NOT NULL,
     impressao_digital  TEXT NOT NULL,
     criado_em          TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_acoes_proprias_busca
     ON acoes_proprias (issue_key, tipo_evento, impressao_digital)`,

  /**
   * Preferência de canal (RF-45). Ausência de linha = o default de Q11, resolvido em
   * `notificacoes/preferencias.ts` — não um canal inventado por linha faltante.
   */
  `CREATE TABLE IF NOT EXISTS preferencias_notificacao (
     email          TEXT PRIMARY KEY,
     canal          TEXT NOT NULL,
     destino        TEXT,
     atualizado_em  TEXT NOT NULL,
     CHECK (canal IN ('chat', 'email', 'nenhum'))
   )`,

  /**
   * Marca-d'água do polling (RF-47, RNF-15). Uma linha, chave fixa.
   *
   * ⚠️ Sem marca-d'água o polling vira **varredura completa** a cada rodada — a forma
   * mais fácil de descobrir os burst limits não publicados da Atlassian do jeito ruim
   * (`R-02`). O JQL é sempre `updated >= <marca>`.
   */
  `CREATE TABLE IF NOT EXISTS marca_agua_polling (
     chave          TEXT PRIMARY KEY,
     carimbo        TEXT NOT NULL,
     atualizado_em  TEXT NOT NULL
   )`,

  /**
   * Alertas de SLA já emitidos (RF-46, T-231). PK composta porque o cron roda de novo
   * a cada janela: sem ela, o mesmo chamado em risco geraria alerta a cada rodada até
   * alguém responder — o jeito garantido de o alerta ser ignorado.
   */
  `CREATE TABLE IF NOT EXISTS alertas_sla (
     issue_key   TEXT NOT NULL,
     limiar      TEXT NOT NULL,
     criado_em   TEXT NOT NULL,
     PRIMARY KEY (issue_key, limiar),
     CHECK (limiar IN ('risco', 'estourado'))
   )`,

  /**
   * Última avaliação de SLA por chamado (RF-46, RF-55, T-232).
   *
   * ⚠️ Existe para o **painel não chamar a Atlassian**. Saber se um chamado teve primeira
   * resposta dentro do prazo exige ler os comentários dele; fazer isso para cada chamado
   * no `GET /api/admin/metricas` transformaria abrir o console em dezenas de chamadas com
   * a credencial única (`R-02`) — e a página ficaria lenta na proporção do sucesso do
   * projeto.
   *
   * O cron de SLA já lê tudo isso para decidir se alerta. Gravar o resultado é grátis, e
   * o painel passa a mostrar "avaliado na última rodada" em vez de "medido agora" —
   * honesto e barato. `UPSERT` porque é um retrato, não histórico: o histórico de eventos
   * está em `notificacoes` e `auditoria`.
   */
  `CREATE TABLE IF NOT EXISTS avaliacoes_sla (
     issue_key       TEXT PRIMARY KEY,
     estado          TEXT NOT NULL,
     prazo_em        TEXT NOT NULL,
     respondida_em   TEXT,
     dentro_do_prazo INTEGER,
     avaliado_em     TEXT NOT NULL,
     CHECK (estado IN ('respondido', 'ok', 'risco', 'estourado'))
   )`,
] as const

/**
 * Colunas acrescentadas a tabelas que já existem em produção.
 *
 * `CREATE TABLE IF NOT EXISTS` não altera tabela existente: `env.DB` é persistente
 * entre deploys, então a tabela criada na Fase 1 continua sem a coluna nova. Cada
 * `ALTER` roda uma vez e falha nas seguintes com "duplicate column" — engolir **só**
 * esse erro é o que torna a migração idempotente sem tabela de versão.
 */
const COLUNAS_ADICIONADAS = [
  // T-304 / RF-19 — a área **no momento da criação** é o dado histórico correto,
  // mesmo que a pessoa mude de área depois.
  `ALTER TABLE vinculos ADD COLUMN area TEXT`,
  // T-210 — o carimbo da última mudança já sincronizada, por chamado. A marca-d'água
  // global diz o que **buscar**; esta coluna diz o que já foi visto naquele chamado.
  `ALTER TABLE vinculos ADD COLUMN notificado_ate TEXT`,
  /**
   * T-210 — o último status já avisado.
   *
   * ⚠️ Sem esta coluna, "mudou de status" viraria "`updated` do Jira mudou" — e
   * `updated` muda quando alguém edita a descrição, adiciona label ou mexe num campo
   * qualquer. A pessoa receberia "seu chamado mudou para Em andamento" três vezes
   * porque o agente ajustou o resumo três vezes.
   */
  `ALTER TABLE vinculos ADD COLUMN ultimo_status_notificado TEXT`,
  /**
   * T-403 / RF-62 — a declaração de anexo, verificável no servidor.
   *
   * ⚠️ **Três estados, e o terceiro é o que dá valor aos outros dois:** `1` tenho ·
   * `0` não tenho · `NULL` **não respondeu** (ou não havia o que responder, porque o
   * tipo de chamado não aceita anexo). Um `NOT NULL DEFAULT 0` aqui apagaria a
   * distinção que a spec §1 existe para criar: chamado de quem declarou não ter
   * material é informação sobre o caso; chamado de quem nunca foi perguntado é
   * omissão. Com default, os dois viram "disse que não tinha".
   */
  `ALTER TABLE submissoes ADD COLUMN declarou_anexo INTEGER`,
] as const

export async function migrar(db: Banco): Promise<void> {
  for (const sql of TABELAS) {
    await db.exec(sql, [])
  }
  for (const sql of COLUNAS_ADICIONADAS) {
    try {
      await db.exec(sql, [])
    } catch (e) {
      // Só "coluna já existe" é esperado. Qualquer outro erro de DDL é bug de schema
      // e precisa subir — engolir tudo transformaria uma migração quebrada em app
      // que roda pela metade.
      if (!/duplicate column|already exists/i.test(e instanceof Error ? e.message : String(e))) {
        throw e
      }
    }
  }
}
