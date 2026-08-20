/**
 * Schema do atlas. Idempotente (`CREATE TABLE IF NOT EXISTS`); `env.DB` é
 * persistente entre deploys.
 *
 * Decisão de desenho: as invariantes críticas vivem no SCHEMA, não na aplicação.
 * Código com bug pode criar chamado duplicado; `UNIQUE` não pode.
 *   - `vinculos.issue_key UNIQUE`         → RN-03 (um chamado, um solicitante)
 *   - `submissoes.chave_idempotencia UNIQUE` → RF-24 (duplo clique não duplica)
 *   - `classificacoes_ticket` PK composta → cache da Regra 2 (R-08)
 *
 * ⚠️ **Idempotente não quer dizer grátis** (`RNF-36`, `D-35`, T-135). `migrar` roda
 * dentro de `montarContexto`, que roda a CADA requisição `/api/*` — e cada `db.exec`
 * do GoDeploy é uma ida e volta assíncrona. Aplicar os 32 statements de DDL (17
 * tabelas + 15 índices) mais os 3 `ALTER` (que **sempre** lançam "duplicate column"
 * depois da primeira vez) custava **35 idas ao banco** antes de a rota começar a
 * trabalhar — 36 com o `config.carregar()` logo em seguida. Piso medido de **442 ms**
 * no cron mais barato do app, e o console de admin dispara **seis** requisições
 * paralelas no boot. Daí `jaAplicado`: ver ali por que a sonda é UMA query e por que
 * a versão é derivada, não escrita à mão.
 */

import { primeiraLinha, type Banco } from './tipos'

