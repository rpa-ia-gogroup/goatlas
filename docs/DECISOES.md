# Decisões — goatlas

Registro das decisões conscientes do projeto (constituição, Princípio XIV) e das
respostas às perguntas em aberto de [`REQUISITOS.md`](REQUISITOS.md) seção 10.

**Como usar:** decisão tomada entra aqui **no mesmo PR** em que muda o
comportamento. Pergunta respondida sai de "Em aberto" e vira uma entrada `D-NN`.
Uma tarefa que dependa de uma pergunta em aberto **não entra em `/implement`**.

---

## Decisões fechadas

### D-01 · Arquitetura de identidade: proxy total via conta de serviço
**Data:** 03/08/2026 · **Quem:** João Victor Esteves (documento de requisitos, §1.2)
· **Status:** fechada, com revisão trimestral

O app fala com a Atlassian por **uma única conta de serviço**. O colaborador não
existe como identidade no Atlassian. A alternativa (A) — provisionar cada pessoa
como *customer* JSM (gratuito e ilimitado) e criar o chamado com `raiseOnBehalfOf` —
foi avaliada e **confirmada como tecnicamente viável e gratuita para o
solicitante**.

**Por que (B):** velocidade de implementação — uma credencial, sem rotina de
provisionamento, sem assento de agente para a conta de serviço.

**Custo aceito, explícito:**
- **R-01** exposição de conformidade de licenciamento na leitura de Confluence;
- **R-03** reporter único distorce fila, SLA nativo e métricas por solicitante;
- **RF-21**, **RF-22**, **RNF-21** existem só para compensar a ausência de
  identidade real (campo customizado, tabela de vínculo, reconciliação).

**Caminho de saída:** **RNF-22** — o cliente Atlassian é camada isolada para que a
migração para (A) seja mudança localizada. **Não achatar essa camada.** Custo da
migração, para registro: um assento de agente para a conta de serviço
(`raiseOnBehalfOf` não está disponível a quem tem só permissão de customer) e uma
rotina de provisionamento no primeiro acesso, incluindo a adição explícita à lista
de Customers do projeto (necessária para quem já tem conta Atlassian corporativa).

**Revisão:** trimestral (**RNF-35**), e imediata se R-01 ou R-03 se materializarem.

---

### D-02 · Q12 respondida: o SSO Google é do edge do GoDeploy, o app não implementa OAuth
**Data:** 03/08/2026 · **Quem:** Kaique (Q12 era dele) · **Status:** fechada,
com verificação pendente

O GoDeploy oferece autenticação pronta: app com `visibility: "authenticated"` tem o
OAuth feito **no edge**, que injeta o e-mail do visitante no header
`x-godeploy-user-email`. Confirmado no app `godocs` (`674a3710`,
`visibility: authenticated`), que já opera assim em produção.

**Consequência:** **RF-01** e **RF-06** ("do login à conversa em um clique", sem
cadastro) saem quase de graça — o app não implementa fluxo OAuth próprio.

**O que continua sendo do app, e não é negociável:** revalidar o domínio **no
servidor** a cada requisição (**RF-01**, **RF-05**, **RNF-05**). Não confiar só no
edge: o e-mail do header é a identidade, mas a política de quais domínios entram é
do app, porque **Q7** (quais domínios além de `@gocase.com`) é decisão de negócio.

**A verificar antes do MVP:** (a) se o edge restringe o login ao Google Workspace
corporativo ou aceita qualquer conta Google — muda se a checagem de domínio do app
é defesa em profundidade ou a única barreira; (b) se existe header de nome
(`x-godeploy-user-name` no godocs) para não pedir nome ao usuário; (c) como o edge
se comporta com conta **desativada** no Workspace, que **RF-05** exige negar já na
requisição seguinte.

---

### D-03 · Repositório: `rpa-ia-gogroup/goatlas` (privado)
**Data:** 03/08/2026 · **Quem:** Kaique · **Status:** fechada

Como os requisitos pediam, o repo vive na organização de RPA:
**`rpa-ia-gogroup/goatlas`**, privado. Kaique é admin da org.

Nasceu em `while-kaique/goatlas` (a org ainda não aparecia para o token) e foi
**transferido** no mesmo dia; o remote local aponta para a org. Nada no código
depende do host — o app irmão `godocs-main` continua na conta pessoal.

---

### D-04 · Fase 1 ganha um formulário mínimo de abertura sem agente
**Data:** 03/08/2026 · **Quem:** Kaique · **Status:** fechada

Resolve a contradição encontrada no material de origem: o faseamento (§12) tirava
`RF-27` da Fase 1, mas **RNF-18** define o formulário estruturado como *o* caminho
de degradação quando a API de IA falha, e a **Definição de Pronto da Fase 1** (§13)
exige explicitamente *"falha da API de IA não impede abrir chamado"*.

**Decisão:** entra na Fase 1 um formulário **mínimo** — título, descrição, tipo
vindo da allowlist (`RF-28`) e prioridade escolhida pelo usuário. **Não** entra a
renderização dinâmica a partir do schema de campos do tipo de chamado
(`/servicedesk/{id}/requesttype/{id}/field`), que é o que `RF-27` pede por
inteiro: essa parte vai para a Fase 2.

**Por quê:** sem caminho sem-IA, uma indisponibilidade do provedor externo derruba
a única porta de entrada de chamados da empresa. Custo de um formulário simples é
pequeno perto de um ponto único de falha nessa posição.

**Consequência:** `RF-27` passa a ser parcialmente Fase 1 (formulário mínimo) e
parcialmente Fase 2 (campos dinâmicos). Como o formulário abre chamado, ele passa
pelas **mesmas** travas de servidor da criação por conversa — `RF-17`
(confirmação), `RF-24` (idempotência), `RF-21`/`RF-22` (solicitante e vínculo),
`RF-28` (allowlist) — **exceto** `RF-08`/`RN-01`: sem conversa não há tools a
ordenar, e por isso todo chamado nascido do formulário é registrado como **não
verificado pelas regras**, para não virar bypass silencioso da deflexão
(Princípio XI). Se o formulário virar rota de fuga da Regra 1/2, isso aparece na
métrica e o produto decide o que fazer.

**Atualização (05/08/2026, T-130):** a parte que faltava — campos adicionais
renderizados a partir do schema do request type — está pronta. `RF-27` está
**completo** (`Status` desta decisão passa a refletir isso), aditivo ao
formulário mínimo: um `requestTypeId` sem schema disponível (ou uma falha ao
buscá-lo) não impede o formulário fixo de abrir chamado — o mesmo raciocínio de
degradação graciosa que motivou esta decisão no dia 1.

---

### D-05 · Q6 (parcial): a camada de IA aponta para o proxy corporativo
**Data:** 03/08/2026 · **Quem:** Kaique · **Status:** parcial — falta a parte do João

**RNF-34** manda preferir o proxy de IA corporativo "se já existir". Ele existe e
já está em produção no `godocs`: `ai-proxy.gogroupbr.com`, compatível com a API da
OpenAI, configurado por `LLM_BASE_URL` + `API_PROXY_TOKEN`, com fallback direto ao
provedor quando o gateway demora ou erra.

**Decisão:** a camada de IA do goatlas (`RNF-23`) é planejada contra esse proxy. O
app **não** contrata acesso novo.

**Continua em aberto, e é do João:** a política de **retenção e treinamento** do
provedor por trás do proxy — `RNF-34` exige verificar, porque conteúdo interno
(tickets e Confluence) trafega para lá. Isso não bloqueia a arquitetura, mas
bloqueia o rollout: é conformidade, não implementação.

**Lição do godocs a herdar no plano:** o proxy pode demorar. O godocs usa timeout
de ~25s com fallback direto ao provedor — sem isso, `RNF-12` (primeira resposta
< 5s no p95) fica à mercê do gateway.

---

### D-06 · Planejar todas as fases marcando as suposições
**Data:** 03/08/2026 · **Quem:** Kaique · **Status:** fechada, com prazo

Kaique optou por planejar **as quatro fases** agora, assumindo defaults para as
perguntas em aberto e **marcando cada suposição**, em vez de parar no `/clarify`.

**Tensão declarada:** contraria o Princípio II (No Guessing) e o gate do `/plan`.
Aceita conscientemente para ter a visão completa do trabalho antes de começar.

**Condições que tornam isso seguro — e que não são opcionais:**
1. Toda suposição aparece marcada como **`[SUPOSIÇÃO]`** no artefato, com a
   pergunta Q de origem. Nunca dissolvida no texto como se fosse decisão.
2. Suposição **não autoriza implementar**. Tarefa marcada `[BLOQUEADA: Qn]` não
   entra em `/implement` antes da resposta estar aqui — o gate segue valendo.
3. Quando a resposta chegar, o plano é **revisado**, não remendado: a suposição
   errada pode invalidar tarefas inteiras, e isso é esperado.

---

### D-07 - Publicar em modo demonstracao antes de existir credencial
**Data:** 04/08/2026 · **Quem:** Kaique · **Status:** fechada

O app está no ar em **https://goatlas.devgogroup.com** (`appId 9c47f42f`,
`visibility: authenticated`) rodando em **modo demonstração**: fakes semeados com
dados fictícios, nenhuma chamada à Atlassian ou a provedor de IA. Publicado antes
de **Q1** de propósito — dá para mostrar o produto funcionando (login, deflexão,
override, recibo, acompanhamento) enquanto a conta de serviço não existe.

**A tarja de aviso é parte da decisão, não enfeite.** Sem ela alguém abre um
"chamado", vê a chave na tela e acredita que o pedido chegou ao time de tech —
espera uma resposta que nunca vem, e o problema fica sem tratamento. Isso é pior
que o app não existir. Por isso `modoDemo` é exposto em `/api/auth/me` e
`/api/health`, e a interface mostra o aviso de forma permanente.

**Bootstrap por env, porque o app é fail-closed.** Toda allowlist nasce vazia e
vazio significa negar (`RNF-07`), então um app recém-deployado negaria **todo
mundo** — inclusive quem entraria para configurá-lo. `GOATLAS_DOMINIOS` e
`GOATLAS_ADMINS` resolvem o ovo e a galinha: valem enquanto a chave **não existe**
no banco; no instante em que um admin salva pelo console, o banco manda (`RF-49`).
Isso **não** afrouxa o fail-closed — env vazio e banco vazio continua negando, e há
teste para as duas metades.

Configurado hoje: domínio `gocase.com` **[SUPOSIÇÃO: Q7]** · admin
`kaique.breno@gocase.com`. Ambos mudam por secret ou pelo console, sem deploy.

**Pendência que esta decisão cria:** quando as credenciais reais entrarem, este app
passa a ser **produção** (é ele que tem o slug bom). A regra 10 do `CLAUDE.md` exige
staging antes de prod, então **antes do primeiro deploy com credencial real** é
preciso criar o app de staging. Não deixar isso para a hora do deploy.

---

### D-08 · Sem botão de sair: a conta fica setada enquanto durar
**Data:** 04/08/2026 · **Quem:** Kaique · **Status:** fechada — **precisa do aval do João**

A interface **não tem logout**. A pessoa entra uma vez pelo Google e a conta
permanece; o canto superior mostra nome e e-mail apenas para ela saber **com qual
conta** está.

**Racional:** trocar de conta não é caso de uso desta ferramenta. Quem tem duas
contas corporativas é exceção, e resolve limpando os cookies. Botão de sair em
computador compartilhado de loja ou expedição convida mais confusão do que resolve —
alguém sai sem querer e a próxima pessoa acha que o app quebrou.

**⚠️ Isto contraria `RF-03`**, que pede "sessão com expiração configurável e
**logout explícito**" e é **P0**. A divergência está registrada aqui de propósito, e
não é esquecimento:

- A **expiração de sessão** continua existindo — é do edge do GoDeploy (`D-02`), não
  nossa.
- O que sai é só o **logout explícito** na interface.
- **`RF-03` é requisito do João.** Como ele escreveu o documento, esta decisão precisa
  do aval dele para virar alteração de `REQUISITOS.md`. Até lá, `RF-03` fica marcado
  como **parcialmente atendido**, não como cumprido.

