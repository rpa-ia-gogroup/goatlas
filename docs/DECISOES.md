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
3. **UUID só tem `0-9a-f`.** Um id com `j`/`k` está transcrito errado — não dá erro
   de configuração, dá 404 na API muito depois. O valor de `GOATLAS_ORG_ID` hoje
   registrado **não foi validado** e precisa ser reconferido.

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
- **`GOATLAS_ORG_ID` provavelmente está corrompido** — o valor no `.env` do João tem
  `j` e `k`, que não são hexadecimais (confusão 3 do `D-14`, agora com evidência). Não
  é legível por MCP; precisa ser reconferido em `admin.atlassian.com/o/<id>/`.
- **Os códigos HTTP são de 31/07** e não foram reexecutados em 07/08 (o sandbox do João
  bloqueou o `curl`). A leitura do `.env` é de 07/08 e está confirmada.

---

## Perguntas em aberto

Cada uma bloqueia tarefas específicas. `Bloqueia` lista o que não pode ser
implementado antes da resposta.

| # | Pergunta | Quem decide | Bloqueia |
|---|---|---|---|
| Q1 | Qual conta de serviço será criada, e quais privilégios exatos em cada uma das três credenciais? | João | **Parcial — ver D-14 e sobretudo `D-22`.** O 401 está **diagnosticado**: `ATLASSIAN_API_TOKEN` guarda um `ATCTT` (chave de org) e `/rest/api/3/*` só aceita `ATATT` (token de usuário). Falta **gerar o `ATATT`** — é a única ação que destrava Confluence e JSM reais. `LLM_API_KEY` e `GODEPLOY_CRON_KEY` **já estão registrados** (o `D-14` está desatualizado nisso); `ATLASSIAN_ORG_API_KEY` não, e o valor certo para ela é o `ATCTT` que hoje está na chave errada. **T-122/T-123/T-131 saíram do bloqueio — ver D-18:** implementadas e testadas contra `fetch` simulado. T-063 depende ainda de um projeto **JSM** |
| Q2 | Qual campo do Jira delimita "mesmo tipo de ticket" para a Regra 2 — label, componente ou tipo de issue? | João + time de tech | RF-10, RF-11 (o agrupamento do `check_jira_history`) |
| Q3 | Quais são os exemplos reais de "ajuste operacional" da Gocase para o prompt de classificação? | João + tech/dados | RF-14 — e sem ele a Regra 2 classifica mal (é pré-requisito, não refinamento) |
| Q4 | O campo customizado "Solicitante" já existe no projeto do portal, ou precisa ser criado? | João + time de tech | **Só o valor** — `campo_solicitante_id` já é config (RNF-25), editável sem deploy assim que a resposta chegar. RF-21, RNF-21 (reconciliação) |
| Q5 | Quais espaços do Confluence entram na allowlist inicial? | João | **Respondida em `D-22`: `GO`, `DTE`, `GN`, `datateam`, `Protheus`.** ⚠️ O espaço `TECH` que circulava **não existe** — era exemplo genérico virado premissa. A lista levantada é um **piso** (vem do índice do RAG); a autoritativa exige `ATATT`. Continua revisável sem deploy (`RF-49`) |
| Q6 | ~~Qual API de IA?~~ Resta: qual a **política de retenção/treinamento** do provedor atrás do proxy corporativo? | João | **Provedor decidido — ver D-05.** O que resta bloqueia o *rollout* (conformidade **RNF-34**), não a arquitetura |
| Q7 | Quais domínios de e-mail além de `@gocase.com` são válidos? | João | RF-01, RF-05 (allowlist de domínio no servidor) |
| Q8 | Qual o custo unitário real por produto Atlassian hoje? | João / financeiro | RF-53 (custo mensal e assentos ociosos) |
| Q9 | Como comunicar o SLA de 24h às áreas que hoje têm retorno em 2h30 sem soar como piora? | João + Produto | Não bloqueia código; bloqueia **rollout** (R-05) |
| Q10 | O time de tech está ciente de que o reporter dos chamados vai mudar? | João | Não bloqueia código; bloqueia **rollout** (R-03) |
| Q11 | Google Chat, e-mail ou ambos na v1 de notificações? | João | **Decidida para o MVP em `D-20`: `nenhum`** — o aviso vive na aba Avisos. Chat por espaço foi recusado (vazaria chamado de todos numa sala, contra `RF-30`); e-mail entra quando houver provedor HTTP. Ver também `D-19`. Os dois canais estão implementados e testados; o que falta é *escolher*, e a escolha é um campo de config. Enquanto `canal_notificacao_padrao` for `null`, o aviso é registrado e suprimido, e o console diz quantos |
| Q12 | ~~O GoDeploy já oferece SSO Google pronto?~~ | Kaique | **Respondida — ver D-02** |
| Q13 | Quais 1–2 áreas entram no piloto? | João | **Decidida para o MVP em `D-20`: piloto DESLIGADO** — o gate só faz sentido depois de `T-333`/`T-334`. Ver também `D-16`. O gate existe e `emails_piloto` vazio mantém o piloto desligado; falta a lista (sugestão do documento: CX + Produção) |