export const TABELAS = [
  /**
   * Marca de qual schema já foi aplicado neste banco (T-135).
   *
   * Uma linha, chave fixa. Existe só para a sonda de `jaAplicado` poder responder
   * "já está tudo aplicado" em **uma** query, em vez de o app reaplicar 35
   * statements por requisição para descobrir a mesma coisa.
   *
   * ⚠️ Tabela própria, não uma chave em `config`, de propósito: `config` é a tabela
   * que o console de admin edita e que `PUT /api/admin/config` valida por tipo
   * (`D-25`). Uma chave interna morando lá viraria uma linha sem família no mapa
   * `FAMILIA` — e apareceria numa tela feita para decisões humanas.
   */
  `CREATE TABLE IF NOT EXISTS meta_schema (
     id             INTEGER PRIMARY KEY CHECK (id = 1),
     versao         TEXT NOT NULL,
     aplicado_em    TEXT NOT NULL
   )`,

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
  /**
   * Anexos que a pessoa subiu **antes** de o chamado existir — `RF-61`, T-408.
   *
   * ## Por que uma tabela, e não memória do Worker
   *
   * O `temporaryAttachmentId` nasce no upload e é usado na confirmação, que é **outra
   * requisição**. O Worker é stateless: guardar em memória já foi bug real neste app (a
   * demonstração perdia o chamado entre requisições). E mandar o id para o navegador
   * seria `RF-30` aplicado a arquivo — quem tem o id de outra pessoa anexa o arquivo
   * dela no próprio chamado. O id fica aqui, e sai daqui com o e-mail no `WHERE`.
   *
   * ## As duas constraints, e o que cada uma impede
   *
   * - `UNIQUE (chave_idempotencia, nome_arquivo)` — T-411: duplo clique no seletor não
   *   gera dois temporários do mesmo arquivo. Como em todo o resto do projeto, a
   *   idempotência vem da constraint, não de um `SELECT` antes do `INSERT`.
   * - `materializado_em` — T-413b: a materialização acontece **uma vez**. Reconfirmar
   *   devolve `duplicada: true` com o mesmo `issueKey` (`RF-24`); sem esta coluna, o
   *   segundo clique anexaria o arquivo de novo.
   *
   * ⚠️ **`conversa_id` é nulo no formulário**, e não é redundante com a chave: a chave
   * correlaciona, o `conversa_id` é o que permite expurgar/auditar por conversa sem
   * parsear string.
   */
  `CREATE TABLE IF NOT EXISTS anexos_pendentes (
     id                      TEXT PRIMARY KEY,
     solicitante_email       TEXT NOT NULL,
     conversa_id             TEXT,
     chave_idempotencia      TEXT NOT NULL,
     temporary_attachment_id TEXT NOT NULL,
     nome_arquivo            TEXT NOT NULL,
     criado_em               TEXT NOT NULL,
     materializado_em        TEXT,
     UNIQUE (chave_idempotencia, nome_arquivo)
   )`,
  /**
   * `RF-78` (spec 010) — os BYTES do anexo, fatiados, até o chamado nascer.
   *
   * 🚨 Existe porque 6 dos 15 assuntos do `GN` exigem anexo e o Jira recusa a criação sem
   * ele (medido em 17/08/2026: *"Por favor, adicione pelo menos um arquivo"*). Com os
   * bytes aqui, o `temporaryAttachmentId` nasce na **confirmação**, segundos antes de ser
   * usado — e o motivo de `D-26` (id vencido derruba a criação) deixa de existir.
   *
   * ⚠️ **Fatiado porque a plataforma recusa valor acima de ~2,2 MB** (`D-74`,
   * `SQLITE_TOOBIG`). A fatia é de 512 kB de arquivo (~700 kB em base64): folga de 3×.
   *
   * ⚠️ **Sem `solicitante_email` aqui de propósito** — o dono é `anexos_pendentes`, e toda
   * leitura passa por lá (`RF-30`). Duplicar o e-mail criaria duas verdades sobre a mesma
   * posse, e a errada seria a que ninguém confere.
   */
  `CREATE TABLE IF NOT EXISTS anexos_conteudo (
     anexo_id TEXT NOT NULL,
     ordem    INTEGER NOT NULL,
     dados    TEXT NOT NULL,
     PRIMARY KEY (anexo_id, ordem)
   )`,
  `CREATE INDEX IF NOT EXISTS idx_anexos_pendentes_chave
     ON anexos_pendentes (chave_idempotencia, solicitante_email)`,
  `CREATE INDEX IF NOT EXISTS idx_anexos_pendentes_pessoa
     ON anexos_pendentes (solicitante_email, criado_em)`,
  /**
   * O que **este app** anexou ao chamado, a pedido de uma pessoa identificada — `RF-31`.
   *
   * ⚠️ **Não é `anexos_pendentes` com outro nome.** Aquela guarda o id **temporário** e é
   * expurgada em 12 h (T-415); uma lista montada dela mostraria os anexos da pessoa
   * sumindo sozinhos meio dia depois. Aqui o dado é o registro de que o arquivo entrou —
   * e ele vale enquanto o chamado existir.
   *
   * 🚨 A razão de existir está medida: em 12/08/2026 o `GN-6898` tinha um arquivo enviado
   * pelo app e a tela dizia `anexosIndisponiveis: true`, porque a única fonte era a
   * Atlassian e ela não prova publicidade (`D-45`). Para o que **nós** enviamos não há o
   * que provar: veio de upload autenticado desta pessoa, para chamado com vínculo dela.
   *
   * O `UNIQUE` é a idempotência (nunca `SELECT` antes do `INSERT`): reenviar o mesmo
   * arquivo não duplica a linha, e o e-mail entra na chave porque a leitura sempre o
   * exige no `WHERE` (`RF-30`).
   */
  `CREATE TABLE IF NOT EXISTS anexos_enviados (
     issue_key         TEXT NOT NULL,
     solicitante_email TEXT NOT NULL,
     nome_arquivo      TEXT NOT NULL,
     tamanho_bytes     INTEGER,
     tipo              TEXT,
     via               TEXT NOT NULL,
     criado_em         TEXT NOT NULL,
     PRIMARY KEY (issue_key, solicitante_email, nome_arquivo)
   )`,
  `CREATE INDEX IF NOT EXISTS idx_anexos_enviados_chamado
     ON anexos_enviados (issue_key, solicitante_email)`,

  /**
   * O que a IA entendeu de cada anexo da conversa — spec 007 (`FR-1`, `FR-2`, `FR-10`).
   *
   * `UNIQUE (conversa_id, nome_arquivo)` **é** o `FR-2`: analisar uma vez vem da constraint,
   * nunca de um `SELECT` antes do `INSERT` — dois uploads simultâneos do mesmo nome disputam
   * e um perde, como em `RF-24`.
   *
   * ⚠️ **`estado` distingue seis situações porque elas pedem frases diferentes.** `pronta` e
   * `irrelevante` são sucesso (a segunda **não** aparece na tela, `FR-5b`); `analisando` é o
   * que a rota da mensagem espera; `tipo_nao_suportado`, `sem_conteudo` e `falhou` são as três
   * formas de não ter lido, e confundi-las produz a frase errada — mesma família de
   * `area_indisponivel` × `area_nao_encontrada`.
   *
   * ⚠️ **A tabela NÃO guarda o conteúdo do arquivo**, só a descrição derivada. E `descricao` é
   * conteúdo pessoal: entra na retenção como o resto e **nunca** na auditoria (`FR-10`).
   *
   * `solicitante_email` existe para a leitura ser filtrada no `WHERE`, como em `vinculos`.
   */
  `CREATE TABLE IF NOT EXISTS analises_anexo (
     id                TEXT PRIMARY KEY,
     conversa_id       TEXT NOT NULL,
     solicitante_email TEXT NOT NULL,
     nome_arquivo      TEXT NOT NULL,
     estado            TEXT NOT NULL,
     descricao         TEXT,
     custo_usd         REAL,
     criado_em         TEXT NOT NULL,
     concluido_em      TEXT,
     UNIQUE (conversa_id, nome_arquivo)
   )`,
  `CREATE INDEX IF NOT EXISTS idx_analises_anexo_conversa
     ON analises_anexo (conversa_id, solicitante_email)`,

  /**
   * O Investigador — spec 009, `FR-1`.
   *
   * 🚨 **Existe porque em 14/08/2026 ninguém conseguiu responder por que uma pessoa passou
   * 70 minutos no app e não abriu chamado.** `getAppLogs` da plataforma registra método e
   * caminho de `/api/*` e mais nada — sem status, sem duração, sem corpo. A `auditoria`
   * sabe que houve seis `mensagem_enviada` e **não pode** saber o resto, porque `RN-10`
   * mantém conteúdo pessoal fora dela de propósito.
   *
   * ⚠️ **Esta tabela NÃO é auditoria, e a diferença é em todos os eixos.** `auditoria` é
   * append-only de longa duração (piso de 180 dias, `D-17`) e sem conteúdo; esta carrega
   * conteúdo, tem retenção curta (`investigador_retencao_dias`, default 30) e existe para
   * depurar. Fundir as duas daria a pior das duas: registro sensível guardado por seis
   * meses, ou investigação sem o dado que interessa.
   *
   * `req_json`/`resp_json` são **truncados com marca** e passam pela redação de
   * credenciais — ver `investigador/coleta.ts`, o único lugar que escreve aqui.
   */
  `CREATE TABLE IF NOT EXISTS investigador_requisicoes (
     id           TEXT PRIMARY KEY,
     ator_email   TEXT NOT NULL,
     conversa_id  TEXT,
     metodo       TEXT NOT NULL,
     caminho      TEXT NOT NULL,
     status       INTEGER NOT NULL,
     duracao_ms   INTEGER NOT NULL,
     req_bytes    INTEGER,
     resp_bytes   INTEGER,
     req_json     TEXT,
     resp_json    TEXT,
     erro         TEXT,
     criado_em    TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_investigador_req_criado
     ON investigador_requisicoes (criado_em)`,
  `CREATE INDEX IF NOT EXISTS idx_investigador_req_conversa
     ON investigador_requisicoes (conversa_id, criado_em)`,

  /**
   * Os eventos dentro de cada requisição — spec 009, `FR-5`, `FR-10b`.
   *
   * ⚠️ **`ordem` não é enfeite.** A gravação é em **lote, no fim da requisição** (`FR-10c`),
   * então dezenas de eventos compartilham o mesmo carimbo de milissegundo. Ordenar por
   * `criado_em` devolveria uma ordem indeterminada — e "em que ordem isso aconteceu?" é
   * exatamente a pergunta que esta tabela existe para responder. `ordem` é o índice dentro
   * da requisição; a chave de ordenação da tela é `(criado_em, ordem)`.
   *
   * ⚠️ **`requisicao_id` é o que liga a ida ao modelo ao POST que a conteve.** Sem ele, "o
   * turno levou 38 s" e "a chamada de extração levou 31 s" seriam dois fatos soltos.
   */
  `CREATE TABLE IF NOT EXISTS investigador_eventos (
     id             TEXT PRIMARY KEY,
     requisicao_id  TEXT,
     conversa_id    TEXT,
     ator_email     TEXT NOT NULL,
     tipo           TEXT NOT NULL,
     origem         TEXT NOT NULL,
     resumo         TEXT,
     dados_json     TEXT,
     custo_usd      REAL,
     duracao_ms     INTEGER,
     ordem          INTEGER NOT NULL DEFAULT 0,
     criado_em      TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_investigador_ev_conversa
     ON investigador_eventos (conversa_id, criado_em, ordem)`,
  `CREATE INDEX IF NOT EXISTS idx_investigador_ev_criado
     ON investigador_eventos (criado_em)`,
  `CREATE INDEX IF NOT EXISTS idx_investigador_ev_requisicao
     ON investigador_eventos (requisicao_id, ordem)`,
] as const

