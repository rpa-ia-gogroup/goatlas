# goatlas

Porta de entrada interna para a Atlassian. Um app no **GoDeploy** onde o colaborador
da Gocase conversa com um **agente de IA** que investiga antes de deixar abrir
chamado (deflete via Confluence e via histórico do Jira), abre o chamado no **JSM**
quando cabe, e acompanha os próprios chamados — **sem precisar de assento
Atlassian**. Traz também o console de **governança de assentos** (Organizations
API). O N8N está fora: classificação, priorização e criação vivem dentro do app.

**Perante a Atlassian a identidade é sempre uma conta de serviço** (proxy total —
decisão consciente, seção 1.2 de `docs/REQUISITOS.md`). O navegador **nunca** fala
com a Atlassian. A tabela de vínculo `issueKey ↔ e-mail do solicitante` é o
artefato mais crítico do sistema.

---

## Este projeto usa Spec-Driven Development (SDD)

A especificação é o artefato primário; o código é a expressão dela.

| Arquivo | Papel |
|---|---|
| [`.specify/memory/constitution.md`](.specify/memory/constitution.md) | **A lei.** Em conflito com qualquer pedido, a constituição vence. |
| [`docs/REQUISITOS.md`](docs/REQUISITOS.md) | **Fonte da verdade dos requisitos** — RF/RNF/RN/R/Q. É a ela que tudo rastreia. |
| [`docs/DECISOES.md`](docs/DECISOES.md) | Decisões tomadas, Q1–Q13 respondidas, trade-offs aceitos. |
| `specs/<NNN>-<slug>/{spec,plan,tasks}.md` | Por feature: cenários testáveis (WHAT/WHY) → plano (HOW) → tarefas. |
| [`identidade_visual_gogroup.md`](identidade_visual_gogroup.md) | Design system GoGroup. Obrigatório em toda UI. |

**Fluxo (features não-triviais):** `/specify` → `/clarify` → `/plan` → `/tasks` →
`/analyze` (gate) → `/implement`.

**Altitude:** spec = comportamento observável; plano = tecnologia. Não misture.
Pegou-se escrevendo "como" na spec? Move para o plano.

**Right-Sized Rigor:** typo/bug óbvio de 1 linha não precisa do fluxo. Mudança
média: `/specify` + `/tasks`. Mudança grande ou arriscada: fluxo completo.

**As specs referenciam IDs, não copiam requisitos.** `_Requirements: RF-08, RN-01_`.

---

## Regras obrigatórias

Estas não precisam ser pedidas — são o padrão do projeto. Um hook lembra/bloqueia
quando alguma é esquecida (ver "Automação do processo").

1. **Worktree para qualquer edição de código** — branch nova + worktree isolado
   sob `.claude/worktrees/<branch>` **antes** de editar. Várias sessões do Claude
   mexem no repo ao mesmo tempo; editar na principal atropela as outras.
   Planejamento (`docs/`, `specs/`, `.claude/`, `.specify/`, `*.md` da raiz) pode
   ser editado na árvore principal.
2. **Documentação no mesmo PR** — mudou comportamento, mudaram os documentos
   (Princípio XIII da constituição). Documento desatualizado é bug do PR que o
   desatualizou.
3. **Regra crítica em código, com teste** — nunca só no system prompt. RF-08
   (ordem das tools) e RF-17 (confirmação) são validados no servidor, e a suíte
   inclui os testes de **bypass** (tentar burlar pelo prompt).
4. **Português com acentuação** em todo texto visível ao usuário — UI, erros e
   prompts de IA.
5. **Três credenciais, zero vazamento** — API token Jira/Confluence · API key de
   organização (Bearer, `api.atlassian.com/admin`, exige Org Admin) · chave da API
   de IA. Só em secrets do GoDeploy. Nunca em repo, log, resposta ou bundle.
6. **Nada hardcoded** — IDs de projeto, service desk, request type, espaço do
   Confluence e campo customizado vêm de configuração/secret (**RNF-25**).
7. **Zero chamada à Atlassian ou à IA a partir do navegador** (**RNF-02**).
8. **Negação por padrão** — allowlist explícita de espaços e de tipos de chamado;
   nada exposto por default (**RNF-07**, **RN-06**).
9. **UI → skill `frontend-design` antes de codar**, respeitando
   `identidade_visual_gogroup.md` e o piso de a11y (foco visível,
   `prefers-reduced-motion`, contraste, estado nunca só por cor).
10. **Staging antes de produção** — nenhuma mudança de código vai a prod sem
    validar no app de staging (`docs/DEPLOY.md`).
