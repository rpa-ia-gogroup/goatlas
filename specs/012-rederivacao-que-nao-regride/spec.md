---
feature: "rederivacao-que-nao-regride"
id: "012"
status: in-progress
created: "2026-08-20"
spec_version: 1
---

# Spec: A rederivação que não regride

> WHAT/WHY. O HOW vai no `plan.md`.

## 1. Problem & Why

Em **20/08/2026** uma pessoa entrou no atlas, pediu acesso a um sistema, explicou o
motivo em duas mensagens e foi embora **sem chamado** — com o cartão de confirmação
pronto na tela e `podeConfirmar: true` desde o primeiro turno. Ela estava a um clique.

O que aconteceu, medido no Investigador (sessão `7d909d36`) e **reproduzido na staging
com modelo real** (`16fc8d75`, as mesmas duas mensagens, resultado idêntico):

1. **Turno 1** — a extração devolveu proposta completa. Cartão na tela.
2. **Turno 2** — a pessoa contou *por que* precisa do acesso. A extração do mesmo turno
   devolveu `{"pronto": false, "titulo": "", "descricao": ""}`, foi recusada na
   interpretação, e o cartão **congelou na versão do turno 1** — sem o motivo que ela
   acabou de dar. `alterados: []`, nada na tela.
3. A prosa pediu *"qual e-mail/login deve ser usado como referência"* — dado que o app
   **já tem** (é a identidade do login corporativo, e vai carimbada na descrição) e que a
   própria extração descarta por regra.
4. Ela não respondeu e saiu.

O custo de não fazer: a conversa mais comum do app — *"quero acesso a X"* — pode ficar
presa em laço de perguntas com o chamado pronto embaixo. É o mesmo desfecho que `RF-81`
já pagou para evitar (70 minutos e seis mensagens sem cartão, 14/08), agora na versão
**com** cartão, onde o botão de escape nem aparece.

Três defeitos independentes, na ordem em que custam:

| # | Defeito |
|---|---|
| 1 | Cartão pronto volta a "não estou pronto" e apaga a última mensagem da pessoa |
| 2 | O agente pede dado de identificação que o app já tem e a extração ignora |
| 3 | "a IA não mudou nada" e "não consegui atualizar" são a mesma tela |

## 2. Goals / Non-Goals

**Goals**
- Depois que existe cartão, a mensagem seguinte da pessoa **entra** nele.
- Quando a atualização não acontece, isso é **dito** — nunca silêncio.
- O agente nunca pede o que já sabe sobre quem está falando com ele.

**Non-Goals (explicitamente fora de escopo)**
- **Não** mexer no gate de "≥ 4 mensagens" do botão `RF-81`. Ele não é a causa: com
  cartão na tela o botão não aparece por desenho, então baixar o limite não teria mudado
  este caso e devolveria ruído.
- **Não** afrouxar o critério de prontidão do **primeiro** cartão. Turno sem proposta
  vigente continua podendo concluir "ainda não dá para montar" — é o que evita cartão
  desenhado cedo demais.
- **Não** tocar latência, streaming, nem número de idas ao provedor (`RNF-12` está
  cortado, `D-72`).
- **Não** transformar recusa de ajuste em bloqueio: nada aqui impede a pessoa de abrir o
  chamado.

## 3. Users & Context

Colaborador da Gocase conversando na aba de chamados, **depois** de o cartão de
confirmação já existir (as duas verificações de `RF-08` rodaram). Vale para toda
conversa, e o caso que mais aparece é pedido de acesso — onde não existe "o que
aconteceu" nem "desde quando".

## 4. User Stories

- **US-1** — Como quem já vê o resumo do chamado na tela, quero que o que eu contar
  depois **apareça** nele, para não precisar repetir nem descobrir tarde que meu motivo
  foi ignorado.
- **US-2** — Como quem está pedindo ajuda, quero que o agente pare de me pedir meu
  e-mail/login, para não gastar mensagem com o que ele já sabe.
- **US-3** — Como quem vai confirmar um chamado, quero saber quando o resumo **não** foi
  atualizado, para conferir antes de abrir em vez de confiar num texto velho.
- **US-4** — Como quem investiga um caso perdido (admin), quero ver no registro que o
  turno rederivou em modo fechamento, para distinguir isso de uma recusa.