/**
 * Colunas acrescentadas a tabelas que já existem em produção.
 *
 * `CREATE TABLE IF NOT EXISTS` não altera tabela existente: `env.DB` é persistente
 * entre deploys, então a tabela criada na Fase 1 continua sem a coluna nova. Cada
 * `ALTER` roda uma vez e falha nas seguintes com "duplicate column" — engolir **só**
 * esse erro é o que torna a migração idempotente sem tabela de versão.
 */
export const COLUNAS_ADICIONADAS = [
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
  /**
   * T-422 / ScC-7 — quantos anexos efetivamente subiram para este chamado.
   *
   * ⚠️ **Por que não contar de `anexos_pendentes`:** aquela tabela é expurgada em
   * `TTL_ANEXO_PENDENTE_HORAS` (T-415). Um indicador que lê dela mostraria a evidência
   * chegando hoje e **caindo para zero** amanhã, sem nada ter mudado — o gráfico mediria
   * o expurgo, não a feature. Aqui o número é durável porque mora onde o chamado mora.
   *
   * Três estados, de novo: `NULL` = nunca houve materialização (não havia arquivo, ou a
   * criação foi diferida) · `0` = tentou e nenhum subiu · `N` = subiram N.
   */
  `ALTER TABLE submissoes ADD COLUMN anexos_anexados INTEGER`,
  /**
   * `RN-13` (spec 008) — a **base do merge de três pontas**: a última proposta que a IA
   * produziu, com o motivo da prioridade e os campos que ela sugeriu.
   *
   * 🚨 **Por que não guardar isso em `proposta_json`:** aquela coluna é a proposta
   * **vigente**, e ela carrega a edição da pessoa (`PUT /proposta`, `RF-16`). Comparar a
   * proposta nova contra ela diria "a IA mudou a prioridade" quando a IA repetiu a própria
   * opinião e foi a **pessoa** que mudou — e a tela atropelaria a escolha dela. `SC-7` proíbe
   * isso, e o sintoma é zero: nenhum erro, nenhum teste vermelho.
   *
   * ⚠️ `NULL` em toda conversa anterior a esta migração, o que é o estado certo: sem base
   * não há motivo, e o cartão **declara** isso (`FR-5`) até a rederivação seguinte.
   */
  `ALTER TABLE conversas ADD COLUMN proposta_ia_json TEXT`,
  /**
   * `RF-78` (spec 010) — o MIME do arquivo, para o reenvio na confirmação.
   *
   * ⚠️ Sem ele o segundo upload teria de **adivinhar** o tipo, e adivinhar significa mandar
   * `application/octet-stream` para um print — o Jira aceita, e o anexo passa a chegar
   * como binário genérico, sem preview, na única superfície onde a evidência é olhada.
   * O tipo já foi validado no upload (`http/anexo-entrada.ts`); guardá-lo é de graça.
   */
  `ALTER TABLE anexos_pendentes ADD COLUMN tipo_arquivo TEXT`,
] as const

