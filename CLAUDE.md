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
- **A Organizations API tem TRANSPORTE PRÓPRIO** (`atlassian/organizacao.ts`,
  `RNF-04`) — não a mesma instância do cliente de Jira/Confluence. A credencial é
  **Org Admin**: "economizar" reaproveitando `atlassian/http.ts` (que já resolve
  Basic auth + backoff) transformaria um bug de roteamento comum em vazamento da
  credencial de maior privilégio do sistema. `ctx.organizacao` é `null` fora dos
  fakes até T-122/T-123 existirem — rota de governança trata isso como
  "não configurado" (RNF-18), nunca como erro.
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
- **A sanitização tem DUAS passagens e a bruta não sai do arquivo.** Tokenizar +
  árvore bruta (malformado, profundidade, tamanho) → converter (allowlist).
  Misturar as duas espalha a checagem por cima do tratamento de erro de parse, e um
  caminho de recuperação passa a ser um caminho sem checagem.
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

**No ar em modo demonstração: https://goatlas.devgogroup.com** (`appId 9c47f42f`,
ver `D-07`). Login Google pelo edge, admin por allowlist, tarja avisando que nada
chega ao time de tech.

**590 testes · typecheck limpo · build limpo**, tudo sem credencial e sem rede.
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

**`campo_solicitante_id` (Q4) já é config, não hardcode** (`RF-21`): o dia que o
time de tech confirmar o id do campo "Solicitante" no projeto do portal, é só
preencher no console de admin — nenhum código a mudar, nenhum deploy.

**O comentário público atribuído (RF-33) está resolvido** (`D-13`): prefixo
`**Nome** (email) via goatlas:` usando a identidade do login corporativo Google
— sem depender do console do goatlas, visível já no Jira nativo.

**Q1 andou metade (`D-14`, 05/08/2026):** o trio Jira/Confluence
(`ATLASSIAN_API_TOKEN`, `ATLASSIAN_EMAIL`, `ATLASSIAN_BASE_URL`) e `GOATLAS_ORG_ID`
estão registrados em `9c47f42f`; faltam `ATLASSIAN_ORG_API_KEY`, `LLM_API_KEY` e
`GODEPLOY_CRON_KEY`. **Nada disso mudou comportamento** — `GOATLAS_MODO_DEMO=1` é o
primeiro termo do `||` de `usandoFakes`. A ordem de virar produção, o que cada
ausência silencia e as três confusões de credencial que já aconteceram (API token ≠
chave de Organizations API · `cloudId` ≠ `orgId` · UUID só tem `0-9a-f`) estão em
`docs/DEPLOY.md` e `D-14`.

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
com paginação, `links.next` de outro host descartado, teto de páginas e normalização de
carimbo (segundos × milissegundos são 55 anos de diferença). O que **não** foi verificado
está em `ENDPOINTS_NAO_VERIFICADOS` — e a tela de governança mostra a lista.

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
