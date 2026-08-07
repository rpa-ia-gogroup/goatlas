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
- [x] **T-104** [P] Teste de burla do gate de admin em **todas** as rotas de
      governança. _Requirements: RN-09, RNF-04_
      → `tests/admin-gate.test.ts`, `describe.each` sobre as seis rotas de admin
      (config, lacunas, auditoria, assentos, recomendações e `?formato=csv`):
      sem identidade, colaborador e admin, um só arquivo para que rota nova
      não dependa de alguém lembrar de escrever o bypass dela.
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

> **Estado: Phase 2 COMPLETA** (T-110 a T-118) — **348 testes** na suíte (121 novos),
> typecheck, build e bundle do worker limpos. Busca, leitura, proxy de anexo, árvore do
> espaço e o mapa de lacunas existem **com tela**, a deflexão da Regra 1 abre a página
> **dentro do app**, e os testes de burla foram escritos antes de cada rota. O que resta
> da spec 002 é a **Phase 3 (governança de assentos)**, que depende de **Q1**.

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
- [x] **T-114** [P] Tela de busca e leitura, mobile-first, com a skill
      `frontend-design` antes. _Requirements: RF-39, RF-37, RF-42, RNF-02, RNF-28_
      - Aba **"Documentação" em segundo lugar**, entre o agente e "Meus chamados": a
        ordem das abas é a recomendação do produto, a mesma sequência que a Regra 1
        impõe na conversa.
      - **Direção visual:** a espinha lime de `.doc` **estendida para trás** — cada
        resultado de busca acende a mesma espinha ao receber foco ou mouse, porque um
        resultado é a prévia de um documento citado. Vocabulário reaproveitado em vez
        de um segundo idioma para "isto vem do Confluence".
      - **O `score` não aparece.** É insumo da Regra 1 (`RF-09`), não informação
        acionável: "0,91" na tela é decoração fingindo ser dado.
      - **Os três vazios são três telas:** não buscou · sem espaço configurado
        (`buscaConfigurada: false`, e diz que é configuração) · nada documentado (nomeia
        o termo, diz que virou lacuna e oferece o agente). Com teste.
      - **Deep link sem router:** `?q=` e `?pagina=` lidos no boot, reescritos com
        `replaceState`. Não é router (Princípio V) — é o que faz link de página
        compartilhável e o que faz o link `ri:page` do próprio Confluence funcionar,
        caindo na busca pelo título (a rota de leitura pede id, e o storage dá título).
      - **Corrigido de tabela:** `.botao-discreto` não estica mais dentro de `.pilha`.
        Um "voltar" com a largura da coluna lê como faixa, não como link — vale também
        para o detalhe do chamado, que usava o mesmo padrão.
      - Verificado no navegador (`npm run dev`), inclusive a página **restrita** não
        aparecendo na busca nem abrindo por URL.
- [x] **T-118** [P] A mensagem de bloqueio da Regra 1 aponta para **dentro** do app.
      `montarMensagemBloqueio` linkava `atlassian.net` — parede para quem não tem
      assento, exatamente o público do app. A deflexão funcionava até o clique.
      _Requirements: RF-09, RF-12, RF-13, RF-39_
      - `EvidenciaRegra1.paginas` ganhou **`id`** — sem ele não há link interno
        possível. O id atravessa cliente → tool → veredito → mensagem, e o teste do
        orquestrador cobra isso ponta a ponta.
      - **O formato do link é contrato entre duas camadas** (`urlDeLeituraNoApp` em
        `rules/` e `entradaDaUrl` em `app/confluence.tsx`). O teste gera a URL num lado
        e a interpreta no outro: comentário pedindo que concordem não impediria a
        divergência silenciosa — o link continuaria bonito, levando a 404.
      - **Link interno é allowlist de FORMA**, não "começa com barra": o texto do
        agente carrega saída do modelo, que pode repetir conteúdo de página editável
        por qualquer pessoa (`R-07`). `/api/...` e caminho inventado seguem texto puro.
      - Abre em **outra aba**, de propósito: a conversa vive em estado de React, e
        navegar na mesma aba destruiria justamente o botão de override (`RF-13`) da
        pessoa que aceitou o convite de ler primeiro. Descoberto clicando, não lendo.
      - Fallback: página sem id mantém o link externo — informação vale mais que
        estética, e mostrar título sem forma de abrir seria pior.
