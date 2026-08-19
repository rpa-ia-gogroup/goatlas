---
feature: "campos-do-solicitante"
id: "006"
status: draft
created: "2026-08-11"
spec_version: 1
---

# Spec: Campos do solicitante no chamado

> **Regra de ouro:** esta spec descreve **WHAT** e **WHY**. O **HOW** vai no `plan.md`.

## 1. Problem & Why

Sob proxy total (`D-01`), a Atlassian só conhece a conta de serviço. Quem abre o chamado
existe apenas no que o app escreve — hoje, o bloco de autoria na descrição (`D-13`) e a
coluna `area` do vínculo (`RF-19`).

Medição contra a Atlassian real em **11/08/2026** (staging, `GN`/service desk 4) mostrou
três coisas que mudam o desenho:

1. **O tipo 108 ("Solicitar acesso/permissão a um Sistema") exige `Nome do Colaborador` e
   `E-mail` como campos obrigatórios do formulário.** A pessoa digita à mão dois dados que
   o app já tem pelo login corporativo. Digitar e-mail à mão é também a forma mais fácil de
   o vínculo `issueKey ↔ solicitante` divergir do que está escrito no chamado.
2. **O mesmo id de campo significa coisas diferentes por request type.**
   `customfield_10092` é *"Cargo/Função que exercerá dentro do time"* no tipo 108 e *"Em que
   sistema o Bug está ocorrendo?"* no tipo 70. `customfield_10093` tem a mesma duplicidade
   (108 × 134). A configuração atual de `RF-21` é **um id global** (`campo_solicitante_id`,
   `Q4`) — a forma errada: preencher por id global escreveria o dado no campo errado, com
   HTTP 201 e nada na tela indicando o erro.
3. **A área organizacional não tem destino na Atlassian hoje.** O campo `Setor Gocase`
   (`customfield_10090`) é multi-checkbox com 15 opções fixas e **não está publicado em
   nenhum formulário de portal** dos tipos liberados — logo é inalcançável pela API de
   criação. E o vocabulário da fonte não é o do Jira: a área organizacional real da primeira
   pessoa medida (`RPA`) **não existe** entre as 15 opções.

**Custo de não fazer:** o formulário continua pedindo o que já se sabe; `RF-21` continua
esperando um `Q4` cuja forma é comprovadamente errada; e a área do solicitante continua
saindo de uma tabela de configuração mantida à mão, que ninguém atualiza quando alguém muda
de time.

## 2. Goals / Non-Goals

**Goals**
- Preencher automaticamente, no tipo que os exige, os campos de **nome** e **e-mail** do
  solicitante a partir da identidade já autenticada.
- Substituir a configuração de campo do solicitante por um mapeamento **por request type**,
  de modo que um id nunca seja aplicado a um tipo onde significa outra coisa.
- Derivar a **área organizacional** do solicitante de uma fonte viva (TeamGuide) e
  **persistir** essa área, mantendo `RF-19`.
- Degradar sem bloquear: indisponibilidade da fonte de área nunca impede abrir chamado.

**Non-Goals (explicitamente fora de escopo)**
- **Enviar a área à Atlassian.** Decisão do mantenedor em 11/08/2026: a área é derivada e
  guardada, e **não trafega** para a Atlassian nem para qualquer outro destino. Enviar é
  trabalho futuro, e depende de o `Setor Gocase` ser publicado num formulário de portal.
- **Preencher o campo de cargo automaticamente.** No tipo 108 ele pergunta *"Cargo/Função
  que exercerá dentro do time"* — o papel que a pessoa terá no acesso pedido, não o cargo
  dela. A fonte externa responderia outra pergunta.
- **Preencher os demais campos obrigatórios do tipo 108** (`Sistema que solicita acesso`,
  `Breve descrição do que irá fazer`, `Email da pessoa referência`). São informação que só o
  solicitante tem.
- Ampliar ou reduzir a allowlist de tipos de chamado (`RF-28`).

## 3. Users & Context

Colaborador da Gocase **sem assento Atlassian**, autenticado pelo login corporativo, abrindo
chamado pelo formulário sem IA (`D-04`) ou pela confirmação da conversa com o agente
(`RF-17`). O app conhece nome e e-mail da pessoa desde o primeiro clique; a Atlassian não
conhece nenhum dos dois.

Administrador do atlas, que hoje vê no console um campo de configuração de id de campo
customizado — e que, por decisão do mantenedor, deixará de vê-lo.

## 4. User Stories

- **US-1** — As a colaborador abrindo um chamado de acesso, I want não redigitar meu nome e
  meu e-mail, so that eu gaste menos tempo e o chamado não nasça com um e-mail diferente do
  meu login.
