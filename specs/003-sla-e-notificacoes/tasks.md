---
feature: "SLA, notificações e métricas"
plan: "./plan.md"
status: draft
created: "2026-08-04"
---

# Tasks: SLA, notificações e métricas

> Tarefas atômicas do [`plan.md`](plan.md). Uma tarefa (ou grupo coeso) = uma branch
> em worktree.

## Phase 1 — A trava da fase: webhook é rota pública (testes antes)

- [ ] **T-201** Teste de burla do webhook: sem segredo · com segredo errado · com
      `issueKey` de chamado **sem vínculo local** (evento forjado sobre chamado que
      não é nosso não pode notificar ninguém). _Requirements: RF-48_
- [ ] **T-202** [P] Teste de dedupe: webhook e polling para o **mesmo fato** →
      **uma** notificação. _Requirements: RF-47_
- [ ] **T-203** [P] Teste de ação própria: quem comentou pelo app **não** é
      notificado do próprio comentário. _Requirements: RF-48_
- [ ] **T-204** Schema: `notificacoes` com `UNIQUE(issue_key, tipo_evento,
      carimbo_mudanca)`, `acoes_proprias`, `preferencias_notificacao`,
      `marca_agua_polling`, `alertas_sla`. A dedupe é do **banco**, não da aplicação.
      _Requirements: RF-47, RF-48_
- [ ] **T-205** `notificacoes/dedupe.ts` — chave a partir do carimbo **do Jira**, não
      do nosso relógio (senão as duas fontes geram chaves diferentes para o mesmo
      fato e a dedupe não dedupa nada). Faz T-202 passar. _Requirements: RF-47_
- [ ] **T-206** `POST /api/webhook/jira`: segredo em comparação de **tempo
      constante**, e o `issueKey` do payload serve só para achar o vínculo local —
      sem vínculo, descarta. Faz T-201 passar. _Requirements: RF-48, RNF-05_

## Phase 2 — Detecção de mudança

- [ ] **T-210** Polling incremental por JQL com marca-d'água (`updated >= último`).
      **Nunca** varredura completa: é a forma mais fácil de descobrir os burst limits
      não publicados do jeito ruim. _Requirements: RF-47, RNF-15_
- [ ] **T-211** [P] Registrar `acoes_proprias` no momento da ação do app. Comparar
      por autor **não funciona**: sob proxy total todo comentário sai da conta de
      serviço. Faz T-203 passar. _Requirements: RF-48_
- [ ] **T-212** Cron `POST /api/cron/polling-jira`, sempre ligado — notificação não
      pode depender de mecanismo único. _Requirements: RF-47_

## Phase 3 — Envio

- [ ] **T-220** `notificacoes/tipos.ts`: camada isolada `enviar(canal, destino,
      mensagem)`. É esta fronteira que permite responder **Q11** depois sem tocar a
      lógica de *quando* notificar. _Requirements: RF-45, RNF-23_
- [ ] **T-221** [P] Fake de canal, com falha injetável. _Requirements: RF-45_
- [ ] **T-222** Canal Google Chat. **[BLOQUEADA: Q11]** _Requirements: RF-45_
- [ ] **T-223** [P] Canal e-mail. **[BLOQUEADA: Q11]** _Requirements: RF-45_
- [ ] **T-224** `GET/PUT /api/preferencias` + tela. Sem preferência, o default de
      Q11. _Requirements: RF-45_
- [ ] **T-225** Cron de envio com retry; falha de envio não perde a notificação
      (mesma lógica do outbox de chamados). _Requirements: RF-44_
- [ ] **T-226** Notificar criação (número, prioridade, **prazo de primeira
      resposta**) e cada mudança de status ou comentário **público**. A palavra
      "primeira resposta" é obrigatória no texto (`RN-08`).
      _Requirements: RF-44, RN-08, RNF-30_

## Phase 4 — SLA e métricas

- [ ] **T-230** Cálculo de prazo por prioridade, **em UTC**, com limiar configurável
      — função pura. ⚠️ Hoje conta **hora corrida**, porque é o que o requisito diz
      literalmente; horário útil seria mudança de requisito. _Requirements: RF-46_
- [ ] **T-231** Cron `POST /api/cron/alertas-sla`, com `alertas_sla` para não repetir
      o mesmo alerta a cada rodada. **[BLOQUEADA: destino do alerta]**
      _Requirements: RF-46_
- [ ] **T-232** `GET /api/admin/metricas`: deflexão por regra, override, chamados por
      área e prioridade, aderência ao SLA, aderência de canal (app × manual), buscas
      sem resultado. Os dados **já existem** — isto é superfície, não coleta.
      _Requirements: RF-55_
- [ ] **T-233** [P] Painel de métricas (skill `frontend-design` antes).
      _Requirements: RF-55, RNF-28_
- [ ] **T-234** [P] Monitorar taxa de 429 da Atlassian e custo/latência da IA com
      alerta em limiar. Sob API token, medir 429 é a **única** telemetria de
      orçamento que existe (`RNF-15`). _Requirements: RF-60_
- [ ] **T-235** Distinguir "defletido e resolveu" de "desistiu e foi pro chat".
      **[BLOQUEADA: decisão de produto]** — sem isso a taxa de deflexão infla e o
      projeto se auto-avalia bem por engano. _Requirements: O1, R-04_

## Phase 5 — Restante de M3

- [ ] **T-240** Anexos: `attachTemporaryFile` → `request/{key}/attachment` (dois
      passos; o primeiro devolve só `temporaryAttachmentIds`).
      _Requirements: RF-25, RF-34_
- [ ] **T-241** [P] Filtro por status e busca textual na lista. _Requirements: RF-35_
- [ ] **T-242** Marcar resolvido / reabrir — **só** quando o workflow do JSM oferecer
      a transição ao cliente (P2; depende do projeto, não do app).
      _Requirements: RF-36_
- [ ] **T-243** Retenção definida para vínculos, conversas e auditoria — nesta fase o
      volume de dado pessoal cresce (preferências, histórico de notificação).
      _Requirements: RNF-33_

---
## Coverage check
- [x] Todo RF/RNF no escopo da spec aparece em ao menos uma tarefa
- [x] Toda tarefa referencia requisito
- [x] Testes de burla (T-201 a T-203) antes da implementação
- [ ] **Nenhuma `[BLOQUEADA]`** — há **5**: T-222/T-223 (Q11), T-231 (destino),
      T-235 (produto), e o registro do webhook depende do time de tech

> **Caminho livre sem resposta nenhuma:** Phase 1 e Phase 2 inteiras (webhook,
> dedupe, polling, ações próprias) e o cálculo de SLA — tudo testável com fake de
> canal. O que trava é *para onde* mandar, não *quando* nem *o quê*.
