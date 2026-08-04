---
feature: "MVP — agente de chamados e acompanhamento"
plan: "./plan.md"
status: draft
created: "2026-08-03"
---

# Tasks: MVP — agente de chamados e acompanhamento

> Tarefas **atômicas** do [`plan.md`](plan.md). Cada uma: pequena, revisável,
> revertível, rastreável a um ID de [`REQUISITOS.md`](../../docs/REQUISITOS.md).
>
> **Uma tarefa (ou grupo coeso) = uma branch em worktree.** O hook bloqueia editar
> código na árvore principal.

## Legenda
- `[ ]` pendente · `[~]` em progresso · `[x]` concluída
- `[P]` paralelizável dentro da fase
- `[BLOQUEADA: Qn]` — **não entra em `/implement`** antes da resposta em
  `docs/DECISOES.md` (constituição, Princípio II; `D-06` não flexibiliza isto)
- `[SUPOSIÇÃO]` — construída sobre default assumido; reabre se a resposta divergir
- `_Requirements:_` rastreabilidade obrigatória

---

## Phase 0 — Fundação do repo (nada depende de resposta)

- [x] **T-001** Scaffold do app: Vite 7 + React 19 + TS strict + Tailwind v4 +
      Vitest; `npm run dev/test/build/typecheck`. **TanStack Router e shadcn/ui
      adiados para a Phase 6** — instalar router antes de existir rota é abstração
      prematura (Princípio V). _Requirements: RNF-32_
- [x] **T-002** [P] Tokens da identidade visual em CSS/Tailwind (Poppins, `--go-*`,
      radius, sombras) a partir de `identidade_visual_gogroup.md`; invocar a skill
      `frontend-design` antes. _Requirements: RNF-28, RNF-29_
- [x] **T-003** [P] Schema em `env.DB` (idempotente): `vinculos`, `submissoes`,
      `conversas`, `mensagens`, `bloqueios`, `classificacoes_ticket`, `auditoria`,
      `config`. Unicidade de `vinculos.issue_key` e `submissoes.chave_idempotencia`
      **no banco**. _Requirements: RF-22, RF-24, RN-03, RF-58_
- [x] **T-004** [P] Contratos (só tipos, sem implementação): `atlassian/tipos.ts`
      com métodos de **domínio**, `ia/tipos.ts` com chat-com-tools e classificação.
      _Requirements: RNF-22, RNF-23_
- [x] **T-005** Fakes de Atlassian e IA, com modos de falha injetáveis (indisponível,
      429, timeout). É o que permite testar tudo sem rede. _Requirements: RNF-18_
- [ ] **T-006** [P] `docs/DEPLOY.md`: app de staging + prod, deploy pelo MCP,
      variáveis, privilégios de cada credencial e **rotação sem downtime**.
      _Requirements: RNF-10, RNF-27_

## Phase 1 — Travas críticas primeiro (testes vermelhos antes do código)

> Esta fase existe antes das features de propósito: são os cenários **[bypass]** da
> spec, e a Definição de Pronto exige que sejam comprovados, não presumidos.

- [ ] **T-010** Teste de bypass `RF-08`: handler chamado direto sem estado; conversa
      adversarial ("ignore as regras"); conteúdo do Confluence instruindo a criar.
      _Requirements: RF-08, RN-01, RNF-08_
- [ ] **T-011** [P] Teste de bypass `RF-17`: criar sem passar por `/confirmar`.
      _Requirements: RF-17, RN-02_
- [ ] **T-012** [P] Teste de bypass `RF-30`: acessar chamado de outro por URL e por
      parâmetro. _Requirements: RF-30, RN-04_
- [ ] **T-013** [P] Teste `RF-32`: query com `internal=false` **e** filtro
      server-side; fixture com comentário interno. _Requirements: RF-32, RN-05_
- [ ] **T-014** [P] Teste `RF-04`/`RF-05`: e-mail vindo do cliente é ignorado; conta
      fora do domínio e desativada são negadas. _Requirements: RF-04, RF-05, RNF-05_
- [ ] **T-015** [P] Teste `RN-06`: espaço fora da allowlist, página restrita e label
      de bloqueio — as três, simultâneas. _Requirements: RN-06, RNF-09_
- [ ] **T-016** [P] Teste `RF-24`: submissão duplicada concorrente → 1 chamado.
      _Requirements: RF-24_
- [ ] **T-017** [P] Teste `RNF-17`: Atlassian falhando → submissão sobrevive e
      reprocessa; e o caso "criou no JSM, falhou o vínculo". _Requirements: RNF-17, RNF-21_

## Phase 2 — Identidade, auditoria e camadas isoladas

- [ ] **T-020** `auth/`: identidade do header do edge, allowlist de domínio
      revalidada a cada requisição, negação de conta inativa. Nenhum identificador
      do cliente aceito. **[SUPOSIÇÃO: só `@gocase.com` — Q7]**
      _Requirements: RF-01, RF-04, RF-05, RNF-05_
