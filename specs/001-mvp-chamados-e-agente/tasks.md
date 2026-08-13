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
      ✅ **Fechada em 12/08/2026 (`D-58`), e a resposta é que ela não bloqueia nada.** O app
      **não confia no edge**: `RF-01`/`RF-05` revalidam o domínio no servidor contra
      `dominios_permitidos`, e sem identidade injetada nada passa. Medido hoje: login
      `@gocase.com` chega com o header, e `/api/health` reporta `sso: edge GoDeploy`.
      ⚠️ O que **continua sem resposta** é o comportamento com conta desativada — e ele é
      inócuo aqui por construção: conta desativada não completa o OAuth, e se completasse a
      allowlist de domínio ainda decidiria. Registrar em `D-02` deixou de ser pré-requisito
      de qualquer coisa.
- [x] **T-022** [P] Perfil admin por allowlist explícita, configurável sem deploy.
      _Requirements: RF-02, RN-09_
- [~] **T-023** [P] Sessão com expiração configurável e logout explícito.
      **Parcialmente atendida, por decisão `D-08`:** a expiração existe (é do edge do
      GoDeploy), mas **não há logout na interface** — trocar de conta não é caso de uso,
      e botão de sair em computador compartilhado convida confusão. ⚠️ `RF-03` é P0 e
      pede logout explícito, então **falta o aval do João** para isso virar alteração
      de `REQUISITOS.md`. Fica `[~]`, não `[x]`. _Requirements: RF-03, D-08_
      ⚠️ **A auditoria de 12/08 (`D-47`) mostrou que a nota acima descrevia só metade.**
      `RF-03` tem duas cláusulas e **nenhuma das duas está no código**: além do logout,
      "sessão com expiração **configurável**" não existe — não há chave de sessão em
      `ConfigValores` (`src/lib/config/index.ts:22-144`), e a expiração é a do edge do
      GoDeploy (`D-02`), que o app não configura nem observa. Dizer "a expiração existe (é
      do edge)" é verdade sobre o produto e falso sobre o requisito, que pede
      *configurável*. Ao levar `D-08` ao João, levar as duas cláusulas: o que se decide é
      se `RF-03` vira "sessão é responsabilidade do edge, sem logout no app" — e aí a
      emenda é em `docs/REQUISITOS.md`, não uma tarefa aberta para sempre.
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
- [~] **T-029** [P] `GET /api/health` com Atlassian, IA, banco e SSO.
      _Requirements: RF-59_
      ⚠️ **Estava `[x]`; três das quatro dependências são sondadas de verdade** (auditoria
      de 12/08, `D-47`). Atlassian (`src/lib/http/rotas.ts:2090`), IA (`:2091`) e banco
      (`:2098-2102`) consultam. **O SSO é literal:**
      `sso: { ok: true, detalhe: 'edge GoDeploy' }` (`rotas.ts:2119`) — responde `ok`
      sempre, inclusive com o edge fora do ar. É o pior estado para uma dependência:
      silenciosa exatamente quando cai. ⚠️ **E o teste congela o placeholder**
      (`tests/rotas.test.ts:100-104` cobra só a *presença* da chave), então trocá-lo por
      uma sonda real não quebra nada — e mantê-lo assim também não.
      ⚠️ Pode ser que não haja o que sondar (o edge responde antes do worker; se ele cair,
      `/api/health` nem é alcançado). Se for esse o caso, o honesto é **dizer isso no
      campo** — `detalhe: 'não sondável: o edge responde antes do worker'` — em vez de
      afirmar `ok: true`. Mesma regra de `suspensaoConhecida` e `custoConfigurado`.
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
- [~] **T-047** Mensagem de bloqueio com os **três** elementos (regra, motivo
      legível, link). A redação define a percepção do produto — soa como ajuda, não
      recusa. _Requirements: RF-12, RNF-30, RNF-31_
      ⚠️ **Estava `[x]`; vale para a Regra 1, não para a Regra 2** (auditoria de 12/08,
      `D-47`). O texto de `RF-12` pede o link "**sempre na Regra 1, e na Regra 2 quando
      houver documentação relacionada**". Na Regra 1 os três elementos existem e são
      testados. Na **Regra 2 não existe link nenhum**, e não há caminho que possa trazer
      um: `montarMensagemBloqueio` só lista `issueKey`
      (`src/lib/rules/index.ts:206-219`) e `EvidenciaRegra2` (`rules/index.ts:29-32`) não
      carrega páginas — o tipo não tem onde guardar documentação relacionada. Sem teste.
      ⚠️ É a metade do bloqueio que mais depende de `RNF-31` ("o bloqueio precisa soar como
      ajuda"): bloquear por recorrência **sem** apontar o que ler é a versão do bloqueio
      mais próxima de uma parede, que é o que `RF-13`/`RN-07` existem para evitar.
- [x] **T-048** Override: prossegue, registra tentativa **e** override, alimenta o
      backlog de documentação. _Requirements: RF-13, RN-07, RF-42_
- [x] **T-049** Falha de tool → informa e marca ticket como **não verificado**;
      nunca silencia a regra. _Requirements: RNF-18, RNF-19_
- [x] **T-050** Priorização automática em 3 níveis com SLA de **primeira resposta**
      correspondente. _Requirements: RF-15, RN-08_

## Phase 4 — Criação de chamado

- [x] **T-059** *(13/08/2026, `D-70`)* A extração recebe os tipos **com nome** e limitados ao
      service desk configurado — `tickets/tipos-oferecidos.ts`, uma regra para os três leitores
      (rota do formulário, cartão de `D-53`, extração). Antes ia
      `map((id) => ({ id, nome: id }))`, e o modelo escolhia a fila do chamado entre números:
      *"meu PC desliga sozinho"* saiu como o tipo `92`, "Problema com Nota Fiscal específica ou
      grupo de Notas". Falha de leitura **não** cai para os ids — sem nome não há proposta.
      _Requirements: RF-15, RF-18, RF-28, RNF-16, RNF-18_
- [x] **T-060** Outbox: persistir submissão **antes** da chamada; estados; chave de
      idempotência única no banco. Faz T-016 e T-017 passarem.
      _Requirements: RF-24, RNF-17_
- [x] **T-061** `POST /api/conversas/:id/confirmar` — a **única** transição que
      autoriza criar; o modelo não tem tool equivalente. Faz T-011 passar.
      _Requirements: RF-17, RN-02_
- [~] **T-062** Resumo estruturado antes de confirmar (título, descrição, tipo,
      componente, área, prioridade, SLA) com **prioridade editável**.
      _Requirements: RF-16, RF-18_
      ⚠️ **Estava `[x]`; o recibo mostra 5 dos 7 campos** (auditoria de 12/08, `D-47`).
      `src/app/telas.tsx:453-513` imprime título, descrição, área, prioridade e prazo, e a
      prioridade é editável (`telas.tsx:380,473-503` + `PUT …/proposta`,
      `src/lib/http/rotas.ts:273-286`) — `RF-16` está atendido **na tela**.
      Faltam dois: **tipo de chamado não é exibido** (o `tipoChamadoId` só serve para
      buscar o schema, `telas.tsx:397-423`) — e é justamente o campo que decide **em que
      fila o chamado cai**, o que a pessoa não tem como conferir antes de confirmar —, e
      **componente não existe em lugar nenhum**: é sempre `null`
      (`src/lib/agent/orquestrador.ts:357`) e `PROMPT_EXTRACAO` nem pede o campo
      (`src/lib/ia/prompts.ts:245`).
      ⚠️ O teste `tests/rf18-recibo-confirmacao.test.ts:49-54` cobra título, descrição e
      área — **não cobra as duas ausências**, que é o motivo de elas terem sobrevivido.
      ⚠️ **Componente pode ser requisito morto:** nenhum request type do `GN` foi medido
      expondo componente, e `D-36` diz que campo do Jira só significa algo dentro do
      request type. Decidir entre implementar e emendar `RF-18` em `docs/REQUISITOS.md` —
      o que não vale é seguir com o board dizendo que o recibo tem sete campos.
- [x] **T-063** `criarChamado` via `POST /rest/servicedeskapi/request` com a conta de
      serviço como reporter. _Requirements: RF-20_
      → **Saiu do bloqueio e EXECUTOU contra a Atlassian real** (11/08/2026, `GN-6894`,
      `HTTP 201`), pela staging com o somente-leitura desligado por ~30 s. O código vive
      em `src/lib/atlassian/cliente.ts:480` (`criarChamado`), com o `POST` no endpoint
      exato do requisito em `cliente.ts:499`. Q1 está respondida desde `D-23`.
      ⚠️ **A linha ficou `[ ] [BLOQUEADA: Q1]` por mais de um dia depois de a chamada ter
      rodado em produção** — o board subestimava, que é a mesma classe de defeito de
      `T-081`, na direção oposta. Achado da auditoria de 12/08 (`D-47`).
- [~] **T-064** Gravar solicitante real no campo customizado "Solicitante" e como
      request participant quando aplicável.
      _Requirements: RF-21, R-03_
      ⚠️ **Rebaixada de `[x]` pela auditoria de 12/08 (`D-47`) — não por defeito novo, mas
      porque `RF-21` é P0 e tem um "e".** A metade do campo customizado está sólida e nos
      dois caminhos de criação (`src/lib/tickets/campos-do-solicitante.ts:84`,
      `rotas.ts:485` no formulário e `rotas.ts:339` na conversa, com o mapa por request type
      de `D-36`). A metade do **request participant não existe** — zero ocorrência de
      `requestParticipants` em `src/` — e está adiada com razão registrada logo abaixo
      (depende de `accountId`, que não existe sob `D-01`).
      ⚠️ O que muda é só o board **não afirmar** que `RF-21` está completo: ou a cláusula
      entra pela migração de `RNF-22`, ou `docs/REQUISITOS.md` é emendado para dizer que sob
      proxy total ela não se aplica. Ficar `[x]` sem uma das duas é o padrão que produziu
      `T-081`.
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
- [~] **T-067** Confirmação final: chave, prioridade, prazo de primeira resposta e
      link de acompanhamento **interno**. _Requirements: RF-26_
      ⚠️ **Estava `[x]`; três dos quatro** (auditoria de 12/08, `D-47`). Chave, prioridade e
      prazo de primeira resposta saem na resposta (`src/lib/http/rotas.ts:1854-1880`) e na
      tela (`src/app/telas.tsx:594-645`). O **"link para acompanhamento"** é um botão que
      leva à **lista** de chamados (`telas.tsx:637`), não ao chamado recém-criado — quem
      acabou de abrir precisa procurá-lo entre os outros, no momento em que ele é o único
      que importa. ⚠️ E o componente `ChamadoAberto` **não tem teste nenhum** (não aparece
      em `tests/`), que é por que isso passou.
- [x] **T-068** Cron `POST /api/cron/reprocessar-submissoes` (valida
      `X-Godeploy-Cron`) + job no GoDeploy. _Requirements: RNF-17_
- [x] **T-069** Cron `POST /api/cron/reconciliar-vinculos`: varre o Jira pelo campo
      "Solicitante" e reconstrói vínculo órfão. **[BLOQUEADA: Q4]**
      _Requirements: RNF-21_
- [x] **T-070** Formulário mínimo sem IA (`D-04`): mesmas travas de servidor, marcado
      como **não verificado pelas regras**, e mensurável. Faz parte de T-017/`RNF-18`.
      _Requirements: RF-27 (parcial), RNF-18_

## Phase 5 — Acompanhamento

- [~] **T-080** `GET /api/chamados` filtrado por vínculo **no servidor**: resumo,
      status, prioridade, SLA, última atualização. Faz T-012 passar.
      _Requirements: RF-29, RF-30, RN-04_
      ⚠️ **Estava `[x]`; 3 dos 5 campos de `RF-29` existem** (auditoria de 12/08, `D-47`).
      Resumo, status e prioridade saem na rota (`src/lib/http/rotas.ts:650-652`) e na tela
      (`src/app/telas.tsx:840-847`). Faltam dois: **`SLA` não existe em ponto nenhum** da
      lista — é a mesma causa raiz de T-100 — e **a data da última atualização volta na
      rota (`rotas.ts:653`) e a tela não a imprime** (`.chamado-meta`, `telas.tsx:846-850`,
      mostra prioridade, selo e área; nenhuma data em `telas.tsx`). O isolamento de
      `RF-30`/`RN-04` continua íntegro e testado — o que falta é superfície.
- [~] **T-081** Detalhe: descrição, campos, comentários **públicos**, anexos, status,
      histórico de SLA — sem campo interno. _Requirements: RF-31_
      🚨 **Estava `[x]` e o requisito tem SEIS itens — três estão prontos.** É o achado que
      abriu a auditoria de 12/08 (`D-47`): uma linha marcada cedo demais escondeu um **P0**
      por semanas, e ninguém tinha como perceber lendo o board.
      ✅ **Descrição** (`rotas.ts:718` → `telas.tsx:997`) · **comentários públicos**
      (`rotas.ts:710-726` → `telas.tsx:1074-1084`, com `D-43`) · **status**
      (`telas.tsx:978`).
      ✅ **Anexos** — era o achado que abriu a auditoria: não existia rota nem método de
      cliente que **listasse** o que está anexado a um chamado, e a seção "Anexos" da tela
      era só formulário de envio; depois de anexar, a pessoa nunca mais via o que anexou.
      **Feito em T-084** (`D-45`).
      ❌ **Histórico de SLA** — ver **T-100**.
      ⚠️ **Campos: parcial.** A rota devolve `via`, `verificadoRegras`, `area`, `criadoEm` e
      `atualizadoEm` (`rotas.ts:717-732`) e a tela imprime só status, prioridade e o selo
      (`telas.tsx:977-981`) — área e as duas datas são descartadas na renderização. E os
      **campos dinâmicos** do request type (`RF-27`), gravados em
      `submissoes.payload.camposDinamicos`, nunca são relidos: `obterChamado` extrai apenas
      `summary`, `description` e `priority` de `requestFieldValues` (`cliente.ts:524-536`).
- [x] **T-082** Comentar publicamente, atribuído de forma legível ao solicitante real.
      _Requirements: RF-33_
      → **Resolvida (D-13):** prefixo `**Nome** (email) via goatlas:` no corpo do
      comentário, com nome/e-mail do login corporativo Google — visível no Jira
      nativo, sem precisar do console do goatlas. A função pura já existia
      (`atlassian/comentarios.ts#prefixarAutoria`, escrita quando a pergunta ainda
      estava aberta); faltava a rota passar `eu.nome`, não só `eu.email` — sem
      isso o prefixo saía com o e-mail duplicado. 1 teste novo em
      `tests/rotas.test.ts` confirmando o nome real chegando ao cliente Atlassian.
- [x] **T-083** A tela do chamado diz de quem é cada comentário — sem inventar
      identidade que o app não tem. _Requirements: RF-31, RF-32, RF-33, RN-05, RNF-30_
      → **Resolvida (D-43, 12/08/2026), a partir de defeito medido na staging
      (`GN-6897`):** o comentário que a própria pessoa escreveu aparecia assinado
      pela **conta de serviço** — hoje a conta pessoal de um colega — com o prefixo
      de `D-13` logo abaixo dizendo outro nome. Quem classifica passou a ser
      `ehComentarioDoSolicitante`, o **mesmo** predicado do SLA de `RF-46`, numa
      função pura (`tickets/comentario-exibicao.ts`) que é o único caminho de "corpo
      cru" para "o que a tela mostra" — comparação nova de nome ou e-mail na tela
      seria uma segunda regra divergindo em silêncio da do servidor. A tela diz
      "Você" ou "Resposta do time" e nomeia a conta como **registro**
      (`Conta que registrou: …`), nunca como autoria: quem responde pelo portal com
      a conta de serviço não é distinguível, e o app não afirma o que não sabe. O
      prefixo sai do corpo exibido (`removerPrefixoAutoria`, o par de `RF-48`).
      ⚠️ **O `ClienteAtlassianFake` escondia a divergência** — guardava o texto sem
      prefixo e com o nome do autor real, o oposto de produção nas duas pontas;
      corrigi-lo não quebrou nenhum teste existente, que é a medida do ponto cego.
      8 testes novos em `tests/rf33-autoria-na-tela.test.ts`, um deles estrutural.
- [x] **T-084** A pessoa vê os anexos do próprio chamado — a parte de `RF-31` que
      `T-081` não entregou. _Requirements: RF-31, RF-30, RF-32, RN-05, RNF-02, RNF-18_
      → **Resolvida (D-45, 12/08/2026), a partir de defeito medido na staging
      (`GN-6898`):** o chamado nasceu com arquivo anexado (`RF-63` funcionando) e o
      detalhe não devolvia campo de anexo nenhum — a pessoa mandava o print e nunca
      mais o via. 🚨 **A lista da Atlassian não serve como está:** a documentação do
      endpoint diz *"customers will only get a list of public attachments"*, ou seja o
      filtro é pelo **papel de quem pergunta**, e sob `D-01` quem pergunta é sempre a
      conta de serviço, que é agente — anexo de comentário **interno** viria com HTTP
      200 direto para a tela (`RN-05` na versão arquivo). São duas fontes cruzadas:
      `listarAnexosDoChamado` prova que **existe**, o comentário público que o carrega
      prova que é **público**, e a interseção é o que se mostra
      (`tickets/anexos-do-chamado.ts`, função pura). Existir sem prova não vira lista
      vazia — vira `anexosIndisponiveis`, porque "não tem anexo" e "não deu para saber"
      são frases opostas (o mesmo par de `comentariosIndisponiveis`). O download é do
      app (`RNF-02`), reusando `decidirEntrega`/`CABECALHOS_ANEXO` de `D-11`, com
      vínculo por e-mail no `WHERE` e **404, nunca 403**. A expansão `attachment` dos
      comentários é **tentada**: 4xx repete sem ela, para `RF-32` (P0) não cair junto.
      ⚠️ **O fake devolve TAMBÉM o anexo interno**, de propósito — dublê que filtrasse
      deixaria o teste de `RN-05` passar por construção (família de `D-38`/`D-43`).
      32 testes novos (`tests/rf31-anexos-do-chamado.test.ts` e o cliente real), 8 de
      burla e de degradação. ⚠️ **O campo de arquivo do detalhe recebeu o tratamento de
      `D-46`** — que nasceu na tela de criação e deixou esta de fora de propósito: o
      `input` sai por `clip`, o `label` vira o botão e o anel de foco é reemitido nele.
      O par estrutural do teste de lá está aqui, para a segunda superfície não regredir
      sozinha.

      🚨 **Emendada em 12/08/2026 por `D-51`, com a medição da própria correção:** com
      `D-45` no ar, o `GN-6898` respondeu `anexos: [], anexosIndisponiveis: true` — e
      tinha um arquivo, enviado pelo app. O cuidado correto para o anexo do **time**
      virou silêncio sobre o da própria pessoa. Faltava a distinção entre as duas
      origens: o que passou por nós tem prova nossa (upload autenticado daquela pessoa,
      chamado com vínculo dela, impossível ser de comentário interno) e entra na lista
      **sempre**, vindo de `anexos_enviados` — tabela permanente, gravada na
      materialização de `RF-63` e na rota de `RF-34`, lida com o e-mail no `WHERE`. O
      anexo do time continua pela interseção de `D-45`, e o teste de burla que o mantém
      fora segue verde. ⚠️ `anexosIndisponiveis` passou a falar **só** do time, então
      deixou de esconder a lista; os três casos de degradação foram atualizados.

## Phase 6 — Frontend, mobile e fechamento

- [x] **T-090** Tela de conversa com **indicação de progresso** das duas
      verificações (elas rodam antes de o agente poder concluir).
      _Requirements: RF-07, RNF-12_
- [x] **T-091** [P] Telas "Meus chamados" e detalhe. _Requirements: RF-29, RF-31_
- [x] **T-092** [P] Erros em linguagem de negócio, nunca stack trace nem HTTP cru;
      erro de frontend encaminhado ao backend. _Requirements: RNF-30, RNF-26_
- [~] **T-093** ~~Validação real **no celular** do fluxo completo.~~ _Requirements: RNF-28_
      ✂️ **Removida em 12/08/2026 por decisão do mantenedor (`D-58`).** A tela foi verificada
      em viewport de celular no dev; validação em aparelho real deixou de ser condição de
      pronto, e o item saiu da §13 dos requisitos junto.
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
- [x] **T-135** 🚨 O schema era reaplicado **por requisição**: 36 idas ao banco antes
      de qualquer rota trabalhar.
      _Requirements: RNF-36, D-35_
      → Relato do usuário em 10/08/2026: "tudo demora pra aparecer, até a tela de
      admin mesmo já estando logada" — e o "já estando logada" é o que descarta o
      OAuth do edge. `montarContexto` roda a cada requisição `/api/*` (é ele que
      resolve `CONFIG_PADRAO → env → banco`, para config mudada no console valer na
      requisição seguinte) e começava por `migrar`, que aplicava os 32 statements de
      DDL (17 tabelas + 15 índices) mais os 3 `ALTER` **em série**. Medido com um espião
      em volta do `Banco`: **36 idas → 1** (mesmo isolate) ou **2** (isolate novo,
      pela sonda). No app publicado era piso de **442 ms** no cron mais barato
      (`enviar-notificacoes` sem nada a enviar, que praticamente só monta contexto),
      e o console de admin dispara **seis** requisições paralelas no boot.
      ⚠️ **Nenhum dos 763 testes podia pegar:** o comportamento estava *correto*, só
      caro — `IF NOT EXISTS` é idempotente, e no shim em memória cada statement custa
      microssegundos. O custo é de **rede** e só existe na plataforma; mesma família de
      `linhasComoObjetos`. Por isso o teste novo conta **idas ao banco**, não
      milissegundos (`tests/migracao-custo-por-requisicao.test.ts`, 8 testes: caminho
      frio, quente, isolate reciclado, concorrência no boot, marca divergente, sonda
      que explode, falha não memoizada). Duas partes na correção porque uma só não
      cobre — memoização por instância de `Banco` (a *promessa*, não um booleano) e
      sonda de uma query (`meta_schema`) para o isolate reciclado. Marca de versão
      **derivada** do texto do schema: não há número a subir ao acrescentar tabela.
      No mesmo movimento, a folha da Poppins saiu do caminho crítico do primeiro
      paint. Verificado no app rodando (`npm run dev`).
- [x] **T-096** Deploy em **staging**, validação, e só então produção.
      _Requirements: CLAUDE.md regra 10_

### Achados da auditoria do board (12/08/2026 — `D-47`)

> Tarefas abertas por uma varredura requisito→código: para cada `RF` que o board dava
> como pronto, procurou-se **onde ele vive** no código. As duas abaixo são requisitos
> que nenhuma tarefa cobria — não regressões, e sim lacunas que o board nunca mostrou.

      ✅ **Feito em 12/08/2026 (`D-58`).** Staging redeployada com a `main` atual, **bateria
      de 8 caminhos** rodada nela (o que produziu `D-56`), e só então prod — igualada em
      código **e** em config. ⚠️ A config não estava igual: prod tinha **2** espaços do
      Confluence onde `D-29` decidiu 7 — o no-op silencioso do banco vencendo o env, que o
      `CLAUDE.md` já avisava e ninguém tinha conferido.
- [x] **T-098** **`RF-23` — a transcrição da conversa nunca chega ao chamado.**
      _Requirements: RF-23_
      ✅ **Resolvida em 12/08/2026 (`D-54`).** A transcrição vai como **anexo** — um
      `conversa-<chave>.md` gerado depois da criação e **fora** do `catch` que classifica
      falha de submissão, pela razão exata de `D-26`. As outras duas formas caíram por
      medição, não por gosto: **linkar** para dentro do app dá **404** para o agente do time
      (`RF-30` não tem leitura sem e-mail, e o edge `authenticated` o mandaria ao OAuth
      antes disso), e **colar na descrição** faria uma conversa comprida encostar num limite
      de campo **não medido**, onde 400 é definitivo e o chamado se perde (`RNF-17`).
      O prompt do sistema e o **conteúdo** das tools ficam de fora (`D-33`; `RN-06` decide
      exposição na leitura, e anexo ninguém reavalia); o registro de que rodaram fica.
      A falha é silenciosa na tela e auditada em `transcricao_anexada`, e a origem na tela
      ganhou uma terceira palavra — *gerado pelo goatlas* —, porque "você enviou" e "do
      time" seriam autoria falsa (`D-43` na versão arquivo).
      ⚠️ O teste que vale é o dos **bytes entregues à Atlassian**: o fake registra só nome e
      tipo, então um caso contra ele passaria com o arquivo vazio (`D-47`).
      O requisito (P1) pede duas coisas: **persistir** a transcrição **e** anexá-la (ou
      **linká-la**) ao chamado. A primeira metade existe desde a Fase 1 — as tabelas
      `conversas`/`mensagens` guardam a conversa inteira, e `submissoes.conversa_id`
      liga o chamado a ela. **A segunda metade não existe em lugar nenhum.**
      `ServicoChamados.abrirPorConversa` (`src/lib/tickets/servico.ts:110-119`) monta o
      payload só com `proposta.titulo`/`proposta.descricao` — o **resumo do modelo**, não
      o diálogo —, e a descrição que sai em `criarChamado`
      (`src/lib/atlassian/cliente.ts:474`) leva apenas o cabeçalho de `D-13`. Quem abre o
      `GN-xxxx` no Jira nativo **não tem caminho de volta para a conversa**, que é
      literalmente o que o requisito chama de "o contexto que o time de tech mais perde
      hoje".
      ⚠️ **Não é regressão: é um requisito que nunca teve tarefa.** `spec.md:62` e
      `spec.md:282` o listam como "P1 dentro da faixa, sem cenário nesta versão — entram
      após as travas P0", junto de `RF-19` e `RF-25`. Os outros dois foram implementados
      depois (`T-303`/`T-304` na spec 004, `T-240` na spec 003); **`RF-23` foi o único dos
      três que ninguém retomou**, e o *coverage check* deste arquivo continuou afirmando
      que todo RF da faixa tinha tarefa.
      ⚠️ **Decidir a FORMA antes de implementar** — anexar a transcrição como arquivo
      (`RF-25`, e o anexo é caminho já trilhado) × linkar para a leitura dentro do app
      (o padrão de `urlDeLeituraNoApp`, e o público do Jira **tem** assento, ao contrário
      do público do app) × colar o texto na descrição (o mais simples e o que envelhece
      pior: descrição não tem volta e conversa longa afoga o pedido). Ver `D-47`.
- [x] **T-099** 🚨 **`campoPrioridadeId` nunca é preenchido — a prioridade não chega ao
      Jira.** _Requirements: RF-15, RF-16, RF-18, RN-08_
      ✅ **Resolvida em 12/08/2026 (`D-48`), e o achado era maior do que esta linha dizia.**
      A auditoria descreveu o defeito como "a prioridade não aparece na fila do time de
      tech" — perda de informação. A medição contra o schema real mostrou que ele é
      **perda de chamado**: **11 dos 15 tipos do `GN` exigem prioridade**, e omitir campo
      obrigatório responde **400 = definitivo = submissão em `falha`, nunca reprocessada**
      (`RNF-17`). Os 4 tipos que abriram chamado até hoje são exatamente os 4 sem
      prioridade. O tipo **71** (exige prioridade, sem select nenhum) devolveu 400 já com o
      `D-39` no ar — prova de que a prioridade sozinha bastava.
      **O conserto:** `campoDePrioridade` decide por `jiraSchema.system` (`ScC-4`),
      `campoPrioridadeId` **saiu**, o valor vai como `{id}` tirado do `validValues` e a
      tradução roda na **rota**, como `D-39`. Tipo obrigatório sem correspondência é
      **recusado antes do efeito**, com o rótulo (`RNF-30`).
      ⚠️ **Falta a medição na staging** (`T-525` da spec 006, agora com dois tipos): só ela
      separa "a forma está certa" de "a forma parece certa".
      `ClienteAtlassianHttp` só escreve a prioridade quando `opcoes.campoPrioridadeId`
      existe (`src/lib/atlassian/cliente.ts:474-476`), e **nada no repo o define**:
      `contexto.ts:230-241` monta o cliente sem ele, não há chave em `ConfigValores`, não
      há env var, e `grep campoPrioridadeId src/` devolve só a declaração
      (`cliente.ts:92`) e os dois usos dentro do próprio arquivo. Logo o campo
      `camposExtra` sai **sempre vazio** e o `POST` de criação não carrega prioridade
      nenhuma.
      **Consequência nos requisitos:** `RF-15` (priorização automática em 3 níveis) e
      `RF-16` (prioridade **editável** antes de criar) são P0 e estão implementados até a
      borda — a IA classifica, a tela mostra, a pessoa edita, o vínculo guarda, o SLA
      local usa — mas **o time de tech não vê nada disso na fila**, que é o ponto inteiro
      dos dois. `T-050` e `T-062` estão `[x]` e continuam corretos no que fazem; o que
      falta é o último centímetro.
      ⚠️ **Isto explica o `prioridade: null` do `GN-6894`**, que o `CLAUDE.md` registrava
      como "**não investigado**" com duas hipóteses ("ou o tipo 68 não expõe campo de
      prioridade, ou o mapeamento não está sendo aplicado"). É a segunda, e não depende do
      tipo: **nenhum** request type receberia prioridade hoje.
      ⚠️ **Por que 1051 testes verdes não pegaram:** `ClienteAtlassianFake` guarda
      `prioridade: dados.prioridade` direto do argumento (`src/lib/atlassian/fake.ts:356`),
      então toda leitura de volta devolve a prioridade certa. O dublê implementa o
      contrato *pretendido* e esconde a divergência — **exatamente** a família de `D-38`
      (obrigatório faltando), `D-39` (campo de seleção) e `D-43` (autor do comentário).
      Nenhum teste menciona `campoPrioridadeId`.
      ⚠️ **Não implementar sem medir o schema primeiro** (`D-36`, `D-44`): id de campo não
      significa nada fora do request type, e `D-44` já abriu o caminho de diagnóstico
      (`GET /api/admin/tipos-chamado/schema`) exatamente porque a rota de produto **não
      podia** responder "este tipo expõe prioridade?". Ligar `campoPrioridadeId` continua
      sendo decisão a tomar depois de ler o `validValues` real — inclusive os **rótulos**
      (`ROTULO_PRIORIDADE`, hoje `Highest`/`High`/`Medium`), que são forma do formulário do
      Jira e moram no código com teste.
- [~] **T-100** 🚨 **O SLA nunca é lido da Atlassian — o `expand` é pedido e jogado fora.**
      _Requirements: RF-29, RF-31, RN-08_
      ✅ **A METADE do dado está feita (`D-48`, 12/08/2026):** `atlassian/sla-do-jsm.ts` lê o
      `expand` que já vinha, o cliente para de devolver `null` fixo e o fake deixa de fingir
      `{prazo: null, cumprido: null}` para todo chamado. O detalhe (`GET /api/chamados/:key`)
      já devolve `chamado.slaPrimeiraResposta` sem nenhuma mudança de rota — ele sempre
      serializou o objeto inteiro.
      ❌ **A TELA continua sem mostrar**, e é o que mantém esta tarefa aberta: o tipo
      `DetalheChamado.chamado` do front (`src/app/api.ts`) não tem o campo, e a lista
      (`RF-29`) nem o expõe na resposta. Nada disso foi feito aqui de propósito —
      `src/app/telas.tsx` estava com dois agentes em cima.
      ⚠️ **E quem for desenhar precisa ler `D-48` antes:** o valor é o SLA **do JSM**, não o
      compromisso de `RN-08` que o app calcula e cobra. `D-20` já decidiu que duas fontes de
      verdade sobre o mesmo prazo é pior que uma — os dois na mesma tela sem dizer de quem é
      cada um é a pior versão disso.
      ⚠️ **`null` é resposta legítima e comum:** o SLA é identificado pelo **nome**, e os
      nomes reais do `GN` não foram medidos. Tela que trate `null` como "carregando" vai
      girar para sempre.
      ⚠️ **"Histórico" continua sem modelo.** O que o `expand` traz é um retrato do ciclo
      atual (mais o último concluído); ciclos pausados/decorridos não existem em modelo
      nenhum do app, e `RN-08` diz que o que importa é a **primeira resposta**.
      `RF-29` pede SLA na **lista** e `RF-31` pede o **histórico de SLA** no detalhe. Nenhum
      dos dois existe, e a causa é uma só: `obterChamado` monta a URL **com**
      `expand=…sla…` (`src/lib/atlassian/cliente.ts:516`) e devolve
      **`slaPrimeiraResposta: null` fixo** (`cliente.ts:539`) — a resposta é pedida, paga e
      descartada. O caminho degradado faz o mesmo (`src/lib/tickets/servico.ts:411`).
      ⚠️ **Nem o fake preenche** (`src/lib/atlassian/fake.ts:359` devolve
      `{prazo: null, cumprido: null}`), então este campo **nunca teve valor em teste
      nenhum** — é por isso que não há suíte vermelha a apontar para cá. Não é "SÓ-FAKE": é
      ausente nas duas pontas.
      ⚠️ **E a tela não teria como mostrar mesmo se a rota mandasse**: o tipo
      `DetalheChamado.chamado` do front (`src/app/api.ts:105-114`) não tem o campo.
      ⚠️ **"Histórico" é mais do que um prazo.** Ciclos de SLA (decorrido, pausado,
      cumprido) não existem em modelo nenhum do app; o que o `expand` traz é, no máximo, um
      retrato. Decidir o escopo antes de implementar — `RN-08` diz que o SLA é de
      **primeira resposta**, e é isso que a pessoa precisa ver.
      ⚠️ **Interage com T-099:** o `GN-6894` voltou com `slaPrimeiraResposta: null` **e**
      `prioridade: null`. São dois defeitos distintos com o mesmo sintoma — se o Jira
      calcula SLA a partir da prioridade que nunca enviamos, consertar só um deles não
      produz número nenhum na tela.
- [x] **T-097** Fechar a Definição de Pronto da Fase 1 (§13 dos requisitos) item por
      item, incluindo os testes de burla. _Requirements: todos_
      ✅ **Fechada em 12/08/2026 (`D-58`): 9 de 11.** O item do celular foi **removido** por
      decisão do mantenedor; os dois que restam dependem de **dado**, não de código — a
      calibragem do threshold da Regra 1 (o bloqueio não dispara com o score atual, medido
      hoje) e os exemplos de **Q3** para a Regra 2. A §13 dos requisitos tem cada item com a
      evidência ao lado. ⚠️ O que fechou de verdade hoje: o item 1 (`GN-6903`, aberto **pela
      conversa**), o item 5 (o teste de burla de `RF-17` que a suíte afirmava ter e **não
      tinha**) e o item 12 (o README que dizia "nada implementado").

      **Tabela original da passagem de `D-47`, mantida como histórico:**

      | # | Item da §13 | Estado | Evidência / o que falta |
      |---|---|---|---|
      | 1 | Colaborador sem assento abre chamado ponta a ponta, com o solicitante correto identificado | ❌ **não** | O fluxo existe e é testado contra os fakes (`tests/fluxo-ponta-a-ponta.test.ts:75`). **Ponta a ponta real nunca aconteceu pela conversa:** o único chamado criado na Atlassian (`GN-6894`) nasceu pelo **formulário** — a chave é `form:<email>:<chave>`. E "solicitante correto" hoje é o cabeçalho de `D-13` na descrição mais os campos por request type, que a rota da **conversa ainda não envia** (`T-505` `[~]`, `T-511b` aberta) |
      | 2 | `create_ticket` comprovadamente impossível sem as duas tools, testado por burla | ✅ **sim** | `src/lib/agent/gate.ts:79-95` (não oferece) + `:108-129` (recusa se vier); `tests/rf08-ordem-tools.test.ts:57-142`, **6 burlas**, incluindo instrução vinda de conteúdo do Confluence |
      | 3 | Pergunta já respondida no Confluence é bloqueada, com link, motivo legível e override funcionando | ⚠️ **com ressalva** | Os três elementos e o override existem e são testados (`tests/regras.test.ts:151`, `tests/rn07-caminho-override.test.ts`, `T-118` para o link interno). ⚠️ **Nunca observado com conteúdo real:** até `D-41` (12/08) a busca por frase devolvia zero na staging, então a deflexão que este item descreve não chegou a disparar em produção. Vale para a Regra 1; a Regra 2 não tem link (`T-047`) |
      | 4 | Problema com histórico de ajuste operacional recorrente é bloqueado pela Regra 2 | ❌ **não** | O código existe e é testado (`tests/regras.test.ts:94`), mas **na instalação publicada a Regra 2 nunca roda**: sem os exemplos de **Q3** ela se declara indisponível (`regra2Disponivel`), que é o fail-safe correto de `RF-14`. Fecha com a resposta de Q3, não com código |
      | 5 | Nenhum chamado é criado sem confirmação explícita | ⚠️ **com ressalva** | A trava existe em duas camadas (`gate.ts:119-120` + rota única `src/lib/http/rotas.ts:288`), e o modelo não tem a tool. ⚠️ **Mas não há teste direto do motivo `sem_confirmacao_do_usuario`**: o helper de `tests/rf08-ordem-tools.test.ts:44-51` tem a opção `confirmar: false` e **nenhum caso a usa**. O `CLAUDE.md` e a tabela de travas abaixo afirmam que a suíte tem o teste de burla de `RF-17`; ela não tem. Fechar é escrever esse caso — é barato, e é literalmente o que este item pede |
      | 6 | Um colaborador **não** vê o chamado de outro (testado explicitamente) | ✅ **sim** | `src/lib/tickets/vinculos.ts` (e-mail no `WHERE`, sem método sem e-mail); `tests/rf30-isolamento.test.ts:53`; 404, nunca 403 |
      | 7 | Comentário interno não vaza (testado, `internal=false` **e** filtro server-side) | ✅ **sim** | `src/lib/atlassian/comentarios.ts`; `tests/rf32-comentarios.test.ts:29` (query) e `:43` (filtro) — as duas camadas, separadas |
      | 8 | Nenhuma credencial em log, resposta ou bundle | ✅ **sim** | `tests/rnf01-vazamento-credenciais.test.ts`, estrutural + comportamental. ⚠️ Já são **quatro** credenciais, não três: `TG_API_TOKEN` entrou em `D-37` e foi coberta no mesmo dia (`T-515`) |
      | 9 | Falha da IA não impede abrir chamado; falha de tool não vira bypass silencioso | ✅ **sim** | `ClienteIAIndisponivel` + formulário mínimo (`tests/ia-indisponivel-sem-chave.test.ts`); tool que falhou satisfaz a ordem mas marca `verificadoRegras: false` (`T-049`) |
      | 10 | Auditoria registra conversa, bloqueio, override, criação e leitura | ✅ **sim** | As cinco ações existem: `conversa_iniciada`, `bloqueio_disparado`, `override_registrado`, `chamado_criado`, `chamado_lido` (+ `pagina_confluence_lida`), em `src/lib/audit/index.ts:22-113`, append-only |
      | 11 | Fluxo completo validado no celular | ❌ **não** | `T-093`, aberta por decisão. Feita em viewport de celular no dev; falta aparelho real |
      | 12 | README com privilégios de cada credencial e procedimento de rotação | ❌ **não** | O `README.md` ainda abre com **"Planejamento. Nada implementado."**, lista **três** credenciais (falta a `TG_API_TOKEN` de `D-37`) e manda o procedimento de rotação para `docs/DEPLOY.md` **"(a criar)"** — que existe desde `T-006` e cobre rotação. `RNF-27` fica formalmente aberto por causa de um arquivo que ninguém reabriu, não por falta de conteúdo |

      **Leitura dos quatro que faltam:** dois são humanos/de dado (celular · Q3), um é
      documentação desatualizada (README) e **um é o item 1** — que só fecha quando a
      conversa abrir um chamado real com os campos do solicitante, ou seja, depois de
      `T-505`/`T-511b` e do go-live de `D-24`. Os itens 3 e 5 fecham com trabalho pequeno e
      conhecido: medir a deflexão com a busca já corrigida, e escrever o caso de burla de
      `RF-17` que a suíte afirma ter.

---
## Estado da implementação

> ⚠️ **Atualizado em 12/08/2026 pela auditoria do board (`D-47`).** O texto abaixo estava
> congelado em 03/08 ("49 concluídas · 9 pendentes · 152 testes") e a contagem de tarefas
> deixou de ser informação útil no dia em que dez linhas `[x]` passaram a valer pela metade.
> **1051 testes**, typecheck e build limpos, tudo sem credencial e sem rede.
>
> **O que a auditoria mudou aqui:** `T-063` foi para `[x]` (executou de verdade, `GN-6894`)
> e dez tarefas foram para `[~]` por não sustentarem o requisito inteiro — `T-029`, `T-047`,
> `T-062`, `T-064`, `T-067`, `T-080`, `T-081`, e fora desta spec `T-128`, `T-131`, `T-137`,
> `T-231`, `T-233`, `T-310`, `T-516`. Três tarefas novas: `T-098` (`RF-23`), `T-099`
> (prioridade que não chega ao Jira), `T-100` (SLA que nunca é lido).
>
> **O padrão que apareceu, e que vale mais que a lista:** quase todo achado é *servidor
> pronto, tela ausente* ou *metade de uma frase com "e"*. Nenhum deles quebrava teste, e
> nenhum deles era visível no board — que é exatamente como `T-081` escondeu um P0 por
> semanas.

As **seis travas críticas estão implementadas**, cinco com teste de burla:

| Trava | Onde mora | Teste |
|---|---|---|
| `RF-08` ordem das tools | `agent/gate.ts` — duas camadas: não oferecer + recusar se vier | `rf08-ordem-tools.test.ts` (6 burlas) |
| `RF-17` confirmação | `agent/gate.ts` + carimbo só por rota do usuário | ⚠️ **a suíte NÃO tem o caso de burla** — ver item 5 de `T-097` |
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
- [ ] Todo RF/RN no escopo da spec aparece em ao menos uma tarefa
      ⚠️ **Este item estava `[x]` e era FALSO** (auditoria de 12/08/2026, `D-47`). O escopo
      da Fase 1 é `RF-07…RF-26` (§12 dos requisitos e `docs/ROADMAP.md`), e **`RF-23` não
      tinha tarefa em spec nenhuma** — só duas menções na `spec.md` adiando-o. Corrigido
      com **T-098**. O item volta a `[x]` quando T-098 fechar.
      ⚠️ A lição do achado é sobre o *gate*, não sobre a linha: um coverage check
      **autodeclarado** confere que toda tarefa aponta para um requisito (fácil, e estava
      certo) e não que todo requisito chegou a uma tarefa (o que exige varrer a faixa de
      IDs). As duas direções não são a mesma, e a que faltava é a que esconde requisito.
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
