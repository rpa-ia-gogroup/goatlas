---
# Especificação de Feature — gerada por /specify. WHAT/WHY apenas.
feature: "investigador"
id: "009"
status: clarified
created: "2026-08-14"
spec_version: 1
---

# Spec: O Investigador — o que aconteceu naquela conversa

> **Regra de ouro:** esta spec descreve **WHAT** e **WHY**. O **HOW** vai no `plan.md`.

## 1. Problem & Why

**Em 14/08/2026 uma pessoa usou o app em produção por 70 minutos, mandou seis mensagens
ao agente, nunca viu o cartão de confirmação, tentou o formulário direto e desistiu sem
abrir chamado.** Perguntado o motivo, o projeto inteiro não tem resposta. Foi o que se
conseguiu apurar, e é tudo:

| Fonte | O que ela sabe | O que ela **não** sabe |
|---|---|---|
| `getAppLogs` da plataforma | método e caminho de cada requisição | status, duração, corpo, erro — **nada** disso é registrado para `/api/*` |
| `auditoria` (`RF-58`) | que houve `mensagem_enviada` ×6 | o texto, a decisão da IA, por que não houve proposta — e é **de propósito**: `RN-10`/`RNF-30` mantêm conteúdo pessoal fora dali |
| `mensagens` | o histórico da conversa | por que a extração devolveu `null`; o que o modelo respondeu de fato |
| a tela | nada — a pessoa já foi embora | — |

O caminho mais provável do defeito ilustra o buraco: `interpretarProposta` recusa a
proposta inteira quando `pronto !== true`, quando o `tipoChamadoId` está fora da allowlist,
quando o título tem menos de 5 caracteres. **As quatro recusas são a mesma coisa na tela e
no banco: silêncio.** O agente continua perguntando — que é o comportamento certo, decidido
em `RF-28` — e ninguém consegue distinguir *"a IA não achou que já dava"* de *"a IA
respondeu com um id que o admin não liberou"* de *"a chamada ao provedor falhou"*.

O mesmo vale para as outras três superfícies que a pessoa toca:

- **o que ela manda** — texto e anexo estão em `mensagens`/`analises_anexo`, mas sem o
  turno em volta (o que o servidor permitiu, o que o modelo pediu, o que foi recusado);
- **o que o formulário vira** — a edição do cartão (`PUT /proposta`) e os campos dinâmicos
  não deixam **nenhum** registro do antes → depois;
- **o que sai daqui para o Jira** — o payload final é persistido no outbox e some com a
  submissão; não há como responder "o chamado nasceu com quais valores?" depois do fato.

Custo de não fazer: todo defeito de produto que não estoure exceção é invisível, e a única
forma de investigar continua sendo pedir para a pessoa reproduzir. O `CLAUDE.md` já registra
a lição em outra forma — *teste verde não é cobertura*, `D-47`; *o que só o app real
revelou*, 07/08 — e a resposta dele até aqui foi sempre "medir na staging". Isso não alcança
o que acontece com quem usa em produção.

## 2. Goals / Non-Goals

**Goals**

- Uma aba **Investigador**, só para admin, que responde *"o que aconteceu com esta pessoa?"*
  sem ninguém abrir o banco.
- **Quatro fontes numa linha do tempo só**, porque a pergunta é sempre sobre a ordem em que
  as coisas aconteceram: o que a pessoa mandou · o que a IA decidiu · o que o formulário
  virou · o que foi entregue ao Jira.
- **Logs de API completos** — método, caminho, status, duração, corpo de entrada e de saída
  — com filtro por erro, por endpoint e por lentidão.
- Registro de **decisão que não deu em nada**: extração recusada, tool recusada, ajuste
  recusado, bloqueio. É o que falta hoje.
- Custo previsível: um `INSERT` por requisição `/api/*` e um por evento — sem laço, sem
  N+1 na leitura.

**Non-Goals**

- **Não** é auditoria. `auditoria` continua sendo o registro append-only de longa duração
  (`RF-58`, piso de 180 dias em `D-17`), sem conteúdo pessoal. O Investigador é o oposto em
  todos os eixos: carrega conteúdo, tem retenção curta e existe para depurar.
- **Não** grava tecla digitada. O que se registra é mudança **observável pelo servidor** e
  a mudança de campo que a tela declara — nunca um fluxo contínuo de teclas.
