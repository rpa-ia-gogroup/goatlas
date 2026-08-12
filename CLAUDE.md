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
   inclui os testes de **bypass** (tentar burlar pelo prompt). ⚠️ **Com uma exceção
   medida em 12/08 (`D-47`): o caso de burla de `RF-17` NÃO existe.** As duas camadas
   de `agent/gate.ts` estão lá, mas nenhum teste exercita
   `sem_confirmacao_do_usuario` — o helper de `rf08-ordem-tools.test.ts` tem a opção
   `confirmar: false` e nenhum caso a usa. Item 5 de `T-097`.
4. **Português com acentuação** em todo texto visível ao usuário — UI, erros e
   prompts de IA.
5. **Quatro credenciais, zero vazamento** — API token Jira/Confluence · API key de
   organização (Bearer, `api.atlassian.com/admin`, exige Org Admin) · chave da API
   de IA · **`TG_API_TOKEN` da TeamGuide** (`D-37`, fonte da área do solicitante). Só
   em secrets do GoDeploy, lidas **em um lugar só** (`contexto.ts`). Nunca em repo,
   log, resposta ou bundle. ⚠️ O token da TeamGuide é **o mesmo do godocs**: rotacionar
   por causa de um quebra o outro, e no goatlas quebra em silêncio (fail-open).
6. **Config é para o que VARIA** (**RNF-25**, emendado em `D-36`). IDs de projeto,
   service desk, request type e espaço do Confluence variam — configuração/secret.
   O mapeamento *campo customizado → significado, **por request type*** não varia:
   é a forma do formulário do Jira, e mora no código com teste. O critério é um só:
   *este valor muda sem o código mudar?*
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
- **O anexo NÃO viaja dentro da chamada de criação** (`D-26`). Parece a simplificação
  óbvia — é o que o portal nativo do JSM faz — e é a que perde chamado: id temporário
  vencido faz a **criação** responder 400, que `atlassian/http.ts` classifica como
  **definitivo**, e submissão definitiva **nunca** é reprocessada. Um arquivo velho
  apagaria o chamado da pessoa. São dois passos dentro da mesma confirmação: upload ao
  escolher o arquivo, materialização **depois** da criação. Custo aceito: existe uma
  janela curta em que o chamado existe sem o anexo.
- **`RF-62` é fail-OPEN, e isso é desvio consciente** (`D-27`) — schema de request type
  que não pôde ser lido **não pergunta** e abre o chamado. A distinção que sustenta:
  `RF-62` é qualidade de produto, não trava de segurança; quem burla só abre o **próprio**
  chamado sem responder uma pergunta, e o que perde é a evidência dele mesmo. Fail-closed
  aqui seria não abrir chamado durante uma queda de leitura de schema — a parede que
  `RNF-18` proíbe. O evento vai para a auditoria (`schema_tipo_indisponivel`) para ninguém
  confundir "o tipo não aceita anexo" com "não deu para saber".
- **A declaração de anexo trava RESPONDER, nunca ANEXAR** (`RN-11`). Quem diz "tenho",
  desiste e volta para "não tenho" abre o chamado. E a copy da opção negativa é "não tenho
  material para anexar" — **nunca "pular"**, que diria que anexar era o dever e faria a
  resposta honesta virar a que ninguém escolhe.
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
- **A fonte do Google NÃO bloqueia o primeiro paint** (`D-35`). O `<link>` da Poppins usa
  `media="print"` + `onload`, e existe um instante com fonte de sistema (FOUT) que antes não
  existia — porque antes a tela **inteira** esperava por dois domínios de terceiro. ⚠️
  `&display=swap` não substitui isto: ele governa quando o *texto* troca de fonte, não quando
  a *página* pinta. A identidade visual (§2) continua Poppins; a pilha de fallback em
  `tokens.css` é escolhida para a troca não empurrar o layout, e não é "segunda opção de
  design". "Consertar o piscar" com `<link>` comum devolve a espera ao caminho crítico.

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
- 🚨 **A TELA também não detecta autoria pelo AUTOR** (`tickets/comentario-exibicao.ts`,
  `D-43`). Mesmo motivo do item abaixo, na superfície que a pessoa lê: o comentário que ela
  acabou de escrever aparecia assinado pela **conta de serviço** — hoje a conta pessoal de um
  colega — com o prefixo de `D-13` logo abaixo dizendo outro nome (medido na staging em
  12/08/2026, `GN-6897`), e a leitura natural é *alguém escreveu em meu nome*. Quem classifica
  é `ehComentarioDoSolicitante`, o **mesmo** predicado do SLA de `RF-46`; condição escrita só
  na tela seria a segunda regra que diverge em silêncio (`config/diagnostico.ts`). ⚠️ E o
  nome da conta **fica**, enunciado como registro (`Conta que registrou: …`), nunca como
  autoria: quem responde pelo portal com a conta de serviço não é distinguível, e apagar o
  autor de todos consertaria esse caso e estragaria o comum — o agente que respondeu de
  verdade. O prefixo sai do corpo exibido por `removerPrefixoAutoria`, o par de `RF-48`, e não
  por um `replace` novo. ⚠️ **O fake escondia isto**: `comentar` guardava o texto sem prefixo e
  com o nome do autor real — o oposto de produção nas duas pontas —, e corrigi-lo não quebrou
  **nenhum** teste existente, que é a medida exata do ponto cego (família de `D-38`/`D-39`).
