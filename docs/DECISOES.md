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

### D-03 · Repositório: `while-kaique/goatlas` por ora
**Data:** 03/08/2026 · **Quem:** Kaique · **Status:** provisória

Os requisitos pedem o repo na "organização de RPA no GitHub". A conta autenticada
(`while-kaique`, token com escopo `read:org`) **não pertence a nenhuma organização**
— e `godocs-main`, o app irmão, também vive na conta pessoal. O repo nasce em
`while-kaique/goatlas`.

**Se a org existir**, transferir depois é uma operação só
(`gh api -X POST repos/while-kaique/goatlas/transfer -f new_owner=<org>`); o remote
local se ajusta com `git remote set-url`. Nada no código depende disso.

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
| Q6 | Qual API de IA — existe proxy corporativo contratado? Qual a política de retenção do provedor? | João | Toda a M2. **RNF-34** (conteúdo interno sai para IA externa) |
| Q7 | Quais domínios de e-mail além de `@gocase.com` são válidos? | João | RF-01, RF-05 (allowlist de domínio no servidor) |
| Q8 | Qual o custo unitário real por produto Atlassian hoje? | João / financeiro | RF-53 (custo mensal e assentos ociosos) |
| Q9 | Como comunicar o SLA de 24h às áreas que hoje têm retorno em 2h30 sem soar como piora? | João + Produto | Não bloqueia código; bloqueia **rollout** (R-05) |
| Q10 | O time de tech está ciente de que o reporter dos chamados vai mudar? | João | Não bloqueia código; bloqueia **rollout** (R-03) |
| Q11 | Google Chat, e-mail ou ambos na v1 de notificações? | João | RF-45 (Fase 3) |
| Q12 | ~~O GoDeploy já oferece SSO Google pronto?~~ | Kaique | **Respondida — ver D-02** |
| Q13 | Quais 1–2 áreas entram no piloto? | João | Fase 4 (sugestão do documento: CX + Produção) |