- [x] **T-115** Árvore do espaço + breadcrumbs (`RF-41`, P1).
      _Requirements: RF-41, RN-06, RNF-13_
      - **Um nível por vez, não a árvore inteira.** A árvore completa exigiria uma
        consulta de restrição por página: um clique viraria dezenas de chamadas com a
        credencial única (`R-02`). Espaço e label entram no **CQL** (`parent = "id"`),
        como na busca; só a restrição sobra por item, presa a um teto de 50.
      - **O `pai` também passa pela verificação de exposição.** Listar os filhos de uma
        seção restrita entregaria a estrutura de dentro dela, mesmo que cada filho
        isolado fosse legítimo — e responde a mesma 404 de sempre (`D-12`), nem "lista
        vazia", que confirmaria o id.
      - **O breadcrumb PARA no primeiro ancestral não exposto.** Nomeá-lo vazaria o
        título; continuar acima dele entregaria a posição da página dentro de uma seção
        fechada. A tela não sinaliza o corte — marcador de "nível oculto" contaria
        justamente o que o corte evita.
      - `GET /api/confluence/espacos` é a **porta de entrada**: sem ela a árvore só
        seria alcançável por acidente, a partir de uma página que a busca achou. Espaço
        configurado que não resolve é omitido, não derruba a lista.
      - `MetadadosPagina` ganhou `idPai` (v2: `parentId`), e o teto de subida é 5 —
        cobre hierarquia real e protege de ciclo de `parentId`.
- [x] **T-116** Tabela `buscas` + `paginas_lidas`; registrar termo, nº de
      resultados e se houve clique. É o insumo de `O6` e de `RF-42`.
      _Requirements: RF-42, RF-58_
      - **`houve_clique` é o campo que muda o requisito de lugar.** Sem ele o mapa só
        veria busca vazia; com ele aparece o caso interessante — documentação que
        existe, aparece na busca e ninguém abre. É o "sem resultado **útil**" de
        `RF-42`, que uma contagem de buscas vazias nunca mostraria.
      - O clique chega por `?de=<buscaId>` e o **e-mail está no `WHERE`**: id de outra
        pessoa não marca nada. `via` é derivado disso no servidor, nunca recebido.
      - `termo_normalizado` em coluna própria (sem acento, sem caixa): normalizar no
        `SELECT` impediria o índice e o mapa pioraria com o uso.
      - Busca que não pôde procurar (sem espaço configurado) **não é registrada**.
- [x] **T-117** `GET /api/admin/lacunas`: buscas sem resultado + overrides da Fase 1,
      como backlog de documentação. _Requirements: RF-42, RN-09_
      - Três sinais numa resposta: **ninguém documentou** · **documentado e ninguém
        abriu** · **o que disseram ao insistir** (o motivo do override, que já vem
        escrito em linguagem humana).
      - **Conta pessoas, não as nomeia.** É backlog de escrita; nomear quem procurou
        transformaria a lista em cobrança de gente, e o histórico por pessoa já existe
        na auditoria — para investigação, que é outro propósito.
      - `agregarLacunas_apenasAdmin` carrega o sufixo no nome como
        `obterSemIsolamento_apenasReconciliacao`: é o único método do registro que
        atravessa o isolamento por e-mail, e usá-lo numa rota de colaborador precisa
        ser bug visível na revisão.
      - Aparece na **aba de admin** que já existia (`D-09`), acima da auditoria.

## Phase 3 — Governança de assentos

> **Estado (07/08/2026):** a Phase 3 está **completa em código**. T-120, T-121,
> T-104, T-124, T-125, T-126, T-127, T-128 e — desde `D-18` — T-122, T-123 e T-131.
>
> ⚠️ **O que "completo" significa aqui, e o que não significa.** `D-18` tirou as três
> do bloqueio de Q1 escrevendo `ClienteOrganizacaoHttp` contra `fetch` simulado, com
> o não verificado declarado em `ENDPOINTS_NAO_VERIFICADOS` e mostrado na tela. Em
> 07/08, medição real do tenant (`D-22`) provou que **o endpoint escolhido era o
> errado** — devolvia lista vazia com HTTP 200. Isto é a lição do `CLAUDE.md` outra
> vez: o dublê implementa o contrato *documentado*, e onde o outro lado diverge da
> documentação ele esconde a divergência em vez de revelá-la. Continua faltando uma
> passada com credencial real (**Q1**, o `ATATT`).