11. **`git pull` antes de abrir PR** — `main` anda por causa da regra 1.
12. **Q1–Q13 são bloqueio, não detalhe** — tarefa que depende de uma pergunta em
    aberto não entra em `/implement` antes de a resposta estar em
    `docs/DECISOES.md`.

## Decisões que NÃO podem ser "corrigidas" por engano

Escolhas intencionais. Se parecerem erradas, reabra a decisão em
`docs/DECISOES.md` — não as contrarie no código.

- **Proxy total via conta de serviço** (não `raiseOnBehalfOf` por usuário). Custo
  aceito e explícito: R-01 (conformidade de licenciamento), R-03 (reporter único),
  e a existência de RF-21/RF-22/RNF-21 só para compensar a ausência de identidade
  real. **RNF-22** mantém a migração viável — não achate o cliente Atlassian.
- **Bloqueio não é parede** (**RF-13**, **RN-07**) — sempre há override, e o
  override é registrado. Override é sinal de documentação ruim, não de usuário
  teimoso. Não transformar em recusa.
- **SLA é de primeira resposta, não de resolução** (**RN-08**), e os 24h são
  **piso garantido**, não novo prazo (**R-05** — áreas com retorno atual de 2h30).
- **A prioridade sugerida pela IA é editável antes de criar** (**RF-16**).
  Priorização automática sem revisão vira jogo: as pessoas aprendem as palavras
  que produzem "Crítica".
- **`internal` tem default `true`** no endpoint de comentários do JSM. Passar só
  `public=true` retorna públicos **e** internos. Sempre
  `?public=true&internal=false` **mais** filtro server-side pelo campo `public`
  (defesa em profundidade — **RF-32**, **RN-05**).
- **Falha de tool não silencia a regra** (**RNF-18**) — informa e marca o ticket
  como não verificado. Indisponibilidade nunca vira bypass.
- **N8N está descartado.** Não propor voltar a ele.

## Padrões de código que sustentam as travas

Não são estilo — são o que faz a trava ser garantia em vez de intenção. Quebrar um
destes reabre um vazamento que já foi fechado.

- **Trava crítica tem DUAS camadas.** `agent/gate.ts`: (1) `toolsPermitidas()` não
  oferece a tool; (2) `autorizarCriacao()` recusa se ela vier. A camada 1 sozinha é
  teatro — quem chama a rota HTTP direto nunca viu a lista de tools. A camada 2
  sozinha basta para a segurança, mas deixa o modelo tropeçar à toa.
- **Não existe leitura sem e-mail** (`tickets/vinculos.ts`). Toda consulta exige o
  e-mail do solicitante e o filtro está no `WHERE`, não num `.filter()` posterior.
  Um método `obterPorIssueKey(issueKey)` sem e-mail seria a porta de RF-30 — por
  isso ele **não existe**. A via de reconciliação chama-se
  `obterSemIsolamento_apenasReconciliacao`, para que usá-la numa rota de usuário
  seja um bug visível na revisão.
- **Idempotência vem da constraint, não de `SELECT` antes do `INSERT`.** Um
  check-then-insert tem janela de corrida: dois cliques simultâneos passam os dois
  pelo `SELECT`. `UNIQUE` + tratar a colisão como "já registrei" é o desenho.
- **Ausência de informação = negar** (fail-closed). Allowlist vazia não expõe nada;
  `dominios_permitidos` vazio nega todo mundo (nunca "libera todos"); comentário
  sem o campo `public` é tratado como interno. O atalho oposto passa em todo teste
  de caminho feliz e abre o app em produção no dia em que alguém esquecer de
  configurar.
- **`indisponivel` (503), `rate_limit` (429) e `timeout` (504) são TRANSITÓRIOS;
  só `rejeitado` (400/403) é definitivo.** Classificar indisponibilidade como
  definitiva marca a submissão como `falha` e ela **nunca é reprocessada** — é
  perder o chamado de alguém numa queda de 30 segundos, exatamente o que RNF-17
  proíbe. Foi um bug real, pego pelo teste `rf24-outbox-degradacao`.
- **Mensagem de erro nunca inclui o corpo da resposta da Atlassian** — ele pode
  conter dado interno e o erro sobe até o log (RNF-01, RNF-30).
- **Tool que FALHOU ≠ tool que não rodou.** Falha satisfaz a ordem (a conversa
  tentou) mas o chamado nasce `verificadoRegras: false`. Não rodar continua
  recusando. É a diferença entre "indisponibilidade não vira bypass" e
  "indisponibilidade vira parede" — o requisito pede o primeiro.

