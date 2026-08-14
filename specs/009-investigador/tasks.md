---
feature: "investigador"
id: "009"
---

# Tarefas — Investigador

## Fase 1 — fundação

- [x] **T-901** Tabelas `investigador_requisicoes` e `investigador_eventos` em `TABELAS`,
      com os dois índices. _Requirements: FR-1, FR-5_
- [x] **T-902** `investigador/tipos.ts` — união fechada de tipo e origem de evento.
      _Requirements: FR-5, FR-10b_
- [x] **T-903** `investigador/coleta.ts` — acumular, truncar com marca, redigir, gravar em
      lote. _Requirements: FR-3, FR-4, FR-10c_
- [x] **T-904** `investigador/registro.ts` — `InvestigadorBanco` e `InvestigadorDesligado`.
      _Requirements: FR-18, FR-20_
- [x] **T-905** Config `investigador_ligado` (default `true`) e `investigador_retencao_dias`
      (default 30), com família em `config/validar.ts` e **sem** campo no console.
      _Requirements: FR-18, FR-19_

## Fase 2 — coleta

- [x] **T-910** Envelope em `tratarRequisicao`: abre a coleta, mede, lê os corpos com os
      dois gates de tipo/tamanho, fecha no `finally`. _Requirements: FR-1, FR-2, FR-3_
- [x] **T-911** `observador` nos cinco transportes externos. _Requirements: FR-10b_
- [x] **T-912** Eventos do turno no orquestrador (mensagem, ida ao modelo, tools, bloqueio,
      resposta final). _Requirements: FR-5_
- [x] **T-913** `respostaBruta` opcional em `ResultadoExtracao` + evento `ia_extracao` com o
      motivo da recusa. _Requirements: FR-6_
- [x] **T-914** `proposta_rederivada`, `proposta_editada`, `override`.
      _Requirements: FR-7_
- [x] **T-915** `payload_final` e `desfecho_criacao` em `tickets/servico.ts`.
      _Requirements: FR-9_
- [x] **T-916** Anexo: `declaracao_anexo`, `anexo_recebido`, `anexo_analisado`.
      _Requirements: FR-10_
- [x] **T-917** `POST /api/investigador/formulario` + a chamada da tela.
      ⚠️ **Campo de ESCOLHA apenas** (assunto, prioridade): tecla a tecla custaria uma
      requisição por rajada de digitação, e o texto chega inteiro por `confirmacao` e
      `payload_final`. _Requirements: FR-8_
- [x] **T-918** Expurgo no cron do outbox. _Requirements: FR-19, SC-10_

## Fase 3 — leitura e tela

- [x] **T-920** `investigador/leitura.ts` — sessões, detalhe, requisições, resumo; tudo
      agregado. _Requirements: FR-12, FR-15, FR-17, SC-8_
- [x] **T-921** Rotas `/api/investigador/*` com gate de admin. _Requirements: FR-11_
- [x] **T-922** Aba `Investigador` (App.tsx + rotas.ts + api.ts). _Requirements: FR-11_
- [x] **T-923** Lista de sessões com filtros. _Requirements: FR-12, FR-13_
- [x] **T-924** Linha do tempo do detalhe, expansível e copiável.
      _Requirements: FR-14, FR-16_
- [x] **T-925** Logs de API (da sessão e global) + resumo. _Requirements: FR-15, FR-17_
- [x] **T-926** `investigador.css` seguindo a identidade visual.

## Fase 4 — provas

- [x] **T-930** `tests/009-investigador-coleta.test.ts` — truncamento com marca, redação de
      credencial, corpo binário fora, lote em uma ida. _SC-3, SC-4, SC-8b, SC-9_
- [x] **T-931** `tests/009-investigador-turno.test.ts` — gate de admin, sessões sem N+1,
      desligado não escreve, e o `tipo` do evento fixado no servidor.
      _SC-5, SC-6, SC-7, SC-8_
- [x] **T-932** `tests/009-investigador-turno.test.ts` — o caso de 14/08: seis mensagens sem
      proposta, e o registro dizendo qual dos motivos. _SC-1, SC-2_
- [x] **T-932b** `tests/009-investigador-tela.test.ts` — a tela **diz** o motivo em português,
      e some quando deixa de valer. Existe por `D-47` (*servidor pronto, tela ausente*).
- [x] **T-933** Expurgo não toca `auditoria`/`vinculos`/`mensagens`. _SC-10_
- [x] **T-934** `npm run test` · `typecheck` · `build` limpos; docs no mesmo PR.