- [x] **T-120** `atlassian/organizacao.ts` com **transporte próprio** — não
      compartilha instância com o cliente de Jira/Confluence, para que bug de
      roteamento não faça chamada de usuário sair com credencial de Org Admin.
      _Requirements: RNF-04, RNF-22_
      → Contrato `ClienteOrganizacao` + `TransporteOrganizacao` (Bearer, backoff
      com jitter igual ao de `atlassian/http.ts`, mas instância própria — outra
      credencial, outro esquema de auth). `ClienteOrganizacaoHttp` (as chamadas de
      domínio em si) é T-122/T-123, e por isso continua bloqueado por Q1.
- [x] **T-121** [P] Fake da Organizations API, com usuários, produtos e último
      acesso. _Requirements: RNF-04_
      → `atlassian/organizacao-fake.ts`, mesmo padrão de `atlassian/fake.ts`:
      estado seedável, falha injetável por operação (`indisponivel`,
      `rate_limit`, `timeout`).
- [x] **T-122** `listarUsuarios`. `orgId` de config. _Requirements: RF-51, RNF-25_
      → ⚠️ **O endpoint mudou depois de medido** (`D-22`): era
      `GET /admin/v1/orgs/{orgId}/users`, que lista **só conta gerenciada** e devolve
      `{"data": []}` com HTTP 200 num tenant sem domínio reivindicado — o caso da
      Gocase. Agora é `POST /admin/v1/orgs/{orgId}/users/search`, com
      `accountTypes: ["atlassian"]` obrigatório e cursor reenviado no **corpo**. O
      retorno deixou de ser uma lista e passou a declarar o que não sabe:
      `suspensas` · `suspensaoConhecida` (o filtro `isSuspended` pode não filtrar, e
      isso é detectável) · `parcial` (o teto de páginas era atingido em silêncio).
- [x] **T-123** `ultimoAcesso` (`.../last-active-dates`), **carregando as limitações
      oficiais no payload**: atrasa até 24h, "ativo" = viu página por ≥2s. Elas vão
      **na tela** (`RF-52`) — sem isso alguém rebaixa quem estava de férias.
      _Requirements: RF-52_
      → `normalizarCarimbo` resolve segundos × milissegundos (55 anos de diferença
      entre "ocioso" e "acessou ontem"); na dúvida devolve `null`, porque não ter o
      dado é honesto e ter o dado errado rebaixa quem estava trabalhando.
- [x] **T-124** Tabela `inventario_assentos` + `POST /api/cron/coletar-inventario`
      diário. A API é lenta para consulta interativa, e o histórico é o que faz `O2`
      ser recorrente em vez de retrato. _Requirements: RF-51, RF-52_
      → `governanca/inventario.ts` (`RepositorioInventario`, INSERT por coleta,
      leitura pelo `MAX(coletado_em)`) + rota de cron. Sem `organizacao`/`org_id`
      configurados, a rota responde `{ ok: true, motivo: 'organizacao_nao_configurada' }`
      — RNF-18, não erro. `ultimoAcesso` que falha para uma conta não derruba a
      coleta das outras.
- [x] **T-125** `governanca/custo.ts` — funções puras: custo por produto e total,
      agregado de ocioso (sem acesso há N dias, N configurável). **Sem Q8, mostra
      contagem e marca o valor como não configurado — nunca número inventado**, que
      é pior que nenhum porque alguém decide rebaixamento com ele.
      _Requirements: RF-53_
      → `custoConfigurado` só é `true` quando TODOS os produtos do inventário têm
      preço em `custo_mensal_por_produto` (config, `RF-49`); preço parcial não
      sub-conta em silêncio, e vira `totalMensalUsd: null` do mesmo jeito que preço
      nenhum. **Não está mais bloqueada**: o comportamento sem Q8 (contagem, nunca
      dinheiro) É o entregável — só o VALOR do preço depende do financeiro, o
      mesmo raciocínio que já tirou T-113 da lista de bloqueadas por causa de Q5.
