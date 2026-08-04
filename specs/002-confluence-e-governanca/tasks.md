---
feature: "Confluence como superfície própria e governança de assentos"
plan: "./plan.md"
status: draft
created: "2026-08-04"
---

# Tasks: Confluence próprio e governança de assentos

> Tarefas atômicas do [`plan.md`](plan.md). Uma tarefa (ou grupo coeso) = uma
> branch em worktree. Legenda igual à da Fase 1.

## Phase 1 — A trava da fase: sanitização (testes antes)

> Nesta fase HTML editável por qualquer pessoa da empresa passa a ser
> **renderizado** no navegador de um colega. `RNF-06` deixa de ser um item de lista
> e passa a ser a trava principal — tratada como as seis da Fase 1.

- [ ] **T-101** Teste de burla da sanitização: `<script>`, `onerror`/`onclick`,
      `javascript:`, `data:`, `<iframe>`, `<object>`, tag malformada, atributo com
      maiúsculas e espaços (`ON ERROR =`), entidade HTML disfarçando `<`.
      _Requirements: RNF-06_
- [ ] **T-102** [P] Teste de burla do proxy de anexo: anexo de página restrita;
      `Content-Type: text/html` vindo da Atlassian. _Requirements: RNF-06, RN-06_
- [ ] **T-103** [P] Teste de burla de leitura direta: URL de página restrita e de
      espaço fora da allowlist. _Requirements: RF-40, RN-06, RNF-09_
- [ ] **T-104** [P] Teste de burla do gate de admin em **todas** as rotas de
      governança. _Requirements: RN-09, RNF-04_
- [ ] **T-105** `confluence/sanitizar.ts`: **allowlist** de tags e atributos (nunca
      blocklist), storage format → **árvore de nós tipada**, `href`/`src` só
      `http(s)`. Faz T-101 passar. _Requirements: RNF-06_
- [ ] **T-106** `confluence/renderizar.tsx`: árvore → elementos React. **Zero
      `dangerouslySetInnerHTML`** — não deve existir caminho em que string vira
      HTML. _Requirements: RNF-06, RF-39_
- [ ] **T-107** Macro não suportada → placeholder **visível** (`RF-43`). Macro que
      desaparece em silêncio faz o leitor decidir com informação faltando sem saber
      que falta. _Requirements: RF-43_

## Phase 2 — Confluence como superfície

- [ ] **T-110** `obterPagina` no cliente isolado (v2: `/wiki/api/v2/pages/{id}`),
      com cache. _Requirements: RF-39, RNF-13, RNF-22_
- [ ] **T-111** `GET /api/confluence/pagina/:id` repassando as **três** condições de
      `RN-06` — a mesma verificação da busca, restrição de página incluída. Faz
      T-103 passar. _Requirements: RF-40, RN-06_
- [ ] **T-112** Proxy de anexo: three condições + `Content-Type` conferido
      (imagem/PDF passam, resto vira download com `nosniff`). Faz T-102 passar.
      _Requirements: RNF-02, RNF-06_
- [ ] **T-113** [P] `GET /api/confluence/busca` como superfície própria (reusa o que
      a Regra 1 já usa). **[BLOQUEADA: Q5 para a allowlist real — desenvolvível]**
      _Requirements: RF-37, RF-38_
- [ ] **T-114** [P] Tela de busca e leitura, mobile-first, com a skill
      `frontend-design` antes. _Requirements: RF-39, RNF-28_
- [ ] **T-115** Árvore do espaço + breadcrumbs (`RF-41`, P1).
      _Requirements: RF-41_
- [ ] **T-116** Tabela `buscas` + `paginas_lidas`; registrar termo, nº de
      resultados e se houve clique. É o insumo de `O6` e de `RF-42`.
      _Requirements: RF-42, RF-58_
- [ ] **T-117** `GET /api/admin/lacunas`: buscas sem resultado + overrides da Fase 1,
      como backlog de documentação. _Requirements: RF-42_

## Phase 3 — Governança de assentos