**Como voltar atrás, se ele quiser o botão:** a implementação existiu e está no
histórico (commit do PR #5). O achado técnico que vale reaproveitar é que o logout do
edge **ignora parâmetro de redirect** (testado com `redirect`, `next`, `returnTo`,
`return_to`, `r`, `continue`, `redirect_uri`, `callback`) e sempre leva ao domínio da
plataforma — que foi exatamente o problema: quem saía caía numa tela "GoDeploy
Gateway" sem caminho de volta.

---

### D-09 · Tela de admin antecipada da Fase 2 para a Fase 1
**Data:** 04/08/2026 · **Quem:** Kaique · **Status:** fechada

`RF-49` (allowlists pela interface), `RF-50` (parâmetros das regras) e `RF-56`
(auditoria) estavam planejados para a **Fase 2**. Vieram para a Fase 1.

**Por quê:** o admin não tinha **nenhuma** superfície. "Admin vê tudo" era uma flag
no banco — a pessoa entrava e não havia nada que a distinguisse de um colaborador,
nem forma de saber que era admin. E `RF-50` é o que permite **calibrar a deflexão**:
sem tela, ajustar threshold exigiria `curl`, o que na prática significa não ajustar.

**O que entrou:** selo `admin` ao lado do nome · aba "Configuração" (só para admin)
com os campos que importam, cada um explicando **o que o vazio faz** — porque o app é
fail-closed e alguém apagaria a lista de espaços achando que "vazio = todos" ·
auditoria de **todos** os atores, com filtro por e-mail.

**Bug corrigido no caminho:** `GET /api/admin/auditoria` sem filtro usava o e-mail do
**próprio admin** como default, então o console mostrava só as ações de quem estava
olhando — inútil para investigar, que é a razão de `RF-56` existir. Agora sem filtro
traz tudo.

**O que NÃO veio:** o console de governança de assentos (`RF-51`…`RF-54`) segue na
Fase 2 — depende da credencial de Org Admin (**Q1**).

⚠️ **A aba escondida é conveniência, não segurança.** Quem garante o acesso é o gate
de servidor em cada rota `/api/admin/*`, com teste de burla. Esconder no cliente
apenas evita mostrar um botão que daria 403.

---

### D-10 · Imagem em URL externa não é renderizada: toda imagem vem pelo proxy de anexo
**Data:** 04/08/2026 · **Quem:** Kaique · **Status:** fechada

O sanitizador (`RNF-06`) **descarta** `<img src="https://...">` e
`<ac:image><ri:url .../></ac:image>`. Só imagem de **anexo da página** é renderizada,
e sempre pela rota de proxy do app.

**Por quê:** não é (só) XSS. Uma imagem externa numa página que **qualquer pessoa da
empresa pode editar** é um rastreador de leitura: o IP e o horário de cada colega que
abre a página vazam para um domínio de terceiro, e nada na tela indica isso. Quem
edita a página não precisa de intenção má — basta colar a imagem de um site
qualquer. Sob proxy total (`D-01`) o app é a única superfície de leitura de quem não
tem assento, então o que ele decide buscar é o que vaza.

**Custo aceito:** ilustração legítima hospedada fora do Confluence não aparece. O
sanitizador registra o descarte (`imagem_externa_recusada`), e o alinhamento
esperado é "suba a imagem como anexo da página".

**Onde reverter, se um dia fizer sentido:** `IMAGEM_EXTERNA_PERMITIDA` em
`src/lib/confluence/sanitizar.ts`. É uma constante só, e o nó `origem.tipo:
'externa'` já existe — o renderizador **revalida a URL** de qualquer forma, então
ligar a constante não abre caminho para `data:` nem `javascript:`. Reabrir a decisão
aqui antes de mexer.

⚠️ Isto **não** contraria `RF-39` (que já manda servir imagem e anexo pelo proxy);
apenas fecha o caso que `RF-39` não nomeava.

---

### D-11 · O proxy de anexo AFIRMA o `Content-Type`; ele nunca repassa o da Atlassian
**Data:** 04/08/2026 · **Quem:** Kaique · **Status:** fechada

`GET /api/confluence/anexo/:id/:nome` decide o tipo por **allowlist**
(`confluence/anexo.ts`): PNG, JPEG, GIF, WebP, AVIF, BMP e PDF saem `inline` com o
próprio tipo; **todo o resto** sai `application/octet-stream` + `Content-Disposition:
attachment`, sempre com `nosniff` e `Content-Security-Policy: default-src 'none';
sandbox`. **`image/svg+xml` fica de fora de propósito.**

**Por quê:** a sanitização (`RNF-06`) fecha o XSS do **corpo** da página; o anexo é a
outra porta da mesma sala. Um arquivo cujo tipo de upload é `text/html`, servido do
**nosso** domínio, roda com a sessão do app — e o tipo vem da Atlassian, que só
repete o que alguém escolheu no upload. SVG é o caso que parece exceção injusta e não
é: SVG é documento XML com `<script>` e handlers de evento, então exibi-lo inline é o
mesmo vazamento com outro nome.

**Custo aceito:** diagrama em SVG vira download em vez de aparecer na página, e
formato legítimo fora da lista (`.docx`, `.xlsx`) também. Chato, reversível e
auditável — o contrário não é.

**Detalhe que é trava, não estilo:** o **nome do arquivo** é escolhido por quem edita
a página e entra num cabeçalho HTTP. Vai como `filename` ASCII entre aspas (sem
aspas, sem barra, sem controle) **mais** `filename*=UTF-8''…`, que preserva o acento
— PT-BR não é caso de borda aqui. CRLF no nome é tentativa de escrever um segundo
cabeçalho, e o teste de burla cobra a forma do cabeçalho inteiro, não a ausência de
palavras proibidas.

**Onde reverter:** `TIPOS_INLINE` em `src/lib/confluence/anexo.ts`. Entrar nessa
lista é decisão de segurança; passe por aqui antes.

---

### D-12 · Toda recusa de leitura devolve a MESMA 404; só indisponibilidade é 503
**Data:** 04/08/2026 · **Quem:** Kaique · **Status:** fechada

Na leitura direta (`RF-40`) e no proxy de anexo, as recusas — espaço fora da
allowlist, label bloqueada, página restrita, página na lixeira, id inválido, página
inexistente — produzem resposta **byte a byte idêntica**. O motivo real fica na
auditoria. Dependência fora do ar é o único caso distinguido: `503` com "tente de
novo em instantes".

**Por quê:** é o mesmo raciocínio do 404-em-vez-de-403 de `RF-30`. Um corpo diferente
por motivo é oráculo: confirma que a página existe e insinua por que está fechada — e
o ID de página do Confluence é curto e enumerável. Já o 503 mentir 404 tem custo
oposto e concreto: a pessoa conclui que a documentação não existe e abre chamado por
uma página que estava lá (`RNF-18`, `RNF-19`). Indisponibilidade não é fato sobre a
página, é fato sobre nós.

**Também fechado aqui:** página com `status` diferente de `current` (lixeira,
rascunho) **não** é exposta. Orientação revogada guiando uma decisão é pior que página
nenhuma.

**Consequência aceita:** durante uma queda da Atlassian, falha ao consultar restrição
faz uma página liberada responder 404 — fail-closed, igual à busca. Custa uma página
a menos; o contrário custa conteúdo restrito na tela de quem não devia ver.

---

### D-13 · RF-33: prefixo no corpo do comentário, com nome do login corporativo
**Data:** 05/08/2026 · **Quem:** Kaique · **Status:** fechada

Resolve o `[NEEDS CLARIFICATION]` de `spec.md` §10 (interage com R-03 e Q10): o
comentário público que o goatlas posta no Jira, partindo sempre da conta de
serviço (`D-01`), leva um **prefixo visível no corpo** identificando quem pediu de
verdade — formato `**Nome** (email) via goatlas:`.

**Por quê este caminho, e não só o rastro interno:** quem resolve o chamado
trabalha no Jira **nativo**, não no console do goatlas. Deixar a identidade só em
`vinculos.solicitante_email` (visível apenas na auditoria do admin) obrigaria o
time de tech a abrir uma segunda ferramenta para saber quem pediu cada coisa —
exatamente o atrito que `RF-33`/`R-03` existem para evitar.

**O que torna o prefixo confiável, mesmo a mensagem partindo do bot:** o nome e o
e-mail vêm do **login corporativo Google**, obrigatório por `RF-01`/`RF-05` — a
pessoa não digita o próprio nome em lugar nenhum, então não há como forjar a
atribuição pela UI. O rastro interno (`vinculos`, auditoria) continua existindo em
paralelo, para investigação — os dois não são alternativas, são camadas.

**Implementação:** já existia como função pura isolada
(`atlassian/comentarios.ts#prefixarAutoria`, escrita quando a pergunta ainda
estava aberta, propositalmente pronta para o dia da resposta). O que faltava era
a rota (`POST /api/chamados/:issueKey/comentarios`) passar o **nome**, não só o
e-mail — sem isso o prefixo saía com o e-mail duplicado
(`**ana@gocase.com** (ana@gocase.com)`). `Identidade.nome` já existe desde
`RF-04`/`RNF-05` (do header do edge quando presente, ou derivado do e-mail via
`derivarNomeDeEmail` — ver `D-02`/T-021), então a mudança foi só **passar o
campo que já existia**, não criar um novo.

---

### D-14 · Q1 parcialmente respondida: o trio Jira/Confluence entrou; a Organizations API e a IA não
**Data:** 05/08/2026 · **Quem:** Kaique · **Status:** parcial — Q1 **continua aberta**

Primeira metade de **Q1**. Registrados como secrets em `9c47f42f`
(`ATLASSIAN_API_TOKEN`, `ATLASSIAN_EMAIL`, `ATLASSIAN_BASE_URL`, `GOATLAS_ORG_ID`);
ainda **ausentes** `ATLASSIAN_ORG_API_KEY`, `LLM_API_KEY` e `GODEPLOY_CRON_KEY`.
Nenhum valor aparece aqui nem em nenhum outro arquivo do repo — a checagem é sempre
por **nome**, via `listAppSecrets` (regra 5).

**Nada disso mudou comportamento**, porque `GOATLAS_MODO_DEMO=1` segue configurado
e é o primeiro termo do `||` em `contexto.ts` (`usandoFakes`). O terreno ficou
pronto; o app continua nos fakes.

**Três confusões que apareceram no caminho, e que valem registro porque a próxima
pessoa vai repetir:**

1. **API token ≠ chave de Organizations API.** São credenciais de superfícies
   distintas — daí o transporte próprio de `RNF-04`.
   🚨 **A atribuição de prefixo escrita aqui em 05/08/2026 estava INVERTIDA, e foi ela
   que causou o 401. Corrigida em `D-22` — leia lá antes de registrar qualquer
   credencial.** `ATCTT` é a chave de **organização**; o token de **usuário** é
   `ATATT`. O texto original mandava `ATCTT3x…` para `ATLASSIAN_API_TOKEN`, que é
   exatamente o erro que ficou registrado no app.
2. **`cloudId` ≠ `orgId`.** Os dois são UUID e convivem no `admin.atlassian.com`. A
   Organizations API quer o **orgId** (o da URL `admin.atlassian.com/o/<id>/`).
3. ~~**UUID só tem `0-9a-f`.** Um id com `j`/`k` está transcrito errado.~~
   🚨 **ESTA CONFUSÃO NÃO EXISTE — foi um erro MEU, refutado por teste em 07/08/2026
   (`D-23`).** O **org id da Atlassian não é UUID estrito**: ele tem `j` e `k` e está
   **correto**. `GET /admin/v1/orgs/{orgId}` responde **200** e ecoa o próprio id de
   volta. A heurística "parece UUID, logo só pode ter hex" é plausível e falsa, e eu a
   propaguei para o `D-22`, o `CLAUDE.md` e o `DEPLOY.md` como se fosse medição —
   exatamente o vício que este documento existe para evitar. O `cloudId` **é** UUID
   estrito (`5c413fde-…`); os dois formatos convivem, e é isso que faz a confusão parecer
   real. **A confusão 2 (`cloudId` ≠ `orgId`) continua valendo.**

⚠️ **Rotação pendente:** o token que virou `ATLASSIAN_API_TOKEN` transitou por chat
antes de ser registrado. Rotacionar é `setAppSecret` na mesma chave, sem redeploy —
as instâncias pegam o valor novo.

**O que isto NÃO destravou:** `T-063` (`criarChamado` contra a Atlassian real) segue
bloqueada — falta um projeto **JSM** (`GOATLAS_SERVICE_DESK_ID`,
`GOATLAS_TIPOS_CHAMADO`), e o projeto oferecido (`TASK`) é `jira/core`, que não tem
service desk nem request type. `T-122`/`T-123`/`T-131` seguem bloqueadas pela
ausência de `ATLASSIAN_ORG_API_KEY`.

**O que isto revelou — um fail-open real, corrigido no mesmo PR:** com o trio da
Atlassian configurado, `!env.LLM_API_KEY` caía em `ClienteIAFake` **fora dos
fakes**. Ou seja: no instante em que `GOATLAS_MODO_DEMO` saísse sem a chave de IA
existir, o app rodaria com **Atlassian real e IA falsa** — agente respondendo
roteiro de demonstração e chamado nascendo de verdade no JSM, sem nada na tela
distinguindo uma coisa da outra. Agora o fake só é alcançável por `usandoFakes`, e a
chave ausente instancia `ClienteIAIndisponivel`: `/api/health` responde 503 dizendo
o motivo (`RF-59`), o caminho do agente recusa, e o formulário mínimo (`D-04`) segue
abrindo chamado (`RNF-18`). Ver `T-132`.

**Ordem para virar produção** (a sequência importa — cada item silencia uma parte
diferente do app, todos fail-closed): `LLM_API_KEY` → `GOATLAS_TIPOS_CHAMADO` +
`GOATLAS_SERVICE_DESK_ID` → `GOATLAS_ESPACOS_CONFLUENCE` (**Q5**) →
`GODEPLOY_CRON_KEY` → criar o app de **staging** (regra 10, `T-096`) → só então
remover `GOATLAS_MODO_DEMO`.

---

### D-15 · Webhook e polling não têm lógica própria: os dois disparam a MESMA sincronização

**Contexto.** `RF-47` pede duas fontes de detecção de mudança justamente para que a
notificação não dependa de mecanismo único: o webhook do Jira (rápido, mas depende de o
time de tech registrá-lo e de a Atlassian entregar) e o polling por JQL (lento, mas
nosso). O preço é o mesmo fato chegar duas vezes.

**O desenho óbvio, e por que ele quebra.** O reflexo é cada fonte ler o que tem à mão: o
webhook lê `comment.body` e `changelog` do payload, o polling lê o chamado pela API. Dois
caminhos, duas leituras, **dois formatos de carimbo** — e a dedupe de `RF-47`, que é
`(issueKey, tipoEvento, carimboMudança)`, para de funcionar exatamente onde precisa
funcionar. O webhook chega às 10:00:01 com `2026-08-06T13:00:00.000Z`, o polling às
10:04:30 com `2026-08-06T10:00:00.000-0300`; é o mesmo instante em dois formatos, e a
chave sai diferente. Ninguém percebe em teste — só a pessoa, recebendo tudo em dobro.

**Decisão.** As duas fontes só dizem **qual chamado olhar**. Quem decide o que é novo é
`notificacoes/servico.ts#sincronizarChamado`, que relê da Atlassian sempre pelo mesmo
caminho. A chave de dedupe passa a ser idêntica **por construção**, não por coincidência,
e o carimbo é normalizado para ISO/UTC antes de virar chave.

**O bônus é de segurança, e ele é grande.** O corpo do webhook é a única entrada não
autenticada por SSO do app inteiro. Com este desenho ele vira **ponteiro**: sai dele uma
chave de chamado, validada contra `^[A-Z][A-Z0-9_]{1,19}-\d{1,10}$`, e nada mais. Um
evento forjado com `comment.body: "clique aqui https://…"` não tem como virar mensagem
enviada, porque a mensagem é montada com o comentário que o app releu.

**O que sustenta a rota pública:** segredo em comparação de **tempo constante** (um `===`
num endpoint público vaza o prefixo correto pelo tempo de resposta); resposta **sempre
202**, com ou sem vínculo local (um 404 para chamado desconhecido seria oráculo de "este
chamado passou pelo goatlas?", a mesma classe de vazamento que o 404-em-vez-de-403 de
`RF-30` fecha); e fail-closed — sem `GOATLAS_WEBHOOK_SEGREDO` a rota não funciona.

**Custo aceito.** O polling faz duas chamadas à Atlassian por chamado alterado, e o
webhook faz as mesmas duas de novo se chegar depois. Sob `R-02` (credencial única) isso é
tráfego real, contido pela marca-d'água (`updated >= última`, nunca varredura), pelo teto
de 50 chamados por rodada e pelo fato de a dedupe cortar o segundo evento antes de
qualquer envio.

---

### D-16 · `emails_piloto` é a única allowlist do projeto cujo VAZIO libera

**Contexto.** Em todo lugar do goatlas, allowlist vazia **nega** — é `RNF-07`, e é o que
impede o app de expor um espaço do Confluence no dia em que alguém esquecer de configurar.

**A exceção.** `config.emails_piloto` (`R-06`, T-302) faz o oposto: **vazia = piloto
desligado, todo mundo pode abrir chamado**.

**Por quê.** A diferença é o que a lista governa. As outras governam **exposição de
conteúdo**, e ali vazio-nega evita vazamento. Esta governa **quem pode pedir ajuda**.
Vazio-nega aqui significaria que subir o app antes de alguém preencher a lista **tranca a
empresa inteira fora do canal de suporte** — um incidente, não uma proteção. O fail-closed
correto para esta lista é o oposto do das outras.

**Como isso não vira pegadinha.** O comportamento está escrito em três lugares que quem
mexe vai ler: o comentário do campo em `ConfigValores`, o topo de `piloto/areas.ts`, e a
ajuda do campo no console de admin. E há teste afirmando os dois lados.

**E quem fica fora recebe encaminhamento, não 403 cru** (`RNF-30`): a mensagem diz para
onde ir no meio-tempo. A **consulta à documentação continua liberada** para quem está
fora — ela não abre chamado, deflete, e barrá-la seria barrar exatamente o que o projeto
quer que aconteça.

---

### D-17 · Retenção nunca expurga `vinculos`, e a auditoria tem piso de 180 dias

**Contexto.** `RNF-33` pede retenção definida, e a Fase 3 é onde o volume de dado pessoal
cresce: além de vínculo e conversa, passam a existir preferência de canal, histórico de
notificação e trecho de comentário gravado no corpo da mensagem.

**Decisão, em três partes:**

1. **`null` = guardar.** Nenhum expurgo acontece por default. Apagar é irreversível e
   precisa de alguém tendo decidido — não de um número que veio no código.
2. **`vinculos` nunca é expurgado por cron.** Apagar um vínculo é apagar o **acesso da
   pessoa ao próprio chamado** (`RF-30`, `RN-04`): o chamado continua no JSM e fica
   invisível para quem o abriu, que é exatamente o pior caso que `RNF-21` existe para
   impedir. Retenção de vínculo é decisão de negócio com aviso ao usuário, não uma linha
   de cron.
3. **A auditoria tem piso** (`PISO_AUDITORIA_DIAS = 180`). Configurar 7 dias
   silenciosamente destruiria a capacidade de responder "em março alguém acessou a página
   X?" — então o valor é **clampado**, e a resposta do cron diz que foi.

Notificação ainda `pendente` também não é apagada: é aviso que ninguém recebeu, e uma
pendente antiga é sinal de canal quebrado — justamente o que se quer ver.

---

### D-18 · A implementação da Organizations API existe, e o que não foi verificado está declarado EM CÓDIGO

**Contexto.** T-122/T-123/T-131 estavam bloqueadas por **Q1**: sem credencial de Org
Admin, escrever a chamada real seria código não verificável. O bloqueio virou impasse — o
console de governança inteiro já existia contra o fake, e a única coisa que faltava era a
camada que ninguém podia testar.

**Decisão.** Escrever a implementação (`ClienteOrganizacaoHttp`), testá-la contra `fetch`
simulado no que **é nosso** — caminho montado, paginação seguida, campos traduzidos, erro
sem corpo cru, backoff no 429, `links.next` de outro host descartado, teto de páginas
contra laço infinito — e **declarar explicitamente** o que os testes não provam.

`ENDPOINTS_NAO_VERIFICADOS`, em `atlassian/organizacao.ts`, lista os três endpoints com o
risco de cada um. Não é comentário: a tela de governança **mostra a lista** quando o app
está em fakes. Um console que promete revogar assento e falha no clique é pior que um
console que avisa antes.

**O menos verificável dos três é a revogação por produto** (`DELETE
…/manage/product-access` com o produto no corpo): a documentação pública descreve remover
acesso do usuário, e não está confirmado que o filtro por produto é aceito. Por isso a
rota de admin **nunca reporta sucesso otimista** — erro da Atlassian volta como erro, e o
inventário continua mostrando o assento até a próxima coleta (o console diz isso ao
confirmar).

**A dupla confirmação é digitar o e-mail**, não um "tem certeza?" clicável. Um diálogo
adiciona um clique; digitar obriga a olhar QUEM está sendo afetado. O erro a evitar não é
clicar sem querer — é revogar a linha errada de uma tabela ordenada de outro jeito do que
se esperava.

---

### D-19 · Q11 em aberto não vira canal inventado: o aviso é registrado e SUPRIMIDO

**Contexto.** `RF-45` pede notificação, e **Q11** (qual canal) não tem resposta. O atalho
tentador é "manda e-mail para o e-mail corporativo por enquanto" — parece inofensivo e é
uma decisão de produto disfarçada de conveniência: notificação não pedida em canal não
combinado é o começo do treinamento para ignorar as notificações do app.

**Decisão.** `canal_notificacao_padrao` nasce `null`, e nesse estado a notificação é
**registrada como `suprimida`**, não descartada. A diferença importa: com registro, o
console mostra "havia 40 avisos a dar e nenhum canal definido"; sem registro, a tela
mostra silêncio e ninguém descobre que Q11 estava travando a fase inteira. No dia da
resposta, é **um campo no console de admin** e a fila passa a sair — sem deploy (`RF-49`).

**E canal sem configuração NEGA, nunca simula** — `CanalIndisponivel`, mesmo raciocínio de
`ClienteIAIndisponivel` (T-132). Se o lugar do canal não configurado fosse um dublê, a
fila esvaziaria em produção marcando "enviada" com ninguém recebendo nada.

**A demonstração é a exceção explícita:** `configDemo()` preenche `chat` contra o
`CanalFake`, porque com `null` a tela de avisos ficaria vazia e o visitante concluiria que
a notificação não foi construída. O que sustenta a distinção é `contexto.ts` — fora dos
fakes, o dublê não é alcançável.

---

### D-20 · Defaults do MVP: cinco decisões tomadas por delegação, todas ajustáveis por config

**Data:** 07/08/2026 · **Quem:** Kaique delegou explicitamente ("tente apenas considerar o
contexto do projeto e tudo que já sabe pra decidir") · **Status:** fechadas, revisáveis

O código das Fases 3 e 4 estava pronto e **cinco perguntas abertas seguravam o MVP** — não
por falta de implementação, por falta de escolha. Cada uma abaixo foi decidida para um MVP
que funcione hoje e se ajuste depois **sem deploy** (`RF-49`). Nenhuma é irreversível.

#### 1 · Q11 → o canal é `nenhum`, e isso é uma DECISÃO, não uma pendência

Os avisos **vivem na aba Avisos** do app. Nada é enviado para fora.

**Por que não Google Chat, que era o candidato natural:** o webhook do Chat entrega num
**espaço**, não numa pessoa. Ligar isso publicaria "o chamado TECH-12 da Ana recebeu um
comentário" numa sala com outras pessoas dentro — o oposto de `RF-30`, que é a trava mais
básica do app. Chat por espaço só serviria para um canal do próprio time de tech, que é
outro caso de uso.

**Por que não e-mail ainda:** o Worker não tem SMTP (restrição da plataforma), então
e-mail exige um **provedor HTTP** que ninguém contratou. Com `canal = email` e sem
`email_endpoint`, cada aviso iria para `falha` depois de cinco tentativas — pior que não
enviar, porque enche a fila de erro e some com o aviso.

**O que muda quando houver provedor:** um campo no console (`email_endpoint` +
`EMAIL_API_KEY`) e `canal_notificacao_padrao = email`. Zero código. E o e-mail é
**por pessoa**, com o endereço que o login corporativo já dá — sem novo cadastro.

⚠️ **`nenhum` decidido ≠ ninguém decidiu**, e a distinção é visível: a tela mostra "os
avisos vivem aqui" no primeiro caso e "o canal ainda não foi definido nesta instalação" no
segundo. É por isso que `CONFIG_PADRAO` **continua** `null` — instalação nova não pode
afirmar que alguém escolheu. A decisão entra por `GOATLAS_CANAL_NOTIFICACAO`, por ambiente.

#### 2 · Q13 → o piloto começa DESLIGADO

`emails_piloto` fica vazia, e por `D-16` isso libera todo mundo.

**Por quê:** o gate de piloto só faz sentido quando existe um "para onde ir no meio-tempo"
combinado — a mensagem de encaminhamento aponta para *o canal que você já usa hoje*, e isso
pressupõe que os líderes saibam que o app existe (`T-333`) e que as áreas foram escolhidas
(`T-334`). Ligar a lista antes disso adiciona fricção sem nenhum ganho: barra pessoas de um
app que ainda não foi anunciado.

Ligar depois é digitar e-mails num campo. **Desligar depois de ter barrado alguém é mais
caro** — a pessoa já foi embora.

#### 3 · T-235 → um proxy definido, com o viés impresso ao lado do número

Não é medição, e o nome do campo diz: `deflexaoAparente`.

**Definição:** bloqueio **sem override** cujo solicitante **não abriu chamado nos 7 dias
seguintes**. Sete dias porque o prazo máximo de primeira resposta é 24h — quem ainda não
voltou uma semana depois resolveu, ou desistiu.

**O viés, que vai no payload e na tela, não em rodapé:** quem foi pedir pelo chat conta
aqui como "resolveu". O número **superestima**, sempre. Por isso ele aparece **ao lado** do
total bruto em vez de substituí-lo, e por isso `deflexaoResolvidaConhecida` continua
`false`.

**Por que isto é melhor que não medir:** sem número nenhum, a pergunta "a deflexão está
funcionando?" fica sem resposta e alguém a responde de memória. Com um teto declarado, a
conversa passa a ser sobre o teto — e ele fica **honesto na direção certa**: se o proxy diz
40%, o real é *no máximo* 40%. E ele melhora sozinho conforme a aderência de canal (`O5`)
sobe, porque a fuga para o chat encolhe.

**Medir de verdade continua em aberto**, e a via é perguntar à pessoa — o que exige decidir
quando perguntar sem virar mais um formulário.

#### 4 · Destino do alerta de SLA → o solicitante, e só ele

**Por quê:** alertar o time de tech exige saber quem é dono da fila, e isso é `T-331`
(automação de roteamento no Jira, dono ainda indefinido). Pior: o **Jira nativo já tem SLA
para agentes** — mandar um segundo alerta pelo goatlas criaria duas fontes de verdade sobre
o mesmo prazo, e a que o time olha é a do Jira.

O solicitante é o único destinatário que o app conhece com certeza e para quem o aviso é
informação nova ("ninguém te respondeu ainda, e o prazo está acabando"). Acrescentar outro
destinatário é uma linha em `avaliarESinalizarSla`.

#### 5 · Retenção → continua `null` (guardar), e isso é escolha

**Por quê:** definir prazo de expurgo de dado pessoal é decisão com peso jurídico, e o
default errado é irreversível — dado apagado não volta. `null` é o único default que
preserva a opção.

O que **já está decidido** e não depende de ninguém: `vinculos` nunca é expurgado
(`D-17`), a auditoria tem piso de 180 dias, e notificação `pendente` não é apagada. Quando
os prazos forem definidos, são três campos no console.

**Sugestão registrada para quando a conversa acontecer:** conversas 365 dias, notificações
180, auditoria mantida. Sugestão, não default — está aqui para a decisão começar de algum
lugar, não para ser aplicada em silêncio.

#### O que ficou fora, e por que não é meu para decidir

- **`baseline_assentos`** — é um número medido na Fase 0, não uma escolha. Inventar
  baseline é inventar economia.
- **Retenção/treinamento do provedor de IA** (`Q6`) — conformidade (`RNF-34`), com
  conteúdo interno trafegando. Não é decisão de engenharia.
- **As 7 tarefas `[HUMANO]` da spec 004** — todas são conversas com pessoas.

---

### D-21 · O bloqueio dura até o override, e o override só existe pelo botão

**Data:** 07/08/2026 · **Quem:** Kaique, ao testar o app e perguntar se digitar
"isso não resolve meu caso" no chat equivalia a apertar o botão · **Status:** fechada

**Não equivalia — e essa era a falha.** Havia duas portas para sair de um bloqueio e
só uma registrava:

| | Botão "Isso não resolve meu caso" | Mandar outra mensagem no chat |
|---|---|---|
| Abria o chamado | sim | **sim** |
| Registrava o override | sim | **não** |
| Pedia o motivo | sim | não |
| Contava na taxa de override (`R-04`) | sim | não |
| Alimentava o mapa de lacunas (`RF-42`) | sim | não |

**Por que acontecia:** `bloqueio` era uma variável **do turno**. Na mensagem seguinte
nenhuma regra dispara de novo — a busca já rodou, as verificações já estão concluídas —
então o servidor via "nada bloqueou" e montava a proposta. Reproduzido contra o app
rodando: auditoria com `bloqueio_disparado` e `chamado_criado`, sem nenhum
`override_registrado` entre os dois.

**Por que era pior do que um furo de registro:** quem escapava pelo chat não entrava na
taxa de override. O painel mostrava deflexão alta **exatamente quando a deflexão
falhou** — a métrica mentia para o lado favorável, que é o oposto do que o projeto faz
em `custoConfigurado` e em `taxa null vs 0%`. E `RF-42` perdia o terceiro sinal.

**Agravante:** a própria mensagem de bloqueio dizia *"me diga o que ficou de fora"*, o
que convida a digitar no chat. A copy apontava a porta que não registrava.

**A decisão.** `RN-07` passa a valer nas duas metades — há sempre saída **e** a saída
fica registrada:

1. **`temBloqueioPendente`** (`agent/estado.ts`) — bloqueio sem override impede a
   proposta de nascer, por quantas mensagens vierem. Duas camadas, como toda trava
   crítica: a condição no turno e a recusa em `montarPropostaAgora`.
2. **`bloqueioPendente` na resposta**, persistindo entre turnos. É dele que a UI tira o
   caminho de override — com `bloqueado` (do turno) o botão sumiria na mensagem
   seguinte, e aí sim viraria parede.
3. **A copy aponta o botão**, nas duas regras.
4. **Com bloqueio de pé, quem responde é o SERVIDOR** — `MENSAGEM_BLOQUEIO_PENDENTE`
   substitui o texto do modelo, e o modelo nem chega a ser chamado. A primeira versão
   *acrescentava* o aviso ao texto dele, e o resultado se contradizia sozinho:
   "Montei o chamado abaixo — confira e confirme." seguido de "Só não consigo abrir o
   chamado ainda". O modelo não sabe que o servidor recusou montar a proposta, e
   nenhum aviso colado embaixo conserta uma frase que já foi dita. É a mesma regra que
   `montarMensagemBloqueio` já seguia: **a regra em vigor fala, o modelo não** —
   deixá-lo narrar durante o bloqueio é o que transforma a regra em sugestão que ele
   contorna com boa retórica. Pular a chamada também é `RNF-16`: o turno do bloqueio
   descarta a resposta do modelo uma vez; sem o desvio, descartaria a cada mensagem.
5. **O campo de justificativa deixou de parecer chat** — espinha lime, sobretítulo
   "Corrigir a recomendação", caixa creme. Foi lido como "outro chat" no primeiro teste,
   e duas caixas de texto idênticas na mesma tela não têm como comunicar que uma vai
   para o agente e a outra para a auditoria.
6. **O compositor FECHA enquanto a justificativa está aberta.** Distinguir as duas
   caixas não bastava: com as duas disponíveis, a pessoa escreve na de baixo — maior,
   já usada, onde o dedo espera. O texto viraria mensagem para o agente, o override não
   aconteceria, e ela repetiria "isso não resolve" para um modelo que não tem como
   liberar nada. Fechado, **não escondido**: sumir com o campo faz a página saltar; o
   motivo vai escrito ao lado e o "Voltar" reabre. E campo desabilitado passou a
   *parecer* desabilitado (`.campo :disabled`) — sem isso o clique não fazia nada e a
   conclusão seria "travou" em vez de "é ali em cima".

**O que NÃO mudou:** bloqueio continua não sendo parede (`RF-13`). O botão está sempre
visível, o override nunca é recusado, e o formulário mínimo (`D-04`) segue aberto. A
mudança é *por onde* se passa, não *se* dá para passar.

**Testes:** três em `tests/orquestrador.test.ts`, sendo dois de burla — insistir pelo
chat não monta proposta e não registra override; `montarPropostaAgora` recusa com
bloqueio de pé. Mais seis em `tests/rn07-caminho-override.test.ts`, do lado da tela:
a justificativa se apresenta como correção e não como mensagem, o compositor fecha com
o motivo escrito, e volta a abrir depois.

**Nota de ambiente (não é produção):** o roteiro do dublê de IA em `npm run dev` tem
dois turnos e o índice é do **processo**, não da conversa — uma conversa que terminava
com número ímpar de mensagens deixava a próxima começando pelo turno 2, respondendo
"montei o chamado" sem ter verificado nada. Nada nascia daí (`RF-08` continua fechando
o caminho, e nenhuma proposta era montada), mas quem testava via o agente pular a
deflexão e concluía que a Regra 1 tinha quebrado. `vite-plugin-api-dev.ts` reinicia o
roteiro a cada `POST /api/conversas`.
---

### D-22 · O 401 era a família da credencial, e o endpoint de usuários estava medido como vazio
**Data:** 07/08/2026 · **Quem:** João Victor (medição) + Kaique (correção) · **Status:** aceita

Diagnóstico entregue pelo João a partir de medição de 31/07/2026 no tenant
`goengenharia`. Ele derruba a hipótese que estávamos perseguindo e corrige duas coisas
nossas — uma de documentação, uma de código.

> Numeração: `D-21` está tomada por `fix/override-obrigatorio`, ainda não mergeada.

#### 1. São duas famílias de autenticação, e o `D-14` as trocou

| Família | Prefixo | Onde se gera | Onde funciona |
|---|---|---|---|
| Chave de **organização** | `ATCTT` | `admin.atlassian.com` → Settings → API keys | **só** `api.atlassian.com/admin/*` |
| Token de **usuário** | `ATATT` | `id.atlassian.com/manage-profile/security/api-tokens` | `<site>.atlassian.net/rest/api/3/*` |

Não têm relação entre si; escopo de uma não afeta a outra. O que está registrado hoje
em `ATLASSIAN_API_TOKEN` é um `ATCTT`, e Basic auth contra `/rest/api/3/*` com ele
**retorna 401 por design** — com o e-mail certo, sem barra final, no site correto.

⚠️ **Verificado em fonte primária, não só no memo** (07/08/2026). A atribuição de prefixo
foi conferida na documentação da Atlassian e em relato independente: `ATCTT` são *access
tokens* / criados na seção de admin; `ATATT` são *API tokens*, scoped e clássicos. O memo
estava certo — mas a checagem era devida, porque o `D-14` também "estava certo" por um dia.

🚨 **E há uma segunda armadilha, que o memo não menciona e que derrubaria o próximo
token: `ATATT` SCOPED não funciona na URL do site.**

| Tipo de `ATATT` | Base que aceita |
|---|---|
| **Clássico** (sem escopos) | `https://<site>.atlassian.net/rest/api/3/…` |
| **Scoped** | `https://api.atlassian.com/ex/jira/{cloudId}/…` · `…/ex/confluence/{cloudId}/…` |

Basic auth de token scoped contra a URL do site devolve **401** — **o mesmo sintoma** do
erro de família, o que faria parecer que o diagnóstico não avançou. E a Atlassian hoje
oferece scoped como caminho padrão na tela de criação.

**Consequência de desenho:** `ATLASSIAN_BASE_URL` é **uma só** e serve Jira e Confluence no
mesmo host (`/rest/api/3/…`, `/rest/servicedeskapi/…`, `/wiki/api/v2/…`). Sob scoped os dois
têm gateways **distintos**, então adotar scoped **exige partir a base em duas** — mudança de
código, não de config, e mais uma razão para pedir **clássico**. Existe pedido público
(`CLOUD-12617`) para scoped aceitar a URL do site; enquanto não existir, clássico é a
escolha.

🚨 **A causa raiz não foi um engano de quem registrou: foi o nosso próprio documento.**
`docs/DEPLOY.md` e o `D-14` afirmavam que `ATCTT3x…` era o *API token* e devia ir em
`ATLASSIAN_API_TOKEN`. Quem seguiu a instrução acertou o procedimento e errou o
resultado. Os três testes que passamos uma tarde considerando (e-mail errado · token
expirado · base URL com barra) eram todos negativos, e continuariam negativos para
sempre — **rodar o `curl` de novo não acrescenta informação**, e é por isso que o item
está fechado em vez de "a verificar".

**Consequência prática:** a credencial que temos não está quebrada, está na gaveta
errada. O `ATCTT` é exatamente o que `ATLASSIAN_ORG_API_KEY` quer — e o memo mede `200`
com ele contra `/admin/v1/orgs/{org}/*`. Falta gerar um `ATATT` para o trio de site.

#### 2. `GET /admin/v1/orgs/{orgId}/users` devolve lista vazia neste tenant

Medido: `{"data": []}`, HTTP 200. A causa não é permissão — o João é org admin **e**
site admin. É que aquele endpoint lista **só contas gerenciadas**, e uma org só tem
contas gerenciadas depois de reivindicar um domínio. A org não reivindicou nenhum
(`/orgs/{org}/domains` → `{"data": []}`), então há **zero**. Uma única causa explica
três sintomas que pareciam independentes: lista vazia, `403 "Caller must be a verified
org admin of targeted account"` na escrita, e log de auditoria sem eventos de gestão.

**`ClienteOrganizacaoHttp` usava esse endpoint.** Trocado por
`POST /admin/v1/orgs/{orgId}/users/search`. É a pior classe de erro que existe neste
projeto: HTTP 200, nenhuma exceção, console mostrando "0 assentos" — e ninguém
desconfiando da chamada. Mesma família do `env.DB` devolvendo `{}`.

**Três armadilhas medidas do `users/search`, nenhuma das quais dá erro:**

- **`accountTypes: ["atlassian"]` é obrigatório** — sem ele entram ~83 contas de
  app/bot, que não são pessoas e não consomem assento de gente.
- **`query`, `groupIds` e `productAccess` NÃO filtram** — respondem 200 com a lista
  inteira. Um filtro que parece filtrar e não filtra é pior que um filtro ausente.
- **`accountStatus` não é status de suspensão** — volta `"active"` até para conta
  suspensa. Quem responde é o **filtro** `isSuspended`, em duas varreduras.

#### 3. O que isso obrigou a mudar no desenho, além do endpoint

A armadilha do "filtro que responde 200 sem filtrar" é um comportamento **medido**
desta API. Se `isSuspended` for um deles, as duas varreduras devolvem o mesmo conjunto
— e isso é **detectável**: interseção não vazia significa que o filtro não separou
nada. Daí `suspensaoConhecida`. Contar conta suspensa como assento ativo infla o custo
(`RF-53`) e gera recomendação de revogar acesso de quem já não tem acesso.

E `parcial`: o teto de `MAX_PAGINAS_USUARIOS` era atingido **em silêncio**, apesar de o
comentário do código afirmar que a coleta parcial "nunca é silenciada". Era. Inventário
truncado vira recomendação de rebaixar quem a página seguinte mostraria ativo — e a
tela não tinha como saber que estava vendo um pedaço. Coleta parcial ou com suspensão
desconhecida **não** é auditada como `sucesso`.

Mesmo raciocínio de `deflexaoResolvidaConhecida` (`D-20`/T-235) e de "taxa sem dado é
`null`, nunca `0%`": o número que não se mediu não vira zero.

#### 4. Q5 — o espaço `TECH` não existe

Era exemplo genérico, e virou premissa por repetição. Levantados por evidência real:
`GO`, `DTE`, `GN`, `datateam`, `Protheus` (engenharia), além de `PROD`, `GDPC`, `CG`,
`CG1`, `NC`, `AG`, `IA`, `IO` e outros. **É um piso, não a lista completa** — vem do
índice do RAG, então espaço sem conteúdo indexado ou restrito não aparece. A lista
autoritativa sai de `GET /wiki/api/v2/spaces` (que também exige `ATATT`) ou do
diretório de espaços na UI.

**Escolhidos para a allowlist inicial:** `GO`, `DTE`, `GN`, `datateam`, `Protheus`.
Continua sendo decisão de exposição (`RN-06`, `D-01`) e revisável sem deploy (`RF-49`).

#### 5. O que segue aberto

- **`ATATT` não existe ainda** — é a ação humana que destrava Confluence e JSM reais.
- **Escrita de governança é 0%** e não depende de credencial: **nenhuma** chave de API,
  com escopo nenhum, opera sobre conta não gerenciada. Só reivindicar o domínio
  `gocase.com` destrava — ou mudar grupo via `ATATT` + `/rest/api/3/group/user`.
  Suspender continua fora dos dois caminhos.
- ~~**`GOATLAS_ORG_ID` provavelmente está corrompido.**~~ 🚨 **Falso — refutado por teste
  em `D-23`.** O org id está correto; org id da Atlassian não é UUID estrito.
- **Os códigos HTTP são de 31/07** e não foram reexecutados em 07/08 (o sandbox do João
  bloqueou o `curl`). ✅ **Reexecutados por mim em 07/08 à tarde — ver `D-23`.**

---

### D-23 · A passada com credencial real: 4 bugs nossos, e uma afirmação minha refutada
**Data:** 07/08/2026 (tarde) · **Quem:** Kaique · **Status:** aceita

O João mandou o pacote completo (`ATATT` clássico + `ATCTT` + org id + cloudId). Com ele
na mão, rodei contra a Atlassian **real** o que até então era contrato documentado. O
resultado confirma a lição que o `CLAUDE.md` já registrava — *o dublê implementa o
contrato documentado, e onde o outro lado diverge ele esconde a divergência* — agora com
quatro ocorrências novas de uma vez.

#### 0. Antes dos bugs: eu estava errado sobre o org id

`ATLASSIAN_ORG_ID=8a130dbc-06bc-1a05-jjk7-9822046115j1` tem `j` e `k`, e eu afirmei em
três documentos que estava "quase certamente errado". **Teste:**

```
GET /admin/v1/orgs/8a130dbc-06bc-1a05-jjk7-9822046115j1  →  200
  {"data":{"id":"8a130dbc-06bc-1a05-jjk7-9822046115j1","attributes":{"name":"goengenharia"}}}
GET /admin/v1/orgs  →  200, uma org, exatamente esse id
```

**Org id da Atlassian não é UUID estrito.** O João já havia escrito isso num comentário do
`.env`, com a URL do admin console como evidência, e eu mantive a suspeita. A confusão 3
do `D-14` foi **desfeita**, não corrigida: ela nunca existiu. O `cloudId` (`5c413fde-…`)
**é** UUID estrito, e é essa coexistência que faz a heurística parecer válida.

Lição concreta: "parece UUID, logo só pode ter hex" é dedução sobre formato, não medição —
e eu a propaguei como se fosse medida. É o mesmo erro que o `D-22` critica no `D-14`.

#### 1. ✅ O 401 morreu

```
GET goengenharia.atlassian.net/rest/api/3/myself  (Basic, ATATT clássico)  →  200
```

O `ATATT` foi gerado no botão certo (`ATLASSIAN_TOKEN_TYPE=classic`), então a base do site
continua valendo e **nada de código muda** — o alerta de token scoped do `D-22` continua
válido como prevenção, e foi evitado antes de custar uma tarde.

#### 2. 🚨 `listarTiposChamado` não funcionava em produção

```
GET /rest/servicedeskapi/requesttype                    →  412  "This API is experimental"
GET /rest/servicedeskapi/requesttype  + X-ExperimentalApi: opt-in  →  200
GET /rest/servicedeskapi/servicedesk/4/requesttype      →  200  (sem cabeçalho nenhum)
```

O endpoint **global** é experimental. Era o que usávamos, então a allowlist de `RF-28` não
tinha como ser montada e o formulário sem IA não sabia que tipos oferecer.

**Não ligamos o opt-in.** "Experimental" é a Atlassian avisando que pode mudar sem aviso, e
a allowlist de tipos é trava de roteamento — chamado na fila errada é o custo. O caminho
estável é **por service desk**: uma chamada para listar os desks, uma por desk. Custa mais
chamadas, pagas uma vez por TTL de cache, e o `serviceDeskId` passa a vir do laço (o
endpoint por desk não o repete em cada item, e `String(undefined ?? '')` daria `''`).

#### 3. 🚨 A mesma API usa DUAS convenções de nome, e isso zerava o inventário

| Endpoint | Convenção | Medido |
|---|---|---|
| `POST /admin/v1/orgs/{org}/users/search` | **camelCase** | `accountId`, `accountStatus`, `accountType`, `statusInUserbase` |
| `GET .../users/{id}/last-active-dates` | **snake_case** | `product_access`, `last_active`, `last_active_timestamp` |

Nosso contrato estava em `snake_case` para os dois. Efeito no `users/search`: `accountId`
ausente descarta a linha, então **as 54 contas reais eram todas descartadas** — HTTP 200,
lista vazia, zero exceção. Terceira ocorrência desta classe no projeto (`env.DB`
devolvendo `{}` e o `GET /users` vazio foram as outras).

⚠️ **Não "normalizar para ficar consistente":** os dois formatos são reais, e unificar
quebra um dos lados com o mesmo sintoma silencioso.

#### 4. 🚨 `name` e `email` exigem `expand`; e o produto atribuído NÃO está lá

```
POST /users/search {accountTypes:["atlassian"],isSuspended:false,limit:100}
  →  200, 54 contas, só accountId/accountType/accountStatus/statusInUserbase
POST /users/search {... expand:["NAME","EMAIL"]}        →  200, com name/nickname/email
POST /users/search {... expand:["PRODUCT_ACCESS"]}      →  400 INVALID_PARAM
```

E `accountStatus` veio `"active"` nas 54 — confirmando que ele **não** é status de
suspensão, como o `D-22` já dizia.

**Onde o produto vive de verdade:** `last-active-dates`, que devolve `product_access` com
`key` por produto (`confluence`, `jira-core`, `jira-software`) **e** o último acesso. O
cron já chamava esse endpoint por conta — faltava usar a informação. `registrarColeta`
iterava `usuario.produtos` (sempre vazio) e gravava **zero linha**: o inventário existia,
rodava, respondia 200 e não continha nada. Agora itera a **união** das duas fontes.

E `last_active` é só a **data** (`"2026-08-03"`), enquanto `last_active_timestamp` é ISO
completo — o primeiro joga o horário para meia-noite UTC, o que não muda "ocioso há 60
dias" mas muda o limiar de quem acessou hoje de manhã.

#### 5. ✅ O `GET /users` vazio, confirmado

```
GET /admin/v1/orgs/{org}/users?limit=100  →  200  {"data":[]}
```

Exatamente como o João mediu em 31/07. A troca de endpoint do `D-22` estava certa.

#### 6. O JSM existe — 5 service desks, e o do time de tech é o `GN`

| `serviceDeskId` | Projeto | Nome |
|---|---|---|
| **4** | **`GN`** | **Tickets Engenharia** ← é este |
| 9 | `GOSHOP` | Gobeaute Support |
| 11 | `JTK` | Jump Ventures Support |
| 7 | `SHPF` | SHPF |
| 8 | `OMI2020` | Opsgenie Migrated Incidents |

O `GN` tem **16 tipos de solicitação**. `GOATLAS_SERVICE_DESK_ID=4` foi registrado.
**`T-063` sai do bloqueio de Q1**: falta escolher quais tipos entram na allowlist
(`RF-28`) — decisão de roteamento, não de credencial.

Candidatos naturais para o piloto: `70` (Relatar um bug), `134` (Relatar um problema
(Sistema)), `108` (Solicitar acesso/permissão a um Sistema), `68` (Outras questões /
dúvidas). ⚠️ **`69` ("Solicitação enviada por e-mail") deve ficar fora** — é o tipo de
entrada por e-mail do próprio JSM, não um formulário para pessoa escolher.

#### 7. Q5 corrigida: a lista real desmente os nomes que eu supus

O `D-22` recomendou `GO`, `DTE`, `GN`, `datateam`, `Protheus` a partir do índice do RAG. A
lista autoritativa (32 espaços) mostra que **`GO` é "Go Shopify"** — nada a ver com
documentação de engenharia. E ficaram de fora os que mais parecem certos:

| Key | Nome | Tipo |
|---|---|---|
| `GT` | **GO Tecnologia** | `knowledge_base` |
| `DTE` | Documentação Técnica Engenharia | `global` |
| `GN` | Tickets Engenharia | `global` |
| `DE` | Devops | `global` |
| `GI` | GO INFRA | `global` |
| `dicas` | Dicas / Documentações | `global` |
| `GLPI` | GLPI (helpdesk antigo) | `knowledge_base` |

⚠️ **`type: knowledge_base` importa:** é o tipo que a Atlassian usa para espaço ligado a
service desk — feito para deflexão. `GT`, `IO`, `IA`, `Protheus`, `CG1`, `GLPI` e
`Goconnect360` são desse tipo.

~~**A allowlist NÃO foi definida ainda** — `GOATLAS_ESPACOS_CONFLUENCE` segue vazio de
propósito.~~ **Desatualizado desde 07/08/2026 17:35**, quando o secret foi criado
(`listAppSecrets`). O `CLAUDE.md` registra o valor como `GT,DTE,GN` — ⚠️ **registra, não
mede**: a API do GoDeploy nunca devolve valor de secret, então o conteúdo é documentação, e
divergir dele não daria erro nenhum (`RN-06` nega por padrão: chave errada = zero resultado
com HTTP 200).

Escolher continua sendo decisão de exposição (`RN-06`, `D-01`), e agora ela se faz sobre a
lista real em vez de sobre suposição de assunto. ⚠️ **E as duas fontes autoritativas
discordam** — ver `D-29`, que registra o conflito em vez de escolher por conta própria.

#### 8. Q8 respondida — e o `custo.ts` está errado por construção

O `HANDOFF-GODEPLOY.md` mede o preço real: **73 assentos** (5 JSM · 35 Jira · 33
Confluence), e a curva do JSM é **escalonada**. Na faixa 1–100 os valores medidos são USD
9,05 e 6,70 por assento.

🚨 **O preço por assento SOBE quando você corta assentos** (efeito de faixa). Nosso
`custo.ts` multiplica contagem × custo fixo por produto, então **superestima a economia de
cortar** — exatamente o número que o console usa para recomendar rebaixamento. Vira
`T-134`.

#### 9. Nomes de variável: não mudamos nenhum lado

O `.env` do João usa `ATLASSIAN_USER_TOKEN` e `ATLASSIAN_ORG_ID`; nós lemos
`ATLASSIAN_API_TOKEN` e `GOATLAS_ORG_ID`. **Decisão: manter os dois como estão** e mapear
no momento de registrar o secret.

`ATLASSIAN_USER_TOKEN` é um nome melhor — nomearia a família e teria evitado o 401. Mas
renomear o nosso tem um risco concreto e assimétrico: `usandoFakes` é
`modoDemo || GOATLAS_USAR_FAKES || !env.ATLASSIAN_API_TOKEN`. Se o código passar a ler o
nome novo e o secret antigo for removido antes do deploy, o worker publicado vê
`!ATLASSIAN_API_TOKEN` e **cai nos fakes silenciosamente, com credencial real
configurada** — a falha de `T-132` de novo, pela porta dos nomes. O ganho é de clareza e
já foi obtido documentando a família; o risco é operacional.

E `GOATLAS_*` × `ATLASSIAN_*` distingue **bootstrap de config** (editável depois no console,
`RF-49`) de **credencial** — apagar essa distinção para casar com o `.env` de outro projeto
seria trocar uma convenção interna por uma coincidência externa.

⚠️ **O `LEIA-ME` do pacote diz "copie o `.env` para a raiz do app". Isso não se aplica
aqui:** em produção o goatlas não lê `.env` nenhum (são secrets do GoDeploy), e dois nomes
divergem.

#### 10. O pacote NÃO entra no repositório

`goatlas-kaique/` foi adicionado ao `.gitignore` **inteiro**, não só o `.env`. O
`HANDOFF-GODEPLOY.md` traz nome de funcionário, composição de grupo e valor de licença; o
`.gitignore` cobria `.env` e deixaria os `.md` e o `.json` commitáveis. O que vale do
pacote está destilado aqui.

**Rotação pendente:** o João rotaciona o `ATCTT` depois da validação, e ofereceu trocá-lo
por uma chave com **escopo de leitura**. Vale aceitar — a única escrita que o app faria é
`T-131`, que não funciona hoje de todo jeito (conta não gerenciada), então guardamos uma
chave de escrita total na org sem usar.

---

### D-24 · A staging foi adiada, e a trava que protege a produção hoje é outra
**Data:** 07/08/2026 · **Quem:** Kaique · **Status:** aceita, com prazo

Desvio consciente da **regra 10** ("staging antes de produção"). O app de staging foi
criado (`3936ca2d`) e **não** foi terminado; o deploy foi direto na produção
(`9c47f42f`, `version 20`).

**Por que o desvio se sustenta hoje:** a regra 10 existe para proteger o time de tech de
chamado indevido e a fila real de efeito colateral. O que impede isso agora **não é a
staging** — é `GOATLAS_SOMENTE_LEITURA=1`, que recusa **toda** escrita no decorador do
cliente (`atlassian/somente-leitura.ts`), não com um `if` espalhado por rota. Somando a
isso: a produção já rodava código com o bug do 412, e nenhum usuário real depende dela
ainda. O pior caso do deploy era a tela que já estava quebrada.

**A staging ficou incompleta por um motivo concreto**, não por pressa: `LLM_API_KEY` só
existe como secret da produção, e **valor de secret não é legível por MCP**. Sem ela a
staging cai em `ClienteIAIndisponivel` (`T-132`) e **não exercita o agente** — que é
justamente a parte mais nova. Uma staging que valida login, Confluence e console, mas não
a conversa, custa um segundo app para manter em sincronia e não cobre o risco que importa.

🚨 **O prazo é explícito: a staging passa a ser obrigatória ANTES de desligar
`GOATLAS_SOMENTE_LEITURA`.** É naquele instante que a regra 10 volta a ter dente — o
primeiro chamado real nasce na fila do time de tech, e `criarChamado` (`T-063`) nunca
executou contra o JSM. Terminar a staging exige o `LLM_API_KEY` em mãos.

**Também pendente:** `3936ca2d` está no ar com o `ATATT` e o `ATCTT` configurados e
somente leitura ligado. É um app com credencial que ninguém mantém — ou se termina, ou se
apaga. Não deixar assim.
### D-25 · O console de administração mostra o que se decide, não o que se configura

> ⚠️ Numerada **D-25** no merge: a branch trazia isto como `D-15`, número já usado
> pela decisão de webhook/polling. Duas decisões com o mesmo id fazem toda referência
> a `D-15` virar ambígua — e o `CLAUDE.md` já citava as duas.

**Data:** 07/08/2026 · **Quem:** Kaique · **Status:** aceita · **Spec:** `specs/003-console-de-administracao/`

A aba cresceu por acumulação: cada requisito que precisou de superfície empilhou a
sua no fim da página. O resultado era **um scroll com cinco trabalhos** — 14 campos
na ordem em que foram implementados, depois métricas, assentos, lacunas e auditoria
— com rótulos que nomeavam a chave do banco (*"Regra 2 — campo que delimita 'mesmo
tipo'"*, *"score mínimo para bloquear"*). Funcionava, e ninguém entendia. Como
`RF-49`/`RF-50` existem para a calibração acontecer **sem deploy**, um console
indecifrável devolve a calibração ao `curl` — ou ao "deixa como está".

**A decisão:** organizar por **capacidade do app**, com cada ajuste ao lado do dado
que ele afeta, e reduzir o console ao que uma pessoa da Gocase **decide**.

**O critério de corte foi uma pergunta só: quem decide isto, e quando?** Ficaram 13
chaves — as mesmas que `RF-49`, `RF-50` e `RF-53` nomeiam. Saíram quatro:

| Chave | Por que sai |
|---|---|
| `ttl_metadados_seg`, `ttl_conteudo_seg` | Cache (`RNF-13`). Ninguém decide 900s sem ler o código. |
| `regra2_limite_tickets` | Teto de leitura por conversa (`R-08`), proteção de custo. |
| `limite_requisicoes_por_minuto` | Rate limit (`RNF-11`). O teto de custo por conversa já é o controle de orçamento que se decide. |

⚠️ **Sair do console não é sair do sistema.** As quatro continuam em
`ConfigValores`, continuam com bootstrap por env (`RNF-25`) e continuam mudáveis
sem deploy por `PUT /api/admin/config` — o que se retirou foi a **tela**. As três
primeiras nunca tiveram uma; `limite_requisicoes_por_minuto` tinha, e é a única
perda real de superfície. Restaurar qualquer uma é acrescentar um descritor em
`src/app/admin/campos.tsx`, e `tests/tela-admin.test.ts` falha se voltarem sem
passar por aqui.

**O que entrou no lugar:** a primeira seção é um **diagnóstico** — cinco
capacidades com estado (ligado/parcial/desligado) e a **consequência** de cada uma,
derivada da configuração (`src/lib/config/diagnostico.ts`, função pura, com teste).
É o que responde "por que a busca não acha nada?" sem abrir 13 campos. Todo campo
carrega, abaixo do controle, o efeito do **valor que está lá agora**.

⚠️ **O diagnóstico relata, não decide.** Cada predicado é o mesmo que o servidor já
aplica (`regra2Disponivel` vem de `rules/`; `buscaConfigurada` é o predicado que a
rota de busca usa). Condição nova escrita ali é uma segunda regra que diverge em
silêncio — o lugar dela é o módulo de origem.

**Junto veio uma trava que faltava:** `PUT /api/admin/config` validava só se a
**chave** existia e gravava o valor como viesse. `Config.carregar` aceita de volta
qualquer JSON válido, então `regra1_threshold_score = "alto"` sobrevivia ao boot e
chegava à Regra 1 como string — e o default fail-closed **não** cobre isso, porque
valor corrompido não é ausência de valor. `src/lib/config/validar.ts` recusa (400) e
nunca coage: `"0.9"` não vira `0.9`, senão o dia em que for `"alto"` a coerção
produz `NaN` sem avisar ninguém. Teste de burla em
`tests/rf49-config-validacao.test.ts`, escrito antes do código.

**Efeito colateral bom:** `custo_mensal_por_produto` (**Q8**) e `org_id` (**Q1**)
ganharam superfície. O preço é uma linha **por produto encontrado no inventário** —
o console não inventa a lista de produtos que a organização assina. No dia em que o
financeiro responder Q8, é preencher e salvar.

### D-26 · O anexo não viaja na criação — e a v1 do plano perdia o chamado da pessoa

**Data:** 10/08/2026 · **Contexto:** spec `005-anexo-na-criacao`, `plan.md` §0 e §2

`RF-61` pede que abrir chamado com anexo seja **uma** ação. O caminho óbvio é o do
portal nativo do JSM: mandar os `temporaryAttachmentIds` dentro do corpo da criação. A
primeira versão do plano fazia isso, e o `/analyze` mostrou que aquela linha reta passa
exatamente por cima da trava mais importante do projeto:

1. id temporário expirado faz a **criação** responder **400**;
2. `atlassian/http.ts` classifica 4xx como **definitivo**;
3. `tickets/servico.ts` marca a submissão como `falha`;
4. submissão `falha` **nunca** é reprocessada.

Um arquivo velho apagaria o chamado de alguém. É a mesma família do bug que
`rf24-outbox-degradacao` já pegou uma vez, na versão com arquivo — e teria passado por
uma suíte verde, porque nenhum teste montava "id vencido".

**Decisão:** o servidor faz **dois passos dentro da mesma confirmação**. O upload
acontece quando a pessoa escolhe o arquivo (feedback imediato, criação intocada); a
materialização acontece **depois** da criação, com o resultado do anexo separado do
resultado da criação.

| Alternativa | Por que não |
|---|---|
| Ids dentro do `requestFieldValues` da criação | A cadeia acima: falha de anexo vira falha definitiva de criação, e o chamado é perdido |
| Upload só no clique de confirmar | 8 MB subindo dentro da confirmação: a pessoa espera sem retorno, e queda de rede derruba a criação junto |

**Custo aceito e explícito:** existe uma janela curta em que o chamado existe sem o
anexo. Para o solicitante é invisível (uma tela só); para quem observa a fila, um chamado
pode aparecer segundos antes do arquivo. É barato perto de perder chamado.

**Consequências que moram em código:** `subirAnexoTemporario` e
`materializarAnexosTemporarios` existem separados na interface do cliente (e
`anexarArquivo` de `RF-34` passou a ser a composição dos dois) · o
`temporaryAttachmentId` vive em `anexos_pendentes` e **nunca** trafega pelo navegador ·
`materializarAnexosDoChamado` **não lança**, nunca, e mora fora de
`ServicoChamados.processar` justamente para não alcançar o `catch` que classifica erro.

---

### D-27 · `RF-62` é fail-OPEN, contra o padrão do projeto — e a distinção é o que resolve

**Data:** 10/08/2026 · **Contexto:** spec `005`, `plan.md` §6 e §9

Em todo o resto do goatlas, ausência de informação **nega**. Aqui, schema de request type
que **não pôde ser lido** faz a pergunta de `RF-62` não existir e o chamado abrir.

**Por que o desvio é legítimo:** `RF-62` é **qualidade de produto, não trava de
segurança**. Quem "burla" só consegue abrir o **próprio** chamado sem responder uma
pergunta — não há dado de terceiro, não há exposição, não há escrita indevida. O que se
perde é a evidência dele mesmo. Uma trava de segurança fail-open convida à burla (derrubar
a chamada de schema viraria o caminho); esta não tem prêmio.

**Por que fail-closed seria pior:** significaria **não abrir chamado** durante uma
indisponibilidade de leitura de schema — a parede que `RNF-18` proíbe. Trocar "chamado sem
print" por "chamado nenhum" é péssimo negócio.

**Mitigação que já existe:** o schema vem do cache de metadados (`ttlMetadadosSeg`), então
uma indisponibilidade curta não faz a pergunta sumir para quem acabou de vê-la.

**O que impede a confusão:** o evento vai para a auditoria como
`schema_tipo_indisponivel`. "O tipo não aceita anexo" e "não deu para saber se aceita" têm
a mesma cara na tela; na auditoria não podem ter, senão uma indisponibilidade prolongada
apareceria como uma feature que ninguém usa.

---

### D-28 · `RF-27` endureceu: campo extra fora do schema deixou de passar

**Data:** 10/08/2026 · **Contexto:** spec `005`, `plan.md` §4 (pré-requisito de segurança
independente da feature) · **Afeta:** `T-130` da spec 002, que entregou `RF-27`

`camposDinamicos` chegava do corpo da requisição e era mesclado em `requestFieldValues`
**sem allowlist de chave** — só `summary` e `description` eram removidos. O dano era
contido porque *o Jira* recusa campo que não pertence ao request type: a contenção era do
outro lado, não nossa.

Com um campo de **anexo** no schema, aquela folga passaria a ser o caminho para colar o
id do anexo de outra pessoa no próprio chamado — `RF-30` aplicado a arquivo.

**Decisão:** as chaves de `camposDinamicos` são validadas contra o schema do request type,
e o campo de anexo é **sempre** excluído — o arquivo entra só pelo caminho de `D-26`.

⚠️ **É mudança de comportamento em `RF-27`:** campo extra que passava deixou de passar. E
**schema indisponível descarta os campos adicionais** (fail-closed no campo) mas **abre o
chamado** (fail-open no chamado): validação que se desliga sob pressão não é validação, e
perder campo extra numa indisponibilidade é aceitável — perder o chamado não seria.

---

### D-29 · Q5 fechada: 7 espaços na allowlist, escolhidos sobre a lista medida

**Data:** 10/08/2026 · **Decisão de:** Kaique · **Contexto:** `Q5`, `RN-06`, `D-01`, `RF-49`

**Verificado ao vivo** (`GET /wiki/api/v2/spaces?limit=250`, `ATATT` clássico do pacote do
João, HTTP **200**): a API devolve **128 espaços numa página só**, sendo **97 pessoais**
(`~712020…`) e **31 reais**. Idêntico à medição de 07/08 — a lista não mudou.

**Aplicados (`GOATLAS_ESPACOS_CONFLUENCE`):**

| Key | Nome | Tipo |
|---|---|---|
| `GT` | GO Tecnologia | `knowledge_base` |
| `DTE` | Documentação Técnica Engenharia | `global` |
| `GN` | Tickets Engenharia | `global` |
| `DE` | Devops | `global` |
| `GI` | GO INFRA | `global` |
| `datateam` | GO Data | `collaboration` |
| `Protheus` | Protheus | `knowledge_base` |

Os 7 foram **conferidos um por um contra o JSON ao vivo**, não contra recomendação: o custo
de uma chave errada é zero resultado com HTTP 200 (`RN-06` nega por padrão), que não quebra
nada e não aparece em log nenhum.

**Os 24 que ficaram fora, e por quê:**

- **`GO` (Go Shopify)** — a sugestão do João o incluía; a `D-23` §7 já havia mostrado que
  ele não é engenharia. Ficou fora. ⚠️ Este é o registro de que **as duas fontes
  discordavam** e a divergência foi resolvida pelo dado, não pela autoridade de quem
  sugeriu.
- **`GLPI` (helpdesk antigo)** — `knowledge_base`, portanto tentador para deflexão. Fora de
  propósito: defletir com documentação obsoleta é o **pior** caso do projeto — a pessoa lê,
  não resolve, insiste, e o override sobe sem que a documentação melhore.
- **`PROD`, `dicas`** — plausíveis, mas são produto e miscelânea, não documentação técnica.
  Entram numa segunda rodada, se a taxa de override apontar para lá (`RF-42`/`T-117` é
  exatamente o instrumento que diz isso).
- **O resto** (CX, Growth, FrontOffice, Opsgenie migrado, …) — nada a ver com o escopo, e
  cada espaço liberado é conteúdo que **qualquer colaborador** passa a ler pelo proxy sob
  proxy total (`D-01`).

**Revisável sem deploy** (`RF-49`): o campo está no console de admin.

🚨 **Ressalva de aplicação, e ela pode invalidar a mudança:** `Config.carregar` resolve na
ordem `CONFIG_PADRAO` → **bootstrap do env** → **BANCO**, e *"o banco, quando tem valor,
sempre vence"*. Se `espacos_confluence` já tiver sido gravado na tabela `config` (por alguém
salvando no console), o `setAppSecret` é **no-op silencioso** — nada dá erro, e a busca
continua no escopo antigo. Não há como ler o valor efetivo de fora: `listAppSecrets` nunca
devolve valor e `/api/admin/config` está atrás do OAuth do edge. **Verificação: abrir o
console de admin e ler o campo de espaços.** Se mostrar 3, gravar os 7 ali — o banco vence,
então essa gravação é a que fica.

### D-30 · `?espaco=` ESTREITA a allowlist da busca — a única forma segura de aceitar escopo do cliente

**Data:** 10/08/2026 · **Contexto:** `RF-37`, `RF-39`, `RN-06`, `RNF-07` · **Decisão de:** Kaique

**O pedido:** o bloco `livesearch` do Confluence é uma caixa de "buscar neste espaço", e
aparecia como placeholder ("não há o que trazer"). Diferente dos outros blocos dinâmicos, ele
não é um **resultado** a reproduzir — é um **caminho**, e busca no espaço é o que o goatlas
já faz melhor que o Confluence para este público: sem assento, com allowlist no servidor e
registrando lacuna de documentação (`RF-42`).

**A tensão:** o `CLAUDE.md` diz, e continua dizendo, que **a allowlist nunca vem do
cliente** — `?espacos=` sempre foi ignorado, porque quem consulta não escolhe o próprio
escopo. Um `?espacos=RH` respeitado seria o caminho mais curto para o espaço do RH.

**A decisão:** `?espaco=` é aceito como **interseção** com `ctx.valores.espacos_confluence`,
nunca como substituição. Consequências, e são elas que fazem a exceção ser segura:

- o conjunto efetivo é **sempre subconjunto da config** — o cliente só consegue pedir
  **menos**;
- espaço fora da allowlist resulta em **lista vazia**, não no espaço;
- e **não** é "ignora o filtro se não casar": ignorar transformaria "buscar só aqui" em
  "buscar em tudo", que é o oposto do que quem clicou pediu.

⚠️ **Um teste de burla que já existia reprovou, e isso foi o processo funcionando.**
`rf37-busca-superficie` afirmava `espacosPermitidos === ['TECH']` — e o cenário dele já
incluía `&espaco=RH` entre os parâmetros de burla. A asserção testava o **mecanismo** ("recebe
exatamente a config"); passou a testar a **propriedade** ("nunca recebe nada fora da config"),
que é o que impede o vazamento e continua reprovando se alguém trocar interseção por
substituição. As duas asserções sobre o resultado — a página do RH não aparece, "salariais"
não vaza no corpo — não mudaram.

⚠️ **Efeito colateral fechado no mesmo movimento:** escopo pedido que sobra vazio devolve zero,
e esse zero **não** é lacuna de documentação. Sem o guarda, um `?espaco=` fora da allowlist
gravaria o termo no mapa de `RF-42` como "procuraram e não existe" — envenenando o backlog de
escrita com algo que nunca foi procurável, e mandando alguém escrever página para um espaço
que o app não expõe. Mesma distinção de `buscaConfigurada`: zero por escopo ≠ zero por
documentação.

**O que NÃO foi feito:** os outros blocos dinâmicos (`recently-updated`, `listlabels`,
`jira`) continuam placeholder. Reproduzi-los exige refazer a consulta **e verificar restrição
de cada item** (`RN-06`), uma chamada por página (`R-02`) — e o valor para deflexão é baixo:
uma lista de páginas alteradas não responde "por que meu relatório está errado". `livesearch`
foi feito porque não havia resultado a reproduzir, só um caminho a oferecer.

### D-31 · Quais blocos do Confluence o app reproduz — e por que `jira` fica de fora por decisão

**Data:** 10/08/2026 · **Contexto:** `RF-43`, `RF-39`, `RN-06`, `R-02`, `R-07`

A pergunta que originou isto foi "não dá para puxar?", olhando um bloco na aba Documentação.
A resposta é **caso a caso**, e a linha que separa os casos não é dificuldade — é **de onde
o conteúdo viria**.

| Bloco | O que é feito | Por quê |
|---|---|---|
| Macro desconhecida **com corpo** (`panel`, `deck`/`card`, `excerpt`, macros internas) | ✅ **Corpo renderizado** | O texto já vem no storage. Grátis, e a caixa cinza estava aparecendo **no lugar do texto** |
| `status` (o "lozenge") | ✅ **Etiqueta**, sem a cor (`D-34`) | O texto está no storage — num **parâmetro**, não num corpo, e era só isso que o fazia cair no placeholder |
| Bloco do **editor novo** (`ac:adf-extension`) | ✅ **Um dos dois lados**, nunca os dois (`D-34`) | O storage traz o nó **e** um fallback em HTML com a mesma coisa. Renderizar os dois duplicava a página |
| `livesearch` | ✅ **Busca de verdade**, escopada no espaço (`D-30`) | Não é um resultado a reproduzir — é uma caixa de busca, e o app já busca melhor que o Confluence para quem não tem assento |
| `children`, `pagetree` | ✅ Aponta para a lista que a leitura **já** mostra (T-115) | O conteúdo está na tela, centímetros abaixo, com restrição verificada por item |
| `contributors`, `recently-updated`, `listlabels`, `toc` | ⏳ **Placeholder** | Custam chamada por visualização — e os dois do meio, **uma verificação de restrição por item** (`RN-06`, `R-02`). Valor baixo para deflexão: uma lista de páginas alteradas não responde "por que meu relatório está errado" |
| `jira`, `jirachart` | 🚨 **Decisão de NÃO fazer** | Ver abaixo |

🚨 **`jira`/`jirachart` não é questão de custo.** A JQL vem de **dentro da página**, que
qualquer pessoa da empresa edita (`R-07`). Executá-la seria rodar uma consulta **escolhida
pelo conteúdo** com a conta de serviço (`D-01`, proxy total) e mostrar o resultado a qualquer
colaborador.

No Confluence isso é contido por três condições (`RN-06`): espaço na allowlist, sem label
bloqueada, página sem restrição. **Para o Jira não existe gate equivalente no app** — não há
allowlist de projeto para leitura, não há verificação de permissão por issue, e sob proxy
total a permissão da conta de serviço não pode servir de proxy da permissão da pessoa
(`RNF-09`). Implementar seria abrir para consulta arbitrária de Jira o caminho que `RN-06`
fecha para o Confluence.

Fica placeholder **por decisão**, não por pendência. Se um dia virar requisito, o
pré-requisito é o gate — não o código da macro.

**O que sustenta isso em código:** a auditoria de `RF-43` (`macro_nao_suportada`) continua
registrando o nome de toda macro que aparece, **inclusive as que passaram a ter o corpo
renderizado**. É essa lista que diz qual bloco vale implementar de verdade um dia, medida em
vez de suposta.

---

### D-32 · A latência era quatro defeitos somados, e nenhum dava erro

**Data:** 10/08/2026 · **Contexto:** `RNF-12`, `RNF-13`, `RNF-15`, `RNF-16`, `R-02` ·
**Decisão de:** Kaique

**O sintoma relatado:** o agente levava ~12 s para responder, a página parecia lenta em
tudo, e a aba Documentação e o console de admin demoravam demais para aparecer. **`RNF-12`
pede busca < 2 s e primeira resposta do agente < 5 s no p95** — os três eram violação de
requisito, não impressão.

**A medição, antes de mexer em qualquer coisa** (`getAppLogs`, `appId 9c47f42f`):
`POST /api/cron/enviar-notificacoes` **com a fila vazia** levava **376–584 ms**. Aquela
rota monta o contexto e lê uma tabela; não havia trabalho nenhum ali para justificar meio
segundo. Foi o fio que revelou os quatro defeitos:

1. **`migrar` rodava a cada requisição.** 35 `CREATE TABLE IF NOT EXISTS` + 3 `ALTER`,
   sequenciais e `await`ados, cada um uma ida ao serviço de banco. Era o piso de ~400 ms que
   **toda** rota pagava antes de começar — inclusive o turno do agente e a leitura de página.
   Agora `garantirMigracao` memoiza **por objeto de banco** (`WeakMap`): uma vez por isolate
   em produção, uma vez por banco nos testes.
2. **O cache de `RNF-13` nunca acertava.** `CacheTtl` existia desde a Fase 1 e vários
   comentários do código contavam com ele ("contido pelo cache de conteúdo") — mas ele morava
   na **instância** do cliente, e `montarContexto` cria uma instância **por requisição**. O TTL
   era decorativo: cada leitura de página rebuscava metadados, labels, restrição e corpo, e
   cada nível do breadcrumb rebuscava os três primeiros de novo. Agora as caches vivem no
   **módulo** (escopo de isolate), com teto de entradas.
3. **Cinco laços `for … await` sobre listas de rede.** Lista de chamados (até **100**
   `obterChamado` em série), restrição por página na busca e na árvore (`RN-06`), espaços da
   allowlist, e a classificação da Regra 2 (uma chamada de IA por ticket, até 20). O tempo era
   a **soma**.
4. **Três idas ao provedor de IA em série por turno**, sendo que a segunda (resposta ao
   usuário) e a terceira (`extrairProposta`) partem do **mesmo** histórico e não dependem uma
   da outra.

**As decisões, e o que cada uma recusa:**

- **Paralelismo tem teto, sempre** (`src/lib/paralelo.ts`, `CONCORRENCIA_ATLASSIAN = 5`,
  `CONCORRENCIA_IA = 3`). ⚠️ `Promise.all` na lista inteira é o conserto **errado**: o burst
  limit da Atlassian por API token não é publicado e os headers `X-RateLimit-*` só aparecem
  no 429 (`RNF-15`, `R-02`) — 100 requisições simultâneas com a credencial única é como se
  descobre o limite do jeito ruim, e o custo cai sobre o app inteiro, não sobre quem clicou.
  Um turno que toma 429 e espera 2 s ficou **mais lento** que o laço em série.
- **A ordem do resultado é preservada** em todo laço paralelizado. Ordenar por "quem
  respondeu primeiro" faria a mesma tela mostrar a lista em ordens diferentes entre duas
  cargas — parece defeito, e é.
- **Cache compartilhada exige teto de entradas.** Enquanto morria com a requisição, crescer
  sem limite era inócuo; por isolate, é vazamento de memória com prazo. E o corpo da página
  ganhou cache **própria** com teto pequeno (30), porque é o único valor grande (até 400 KB) —
  teto único obrigaria a escolher entre guardar poucas páginas ou arriscar centenas de MB num
  Worker de 128 MB.
- ⚠️ **Compartilhar a cache é seguro por causa do proxy total** (`D-01`): a identidade perante
  a Atlassian é sempre a mesma conta de serviço, então não existe resposta "de um usuário"
  para vazar para outro. Num mundo com `raiseOnBehalfOf` por pessoa (`RNF-22`) a cache teria
  de ser por identidade — e é por isso que ela mora em `contexto.ts`, visível, e não escondida
  dentro do cliente.
- ⚠️ **A cache guarda o insumo, nunca a decisão.** `RN-06` continua avaliada por requisição
  contra a allowlist de `ctx.valores`: mudar a allowlist no console vale na requisição
  seguinte, mesmo com metadados em cache.
- **A extração da proposta arranca junto com a última ida ao modelo** (`orquestrador.ts`), e é
  seguro por razão **estrutural**, não por otimismo: só arranca quando as duas verificações
  estão concluídas, e nesse estado `toolsPermitidas` devolve lista **vazia** — o ciclo seguinte
  não pode executar tool, logo não pode nascer bloqueio concorrente. ⚠️ Ainda assim
  `tentarMontarProposta` **reconfere `temBloqueioPendente` antes de gravar**: entre começar a
  extração e voltar dela passa uma ida ao provedor, e um `if` que rodou antes do `await` não
  protege o que acontece depois dele. `RN-07` já foi burlada uma vez (`D-21`).

**O que foi TENTADO e DESCARTADO:**

- **`max_tokens` no turno do chat.** Parecia o conserto óbvio (o corpo saía sem limite de
  geração). Não é: num modelo com raciocínio o teto conta **tokens de raciocínio**, e um teto
  baixo devolve resposta **vazia** — regressão de comportamento que o fake não pegaria, exatamente
  a classe de bug do `env.DB`. E um teto generoso não corta latência nenhuma, porque uma resposta
  de agente de suporte não chega perto dele. Fica como guarda de custo a considerar, não como
  conserto de latência.
- **Streaming da resposta do agente.** É o que mais melhoraria a percepção, e **conflita com o
  desenho**: quando uma regra bloqueia, o servidor **descarta** o texto do modelo e fala no lugar
  dele (`D-21`). Não se transmite texto que talvez seja jogado fora. Streaming exigiria reabrir
  aquela decisão primeiro.
- **Paralelizar a subida do breadcrumb** (`ancestraisExpostos`). A subida é dependente por
  construção (cada nível dá o `parentId` do seguinte), e buscar os níveis "adiantado" para
  descartar depois significaria ler metadados de páginas **acima de um ancestral fechado** —
  funciona hoje e vaza no dia em que alguém devolver o que leu. O que ficou: a subida começa
  **antes** das três escritas de banco da rota e é esperada no fim, então ela acontece durante
  elas; e na árvore ela roda em paralelo com a listagem dos filhos, que é independente.

**O que ficou por medir:** os números acima são de contagem de chamadas, não de p95 em
produção. `RNF-12` só se fecha medindo no app publicado depois do deploy — o mesmo raciocínio
de "teste de integração contra o app publicado não é luxo de fim de projeto".

---

### D-33 · O system prompt do agente é função da instalação, não constante

**Data:** 10/08/2026 · **Contexto:** `RNF-24`, `RNF-18`, `RNF-25`, `RNF-30`, `RN-08`,
`R-04` · **Decisão de:** Kaique

**O sintoma, medido no app real:** a "olá", o agente respondia **"Olá! Como posso te ajudar
hoje?"** — indistinguível de um assistente genérico. A tela já abre com uma saudação própria
(`telas.tsx`), mas ela não entra no histórico do modelo, então o único texto que ele tinha
era o system prompt, e ele não dizia o que fazer num cumprimento.

**Por que isso não é cosmético.** A primeira mensagem é a única chance de dizer o que este
app faz: que ele procura na documentação interna antes de abrir chamado, que o chamado é
acompanhado **aqui dentro** sem conta na Atlassian, que existe formulário para quem não quer
conversar. Quem não descobre isso volta para o Google Chat — o número que `R-04` e `T-235`
existem para mover. "Como posso ajudar?" gasta a mensagem afirmando o que a pessoa já sabia.

**O que mudou:**

1. **`PROMPT_AGENTE` virou `montarPromptAgente(ctx)`.** O texto ganhou identidade
   ("assistente do goatlas", "não é um assistente de uso geral"), a lista do que o app
   **consegue fazer** (documentação, histórico, proposta editável, acompanhamento, resposta,
   anexo, aviso, formulário), instrução explícita para cumprimento e para "o que você faz?",
   a regra de evidência de `RN-11` ("não tenho material para anexar" não se insiste), o
   encaminhamento honesto quando o pedido não é do time de tech, e um teto de tamanho de
   resposta.
2. **Os prazos vêm de `SLA_PRIMEIRA_RESPOSTA_HORAS`**, a mesma constante que
   `notificacoes/sla.ts` usa. Escritas à mão, o agente prometeria um prazo e o alerta
   cobraria outro — divergência que nenhum teste de comportamento pega, porque os dois lados
   continuam "funcionando".
3. **O prompt sabe o que esta instalação NÃO tem** (`ContextoAgente`). Sem
   `espacos_confluence` a busca devolve zero **por configuração**; sem os exemplos de `Q3` a
   Regra 2 se declara indisponível. O prompt antigo prometia as duas verificações sempre — e
   o modelo, recebendo lista vazia, escrevia a conclusão natural: *"não encontrei nada sobre
   isso"*. É a frase oposta à verdade (ninguém procurou) e manda a pessoa abrir chamado por
   algo que pode estar escrito. É o mesmo raciocínio de `buscaConfigurada: false` na rota de
   busca: **zero por falta de config ≠ zero por falta de documentação**.

⚠️ **Os dois predicados são reaproveitados, não reescritos** — `buscaConfigurada`
(`config/diagnostico.ts`) e `regra2Disponivel` (`rules/`), os mesmos que o servidor aplica.
Condição escrita só no orquestrador viraria uma segunda regra divergindo em silêncio, e o
sintoma seria o agente prometendo uma verificação que o servidor já não faz.

⚠️ **Nada disso é trava** (Princípio X). O prompt continua sendo instrução; `RF-08` e `RF-17`
seguem validados em `agent/gate.ts`, e os testes de bypass continuam sendo o que garante a
ordem. `tests/prompt-agente.test.ts` não afirma sobre resposta de modelo — afirma sobre o
texto entregue: identidade presente, capacidades citadas, prazos iguais aos do SLA, avisos
de indisponibilidade aparecendo só quando devem, e **nenhum valor de configuração dentro do
prompt** (`RNF-30`).

**O que ficou de fora, e por quê:** injetar o nome dos tipos de chamado permitidos. Hoje
`tipos_chamado_permitidos` guarda **ids**, e a extração já os recebe; citá-los no chat seria
mostrar detalhe interno a quem conversa (`RNF-30`). No dia em que a lista tiver nome legível
(`listarTiposChamado` por service desk já devolve), isso passa a ser contexto útil e entra
por `ContextoAgente`, sem mudar o resto.

---

### D-34 · O editor novo grava o conteúdo DUAS vezes, e a etiqueta de status não tem corpo

**Data:** 10/08/2026 · **Contexto:** `RF-43`, `RF-39`, `RNF-30`, regra 4, piso de a11y

Dois defeitos de fidelidade medidos na página inicial do espaço de documentação da Gocase, no
app publicado. Nenhum dos dois dava erro, quebrava teste ou aparecia em log: os dois
produziam **tela errada**, que é o único lugar onde `RF-43` pode falhar. Estão juntos aqui
porque têm a mesma causa de fundo — **o critério "tem corpo?" não descreve o storage real**.

#### 1. Painel do editor novo saía duas vezes, em dois idiomas

O editor atual do Confluence grava painel como `ac:adf-extension`, com **dois** filhos: o nó
(`ac:adf-node` → `ac:adf-content`) e uma cópia em HTML (`ac:adf-fallback`) que existe para
editores antigos. As três tags eram desconhecidas para o sanitizador, e tag desconhecida é
**desembrulhada** — então o conteúdo saía uma vez do nó e outra do fallback.

O fallback estava em **inglês**. Na tela: o mesmo painel de boas-vindas com o título em
português, e logo abaixo em inglês, com a lista de sugestões repetida. Ninguém lê duas vezes
para descobrir que é o mesmo texto — **quem vê conteúdo repetido conclui que o app está
quebrado, e quem conclui isso abre chamado**, que é o oposto do que a aba existe para fazer.

**A regra é: conteúdo do nó, senão fallback. Nunca os dois.**

- **O nó ganha** porque é o conteúdo de verdade, e o fallback é a cópia — foi ele que veio em
  inglês. Preferir o fallback funcionaria hoje e entregaria a tradução errada.
- ⚠️ **Mas o fallback não é decoração: ele é o caminho dos blocos INLINE.** `status`, `date` e
  afins vêm como `ac:adf-node` **sem** `ac:adf-content` (o texto mora nos atributos), e o
  fallback traz a `ac:structured-macro` equivalente, que o sanitizador já converte.
  "Só o nó" faria toda etiqueta escrita no editor novo desaparecer.
- `ac:adf-attribute`/`ac:adf-parameter` devolvem **nada**, e isso é necessário, não redundante:
  desembrulhados, o **valor** deles viraria texto visível — a página mostrava
  `1f5d1 #c9372c info` solto antes do painel, que além de ruído é parâmetro na tela
  (`RNF-30`).
- `panel-type` **é** lido e traduzido para a `VariantePainel` que a macro antiga já usava, para
  que um aviso escrito no editor novo continue sendo aviso. Ele é apresentação; o que `RNF-30`
  guarda é JQL, chave de espaço e id de filtro, que descrevem o interior da Atlassian.

#### 2. `status` não tem corpo, e por isso virava "não sabemos mostrar"

O critério do sanitizador para "dá para renderizar?" era ter `ac:rich-text-body`. A macro
`status` não tem: o texto dela mora num **parâmetro** (`title`), como a linguagem do bloco de
código. Então a macro que marca "Concluído"/"Em andamento" em toda página de processo caía no
placeholder de `RF-43` — **acusando limitação nossa sobre um texto que estava no storage**, a
um `parametroDaMacro` de distância. Apareceu duas vezes na mesma página.

🚨 **A cor NÃO vai para a tela, e isso é decisão, não simplificação.** O lozenge do Confluence
tem `colour` (`Green`, `Red`…). Pintar seria inventar paleta — a identidade GoGroup não tem
vermelho nem verde (§1.3) — **e** comunicar estado por cor, que o piso de a11y do projeto
proíbe. O que a pessoa escreveu no `title` é o estado: é o que vai para a tela, e é o que um
leitor de tela lê. A forma é pílula, não o chip quadrado de `.doc-codigo-inline`, para que
"Concluído" não se leia como trecho de código.

⚠️ **`title` vazio devolve nada, não o placeholder.** Etiqueta sem texto é pílula vazia — o
Confluence desenha assim, e não há informação a preservar. O placeholder ali seria o erro
oposto: anunciar conteúdo escondido que não existe, exatamente o que a frase antiga de
`RF-43` fazia (ver `D-31`).

**O que sustenta em código:** `tests/rf43-adf-e-status.test.ts`, e a asserção que importa é de
**contagem** (`vezes(html, …) === 1`), não de presença — presença passava antes do conserto.
12 dos 13 casos reprovam contra o código anterior. A auditoria de `RF-43` continua registrando
`adf:<tipo>` para nó ADF que não tenha nem conteúdo nem fallback, para a lista de "o que vale
implementar" continuar medida.

**Lição, a mesma de `D-23` e do `env.DB`:** o critério estava escrito a partir do storage que
imaginávamos. Aqui a divergência não era da plataforma — era do **editor**, que mudou de
formato e continuou servindo o antigo ao lado do novo.

---

### D-35 · O schema deixa de ser reaplicado por requisição, e a marca de versão é DERIVADA

**Data:** 10/08/2026 · **Contexto:** `RNF-36` (novo), `RNF-15`, `T-135` · **Decisão de:** Kaique

**O relato:** "a página em si é bem lenta, tudo demora pra aparecer — até a tela de admin,
mesmo minha conta já estando logada". O "mesmo estando logada" é a parte que aponta o
culpado: não era o OAuth do edge.

**A medição.** `montarContexto` — que roda a **cada** requisição `/api/*`, porque é ele que
resolve `CONFIG_PADRAO → env → banco` e config alterada no console tem de valer na requisição
seguinte — começa chamando `migrar(env.DB)`. `migrar` aplicava os 32 `CREATE TABLE/INDEX IF
NOT EXISTS` mais os 3 `ALTER TABLE`, **em série**, com um `await` por statement. Contado com
um espião em volta do `Banco`:

| | Idas ao banco por requisição `/api/*` |
|---|---|
| Antes | **36**, em toda requisição, sempre — 35 na migração (32 DDL + 3 `ALTER`) + 1 do `config.carregar()` |
| Depois — mesmo isolate | **1** (só `config.carregar()`) |
| Depois — isolate novo, banco já migrado | **2** (a sonda + config) |

No app publicado (`getAppLogs`, 10/08/2026) isso aparecia como piso de **442 ms** no cron
mais barato do sistema — `enviar-notificacoes` sem nada a enviar, que praticamente só monta
contexto — e a aba de admin dispara **seis** requisições paralelas no boot, mais o
`/api/auth/me` da casca.

**Por que passou por 763 testes.** Todos passam, e continuariam passando: o comportamento
estava **correto**, só caro. `CREATE TABLE IF NOT EXISTS` é idempotente por definição, então
nenhuma asserção sobre dado tinha motivo para falhar. E no shim de teste (`sqlite-local`,
`node:sqlite` em memória) cada statement custa microssegundos — o custo que dói é **de rede**,
e só existe na plataforma. É a mesma família de `linhasComoObjetos` e do `env.DB` devolvendo
`{}`: o dublê implementa o contrato e esconde a propriedade da plataforma que importa.
⚠️ Daí o teste novo contar **idas ao banco**, nunca milissegundos: teto em tempo de parede
não é verificável sem rede e seria instável na máquina de qualquer pessoa.

**A decisão, em duas partes:**

1. **Memoizar a migração por instância de `Banco`** (`WeakMap`, guardando a *promessa* e não
   um booleano — duas requisições concorrentes no boot do isolate senão migram as duas, o
   mesmo check-then-insert que o outbox evita com constraint). `WeakMap` e não flag de
   módulo porque cada teste monta um banco novo: uma flag global faria o segundo teste rodar
   contra um banco sem tabela nenhuma.
2. **Uma sonda de UMA query** (`meta_schema`) para o caso que a memoização não cobre: isolate
   reciclado sobre banco já migrado. Sem ela o ganho dependeria de o `env.DB` ser a mesma
   instância entre requisições — o que a plataforma não promete.

⚠️ **A parte 1 chegou por outro caminho, e as duas convivem — não são a mesma coisa** (merge
com `D-32`, 10/08/2026). O mesmo defeito foi corrigido em duas frentes ao mesmo tempo: `D-32`
trouxe a memoização como `garantirMigracao`, esta trouxe a sonda. Elas **não se substituem** —
a sonda corta os 35 statements para 2 idas num isolate **novo**, e a memoização corta as 2
para **zero** em toda requisição seguinte do **mesmo** isolate. Ficar só com uma delas deixa
metade do custo de pé, e o sintoma é o mesmo de sempre: comportamento certo, tempo errado.

⚠️ **E a divisão dos nomes é contrato:** `garantirMigracao` memoiza e é o que
`montarContexto` chama; `migrar` continua exportada **sem** memoização, porque os testes de
schema querem justamente forçar a reaplicação. Memoizar `migrar` "para simplificar" faz esses
testes deixarem de reaplicar nada **em silêncio** — há um caso em
`tests/migracao-custo-por-requisicao.test.ts` cobrando exatamente essa distinção.

**A marca de versão é derivada do texto do schema, não escrita à mão.** Um número manual
tem um passo esquecível: quem acrescenta tabela em `TABELAS` e não sobe o número produz um app
que **nunca** aplica a tabela nova, e o sintoma aparece longe daqui — leitura falhando num
módulo qualquer, na mesma família de `{}` silencioso. Derivando de `[...TABELAS,
...COLUNAS_ADICIONADAS]`, mudar o schema muda a marca por construção. Não é hash
criptográfico e não precisa ser: a pergunta é "este texto é o mesmo?", não "alguém forjou
isto?" — quem escreve em `meta_schema` é o próprio app.

**Fail-closed, como o resto.** A sonda devolve "já aplicado" **só** com a marca exatamente
igual. Tabela ausente, marca diferente, erro na leitura → aplica tudo. O custo de aplicar DDL
idempotente à toa é tempo; o custo de não aplicar é tabela faltando em produção. E migração
que falha **não** fica memoizada como concluída: a requisição seguinte tenta de novo, senão
uma queda momentânea do banco deixaria o isolate sem schema até ser reciclado.

**Tabela própria, não uma chave em `config`.** `config` é a tabela que o console edita e que
`PUT /api/admin/config` valida por tipo (`D-25`); uma chave interna morando lá seria linha sem
família no mapa `FAMILIA`, numa tela feita para decisões humanas.

**No mesmo movimento, o primeiro paint.** A folha da Poppins era um `<link rel="stylesheet">`
render-blocking para **dois** domínios de terceiro: o navegador não pintava nada — nem o
cabeçalho, nem "carregando" — antes de resolver DNS, abrir TLS e baixar CSS do Google. Passou
a carregar sem bloquear (`media="print"` + `onload`). ⚠️ `&display=swap` **não** resolvia
isso: ele governa quando o *texto* troca de fonte, não quando a *página* pinta.

**Consequência aceita:** existe agora um instante com fonte de sistema (FOUT) — antes não
existia porque a tela toda esperava. A pilha de fallback em `tokens.css` deixou de ser
`sans-serif` cru e passou a nomear fontes com métricas próximas às da Poppins, para a troca
ser mudança de desenho da letra e não reflow de parágrafo. A identidade visual (§2) continua
sendo Poppins; o que mudou é o que se vê antes dela chegar. Voltar a um `<link>` bloqueante
"para não piscar" devolve a espera ao caminho crítico.

**O que NÃO foi feito, e por quê:**

- **Partir o bundle** (269 kB, `React.lazy` na aba de admin e na de documentação). Os assets
  levaram 595–624 ms nos logs, mas boa parte disso é latência da plataforma servindo arquivo,
  que dividir não muda. E code-splitting **piora** justamente a aba de admin — a tela que o
  relato citou — porque acrescenta uma ida de rede depois do clique. Fica como medição futura,
  não como conserto às cegas.
- **Cachear `config.carregar()` entre requisições.** É 1 ida ao banco e é a ida que faz o
  console de admin ter efeito **sem deploy** (`RF-49`). Guardá-la em memória do isolate
  reintroduziria o no-op silencioso que o `CLAUDE.md` já descreve para
  `GOATLAS_ESPACOS_CONFLUENCE`, agora do outro lado.

### D-36 · Config é para o que VARIA — o mapeamento de campo customizado vira código

**Data:** 11/08/2026 · **Decisão de:** Kaique (mantenedor) · **Contexto:** `RNF-25`,
Princípio VIII da constituição, `RF-21`, `Q4`, spec 006 · **Emenda:** constituição 1.0.1 → 1.1.0

**A regra anterior era "zero hardcode", sem exceção.** Ela nasceu certa — IDs de projeto,
service desk, espaço e request type mudam por instalação e por decisão de roteamento, e o
projeto inteiro depende de mudá-los sem deploy (`RF-49`). Só que ela era aplicada como
absoluto, e empurrava para config coisas que **ninguém decide**.

**O que forçou a revisão:** medição contra a Atlassian real em 11/08/2026 mostrou que
`customfield_10092` é *"Cargo/Função que exercerá dentro do time"* no request type 108 e
*"Em que sistema o Bug está ocorrendo?"* no 70. `customfield_10093` idem (108 × 134).
Ou seja, **um id de campo não tem significado fora do request type** — e `campo_solicitante_id`,
o campo de config que `Q4` esperava preencher, é um **id global**. Preenchê-lo faria o app
escrever o e-mail do solicitante dentro do campo "Em que sistema o Bug está ocorrendo?" de
todo chamado de bug, com **HTTP 201** e nada na tela indicando erro.

🚨 **Config não conserta isso — config é o veículo do erro.** O valor certo não é uma
preferência da instalação: é a forma do formulário do Jira, e ela é verificável em teste.

**A decisão:** o critério deixa de ser "hardcode é proibido" e passa a ser
***este valor muda sem o código mudar?***

| Varia → config/secret | Não varia → código, com teste |
|---|---|
| `service_desk_id`, allowlist de request type (ajustada em 11/08), espaços do Confluence (`RF-49`), thresholds, canal, piloto, retenção, `org_id`, custo por produto | mapeamento *campo customizado → significado, por request type* |

**Consequências:**
- `campo_solicitante_id` **sai** de `ConfigValores` e do console de admin; no lugar entra um
  mapeamento por request type, fixo no código.
- **`Q4` deixa de ser bloqueio** — a pergunta ("o campo Solicitante existe?") foi respondida
  pela medição: o que existe é um par nome/e-mail no tipo 108, e ele já está mapeado.
- **Custo aceito:** se o Jira mudar um id de campo, é deploy. Aceito porque a alternativa
  comprovadamente escreve dado no campo errado em silêncio, e porque id de campo do Jira não
  muda sozinho — quem o muda é uma pessoa reconfigurando o formulário.
- ⚠️ **A emenda é estreita de propósito.** O mantenedor pediu "remover a regra, tudo fixo
  (a não ser que seja variável mesmo)"; o parêntese é a regra, e ele preserva em config tudo
  o que de fato varia. Ampliar isto para fixar `service_desk_id` ou a allowlist de espaços
  **reabre `D-36`** — os dois foram alterados neste mesmo dia, o que é a prova de que variam.

**Caminho de saída:** se um dia a instalação precisar de mapeamento diferente sem deploy, o
padrão de `D-25` continua disponível — valor em `ConfigValores` **fora** da tela do console —
e o mapa por request type sobrevive à mudança, porque o que ele corrige é a *forma*, não o
*lugar* do valor.

---

## Perguntas em aberto

Cada uma bloqueia tarefas específicas. `Bloqueia` lista o que não pode ser
implementado antes da resposta.

| # | Pergunta | Quem decide | Bloqueia |
|---|---|---|---|
| Q1 | Qual conta de serviço será criada, e quais privilégios exatos em cada uma das três credenciais? | João | ✅ **RESPONDIDA na parte de credencial — `D-23`, 07/08/2026.** `ATATT` clássico validado (`/rest/api/3/myself` → 200), `ATCTT` em `ATLASSIAN_ORG_API_KEY`, org id validado, `GOATLAS_SERVICE_DESK_ID=4` (`GN`, "Tickets Engenharia"). **T-063 saiu do bloqueio** — falta escolher os tipos da allowlist de `RF-28`, que é roteamento. ⚠️ **Pendências que não são "qual credencial":** a conta é **pessoal do João** (contra `RNF-03` — conta de serviço dedicada continua a fazer), o `ATCTT` precisa de **rotação** e pode virar chave só-leitura, e a **escrita** de governança exige reivindicar o domínio, não credencial |
| Q2 | Qual campo do Jira delimita "mesmo tipo de ticket" para a Regra 2 — label, componente ou tipo de issue? | João + time de tech | RF-10, RF-11 (o agrupamento do `check_jira_history`) |
| Q3 | Quais são os exemplos reais de "ajuste operacional" da Gocase para o prompt de classificação? | João + tech/dados | RF-14 — e sem ele a Regra 2 classifica mal (é pré-requisito, não refinamento) |
| Q4 | O campo customizado "Solicitante" já existe no projeto do portal, ou precisa ser criado? | João + time de tech | ✅ **RESPONDIDA pela medição — `D-36`, 11/08/2026.** Não existe um campo "Solicitante": o que existe é um par **`customfield_10089` (Nome do Colaborador)** + **`customfield_10091` (E-mail)**, obrigatórios, **só no request type 108**. 🚨 E o mesmo id significa outra coisa em outro tipo (`10092`: cargo no 108, sistema do bug no 70), então `campo_solicitante_id` — um id **global** — tinha a forma errada: sai da config e vira mapeamento **por request type**, fixo no código. RF-21, RNF-21 (reconciliação) |
| Q5 | Quais espaços do Confluence entram na allowlist inicial? | João | **Lista autoritativa em mãos (`D-23`): 32 espaços, com nome e tipo.** ⚠️ O `TECH` que circulava **nunca existiu**, e a recomendação do `D-22` estava furada: **`GO` é "Go Shopify"**, não engenharia. Candidatos reais: `GT` (GO Tecnologia, `knowledge_base`), `DTE`, `GN`, `DE` (Devops), `GI` (GO INFRA), `dicas`, `GLPI`. **Parcialmente aplicada:** o secret existe desde 07/08 17:35 e o `CLAUDE.md` registra `GT,DTE,GN` (3 de 31 espaços reais). ⚠️ **O que resta é conflito, não ausência** — a sugestão do João inclui `GO`/`PROD` e a `D-23` §7 diz que `GO` não é engenharia. Ver `D-29` |
| Q6 | ~~Qual API de IA?~~ Resta: qual a **política de retenção/treinamento** do provedor atrás do proxy corporativo? | João | **Provedor decidido — ver D-05.** O que resta bloqueia o *rollout* (conformidade **RNF-34**), não a arquitetura |
| Q7 | Quais domínios de e-mail além de `@gocase.com` são válidos? | João | RF-01, RF-05 (allowlist de domínio no servidor) |
| Q8 | Qual o custo unitário real por produto Atlassian hoje? | João / financeiro | ✅ **Respondida em `D-23`**: 73 assentos (5 JSM · 35 Jira · 33 Confluence), e a curva do JSM é **escalonada** — faixa 1–100 medida em USD 9,05 e 6,70. 🚨 **E isso quebra o `custo.ts`**, que multiplica contagem × custo fixo: o preço por assento **sobe** quando se corta, então a economia projetada está **superestimada** — justo o número que recomenda rebaixar. Vira **T-134**. O **valor** se preenche no console desde `D-25`, sem deploy; a **curva** por faixa entra em `curva_preco_por_produto`, e sem ela a economia sai marcada como teto |
| Q9 | Como comunicar o SLA de 24h às áreas que hoje têm retorno em 2h30 sem soar como piora? | João + Produto | Não bloqueia código; bloqueia **rollout** (R-05) |
| Q10 | O time de tech está ciente de que o reporter dos chamados vai mudar? | João | Não bloqueia código; bloqueia **rollout** (R-03) |
| Q11 | Google Chat, e-mail ou ambos na v1 de notificações? | João | **Decidida para o MVP em `D-20`: `nenhum`** — o aviso vive na aba Avisos. Chat por espaço foi recusado (vazaria chamado de todos numa sala, contra `RF-30`); e-mail entra quando houver provedor HTTP. Ver também `D-19`. Os dois canais estão implementados e testados; o que falta é *escolher*, e a escolha é um campo de config. Enquanto `canal_notificacao_padrao` for `null`, o aviso é registrado e suprimido, e o console diz quantos |
| Q12 | ~~O GoDeploy já oferece SSO Google pronto?~~ | Kaique | **Respondida — ver D-02** |
| Q13 | Quais 1–2 áreas entram no piloto? | João | **Decidida para o MVP em `D-20`: piloto DESLIGADO** — o gate só faz sentido depois de `T-333`/`T-334`. Ver também `D-16`. O gate existe e `emails_piloto` vazio mantém o piloto desligado; falta a lista (sugestão do documento: CX + Produção) |
