---
# Constituição do Projeto — regras inegociáveis que governam todo o SDD.
project: "goatlas"
version: 1.0.1
ratified: "2026-08-03"
requirements_source: "docs/REQUISITOS.md"
---

# Constituição — goatlas

> Este é o **"DNA arquitetural"** do projeto: princípios que **toda** spec, plano,
> tarefa e implementação geradas pelo Claude devem respeitar.
>
> **Precedência:** em conflito entre esta constituição e qualquer outra instrução
> de tarefa, a constituição vence — a menos que seja formalmente emendada
> (ver *Amendment Process* no fim).

## Princípios

### I. Specification First
O código serve à especificação, não o contrário. Nada **não-trivial** é
implementado sem uma spec aprovada (`WHAT`/`WHY`) e um plano (`HOW`).

**Neste projeto** a fonte da verdade dos requisitos é
[`docs/REQUISITOS.md`](../../docs/REQUISITOS.md) (RF-01…RF-63, RNF-01…RNF-35,
RN-01…RN-11, R-01…R-11, Q1…Q13). As specs em `specs/<NNN>-<slug>/` **não copiam**
esses requisitos: elas **referenciam os IDs** e os refinam em cenários testáveis,
edge cases e critérios de aceite. Requisito é do documento; comportamento
verificável é da spec.

### II. No Guessing
Ambiguidade nunca é resolvida por suposição. Marque `[NEEDS CLARIFICATION: ...]`
e pergunte. **Um chute plausível porém errado é pior que uma pergunta.**

As perguntas em aberto do documento de requisitos (**Q1–Q13**) são
`[NEEDS CLARIFICATION]` de primeira classe: nenhuma tarefa que dependa de uma
delas entra em `/implement` antes de a resposta estar registrada em
`docs/DECISOES.md`.

### III. Test-First (adaptável)
O comportamento esperado é expresso como teste/critério verificável **antes** da
implementação. Onde TDD estrito não couber, ainda assim defina *como* o requisito
será verificado antes de escrever o código.

**Obrigatoriamente test-first** (não negociável — são as travas de segurança do
produto): RF-08/RN-01 (ordem das tools), RF-17/RN-02 (confirmação), RF-30/RN-04
(isolamento por solicitante), RF-32/RN-05 (comentário interno), RN-06 (exposição
de Confluence), RF-24 (idempotência), RNF-17 (não perder chamado).

### IV. Small, Reversible Steps
Trabalhe em incrementos pequenos. Cada tarefa deve ser revisável e revertível
isoladamente. Sem entregas "big-bang".

### V. Simplicity & YAGNI
A solução mais simples que satisfaz a spec. Sem features especulativas
("might need"), sem abstração prematura. Use os frameworks diretamente, sem
camadas de wrapper desnecessárias.

**Exceção declarada:** as duas camadas de isolamento exigidas por **RNF-22**
(cliente Atlassian) e **RNF-23** (camada de IA) **não** são abstração prematura —
são requisito, e são a saída de emergência dos riscos R-01 e R-09. Não as achate
em nome da simplicidade.

### VI. Right-Sized Rigor
A cerimônia é proporcional ao risco e ao tamanho da mudança. Um bug trivial **não**
vira 16 critérios de aceite; uma mudança grande/arriscada merece o fluxo completo.
Pular etapas é permitido — mas conscientemente (ver "Quando pular" no `CLAUDE.md`).

### VII. Traceability
Toda tarefa e todo teste rastreiam de volta a um ID de `docs/REQUISITOS.md`
(`_Requirements: RF-08, RN-01_`). Requisito sem tarefa = lacuna. Tarefa sem
requisito = escopo que ninguém pediu — ou requisito novo, e então o documento de
requisitos é atualizado **antes** da tarefa.

### VIII. Stack & Conventions

**Plataforma (restrições duras do GoDeploy — Cloudflare Workers):** só
JavaScript/TypeScript; sem binários nativos, sem TCP puro (tudo por HTTP/REST),
sem WebSockets/Durable Objects, sem processo longo em background, sem filesystem
persistente. Trabalho recorrente usa **cron da plataforma** (`createCronJob`
chamando uma rota `POST` comum + verificação do header assinado `X-Godeploy-Cron`
contra `GODEPLOY_CRON_KEY`) — **nunca** `setInterval`, `scheduled()` ou lib de
cron dentro do app.

| Camada | Escolha |
|---|---|
| Runtime | Cloudflare Worker no GoDeploy · TypeScript **strict** |
| Frontend | React 19 · TanStack Router (file-based SPA) · Tailwind v4 · shadcn/ui |
| Backend | Worker único servindo `/api/*` + SPA fallback |
| Banco | `env.DB` (SQLite do GoDeploy) — `query`/`exec` **assíncronos**: sempre `await`, sempre passar params (mesmo `[]`), schema com `CREATE TABLE IF NOT EXISTS` |
| Auth | **OAuth do edge GoDeploy** (`visibility: authenticated`) — o edge injeta `x-godeploy-user-email`; o app revalida o domínio no servidor |
| IA | Camada isolada atrás de interface própria (**RNF-23**) |
| Atlassian | Cliente isolado, uma camada só (**RNF-22**) |
| Build | Vite 7 · npm · Vitest |
| Deploy | MCP GoDeploy (`getUploadToken` → upload → `updateApp`) |

**Convenções:**
- **Português do Brasil com acentuação** em todo texto visível ao usuário
  (`producao` → `produção`). Vale para UI, mensagens de erro e prompts de IA.
