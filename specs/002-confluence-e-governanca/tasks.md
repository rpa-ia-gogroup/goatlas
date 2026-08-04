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

> **Estado: a trava está fechada.** T-101, T-105, T-106 e T-107 concluídos —
> **227 testes** na suíte (58 novos), typecheck e build limpos. T-102 e T-103 vieram
> com as rotas que testam (Phase 2), escritos antes delas. T-104 testa a governança
> da Phase 3 e vem com ela, pelo mesmo motivo.

- [x] **T-101** Teste de burla da sanitização: `<script>`, `onerror`/`onclick`,
      `javascript:`, `data:`, `<iframe>`, `<object>`, tag malformada, atributo com
      maiúsculas e espaços (`ON ERROR =`), entidade HTML disfarçando `<`.
      → `tests/rnf06-sanitizacao.test.ts`, **58 casos**. Testa o caminho **inteiro**
      (`sanitizarStorage` **+** `renderizarNos` + `renderToStaticMarkup`), não só o
      sanitizador: árvore limpa que o renderizador reinjeta como HTML não vale nada.
      Cobre além do pedido: dupla codificação (`&amp;lt;script&amp;gt;`), `//`
      protocolo-relativo, `java\tscript:`, CDATA sem expansão de entidade, e limites
      de profundidade/tamanho. _Requirements: RNF-06_
- [x] **T-102** [P] Teste de burla do proxy de anexo: anexo de página restrita;
      `Content-Type: text/html` vindo da Atlassian.
      → `tests/anexo-proxy.test.ts`, **19 casos**. Além do pedido: SVG não inline,
      tipo com CRLF, **nome de arquivo com CRLF e aspas** (ele entra num cabeçalho
      HTTP e é escolhido por quem edita a página), anexo de outra página, teto de
      tamanho, `Cache-Control` privado. _Requirements: RNF-06, RN-06_
- [x] **T-103** [P] Teste de burla de leitura direta: URL de página restrita e de
      espaço fora da allowlist.
      → `tests/rf40-leitura-direta.test.ts`, **17 casos**. Além do pedido: as
      recusas são **indistinguíveis entre si** (`D-12`), o **corpo da página negada
      nunca é buscado**, allowlist vazia não gasta requisição, indisponibilidade não
      vira 404, e um teste **estrutural** garantindo que só `confluence/acesso.ts`
      chama `obterCorpoStorage` — o gate só é trava se não houver desvio.
      _Requirements: RF-40, RN-06, RNF-09_
- [ ] **T-104** [P] Teste de burla do gate de admin em **todas** as rotas de
      governança. _Requirements: RN-09, RNF-04_
- [x] **T-105** `confluence/sanitizar.ts`: **allowlist** de tags e atributos (nunca
      blocklist), storage format → **árvore de nós tipada**, `href`/`src` só
      `http(s)`. Faz T-101 passar. _Requirements: RNF-06_
      - **Duas passagens**, de propósito: tokenizar + árvore bruta (malformado e
        limites) → converter (allowlist). Misturar as duas espalha a checagem por
        cima do tratamento de erro de parse, e aí um caminho de recuperação vira um
        caminho sem checagem. A árvore bruta não é exportada.
      - `urlSegura`: **decodificar entidade → limpar controle/espaço → exigir
        `^https?://`**. Nessa ordem, e como allowlist — não se pergunta "é
        `javascript:`?".
      - `decodificarEntidades` é **uma passagem só**: `&amp;lt;` para em `&lt;`. Laço
        "decodifica até não mudar" é o bug clássico que transforma dupla codificação
        em tag.
      - Imagem externa recusada (**D-10**), e limites de entrada/profundidade/nós —
        conteúdo hostil não precisa de script para derrubar o Worker.