## 5. Scenarios (Given / When / Then)

- **SC-1** (US-1) — o caso medido
  - **Given** uma conversa com proposta vigente ("Solicitação de acesso ao Nexus")
  - **When** a pessoa manda uma mensagem com contexto novo (o motivo do acesso)
  - **Then** o cartão passa a refletir esse contexto, e o turno **não** termina sem
    proposta por o modelo não se declarar pronto.

- **SC-2** (US-1) — o primeiro cartão continua podendo esperar
  - **Given** uma conversa **sem** proposta vigente
  - **When** a conversa ainda não diz o que aconteceu
  - **Then** nenhum cartão é desenhado, e o registro diz por quê.

- **SC-3** (US-3) — recusa visível
  - **Given** uma conversa com proposta vigente
  - **When** a rederivação do turno não produz proposta utilizável
  - **Then** o cartão vigente permanece **e** a tela diz que a última mensagem não entrou
    no resumo, pedindo conferência antes de abrir.

- **SC-4** (US-3) — "não mudou" continua sendo "não mudou"
  - **Given** uma conversa com proposta vigente
  - **When** a rederivação roda e conclui que nada muda
  - **Then** a tela **não** avisa nada: as duas situações são distintas na resposta do
    turno.

- **SC-5** (US-2) — o agente não pede identificação
  - **Given** qualquer turno da conversa
  - **When** o agente precisa de mais informação para montar o chamado
  - **Then** o que ele pede é específico do caso (mensagem de erro, sistema, número), e
    **nunca** e-mail, login, nome ou área de quem está falando.

- **SC-6** (US-1) — fechar com lacuna é honesto
  - **Given** uma conversa com proposta vigente e um dado que ninguém informou
  - **When** o cartão é atualizado
  - **Then** a descrição registra o que ficou em aberto, sem inventar fato que ninguém
    disse.

- **SC-7** (US-4) — as travas continuam
  - **Given** uma conversa com proposta vigente
  - **When** a rederivação roda em modo fechamento
  - **Then** as duas verificações de `RF-08` continuam sendo pré-condição, bloqueio
    pendente continua descartando a proposta na gravação (`RN-07`), assunto fora da
    allowlist continua descartando a proposta inteira (`RF-28`), e criar o chamado
    continua exigindo a confirmação da pessoa (`RF-17`).

## 6. Functional Requirements (EARS)

- **FR-1** — WHILE existe proposta vigente na conversa, THE SYSTEM SHALL montar o cartão
  do turno com o que a conversa diz **agora**, sem exigir que o modelo se declare pronto.
  _Requirements: RF-15, RF-18, RF-81_
- **FR-2** — IF a rederivação de um turno não produzir proposta utilizável **e** já
  existir proposta vigente, THEN THE SYSTEM SHALL manter a vigente e informar, na
  superfície da conversa, que a última mensagem não entrou no resumo.
  _Requirements: RNF-18_
- **FR-3** — THE SYSTEM SHALL distinguir, na resposta do turno, "a rederivação rodou e
  nada mudou" de "a rederivação não produziu proposta" — as duas nunca chegam à tela como
  a mesma coisa. _Requirements: RF-18_
- **FR-4** — THE SYSTEM SHALL instruir o agente a **não** pedir dado de identificação do
  solicitante (e-mail, login, nome, área), porque eles vêm do login corporativo e do
  cadastro da empresa. _Requirements: RF-21, RNF-24_
- **FR-5** — WHERE a conversa não informou um dado que o chamado pediria, THE SYSTEM
  SHALL registrar essa lacuna na descrição do chamado em vez de adiar o cartão, e SHALL
  NOT inventar fato que ninguém disse. _Requirements: RF-81_
- **FR-6** — WHILE a rederivação roda em modo fechamento, THE SYSTEM SHALL manter
  intactas as travas de `RF-08`, `RN-07`, `RF-28` e `RF-17`.
  _Requirements: RF-08, RF-17, RF-28, RN-07_
- **FR-7** — WHEN um turno rederiva em modo fechamento por já existir cartão, THE SYSTEM
  SHALL deixar isso no registro do Investigador, distinguível de uma recusa.
  _Requirements: RNF-30_

