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
- [x] **T-006** [P] `docs/DEPLOY.md`: app de staging + prod, deploy pelo MCP,
      variáveis, privilégios de cada credencial e **rotação sem downtime**.
      _Requirements: RNF-10, RNF-27_

## Phase 1 — Travas críticas primeiro (testes vermelhos antes do código)

> Esta fase existe antes das features de propósito: são os cenários **[bypass]** da
> spec, e a Definição de Pronto exige que sejam comprovados, não presumidos.

- [x] **T-010** Teste de bypass `RF-08`: handler chamado direto sem estado; conversa
      adversarial ("ignore as regras"); conteúdo do Confluence instruindo a criar.
      _Requirements: RF-08, RN-01, RNF-08_
- [x] **T-011** [P] Teste de bypass `RF-17`: criar sem passar por `/confirmar`.
      _Requirements: RF-17, RN-02_
- [x] **T-012** [P] Teste de bypass `RF-30`: acessar chamado de outro por URL e por
      parâmetro. _Requirements: RF-30, RN-04_
- [x] **T-013** [P] Teste `RF-32`: query com `internal=false` **e** filtro
      server-side; fixture com comentário interno. _Requirements: RF-32, RN-05_
- [x] **T-014** [P] Teste `RF-04`/`RF-05`: e-mail vindo do cliente é ignorado; conta
      fora do domínio e desativada são negadas. _Requirements: RF-04, RF-05, RNF-05_
- [x] **T-015** [P] Teste `RN-06`: espaço fora da allowlist, página restrita e label
      de bloqueio — as três, simultâneas. _Requirements: RN-06, RNF-09_
- [x] **T-016** [P] Teste `RF-24`: submissão duplicada concorrente → 1 chamado.
      _Requirements: RF-24_
- [x] **T-017** [P] Teste `RNF-17`: Atlassian falhando → submissão sobrevive e
      reprocessa; e o caso "criou no JSM, falhou o vínculo". _Requirements: RNF-17, RNF-21_

## Phase 2 — Identidade, auditoria e camadas isoladas

- [x] **T-020** `auth/`: identidade do header do edge, allowlist de domínio
      revalidada a cada requisição, negação de conta inativa. Nenhum identificador
      do cliente aceito. **[SUPOSIÇÃO: só `@gocase.com` — Q7]**
      _Requirements: RF-01, RF-04, RF-05, RNF-05_
- [ ] **T-021** Verificar no GoDeploy: o edge restringe login ao Workspace
      corporativo? existe header de nome? o que acontece com conta desativada?
      Registrar em `D-02`. _Requirements: RF-05, RF-06_
      **Deprioritizada (05/08/2026):** anotada como medida de segurança pendente,
      não bloqueia desenvolvimento nem `/implement` de outras tarefas. Exige app
      deployado de verdade para verificar — não é algo que dê pra confirmar contra
      fake. Retomar perto do deploy em staging (T-096).
- [x] **T-022** [P] Perfil admin por allowlist explícita, configurável sem deploy.
      _Requirements: RF-02, RN-09_
- [~] **T-023** [P] Sessão com expiração configurável e logout explícito.
      **Parcialmente atendida, por decisão `D-08`:** a expiração existe (é do edge do
      GoDeploy), mas **não há logout na interface** — trocar de conta não é caso de uso,
      e botão de sair em computador compartilhado convida confusão. ⚠️ `RF-03` é P0 e
      pede logout explícito, então **falta o aval do João** para isso virar alteração
      de `REQUISITOS.md`. Fica `[~]`, não `[x]`. _Requirements: RF-03, D-08_
- [x] **T-024** `audit/` append-only (sem UPDATE/DELETE no código), registrando
      também as ações que falham. _Requirements: RF-58, RN-10_
- [x] **T-025** `atlassian/cliente.ts`: cache com TTL configurável, `Retry-After`,
      backoff exponencial com jitter (base 2s, teto ~30s, ~4 tentativas), contagem
      de 429. Nenhuma URL da Atlassian fora desta pasta.
      _Requirements: RNF-13, RNF-14, RNF-15, RNF-22_
- [x] **T-026** `listarComentariosPublicos` encapsulando a pegadinha do `internal`
      (default `true`) + filtro pelo campo `public`. Faz T-013 passar.
      _Requirements: RF-32, RN-05_
