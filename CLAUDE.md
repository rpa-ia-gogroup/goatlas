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
  teimoso. Não transformar em recusa. ⚠️ **As duas metades valem** (`D-21`): o
  botão é o único caminho de saída, e o bloqueio dura até ele ser usado.
  "Simplificar" deixando a conversa seguir sozinha reabre o bypass.
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
- **O console de admin mostra o que se DECIDE** (`D-25`) — não tudo o que é
  configurável. TTL de cache, rate limit e teto de tickets da Regra 2 ficam fora da
  tela **de propósito**: continuam em `ConfigValores` e mudáveis sem deploy, mas
  ninguém os decide sem ler o código, e cada um deles na tela custava atenção de quem
  precisa achar o que importa. Devolvê-los é reabrir `D-25`, não "completar a tela".
- **N8N está descartado.** Não propor voltar a ele.
- **Webhook e polling NÃO têm lógica própria** (`D-15`) — os dois só dizem *qual chamado
  olhar*, e `sincronizarChamado` relê da Atlassian. É o que torna a chave de dedupe
  idêntica por construção; e é o que faz o corpo do webhook ser **ponteiro**, nunca
  conteúdo. Não "otimizar" lendo `comment.body` do payload.
- **`emails_piloto` vazio LIBERA todo mundo** (`D-16`) — a única allowlist do projeto cujo
  vazio não nega, porque ela governa quem pode *pedir ajuda*, não exposição de conteúdo.
  Vazio-nega aqui trancaria a empresa fora do canal de suporte no primeiro deploy.
- **Retenção nunca expurga `vinculos`** (`D-17`) — seria apagar o acesso da pessoa ao
  próprio chamado. E a auditoria tem piso de 180 dias, clampado mesmo se alguém configurar
  menos.
- **Q11 em aberto não vira canal inventado** (`D-19`) — o aviso é registrado como
  `suprimida` e o console diz quantos. O default **não** é "e-mail para o corporativo".
- **Os cinco defaults do MVP estão decididos** (`D-20`), e nenhum é acidente:
  canal `nenhum` (o aviso vive na aba Avisos — Chat por espaço vazaria chamado de todos
  numa sala) · piloto **desligado** (o gate só faz sentido depois de `T-333`/`T-334`) ·
  T-235 como **proxy com o viés impresso ao lado do número** · alerta de SLA só para o
  solicitante (o Jira nativo já alerta o agente; duas fontes de verdade sobre o mesmo prazo
  é pior que uma) · retenção `null` (apagar dado pessoal é irreversível; `null` é o único
  default que preserva a opção). Todos ajustáveis por config, sem deploy.
- ⚠️ **`CONFIG_PADRAO` continua fail-closed mesmo com `D-20` decidido.** As decisões entram
  por **env/bootstrap** (`GOATLAS_CANAL_NOTIFICACAO`, `GOATLAS_BASE_PUBLICA`), não mudando o
  default do código: instalação nova não pode afirmar que alguém escolheu não enviar aviso.
  Trocar o default "para simplificar" apaga a distinção que a tela de Avisos mostra.
- **Imagem em URL externa não é renderizada** (`D-10`) — só anexo da página, e
  sempre pelo proxy. Não é (só) XSS: imagem externa numa página que qualquer pessoa
  edita é rastreador de leitura, e o IP de cada colega vaza para um terceiro sem
  nada na tela indicando. Reabrir em `D-10` antes de mexer em
  `IMAGEM_EXTERNA_PERMITIDA`.
- **Não existe botão de sair** (`D-08`). A pessoa loga uma vez e a conta fica; o canto
  superior mostra o e-mail só para ela saber com qual conta está. Trocar de conta não
  é caso de uso, e quem tem duas limpa os cookies. ⚠️ Isso **contraria `RF-03`** (P0,
  pede logout explícito) e está registrado como divergência consciente, aguardando o
  aval do João — não reintroduzir o botão sem passar por `D-08`.

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
- ⚠️ **O fake é alcançável SÓ por `usandoFakes`** (`contexto.ts`, T-132). `ClienteIAFake`
  e `ClienteAtlassianFake` são dublê de teste e de demonstração; fora desses dois
  contextos, credencial ausente instancia `ClienteIAIndisponivel` (recusa honesta), não
  um dublê. Era um fail-open real: `!env.LLM_API_KEY` caía no fake **mesmo com
  `usandoFakes === false`**, então bastava remover `GOATLAS_MODO_DEMO` sem ter a chave
  de IA para o app rodar com **Atlassian real e IA falsa** — agente respondendo roteiro
  de demonstração e chamado nascendo de verdade no JSM, sem nada na tela distinguindo.
  Ausência de configuração é ausência: nega e denuncia (`/api/health` responde 503 com o
  motivo), nunca simula. O formulário mínimo (`D-04`) não passa por aqui e segue
  abrindo chamado, que é o que `RNF-18` pede — degradar, não virar parede.
- **`indisponivel` (503), `rate_limit` (429) e `timeout` (504) são TRANSITÓRIOS;
  só `rejeitado` (400/403) é definitivo.** Classificar indisponibilidade como
  definitiva marca a submissão como `falha` e ela **nunca é reprocessada** — é
  perder o chamado de alguém numa queda de 30 segundos, exatamente o que RNF-17
  proíbe. Foi um bug real, pego pelo teste `rf24-outbox-degradacao`.
- **`RN-06` tem TRÊS condições, não duas.** Espaço na allowlist **E** sem label
  bloqueada **E** página sem restrição. O CQL cobre as duas primeiras; a terceira
  exige `/restriction/byOperation/read` por página. Sem ela, página restrita
  aparece na mensagem de bloqueio da Regra 1 **com título, trecho e link** — foi um
  furo real. Sob proxy total (`D-01`), **qualquer** restrição exclui: não dá para
  avaliar "esta pessoa pode ver?" quando a identidade perante a Atlassian é sempre
  a conta de serviço, e usar a permissão dela como proxy da permissão da pessoa é
  o vazamento que `RNF-09` proíbe.
- **A ordem é metadados → decidir → conteúdo** (`confluence/acesso.ts`).
  `verificarExposicao` avalia as três condições de `RN-06` **sem** trazer o corpo da
  página, e `lerPaginaAutorizada` é o **único** caminho até ele — sanitizando antes de
  devolver. Nenhuma rota chama `obterCorpoStorage`, e há teste estrutural cobrando
  isso: gate que se pode contornar é documentação, não trava. Trazer o corpo antes de
  decidir funciona hoje e vaza no dia em que um caminho esquecer o filtro.
- ⚠️ **A API v2 do Confluence devolve `spaceId` numérico; a allowlist é por CHAVE de
  espaço.** O cliente resolve id → chave e **lança** se não conseguir. Comparar a
  allowlist com o id não dá erro visível: dá uma condição de `RN-06` que nunca
  reprova (ou que reprova tudo, até alguém "consertar" na direção errada). Labels
  também vêm em requisição separada, e **sem `try/catch`** — sem a lista não há como
  avaliar a segunda condição.
- **O proxy de anexo AFIRMA o `Content-Type`; nunca repassa o da Atlassian** (`D-11`).
  Allowlist de tipos exibíveis, e **`image/svg+xml` fica fora** (SVG é documento XML
  com script). O resto vira `application/octet-stream` + `attachment`, sempre com
  `nosniff` e CSP `sandbox`. E o **nome do arquivo** é entrada não confiável dentro de
  um cabeçalho HTTP: `filename` ASCII saneado + `filename*=UTF-8''…` para o acento.