- [x] **T-126** [P] Recomendações de rebaixamento/remoção, com o caso central: quem
      tem assento cujo único uso é abrir chamado (customer de JSM é gratuito e
      ilimitado). _Requirements: RF-54_
      → `governanca/recomendacoes.ts`. Tem `jira-servicedesk` E todo o resto ocioso
      (ou não tem mais nada) → `rebaixar_para_customer`; tem algo ATIVO além do
      service desk → nenhuma recomendação (uso legítimo); sem service desk e tudo
      ocioso → `remover_ocioso`.
- [x] **T-127** [P] Exportação CSV com escape correto (vírgula e aspas em nome).
      _Requirements: RF-54_
      → `governanca/csv.ts`. Além do pedido: campo começando com `=`/`+`/`-`/`@`
      ganha prefixo `'` — nome e motivo vêm de um sistema de terceiro (a
      organização Atlassian), e injeção de fórmula em CSV aberto no Excel/Sheets é
      uma classe de vulnerabilidade real, não hipotética, para um campo que é
      literalmente o nome de alguém.
- [x] **T-128** Console de assentos: inventário, custo, ocioso, recomendações — com
      as limitações do dado visíveis. Skill `frontend-design` antes. ⚠️ A aba de admin
      **já existe** desde a Fase 1 (`D-09`, edição de config + auditoria); isto
      acrescenta a seção de assentos a ela, não cria tela nova.
      _Requirements: RF-51…RF-54, RNF-28_
      → Seção "Governança de assentos" em `admin.tsx`, entre Configuração e
      Lacunas: resumo (`.recibo`) com ociosos e custo, a limitação de RF-52 num
      `<Aviso atencao>` (não em rodapé), lista por produto e recomendações
      reaproveitando os padrões já existentes (`Selo`, `.chamados`/`.chamado`).
      Verificado em `npm run dev` com dados seedados no plugin de dev.
- [~] **T-129** [P] `GET /api/admin/auditoria` com filtro por usuário, período e
      ação + exportação (`RF-56`). **Filtro por usuário e a tela já vieram na Fase 1**
      (`D-09`); faltam **período**, **ação** e **exportação**. _Requirements: RF-56_

## Phase 4 — Fechamento

- [x] **T-130** `RF-27` completo: campos do formulário renderizados a partir do
      schema do request type. **O caminho sem IA da Fase 1 não pode regredir.**
      _Requirements: RF-27_
      → `atlassian/tipos.ts` (`CampoRequestType`) + `atlassian/cliente.ts`
      (`obterCamposDoTipo`, cache por `serviceDeskId:requestTypeId`, e a função
      pura `camposAdicionais` — filtra `summary`/`description`/`priority`, que já
      têm input fixo, e nunca duplica) + `atlassian/fake.ts`. Nova rota
      `GET /api/tipos-chamado/:id/campos` com a MESMA allowlist de RF-28 (404 fora
      dela). Os valores preenchidos chegam a `criarChamado` via
      `PayloadSubmissao.camposDinamicos` → `NovoChamado.camposDinamicos`, com
      `summary`/`description` descartados na fusão final (defesa em profundidade,
      igual RF-32). Frontend: `TelaFormulario` busca o schema do tipo selecionado e
      renderiza texto/texto longo/seleção; falha na busca (ou tipo sem schema) faz
      `campos` virar `[]` — o formulário fixo **continua funcionando** (RNF-18).
      Verificado em `npm run dev`: validação nativa bloqueia obrigatório vazio, os
      três tipos renderizam e o chamado abre com os valores corretos.
- [x] **T-131** `RF-57` (P2): revogar produto pelo console, **dupla confirmação** e
      auditoria. Única escrita da credencial de Org Admin.
      _Requirements: RF-57, RN-10_
      → `revogarProduto` **não engole erro**: um `catch` aqui devolveria "revogado"
      para a tela enquanto o assento segue ativo, e o admin marcaria como capturada
      uma economia que não aconteceu. ⚠️ **Continua o menos verificável dos três**
      (`ENDPOINTS_NAO_VERIFICADOS`), e `D-22` acrescenta um motivo que não é de
      contrato: **nenhuma** chave de API opera sobre conta **não gerenciada**, e a org
      não reivindicou domínio — então a escrita responde 403 hoje
      independentemente de credencial. Destravar é reivindicar `gocase.com`.