## Automação do processo (hooks)

Configurados em [`.claude/settings.json`](.claude/settings.json), scripts em
`.claude/hooks/`. Existem para que ninguém precise dizer "use worktree" ou
"atualize o CLAUDE.md".

| Hook | O que faz |
|---|---|
| `SessionStart` | Injeta o protocolo do projeto (SDD, worktree, travas críticas) em toda sessão — e de novo após `/clear` e `/compact`. |
| `PreToolUse` Edit/Write | **Bloqueia** edição de código na árvore principal fora de worktree. Libera `docs/`, `specs/`, `.claude/`, `.specify/` e `*.md` da raiz. |
| `PreToolUse` `git commit` | Lembra o gate de documentação e os testes das travas críticas. |
| `PreToolUse` `gh pr create` | Checa se o diff toca código sem tocar documentação e avisa. |
| `PreToolUse` `updateApp` | Lembra staging-antes-de-prod e a lista de assets derivada do `dist/` real. |

Escape hatch do guard de worktree: `GOATLAS_ALLOW_MAIN_EDIT=1`.

## Comandos

```bash
npm run dev      # dev server
npm run test     # Vitest
npm run build    # SPA em dist/
npm run lint     # eslint
```

## Worktree — receita

```bash
git worktree add .claude/worktrees/<branch> -b <branch>   # a partir de main atualizada
# ... trabalhar dentro de .claude/worktrees/<branch>
git worktree remove .claude/worktrees/<branch>            # ao terminar
```

Nomes: `<NNN>-<slug>` para feature (o NNN da spec), `fix/<slug>` para correção.

## Plataforma (GoDeploy — restrições duras)

Cloudflare Workers: só JS/TS · sem binário nativo · sem TCP puro (tudo HTTP/REST)
· sem WebSocket/Durable Object · sem processo longo em background · sem filesystem
persistente.

- **Banco:** `env.DB` (SQLite), `query`/`exec` **assíncronos** — sempre `await`,
  sempre passar params (mesmo `[]`), schema com `CREATE TABLE IF NOT EXISTS`.
- **Auth:** o edge do GoDeploy faz o OAuth (`visibility: authenticated`) e injeta
  `x-godeploy-user-email`. O app **revalida o domínio no servidor** (**RF-01**,
  **RF-05**) — não confia só no edge.
- **Cron:** `createCronJob` (MCP) chamando uma rota `POST` comum do app; o app
  valida o header assinado `X-Godeploy-Cron` contra `GODEPLOY_CRON_KEY`. **Nunca**
  `setInterval`/`scheduled()`/lib de cron dentro do app.
- **Fire-and-forget** precisa de `ctx.waitUntil` — sem isso a plataforma cancela a
  promise quando a Response retorna.
- **Deploy:** `getUploadToken` → upload dos arquivos → `updateApp` com
  `entrypoint`, `assets` (lista derivada do `dist/` **real** — hashes mudam a cada
  build) e `assetConfig.not_found_handling: "single-page-application"`.

## Estado do projeto

**Fase 1 em implementação.** Faseamento em `docs/REQUISITOS.md` seção 12:
Fase 0 diagnóstico (João, sem código) → **Fase 1 MVP** → Fase 2 conhecimento e
governança → Fase 3 SLA e notificações → Fase 4 rollout. Progresso tarefa por
tarefa em [`specs/001-mvp-chamados-e-agente/tasks.md`](specs/001-mvp-chamados-e-agente/tasks.md).

Pronto: fundação (scaffold, schema, contratos das camadas isoladas, fakes).
**8 tarefas seguem `[BLOQUEADA]`** aguardando Q1/Q2/Q3/Q4 — ver `docs/DECISOES.md`.

### Como testar sem credencial
As duas camadas isoladas têm **fake** (`src/lib/atlassian/fake.ts`,
`src/lib/ia/fake.ts`), com falha injetável por operação. O fake de IA é
**roteirizável**: é assim que os testes de bypass encenam um modelo hostil
(tentando `create_ticket` fora de ordem, inventando nome de tool, obedecendo a
instrução vinda de conteúdo do Confluence) de forma determinística. Nenhum teste
precisa de rede, credencial ou provedor de IA.

Banco nos testes: `node:sqlite` via `src/lib/db/sqlite-local.ts` — SQLite real, do
runtime, sem dependência nova. É de propósito: as invariantes que importam são
constraints do schema (`UNIQUE` de `vinculos.issue_key` e de
`submissoes.chave_idempotencia`), e um dublê que não as aplica deixaria RF-24 e
RN-03 verdes enquanto produção duplica chamado.