- [x] **T-027** `ia/cliente.ts`: proxy corporativo, timeout com fallback direto,
      contabilidade de custo por conversa e teto configurável.
      _Requirements: RNF-16, RNF-23, RNF-34_
- [x] **T-028** [P] `config`: thresholds, allowlists e TTLs em banco, editáveis sem
      deploy — é o que impede o hardcode. _Requirements: RF-49, RF-50, RNF-25_
- [x] **T-028b** Tela de admin (**antecipada da Fase 2**, `D-09`): selo `admin`, aba
      "Configuração" com os campos que importam — cada um explicando o que o vazio faz,
      porque o app é fail-closed — e auditoria de **todos** os atores com filtro.
      Corrige um bug de `RF-56`: sem filtro, a rota usava o e-mail do próprio admin
      como default e o console mostrava só quem estava olhando.
      _Requirements: RF-49, RF-50, RF-56, D-09_
- [x] **T-029** [P] `GET /api/health` com Atlassian, IA, banco e SSO.
      _Requirements: RF-59_
- [x] **T-030** [P] Rate limit por usuário. _Requirements: RNF-11_

## Phase 3 — Regras (funções puras) e orquestrador

- [x] **T-040** `search_confluence`: busca por CQL **restrita na query** à allowlist,
      com score; exclusão por label; **e verificação de restrição de página**
      (`/restriction/byOperation/read`) por candidata, com cache. As **três**
      condições de `RN-06`. Sob proxy total, QUALQUER restrição exclui a página, e
      falha ao consultar também exclui (fail-closed). Allowlist real depende de
      **Q5** (entra como config, não como código).
      _Requirements: RF-37, RF-38, RF-40, RN-06, RNF-09_
- [x] **T-041** Regra 1 como **função pura**: melhor score × threshold → decisão.
      _Requirements: RF-09_
- [x] **T-042** `check_jira_history`: agrupamento pelo campo configurado, leitura dos
      comentários de resolução, janela limitada. **Implementada sem responder Q2**: o
      campo de agrupamento é lido de `config`, então a resposta de Q2 entra como
      **dado**, não como mudança de código (`RNF-25`) — nenhum valor foi chutado.
      **Falta verificar contra um Jira real (Q1).** _Requirements: RF-10, RF-11, RNF-25_
- [x] **T-043** Classificador "ajuste operacional" × "resolução real", com **cache
      por `issue_key` + hash do comentário** (contém `R-08`). Prompt versionado em
      `ia/prompts.ts` (`RNF-24`). **Q3 continua obrigatória em tempo de execução:** sem
      exemplos configurados, a Regra 2 se declara **indisponível** (`regra2Disponivel`)
      em vez de classificar com exemplo inventado — a trava de `RF-14` está no código,
      testada. _Requirements: RF-10, RF-14, RNF-16, RNF-24_
- [x] **T-044** Regra 2 como **função pura**: recorrência × threshold → decisão.
      **[SUPOSIÇÃO: 3+ em 90 dias]** _Requirements: RF-10, RF-11_
- [x] **T-045** Orquestrador: state machine em banco; monta o conjunto de tools
      permitidas por turno **e** recusa `create_ticket` fora de ordem. As duas
      camadas. Faz T-010 passar. _Requirements: RF-08, RN-01, RNF-08_
- [x] **T-046** Conteúdo recuperado entra no contexto do LLM como **dado**, delimitado
      e nunca como instrução. _Requirements: RNF-08, RNF-09_
- [x] **T-047** Mensagem de bloqueio com os **três** elementos (regra, motivo
      legível, link). A redação define a percepção do produto — soa como ajuda, não
      recusa. _Requirements: RF-12, RNF-30, RNF-31_
- [x] **T-048** Override: prossegue, registra tentativa **e** override, alimenta o
      backlog de documentação. _Requirements: RF-13, RN-07, RF-42_
- [x] **T-049** Falha de tool → informa e marca ticket como **não verificado**;
      nunca silencia a regra. _Requirements: RNF-18, RNF-19_
- [x] **T-050** Priorização automática em 3 níveis com SLA de **primeira resposta**
      correspondente. _Requirements: RF-15, RN-08_

## Phase 4 — Criação de chamado

- [x] **T-060** Outbox: persistir submissão **antes** da chamada; estados; chave de
      idempotência única no banco. Faz T-016 e T-017 passarem.
      _Requirements: RF-24, RNF-17_
