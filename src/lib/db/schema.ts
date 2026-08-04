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
] as const

export async function migrar(db: Banco): Promise<void> {
  for (const sql of TABELAS) {
    await db.exec(sql, [])
  }
}
