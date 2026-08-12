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

- [x] **T-201** Teste de burla do webhook: sem segredo · com segredo errado · com
      `issueKey` de chamado **sem vínculo local** (evento forjado sobre chamado que
      não é nosso não pode notificar ninguém). _Requirements: RF-48_
- [x] **T-202** [P] Teste de dedupe: webhook e polling para o **mesmo fato** →
      **uma** notificação. _Requirements: RF-47_
- [x] **T-203** [P] Teste de ação própria: quem comentou pelo app **não** é
      notificado do próprio comentário. _Requirements: RF-48_
- [x] **T-204** Schema: `notificacoes` com `UNIQUE(issue_key, tipo_evento,
      carimbo_mudanca)`, `acoes_proprias`, `preferencias_notificacao`,
      `marca_agua_polling`, `alertas_sla`. A dedupe é do **banco**, não da aplicação.
      _Requirements: RF-47, RF-48_
- [x] **T-205** `notificacoes/dedupe.ts` — chave a partir do carimbo **do Jira**, não
      do nosso relógio (senão as duas fontes geram chaves diferentes para o mesmo
      fato e a dedupe não dedupa nada). Faz T-202 passar. _Requirements: RF-47_
- [x] **T-206** `POST /api/webhook/jira`: segredo em comparação de **tempo
      constante**, e o `issueKey` do payload serve só para achar o vínculo local —
      sem vínculo, descarta. Faz T-201 passar. _Requirements: RF-48, RNF-05_

## Phase 2 — Detecção de mudança

- [x] **T-210** Polling incremental por JQL com marca-d'água (`updated >= último`).
      **Nunca** varredura completa: é a forma mais fácil de descobrir os burst limits
      não publicados do jeito ruim. _Requirements: RF-47, RNF-15_
- [x] **T-211** [P] Registrar `acoes_proprias` no momento da ação do app. Comparar
      por autor **não funciona**: sob proxy total todo comentário sai da conta de
      serviço. Faz T-203 passar. _Requirements: RF-48_
- [x] **T-212** Cron `POST /api/cron/polling-jira`, sempre ligado — notificação não
      pode depender de mecanismo único. _Requirements: RF-47_

## Phase 3 — Envio

- [x] **T-220** `notificacoes/tipos.ts`: camada isolada `enviar(canal, destino,
      mensagem)`. É esta fronteira que permite responder **Q11** depois sem tocar a
      lógica de *quando* notificar. _Requirements: RF-45, RNF-23_
- [x] **T-221** [P] Fake de canal, com falha injetável. _Requirements: RF-45_
- [x] **T-222** Canal Google Chat. ⚠️ **O transporte está pronto e testado contra
      `fetch` simulado; o que Q11 decide é se a empresa USA este canal** — e isso é um
      campo de config, não código (ver `D-19`). _Requirements: RF-45_
- [x] **T-223** [P] Canal e-mail. Mesma situação de T-222. Por HTTP, não SMTP: a
      plataforma não tem TCP puro. _Requirements: RF-45_
- [x] **T-224** `GET/PUT /api/preferencias` + tela. Sem preferência, o default de
      Q11. _Requirements: RF-45_
- [x] **T-225** Cron de envio com retry; falha de envio não perde a notificação
      (mesma lógica do outbox de chamados). _Requirements: RF-44_
- [x] **T-226** Notificar criação (número, prioridade, **prazo de primeira
      resposta**) e cada mudança de status ou comentário **público**. A palavra
      "primeira resposta" é obrigatória no texto (`RN-08`).
      _Requirements: RF-44, RN-08, RNF-30_

## Phase 4 — SLA e métricas

- [x] **T-230** Cálculo de prazo por prioridade, **em UTC**, com limiar configurável
      — função pura. ⚠️ Hoje conta **hora corrida**, porque é o que o requisito diz
      literalmente; horário útil seria mudança de requisito. _Requirements: RF-46_
- [~] **T-231** Cron `POST /api/cron/alertas-sla`, com `alertas_sla` para não repetir
      o mesmo alerta a cada rodada.
      ⚠️ **Rebaixada de `[x]` pela auditoria de 12/08 (`D-47`):** o cálculo, a dedupe e o
      retrato estão corretos e testados, mas `RF-46` diz "alerta **interno** … notificando o
      **time de produto/tech**" e o destinatário é `vinculo.solicitanteEmail`
      (`src/lib/notificacoes/servico.ts:336`) — vai a quem já sabe do próprio prazo, nunca a
      quem pode agir. A ressalva já estava escrita abaixo; o que muda é o board deixar de
      marcar como pronto um requisito cujo **destinatário é a coisa que ele pede**.
      ⚠️ **O destino continua sendo decisão de produto** (`D-20`) —
      o que está resolvido é *quando* alertar (cálculo puro), *não repetir* (a tabela) e
      *para quem*, no único destino que o app conhece hoje: o **solicitante**. Alertar o
      time de tech ou a liderança é um destinatário a mais na mesma função.
      _Requirements: RF-46_