- **Recusa de leitura é sempre a MESMA 404** (`D-12`) — espaço fora da allowlist,
  label, restrição, lixeira e página inexistente respondem igual, e o motivo fica na
  auditoria. Corpo diferente por motivo é oráculo, como o 403 seria em `RF-30`. Só
  indisponibilidade é distinguida (503): 404 mentiroso manda a pessoa abrir chamado
  por uma página que estava lá.
- ⚠️ **O carimbo da dedupe é o do JIRA, nunca `agora()`** (`notificacoes/dedupe.ts`). Duas
  fontes veem o mesmo fato em instantes diferentes; com o nosso relógio cada uma gravaria
  uma chave distinta e a dedupe **não deduparia nada** — sem quebrar teste nenhum, só
  entregando tudo em dobro para a pessoa. E o carimbo é normalizado para ISO/UTC antes de
  virar chave: o webhook manda `Z`, o REST manda `-0300`, e é o mesmo instante.
- ⚠️ **"Mudou de status" compara STATUS, não `updated`.** `updated` muda quando alguém
  edita descrição, label ou qualquer campo — comparar por ele avisaria "mudou para Em
  andamento" três vezes porque o agente ajustou o resumo três vezes. Daí a coluna
  `vinculos.ultimo_status_notificado`.
- ⚠️ **Ação própria não se detecta pelo AUTOR** (`notificacoes/acoes.ts`, `RF-48`). Sob
  proxy total todo comentário sai da conta de serviço: o da pessoa e o do agente do time
  têm o mesmo autor. O que distingue é o app ter registrado a ação **no momento em que a
  fez** — impressão digital do texto normalizado, e a normalização **remove o prefixo de
  `D-13`** primeiro, porque o texto volta da Atlassian já com ele. Nas transições, o que se
  registra é o **status resultante**, não o nome da transição ("Marcar como resolvido" ≠
  "Resolvido", e registrar o primeiro faria a supressão nunca casar).
- ⚠️ **A marca-d'água do polling só avança no que deu certo.** Avançá-la apesar de uma
  falha é perder a janela inteira: o chamado que a Atlassian não devolveu fica atrás da
  marca e **nunca** é olhado de novo. É o erro que `RNF-17` proíbe no outbox, na versão
  silenciosa. E `desde: null` significa *janela curta*, nunca "traga tudo" (`R-02`).
- **SLA é hora corrida, em UTC, e de PRIMEIRA RESPOSTA** (`notificacoes/sla.ts`). Horário
  útil seria mudança de requisito — qual calendário, qual fuso por área, o que fazer com
  feriado regional. Se um dia mudar, muda **ali**, e o teste de `RF-46` é o que documenta a
  escolha atual. "Respondido" é comentário público **sem** o prefixo de `D-13`; o teste
  gera com `prefixarAutoria` e lê com `ehComentarioDoSolicitante`, para que divergir quebre
  a suíte em vez de inflar a aderência.
- **O painel de admin NÃO chama a Atlassian** (`avaliacoes_sla`). Saber se houve primeira
  resposta exige ler os comentários de cada chamado; fazer isso ao abrir o console
  deixaria a página lenta na proporção do sucesso do projeto. O cron de SLA já lê tudo
  isso — gravar o retrato é grátis, e a tela diz "avaliado na última rodada".
- **A calibragem mostra os MOTIVOS junto com a barra** (`governanca/painel.ts`, T-310). O
  threshold é o único campo editável ali, então mostrar "66% de override" sozinho empurra
  para mexer nele — quando a resposta certa costuma ser escrever a página que as pessoas
  apontaram. As duas informações moram na mesma caixa de propósito.
- **Anexo enviado é o caminho OPOSTO ao do proxy de leitura** (`http/anexo-entrada.ts`).
  Lá o risco é `Content-Type` (SVG com script servido do nosso domínio); aqui é **recurso**
  — sem disco nem streaming, o arquivo passa duas vezes pela memória do Worker. Por isso o
  teto de envio (8 MB) é **menor** que o de leitura (12 MB), e não há allowlist de tipo: o
  arquivo vai para o Jira, que aplica a própria política, e recusar `.zip` de log seria o
  app achando que é antivírus.
- **Mensagem de erro nunca inclui o corpo da resposta da Atlassian** — ele pode
  conter dado interno e o erro sobe até o log (RNF-01, RNF-30).
- **Secrets são lidos em UM lugar só** (`src/lib/contexto.ts`). Um segundo lugar
  lendo `env.ATLASSIAN_API_TOKEN` faz `RNF-01` depender de disciplina em vez de
  estrutura. `tests/rnf01-vazamento-credenciais.test.ts` (T-094) varre `src/`
  procurando por isso — e também prova, plantando um "segredo" no corpo de uma
  resposta de erro simulada, que as três camadas de transporte não o repassam na
  mensagem lançada nem a auditoria o persiste sem redigir.
- 🚨 **`ATCTT` é chave de ORGANIZAÇÃO; `ATATT` é token de USUÁRIO** (`D-22`). São duas
  famílias sem relação: `ATATT` (gerado em `id.atlassian.com/manage-profile/security/api-tokens`)
  é o único que funciona em Basic auth contra `<site>.atlassian.net/rest/api/3/*` —
  Confluence e JSM; `ATCTT` (gerado em `admin.atlassian.com` → API keys) só serve
  `api.atlassian.com/admin/*`. ⚠️ **O `docs/DEPLOY.md` afirmou o inverso até 07/08/2026, e
  foi essa instrução que causou o 401 do app** — a credencial não estava quebrada, estava na
  gaveta errada. Um `ATCTT` em `ATLASSIAN_API_TOKEN` dá **401 por design**, com e-mail certo
  e site certo, então os testes óbvios (e-mail · expiração · barra final) voltam todos
  negativos para sempre. E o `ATLASSIAN_EMAIL` tem de ser o da conta que gerou o `ATATT`.
- 🚨 **`ATATT` SCOPED também dá 401 na URL do site — e a Atlassian oferece scoped por
  padrão.** Token **clássico** (sem escopos) usa `https://<site>.atlassian.net/rest/api/3/…`;
  token **scoped** exige o gateway `https://api.atlassian.com/ex/jira/{cloudId}/…` e
  `…/ex/confluence/{cloudId}/…`. Basic auth de scoped contra a URL do site devolve **401** —
  **o mesmo sintoma do erro de família**, o que faz o diagnóstico parecer não ter avançado.
  ⚠️ Consequência para nós: `ATLASSIAN_BASE_URL` é **uma só** e serve Jira **e** Confluence
  (`/rest/api/3/…`, `/rest/servicedeskapi/…`, `/wiki/api/v2/…` no mesmo host). Sob scoped os
  dois têm **gateways diferentes**, então adotar scoped **exige partir a base em duas** — é
  mudança de código, não de config. Por isso o pedido é sempre **token clássico**. Fonte:
  `support.atlassian.com/atlassian-account/docs/manage-api-tokens-for-your-atlassian-account/`
  e o KB de 401 em conta de serviço.