- [ ] **T-021** Verificar no GoDeploy: o edge restringe login ao Workspace
      corporativo? existe header de nome? o que acontece com conta desativada?
      Registrar em `D-02`. _Requirements: RF-05, RF-06_
- [ ] **T-022** [P] Perfil admin por allowlist explícita, configurável sem deploy.
      _Requirements: RF-02, RN-09_
- [ ] **T-023** [P] Sessão com expiração configurável e logout explícito.
      _Requirements: RF-03_
- [ ] **T-024** `audit/` append-only (sem UPDATE/DELETE no código), registrando
      também as ações que falham. _Requirements: RF-58, RN-10_
- [ ] **T-025** `atlassian/cliente.ts`: cache com TTL configurável, `Retry-After`,
      backoff exponencial com jitter (base 2s, teto ~30s, ~4 tentativas), contagem
      de 429. Nenhuma URL da Atlassian fora desta pasta.
      _Requirements: RNF-13, RNF-14, RNF-15, RNF-22_
- [ ] **T-026** `listarComentariosPublicos` encapsulando a pegadinha do `internal`
      (default `true`) + filtro pelo campo `public`. Faz T-013 passar.
      _Requirements: RF-32, RN-05_
- [ ] **T-027** `ia/cliente.ts`: proxy corporativo, timeout com fallback direto,
      contabilidade de custo por conversa e teto configurável.
      _Requirements: RNF-16, RNF-23, RNF-34_
- [ ] **T-028** [P] `config`: thresholds, allowlists e TTLs em banco, editáveis sem
      deploy — é o que impede o hardcode. _Requirements: RF-49, RF-50, RNF-25_
- [ ] **T-029** [P] `GET /api/health` com Atlassian, IA, banco e SSO.
      _Requirements: RF-59_
- [ ] **T-030** [P] Rate limit por usuário. _Requirements: RNF-11_

## Phase 3 — Regras (funções puras) e orquestrador

- [ ] **T-040** `search_confluence`: busca por CQL **restrita na query** à allowlist,
      com score; exclusão por label e por restrição de página. Faz T-015 passar.
      **[BLOQUEADA: Q5 para a allowlist real — desenvolvível com espaço de teste]**
      _Requirements: RF-37, RF-38, RF-40, RN-06_
- [ ] **T-041** Regra 1 como **função pura**: melhor score × threshold → decisão.
      _Requirements: RF-09_
- [ ] **T-042** `check_jira_history`: agrupamento pelo campo configurado, leitura dos
      comentários de resolução, janela limitada. **[BLOQUEADA: Q2]**
      **[SUPOSIÇÃO: label]** _Requirements: RF-10, RF-11_
- [ ] **T-043** Classificador "ajuste operacional" × "resolução real", com **cache
      por `issue_key` + hash do comentário** (contém `R-08`). Prompt versionado em
      arquivo. **[BLOQUEADA: Q3 — sem exemplos reais da Gocase a classificação erra
      e gera falso bloqueio]** _Requirements: RF-10, RF-14, RNF-16, RNF-24_
- [ ] **T-044** Regra 2 como **função pura**: recorrência × threshold → decisão.
      **[SUPOSIÇÃO: 3+ em 90 dias]** _Requirements: RF-10, RF-11_
- [ ] **T-045** Orquestrador: state machine em banco; monta o conjunto de tools
      permitidas por turno **e** recusa `create_ticket` fora de ordem. As duas
      camadas. Faz T-010 passar. _Requirements: RF-08, RN-01, RNF-08_
- [ ] **T-046** Conteúdo recuperado entra no contexto do LLM como **dado**, delimitado
      e nunca como instrução. _Requirements: RNF-08, RNF-09_
- [ ] **T-047** Mensagem de bloqueio com os **três** elementos (regra, motivo
      legível, link). A redação define a percepção do produto — soa como ajuda, não
      recusa. _Requirements: RF-12, RNF-30, RNF-31_
- [ ] **T-048** Override: prossegue, registra tentativa **e** override, alimenta o
      backlog de documentação. _Requirements: RF-13, RN-07, RF-42_
- [ ] **T-049** Falha de tool → informa e marca ticket como **não verificado**;
      nunca silencia a regra. _Requirements: RNF-18, RNF-19_
- [ ] **T-050** Priorização automática em 3 níveis com SLA de **primeira resposta**
      correspondente. _Requirements: RF-15, RN-08_

## Phase 4 — Criação de chamado

- [ ] **T-060** Outbox: persistir submissão **antes** da chamada; estados; chave de
      idempotência única no banco. Faz T-016 e T-017 passarem.
      _Requirements: RF-24, RNF-17_