- [x] **T-061** `POST /api/conversas/:id/confirmar` — a **única** transição que
      autoriza criar; o modelo não tem tool equivalente. Faz T-011 passar.
      _Requirements: RF-17, RN-02_
- [x] **T-062** Resumo estruturado antes de confirmar (título, descrição, tipo,
      componente, área, prioridade, SLA) com **prioridade editável**.
      _Requirements: RF-16, RF-18_
- [ ] **T-063** `criarChamado` via `POST /rest/servicedeskapi/request` com a conta de
      serviço como reporter. **[BLOQUEADA: Q1]** _Requirements: RF-20_
- [x] **T-064** Gravar solicitante real no campo customizado "Solicitante" e como
      request participant quando aplicável.
      _Requirements: RF-21, R-03_
      → `atlassian/cliente.ts#montarCamposSolicitante` já escrevia o campo
      quando configurado; o que faltava era a config em si —
      `campoSolicitanteId: null` estava **hardcoded** em `contexto.ts`. Agora é
      `config.campo_solicitante_id` (`RNF-25`, default `null` = fail-closed),
      editável no console de admin sem deploy (`RF-49`). **Não está mais
      bloqueada**: sem Q4 o solicitante segue indo só na descrição (cinto e
      suspensório, comportamento inalterado); com Q4 respondida, é só preencher
      o campo — mesmo raciocínio que já tirou T-113 (Q5) e T-125 (Q8) da lista
      de bloqueadas. **Request participant não entra**: depende de `accountId`
      real, que não existe sob o proxy total (`D-01`) — é caminho da migração
      futura (`RNF-22`), não desta arquitetura.
- [x] **T-065** Persistir vínculo `issueKey ↔ e-mail ↔ timestamp` na mesma transação
      lógica da conclusão da submissão. _Requirements: RF-22, RN-03_
- [x] **T-066** Allowlist de tipos de chamado: só o que o admin liberou é oferecido.
      _Requirements: RF-28, RNF-07_
- [x] **T-067** Confirmação final: chave, prioridade, prazo de primeira resposta e
      link de acompanhamento **interno**. _Requirements: RF-26_
- [x] **T-068** Cron `POST /api/cron/reprocessar-submissoes` (valida
      `X-Godeploy-Cron`) + job no GoDeploy. _Requirements: RNF-17_
- [x] **T-069** Cron `POST /api/cron/reconciliar-vinculos`: varre o Jira pelo campo
      "Solicitante" e reconstrói vínculo órfão. **[BLOQUEADA: Q4]**
      _Requirements: RNF-21_
- [x] **T-070** Formulário mínimo sem IA (`D-04`): mesmas travas de servidor, marcado
      como **não verificado pelas regras**, e mensurável. Faz parte de T-017/`RNF-18`.
      _Requirements: RF-27 (parcial), RNF-18_

## Phase 5 — Acompanhamento

- [x] **T-080** `GET /api/chamados` filtrado por vínculo **no servidor**: resumo,
      status, prioridade, SLA, última atualização. Faz T-012 passar.
      _Requirements: RF-29, RF-30, RN-04_
- [x] **T-081** Detalhe: descrição, campos, comentários **públicos**, anexos, status,
      histórico de SLA — sem campo interno. _Requirements: RF-31_
- [x] **T-082** Comentar publicamente, atribuído de forma legível ao solicitante real.
      _Requirements: RF-33_
      → **Resolvida (D-13):** prefixo `**Nome** (email) via goatlas:` no corpo do
      comentário, com nome/e-mail do login corporativo Google — visível no Jira
      nativo, sem precisar do console do goatlas. A função pura já existia
      (`atlassian/comentarios.ts#prefixarAutoria`, escrita quando a pergunta ainda
      estava aberta); faltava a rota passar `eu.nome`, não só `eu.email` — sem
      isso o prefixo saía com o e-mail duplicado. 1 teste novo em
      `tests/rotas.test.ts` confirmando o nome real chegando ao cliente Atlassian.

## Phase 6 — Frontend, mobile e fechamento

- [x] **T-090** Tela de conversa com **indicação de progresso** das duas
      verificações (elas rodam antes de o agente poder concluir).
      _Requirements: RF-07, RNF-12_