- **Não** substitui `RF-42` (mapa de lacunas) nem `RF-55` (painel): aqueles contam
  pessoas e agregados; este mostra **uma** pessoa, com nome, para investigar um caso.
- **Não** expõe nada a quem não é admin, e não muda uma linha do que o usuário comum vê.

## 3. Functional Requirements

### 3.1 O que é registrado

- **FR-1** — Toda requisição `/api/*` gera **um** registro com: quem (e-mail), método,
  caminho, status HTTP, duração em ms, tamanho de entrada e de saída, corpo de entrada e
  corpo de saída (quando forem JSON e couberem no teto), e a mensagem de erro quando houver.
  _Requirements: RNF-36_
- **FR-2** — Corpo que **não** é JSON (upload de arquivo, proxy de anexo, CSV) **não** tem
  o conteúdo registrado; o registro guarda só o tamanho e o tipo. Nunca os bytes.
  _Requirements: RNF-01_
- **FR-3** — Corpo maior que o teto é **truncado com marca visível** (`…[truncado, N
  bytes]`), nunca cortado em silêncio.
- **FR-4** — Nenhum valor de credencial entra no registro, em nenhum dos dois corpos, e a
  redação acontece **num lugar só**, reaproveitando a de `audit/`.
  _Requirements: RNF-01, RNF-30_
- **FR-5** — Cada turno da conversa registra, como eventos separados e ordenados: a
  **mensagem da pessoa** · a **ida ao modelo** (mensagens enviadas, tools que o servidor
  permitiu, texto que voltou, tools propostas, custo, duração) · cada **tool executada**
  (argumentos e o que foi devolvido ao modelo) · cada **tool recusada** · o **bloqueio**
  (regra, motivo, evidência) · a **resposta final** exibida, dizendo se o texto do modelo
  foi descartado pelo servidor.
  _Requirements: RF-08, RF-12, RF-13, RNF-18_
- **FR-6** — A **extração da proposta** registra a resposta **bruta** do modelo quando a
  proposta é recusada, e o motivo da recusa. Sem isso, `pronto: false`, id fora da
  allowlist e falha de rede são indistinguíveis.
  _Requirements: RF-15, RF-28_
- **FR-7** — A **rederivação** registra o que mudou (`alterados`), os campos sugeridos e as
  recusas de ajuste; a **edição pela pessoa** (`PUT /proposta`) registra antes → depois.
  _Requirements: RF-16, RN-13, FR-8 da 008_
- **FR-8** — O **formulário** registra mudança de campo declarada pela tela (assunto
  escolhido, campo preenchido, prioridade trocada), com valor anterior e novo.
- **FR-9** — A **entrega ao Jira** registra o payload final exatamente como foi entregue —
  tipo, título, descrição, prioridade traduzida, campos dinâmicos já no formato do Jira,
  chave de idempotência, declaração de anexo — e o desfecho (chave do chamado, estado da
  submissão, ou o erro).
  _Requirements: RF-24, RNF-17, D-39, D-48_
- **FR-10** — Anexo registra o que a leitura entendeu: nome, estado da análise e a descrição
  derivada — inclusive a `irrelevante`, que a tela do usuário não mostra (`FR-5b` da 007).
- **FR-10b** — **Toda chamada que sai deste app** é registrada com destino, método, status,
  duração e o erro classificado: Jira/Confluence, Organizations API, provedor de IA,
  TeamGuide e o OCR Worker. É o requisito do *ponto de ruptura*: sem ele, "o app está
  lento" e "a Atlassian está recusando" são a mesma linha em branco. O registro guarda
  **caminho**, nunca a query string inteira, e nunca um cabeçalho.
  _Requirements: RNF-01, RNF-15, R-02_
- **FR-10c** — O registro de uma requisição é **acumulado em memória e gravado de uma vez**,
  ao fim dela. Um `INSERT` por evento faria uma rodada de polling com 100 chamados custar
  centenas de idas ao banco — o custo que `RNF-36` existe para conter, na versão que
  ninguém veria até a conta chegar.
  _Requirements: RNF-36_

### 3.2 A tela

- **FR-11** — A aba **Investigador** aparece só para admin, e o gate real é do **servidor**
  em cada rota (esconder no cliente é conveniência, não segurança).
  _Requirements: RF-56_