/**
 * Identidade do schema atual, DERIVADA do próprio conteúdo.
 *
 * ⚠️ Um número de versão escrito à mão é a versão frágil disto: quem acrescenta uma
 * tabela em `TABELAS` e esquece de subir o número produz um app que **nunca** aplica
 * a tabela nova — e o sintoma é a mesma família de `{}` silencioso que
 * `linhasComoObjetos` documenta, porque a leitura falha num lugar longe daqui.
 * Derivando do texto, mudar o schema muda a marca por construção, e não existe o
 * passo que se pode esquecer.
 *
 * Não é hash criptográfico e não precisa ser: a pergunta é "este texto é o mesmo de
 * antes?", não "alguém forjou isto?". Quem escreve em `meta_schema` é o próprio app.
 */
function versaoDoSchema(): string {
  const texto = [...TABELAS, ...COLUNAS_ADICIONADAS].join('\n')
  // djb2 — barato, determinístico e sem dependência. Dois hashes em offsets
  // diferentes para que reordenar statements não colida por acidente.
  let h1 = 5381
  let h2 = 52711
  for (let i = 0; i < texto.length; i++) {
    const c = texto.charCodeAt(i)
    h1 = (h1 * 33 + c) | 0
    h2 = (h2 * 31 + c) | 0
  }
  const hex = (n: number) => (n >>> 0).toString(16).padStart(8, '0')
  return `${hex(h1)}${hex(h2)}-${texto.length}`
}