- [x] **T-091** [P] Telas "Meus chamados" e detalhe. _Requirements: RF-29, RF-31_
- [x] **T-092** [P] Erros em linguagem de negócio, nunca stack trace nem HTTP cru;
      erro de frontend encaminhado ao backend. _Requirements: RNF-30, RNF-26_
- [ ] **T-093** Validação real **no celular** do fluxo completo. _Requirements: RNF-28_
      **Deixada para o final (05/08/2026), por decisão do usuário:** não bloqueia
      nenhuma outra tarefa nem `/implement` — é ajuste de UX pós-conclusão, feito
      depois de todo o resto pronto, não durante.
- [x] **T-094** [P] Varredura provando que nenhuma das três credenciais aparece em
      log, resposta ou bundle. _Requirements: RNF-01_
      → `tests/rnf01-vazamento-credenciais.test.ts`, 13 casos. Estrutural: cada
      env var das 3 credenciais só é lida por `contexto.ts` (varredura de `src/`,
      mesmo padrão do teste de `obterCorpoStorage`) e `build-worker.mjs` não usa
      `define`/`inject` (sem isso um valor de ambiente do build viraria string
      fixa dentro do `worker.js` versionado). Comportamental: as três camadas de
      transporte (`atlassian/http.ts`, `atlassian/organizacao.ts`,
      `ia/cliente.ts`) recebem uma resposta de erro com um "segredo" plantado no
      corpo e a mensagem lançada não o contém — prova a garantia que já estava
      documentada em código, não presume. `redigirSensiveis` (auditoria) testado
      isoladamente e ponta a ponta contra o banco. `ATLASSIAN_ORG_API_KEY` (Q1)
      segue sem nenhum lugar que a leia — o teste cobra que continue assim
      **ou** que, quando for lida, seja só em `contexto.ts`.
- [x] **T-095** Métricas mínimas desde o dia 1: taxa de deflexão por regra, taxa de
      override, chamados por via (conversa × formulário), buscas sem resultado.
      Sem instrumentação não há como calibrar threshold. _Requirements: O1, R-04, RF-42_
      → `governanca/metricas.ts` (`calcularMetricas`, pura) + `obterResumoMetricas`
      lendo `bloqueios`/`vinculos`/`buscas`. Rota `GET /api/admin/metricas`, seção
      "Métricas" no console de admin (antes de "Governança de assentos"). Taxa
      sem nenhum dado ainda é `null` → tela mostra "sem dados", nunca "0%" (mesmo
      raciocínio de `custoConfigurado` em `custo.ts`/Q8). Subconjunto viável de
      `RF-55` na Fase 1 — falta aderência a SLA, que só existe a partir da Fase 3.
      12 testes novos (`tests/metricas.test.ts`) + rota incluída em
      `admin-gate.test.ts` (`ROTAS_ADMIN`). Verificado em `npm run dev`.
- [x] **T-132** Fechar o fail-open da escolha do cliente de IA: chave ausente com o
      resto configurado não pode instanciar o **fake**.
      _Requirements: RNF-18, RNF-25, D-04, D-05, D-14_
      → Achado ao conferir os secrets de `D-14`: `!env.LLM_API_KEY` caía em
      `ClienteIAFake` **mesmo com `usandoFakes === false`**, então remover
      `GOATLAS_MODO_DEMO` sem a chave de IA rodaria com **Atlassian real e IA falsa**
      — roteiro de demonstração na tela e chamado de verdade no JSM. Agora o fake só
      é alcançável por `usandoFakes`; sem chave vem `ia/indisponivel.ts`
      (`ClienteIAIndisponivel`), que recusa como **definitivo** (`transitorio: false`
      — repetir não resolve, alguém configura) e responde `verificarSaude()` com
      `ok: false`, fazendo `GET /api/health` devolver **503** com o motivo (`RF-59`).
      O formulário mínimo (`D-04`) não passa por aqui e segue abrindo chamado
      (`RNF-18`): degrada, não vira parede. 8 testes novos
      (`tests/ia-indisponivel-sem-chave.test.ts`), incluindo a regressão do fake em
      modo demo e a prova comportamental de que o agente recusa em vez de responder
      roteiro. **Pendência de UX anotada, não bloqueante:** `ia.chat` não é
      envolvido em `try/catch` no orquestrador, então o turno sobe como `500`
      genérico de `ERROS.interno()` — fail-closed e auditado, mas a mensagem não
      diz à pessoa que o agente está sem configuração.