- **US-2** — As a agente do time de tech, I want que o nome e o e-mail no chamado sejam os
  da pessoa autenticada, so that eu não precise confiar no que alguém digitou.
- **US-3** — As a mantenedor do atlas, I want que o mapeamento de campo seja por tipo de
  chamado, so that um id reusado com outro significado não escreva dado no campo errado.
- **US-4** — As a mantenedor do atlas, I want a área do solicitante derivada da fonte
  organizacional viva, so that ela continue correta quando alguém muda de time, sem ninguém
  editar tabela.
- **US-5** — As a colaborador, I want abrir meu chamado mesmo quando a fonte de área está
  fora do ar, so that uma indisponibilidade que não me diz respeito não vire parede.

## 5. Scenarios (Given / When / Then)

- **SC-1** (US-1, US-2) — preenchimento automático no tipo que exige
  - **Given** uma pessoa autenticada como `nome`/`email` e um tipo de chamado cujo schema
    expõe campos de nome do solicitante e de e-mail do solicitante
  - **When** ela confirma a abertura do chamado
  - **Then** o chamado é criado com esses campos preenchidos com o nome e o e-mail **da
    sessão**, e não com valores vindos do corpo da requisição.

- **SC-2** (US-3) — id reusado com outro significado
  - **Given** um tipo de chamado que usa o mesmo id de campo com outro rótulo
  - **When** uma pessoa abre um chamado desse tipo
  - **Then** o app **não** escreve nada nesse campo, porque o mapeamento vale só para o tipo
    a que pertence.

- **SC-3** (US-1) — tipo que não expõe os campos
  - **Given** um tipo de chamado cujo schema não expõe campo de nome nem de e-mail
  - **When** a pessoa abre o chamado
  - **Then** o chamado é criado normalmente, sem campo extra e sem erro.

- **SC-4** (US-4) — área derivada e persistida
  - **Given** uma pessoa cuja área é resolvível na fonte organizacional
  - **When** ela abre um chamado
  - **Then** a área fica registrada no vínculo do chamado, e **nenhuma requisição à
    Atlassian contém a área**.

- **SC-5** (US-5) — fonte de área indisponível
  - **Given** a fonte organizacional fora do ar, lenta ou sem credencial configurada
  - **When** a pessoa abre um chamado
  - **Then** o chamado é aberto, a área fica ausente, e o evento é auditado como área não
    resolvida — nunca como falha da abertura.

- **SC-6** (US-4) — pessoa desconhecida na fonte
  - **Given** um e-mail que não existe na fonte organizacional
  - **When** a pessoa abre um chamado
  - **Then** a área fica ausente, distinguível de "a fonte caiu" na auditoria.

- **SC-7** (US-3) — schema do tipo indisponível
  - **Given** que o schema do request type não pôde ser lido
  - **When** a pessoa abre o chamado
  - **Then** nenhum campo do solicitante é preenchido e o chamado é aberto assim mesmo,
    coerente com `RF-62`/`D-27` (fail-open no chamado, fail-closed no campo).

- **SC-8** (US-1) — o cliente não escolhe o valor
  - **Given** um corpo de requisição que traz nome e e-mail diferentes dos da sessão
  - **When** o chamado é criado
  - **Then** valem os da sessão, e a tentativa não muda o resultado.

## 6. Functional Requirements (EARS)

- **FR-1** — WHERE o schema do request type expõe um campo mapeado como *nome do
  solicitante*, THE SYSTEM SHALL preenchê-lo com o nome da identidade autenticada.
- **FR-2** — WHERE o schema do request type expõe um campo mapeado como *e-mail do
  solicitante*, THE SYSTEM SHALL preenchê-lo com o e-mail da identidade autenticada.
- **FR-3** — THE SYSTEM SHALL usar a identidade resolvida no servidor como **valor inicial**
  desses campos, e SHALL aceitar edição explícita da pessoa antes da confirmação.
  ⚠️ **Decisão de 11/08/2026:** o mantenedor não sabe se o tipo 108 é usado para pedir acesso
  **para terceiros**, e a forma dos campos sugere que sim. Pré-preencher e permitir edição é
  correto sob as duas leituras; fixar na identidade seria errado — e errado em silêncio — sob
  a segunda. A autoria verificável continua sendo o vínculo e o bloco do `D-13`, que o cliente
  não forja, então isto **não** enfraquece `RF-30`.
- **FR-4** — THE SYSTEM SHALL manter o mapeamento *campo → significado* **por request type**,
  de modo que um id só seja aplicado ao tipo para o qual foi mapeado.