- 🚨 **Quem prova que o anexo do chamado é PÚBLICO não é o endpoint de anexos** (`D-45`,
  `tickets/anexos-do-chamado.ts`). A documentação do JSM diz, sobre
  `GET /request/{key}/attachment`: *"customers will only get a list of public attachments"* —
  o filtro é pelo **papel de quem pergunta**, e sob `D-01` quem pergunta é sempre a conta de
  serviço, que é agente. Mostrar essa lista entregaria o anexo de um comentário **interno**
  à própria pessoa, com HTTP 200 e nada na tela: é a pegadinha do `internal` (`RN-05`) na
  versão arquivo. São **duas fontes cruzadas** — aquela lista prova que o anexo **existe**, o
  comentário público que o carrega prova que ele é **público** —, e mostra-se a interseção.
  ⚠️ **Existir sem prova não vira lista vazia:** vira `anexosIndisponiveis`, porque "não tem
  anexo" e "não deu para saber" são frases opostas e a errada faz a pessoa mandar o print de
  novo (mesmo par de `comentariosIndisponiveis`). E a expansão `attachment` dos comentários é
  **tentada, nunca exigida**: recusa 4xx repete a chamada sem ela e devolve `anexos: null` —
  `RF-32` é P0 e não pode cair por causa de um `expand` que ninguém verificou. Falha 5xx
  **não** repete: seria esconder queda como se fosse contrato.
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
- ⚠️ **A materialização do anexo mora FORA de `ServicoChamados.processar`, e a separação é
  a trava** (`tickets/anexo-na-criacao.ts`). Dentro daquele `try/catch`, um id de anexo
  vencido (4xx = definitivo) marcaria a submissão como `falha` e o chamado se perderia.
  Nada em `materializarAnexosDoChamado` lança: o pior caso é `estado: 'falhou'` com os
  nomes dos arquivos. Mover aquela chamada "para o lugar certo" reabre `D-26`.
- ⚠️ **A reivindicação vem ANTES da chamada à Atlassian** (`anexos_pendentes.reivindicar`).
  `UPDATE ... WHERE materializado_em IS NULL` é o lock: dois cliques disputam, um escreve.
  Inverter (chamar e marcar depois) faria o arquivo aparecer **duas vezes** no chamado, e
  anexo em dobro não tem caminho de volta. O custo — falha depois da reivindicação deixa o
  arquivo fora daquela tentativa — é exatamente o estado que `RF-63` prevê e relata.
- **A chave de idempotência tem UM produtor** (`tickets/chave-idempotencia.ts`). O upload
  grava a linha em `anexos_pendentes` e a criação a procura: se um escrevesse a chave crua
  e o outro a prefixada (`form:<email>:<chave>`), **nenhuma linha casaria** — chamado sem
  anexo, sem erro nenhum, os dois lados "funcionando". Mesma classe de bug de
  `urlDeLeituraNoApp`/`entradaDaUrl`. Por isso a chave é **obrigatória** na rota de upload:
  inventar uma ali produz arquivo órfão por construção.
- **O `temporaryAttachmentId` nunca trafega pelo navegador** (`RF-30` aplicado a arquivo).
  O cliente manda o arquivo e recebe `{ ok, nome }`. Com o id no navegador, colar o anexo
  de outra pessoa no próprio chamado seria trivial.
- **O teto de anexo é por CHAMADO e a recusa é MENSAGEM, nunca `.slice()`.** O truncamento
  silencioso fazia o quarto arquivo desaparecer sem nada na tela — a pessoa achava que o
  print decisivo tinha ido (`SC-08`). Saiu também da rota de `RF-34`.
- **O upload temporário é ESCRITA, mesmo sem `issueKey`** — o decorador de somente leitura
  o recusa. Deixá-lo passar produziria o pior resultado do modo: tela dizendo "arquivo
  enviado", pessoa confirmando, criação recusada depois, arquivo já na Atlassian.
- ⚠️ **Nada decide "é anexo?" por `fieldId`** (`ScC-4`, teste estrutural em
  `scc4-nenhum-fieldid-de-anexo.test.ts`). Quem responde é o **tipo** do campo, traduzido
  de `jiraSchema.system` no cliente. Um `fieldId === 'attachment'` funcionaria no site da
  Gocase e pararia de funcionar em outro **sem quebrar nada**: a pergunta simplesmente
  deixaria de aparecer, e os chamados voltariam a chegar sem evidência.
- **O indicador de evidência lê `submissoes`, não `anexos_pendentes`** (T-422). A tabela de
  pendentes é expurgada em 12h: um painel que lesse dela mostraria a evidência caindo para
  zero sem nada ter mudado — mediria o expurgo. E o denominador são os **perguntados**, não
  os chamados: incluir quem nunca viu a pergunta faria a taxa cair quando alguém criasse um
  request type sem anexo.
- **O expurgo dos anexos pendentes pega carona no cron do OUTBOX**, não no da retenção
  (T-415) — por duas razões que valem sozinhas: `aplicarRetencao` não apaga nada com
  política `null` (`D-20`), e `/api/cron/retencao` mantém HMAC obrigatório e responde 403
  hoje. Código pendurado lá nunca rodaria.
- ⚠️ **O system prompt do agente é FUNÇÃO da instalação** (`montarPromptAgente`, `D-33`). Sem
  `espacos_confluence` a busca devolve zero **por configuração** e sem os exemplos de `Q3` a
  Regra 2 se declara indisponível — o prompt constante prometia as duas verificações sempre, e
  o modelo, recebendo lista vazia, escrevia a conclusão natural: *"não encontrei nada sobre
  isso"*. É a frase oposta à verdade (ninguém procurou) e manda a pessoa abrir chamado por algo
  que pode estar escrito. Os dois predicados são **reaproveitados** (`buscaConfigurada`,
  `regra2Disponivel`), nunca reescritos ali. E as horas do SLA vêm de
  `SLA_PRIMEIRA_RESPOSTA_HORAS`: repetidas à mão, o agente promete um prazo e o cron cobra
  outro, sem quebrar teste nenhum. ⚠️ Continua sendo **instrução, não trava** — `RF-08`/`RF-17`
  seguem em `agent/gate.ts`, e nenhum valor de config entra no texto (`RNF-30`).