- **FR-12** — A lista mostra uma linha por **sessão** (conversa, e submissão de formulário
  sem conversa), com: pessoa, quando começou, última atividade, estado, nº de mensagens,
  se teve bloqueio, se teve proposta, se abriu chamado, custo de IA, nº de erros de API.
- **FR-13** — A lista tem os filtros que respondem às perguntas caras: **sem proposta** ·
  **com bloqueio** · **com erro de API** · **abandonada** (sem chamado) · por pessoa.
- **FR-14** — O detalhe é uma **linha do tempo única**, em ordem cronológica, com as quatro
  origens visualmente distintas (pessoa · IA · servidor · Jira), cada item expansível para
  o JSON completo.
- **FR-15** — O detalhe tem uma aba de **logs de API daquela sessão** e o app tem uma visão
  **global** de logs de API, com filtro por status, endpoint e texto.
- **FR-16** — Todo JSON exibido é **copiável em um clique**.
- **FR-17** — Um resumo no topo: total de chamadas, taxa de erro, duração média, chamadas
  lentas, e por endpoint.

### 3.3 Governança do próprio registro

- **FR-18** — O registro pode ser **desligado** por configuração, sem deploy. Ligado é o
  default: um registro de depuração que nasce desligado não existe no dia em que alguém
  precisa dele.
- **FR-19** — A retenção é **curta e configurável** (default 30 dias), e o expurgo roda
  junto do cron do outbox — nunca no cron de retenção, que responde 403 hoje e que não
  apaga nada com política `null` (`D-20`, T-415).
  _Requirements: RNF-33_
- **FR-20** — Falha ao registrar **nunca** derruba a requisição que estava sendo servida.
  Investigação é acessório; perder o chamado de alguém por causa dela seria trocar o
  problema por um pior.
  _Requirements: RNF-18_

## 4. Success Criteria

- **SC-1** — Dado o caso de 14/08 (seis mensagens, nenhum cartão), o Investigador diz em
  qual dos quatro motivos a proposta não nasceu, sem ninguém abrir o banco.
- **SC-2** — Uma conversa completa até o chamado aberto produz uma linha do tempo em que se
  lê, em ordem: mensagem → tools → proposta → edição → confirmação → payload → `issueKey`.
- **SC-3** — Upload de arquivo de 5 MB não coloca 5 MB no registro.
- **SC-4** — Uma credencial plantada num corpo de requisição não aparece no registro.
- **SC-5** — Com o registro **desligado**, nenhuma linha nova é escrita e o app funciona
  igual.
- **SC-6** — Uma falha do registro (banco recusando o `INSERT`) não muda o status nem o
  corpo da resposta da rota instrumentada.
- **SC-7** — Um colaborador **não admin** que chame `/api/investigador/*` recebe recusa do
  servidor, mesmo sem a aba existir na tela dele.
- **SC-8** — A lista de sessões faz um número **constante** de consultas ao banco,
  independentemente de quantas sessões existem (a armadilha do N+1 que o godocs pagou).
- **SC-8b** — Uma requisição que gera 40 eventos grava tudo em **duas** idas ao banco (a
  linha da requisição e o lote de eventos), nunca em 41. Afirmado por contagem de chamadas,
  como `tests/latencia.test.ts` faz — nunca por relógio (`D-57`).
- **SC-8c** — Uma chamada à Atlassian que devolve 429 aparece no registro com o status e a
  duração, e a rodada de polling que a produziu aparece como a requisição que a contém.
- **SC-9** — Corpo truncado é reconhecível como truncado na tela.
- **SC-10** — O expurgo apaga o que passou da janela e **não** toca `auditoria`,
  `vinculos` nem `mensagens`.

## 5. Fora de escopo, e por quê

- **Exportar CSV/JSON do Investigador.** O CSV que existe (`governanca/csv.ts`) é para
  decisão de custo; aqui o dado é conteúdo pessoal, e um botão de exportar transforma uma
  tela com gate de admin num arquivo sem gate nenhum. Copiar o JSON de um item (FR-16)
  cobre o caso real de colar num chamado.
- **Registro em tempo real (stream).** O Worker não tem WebSocket (restrição da
  plataforma), e recarregar resolve.
- **Apagar uma sessão pela tela.** Escrita numa tabela de investigação é a forma de perder
  a evidência que se foi buscar. Quem limpa é a retenção.
