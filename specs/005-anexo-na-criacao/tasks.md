---
feature: "Anexo na criação do chamado"
plan: "./plan.md"
status: draft
created: "2026-08-07"
revised: "2026-08-07 — v2, depois do /analyze"
---

# Tasks: Anexo na criação do chamado

> Teste antes do código. `[P]` = paralelizável. Numeração a partir de **T-400**.

## Phase 0 — O furo que já existe, e que esta feature agravaria

> ⚠️ **Vai primeiro, e vale por si só.** Ver `plan.md` §4. Sem isto, o campo de
> anexo no schema abre o caminho de `SC-12`.

- [x] **T-400** Teste de burla: `camposDinamicos` com chave que **não pertence** ao
      schema é descartada — e, com o **schema indisponível**, todos são descartados
      (fail-closed, `plan.md` §4). Validação que se desliga sob pressão não é
      validação. _Requirements: RF-27, RF-30, RNF-18_
- [x] **T-401** Validar as chaves de `camposDinamicos` contra o schema, e excluir
      sempre o `fieldId` de anexo — o anexo entra só pelo caminho do `plan.md` §2.
      _Requirements: RF-27, RF-30, RNF-25_

## Phase 1 — A trava da declaração, antes de qualquer UI

- [x] **T-402** Teste de burla: **dado um tipo cujo schema expõe anexo**, criação
      sem declaração é recusada pelo servidor, nos dois caminhos. A pré-condição é
      parte do teste — sem ela, ele contradiz T-404.
      _Requirements: RF-62, RN-11_
- [x] **T-403** `submissoes.declarou_anexo` + recusa na rota. `null` = não
      respondeu, nunca default silencioso. _Requirements: RF-62, RN-11_
- [x] **T-404** A regra exata do gate (`plan.md` §6): exige declaração **só** quando
      o schema é conhecido **e** expõe anexo. Testes dos dois lados — schema sem
      anexo abre sem perguntar (`SC-05`), schema indisponível abre sem perguntar e
      **audita** (`SC-05b`). _Requirements: RF-62, RF-27, RNF-18, RN-10_
- [x] **T-405** Teste: declarar "tenho" e **não** anexar continua abrindo chamado.
      A trava é responder, não anexar. _Requirements: RN-11_

## Phase 2 — Os dois passos separados

- [x] **T-406** `ClienteAtlassian` ganha `subirAnexoTemporario` — interface, Http,
      Fake e `somente-leitura` (que **recusa**). Hoje `anexarArquivo` é atômica e
      exige `issueKey`. _Requirements: RF-25, RNF-22, RNF-18_
- [x] **T-406b** ⚠️ `TipoCampoRequestType` ganha `'anexo'`, e `camposAdicionais`
      passa a reconhecê-lo. **Hoje o desconhecido cai em `'texto'`**, então um campo
      de anexo no schema já seria desenhado como caixa de texto — e sem este tipo o
      gate de `RF-62` não tem como saber se o tipo aceita anexo.
      _Requirements: RF-27, RF-61_
- [x] **T-406c** O campo de anexo **sai** da lista que `RF-27` renderiza: quem
      desenha o seletor de arquivo é `T-417`. Sem isto a tela mostra os dois.
      _Requirements: RF-27, RF-61_
- [x] **T-407** [P] Fake: sucesso e falha injetável do envio, incluindo **envio
      anterior que já não vale**. Sem isso `RF-63` não tem como ser testado.
      _Requirements: RF-61, RF-63_
- [x] **T-408** Tabela `anexos_pendentes` + isolamento por e-mail **no `WHERE`**
      (`plan.md` §3), e teste de que envio de outra pessoa não entra
      (`SC-11`). _Requirements: RF-30, RNF-25_
- [x] **T-409** Rota de upload: valida (reaproveita `http/anexo-entrada.ts`), sobe o
      temporário, guarda no servidor e devolve **só** `{ nome, ok }` — nunca um
      identificador. _Requirements: RF-25, RF-30, RF-63_
- [x] **T-409b** ⚠️ Chave de correlação **normalizada por uma função só**, chamada no
      upload e na criação (`plan.md` §3). A rota hoje reescreve a chave do cliente;
      gravar a crua e procurar a prefixada faria nenhuma linha casar — chamado sem
      anexo, em silêncio. Chave obrigatória quando há anexo, e teste do caso "não
      casou" terminando em falha **visível** de anexo. _Requirements: RF-24, RF-63_