- 🚨 **Quando o FAKE é a única evidência de um campo que cruza a fronteira, o campo não está
  verificado** (`D-47`). Quarta ocorrência da mesma família: `D-38` (obrigatório faltando),
  `D-39` (campo de seleção), `D-43` (autor do comentário) e agora a **prioridade** —
  `ClienteAtlassianFake` guarda `prioridade` direto do argumento (`fake.ts:356`), então toda
  leitura de volta devolve o valor certo enquanto o cliente real **nunca o envia**. O teste
  que vale afirma sobre o corpo entregue ao `fetchImpl`, como `T-521` faz; o que afirma sobre
  o que o fake devolveu só prova que o fake é consistente consigo mesmo. ⚠️ Próximo da fila
  sem essa rede: `RF-25` — `attachTemporaryFile` não aparece em `tests/`.
- ⚠️ **Teste de tela afirma sobre descritores e estados, nunca sobre quais PAINÉIS existem**
  (`tela-admin.test.ts`, `D-47`). Por isso a faixa de calibragem de `T-310` desapareceu
  inteira no rewrite do console (`D-25`) sem uma asserção vermelha — e o CSS órfão
  `.faixa-calibragem` é a única coisa que restou dela. Painel que some não quebra nada.
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
- 🐛 **`GET /api/tipos-chamado` devolve tipos dos CINCO service desks, não do configurado**
  (medido em 11/08/2026 ampliando a allowlist na staging: voltaram ids dos desks 7, 8 e 9 ao
  lado dos do 4). `listarTiposChamado` varre todos os desks e a allowlist é a **única** coisa
  que limita — então um id de outro desk na allowlist passa por `validarProposta` e **falha
  só na criação**, porque `serviceDeskId` vem fixo da config. Filtrar pelo desk configurado é
  o conserto; a allowlist não é o lugar de descobrir que a fila é outra.
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
- **Pergunta em aberto (Q1/Q5/Q8...) não é motivo para hardcode** — quando o valor que
  falta **varia**. O padrão é o mesmo: vira campo de `ConfigValores`, com `null`/vazio
  como default fail-closed, e o código fica pronto para o dia da resposta — um campo no
  console, sem deploy (`RF-49`).
- 🚨 **`campo_solicitante_id` (Q4) era o CONTRA-EXEMPLO, e ele caiu** (`D-36`, 11/08/2026).
  Medido contra a Atlassian real: **`customfield_10092` é "Cargo/Função que exercerá dentro
  do time" no request type 108 e "Em que sistema o Bug está ocorrendo?" no 70**; `10093` tem
  a mesma duplicidade (108 × 134). Logo **um id de campo não significa nada fora do request
  type**, e um `campo_solicitante_id` **global** escreveria o e-mail do solicitante dentro do
  campo do sistema do bug — com **HTTP 201** e nada na tela. Config não conserta: config é o
  veículo do erro. O mapa é **por request type e fica no código**, com teste. ⚠️ A emenda é
  estreita: `service_desk_id` e as allowlists continuam em config — os dois foram alterados
  em 11/08, que é a prova de que variam.
- 🚨 **Campo obrigatório do request type faltando NÃO abria chamado — dava 500** (`D-38`,
  medido na staging em 11/08/2026 com o tipo 70). A pessoa lia "Algo deu errado do nosso
  lado" e o chamado **não existia**. ⚠️ E **quatro testes verdes afirmavam que abria**: o
  `ClienteAtlassianFake` não valida nada, então o dublê escondia a divergência — mesma
  família de `linhasComoObjetos`. Agora `obrigatoriosFaltando` recusa **antes de qualquer
  efeito**, com os **rótulos** (nunca o `fieldId`, `RNF-30`), nas duas rotas.
  ⚠️ Isso **não** contraria `RNF-18`: "não bloquear" nunca resultou em chamado aberto.
  Tipo **sem** obrigatório continua abrindo sem campo nenhum, e campo extra malformado
  continua não derrubando — os dois têm teste. Schema desconhecido **não** recusa (`D-27`),
  e o campo de **anexo** fica fora da checagem, senão `RN-11` viraria "anexe um arquivo".
- 🚨 **Campo de SELEÇÃO vai como OBJETO, e quem traduz é a rota** (`D-39`, medido na staging
  em 12/08/2026 com o tipo 70). `customfield_10071` ("Recorrência") ia como a string
  `"10127"` e a criação respondia **400 = definitivo = chamado perdido** (`RNF-17`); o mesmo
  caminho com o tipo 68, que não tem campo dinâmico, devolvia 201. `tickets/valores-de-campo.ts`
  traduz pelo **tipo do campo** — string para texto, `{id}` para seleção, `[{id}]` quando
  `jiraSchema.type === 'array'` — e roda na **rota**, com o schema que `RF-62` já leu.
  ⚠️ **Não mova para o cliente:** é este objeto que o outbox persiste, e é isso que faz o
  retry de `RNF-17` reenviar o mesmo corpo sem reler schema. ⚠️ **`id`, não `value`:** o
  navegador manda `opcoes[].id`, nunca o rótulo — `{value}` exigiria texto exibido, que muda
  ao renomear a opção. A única exceção é `id === rotulo`, quando o que a Atlassian ofereceu
  foi o texto. E **opção fora da lista é recusa antes do efeito**, com o rótulo (`RNF-30`),
  como em `D-37`/`D-38`. Número, data e cascading select continuam indo crus — declarado no
  `D-39`.