- 🚨 **`GET /admin/v1/orgs/{org}/users` lista SÓ conta gerenciada, e sem domínio
  reivindicado isso é zero** (`D-22`, **confirmado por teste** em `D-23`). Devolve
  `{"data": []}` com HTTP 200 — nenhuma exceção, console mostrando "0 assentos", ninguém
  desconfiando da chamada. Mesma família do `env.DB` devolvendo `{}`. O endpoint certo é
  **`POST /admin/v1/orgs/{org}/users/search`**, e nele: **`accountTypes: ["atlassian"]` é
  obrigatório** (sem ele entram ~83 contas de app/bot) · o **cursor volta em `links.next` e
  é reenviado no CORPO**, não seguido como URL · **`query`, `groupIds` e `productAccess`
  respondem 200 SEM filtrar** — filtro que parece filtrar e não filtra é pior que filtro
  ausente · **`accountStatus` não é status de suspensão** (volta `"active"` para conta
  suspensa — medido nas 54 contas; quem responde é o filtro `isSuspended`, em duas
  varreduras).
- 🚨 **A Organizations API usa DUAS convenções de nome, e escolher a errada devolve lista
  vazia com HTTP 200** (`D-23`). `users/search` responde em **camelCase** (`accountId`,
  `accountStatus`); `last-active-dates` responde em **snake_case** (`product_access`,
  `last_active`). O contrato estava em snake_case para os dois, então **as 54 contas eram
  todas descartadas** por `accountId` ausente. ⚠️ Não unifique "para ficar consistente":
  os dois formatos são reais e unificar quebra um lado com o mesmo sintoma silencioso.
- 🚨 **`name`/`email` exigem `expand: ["NAME","EMAIL"]`, e o produto atribuído NÃO está no
  `users/search`** — `expand: ["PRODUCT_ACCESS"]` responde **400**. Quem entrega produto é
  `last-active-dates` (`product_access[].key`), que o cron já chama por conta. Por isso
  `registrarColeta` itera a **união** das duas fontes: iterar só `usuario.produtos` gravava
  **zero linha** e o inventário rodava vazio. E `last_active` é só a **data**;
  `last_active_timestamp` é o ISO completo e vem primeiro.
- 🚨 **O endpoint GLOBAL de tipos de chamado é EXPERIMENTAL e devolve 412.**
  `GET /rest/servicedeskapi/requesttype` exige `X-ExperimentalApi: opt-in` — era o que
  `listarTiposChamado` usava, então **listar tipos não funcionava em produção** e a
  allowlist de `RF-28` não tinha como ser montada. A saída **não** foi ligar o opt-in
  ("experimental" = pode mudar sem aviso, e isto é trava de roteamento): é o caminho
  estável **por service desk** (`/servicedesk/{id}/requesttype`, 200 sem cabeçalho). ⚠️ Lá
  o `serviceDeskId` **não vem em cada item** — tem de vir do laço, senão viraria `''`.
- **Filtro que pode não filtrar é VERIFICADO, não acreditado** (`organizacao.ts`). Como
  "responde 200 sem filtrar" é comportamento medido desta API, as duas varreduras de
  `isSuspended` são comparadas: interseção não vazia prova que o filtro não separou nada, e
  o resultado sai com `suspensaoConhecida: false` em vez de afirmar "nenhuma suspensa".
  Contar conta suspensa como assento ativo infla o custo (`RF-53`) e recomenda revogar
  acesso de quem já não tem acesso. E `parcial` existe porque o teto de páginas era atingido
  **em silêncio** — apesar de o comentário do próprio código jurar o contrário. Coleta
  parcial ou cega quanto a suspensão **não** é auditada como `sucesso`.
- **A Organizations API tem TRANSPORTE PRÓPRIO** (`atlassian/organizacao.ts`,
  `RNF-04`) — não a mesma instância do cliente de Jira/Confluence. A credencial é
  **Org Admin**: "economizar" reaproveitando `atlassian/http.ts` (que já resolve
  Basic auth + backoff) transformaria um bug de roteamento comum em vazamento da
  credencial de maior privilégio do sistema. `ctx.organizacao` é `null` fora dos
  fakes até T-122/T-123 existirem — rota de governança trata isso como
  "não configurado" (RNF-18), nunca como erro.
- ⚠️ **`PUT /api/admin/config` valida o TIPO, não só a chave** (`config/validar.ts`,
  `D-25`). `Config.carregar` faz `JSON.parse` e confia no que está gravado, porque
  quem grava é `definir()` — mas a rota é HTTP comum, e a tela era a única coisa
  garantindo o tipo. Um `"alto"` em `regra1_threshold_score` é JSON válido, sobrevive
  ao boot e chega à Regra 1 como string; o default fail-closed **não** cobre isso,
  porque valor corrompido não é ausência de valor. E a validação **recusa, nunca
  coage**: `"0.9"` não vira `0.9` — coerção esconde de quem chamou que ele mandou a
  coisa errada, e no dia em que a string for `"alto"` produz `NaN` em silêncio. O mapa
  `FAMILIA` é `Record<ChaveConfig, …>` de propósito: chave nova em `ConfigValores` sem
  família **não compila**, senão o furo volta sem ninguém ver.
- **O console de admin RELATA o estado, não o recalcula** (`config/diagnostico.ts`,
  `D-25`). Cada predicado é o mesmo que o servidor já aplica — `regra2Disponivel` vem
  de `rules/`, `buscaConfigurada` é o predicado que a rota de busca usa para
  distinguir "nada documentado" de "nada configurado". Condição escrita **só** ali
  vira uma segunda regra que diverge em silêncio, e o console passa a mentir com
  confiança; o lugar dela é o módulo de origem. E o que **não** está em
  `admin/campos.tsx` é decisão (`D-25`), não esquecimento: TTL, rate limit e teto de
  tickets da Regra 2 continuam configuráveis, só não têm tela — `tests/tela-admin.test.ts`
  falha se voltarem sem passar pela decisão.
- **Pergunta em aberto (Q1/Q4/Q5/Q8...) não é motivo para hardcode.** O padrão do
  projeto é sempre o mesmo: o valor que falta vira campo de `ConfigValores`
  (`RNF-25`), com `null`/vazio como default fail-closed, e o código já fica pronto
  para o dia em que a resposta chegar — só um campo no console de admin, sem
  deploy (`RF-49`). `campo_solicitante_id` (Q4) segue esse padrão: sem ele, o
  solicitante real ainda vai na descrição (cinto e suspensório); com ele, vira
  também campo estruturado. O oposto — deixar `campoSolicitanteId: null` fixo no
  código enquanto a pergunta não responde — obrigaria um deploy no dia da
  resposta, que é exatamente o atraso que `RF-49` existe para evitar.
- **A allowlist nunca vem do cliente.** Na busca (`RF-37`), `espacosPermitidos` e
  `labelsBloqueadas` saem de `ctx.valores`, e `?espacos=`/`?labelsBloqueadas=` são
  ignorados — é o mesmo raciocínio da identidade: quem consulta não escolhe o próprio
  escopo. Um `?espacos=RH` respeitado seria o caminho mais curto para o espaço do RH.
  `?limite=` é clampado, porque cada resultado custa uma consulta de restrição.