- [x] **T-132** Fechar os Success Criteria da spec 002 item por item.
      _Requirements: todos_
      → **ScC-1** (leitura sem licença, sem vazar restrita/fora da allowlist):
      satisfeito — `tests/rf40-leitura-direta.test.ts` prova o mesmo 404 para
      espaço fora da allowlist, label bloqueada, restrição e lixeira (`D-12`);
      `tests/rf40-restricao-pagina.test.ts` cobre as três condições de RN-06
      juntas. **ScC-2** (console mostra gasto e ocioso, com limitação do dado
      de último acesso visível): satisfeito na estrutura — `admin.tsx` exibe o
      aviso de `limitacoesUltimoAcesso` e nunca inventa valor
      (`custo.ts` + `tests/custo.test.ts`); o **valor** em R$ segue
      `custoConfigurado: false` até **Q8** responder, que é o fail-closed
      correto, não uma lacuna. **ScC-3** (recomendações reproduzem a Fase 0
      manual): satisfeito — `recomendacoes.ts` implementa as duas regras da
      Fase 0 (`docs/REQUISITOS.md` §Fase 0: rebaixar quem só usa service desk,
      remover quem não acessa há N dias), testado em
      `tests/governanca.test.ts`. **ScC-4** (nenhum não-admin alcança rota de
      governança): satisfeito — `tests/admin-gate.test.ts` testa TODAS as
      rotas `/api/admin/*` (inclusive `assentos` e
      `assentos/recomendacoes`) sem identidade, com não-admin e com admin.
      3 de 4 critérios sem ressalva; ScC-2 depende de Q8 para o número, não
      para o comportamento.

---
## Coverage check
- [x] Todo RF/RNF no escopo da spec aparece em ao menos uma tarefa
- [x] Toda tarefa referencia requisito
- [x] Os testes de burla (T-101 a T-104) vêm **antes** da implementação
      — T-101 escrito e vermelho antes de T-105/T-106 existirem; T-102 e T-103
      escritos e vermelhos (36 casos) antes de T-110/T-111/T-112 existirem; T-104
      acompanha a governança da Phase 3, pelo mesmo motivo
- [x] **Nenhuma `[BLOQUEADA]`** — as três últimas (T-122/T-123/T-131) saíram em
      `D-18`, e `D-22` corrigiu o endpoint de T-122 contra medição real.
      ⚠️ **"Não bloqueada" não é "verificada":** falta a passada com o `ATATT`
      (**Q1**), e a escrita de T-131 depende de reivindicar o domínio, que não é
      credencial.
      T-113 e T-125 saíram da lista antes: o código está pronto e o que falta de **Q5**/
      **Q8** é **dado de config**, não implementação — com `espacos_confluence`
      vazio a busca devolve zero e diz `buscaConfigurada: false`, e sem
      `custo_mensal_por_produto` o console mostra contagem e `custoConfigurado:
      false`. Os dois são o fail-closed correto, não uma lacuna de código.

> **Caminho livre hoje:** Phase 1 inteira (a trava da fase), toda a Phase 2, e a
> Phase 3 quase inteira — sanitização, renderização, proxy de anexo, telas,
> inventário de assentos, custo, recomendações e CSV rodam contra o fake. Só
> T-122/T-123 (as chamadas de domínio reais) e T-131 (revogar produto) esperam a
> credencial de Org Admin — o fake (T-121) e o transporte (T-120) é o que permitiu
> construir e testar o console inteiro antes disso.

> ⚠️ **Bloqueio de produção, não de código:** `R-01`. Servir conteúdo do Confluence a
> quem não tem licença, via token admin, é exatamente o que uma auditoria leria como
> circunvenção — o requisito manda revisar com jurídico/procurement **antes de
> escalar**. Isso não impede desenvolver; impede lançar. Ver `spec.md` §7.