- [ ] **T-061** `POST /api/conversas/:id/confirmar` — a **única** transição que
      autoriza criar; o modelo não tem tool equivalente. Faz T-011 passar.
      _Requirements: RF-17, RN-02_
- [ ] **T-062** Resumo estruturado antes de confirmar (título, descrição, tipo,
      componente, área, prioridade, SLA) com **prioridade editável**.
      _Requirements: RF-16, RF-18_
- [ ] **T-063** `criarChamado` via `POST /rest/servicedeskapi/request` com a conta de
      serviço como reporter. **[BLOQUEADA: Q1]** _Requirements: RF-20_
- [ ] **T-064** Gravar solicitante real no campo customizado "Solicitante" e como
      request participant quando aplicável. **[BLOQUEADA: Q4]**
      _Requirements: RF-21, R-03_
- [ ] **T-065** Persistir vínculo `issueKey ↔ e-mail ↔ timestamp` na mesma transação
      lógica da conclusão da submissão. _Requirements: RF-22, RN-03_
- [ ] **T-066** Allowlist de tipos de chamado: só o que o admin liberou é oferecido.
      _Requirements: RF-28, RNF-07_
- [ ] **T-067** Confirmação final: chave, prioridade, prazo de primeira resposta e
      link de acompanhamento **interno**. _Requirements: RF-26_
- [ ] **T-068** Cron `POST /api/cron/reprocessar-submissoes` (valida
      `X-Godeploy-Cron`) + job no GoDeploy. _Requirements: RNF-17_
- [ ] **T-069** Cron `POST /api/cron/reconciliar-vinculos`: varre o Jira pelo campo
      "Solicitante" e reconstrói vínculo órfão. **[BLOQUEADA: Q4]**
      _Requirements: RNF-21_
- [ ] **T-070** Formulário mínimo sem IA (`D-04`): mesmas travas de servidor, marcado
      como **não verificado pelas regras**, e mensurável. Faz parte de T-017/`RNF-18`.
      _Requirements: RF-27 (parcial), RNF-18_

## Phase 5 — Acompanhamento

- [ ] **T-080** `GET /api/chamados` filtrado por vínculo **no servidor**: resumo,
      status, prioridade, SLA, última atualização. Faz T-012 passar.
      _Requirements: RF-29, RF-30, RN-04_
- [ ] **T-081** Detalhe: descrição, campos, comentários **públicos**, anexos, status,
      histórico de SLA — sem campo interno. _Requirements: RF-31_
- [ ] **T-082** Comentar publicamente, atribuído de forma legível ao solicitante real.
      **[BLOQUEADA: definir o "como" — ver §10 da spec]** _Requirements: RF-33_

## Phase 6 — Frontend, mobile e fechamento

- [ ] **T-090** Tela de conversa com **indicação de progresso** das duas
      verificações (elas rodam antes de o agente poder concluir).
      _Requirements: RF-07, RNF-12_
- [ ] **T-091** [P] Telas "Meus chamados" e detalhe. _Requirements: RF-29, RF-31_
- [ ] **T-092** [P] Erros em linguagem de negócio, nunca stack trace nem HTTP cru;
      erro de frontend encaminhado ao backend. _Requirements: RNF-30, RNF-26_
- [ ] **T-093** Validação real **no celular** do fluxo completo. _Requirements: RNF-28_
- [ ] **T-094** [P] Varredura provando que nenhuma das três credenciais aparece em
      log, resposta ou bundle. _Requirements: RNF-01_
- [ ] **T-095** Métricas mínimas desde o dia 1: taxa de deflexão por regra, taxa de
      override, chamados por via (conversa × formulário), buscas sem resultado.
      Sem instrumentação não há como calibrar threshold. _Requirements: O1, R-04, RF-42_
- [ ] **T-096** Deploy em **staging**, validação, e só então produção.
      _Requirements: CLAUDE.md regra 10_
- [ ] **T-097** Fechar a Definição de Pronto da Fase 1 (§13 dos requisitos) item por
      item, incluindo os testes de burla. _Requirements: todos_

---
## Coverage check (gate antes do `/implement`)
- [x] Todo RF/RN no escopo da spec aparece em ao menos uma tarefa
- [x] Toda tarefa referencia requisito
- [x] Testes das travas críticas vêm **antes** da implementação (Phase 1 antes de 3–5)
- [ ] **Nenhuma tarefa `[BLOQUEADA]`** — há **8**: T-040 (Q5), T-042 (Q2), T-043
      (Q3), T-063 (Q1), T-064 e T-069 (Q4), T-082 (definição do "como"), e T-020
      opera sob suposição (Q7)

> **O caminho livre hoje:** Phase 0 e Phase 1 inteiras, e a maior parte da Phase 2 —
> fundação, fakes e **todos os testes de bypass** não dependem de nenhuma resposta.
> Dá para chegar com as travas críticas provadas antes de a primeira credencial
> existir.