- ⚠️ **A ÚNICA exceção é `?espaco=`, e ela só sabe ESTREITAR** (`D-30`). É interseção com
  `ctx.valores.espacos_confluence`, nunca substituição: o conjunto efetivo é sempre
  subconjunto da config, e espaço fora dela resulta em **lista vazia** — nunca no espaço.
  E **não** é "ignora o filtro se não casar": ignorar transformaria "buscar só aqui" em
  "buscar em tudo". O teste de burla afirma a **propriedade** ("nunca recebe nada fora da
  config"), não o mecanismo, justamente para continuar reprovando se alguém trocar a
  interseção por substituição. E escopo vazio **não** registra lacuna de `RF-42`: zero por
  escopo ≠ zero por documentação.
- **`livesearch` é o único bloco dinâmico que virou funcional** (`D-30`), e a razão é que
  ele não é um **resultado** — é uma caixa de busca, e o app já busca. `recently-updated`,
  `listlabels` e `jira` continuam placeholder porque reproduzi-los exige refazer a consulta
  **e** verificar restrição por item (`RN-06`, `R-02`), com valor baixo para deflexão.
  ⚠️ A macro é resolvida no **renderizador**, não no sanitizador: ele é a camada de
  segurança, e "esta macro virou formulário" é decisão de apresentação.
- **Taxa sem nenhum dado ainda é `null`, nunca `0%`** (`governanca/metricas.ts`,
  T-095) — mesmo raciocínio de `custoConfigurado` em `custo.ts`/Q8. "0% de
  override" pareceria "a Regra 1/2 nunca falha" quando na verdade ninguém foi
  bloqueado ainda; a tela mostra "sem dados" e só passa a calcular de verdade
  quando o primeiro bloqueio/busca existir.
- **Zero por falta de config ≠ zero por falta de documentação.** A busca devolve
  `buscaConfigurada: false` no primeiro caso e **não** registra lacuna de `RF-42` —
  registrar envenenaria o mapa de T-117 com termos que ninguém deixou de documentar, e
  a tela mandaria a pessoa procurar de novo com outras palavras para sempre.
- **A deflexão linka para DENTRO do app, e o formato do link é contrato entre duas
  camadas.** `urlDeLeituraNoApp` (`rules/`) escreve `?pagina=<id>` e `entradaDaUrl`
  (`app/confluence.tsx`) interpreta — com teste que gera de um lado e lê do outro,
  porque divergência aqui é silenciosa: o link continua bonito e leva a 404. Linkar
  `atlassian.net` derrubava a deflexão no clique, já que o público do app não tem
  assento. E em `TextoDoAgente` o link interno é **allowlist de forma**, nunca "começa
  com barra": aquele texto carrega saída do modelo, que pode repetir conteúdo de página
  editável por qualquer pessoa (`R-07`). Ele abre em **outra aba** de propósito — a
  conversa vive em estado de React, e navegar na mesma aba destruiria o botão de
  override (`RF-13`) de quem aceitou ler primeiro.
- ⚠️ **A visão da aba Documentação é DERIVADA, não guardada** (`visaoDaDocumentacao`). A
  tela decidia por `busca !== null`, e apagar o campo mexia só em `termo`: os resultados
  antigos ficavam **travados na tela**, sem caminho de volta para navegar por espaço (visto
  no app real em 10/08/2026). O conserto não foi um `setBusca(null)` no `onChange` — isso
  funciona hoje e quebra no próximo lugar que mexer em `termo` sem lembrar de limpar o resto.
  A ordem das três regras É o comportamento: **página aberta ganha de tudo** (senão o deep
  link `?pagina=` cairia nas categorias) · **campo vazio = começar de novo** · com termo e
  resposta, resultados. Mesmo raciocínio de `bloqueio` × `temBloqueioPendente` (`D-21`).
- ⚠️ **A lista de espaços tem TRÊS estados, e o título aparece nos três.** `espacos` nascia
  `[]` e o componente devolvia `null` para lista vazia — então **carregar era indistinguível
  de tela em branco**: nem título, nem sinal, ninguém percebia que havia algo a caminho. E
  `falhou` é separado de `pronto: []` pelo motivo que `admin/paineis.tsx` já registra: `[]`
  numa queda de rede vira "não tem documentação" e manda a pessoa abrir chamado por algo que
  está escrito. Zero por configuração diz "nenhum espaço foi liberado", nunca "não há
  documentação".
- **A tela de documentação lê `?q=` e `?pagina=` no boot — e isso NÃO é um router.**
  `App.tsx` continua navegando por estado (Princípio V); o deep link existe por dois
  motivos concretos: link de página compartilhável entre colegas, e o link `ri:page` do
  próprio Confluence funcionando (ele dá **título**, não id, então cai na busca pelo
  título). T-115 trouxe a árvore e o deep link continuou suficiente: navegar é clicar em
  nó, e cada nó já tem URL própria (`?pagina=`).
- **A árvore desce UM nível por vez, e o `pai` é verificado como qualquer página**
  (`RF-41`). A árvore inteira custaria uma consulta de restrição por página — um clique
  viraria dezenas de chamadas (`R-02`); espaço e label vão no CQL (`parent = "id"`), a
  restrição sobra por item com teto de 50. E o **breadcrumb para no primeiro ancestral
  não exposto**: nomeá-lo vaza o título, e seguir acima dele entrega a posição da página
  dentro de uma seção fechada. A tela não marca o corte — "nível oculto" contaria o que
  o corte evita.
- **O mapa de lacunas tem TRÊS sinais, e o do meio é o que ninguém pensa** (`RF-42`):
  termo sem resultado · **resultado que ninguém abriu** · motivo do override. O segundo
  é documentação que existe, aparece na busca e não convence — invisível em qualquer
  contagem de "buscas vazias". Daí a coluna `houve_clique`, marcada por `?de=<buscaId>`
  **com o e-mail no `WHERE`**: id de outra pessoa não marca nada, e `via` é derivado
  disso no servidor. E o mapa **conta pessoas, não as nomeia** — é backlog de escrita;
  nomear quem procurou vira cobrança de gente, e o histórico por pessoa já está na
  auditoria, para investigação, que é outro propósito.
- **A identidade é resolvida no roteador e passada como tipo.** Nenhum handler
  recebe e-mail de corpo, query ou header customizado — eles recebem `Identidade`
  já validada, então um handler **não tem como** ler um e-mail que não chegou
  (`RF-04`, `RNF-05`).
- **Chamado de outra pessoa devolve 404, não 403.** Um 403 diria "existe, mas não é
  seu", o que já é informação sobre o chamado de outro (`RF-30`).
- **A chave de idempotência é derivada da conversa** (`conversa:<id>`) e **escopada
  por usuário** no formulário (`form:<email>:<chave>`). Gerar por clique perderia a
  proteção justamente no duplo clique; sem escopo, dois usuários com a mesma chave
  colidiriam.
- **A proposta do chamado é montada pelo servidor**, deterministicamente, quando as
  duas verificações já aconteceram e nada bloqueou. O modelo não decide *quando*
  propor, só *o que* — e `tipoChamadoId` fora da allowlist **descarta a proposta
  inteira** (`RF-28`): sem proposta o agente continua perguntando, o que é o pior
  caso aceitável; criar na fila errada não é.
- **Tool que FALHOU ≠ tool que não rodou.** Falha satisfaz a ordem (a conversa
  tentou) mas o chamado nasce `verificadoRegras: false`. Não rodar continua
  recusando. É a diferença entre "indisponibilidade não vira bypass" e
  "indisponibilidade vira parede" — o requisito pede o primeiro.
- ⚠️ **`bloqueio` é do TURNO; `temBloqueioPendente` é da CONVERSA** (`agent/`,
  `D-21`). O primeiro só diz se uma regra disparou agora — e na mensagem seguinte
  nenhuma dispara de novo, porque a busca já rodou. Usar só ele para decidir se
  monta proposta era um bypass real: bastava mandar outra mensagem para o chamado
  nascer **sem `override_registrado`**, e quem escapava assim não entrava na taxa
  de override, então o painel mostrava deflexão alta justamente onde ela falhou. A
  UI tem o mesmo par: `bloqueado` faria o botão de override sumir no turno
  seguinte — é `bloqueioPendente` que o mantém, e sem ele a trava viraria a parede
  que `RF-13` proíbe. E com bloqueio de pé **o modelo nem é chamado**: quem responde
  é `MENSAGEM_BLOQUEIO_PENDENTE`. Acrescentar o aviso ao texto do modelo, em vez de
  substituí-lo, produzia resposta que se contradizia sozinha ("Montei o chamado
  abaixo" + "não consigo abrir ainda") — ele não sabe que o servidor recusou, e
  aviso colado embaixo não conserta frase já dita.
- **A sanitização devolve ÁRVORE TIPADA, não string de HTML** (`confluence/`).
  Nenhum nó de `No` carrega saco de atributos, então não existe onde um `onerror`
  viajar: o pior caso é um nó que o renderizador não conhece. É isto que torna
  `dangerouslySetInnerHTML` desnecessário **por construção** — e a suíte tem um
  teste estrutural varrendo `src/` para garantir que ninguém o reintroduza. String
  sanitizada dependeria de o sanitizador estar certo; árvore fechada depende de o
  renderizador não inventar.
- **`urlSegura` pergunta "é `http(s)://`?", nunca "é `javascript:`?"** — e na ordem
  **decodificar entidade → limpar controle e espaço → verificar esquema**. Verificar
  antes de decodificar deixa passar `&#106;avascript:`; antes de limpar deixa passar
  `java\tscript:`. Blocklist de esquema perde a corrida contra o vetor novo.
- **Entidade é decodificada em UMA passagem.** `&amp;lt;` para em `&lt;`. Um laço
  "decodifica até não mudar" transformaria dupla codificação em tag — é o bug
  clássico de sanitizador. E o resultado **nunca** é reparseado.
- 🚨 **A tabela de entidades é DUAS, e o lookup de letra é case-SENSITIVE**
  (`confluence/sanitizar.ts`). `&Eacute;` é **É** e `&eacute;` é **é**; `&COPY;` e
  `&copy;` são o mesmo `©`. Havia uma tabela só, consultada com `nome.toLowerCase()`, e
  **nenhuma letra do Latin-1 dentro dela** — então a aba Documentação mostrava
  `Pr&eacute;-requisitos` literal (medido no app real em 07/08/2026, `version 22`, e
  viola a regra 4 na única superfície feita para ler). ⚠️ O conserto "óbvio" — só
  acrescentar as entradas em minúscula — faria `&Eacute; preciso` virar `é preciso`:
  acento certo, **caixa errada, em silêncio**, que é pior que o bug original porque
  parece consertado. Por isso são duas tabelas e `letraOuSimbolo` busca a letra
  **exata** antes de cair no caminho tolerante do símbolo. As maiúsculas são
  **derivadas** (`eacute` → `Eacute`, `é` → `É`), o que é correto porque a entidade
  maiúscula capitaliza só a primeira letra do nome — `&EACUTE;` não existe e continua
  saindo cru, como no navegador. E `&szlig;` fica fora da derivação: `&Szlig;` não
  existe.
- **Entidade NUMÉRICA nunca esteve quebrada** — `doPontoDeCodigo` resolve qualquer
  código. Por isso o bug acima dependia de *como o autor da página digitou*, e é o tipo
  de defeito que atravessa revisão inteira sem ninguém reproduzir.
- **A sanitização tem DUAS passagens e a bruta não sai do arquivo.** Tokenizar +
  árvore bruta (malformado, profundidade, tamanho) → converter (allowlist).
  Misturar as duas espalha a checagem por cima do tratamento de erro de parse, e um
  caminho de recuperação passa a ser um caminho sem checagem.
- **Bloco não desenhado tem TRÊS frases, porque pedem três ações** (`renderizar.tsx`,
  `RF-43`). Dinâmico (`livesearch`, `recently-updated`, `listlabels`, `jira`…): o Confluence
  monta na hora e **o storage não guarda texto nenhum** — não há o que renderizar, e dizer
  "ainda não sabemos mostrar" acusa defeito nosso que não existe. De outra página
  (`include`): o texto existe, manda abrir a origem. Desconhecido: aí sim é limitação nossa,
  e aí o nome técnico aparece, porque é a única pista.
  ⚠️ **A frase antiga dizia "o resto do conteúdo está completo" em CADA bloco** — e na
  página inicial padrão de espaço, que é feita só desses blocos, ela afirmava o oposto da
  verdade três vezes seguidas, em inglês técnico. Quem conclui que o app quebrou **abre
  chamado**: o contrário do que a tela existe para fazer.
  ⚠️ **Tentei e descartei** um aviso no topo do tipo "esta página é só um índice": a home de
  espaço *tem* texto (o placeholder do próprio Confluence), então o predicado honesto é
  `false` ali e o aviso nunca apareceria no caso real. Fazê-lo aparecer exigiria adivinhar
  que aquele parágrafo é placeholder — heurística sobre conteúdo de terceiro. Espaço com home
  vazia é lacuna de documentação, e quem mede isso é `RF-42`.
- 🎁 **Macro desconhecida COM corpo tem o corpo renderizado, nunca descartado.** Era
  desperdício silencioso: `panel`, `deck`/`card`, `excerpt` e qualquer macro interna que
  envolva texto caíam no placeholder **e o texto ia embora** — a página tinha, a pessoa não
  via, e a tela ainda dizia "o texto ao redor está completo". Renderizar o corpo é grátis
  (nenhuma chamada nova) e seguro: ele passa por `converterLista`, a **mesma** allowlist de
  todo o resto. É a diferença entre "não sei desenhar esta moldura" (a moldura se perde, o
  texto aparece) e "não posso mostrar este conteúdo". O `anotar` continua acontecendo: a
  auditoria de `RF-43` é o que diz qual macro vale implementar de verdade um dia.
- **`children`/`pagetree` apontam para a lista que a leitura JÁ mostra** (T-115) em vez de
  dizer "não há o que trazer" — o conteúdo está na tela, alguns centímetros abaixo, com a
  verificação de restrição por item que `RN-06` exige.
- 🚨 **`jira`/`jirachart` NÃO devem ser implementados** — e o motivo não é custo. A JQL vem
  de dentro da página, que qualquer pessoa edita (`R-07`), e executá-la seria rodar consulta
  **escolhida pelo conteúdo** com a conta de serviço, mostrando o resultado a qualquer
  colaborador. É `RN-06` sem gate equivalente: no Confluence existe allowlist de espaço,
  label e restrição por página; para Jira não existe nada disso. Fica placeholder de
  propósito.
- **O parâmetro da macro continua fora da tela** (`RNF-30`), inclusive nos blocos agora
  nomeados: JQL, `spaceKey` e id de filtro descrevem estrutura interna e podem citar projeto
  que quem lê não deveria conhecer.
- **Descartar o conteúdo de `<script>` é cosmético, não a garantia.** A garantia é a
  allowlist não transformar `script` em nó nenhum. A lista de "tags com conteúdo
  descartado" existe para `alert(1)` não aparecer como texto visível — inerte, mas
  ruído que faz quem lê duvidar do que está lendo.
- **Limite é parte da trava.** Página editável por qualquer pessoa é entrada não
  confiável **inclusive no tamanho**: há teto de entrada, de profundidade, de nós e
  de descartes. Conteúdo hostil não precisa de script para derrubar o Worker.

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
npm run dev            # dev server COM /api/* servido pelo código do Worker
npm run test           # Vitest
npm run build          # typecheck + SPA em dist/
npm run build:worker   # bundle worker.js (esbuild)
npm run typecheck
```

`npm run dev` sobe o app inteiro **sem credencial nenhuma**: o
`vite-plugin-api-dev.ts` serve `/api/*` com o mesmo código do Worker, usa os fakes
e injeta o header de identidade **no servidor** (nunca no navegador — senão
existiria caminho em que a identidade vem do cliente). Detalhe em
[`docs/DEPLOY.md`](docs/DEPLOY.md).

## Worktree — receita

```bash
git worktree add .claude/worktrees/<branch> -b <branch>   # a partir de main atualizada
# ... trabalhar dentro de .claude/worktrees/<branch>
git worktree remove .claude/worktrees/<branch>            # ao terminar
```

Nomes: `<NNN>-<slug>` para feature (o NNN da spec), `fix/<slug>` para correção.

⚠️ **Worktree novo nasce sem `node_modules`** — `npm run test`/`typecheck`/`build`
falham antes de rodar. Em vez de um `npm install` inteiro por worktree, aponte para o
da árvore principal (Windows, junção de diretório):

```powershell
New-Item -ItemType Junction -Path "<worktree>\node_modules" `
         -Target "C:\Users\User\Desktop\Projetos\goatlas\node_modules"
```

`node_modules` é gitignored, então a junção não entra em commit nenhum.

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
- ⚠️ **O nome do campo no upload é o caminho SERVIDO, sem o prefixo `dist/`.**
  `-F "dist/index.html=@..."` serve a SPA em `/dist/index.html` e a raiz dá **404**.
  Diagnóstico: nos logs, `GET /` com `source: worker` = a plataforma não achou asset
  e caiu no worker. Já aconteceu neste app.
- ⚠️ **`updateApp` MESCLA assets, não substitui.** Para limpar caminho errado são
  dois deploys: `assets: []` e depois a lista certa. Confira com `getApp` +
  `include: ["manifest"]`.
- 🚨 **`env.DB` devolve `rows` como array de OBJETOS, não colunas+arrays.** O shim de
  teste (`sqlite-local.ts`) implementa a forma documentada; a plataforma entrega outra.
  `linhasComoObjetos` aceita as duas desde 07/08/2026 — antes disso **toda leitura do banco
  devolvia `{}` em produção**, sem erro nenhum: auditoria com 58 registros vazios, lista de
  chamados vazia, config caindo nos defaults. Como os defaults vêm do bootstrap por env, o
  app *parecia* funcionar. **Nunca indexe `rows` direto**; há teste das duas formas.
- 🚨 **O header do cron é ASSINADO** (`t=<unix>;<rótulo>=<hmac-sha256-hex>`), não é a chave.
  Comparar por igualdade dava 403 nas sete rotas com a chave certa. A verificação está em
  `http/cron-auth.ts`, com janela de replay e comparação em tempo constante. ⚠️ **Qual
  string é assinada continua desconhecido** — 10 construções × 2 leituras da chave, nenhuma
  casou. A pergunta exata para a plataforma está em `docs/DEPLOY.md`; chutar não converge.
  ✅ **Resolvido por outro caminho, e a assimetria é de propósito** (medido em 07/08/2026,
  `version 18`): as seis rotas **idempotentes** aceitam por **presença** do header quando a
  requisição **não traz identidade de usuário** — é isso que distingue o gateway da
  plataforma de um funcionário logado forjando o header, e é seguro porque o desenho delas já
  é idempotente (outbox por constraint, dedupe por chave do Jira, marca-d'água que só avança
  no que deu certo). A rota **destrutiva** (`/api/cron/retencao`) **mantém HMAC obrigatório**
  e por isso segue dando **403** — fail-closed deliberado, não defeito. Consequência aceita:
  a retenção não roda, o que hoje é inócuo porque a política é `null` (`D-20`) e ela não
  apagaria nada. ⚠️ **Diagnóstico de cron se faz com `listCronJobs`**, que mostra o status do
  último disparo: foi assim que se descobriu que o `CLAUDE.md` afirmava "403 nas sete" muito
  depois de seis terem voltado a funcionar. `404` = rota não deployada · `403` = gate ·
  `500` = handler explodiu (aí é `getAppLogs`).
- ⚠️ **Colisão de `UNIQUE (vinculos.issue_key)` é caso previsto, não erro** — e a
  classificação importa: por não ser `ErroAtlassian`, ela caía no default **transitório** e
  o cron reprocessava para sempre contra a mesma constraint. Mesmo solicitante =
  idempotência; **outro** solicitante = recusa definitiva e auditada, porque aceitar seria
  dar a alguém o vínculo do chamado de outra pessoa (`RF-30`).
- **A leitura de chamado DEGRADA, no detalhe também.** A lista já usava o payload do outbox
  desde a Fase 1; o detalhe subia a falha e virava **500** — a pessoa clicava no próprio
  chamado durante uma queda do Jira e lia "algo deu errado". E "não há respostas" ≠ "não
  consegui buscar as respostas": são frases opostas, e a errada faz ela achar que ninguém
  olhou (`degradado` e `comentariosIndisponiveis` na resposta).
- 🚨 **O edge fecha TUDO, inclusive o que foi escrito como rota pública.** Com
  `visibility: authenticated`, `/api/webhook/jira` (`RF-48`) e `/api/health` (`RF-59`)
  recebem **302** para o OAuth antes de chegarem ao worker — medido com `curl` em
  07/08/2026, e a requisição **não aparece nos logs do app**. A Atlassian não faz esse
  OAuth, então o webhook do Jira **não funciona hoje**. `setAppPublic` **não** é a saída
  (abriria o app inteiro, e `RF-01` depende de o edge injetar a identidade); a saída é uma
  exceção de rota na plataforma. Enquanto não existir, o **polling** entrega a notificação
  com atraso de uma janela de cron — que é precisamente o motivo de `RF-47` exigir duas
  fontes. Detalhe em `docs/DEPLOY.md`.
- **Logout é do edge** (`https://<dominio-base>/auth/logout`) e **ignora parâmetro de
  redirect** — testado com `redirect`, `next`, `returnTo`, `return_to`, `r`,
  `continue`, `redirect_uri` e `callback`. Sempre leva ao domínio da plataforma; a UI
  avisa para onde a pessoa vai. A URL é derivada do próprio host, não hardcoded.

## Estado do projeto

**Fases 1 e 2 na `main`; Fases 3 e 4 com o código completo.** Faseamento em
`docs/REQUISITOS.md` seção 12: Fase 0 diagnóstico (João, sem código) → Fase 1 MVP →
Fase 2 conhecimento e governança → Fase 3 SLA e notificações → Fase 4 rollout.
Progresso tarefa por tarefa nos quatro `tasks.md`:
[001](specs/001-mvp-chamados-e-agente/tasks.md) ·
[002](specs/002-confluence-e-governanca/tasks.md) ·
[003](specs/003-sla-e-notificacoes/tasks.md) ·
[004](specs/004-piloto-e-rollout/tasks.md).

**No ar em SOMENTE LEITURA: https://goatlas.devgogroup.com** (`appId 9c47f42f`,
`version 20`, deploy de 07/08/2026). Login Google pelo edge, admin por allowlist.
⚠️ **Já não é modo demonstração** (`GOATLAS_MODO_DEMO` saiu): o app lê Confluence e Jira
**de verdade** com o `ATATT` validado, e o que impede efeito colateral é
`GOATLAS_SOMENTE_LEITURA=1`, que recusa toda escrita no decorador do cliente.
Config apontada para o real: `GOATLAS_SERVICE_DESK_ID=4` (`GN`, "Tickets Engenharia"),
tipos `70,134,108,68`, espaços **`GT,DTE,GN,DE,GI,datateam,Protheus`** (`D-29`, 10/08 —
7 dos 31 espaços reais, conferidos ao vivo contra `/wiki/api/v2/spaces`).
⚠️ **`Config` resolve `CONFIG_PADRAO` → env → BANCO, e o banco vence.** Mudar
`GOATLAS_ESPACOS_CONFLUENCE` só tem efeito se ninguém tiver gravado `espacos_confluence` na
tabela `config` pelo console — senão é no-op **silencioso**. O valor efetivo não é legível de
fora (`listAppSecrets` não devolve valor, `/api/admin/config` está atrás do edge): confere-se
abrindo o console.

🚨 **Desligar `GOATLAS_SOMENTE_LEITURA` é o go-live, e tem pré-requisito:** a staging
(`3936ca2d`, criada e **incompleta** — falta o `LLM_API_KEY`) passa a ser obrigatória
antes disso (`D-24`). É naquele instante que o primeiro chamado real nasce na fila do time
de tech, e `criarChamado` (`T-063`) **nunca executou** contra o JSM.

**816 testes · typecheck limpo · build limpo**, tudo sem credencial e sem rede.
Pronto na Fase 1: fundação, as seis travas críticas, clientes de Atlassian e IA,
runtime do agente, rotas, worker, frontend e `docs/DEPLOY.md`. Pronto na Fase 2: a
**trava da fase** — sanitização e renderização do Confluence (`RNF-06`, `RF-39`,
`RF-43`) — e o **Confluence como superfície**: `obterMetadadosPagina` /
`obterCorpoStorage` / `obterAnexo` no cliente isolado, `GET /api/confluence/busca`,
`GET /api/confluence/pagina/:id` e o proxy de anexo — os três passando pelas três
condições de `RN-06`, com os testes de burla escritos antes.

A aba **Documentação** (T-114) é a superfície disso: busca, leitura com a espinha lime,
anexo pelo proxy, **árvore do espaço com breadcrumbs** (T-115) e deep link
`?q=`/`?pagina=`. E a deflexão da Regra 1 (T-118) linka para essa leitura, não mais para
`atlassian.net`. O uso fica registrado em `buscas`/`paginas_lidas` (T-116) e vira o
**mapa de lacunas** na aba de admin (T-117).

**`RF-27` está completo (T-130, Phase 4 da spec 002):** o formulário sem IA
(`D-04`) ganhou campos adicionais renderizados a partir do schema do request
type (`atlassian/cliente.ts#obterCamposDoTipo`, `GET
/api/tipos-chamado/:id/campos`, mesma allowlist de `RF-28`). É aditivo: schema
indisponível ou tipo sem campo extra não impede o formulário fixo de abrir
chamado (RNF-18) — verificado em `npm run dev`.

**A Phase 3 da spec 002 (governança de assentos) está quase pronta.** Contrato e
transporte isolado da Organizations API (`atlassian/organizacao.ts`, T-120), fake
roteirizável (T-121), cache histórico do inventário + cron diário
(`governanca/inventario.ts`, T-124), custo e assento ocioso como funções puras
(`governanca/custo.ts`, T-125 — sem `custo_mensal_por_produto` configurado mostra
contagem, nunca dinheiro inventado), recomendações de rebaixamento/remoção
(`governanca/recomendacoes.ts`, T-126), exportação CSV com escape de vírgula, aspas
**e** fórmula (`governanca/csv.ts`, T-127) e a seção "Governança de assentos" na aba
de admin (T-128) — tudo testado contra `ClienteOrganizacaoFake`. O que falta,
`listarUsuarios`/`ultimoAcesso` reais (T-122/T-123) e revogar produto (T-131,
P2), depende de **Q1**: a credencial de Org Admin ainda não existe, e não há como
escrever a chamada real contra um endpoint que ninguém pode testar hoje.

**A aba de admin virou console (spec 003, `D-25`).** Era um scroll único com cinco
trabalhos empilhados — 14 campos na ordem de implementação, depois métricas,
assentos, lacunas e auditoria, com rótulos que nomeavam a chave do banco. Agora é
organizada por **capacidade**, com trilha de seções que carrega o estado de cada uma,
uma **visão geral** que diz o que está ligado/parcial/desligado e a consequência, e
cada ajuste ao lado do dado que ele calibra (o threshold da Regra 1 junto da taxa de
override — `R-04`). O console encolheu de propósito: quatro chaves técnicas saíram da
tela (`D-25`) e `org_id`/`custo_mensal_por_produto` entraram, destravando **Q1**/**Q8**
sem deploy. `src/app/admin.tsx` virou `src/app/admin/` (`index` · `campos` · `paineis`)
com folha própria em `console.css`.

**`campo_solicitante_id` (Q4) já é config, não hardcode** (`RF-21`): o dia que o
time de tech confirmar o id do campo "Solicitante" no projeto do portal, é só
preencher no console de admin — nenhum código a mudar, nenhum deploy.

**O comentário público atribuído (RF-33) está resolvido** (`D-13`): prefixo
`**Nome** (email) via goatlas:` usando a identidade do login corporativo Google
— sem depender do console do goatlas, visível já no Jira nativo.

**Q1 está RESPONDIDA na parte de credencial (`D-23`, 07/08/2026).** O `ATATT` clássico
funciona (`/rest/api/3/myself` → **200**), o `ATCTT` está em `ATLASSIAN_ORG_API_KEY`, e
`GOATLAS_SERVICE_DESK_ID=4` (projeto `GN`, "Tickets Engenharia" — um dos 5 service desks
do site, com 16 tipos de solicitação). **`T-063` saiu do bloqueio:** o que falta é
*escolher* quais tipos entram na allowlist de `RF-28`, que é decisão de roteamento.

⚠️ **Das "três confusões de credencial" do `D-14`, duas valem e uma era erro nosso:**
API token ≠ chave de Organizations API (vale, e o `D-14` a descrevia **invertida** —
ver `D-22`) · `cloudId` ≠ `orgId` (vale) · ~~UUID só tem `0-9a-f`~~ **falsa: org id da
Atlassian não é UUID estrito**, o da Gocase tem `j`/`k` e responde 200 (`D-23`). Não
"conserte" um org id com letras fora de hex — teste-o.

O que falta da Fase 1 depende de resposta ou de deploy: `criarChamado` contra a
Atlassian real (**Q1**), o **valor** do campo customizado "Solicitante" (**Q4** —
o código já está pronto, ver acima), deploy em staging/prod e o fechamento da
Definição de Pronto. A **Phase 2 da spec 002 está completa**; o que resta dela é a
governança de assentos (Phase 3, detalhada acima), que depende de **Q1** para
valer contra a API real. **Q5** não trava código, só o dado de
`espacos_confluence`, sem o qual a busca devolve zero e diz `buscaConfigurada: false`
— o mesmo raciocínio de **Q8** para `custo_mensal_por_produto`.

### Fases 3 e 4 — o que ficou pronto, e o que falta de verdade

**A Fase 3 (spec 003) está completa em código.** Webhook do Jira (`RF-48`) com segredo em
tempo constante e resposta sempre `202`; polling incremental com marca-d'água (`RF-47`);
dedupe pela constraint com o carimbo do Jira; supressão de ação própria (`RF-48`); camada
de canal isolada com Google Chat, e-mail, fake e `CanalIndisponivel`; preferência por
pessoa (`RF-45`) com a tela **Avisos**; SLA de primeira resposta como função pura
(`RF-46`), cron de alerta sem repetição e retrato gravado para o painel; painel completo de
`RF-55` com calibragem, aderência ao SLA, telemetria de 429 (`RF-60`) e custo de IA;
anexos (`RF-25`/`RF-34`), filtro e busca na lista (`RF-35`), resolver/reabrir quando o
workflow do JSM oferece (`RF-36`) e retenção (`RNF-33`).

**A Fase 4 (spec 004) está completa no que é código:** gate de piloto com encaminhamento
(`R-06`), mapa de áreas puro, área congelada no vínculo e corrigível pela pessoa
(`RF-19`), leitura de calibragem com os motivos de override (`RF-50`) e baseline de
assentos (`O2`).

**T-122/T-123/T-131 saíram do bloqueio de Q1** (`D-18`): `ClienteOrganizacaoHttp` existe,
com paginação, cursor de outro host descartado, teto de páginas e normalização de
carimbo (segundos × milissegundos são 55 anos de diferença). O que **não** foi verificado
está em `ENDPOINTS_NAO_VERIFICADOS` — e a tela de governança mostra a lista.

**O 401 da Atlassian está diagnosticado, e a correção era nossa** (`D-22`, 07/08/2026, a
partir de medição do João de 31/07): `ATLASSIAN_API_TOKEN` guarda um `ATCTT` (chave de
org) onde `/rest/api/3/*` exige `ATATT` (token de usuário) — e o nosso próprio
`docs/DEPLOY.md` mandava fazer exatamente isso. Falta **gerar o `ATATT`**; é a única
ação humana que destrava Confluence e JSM reais. O `ATCTT` que já existe é a credencial
certa para `ATLASSIAN_ORG_API_KEY`. No mesmo movimento, `listarUsuarios` trocou
`GET /users` (que mede vazio sem domínio reivindicado) por `POST /users/search`, e passou
a devolver `suspensas`/`suspensaoConhecida`/`parcial` em vez de uma lista que escondia
duas incertezas. **Q5 respondida:** `GO`, `DTE`, `GN`, `datateam`, `Protheus` — e o
espaço `TECH` que circulava **nunca existiu**.

**O que falta não é código:**

| O que | Quem | Por que não dá para adiantar |
|---|---|---|
| Escolher o canal (**Q11**) | João | É um campo de config (`D-19`). Enquanto for `null`, o aviso é registrado e suprimido, e o console mostra quantos |
| Lista do piloto (**Q13**) | João | Campo de config. Vazio = piloto desligado (`D-16`) |
| `ATLASSIAN_ORG_API_KEY`, `LLM_API_KEY`, `GODEPLOY_CRON_KEY`, `GOATLAS_WEBHOOK_SEGREDO` | João | Secrets. Cada ausência silencia uma parte, todas fail-closed — ver `docs/DEPLOY.md` |
| Registrar o webhook no Jira | time de tech | Opcional: o polling notifica sozinho, com atraso de uma janela de cron |
| Baseline de assentos (Fase 0) | João | Sem ele a tela diz "sem baseline" em vez de comparar contra zero |
| **T-235** — distinguir "defletido e resolveu" de "desistiu e foi pro chat" | Produto | Mitigado, não resolvido: o painel devolve `deflexaoResolvidaConhecida: false` e trata o número como **teto** |
| Destino do alerta de SLA | Produto | Hoje vai ao solicitante, o único destino que o app conhece. Outro destinatário é uma linha na mesma função |

### O que só o app REAL revelou (07/08/2026)

Quatro bugs passaram por **610 testes verdes** e apareceram no primeiro teste de ponta a
ponta contra `goatlas.devgogroup.com`. Nenhum dava erro no lugar certo:

| Bug | Por que o teste não pegava |
|---|---|
| `env.DB` devolve `rows` como objetos | O shim implementa a forma documentada; a plataforma usa outra. Sintoma era `{}`, não exceção |
| Detalhe do chamado dava 500 numa queda | Nos testes o chamado sempre existia |
| Demonstração perdia o chamado entre requisições | O Worker é stateless; o teste roda tudo num processo |
| Colisão de `UNIQUE` virava retry infinito | A colisão só acontece quando o vínculo já existe, cenário que nenhum teste montava |

**A lição que vale para as próximas fases:** o dublê implementa o contrato **documentado**,
e onde a plataforma diverge da documentação o dublê esconde a divergência em vez de
revelá-la. Teste de integração contra o app publicado não é luxo de fim de projeto — é a
única coisa que vê essa classe de bug.

### Como testar sem credencial
As duas camadas isoladas têm **fake** (`src/lib/atlassian/fake.ts`,
`src/lib/ia/fake.ts`), com falha injetável por operação. O fake de IA é
**roteirizável**: é assim que os testes de bypass encenam um modelo hostil
(tentando `create_ticket` fora de ordem, inventando nome de tool, obedecendo a
instrução vinda de conteúdo do Confluence) de forma determinística. Nenhum teste
precisa de rede, credencial ou provedor de IA.

⚠️ **O fake de busca ignora o TERMO por padrão** (`estado.filtrarPorTermo = false`), e
isso é de propósito: os testes de exposição (`RN-06`) buscam com termos como `'x'` e
afirmam sobre *quais páginas saem da camada* — se o texto também filtrasse, um teste de
allowlist passaria por acidente, porque a página proibida teria sido excluída pelo termo
e não pela regra. O dev e a demonstração **ligam** a flag, onde o oposto é o problema:
busca que devolve tudo para qualquer palavra faz a tela parecer quebrada.

Banco nos testes: `node:sqlite` via `src/lib/db/sqlite-local.ts` — SQLite real, do
runtime, sem dependência nova. É de propósito: as invariantes que importam são
constraints do schema (`UNIQUE` de `vinculos.issue_key` e de
`submissoes.chave_idempotencia`), e um dublê que não as aplica deixaria RF-24 e
RN-03 verdes enquanto produção duplica chamado.