- [x] **T-232** `GET /api/admin/metricas`: deflexão por regra, override, chamados por
      área e prioridade, aderência ao SLA, aderência de canal (app × manual), buscas
      sem resultado. Os dados **já existem** — isto é superfície, não coleta.
      _Requirements: RF-55_
- [x] **T-233** [P] Painel de métricas (skill `frontend-design` antes).
      _Requirements: RF-55, RNF-28_
      ✅ **Fechada em 12/08/2026 (`D-49`)** — os dez números que `montarPainel` produz têm
      casa declarada em `PAINEIS_DO_CONSOLE` e aparecem nela: calibragem e deflexão aparente
      em **Interrupções**; SLA, área, prioridade, via e avisos em **Chamados**; custo de IA
      e 429 em **Custo da IA**; baseline em **Assentos**. A **aderência de canal** deixou de
      ser ambígua: a tela diz "chamados abertos pelo app" e explica que o denominador só o
      Jira tem — em vez de sugerir uma taxa que ninguém pode calcular.
      ⚠️ **O buraco de teste que deixou isto acontecer também fechou**, e num arquivo
      **separado** (`tests/painel-do-console.test.ts`): `tela-admin.test.ts` responde "o
      campo diz o efeito?" e o novo responde "o painel chega à tela?" — misturá-los faria a
      segunda pergunta morrer junto com a primeira no próximo rewrite.
      ---
      _Diagnóstico original (auditoria de 12/08, `D-47`), preservado porque é o que explica
      a trava:_
      🚨 **Estava `[x]`; a tela mostrava 3 das 6 coisas que `RF-55` pede** — e o que faltava
      **existe pronto no servidor** (auditoria de 12/08, `D-47`). `montarPainel`
      (`src/lib/governanca/painel.ts:253`) devolve o objeto completo e
      `GET /api/admin/metricas` o serializa (`src/lib/http/rotas.ts:1511-1528`), mas
      `src/app/admin/paineis.tsx` consome **apenas `painel.evidencia`**
      (`paineis.tsx:99`). Na tela existem deflexão por regra, taxa de override
      (`paineis.tsx:55-101`) e buscas sem resultado (`paineis.tsx:215`).
      **Não chegam a ninguém:** aderência ao SLA (`painel.sla`) · chamados por **área** e
      por **prioridade** (`chamadosPorArea`/`chamadosPorPrioridade`) · a **calibragem com
      os motivos de override**.
      🚨 **A calibragem é REGRESSÃO, não lacuna:** ela foi entregue em `T-310` (spec 004) e
      se perdeu no rewrite do console (`D-25`, `T-138`). A prova de que existiu está no
      CSS órfão `.faixa-calibragem` (`src/app/estilos.css:1386`), que o próprio arquivo
      documenta como "o único desenho de dado desta folha" e que hoje nenhum componente
      usa. ⚠️ Isso desfaz o desenho de `T-310`/`R-04` **exatamente** onde ele importava: o
      threshold da Regra 1 continua editável no console **sem** a taxa de override e sem
      os motivos ao lado — que é a configuração que o `CLAUDE.md` chama de "empurrar para
      mexer no threshold quando a resposta certa é escrever a página".
      ⚠️ **Por que nenhum teste caiu:** `tests/tela-admin.test.ts` afirma sobre descritores
      de campo, rótulos e estados — **nunca sobre quais painéis são renderizados**. Um
      painel pode desaparecer inteiro sem uma asserção vermelha.
      ⚠️ **Aderência de canal (app × manual) é caso à parte:** `painel.ts:31-42` declara que
      só o **numerador** é conhecível (o app não vê o chamado aberto direto no Jira), e a
      tela mostra conversa × formulário, que mede outra coisa. Isso é honesto no servidor e
      **ambíguo na tela** — o rótulo precisa dizer qual das duas está sendo mostrada.