- 🚨 **O leitor de PRODUTO filtra; o leitor de DIAGNÓSTICO não pode filtrar nada** (`D-44`,
  `atlassian/schema-diagnostico.ts`). `camposAdicionais` descarta `summary`/`description`/
  `priority` porque o formulário de `RF-27` já os tem fixos — descarte certo, e por isso
  `GET /api/tipos-chamado/:id/campos` **nunca mostra `priority`, exista ele ou não**. Quem
  consultou aquela rota para saber se o request type expõe prioridade recebeu a resposta
  errada com cara de resposta (12/08/2026). O diagnóstico tem caminho próprio
  (`GET /api/admin/tipos-chamado/schema`), e o teste que põe os dois leitores lado a lado
  sobre o mesmo corpo bruto existe para reprovar quem os fundir "para não duplicar código".
  ⚠️ E `tiposNaoLidos` é uma **terceira** lista: "não deu para saber" fora de
  `tiposSemPrioridade`, como `area_indisponivel` × `area_nao_encontrada`.
- ⚠️ **A prioridade NUNCA sai do app hoje** — `montarCamposSolicitante` só a envia com
  `opcoes.campoPrioridadeId` preenchido, e `contexto.ts` não passa esse campo (não há chave
  em `ConfigValores`). `RF-16` é editável na tela e inerte no Jira. Antes de ligar, `D-36`
  vale: o **rótulo** (`ROTULO_PRIORIDADE`, `Highest`/`High`/`Medium`) é forma do formulário,
  mora no código com teste, e os rótulos reais do site saem do `validValues` que o
  diagnóstico mostra — nunca da suposição.
- 🚨 **A área do solicitante é GUARDADA, nunca enviada** (`D-37`, `teamguide/area.ts`). O
  campo `Setor Gocase` do Jira é multi-checkbox com **15 opções fixas**, e a área real da
  primeira pessoa medida (`RPA`) **não está entre elas** — mandar valor fora da lista dá
  **400 = definitivo = chamado perdido** (`RNF-17`). E o campo sequer está publicado num
  formulário de portal. Há teste estrutural afirmando que `criarChamado` e `NovoChamado`
  não conhecem a palavra "área": o caminho errado funcionaria, e o sintoma seria um campo
  do Jira preenchido com dado que ninguém pediu.
- ⚠️ **`area_indisponivel` e `area_nao_encontrada` são DUAS ações de auditoria, não uma
  com `motivo`.** As duas deixam a pessoa sem área e o chamado aberto (`RNF-18`), e pedem
  trabalho oposto: cadastro faltando × fonte fora do ar. Mesma família de
  `buscaConfigurada` e `schema_tipo_indisponivel`. ⚠️ `D-40` acrescentou `fase`/`classe`
  **dentro** de `area_indisponivel` — detalhe, não terceira ação: é o mesmo plantão, com
  uma pista a mais.
- 🚨 **O timeout da TeamGuide é decidido pelo SINAL, nunca por `e.name`** (`teamguide/http.ts`,
  `D-40`). `e.name === 'AbortError'` só vale quando o aborto acontece **antes** da resposta;
  com os cabeçalhos já recebidos, abortar derruba a conexão no meio da leitura do corpo e o
  runtime lança o erro genérico de rede. Ou seja: o nosso próprio timeout se apresentava como
  `erro_de_rede`, e a hipótese mais provável (resposta grande demais para 8 s) era justamente
  a única que o registro **nunca** poderia acusar. Quem responde é `controle.signal.aborted`.
- **`erro_de_rede` sem `fase` não é diagnóstico, é desistência** (`D-40`). `FalhaTeamGuide`
  carrega `fase` — `conexao` (o `fetch` não devolveu `Response`) · `corpo` (a `Response` veio
  e a leitura falhou) · `promessa` (a falha não veio da nossa chamada) — e `classe`
  (construtor + `name` + `cause.code`, saneados). ⚠️ **Os dois só aparecem quando `motivo`
  não se explica sozinho:** `http_401` e `formato_inesperado` já dizem tudo, e espalhar `fase`
  por toda falha faz o sinal parar de saltar aos olhos. ⚠️ `classe` é **o nome** do erro,
  nunca a mensagem — charset `[a-z0-9_]` mais teto de 24 por pedaço é o que torna isso
  estrutural (`RNF-01`, `RNF-30`). O teste `/^[a-z0-9_]+$/` sobre `e.message` **saiu**: ele
  promovia mensagem de terceiro a rótulo sempre que ela fosse uma palavra minúscula.
- ⚠️ **A cache da TeamGuide é a ÚNICA que guarda PROMESSA** — as três de
  `novasCachesAtlassian` guardam valor. A promessa dá dedupe de leitura em voo, e é também a
  única coisa do arquivo que atravessa o limite de uma requisição, que é o que a plataforma
  proíbe para I/O. A fase `promessa` existe para essa hipótese **aparecer no registro** em vez
  de continuar suposta; se ela aparecer, o conserto é guardar valor, como as outras.