- **FR-5** — IF um request type não tem mapeamento, THEN THE SYSTEM SHALL abrir o chamado sem
  campos do solicitante, sem erro.
- **FR-6** — WHEN um chamado é aberto, THE SYSTEM SHALL registrar no vínculo a área
  organizacional do solicitante derivada da fonte organizacional.
- **FR-7** — THE SYSTEM SHALL NOT incluir a área organizacional em nenhuma requisição à
  Atlassian nem em nenhum outro destino externo.
- **FR-8** — IF a fonte organizacional está indisponível, sem credencial ou não resolve o
  e-mail, THEN THE SYSTEM SHALL abrir o chamado com área ausente e registrar o motivo na
  auditoria, distinguindo *indisponível* de *não encontrada*.
- **FR-9** — THE SYSTEM SHALL preservar a correção de área feita pela pessoa (`RF-19`) no
  vínculo em que ela foi feita; chamados posteriores derivam de novo. A área é congelada
  **por chamado**, como `RF-19` já define — a correção não vira preferência permanente.
- **FR-10** — THE SYSTEM SHALL manter o mapeamento *campo → significado por request type*
  **fixo no código**, e SHALL remover do console de administração o campo de configuração do
  id de campo do solicitante.
  ⚠️ **Decisão do mantenedor em 11/08/2026**, contrária ao Princípio VIII da constituição
  ("zero hardcode … campo customizado") e a `RNF-25`. Exige emenda da constituição e registro
  em `docs/DECISOES.md`; **custo aceito:** mudança de id do Jira passa a exigir deploy.
- **FR-11** — THE SYSTEM SHALL NOT persistir o cargo da pessoa vindo da fonte organizacional.
- **FR-12** — THE SYSTEM SHALL exibir os campos preenchidos automaticamente **na tela**, com
  indicação visível de que o valor veio do login, antes da confirmação.
  ⚠️ **`FR-12` e `FR-3` se tensionam.** O mantenedor pediu "somente leitura" (11/08/2026)
  **antes** de a questão do pedido para terceiros existir; somente leitura implica fixar na
  identidade, que é exatamente o que `FR-3` abandonou. Mantém-se **visível e editável**: é a
  única forma coerente com `FR-3`, e continua atendendo à intenção do pedido — a pessoa **vê**
  o que vai no chamado dela. Reverter para somente leitura exige responder antes se o tipo
  108 é usado para terceiros.
- **FR-13** — THE SYSTEM SHALL derivar a área da fonte organizacional e SHALL usar
  `areas_por_email` como **fallback** quando a fonte não resolver, preservando o
  comportamento atual de instalações sem a credencial nova.

## 7. Non-Functional Requirements

- **Performance:** a derivação de área não pode acrescentar uma ida de rede por chamado
  aberto no caminho quente. `RNF-12` continua valendo; o teto de `RNF-36` (idas ao banco)
  não pode regredir.
- **Security / Privacy:** a fonte organizacional exige uma credencial **nova**, que seria a
  **quarta** do sistema — a constituição e `RNF-01` falam em "as três credenciais". Ela vive
  só em secret do GoDeploy, é lida em um lugar só (`contexto.ts`) e nunca aparece em log,
  resposta ou bundle. A base é uma lista de ~440 pessoas da empresa: só o registro da
  **própria** pessoa é lido por requisição, e nada além de nome/área é persistido.
- **Reliability / Availability:** `RNF-18` — indisponibilidade da fonte degrada, nunca
  bloqueia. Nenhum caminho novo pode classificar essa falha como definitiva (`RNF-17`).
- **Accessibility / i18n:** campo preenchido automaticamente precisa ser perceptível a leitor
  de tela e não pode parecer um campo vazio obrigatório.
  [NEEDS CLARIFICATION: os campos preenchidos aparecem na tela (somente leitura) ou não
  aparecem?]
- **Observability:** `RF-58` — a derivação de área e a decisão de preencher (ou não) cada
  campo entram na auditoria, com o motivo.

## 8. Edge Cases & Error Conditions

- ⚠️ **O tipo 108 pode não ser sobre quem abre.** Os campos são *"Nome do Colaborador"*,
  *"E-mail"*, *"Cargo/Função que exercerá dentro do time"* e *"Email da pessoa referência
  para copiar permissões"* — a forma de um pedido de acesso **para outra pessoa** (uma
  liderança pedindo para quem está entrando). Preencher com quem está logado estaria errado
  nesse caso, silenciosamente.
  Resolvido por desenho em `FR-3` (pré-preenchido e editável), porque a pergunta segue sem
  resposta e essa é a única forma correta nas duas leituras.