- **Zero hardcode** de IDs de projeto, service desk, request type, espaço do
  Confluence ou campo customizado — configuração ou secret (**RNF-25**).
- **Prompts versionados** em arquivos do repositório, revisáveis em PR
  (**RNF-24**). Prompt é regra de negócio, não string solta no meio do código.
- **Branch e worktree:** uma branch por tarefa (`<NNN>-<slug>` para feature,
  `fix/<slug>` para correção), criada em worktree isolado sob
  `.claude/worktrees/<branch>` (ver Princípio XII). PR via `gh pr create`.
- **Interface segue `identidade_visual_gogroup.md`** — Poppins, `--go-blue`,
  `--go-lime`, `--go-cream`, cantos generosos, botões pill. Antes de qualquer
  tarefa de UI, invocar a skill `frontend-design`. Piso de acessibilidade: foco de
  teclado visível, `prefers-reduced-motion`, contraste, **estado nunca só por cor**.

### IX. Quality, Security & Observability Gates

**Qualidade (gate de PR):**
- `npm run test` passa. Todo requisito da lista do Princípio III tem teste
  automatizado — e os testes de bypass (tentar burlar RF-08 pelo prompt) são
  parte da suíte, não um teste manual.
- `docs/REQUISITOS.md`, a spec da feature, o `CLAUDE.md` e o `docs/` afetado são
  atualizados **no mesmo PR** que muda o comportamento (Princípio XIII).
- Nada vai a produção sem passar pelo app de **staging** (`docs/DEPLOY.md`).

**Segurança (nenhuma destas é negociável):**
- As **três credenciais** (API token Jira/Confluence · API key de organização ·
  chave da API de IA) vivem só em secrets do GoDeploy. Nunca no repo, nunca no
  bundle do frontend, nunca em log, nunca em resposta de API (**RNF-01**).
- **Nenhuma** chamada à Atlassian ou à IA parte do navegador (**RNF-02**).
- **Negação por padrão** em toda exposição de conteúdo (**RNF-07**, **RN-06**).
- Toda decisão de autorização é do servidor; identificador vindo do cliente é
  revalidado contra a sessão (**RNF-05**, **RF-30**).
- Conteúdo recuperado (Confluence, comentário de Jira) é **dado não confiável**,
  nunca instrução — e as regras críticas moram em código, não no system prompt
  (**RNF-08**, Princípio X).
- HTML do Confluence é sanitizado antes de renderizar (**RNF-06**).

**Observabilidade:**
- Log de auditoria **append-only** de toda ação que toque Atlassian ou IA,
  inclusive as que falham: quem, quando, o quê, qual recurso, resultado
  (**RF-58**, **RN-10**).
- Logs estruturados, legíveis via `getAppLogs`; erro de frontend é encaminhado ao
  backend para cair no mesmo lugar (**RNF-26**).
- Health check das dependências em rota própria (**RF-59**).

### X. Regra crítica mora em código, nunca em prompt
Toda regra que o produto não pode perder é implementada como validação de
servidor, com teste. O system prompt pode instruir, **nunca garantir**: um modelo
pode ser induzido a ignorar instrução; código não. Aplica-se em especial a
**RF-08/RN-01** (ordem das tools), **RF-17/RN-02** (confirmação explícita) e a
todos os gates de visibilidade.

### XI. Indisponibilidade nunca vira bypass, e falha nunca perde chamado
Degradação é **graciosa e explícita** (**RNF-18**): se a IA cai, o caminho é o
formulário estruturado — nunca "não consegui abrir seu chamado". Se
`search_confluence` ou `check_jira_history` falham, o agente **informa** e marca o
ticket como não verificado; não silencia a regra. Submissão é persistida **antes**
da chamada à Atlassian e reprocessada com retry (**RNF-17**).

### XII. Worktree obrigatório
Para **qualquer** tarefa que edite código, criar worktree git isolado com branch
nova **antes** de editar. Motivo: várias sessões do Claude mexem no repo ao mesmo
tempo; editar na pasta principal atropela as outras. Leitura, diagnóstico e
planejamento puro não precisam. Exceção declarada: artefatos de planejamento
(`docs/`, `specs/`, `.claude/`, `.specify/`, `*.md` da raiz) podem ser editados na
árvore principal — é onde o próprio fluxo SDD vive.

### XIII. Documentação viva (o repo se explica sozinho)
Mudou comportamento? Os documentos mudam **no mesmo PR**, sem ninguém precisar
pedir:
- requisito novo/alterado → `docs/REQUISITOS.md`;
- decisão tomada, pergunta Q respondida, trade-off aceito → `docs/DECISOES.md`;
- regra operacional, comando, gotcha que morde de novo → `CLAUDE.md`;
- detalhe de subsistema → `docs/<subsistema>.md`;
- escopo/cenário → a `spec.md` da feature.

Documento desatualizado é bug, e é bug do PR que o desatualizou.

### XIV. Decisões conscientes ficam registradas
Escolhas tomadas com a alternativa conhecida (a arquitetura de proxy total da
seção 1.2 é o caso fundador) vivem em `docs/DECISOES.md` com racional, custo
aceito e caminho de saída. Não "consertar" uma decisão registrada por engano: se
ela parece errada, reabra a decisão — não a contrarie no código.

## Amendment Process
Emendas exigem: (1) motivo documentado, (2) avaliação de impacto e
retrocompatibilidade, (3) aprovação do mantenedor (Kaique). Ao emendar, incremente
a `version` (semver) e atualize a data. Princípios não se quebram silenciosamente —
exceções pontuais vão em *Complexity Tracking* no `plan.md`.