export const VERSAO_SCHEMA = versaoDoSchema()

/**
 * A sonda: uma query decide se há trabalho a fazer.
 *
 * Devolve `true` só quando a marca gravada é exatamente a do schema que este código
 * conhece. Qualquer outra situação — tabela ausente (banco novo), marca diferente
 * (schema mudou), erro ao ler — devolve `false` e o caminho completo roda. É a
 * direção fail-closed de sempre: o custo de aplicar DDL idempotente à toa é tempo;
 * o custo de **não** aplicar é tabela faltando em produção.
 */
async function jaAplicado(db: Banco): Promise<boolean> {
  try {
    const r = await db.query(`SELECT versao FROM meta_schema WHERE id = 1`, [])
    return primeiraLinha<{ versao: string }>(r)?.versao === VERSAO_SCHEMA
  } catch {
    // Banco novo: a própria `meta_schema` ainda não existe.
    return false
  }
}

async function aplicar(db: Banco): Promise<void> {  for (const sql of TABELAS) {
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
  // A marca é gravada por ÚLTIMO, e só se tudo acima passou: marca gravada antes de
  // um `ALTER` estourar seria a sonda mentindo para sempre.
  await db.exec(
    `INSERT INTO meta_schema (id, versao, aplicado_em) VALUES (1, ?, ?)
       ON CONFLICT (id) DO UPDATE SET versao = excluded.versao, aplicado_em = excluded.aplicado_em`,
    [VERSAO_SCHEMA, new Date().toISOString()],
  )
}

/**
 * Migrações já concluídas NESTE isolate, por objeto de banco.
 *
 * ⚠️ **As duas metades são necessárias, e resolvem custos diferentes** (`RNF-36`, `D-32`,
 * `D-35`). A sonda `meta_schema` acima corta os 35 statements de DDL para **2 idas** num
 * isolate **novo**; esta memoização corta as 2 para **zero** em toda requisição seguinte do
 * **mesmo** isolate. Ficar só com a sonda faria toda rota pagar duas idas de rede antes de
 * começar; ficar só com a memoização faria o primeiro request de cada isolate pagar os 35.
 *
 * `WeakMap` por instância de `Banco` — não flag de módulo — porque em produção `env.DB` é a
 * mesma referência por isolate, e nos testes cada caso monta um banco novo. Um `let migrado`
 * global daria o mesmo ganho em produção e faria o **segundo teste da suíte** rodar contra um
 * banco sem tabela nenhuma.
 *
 * Guarda a **promessa**, não um booleano: duas requisições concorrentes esperam a mesma
 * migração em vez de disputarem o DDL. E a falha **não** fica memoizada — senão um erro
 * transitório de banco no primeiro boot condenaria o isolate a nunca ter schema.
 */
const migracoes = new WeakMap<Banco, Promise<void>>()

/**
 * Garante o schema **uma vez por banco**. É por aqui que o app passa; `migrar` continua
 * exportada porque os testes de schema querem justamente rodar a migração de novo.
 */
export async function garantirMigracao(db: Banco): Promise<void> {
  const emAndamento = migracoes.get(db)
  if (emAndamento) return emAndamento

  const promessa = migrar(db).catch((erro: unknown) => {
    migracoes.delete(db)
    throw erro
  })
  migracoes.set(db, promessa)
  return promessa
}

export async function migrar(db: Banco): Promise<void> {
  if (await jaAplicado(db)) return
  await aplicar(db)
}