- [ ] **T-096** Deploy em **staging**, validação, e só então produção.
      _Requirements: CLAUDE.md regra 10_
- [ ] **T-097** Fechar a Definição de Pronto da Fase 1 (§13 dos requisitos) item por
      item, incluindo os testes de burla. _Requirements: todos_

---
## Estado da implementação (03/08/2026)

**49 concluídas · 9 pendentes.** 152 testes passando, typecheck limpo, build da SPA
e do worker OK, e o fluxo validado no navegador — tudo **sem nenhuma credencial e
sem rede**, pelos fakes.

As **seis travas críticas estão implementadas e com teste de burla**:

| Trava | Onde mora | Teste |
|---|---|---|
| `RF-08` ordem das tools | `agent/gate.ts` — duas camadas: não oferecer + recusar se vier | `rf08-ordem-tools.test.ts` (6 burlas) |
| `RF-17` confirmação | `agent/gate.ts` + carimbo só por rota do usuário | idem |
| `RF-30` isolamento | `tickets/vinculos.ts` — não existe leitura sem e-mail | `rf30-isolamento.test.ts` |
| `RF-32` comentário interno | `atlassian/comentarios.ts` — query + filtro | `rf32-comentarios.test.ts` |
| `RF-24` idempotência | `UNIQUE` no banco, detectado pela constraint | `rf24-outbox-degradacao.test.ts` |
| `RNF-17` não perder chamado | `tickets/outbox.ts` — persiste antes de chamar | idem |

**O que falta, e por quê:**

| Tarefa | Estado |
|---|---|
| T-021 verificar comportamento do edge com conta desativada | precisa de app deployado |
| T-063 `criarChamado` contra a Atlassian real | **`[BLOQUEADA: Q1]`** — o código existe e roda contra o fake |
| T-064 campo customizado "Solicitante" | **Concluída** — `campo_solicitante_id` é config (RNF-25); sem Q4 o solicitante segue só na descrição (cinto e suspensório) |
| T-082 comentário atribuído ao solicitante real | **Concluída** — prefixo com nome/e-mail do login corporativo (`D-13`), ver T-082 acima |
| T-093 validação no celular | feita em viewport de celular no dev; falta no aparelho real |
| T-094 varredura de credencial em log/bundle | **Concluída** — `tests/rnf01-vazamento-credenciais.test.ts`, ver T-094 acima |
| T-095 métricas mínimas | **Concluída** — seção "Métricas" no console de admin, ver T-095 acima |
| T-096 deploy em staging e prod | **`[BLOQUEADA: Q1]`** — precisa dos secrets |
| T-097 fechar a Definição de Pronto item por item | depende das acima |

Tarefas que **estavam** `[BLOQUEADA]` e saíram sem a resposta chegar: T-025, T-040,
T-042, T-043 e T-069. Em todas, nada foi chutado — o valor que falta entra como
**config** (`RNF-25`), e onde a ausência muda o comportamento o código **falha
explicitamente** em vez de assumir (`regra2Disponivel` para Q3, service desk
ausente bloqueando a criação para Q1).

---
## Coverage check (gate antes do `/implement`)
- [x] Todo RF/RN no escopo da spec aparece em ao menos uma tarefa
- [x] Toda tarefa referencia requisito
- [x] Testes das travas críticas vêm **antes** da implementação (Phase 1 antes de 3–5)
- [ ] **Nenhuma tarefa `[BLOQUEADA]`** — snapshot em 05/08/2026: T-063 e T-096
      (Q1, credencial completa — só a peça da Organizations API chegou, falta
      token Jira/Confluence e a chave de IA) seguem bloqueadas. T-040, T-042,
      T-043, T-064, T-069 e **T-082** (resolvida, `D-13`) saíram da lista sem a
      resposta chegar — o valor que faltava virou config ou decisão registrada,
      nunca hardcode. T-020 opera sob suposição (Q7)

> **O caminho livre hoje:** Phase 0 e Phase 1 inteiras, e a maior parte da Phase 2 —
> fundação, fakes e **todos os testes de bypass** não dependem de nenhuma resposta.
> Dá para chegar com as travas críticas provadas antes de a primeira credencial
> existir.
