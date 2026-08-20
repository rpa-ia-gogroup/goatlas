---
feature: "rederivacao-que-nao-regride"
spec: "./spec.md"
plan: "./plan.md"
status: in-progress
created: "2026-08-20"
---

# Tasks: A rederivação que não regride

Ordem: teste antes do código. Cada tarefa rastreia a um FR da spec.

## Phase 1 — os testes (vermelho)

- [x] **T-1201** — Criar `tests/spec012-rederivacao-que-nao-regride.test.ts` com o caso
      medido: conversa com verificações concluídas, extração do turno 1 devolvendo proposta
      e a do turno 2 devolvendo `pronto: false`. Afirma que a proposta vigente **é
      atualizada**. _Requirements: FR-1, SC-1_
- [x] **T-1202** — Caso afirmando que `extrairProposta` recebeu `cartaoVigente: true`
      quando havia proposta vigente, e **não** recebeu quando não havia — lendo
      `ClienteIAFake.extracoesRecebidas`, nunca o que o fake devolveu (`D-47`).
      _Requirements: FR-1, SC-2_
- [x] **T-1203** — Caso de contrato sobre o **cliente real**: com `cartaoVigente`, o corpo
      entregue ao `fetchImpl` tem a instrução no fim da mensagem `user`, e o `system`
      continua sendo só `PROMPT_EXTRACAO` (`D-76`). _Requirements: FR-1, FR-5_
- [x] **T-1204** — Casos de `atualizacaoDoCartao`: `'nao_conseguiu'` (sem proposta, com
      vigente) · `'sem_mudanca'` (rederivou, `alterados: []`) · `'atualizado'` ·
      `'nao_havia'` (turno sem rederivação e sem cartão). _Requirements: FR-2, FR-3, SC-3,
      SC-4_
- [x] **T-1205** — Casos de tela (`renderToStaticMarkup`): `'nao_conseguiu'` desenha a
      frase de aviso; `'sem_mudanca'` e `'nao_havia'` não desenham nada.
      _Requirements: FR-2, FR-3, SC-3, SC-4_
- [x] **T-1206** — Caso estrutural sobre `montarPromptAgente`: contém a proibição de pedir
      e-mail/login/nome/área e não cita nome de campo do Jira. _Requirements: FR-4, SC-5_
- [x] **T-1207** — Casos de burla, com `cartaoVigente` ligado: bloqueio pendente descarta a
      proposta na gravação (`RN-07`) · assunto fora da allowlist descarta a proposta inteira
      (`RF-28`) · verificações incompletas não rederivam (`RF-08`) · criar continua exigindo
      confirmação (`RF-17`). _Requirements: FR-6, SC-7_
- [x] **T-1208** — Caso afirmando que `proposta_rederivada` registra o modo da extração e
      que `ia_extracao_recusada` continua distinguível. _Requirements: FR-7, SC-7_

## Phase 2 — o servidor

- [x] **T-1210** — `ParametrosExtracao.cartaoVigente` em `src/lib/ia/tipos.ts`.
      _Requirements: FR-1_
- [x] **T-1211** — `INSTRUCAO_ATUALIZAR_CARTAO` em `src/lib/ia/prompts.ts`, irmã de
      `INSTRUCAO_FECHAR_AGORA`, com o comentário dizendo por que não é a mesma constante e
      por que vai no fim da mensagem do usuário. _Requirements: FR-1, FR-5_
- [x] **T-1212** — `src/lib/ia/cliente.ts`: seleção da instrução com precedência declarada
      (botão ganha) e `aceitarNaoPronto` para os dois modos. _Requirements: FR-1, FR-6_
- [x] **T-1213** — `src/lib/agent/orquestrador.ts`: passar `cartaoVigente` quando houver
      proposta vigente e não for pedido de botão. _Requirements: FR-1_
- [x] **T-1214** — `atualizacaoDoCartao` em `Rederivacao`/`TurnoResultado`, com
      `'nao_havia'` no `SEM_REDERIVACAO` e o discriminante derivado no mesmo lugar que
      produz `alterados`. _Requirements: FR-2, FR-3_
- [x] **T-1215** — Modo da extração no `dados` do evento `proposta_rederivada`.
      _Requirements: FR-7_
- [x] **T-1216** — `negociacaoNaResposta` expõe `atualizacaoDoCartao`.
      _Requirements: FR-2, FR-3_
- [x] **T-1217** — Parágrafo de `FR-4` em `montarPromptAgente`. _Requirements: FR-4_

## Phase 3 — a tela

- [x] **T-1220** — `src/app/api.ts`: o campo opcional no tipo da resposta do turno.
      _Requirements: FR-2_
- [x] **T-1221** — `src/app/telas.tsx`: `atualizacaoDoCartao` no estado `negociacao` e o
      componente `AvisoCartaoNaoAtualizado`, irmão de `RecusasDeAjuste`.
      _Requirements: FR-2, FR-3_
- [x] **T-1222** — `src/app/estilos.css`: estilo do aviso usando token existente (a
      varredura de `tokens-de-css-existem.test.ts` reprova token inventado), estado dito em
      palavras e não só por cor. _Requirements: FR-2, RNF-28_

## Phase 4 — documentação e verificação

- [x] **T-1230** — `docs/DECISOES.md`: `D-78` com o caso medido, a reprodução na staging, a
      razão de duas flags e o que **não** foi mexido (gate do botão, critério do primeiro
      cartão). _Requirements: Princípio XIII_
- [x] **T-1231** — `CLAUDE.md`: linha em "Padrões de código que sustentam as travas"
      (cartão vigente não reavalia prontidão; "não mudou" ≠ "não consegui") e atualização do
      estado do projeto. _Requirements: Princípio XIII_
- [x] **T-1232** — `npm run test` · `npm run typecheck` · `npm run build` limpos.
- [x] **T-1233** — Staging `3936ca2d`: repetir as duas mensagens medidas e conferir
      `ScC-1`/`ScC-2`/`ScC-3` no Investigador e na tela. _Requirements: ScC-1, ScC-2, ScC-3_
- [ ] **T-1234** — Produção só depois de `T-1233` verde (regra 10).