## 7. Non-Functional Requirements

- **Reliability:** nenhuma mudança aumenta o número de idas ao provedor de IA por turno
  (`RNF-16`) — o mesmo turno continua com as mesmas chamadas.
- **Security / Privacy:** nenhum id interno, nome de campo do Jira ou valor de
  configuração entra em prompt ou tela (`RNF-30`).
- **Accessibility / i18n:** todo texto novo em português com acentuação; o aviso de
  `FR-2` não comunica estado só por cor.
- **Observability:** o registro do Investigador continua respondendo "por que este turno
  não fechou o chamado?" sem ambiguidade.

## 8. Edge Cases & Error Conditions

- Proposta vigente **e** bloqueio nascendo no mesmo turno: o bloqueio ganha, a proposta é
  descartada na gravação (`RN-07`) — o modo fechamento não muda isso.
- Assunto que o modelo escolhe fora da allowlist: a proposta inteira é descartada
  (`RF-28`), e isso não é "recusa de atualização" — é o pior caso já aceito em `RF-28`.
- Falha de leitura do schema do assunto: o fail-open de `D-27` continua; campos ficam de
  fora, o cartão não deixa de existir.
- Turno em que a pessoa manda **só** um anexo, sem texto: o cartão continua sendo
  rederivado, e a lacuna vira "Em aberto:" se nada novo entrou.
- Conversa que já tem cartão e a pessoa pede algo de outro assunto: `FR-16` da spec 008
  continua valendo (assunto mudou → campos vazios, sem recusa).
- Indisponibilidade do provedor de IA no turno: o cartão vigente permanece, e o caminho é
  o de `FR-2` — informar, nunca virar parede (`RNF-18`).

## 9. Success Criteria (measurable)

- **ScC-1** — Repetindo na staging, com modelo real, as **duas mensagens medidas**
  ("quero solicitar meu acesso ao nexus" e o motivo da integração), a descrição do cartão
  passa a conter o motivo — hoje ela fica em "O colaborador solicita acesso ao sistema
  Nexus." nos dois turnos.
- **ScC-2** — Naquela mesma conversa, o Investigador **não** registra
  `ia_extracao_recusada` no segundo turno.
- **ScC-3** — Nos turnos dessa conversa, nenhuma resposta do agente pede e-mail, login,
  nome ou área do solicitante.
- **ScC-4** — Forçando a rederivação a não produzir proposta com cartão vigente, a tela
  mostra o aviso de `FR-2`; e num turno em que a rederivação roda e nada muda, a tela
  **não** mostra nada.
- **ScC-5** — A suíte continua provando as travas: os testes de bypass de `RF-08`/`RF-17`
  seguem verdes, e existe caso afirmando que modo fechamento não os afrouxa.

## 10. Open Questions

Nenhuma. As três decisões que poderiam virar pergunta já estão resolvidas por decisão
registrada: identificação não vem da conversa (`RF-21`, e a regra já existe no prompt de
extração), fechar com lacuna em vez de adiar (`D-76`/`RF-81`), e o gate de mensagens do
botão fica como está (Non-Goals).

## 11. Out of Scope (defer)

- Rever o critério de prontidão do primeiro cartão para pedidos (hoje o gabarito é de
  incidente: "o que aconteceu, desde quando, qual sistema"). Só entra se a medição de
  `ScC-1` mostrar que o **primeiro** turno também trava.
- Auditar em código que o agente não pediu identificação (como `agent/prosa-sem-prazo.ts`
  faz com prazo). Fica para depois de medir se a instrução de `FR-4` basta.

---
## Requirement Completeness — checklist (gate antes do /plan)
- [x] Nenhum `[NEEDS CLARIFICATION]` pendente
- [x] Todo FR é testável e não-ambíguo
- [x] Todo FR mapeia a pelo menos um Scenario (FR-1→SC-1/SC-2, FR-2→SC-3, FR-3→SC-4,
      FR-4→SC-5, FR-5→SC-6, FR-6→SC-7, FR-7→SC-7)
- [x] Success Criteria são mensuráveis
- [x] Non-Goals / Out of Scope explícitos
- [x] Nenhum detalhe de implementação (HOW) vazou para a spec