- [x] **T-409c** Teto de arquivos **por chamado**, contado nas linhas da mesma chave,
      com recusa por mensagem. ⚠️ Hoje é `.slice()` na rota, que trunca em silêncio —
      o quarto arquivo some sem nada na tela (`plan.md` §11).
      _Requirements: RF-63, RNF-30_
- [x] **T-410** [P] A rota de upload herda os gates das rotas de criação: escopo de
      piloto, auditoria (toca a Atlassian, `RN-10`) e teto por pessoa/janela contra
      envio órfão (`R-02`). _Requirements: RN-10, R-02, R-06_
- [x] **T-411** [P] Dedupe de envio por `(chave_idempotencia, nome_arquivo)`: duplo
      clique no seletor não gera dois temporários. _Requirements: RF-24_

## Phase 3 — A criação, com o anexo isolado dela

- [x] **T-412** ⚠️ **Teste primeiro, e é o mais importante da spec:** falha no envio
      **não** marca a submissão como falha definitiva e **não** impede o chamado.
      É o modo de falha que `plan.md` §0 descreve. _Requirements: RF-63, RNF-17_
- [x] **T-413** Materializar o anexo **depois** da criação, dentro da mesma
      confirmação, com o resultado do anexo separado do resultado da criação.
      _Requirements: RF-61, RF-63_
- [x] **T-413b** Materialização **uma vez só**, garantida por constraint
      (`materializado_em` + `UNIQUE`). Reconfirmar devolve `duplicada: true` com o
      mesmo `issueKey`; sem isto, o segundo clique anexa o arquivo de novo.
      _Requirements: RF-24_
- [x] **T-414** Criação diferida (`plan.md` §7): o anexo não é carregado para o
      reprocessamento, e a resposta diz isso. O aviso de `RF-44` repete.
      _Requirements: RF-63, RNF-17, RF-44_
- [x] **T-415** [P] Expurgo das órfãs com **TTL próprio e curto**, independente da
      política de retenção pessoal. ⚠️ `aplicarRetencao` não apaga nada com política
      `null`, que é o default do MVP (`D-20`) — apoiar-se nela deixaria a tabela
      crescer para sempre. _Requirements: RNF-33_
- [x] **T-416** [P] Auditoria: declaração e resultado do envio, inclusive quando
      falha. _Requirements: RN-10, RF-62_

## Phase 4 — As duas telas

> Skill `frontend-design` antes de codar, e `identidade_visual_gogroup.md`.

- [x] **T-417** Formulário direto (`D-04`) primeiro — o schema já é renderizado ali
      (`plan.md` §8). Pergunta obrigatória + envio.
      _Requirements: RF-61, RF-62, RF-27_
- [x] **T-418** Recibo de confirmação da conversa: a mesma pergunta, sem opção
      pré-marcada, botão de abrir indisponível até a resposta. Copy da opção
      negativa é "não tenho material para anexar" — nunca "pular", que sugere que
      anexar era o dever. _Requirements: RF-62, RN-11, RF-17_
- [x] **T-419** [P] Estado do envio na tela: enviando, enviado (com o nome), falhou
      com o caminho de `RF-34`. Teste por SSR. _Requirements: RF-63, RNF-30_
- [x] **T-420** [P] Piso de a11y verificável: foco visível no seletor e nas duas
      opções, estado do envio nunca só por cor, alvo de toque no celular.
      _Requirements: RNF-28_

## Phase 5 — Fechamento

- [x] **T-421** [P] Teste **estrutural** varrendo `src/` — nenhum `fieldId` de anexo
      literal no código (`ScC-4`). É o padrão do projeto para "isto não pode
      aparecer", como em `rnf01-vazamento-credenciais`. _Requirements: RNF-25_
- [x] **T-422** [P] Indicador de chamados com evidência no painel (`ScC-7`), para
      que o efeito da pergunta seja medido e não presumido.
      _Requirements: RF-55_