- [x] **T-106** `confluence/renderizar.tsx`: árvore → elementos React. **Zero
      `dangerouslySetInnerHTML`** — não deve existir caminho em que string vira
      HTML. _Requirements: RNF-06, RF-39_
      - É a **segunda camada**: revalida toda URL ao virar `href`/`src`, inclusive as
        que já chegam prontas na árvore. Nó construído à mão (cache, importação,
        migração) não é nó confiável.
      - Nenhum nó de `No` carrega saco de atributos — não existe onde um `onerror`
        viajar. O `switch` é exaustivo e o tipo é união fechada.
      - Teste estrutural na suíte: **nenhum arquivo de `src/` usa**
        `dangerouslySetInnerHTML`. A regra não depende de alguém lembrar.
      - Visual em `estilos.css` (`.doc*`): conteúdo como **citação**, com a espinha
        lime; painel e placeholder com rótulo textual, nunca só cor.
- [x] **T-107** Macro não suportada → placeholder **visível** (`RF-43`). Macro que
      desaparece em silêncio faz o leitor decidir com informação faltando sem saber
      que falta. _Requirements: RF-43_
      - O placeholder diz três coisas: que falta algo, **qual** bloco, e que o resto
        do texto está inteiro. Só o **nome** da macro — parâmetro (JQL, id de filtro,
        chave de espaço) descreve estrutura interna. Tem teste para isso.
      - Reaproveita o tracejado que a trilha já usa para "não foi possível".

## Phase 2 — Confluence como superfície

> **Estado: T-110, T-111, T-112 e T-113 concluídos** — **293 testes** na suíte (66
> novos), typecheck, build e bundle do worker limpos. Busca, leitura direta e proxy de
> anexo existem, com os testes de burla escritos antes. ⚠️ **Nenhuma tela ainda os
> consome** — T-114 é a próxima.

- [x] **T-110** `obterPagina` no cliente isolado (v2: `/wiki/api/v2/pages/{id}`),
      com cache. _Requirements: RF-39, RNF-13, RNF-22_
      - **Virou dois métodos, de propósito:** `obterMetadadosPagina` (o que basta
        para DECIDIR exposição) e `obterCorpoStorage` (o conteúdo). A ordem
        metadados → decidir → conteúdo é o que impede o corpo de página negada de
        entrar na memória do app. `obterAnexo` veio com T-112.
      - ⚠️ **A v2 devolve `spaceId` numérico; a allowlist de `RN-06` é por CHAVE de
        espaço.** O cliente resolve id → chave (`/wiki/api/v2/spaces/{id}`, cacheado
        nos metadados) e **lança** se não resolver. Comparar a allowlist com o id não
        dá erro visível — dá uma condição que nunca reprova.
      - Labels vêm em requisição separada (a v2 não as embute) e **sem `try/catch`**:
        sem elas não há como avaliar a segunda condição, e ausência de informação é
        negar.
      - Cache de metadados, espaço e corpo (`RNF-13`) — sem ele cada leitura são
        quatro chamadas, e o app vira amplificador (`R-02`).
- [x] **T-111** `GET /api/confluence/pagina/:id` repassando as **três** condições de
      `RN-06` — a mesma verificação da busca, restrição de página incluída. Faz
      T-103 passar. _Requirements: RF-40, RN-06_
      - As três condições moram em `confluence/acesso.ts`, **um lugar só**, usado
        também pelo anexo. Reimplementar por rota faria "esta rota checou as três?"
        virar uma pergunta que se responde lendo três arquivos.
      - `lerPaginaAutorizada` **sanitiza antes de devolver**: nenhuma rota recebe
        storage cru, então `RNF-06` não depende de cada rota lembrar. A resposta é só
        a **árvore** — não existe campo com HTML.
      - Toda recusa devolve a **mesma** 404; indisponibilidade devolve 503 (`D-12`).
        Página em lixeira/rascunho não é exposta.
      - A leitura entra no rate limit de `RNF-11` (antes só `POST` entrava): quatro
        chamadas à Atlassian por leitura consomem o orçamento da credencial única
        igual a um `POST`, só sem criar nada — o que faz parecer inofensivo.