- [~] **T-234** [P] Monitorar taxa de 429 da Atlassian e custo/latência da IA com
      alerta em limiar. Sob API token, medir 429 é a **única** telemetria de
      orçamento que existe (`RNF-15`). _Requirements: RF-60_
      ⚠️ **Estava `[x]`; a medição existe, o alerta não** (auditoria de 12/08, `D-47`). Os
      429 são contados (`src/lib/atlassian/http.ts:187,61`) e agregados
      (`src/lib/governanca/painel.ts:288-300`), e o custo de IA também (`painel.ts:374-379`).
      Três buracos, todos na segunda metade do requisito:
      **(a) latência da IA não é medida em lugar nenhum** — não há cronômetro em
      `src/lib/ia/`, e o requisito pede "custo **e latência**";
      **(b) o limiar não é configurável** — `LIMIAR_429_PCT = 2` é constante de código
      (`painel.ts:141`), sem chave em `ConfigValores`, e o requisito diz "alerta em limiar
      **configurável**";
      **(c) não há alerta.** `acimaDoLimiar` é um booleano no JSON de
      `/api/admin/metricas` que **nenhuma tela renderiza** e que não dispara canal, auditoria
      nem log. Ninguém é avisado de nada — o dado espera que alguém abra o console e saiba
      procurá-lo. ⚠️ Como `RNF-15` diz que a taxa de 429 é a **única** telemetria de
      orçamento sob API token, um alerta que não alerta é o ponto cego da credencial única
      (`R-02`).
      ⚠️ **`D-49` mexeu só em (c) pela metade, e a tarefa segue `[~]` de propósito:** a taxa
      de 429 e o custo de IA agora **aparecem** na seção Custo da IA, com `acimaDoLimiar`
      destacando o cartão — mas isso é o console mostrando, não um alerta. Quem não abrir o
      console continua sem saber. (a) e (b) não foram tocados.
- [ ] **T-235** Distinguir "defletido e resolveu" de "desistiu e foi pro chat".
      **[BLOQUEADA: decisão de produto]** — sem isso a taxa de deflexão infla e o
      projeto se auto-avalia bem por engano. ⚠️ **Mitigado, não resolvido:** o painel
      devolve `deflexaoResolvidaConhecida: false` e mostra o aviso ao lado do número, que
      é tratado como **teto**, não resultado. Medir de verdade continua exigindo a
      decisão. _Requirements: O1, R-04_

## Phase 5 — Restante de M3

- [x] **T-240** Anexos: `attachTemporaryFile` → `request/{key}/attachment` (dois
      passos; o primeiro devolve só `temporaryAttachmentIds`).
      _Requirements: RF-25, RF-34_
      ⚠️ **Continua `[x]` — o fluxo está certo —, com uma ressalva que a auditoria de
      12/08 (`D-47`) registra: os dois endpoints de `RF-25` nunca foram exercitados contra o
      cliente HTTP real.** `attachTemporaryFile` não aparece em `tests/`; todos os testes de
      anexo (`rf61-*`, `rf63-*`, `fase4-piloto-e-restante`) passam pelo
      `ClienteAtlassianFake`. Ficam sem rede de proteção a URL, o `multipart`, o
      `X-Atlassian-Token` e o parse de `temporaryAttachments[].temporaryAttachmentId`
      (`src/lib/atlassian/cliente.ts:991,1017`).
      🚨 É **exatamente** o formato de `D-38`, `D-39` e `D-43`: o dublê não valida nada, então
      a forma do corpo só falharia em produção — e aqui falharia carregando o arquivo que é a
      evidência do chamado de alguém. Um teste contra `fetchImpl` afirmando corpo e URL, como
      o de `T-521`, fecharia isso sem credencial nenhuma.
- [x] **T-241** [P] Filtro por status e busca textual na lista. _Requirements: RF-35_
- [x] **T-242** Marcar resolvido / reabrir — **só** quando o workflow do JSM oferecer
      a transição ao cliente (P2; depende do projeto, não do app).
      _Requirements: RF-36_
- [x] **T-243** Retenção definida para vínculos, conversas e auditoria — nesta fase o
      volume de dado pessoal cresce (preferências, histórico de notificação).
      _Requirements: RNF-33_

---
## Coverage check
- [x] Todo RF/RNF no escopo da spec aparece em ao menos uma tarefa
- [x] Toda tarefa referencia requisito
- [x] Testes de burla (T-201 a T-203) antes da implementação
- [x] **O que era bloqueado por Q11 saiu do bloqueio** — T-222/T-223 estão
      implementadas; Q11 escolhe entre elas por config (`D-19`). T-231 idem quanto ao
      destino.
- [ ] **Resta bloqueada: T-235** (decisão de produto), mitigada pelo aviso no painel.
- [ ] **`[HUMANO]` — registrar o webhook no Jira** depende do time de tech. Até isso, o
      polling sozinho já entrega notificação (é por isso que `RF-47` pede as duas
      fontes).

> **Caminho livre sem resposta nenhuma:** Phase 1 e Phase 2 inteiras (webhook,
> dedupe, polling, ações próprias) e o cálculo de SLA — tudo testável com fake de
> canal. O que trava é *para onde* mandar, não *quando* nem *o quê*.