- [x] **T-423** `[PROCESSO]` Documentação no mesmo PR: a decisão do `plan.md` §2
      (com as duas alternativas recusadas) vira decisão em `docs/DECISOES.md`; os
      gotchas de `plan.md` §0 e §5 vão para `CLAUDE.md`; e o **endurecimento de
      `RF-27`** (campo extra fora do schema deixa de passar) é anotado no requisito e
      na spec 002, que é quem o entregou. _Requirements: RF-27_
- [x] **T-424** Fechar os Success Criteria item por item.
      _Requirements: todos_
> ⚠️ **T-425 saiu desta spec** (10/08/2026, decisão do Kaique). Ela era "verificar contra a
> Atlassian real que o request type expõe campo de anexo, e observar o envio de verdade" —
> **verificação de go-live, não tarefa da feature**: nada aqui muda com a resposta, porque
> sem o campo o código já cai em `SC-05` e a feature fica dormente sem quebrar nada.
>
> **O fato não desapareceu, mudou de lugar:** ninguém confirmou que o request type expõe
> anexo, e `criarChamado` (`T-063`) nunca executou contra o JSM. Isso está na tabela "o que
> falta não é código" do `CLAUDE.md`, junto das outras verificações que só acontecem quando
> `GOATLAS_SOMENTE_LEITURA` for desligado (`D-24`). Fechar a spec sem essa transferência seria
> declarar completude que ela não tem.

## Estado

**Completa (10/08/2026).** As 24 tarefas de implementação estão fechadas.

Spec, plano e tarefas escritos em 07/08/2026; implementação em 10/08/2026, em cinco commits
que seguem as cinco fases deste arquivo. Decisões registradas em `D-26` (o anexo não viaja
na criação), `D-27` (`RF-62` é fail-open, e por quê) e `D-28` (o endurecimento de `RF-27`,
anotado também na spec 002, que o entregou).

**920 testes · typecheck limpo · build limpo** (a suíte inteira, já com os consertos da aba Documentação de 10/08 incorporados). Verificado também em `npm run dev`, não só
na suíte: criar sem declarar responde 400 com a mensagem da pessoa, e com a declaração o
chamado nasce já com `anexo.estado = "anexado"`.

**A v1 do plano estava errada e foi reaberta pelo `/analyze`:** ela punha o anexo
dentro da chamada de criação, o que faria um arquivo vencido **apagar o chamado da
pessoa** — 4xx é classificado como definitivo e submissão definitiva nunca é
reprocessada. A v2 separa os dois passos. Registrado em `plan.md` §0 porque é
exatamente o tipo de "simplificação" que alguém tentaria de novo.

**Uma tarefa bloqueada (T-425), e é de verificação.** O resto não depende de `Q1`.

### Emenda de 13/08/2026 — `D-68`, a pergunta que o servidor já sabia responder

- [x] **T-426** — `GET /api/conversas/:id/anexos` (nome e teto; nunca o `temporaryAttachmentId`,
      isolado por e-mail) e o cartão deixando de perguntar quando a conversa já tem anexo.
      _Requirements: RF-61, RF-62, RF-63, RF-30, RN-11_
- [x] **T-427** — `autorizarDeclaracaoDeAnexo` não exige declaração quando existe anexo pendente
      para a chave, e **`false` explícito é gravado como `true`**: o fato vence a intenção, porque
      a materialização nunca consultou a declaração e `declarouNaoTer` sujava `T-422`.
      _Requirements: RN-11, RF-62_

⚠️ **A pergunta nasceu certa e envelheceu.** Quando esta spec foi escrita, o cartão era o **único**
lugar onde se anexava; `D-59` abriu o clipe/colar na conversa e transformou a pergunta em pedido
para declarar o que a pessoa já tinha feito. O texto de `RN-11` foi emendado, não reescrito: a
trava continua sendo **responder**, e continua valendo para quem não anexou nada.

⚠️ **O terceiro defeito de `D-68` é desta spec, e só o navegador o pegou:** a lista de envios da
tela vivia dentro de `{cabem > 0 && …}`, então o terceiro arquivo zerava `cabem` e apagava a
própria linha que acabara de aparecer — arquivo no chamado, nada na tela, que é o `D-62` de novo.

**1427 testes** com os 28 casos novos (`tests/d68-anexo-ja-enviado.test.ts`,
`tests/d68-assunto-com-nome.test.ts`).