- **A fonte organizacional é sondada em `/api/health`, e FICA FORA do `ok` agregado**
  (`D-40`). Entrou ali porque a única evidência de que a leitura falhava era uma linha de
  auditoria produzida por alguém abrindo um chamado **numa fila real** — o custo que já deixou
  `GN-6894` para alguém apagar. Usa o mesmo `baseCacheada`: sonda que exercita outro caminho
  responde sobre o caminho que ninguém usa. 🚨 Mas a área é fail-open (`D-37`, `RNF-18`), e um
  503 por causa dela diria "o app caiu" sobre um app de pé — alarme falso ensina o time a
  ignorar o health check.
- **A base da TeamGuide é UMA chamada, e a árvore NÃO foi copiada** (`D-37`). O godocs
  deriva o nó-área canônico subindo `/teams` com **sete nomes de líder embutidos no
  código**; aqui grava-se o **time folha** de `/employees/refs`. Nome de pessoa no repo
  muda quando alguém sai, e a falha seria silenciosa (raiz não achada → área errada para
  todos). Cache no **módulo** com TTL, pelo mesmo motivo de `cachesAtlassianDoIsolate`:
  sem ela é uma ida de rede por chamado (`RNF-36`); sem TTL o isolate quente serve o
  retrato velho da empresa para sempre. E **só o sucesso é cacheado** — falha memoizada
  condenaria o isolate a responder `indisponivel` até morrer.
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
- 🚨 **A frase inteira em `text ~` casa quase nada, e o app dizia "não encontrei"** (`D-41`,
  `confluence/busca.ts`). Medido na staging em 12/08/2026: o tópico `processo de deploy na
  Gocase` devolveu **zero** e a palavra `deploy` devolvia **10 páginas** na mesma instalação —
  o cenário que `D-33` nomeia como o mais caro do projeto, e ainda gravando
  `lacunaDocumentacao: true` para um termo que ninguém deixou de documentar. `buscarComAmpliacao`
  faz **no máximo duas** consultas: a frase e, só no zero, as palavras significativas em `OR`
  (`MAX_CONSULTAS_BUSCA`, `MAX_PALAVRAS_AMPLIACAO`; termo de uma palavra não amplia).
  ⚠️ **A correção é da CONSULTA de propósito** — o mesmo defeito chega pelo tópico do modelo
  **e** pela caixa de busca da aba Documentação, onde quem digita é uma pessoa; instrução no
  prompt não alcança a segunda nem garante a primeira, e falha em silêncio. Por isso o prompt
  **não** foi tocado. ⚠️ E ampliar **nunca** mexe em `espacosPermitidos`/`labelsBloqueadas`:
  "achar mais" não pode virar "procurar em mais lugares".
- 🚨 **O grupo `OR` da busca ampliada é PARENTIZADO, e isso é a allowlist** (`montarCql`). Em
  CQL o `AND` liga mais forte que o `OR`: `space in ("GT") AND text ~ "a" OR text ~ "b"`
  significa `(space AND a) OR b` — a segunda palavra buscaria o site **inteiro**, e `RN-06`
  teria sido contornada pela própria consulta que a aplica, sem erro nenhum e com resultado
  plausível na tela. Há teste de burla afirmando os parênteses **e** a ausência da forma sem
  eles.
- **Zero por TERMO mal formado é o TERCEIRO zero** (`D-41`). Já havia zero por configuração
  (`buscaConfigurada`) e zero por escopo (`D-30`); "como faço isso?" não tem palavra
  significativa nenhuma — não houve o que procurar, e isso **não** é lacuna de `RF-42`, nem na
  auditoria (`termo_sem_palavras_significativas`, `lacunaDocumentacao: false`) nem na tabela
  `buscas`, que é o que o mapa de T-117 de fato lê. ⚠️ Termo não pesquisável que **mesmo
  assim** achou página continua em `buscas`: ali o valor é o `houve_clique`, o segundo sinal
  de `RF-42`. O que não pode entrar é o par (não pesquisável, zero).
- **Busca que reescreve o termo REGISTRA os dois lados** (`D-41`). `recurso` continua sendo o
  que a pessoa escreveu — é ele que o mapa agrupa; `detalhe.ampliou` e `detalhe.consultado`
  dizem o que foi de fato à Atlassian. Ampliação invisível faria a auditoria descrever uma
  busca que não aconteceu, que é o mapa mentindo de outro jeito.
- 🚨 **A v1 de search NÃO devolve `content.space` sem `&expand=`** (`D-42`). Todo resultado
  saía com `espaco: ''` — os 10 itens de `?q=deploy` na staging. Não é furo de exposição (o
  CQL já restringe por `space in (...)`), é a origem sumindo da tela. ⚠️ **O fallback lê
  `resultGlobalContainer.displayUrl` (`/spaces/GT`), nunca o `title`** — o título é o **nome**
  do espaço ("Gestão de Tecnologia") e a allowlist, a árvore e o `?espaco=` são todos por
  **chave**. Nome onde se espera chave é a mesma classe de bug do `spaceId` numérico da v2:
  funciona na tela e nega tudo no resto.
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
- ⚠️ **`legend` ignora o `padding` e o `gap` do `fieldset`** (`estilos.css`,
  `.pergunta-anexo`). O navegador o promove a *rendered legend* e o encaixa na borda de
  cima — na pergunta do anexo isso punha "EVIDÊNCIA" **acima** da borda e o título colado
  no topo do cartão (medido em 10/08/2026: `legend.top === fieldset.top`). O conserto é
  `float: left` + `width: 100%`: o float tira o elemento daquela categoria e, num container
  flex, é ignorado — sobra um item de flex comum, que respeita padding e gap. Não trocar o
  `fieldset`/`legend` por `div`: são eles que nomeiam o grupo de rádio para leitor de tela.
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
- 🚨 **O editor novo grava o conteúdo DUAS vezes, e renderizar os dois duplicava a página**
  (`converterAdf`, `D-34`). `ac:adf-extension` traz o nó (`ac:adf-node` → `ac:adf-content`)
  **e** uma cópia em HTML (`ac:adf-fallback`) para editores antigos. As três tags eram
  desconhecidas, e tag desconhecida é **desembrulhada** — então o painel de boas-vindas
  aparecia com o título em português e, logo abaixo, em inglês (o fallback vem em inglês),
  medido no app real em 10/08/2026. A regra é **conteúdo do nó, senão fallback, nunca os
  dois**: o nó ganha porque é o conteúdo de verdade. ⚠️ **Mas "só o nó" quebraria os blocos
  inline** — `status`/`date` vêm **sem** `ac:adf-content` (o texto mora nos atributos) e é o
  fallback que traz a `ac:structured-macro` equivalente. E `ac:adf-attribute` devolve **nada**
  por necessidade, não por zelo: desembrulhado, o **valor** viraria texto visível
  (`1f5d1 #c9372c info` solto antes do painel — ruído **e** parâmetro na tela, `RNF-30`).
  `panel-type` é a única exceção lida, porque é apresentação e é o que faz aviso escrito no
  editor novo continuar sendo aviso.