- [x] **T-112** Proxy de anexo: as três condições + `Content-Type` conferido
      (imagem/PDF passam, resto vira download com `nosniff`). Faz T-102 passar.
      _Requirements: RNF-02, RNF-06_
      - O tipo da Atlassian **nunca é repassado**: allowlist decide (`D-11`), e
        `image/svg+xml` fica fora — SVG é documento com script.
      - O **nome do arquivo** é entrada não confiável num cabeçalho HTTP: `filename`
        ASCII saneado + `filename*=UTF-8''…` para o acento.
      - O anexo é casado por nome **na lista de anexos daquela página**, e
        `downloadLink` só é seguido se for caminho absoluto do próprio site — link
        para outro host faria o app buscar **com a credencial** onde a resposta
        mandasse.
      - Teto de tamanho em duas conferências (tamanho anunciado e `Content-Length`),
        porque o Worker não tem streaming aqui e o arquivo passa inteiro pela memória.
- [x] **T-113** [P] `GET /api/confluence/busca` como superfície própria (reusa o que
      a Regra 1 já usa). **Código pronto; o que falta de Q5 é DADO de config
      (`espacos_confluence`), não implementação.** _Requirements: RF-37, RF-38_
      - **A allowlist não é parâmetro.** `?espacos=`, `?espacosPermitidos=` e
        `?labelsBloqueadas=` são ignorados — ela vem da config, sempre. É o mesmo
        raciocínio de `RF-04`/`RNF-05` para a identidade: o cliente não escolhe o
        próprio escopo. Tem teste de burla.
      - `q` tem mínimo e máximo, e `?limite=` é **clampado**: cada resultado custa uma
        consulta de restrição de página, então `limite=9999` seria varredura do site
        pagando por página (`R-02`).
      - **Os dois zeros são distinguidos.** Zero por falta de espaço configurado
        devolve `buscaConfigurada: false`; zero por falta de documentação registra a
        lacuna de `RF-42` — na **mesma forma** que a Regra 1 grava, para T-117 ler uma
        coisa só. Registrar lacuna quando não havia onde procurar envenenaria o mapa
        com termos que ninguém deixou de documentar.
      - Indisponibilidade responde **503**, nunca "nenhum resultado" (`RNF-18`): numa
        queda, "não achei" empurra a pessoa a abrir chamado por algo documentado.
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
      as limitações do dado visíveis. Skill `frontend-design` antes. ⚠️ A aba de admin
      **já existe** desde a Fase 1 (`D-09`, edição de config + auditoria); isto
      acrescenta a seção de assentos a ela, não cria tela nova.
      _Requirements: RF-51…RF-54, RNF-28_
- [~] **T-129** [P] `GET /api/admin/auditoria` com filtro por usuário, período e
      ação + exportação (`RF-56`). **Filtro por usuário e a tela já vieram na Fase 1**
      (`D-09`); faltam **período**, **ação** e **exportação**. _Requirements: RF-56_

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
      — T-101 escrito e vermelho antes de T-105/T-106 existirem; T-102 e T-103
      escritos e vermelhos (36 casos) antes de T-110/T-111/T-112 existirem; T-104
      acompanha a governança da Phase 3, pelo mesmo motivo
- [ ] **Nenhuma `[BLOQUEADA]`** — há **4**: T-122/T-123/T-131 (Q1), T-125 (Q8).
      T-113 saiu da lista: o código está pronto e o que falta de **Q5** é **dado de
      config**, não implementação — com `espacos_confluence` vazio a busca devolve
      zero e diz `buscaConfigurada: false`, que é o fail-closed correto

> **Caminho livre hoje:** Phase 1 inteira (a trava da fase) e quase toda a Phase 2
> — sanitização, renderização, proxy de anexo e telas rodam contra o fake. A
> governança precisa da credencial de Org Admin para valer contra a API real, mas o
> fake (T-121) permite construir e testar o console todo antes disso.

> ⚠️ **Bloqueio de produção, não de código:** `R-01`. Servir conteúdo do Confluence a
> quem não tem licença, via token admin, é exatamente o que uma auditoria leria como
> circunvenção — o requisito manda revisar com jurídico/procurement **antes de
> escalar**. Isso não impede desenvolver; impede lançar. Ver `spec.md` §7.
