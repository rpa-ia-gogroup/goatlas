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

## Perguntas em aberto

Cada uma bloqueia tarefas específicas. `Bloqueia` lista o que não pode ser
implementado antes da resposta.

| # | Pergunta | Quem decide | Bloqueia |
|---|---|---|---|
| Q1 | Qual conta de serviço será criada, e quais privilégios exatos em cada uma das três credenciais? | João | Qualquer chamada real à Atlassian. Fase 1 inteira. |
| Q2 | Qual campo do Jira delimita "mesmo tipo de ticket" para a Regra 2 — label, componente ou tipo de issue? | João + time de tech | RF-10, RF-11 (o agrupamento do `check_jira_history`) |
| Q3 | Quais são os exemplos reais de "ajuste operacional" da Gocase para o prompt de classificação? | João + tech/dados | RF-14 — e sem ele a Regra 2 classifica mal (é pré-requisito, não refinamento) |
| Q4 | O campo customizado "Solicitante" já existe no projeto do portal, ou precisa ser criado? | João + time de tech | RF-21, RNF-21 (reconciliação) |
| Q5 | Quais espaços do Confluence entram na allowlist inicial? | João | RF-37, RF-38 e o `search_confluence` da Regra 1 |
| Q6 | ~~Qual API de IA?~~ Resta: qual a **política de retenção/treinamento** do provedor atrás do proxy corporativo? | João | **Provedor decidido — ver D-05.** O que resta bloqueia o *rollout* (conformidade **RNF-34**), não a arquitetura |
| Q7 | Quais domínios de e-mail além de `@gocase.com` são válidos? | João | RF-01, RF-05 (allowlist de domínio no servidor) |
| Q8 | Qual o custo unitário real por produto Atlassian hoje? | João / financeiro | RF-53 (custo mensal e assentos ociosos) |
| Q9 | Como comunicar o SLA de 24h às áreas que hoje têm retorno em 2h30 sem soar como piora? | João + Produto | Não bloqueia código; bloqueia **rollout** (R-05) |
| Q10 | O time de tech está ciente de que o reporter dos chamados vai mudar? | João | Não bloqueia código; bloqueia **rollout** (R-03) |
| Q11 | Google Chat, e-mail ou ambos na v1 de notificações? | João | RF-45 (Fase 3) |
| Q12 | ~~O GoDeploy já oferece SSO Google pronto?~~ | Kaique | **Respondida — ver D-02** |
| Q13 | Quais 1–2 áreas entram no piloto? | João | Fase 4 (sugestão do documento: CX + Produção) |