- 🚨 **`status` tem texto e NÃO tem corpo — o critério "tem `ac:rich-text-body`?" a jogava
  no placeholder** (`D-34`). O texto mora num **parâmetro** (`title`), como a linguagem do
  bloco de código, então a macro que marca "Concluído"/"Em andamento" dizia *"o goatlas ainda
  não sabe mostrar este bloco"* — acusando limitação nossa sobre texto que estava no storage.
  ⚠️ **A cor não vai para a tela** e isso é decisão: `Green`/`Red` seria inventar paleta (a
  identidade não tem vermelho nem verde, §1.3) **e** comunicar estado só por cor. Quem diz o
  estado é a palavra que a pessoa escreveu. E **`title` vazio devolve nada, não o
  placeholder** — pílula vazia não carrega informação, e o placeholder ali anunciaria
  conteúdo escondido que não existe.
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
- 🚨 **A migração roda UMA VEZ POR BANCO, não por requisição** (`db/schema.ts`,
  `garantirMigracao`, `D-32`). São 35 `CREATE` + 3 `ALTER` sequenciais e `await`ados;
  chamados de `montarContexto` eles eram o **piso de ~400 ms de toda rota** — medido nos
  logs em 10/08/2026: `/api/cron/enviar-notificacoes` com a **fila vazia** levava 376–584 ms.
  A memoização é `WeakMap` por objeto de banco, e é isso que a torna correta nos dois mundos:
  em produção `env.DB` é a mesma referência por isolate; nos testes cada caso tem banco
  próprio. ⚠️ Um `let migrado` global daria o mesmo ganho e faria o **segundo teste da suíte**
  rodar contra um banco sem tabela nenhuma. E a falha **não** fica memoizada — senão um erro
  transitório no primeiro boot condenaria o isolate a nunca ter schema.
- 🚨 **O cache de `RNF-13` vive no MÓDULO, não na instância do cliente** (`contexto.ts`,
  `cachesAtlassianDoIsolate`). Ele existia desde a Fase 1 e **nunca acertou em produção**:
  morava na instância, e `montarContexto` cria uma por requisição. Vários comentários do
  código já contavam com ele ("contido pelo cache de conteúdo") — logo, cada leitura de página
  rebuscava metadados, labels, restrição e corpo, e cada nível do breadcrumb rebuscava os três
  primeiros de novo. ⚠️ Compartilhar é seguro **porque a identidade é sempre a conta de
  serviço** (`D-01`): não há resposta "de um usuário" para vazar para outro. Sob
  `raiseOnBehalfOf` (`RNF-22`) a cache teria de ser por identidade — é por isso que ela mora
  em `contexto.ts`, à vista. ⚠️ E ela guarda o **insumo**, nunca a **decisão**: `RN-06`
  continua avaliada por requisição contra `ctx.valores`, então allowlist mudada no console
  vale na requisição seguinte.
- **Cache compartilhada tem TETO de entradas, e o corpo da página tem cache própria.**
  Enquanto morria com a requisição, crescer sem limite era inócuo; por isolate é vazamento de
  memória com prazo. O corpo vai a 400 KB (o teto da sanitização), então ele tem cache
  separada com teto 30 — teto único obrigaria a escolher entre guardar poucas páginas ou
  arriscar centenas de MB num Worker de 128 MB.
- 🚨 **Laço de rede é paralelo COM TETO, nunca `Promise.all`** (`src/lib/paralelo.ts`,
  `CONCORRENCIA_ATLASSIAN = 5`, `CONCORRENCIA_IA = 3`, `D-32`). Havia cinco laços
  `for … await` sobre listas de rede — lista de chamados (até **100** `obterChamado` em
  série), restrição por página na busca e na árvore, espaços da allowlist, classificação da
  Regra 2 (uma chamada de IA por ticket) — e o tempo era a **soma**. ⚠️ O teto não é
  timidez: o burst limit da Atlassian por API token **não é publicado** e os headers
  `X-RateLimit-*` só aparecem no 429 (`RNF-15`, `R-02`); disparar a lista inteira é como se
  descobre o limite do jeito ruim, e um turno que toma 429 e espera 2 s ficou **mais lento**
  que o laço em série. O teto vale **por laço**, não global — dois usuários simultâneos somam.
