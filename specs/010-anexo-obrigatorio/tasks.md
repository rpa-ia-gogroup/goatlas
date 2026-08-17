---
# Tarefas — geradas por /tasks a partir do plan.md.
feature: "anexo-obrigatorio"
plan: "./plan.md"
status: draft
created: "2026-08-17"
---

# Tasks: o anexo dentro da criação

> Numeração `T-10xx` (a spec 009 chegou a `T-934`). Ordem = `plan.md` §2.
>
> 🚨 **A regra de ouro, repetida em cada fase:** a asserção é sobre **o que atravessou** — o
> corpo entregue ao `fetchImpl`, a resposta HTTP, o retorno da função pura. Nunca sobre o que
> o fake devolveu. `D-38`, `D-39`, `D-43`, `D-47` e `D-70` passaram todos por suítes verdes.
>
> ⚠️ **Worktree obrigatório** a partir da Phase 2: branch `010-anexo-obrigatorio`, junção de
> `node_modules` para a árvore principal.
>
> 🚫 **Phase 5 não começa antes de `T-1001` responder.** Está escrito aqui porque plano que
> depende de medição e não trava a ordem vira código escrito na esperança.

## Resultado do `/analyze` (17/08/2026)

Cobertura conferida `spec` → `plan` → `tasks`:

- **8 `FR`, 8 cobertos.** **11 cenários, 11 cobertos** — depois de `F-1`.
- **`F-1` (corrigido aqui):** `ScB-02` (o `temporaryAttachmentId` nunca chega ao navegador)
  estava na spec **sem tarefa nenhuma**. É o cenário mais fácil de perder nesta feature, porque
  o id muda de momento de nascimento — virou `T-1030`.
- **`F-2` (aceito, não corrigido):** duas perguntas continuam abertas (`M-1`, `M-2`) e isso
  normalmente **bloqueia** `/implement` (regra 12). Aqui elas são a **Phase 0** e `T-1002` é o
  gate explícito: nada da Phase 5 começa antes da resposta. O bloqueio existe, escrito.
- **`F-3` (nota):** `plan.md` §1.5 cria uma bifurcação de comportamento. Ela está declarada,
  com a alternativa e o motivo da recusa — e `T-1015` a põe em **um arquivo só de teste**, para
  quem mexer num lado ver o outro.

## Phase 0 — Medir antes de desenhar (`plan.md` §0)

- [x] **T-1000** Rota de diagnóstico só-admin que tenta uma criação e devolve o **corpo do
      erro** da Atlassian, redigido por `corpoSeguro` e truncado. Título com
      `[TESTE goatlas - ignorar]`. ⚠️ Tentativa que falha não cria nada; a que der certo cria
      chamado **real** — e alguém do time de tech precisa apagá-lo. _Requirements: M-1_
- [x] **T-1001** Medir na staging: (a) tipo `134` **sem** anexo → ler o corpo do 400 e
      confirmar que ele nomeia o campo de anexo · (b) tipo `134` **com**
      `requestFieldValues.attachment = [temporaryAttachmentId]` → 201 ou 400. Registrar os
      dois corpos em `docs/DECISOES.md`. _Requirements: M-1, M-2_
- [x] **T-1002** Escrever o desfecho de `M-2` na `spec.md` (§8 deixa de ser
      `[NEEDS CLARIFICATION]`) e, se for "não aceita e a API exige", **parar aqui** e converter
      o restante em pedido ao time de tech. _Requirements: M-2_

## Phase 1 — Documento antes de código

- [ ] **T-1003** `docs/REQUISITOS.md`: `RF-78` (guardar o conteúdo), `RF-79` (criação só com
      arquivo onde o schema exige), `RF-80` (o cartão diz antes) e `RN-14` (a exigência vem do
      schema). Emendar `RF-25` e `RF-61` com o momento em que o id temporário nasce.
      _Requirements: FR-1, FR-2, FR-3, FR-4, FR-5_
- [ ] **T-1004** `docs/DECISOES.md`: `D-75` — a bifurcação de ordem de criação (`plan.md` §1.5),
      por que `D-26` continua valendo nos outros nove, e o resultado de `T-1001`.
      _Requirements: FR-3_

## Phase 2 — Os bytes no banco

- [x] **T-1005** [teste] `anexos-conteudo.test.ts`: grava 8 MB, lê de volta, confere **SHA-256**;
      fatia de 512 kB; leitura de conversa alheia devolve nada (e-mail no `WHERE`).
      _Requirements: FR-1, ScB-03_
- [x] **T-1006** `db/schema.ts`: tabela `anexos_conteudo` (`plan.md` §1.1) — **uma linha por
      `INSERT`** (`D-73`). _Requirements: FR-1_
- [x] **T-1007** `tickets/anexos-conteudo.ts`: repositório com `guardar`, `ler`, `apagar`.
      Base64, fatia de 512 kB, e nenhum método sem e-mail (`RF-30`). _Requirements: FR-1_

## Phase 3 — A trava (servidor primeiro)

- [x] **T-1008** [teste] `anexo-obrigatorio.test.ts`: `anexoObrigatorio` verdadeiro para schema
      com campo de anexo `required`, falso para opcional, **falso** para
      `conhecido: false` (`D-27`), e **nada de `fieldId`** (teste estrutural, como `ScC-4`).
      _Requirements: RN-14_
- [x] **T-1009** `tickets/declaracao-anexo.ts`: `anexoObrigatorio(schema)`. _Requirements: RN-14_
- [x] **T-1010** [teste de burla] `ScB-01`: `POST /confirmar` com assunto que exige e zero
      arquivos → recusa **antes** de qualquer chamada (o fake da Atlassian não registra
      nenhuma criação), mensagem com o **rótulo** e em português. E o contraste: com um
      arquivo, passa. _Requirements: FR-2, ScB-01_