- 🚨 **"Ignorar o cargo" não pode virar "omitir o campo".** `customfield_10092` mediu
  `obrigatorio: true` no tipo 108 (11/08/2026): um chamado desse tipo criado sem ele é
  recusado com **400**, que este projeto classifica como **definitivo** — a submissão vira
  `falha` e **nunca** é reprocessada, ou seja, o chamado da pessoa se perde. O que a spec faz
  é **não preencher automaticamente**; o campo continua sendo perguntado pelo formulário
  dinâmico de `RF-27`.
- Pessoa com e-mail cadastrado na fonte diferente do e-mail do login corporativo → não
  resolve; cai em `SC-6`.
- Área resolvida cujo nome não existe no vocabulário do Jira (medido: `RPA`) — inócuo nesta
  spec porque a área não é enviada, mas é a razão de `FR-7` estar escrito.
- Chamado aberto pelo caminho do agente e pelo caminho do formulário devem produzir o mesmo
  resultado; um dos dois preenchendo e o outro não seria divergência silenciosa.
- Fonte organizacional lenta não pode transformar a abertura em timeout.

## 9. Success Criteria (measurable)

- **ScC-1** — Num chamado do tipo 108 aberto pelo app, os campos de nome e e-mail chegam ao
  Jira iguais aos da sessão, verificado lendo o chamado de volta.
- **ScC-2** — Teste de burla: corpo com nome/e-mail de outra pessoa não altera o que é
  gravado (mesma família dos testes de `RF-30`).
- **ScC-3** — Teste estrutural: nenhum caminho aplica um id de campo a um request type que
  não o mapeou.
- **ScC-4** — Teste estrutural: a área não aparece em nenhum payload enviado à Atlassian.
- **ScC-5** — Com a fonte organizacional derrubada no dublê, 100% das aberturas continuam
  sendo bem-sucedidas, com área ausente e auditoria registrando o motivo.
- **ScC-6** — A contagem de idas de rede por abertura não aumenta em relação à baseline de
  `tests/latencia.test.ts`.

## 10. Open Questions

- [x] **O tipo 108 é usado para pedir acesso para terceiros?** — *sem resposta, e resolvida
      por desenho.* O mantenedor não sabe o que o tipo 108 significa na prática. `FR-3` adota
      **pré-preenchido e editável**, que é correto sob as duas leituras. ⚠️ Continua valendo a
      pena perguntar ao admin do Atlassian: se a resposta for "só para si mesmo", `FR-3` pode
      endurecer para valor fixo e ganhar de volta a garantia de servidor.
- [x] **`FR-10` — fixo no código?** — *sim*, decisão do mantenedor em 11/08/2026. Exige emenda
      do Princípio VIII e registro em `docs/DECISOES.md`, feitos no mesmo PR.
- [x] **`FR-9` — a correção da pessoa vence para sempre?** — *não*: vale no vínculo em que foi
      feita, como `RF-19` já define.
- [x] **Os campos aparecem na tela?** — *sim, visíveis*. ⚠️ **Editáveis**, não somente leitura
      — ver a tensão registrada em `FR-12`.
- [ ] [NEEDS CLARIFICATION: quem é o dono da credencial da fonte organizacional no atlas e
      qual a política de rotação? A que existe hoje pertence a outro app. **Não bloqueia
      código:** ausência de credencial cai em `SC-5` (fail-open), mas bloqueia o go-live da
      derivação de área.]
- [x] **A derivação substitui `areas_por_email`?** — *não*: fonte primeiro, `areas_por_email`
      como fallback (`FR-13`).
- [ ] [NEEDS CLARIFICATION: o `Setor Gocase` (`customfield_10090`) está publicado em algum
      formulário de portal? Não está nos 7 tipos medidos. **Não bloqueia** — a área não é
      enviada nesta spec —, mas é o que destrava o trabalho futuro.]

## 11. Out of Scope (defer)

- Enviar `Setor Gocase` ao Jira — depende de o campo ser publicado num formulário do portal.
- Preenchimento automático de cargo.
- Usar a fonte organizacional para qualquer outra coisa (liderança, aprovação, hierarquia).

---
## Requirement Completeness — checklist (gate antes do /plan)
- [x] Nenhum `[NEEDS CLARIFICATION]` **bloqueante** — 2 pendentes, ambos não-bloqueantes
      (dono da credencial · publicação do `Setor Gocase` num formulário)
- [x] Todo FR é testável e não-ambíguo
- [x] Todo FR mapeia a pelo menos um Scenario
- [x] Success Criteria são mensuráveis
- [x] Non-Goals / Out of Scope explícitos
- [x] Nenhum detalhe de implementação (HOW) vazou para a spec