- **Todo laço paralelizado PRESERVA A ORDEM** (`mapearComLimite`). A busca ordena por
  relevância, a árvore por título e a lista de chamados pelo banco; devolver na ordem de quem
  respondeu primeiro faz a mesma tela aparecer diferente entre duas cargas, o que se lê como
  defeito.
- ⚠️ **A extração da proposta corre JUNTO com a última ida ao modelo** (`orquestrador.ts`,
  `propostaEmVoo`). Um turno fazia **três** chamadas em série ao provedor, e a 2ª (texto para
  a pessoa) e a 3ª (`extrairProposta`) partem do mesmo histórico — a resposta do modelo só é
  persistida depois da extração, então a 3ª nunca viu a 2ª. É seguro por razão **estrutural**:
  só arranca com as duas verificações concluídas, e nesse estado `toolsPermitidas` é lista
  **vazia**, logo o ciclo seguinte não executa tool e não pode nascer bloqueio concorrente.
  🚨 Mesmo assim `tentarMontarProposta` **reconfere `temBloqueioPendente` antes de gravar** —
  entre começar a extração e voltar dela passa uma ida ao provedor, e `if` que rodou antes do
  `await` não protege o que vem depois. `RN-07` já foi burlada uma vez (`D-21`).
- ⚠️ **`max_tokens` NÃO é conserto de latência, e streaming conflita com o desenho** (`D-32`).
  Num modelo com raciocínio o teto conta tokens de raciocínio: teto baixo devolve resposta
  **vazia** (bug que o fake não pega), e teto generoso não corta nada. Streaming é o que mais
  melhoraria a percepção e **não cabe** enquanto o servidor **descartar** o texto do modelo em
  caso de bloqueio (`D-21`) — não se transmite texto que talvez seja jogado fora.
- **Teste de latência afirma sobre CONTAGEM DE CHAMADAS e SIMULTANEIDADE**
  (`tests/latencia.test.ts`), não sobre resultado. Os quatro defeitos de `D-32` conviveram com
  800 asserções verdes porque o app respondia **certo** em todos eles. E o teste da
  sobreposição das duas chamadas de IA falha por **deadlock**, não por tempo: o `chat` nº 2 só
  termina depois de a extração começar, então serializar de novo trava o teste em vez de
  produzir um número frágil.

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
- 🚨 **Cada `await db.exec` é uma ida de REDE, e `montarContexto` roda por requisição**
  (`RNF-36`, `D-35`). `migrar` reaplicava os 32 statements de DDL (17 tabelas + 15
  índices) mais os 3 `ALTER` em série a **cada** requisição `/api/*`: **36 idas ao banco**
  (35 na migração + 1 do `config.carregar()`) antes de a rota começar a trabalhar — piso
  medido de **442 ms** no cron mais barato, e o console de admin dispara seis requisições
  no boot. Agora são **1** (mesmo isolate) ou **2** (isolate novo, pela
  sonda `meta_schema`). ⚠️ **Idempotente não é grátis**, e o teste não pega: o comportamento
  estava certo, e no shim em memória cada statement custa microssegundos — o custo é de rede
  e só existe na plataforma. Mesma família de `linhasComoObjetos`. Por isso o teto de
  `RNF-36` é em **idas ao banco**, nunca em milissegundos. Ao acrescentar tabela em
  `TABELAS`, **não** há número de versão a subir: a marca é derivada do texto do schema, de
  propósito.
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
[004](specs/004-piloto-e-rollout/tasks.md) ·
[005](specs/005-anexo-na-criacao/tasks.md).

**A spec 005 (anexo na criação) está completa em código.** `RF-61`/`RF-62`/`RF-63`/`RN-11`:
a declaração obrigatória travada no servidor nas duas rotas de criação, o upload em dois
passos com o id vivendo só no servidor, a materialização depois da criação (e fora do
`catch` que classifica falha), as duas telas e o indicador de evidência no console. A única
tarefa aberta era **T-425** — ✅ **respondida em 11/08/2026**:
`GET /api/tipos-chamado/68/campos` na staging devolveu **`aceitaAnexo: true`**. O request
type expõe campo de anexo, então o anexo na criação funciona sem uma linha a mudar.

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
(`3936ca2d`) passa a ser obrigatória antes disso (`D-24`).

✅ **`criarChamado` (`T-063`) EXECUTOU** — 11/08/2026, `GN-6894`, `HTTP 201`, criado pela
staging com o somente-leitura desligado por ~30 segundos e religado em seguida. Lido de
volta pela rota isolada por e-mail: a descrição chegou com o bloco de autoria do `D-13` e a
chave `form:<email>:<chave>`. ⚠️ **É um chamado de teste numa fila real** (`[TESTE goatlas -
ignorar]`) — alguém do time de tech precisa apagá-lo; o app não tem essa operação.
⚠️ **Mandamos `prioridade: "normal"` e o chamado voltou com `prioridade: null` e
`slaPrimeiraResposta: null`.** Uma metade já está explicada: **a prioridade nunca sai do
app**. `montarCamposSolicitante` só a envia se `opcoes.campoPrioridadeId` estiver preenchido,
e `contexto.ts` **nunca passa esse campo** — não existe chave para ele em `ConfigValores`.
Logo `RF-16` (prioridade editável) não tem efeito no Jira hoje, independentemente do que o
request type exponha. A outra metade — *o tipo expõe campo de prioridade?* — é medível desde
`D-44`: `GET /api/admin/tipos-chamado/schema` (ver `docs/DEPLOY.md`). ⚠️ **Não a responda por
`GET /api/tipos-chamado/:id/campos`**: aquela rota descarta `priority` por construção, e a
resposta é "não tem" nos dois mundos.
🚨 **E o `slaPrimeiraResposta: null` é um TERCEIRO defeito, não consequência dos outros dois**
(`D-47`, `T-100`): `obterChamado` monta a URL **com** `expand=…sla…` (`cliente.ts:516`) e
devolve `slaPrimeiraResposta: null` **fixo** (`cliente.ts:539`) — a resposta é pedida, paga e
descartada. Vale também para o caminho degradado (`tickets/servico.ts:411`), e **nem o fake
preenche** (`fake.ts:359`), então o campo nunca teve valor em teste nenhum. É por isso que
`RF-29` (SLA na lista) e `RF-31` (histórico de SLA no detalhe) não aparecem em tela: o dado
nunca é lido. ⚠️ Se o Jira deriva o SLA da prioridade que não mandamos, consertar só um dos
dois não produz número na tela.