- [x] **T-1011** Gate nas **duas** rotas de criação, ao lado de `autorizarDeclaracaoDeAnexo` —
      função própria, sem tocar em `obrigatoriosFaltando` (`plan.md` §1.4). Auditoria:
      `anexo_obrigatorio_ausente`. _Requirements: FR-2_

## Phase 4 — O upload passa a guardar

- [ ] **T-1012** [teste] O upload **não** chama `attachTemporaryFile` (asserção sobre o
      `fetchImpl`: nenhuma requisição à Atlassian na rota de upload) e grava as fatias.
      _Requirements: FR-4_
- [ ] **T-1013** `http/anexo-entrada.ts` + rota de upload: guardar bytes; gravar
      `anexos_pendentes` com `temporary_attachment_id = ''` e o predicado `aindaNaoSubiu`
      (`plan.md` §1.2). ⚠️ A análise de `D-64` continua rodando **na mesma requisição**, sem
      mudança. _Requirements: FR-1, FR-4_
- [ ] **T-1014** [teste] `SC-05`: arquivo guardado há 40 minutos volta íntegro e produz um id
      temporário **novo** na confirmação. _Requirements: FR-4, SC-05_
- [x] **T-1030** [teste de burla] `ScB-02`: nenhuma resposta de rota carrega
      `temporaryAttachmentId` — varredura sobre o JSON devolvido pelas rotas de anexo, não
      sobre o tipo. ⚠️ Achado do `/analyze`: o cenário existia na spec **sem tarefa**, e o id
      passa a nascer em outro momento, que é exatamente quando um campo vaza sem ninguém
      notar. _Requirements: ScB-02, RF-30_

## Phase 5 — A criação com anexo (só depois de `T-1001`)

- [x] **T-1015** [teste] `SC-02`: assunto que exige → o **corpo entregue ao `fetchImpl`** na
      criação carrega o anexo; assunto opcional → o corpo **não** carrega, e a materialização
      acontece depois (`SC-04`). Os dois no mesmo arquivo, lado a lado — é a bifurcação de
      `plan.md` §1.5 que precisa ficar visível. _Requirements: FR-3, SC-02, SC-04_
- [x] **T-1016** `atlassian/cliente.ts`: `criarChamado` aceita ids temporários, na forma que
      `T-1001` mediu. _Requirements: FR-3_
- [x] **T-1017** `tickets/anexo-antes-da-criacao.ts` (módulo **novo**, não uma flag em
      `anexo-na-criacao.ts` — `plan.md` §1.6): lê os bytes, sobe agora, devolve os ids.
      _Requirements: FR-3, FR-4_
- [ ] **T-1018** [teste] `SC-06`: 5xx no upload da confirmação → submissão **transitória**,
      pessoa lê `respostaCriacao`; 4xx → `criacaoNaoConcluida` (`D-46`). _Requirements: FR-7,
      SC-06_
- [x] **T-1019** Apagar os bytes quando a materialização conclui (`plan.md` §1.7), e pegar
      carona no expurgo do outbox para o resto. _Requirements: FR-8, SC-08_

## Phase 6 — A tela

- [x] **T-1020** [teste] `app/pendencias.ts`: com assunto que exige e zero arquivos, a frase
      composta nomeia a evidência **junto** com o que mais falta — nunca "é a única coisa que
      falta" quando não é (`D-46`). _Requirements: FR-5_
- [x] **T-1021** Cartão da conversa: aviso de evidência exigida + botão travado + o controle de
      anexar ali. ⚠️ Skill `frontend-design` antes de codar; estado **nunca só por cor**; e a
      caixa tracejada permanente continua recusada (`D-59`). _Requirements: FR-5, SC-01_
- [x] **T-1022** Formulário direto (`Abrir direto`): mesma exigência, mesmo predicado.
      _Requirements: FR-2, FR-5_
- [ ] **T-1023** [teste] `SC-03`: trocar o assunto para um que não exige **remove** a trava —
      ela é do assunto, não da conversa. _Requirements: SC-03_
- [ ] **T-1024** [teste] `SC-07`: o prompt do agente continua sem pedir arquivo (teste
      estrutural sobre `montarPromptAgente`, como o de `prosa-sem-prazo`). _Requirements: FR-6,
      SC-07_

## Phase 7 — Medir de verdade

- [ ] **T-1025** Deploy na staging (regra 10) e abrir **dois** chamados reais: um do `134`
      **com** anexo e um do `70` (anexo opcional) **com** anexo — o segundo é a prova de não
      regressão. Ambos `[TESTE goatlas - ignorar]`. _Requirements: SC-02, SC-04_
- [ ] **T-1026** Tentar o `134` **sem** anexo pela rota, na staging, e conferir a linha
      `anexo_obrigatorio_ausente` na auditoria. _Requirements: ScB-01_
- [ ] **T-1027** Devolver `90, 91, 92, 94, 96, 134` à allowlist de **produção** — só depois de
      `T-1025` e `T-1026`. ⚠️ Hoje eles estão fora (mitigação de 17/08/2026); devolvê-los antes
      da medição é reabrir a perda de chamado. _Requirements: §7 da spec_
- [ ] **T-1028** Medir o espaço ocupado por `anexos_conteudo` depois de uma semana em produção
      (`plan.md` §3). _Requirements: —_
- [ ] **T-1029** Atualizar `CLAUDE.md`: a bifurcação de ordem, o id temporário nascendo na
      confirmação, e a emenda ao parágrafo de `D-26`. _Requirements: Princípio XIII_