- [ ] **T-120** `atlassian/organizacao.ts` com **transporte próprio** — não
      compartilha instância com o cliente de Jira/Confluence, para que bug de
      roteamento não faça chamada de usuário sair com credencial de Org Admin.
      _Requirements: RNF-04, RNF-22_
- [ ] **T-121** [P] Fake da Organizations API, com usuários, produtos e último
      acesso. _Requirements: RNF-04_
- [ ] **T-122** `listarUsuarios` (`GET /admin/v1/orgs/{orgId}/users`). `orgId` de
      config. **[BLOQUEADA: Q1]** _Requirements: RF-51, RNF-25_
- [ ] **T-123** `ultimoAcesso` (`.../last-active-dates`), **carregando as limitações
      oficiais no payload**: atrasa até 24h, "ativo" = viu página por ≥2s. Elas vão
      **na tela** (`RF-52`) — sem isso alguém rebaixa quem estava de férias.
      **[BLOQUEADA: Q1]** _Requirements: RF-52_
- [ ] **T-124** Tabela `inventario_assentos` + `POST /api/cron/coletar-inventario`
      diário. A API é lenta para consulta interativa, e o histórico é o que faz `O2`
      ser recorrente em vez de retrato. _Requirements: RF-51, RF-52_
- [ ] **T-125** `governanca/custo.ts` — funções puras: custo por produto e total,
      agregado de ocioso (sem acesso há N dias, N configurável). **Sem Q8, mostra
      contagem e marca o valor como não configurado — nunca número inventado**, que
      é pior que nenhum porque alguém decide rebaixamento com ele.
      **[BLOQUEADA: Q8 para o valor]** _Requirements: RF-53_
- [ ] **T-126** [P] Recomendações de rebaixamento/remoção, com o caso central: quem
      tem assento cujo único uso é abrir chamado (customer de JSM é gratuito e
      ilimitado). _Requirements: RF-54_
- [ ] **T-127** [P] Exportação CSV com escape correto (vírgula e aspas em nome).
      _Requirements: RF-54_
- [ ] **T-128** Console de assentos: inventário, custo, ocioso, recomendações — com
      as limitações do dado visíveis. Skill `frontend-design` antes.
      _Requirements: RF-51…RF-54, RNF-28_
- [ ] **T-129** [P] `GET /api/admin/auditoria` com filtro por usuário, período e
      ação + exportação (`RF-56`). _Requirements: RF-56_

## Phase 4 — Fechamento

- [ ] **T-130** `RF-27` completo: campos do formulário renderizados a partir do
      schema do request type. **O caminho sem IA da Fase 1 não pode regredir.**
      _Requirements: RF-27_
- [ ] **T-131** `RF-57` (P2): revogar produto pelo console, **dupla confirmação** e
      auditoria. Única escrita da credencial de Org Admin. **[BLOQUEADA: Q1]**
      _Requirements: RF-57, RN-10_
- [ ] **T-132** Fechar os Success Criteria da spec 002 item por item.
      _Requirements: todos_

---
## Coverage check
- [x] Todo RF/RNF no escopo da spec aparece em ao menos uma tarefa
- [x] Toda tarefa referencia requisito
- [x] Os testes de burla (T-101 a T-104) vêm **antes** da implementação
- [ ] **Nenhuma `[BLOQUEADA]`** — há **5**: T-113 (Q5), T-122/T-123/T-131 (Q1),
      T-125 (Q8)

> **Caminho livre hoje:** Phase 1 inteira (a trava da fase) e quase toda a Phase 2
> — sanitização, renderização, proxy de anexo e telas rodam contra o fake. A
> governança precisa da credencial de Org Admin para valer contra a API real, mas o
> fake (T-121) permite construir e testar o console todo antes disso.

> ⚠️ **Bloqueio de produção, não de código:** `R-01`. Servir conteúdo do Confluence a
> quem não tem licença, via token admin, é exatamente o que uma auditoria leria como
> circunvenção — o requisito manda revisar com jurídico/procurement **antes de
> escalar**. Isso não impede desenvolver; impede lançar. Ver `spec.md` §7.