⚠️ **A allowlist de tipos foi ampliada em 11/08** para os **15** tipos do `GN`
(`68,70,71,89,90,91,92,93,94,95,96,108,134,143,144`), em prod e staging. O **`69`
("Solicitação enviada por e-mail") continua fora de propósito** — `D-23`: é o canal de
entrada por e-mail do próprio JSM, não um formulário para alguém escolher.

⚠️ **Não existe fila do RPA, e o "ambiente do RPA" não serve para teste** (11/08). O site
tem 5 service desks (`GN` 4 · `SHPF` 7 · `OMI2020` 8 · `GOSHOP` 9 · `JTK` 11) e nenhum é do
RPA. A área do time é `TASK`, um projeto **Jira Work Management** (`/jira/core/projects/`) —
o cliente inteiro fala `servicedeskapi`, então `TASK` é inalcançável, e escrever
`/rest/api/3/issue` só para testar testaria um caminho que não vai ao ar (sem request type,
sem comentário público/interno, sem SLA). Há também um espaço `IA` no Confluence (2 páginas),
que é documentação, não fila.

🚨 **A área do solicitante NUNCA foi resolvida no app publicado** (medido em 12/08/2026, duas
criações na staging às 12:08 e 12:21). As duas registraram
`area_indisponivel {"motivo":"erro_de_rede","caiuNoMapa":false}`: os chamados abriram (o
fail-open de `D-37` funciona), mas `vinculos.area` fica `null`. **Este caminho nunca rodou
fora do fake** — até 11/08 a TeamGuide só tinha sido chamada por `curl`, de fora do Worker.
`D-40` desfez a indistinção do rótulo (fase + classe, e o timeout pelo sinal) e pôs a sonda em
`/api/health`; **a causa continua em aberto**, e o que a fecha é `dependencias.teamguide.detalhe`
na staging — a tabela de leitura está no `D-40`. ⚠️ Nada foi paginado nem teve o timeout
mexido de propósito: mudar o comportamento no mesmo movimento em que se instala o instrumento
estraga a medição.

🚨 **A pessoa não via os anexos do próprio chamado** (medido em 12/08/2026 no `GN-6898`, que
nasceu com arquivo anexado). `RF-31` é P0 e cita anexos desde o texto do requisito, e `T-081`
estava marcada `[x]` com essa parte nunca implementada — foi o achado que abriu a auditoria de
`D-47`, e está resolvido em `D-45`/`T-084`. ⚠️ **O que a staging ainda tem de responder** é se
o endpoint de comentários aceita `expand=attachment` e se a materialização de `RF-61`/`RF-34`
produz mesmo o comentário público que carrega o anexo: as duas se leem em
`anexos`/`anexosIndisponiveis` no detalhe de `GN-6898`, e `anexosIndisponiveis: true` com o
arquivo lá dentro é a resposta "não".

**1103 testes · typecheck limpo · build limpo**, tudo sem credencial e sem rede.
⚠️ `tests/latencia.test.ts` tem **um** caso que afirma sobre tempo de parede ("8 itens de
20 ms com teto 4") e falha de vez em quando em máquina carregada — visto em 12/08/2026, sem
relação com o código sob teste.
⚠️ **Teste verde não é cobertura** (`D-47`, 12/08): a auditoria requisito→código mexeu em
**dezessete** tarefas cujo board divergia do que o código faz, com a suíte inteira verde —
porque nenhum achado é comportamento *errado*, é comportamento **ausente**, e teste ausente
não falha. O formato dominante é *servidor pronto, tela ausente* e *metade de uma frase com
"e"*. Os três que mudam o que se sabe do produto: a prioridade que não sai do app (`T-099`),
o SLA que nunca é lido (`T-100`) e a faixa de calibragem que o rewrite do console descartou
(`T-233`/`T-310`). A lista por tarefa está nos `tasks.md`.
⚠️ **A latência de `RNF-12` foi corrigida em código e NÃO foi medida em produção** (`D-32`,
10/08/2026). Eram quatro defeitos somados, todos invisíveis para teste de comportamento
porque o app respondia certo: migração por requisição (~400 ms de piso), cache de `RNF-13`
que nunca acertava, cinco laços de rede em série e três idas ao provedor de IA quando duas
bastavam. As correções são medidas por **contagem de chamadas** em `tests/latencia.test.ts`;
o p95 de `RNF-12` (busca < 2 s, primeira resposta do agente < 5 s) só se fecha medindo no app
publicado.


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
| **O request type expõe campo de anexo?** (era `T-425` da spec 005) | time de tech | Verificação de go-live, não código: sem o campo o anexo na criação fica **dormente** e cai em `SC-05` sem quebrar nada; com ele funciona sem uma linha a mudar. Só se confirma observando o envio real, o que exige desligar `GOATLAS_SOMENTE_LEITURA` (`D-24`) |

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
