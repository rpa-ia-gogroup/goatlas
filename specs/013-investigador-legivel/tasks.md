---
# Tarefas — geradas por /tasks a partir da spec.md (o /plan foi dispensado: superfície
# sobre dado existente, sem pergunta em aberto e sem trava nova — Right-Sized Rigor).
feature: "investigador-legivel"
spec: "./spec.md"
status: draft
created: "2026-08-20"
---

# Tasks: o Investigador vira leitura

> Numeração `T-13xx` (a spec 010 chegou a `T-1030`).
>
> ⚠️ **Worktree obrigatório** (regra 1): branch `013-investigador-legivel`, junção de
> `node_modules` para a árvore principal.
>
> 🚨 **A regra que governa todas as fases:** **nada muda no que é gravado** (`NG1`). Se uma
> tarefa parecer pedir coluna nova, evento novo ou campo novo na coleta, ela está errada — o
> dado já está lá.
>
> 🚨 **A segunda regra:** teste de tela afirma que **o conteúdo chega**, nunca como ele é
> desenhado (`D-49`). Teste que copia layout reprova em toda melhoria, vira peso morto e é
> apagado — devolvendo o buraco que ele tapa.

---

## Phase 1 — a linha do tempo vira leitura  ← **este PR**

### 1.1 O tradutor de eventos

- [x] **T-1300** `src/app/investigador/eventos.ts` — `descreverEvento(tipo, dados)`, função
      **pura**, devolvendo `{ titulo, linhas: {rotulo, valor}[], blocos: {rotulo, texto,
      bytes}[] }`. O mapa é `Record<TipoDeEvento, Descritor>`: tipo novo sem descritor **não
      compila**. Tipo desconhecido em tempo de execução (dado antigo) cai no rótulo cru.
      _Requirements: FR-22, ScA-02, ScA-04, SC-2_
- [x] **T-1301** Descritores dos **21** tipos, em português, cada um dizendo o que aquele
      evento significa para quem investiga — não o nome do campo. Os textos longos
      (`historicoEnviado`, `paraModelo`, `textoDoModelo`, `respostaBrutaDoModelo`, `payload`)
      entram como **bloco**, com tamanho, nunca como linha.
      _Requirements: FR-22, FR-24, ScA-06_
- [x] **T-1302** Teste: todo `TipoDeEvento` tem descritor; nenhum descritor devolve rótulo em
      `snake_case`; evento de tipo inventado não lança e devolve o rótulo cru.
      _Requirements: SC-1, SC-2, ScA-04_

### 1.2 O turno

- [x] **T-1303** `agruparEmTurnos(eventos, requisicoes)` — função **pura** que agrupa por
      `requisicao_id` e casa cada grupo com sua linha de `investigador_requisicoes`. Evento
      sem requisição casada cai num grupo "fora de turno", **nunca some**.
      _Requirements: FR-21, ScA-01, §8_
- [x] **T-1304** Cabeçalho do turno: número, hora, duração, custo somado, ferramentas
      executadas/recusadas, nº e tempo somado das chamadas externas, e o desfecho em uma
      palavra. As chamadas externas do turno ficam **dentro** dele, agrupadas.
      _Requirements: FR-21, ScA-07_
- [x] **T-1305** Teste: três turnos viram três grupos; a soma de custo e duração bate; seis
      `chamada_externa` viram **um** item agrupado; evento sem `requisicao_id` aparece.
      _Requirements: ScA-01, ScA-07_

### 1.3 A leitura

- [x] **T-1306** Bolhas: pessoa à direita, agente à esquerda, servidor/ferramenta/externa como
      bloco compacto. Origem continua sendo **forma + palavra** (`ORIGENS` fica), nunca cor.
      _Requirements: FR-22, NFR-3_
- [x] **T-1307** 🚨 **O JSON cru vai para dentro de um `<details>` fechado** ("Ver o registro
      cru"), em **todo** evento. É o defeito principal desta feature.
      _Requirements: FR-23, ScA-03, SC-3_
- [x] **T-1308** Texto longo com tamanho declarado e conteúdo sob demanda (`<details>`, como
      `D-68` fez com a leitura de anexo). Nunca `.slice()` silencioso — a marca de
      truncamento de `FR-3` continua visível.
      _Requirements: FR-24, ScA-06, §8_
- [x] **T-1309** `resposta_agente` mostra os **dois** textos quando houve descarte (`D-21`),
      com a frase dizendo que o texto do modelo não chegou à pessoa.
      _Requirements: ScA-05_
- [x] **T-1310** Teste de tela (`renderToStaticMarkup`): nenhum `<pre>` de JSON fora de
      `<details>`; o texto em português de cada evento aparece; o turno aparece.
      _Requirements: SC-1, SC-3, ScA-01, ScA-02_

### 1.4 CSS e acabamento

- [x] **T-1311** `investigador.css`: turno, bolhas, blocos colapsáveis. Só tokens que
      **existem** (`tests/tokens-de-css-existem.test.ts` reprova o inventado — `D-64`).
      Foco visível e `prefers-reduced-motion`.
      _Requirements: NFR-3, NFR-5_
- [x] **T-1312** Plurais concordados em toda contagem nova (`1 ferramenta` × `2 ferramentas`,
      `1 chamada` × `2 chamadas`) — regra 4, e o defeito que já apareceu na staging em 14/08.
      _Requirements: NFR-4_
- [x] **T-1313** Documentação no mesmo PR (regra 2): `docs/DECISOES.md` ganha o **`D-79`**,
      `CLAUDE.md` ganha as travas novas (o `Record<TipoDeEvento, …>`, o JSON dentro de
      `<details>`, o turno vindo de `requisicao_id`), e `specs/009-investigador/tasks.md`
      aponta para esta spec.
- [x] **T-1314** ✅ **Medir no navegador** (`SC-4`): uma sessão real lida de ponta a ponta sem
      abrir nenhum bloco cru. Staging antes de prod (regra 10).
      ✅ **Feito em 20/08/2026, em `npm run dev`** — e achou **três** defeitos que a suíte
      não pegava: o título do bloqueio saía *"Bloqueio pela regra1_confluence"* (slug pelo
      **valor**, não pelo rótulo — a varredura olhava só os rótulos), o `<pre>` do registro
      cru dava barra horizontal na **página inteira** (item de grade tem `min-width: auto`) e
      o topo do JSON lia *"DADOS DO EVENTO750 BYTES"* (o `gap` do flex não entra no nome
      acessível). Os três corrigidos, com teste no primeiro.
      ⚠️ **Falta a staging** (regra 10), com modelo real.
      _Requirements: SC-4_

---

## Phase 2 — o que o cartão virou  *(PR seguinte)*

- [ ] **T-1320** `compararPropostas(base, nova)` — puro; alterado / adicionado / removido, com
      os campos longos em antes×depois. Base é **`baseAnterior`**, nunca a vigente (`D-71`).
- [ ] **T-1321** `proposta_rederivada` sem alterações **não** desenha tabela vazia.
- [ ] **T-1322** Trilha "evolução do cartão" v1 → v2 → v3 no topo do detalhe.
- [ ] **T-1323** Teste: a edição da pessoa pelo `PUT` não aparece como mudança da IA.
  _Requirements: FR-25, FR-26, ScB-01..ScB-04_

## Phase 3 — a página fica utilizável  *(PR seguinte)*

- [ ] **T-1330** Deep link `/investigador/<conversaId>` em `app/rotas.ts` — `push`, com
      `popstate` (`D-65`).
- [ ] **T-1331** `Promise.allSettled` + banner do que não carregou + manter o dado velho.
- [ ] **T-1332** Polling de 10 s com guarda de requisição em voo + carimbo.
- [ ] **T-1333** `GET /api/investigador/requisicoes/:id/corpos`; tirar `req_json`/`resp_json`
      da listagem.
- [ ] **T-1334** `BlocoJson`: KB, nº de linhas, colapso acima do teto, copiar com aviso de
      falha.
  _Requirements: FR-27..FR-30, ScC-01..ScC-06, SC-5, SC-6_

## Phase 4 — achar o caso  *(PR seguinte)*

- [ ] **T-1340** Exportar a sessão em JSON enxuto, um clique.
- [ ] **T-1341** Contagem por recorte + chips de filtro ativo + período.
- [ ] **T-1342** Recorte "parada há mais de 1 h".
  _Requirements: FR-31, FR-32, ScD-01, ScD-02_

---

## Coverage check (gate antes do /implement)

| Cenário | Tarefa |
|---|---|
| ScA-01 | T-1103, T-1105, T-1110 |
| ScA-02 | T-1300, T-1102, T-1110 |
| ScA-03 | T-1107 |
| ScA-04 | T-1300, T-1102 |
| ScA-05 | T-1109 |
| ScA-06 | T-1101, T-1108 |
| ScA-07 | T-1104, T-1105 |
| ScB-01..04 | T-1120..T-1123 |
| ScC-01..06 | T-1130..T-1134 |
| ScD-01..02 | T-1140..T-1142 |
| SC-1 | T-1102, T-1110 |
| SC-2 | T-1300, T-1102 |
| SC-3 | T-1107, T-1110 |
| SC-4 | T-1114 |
| SC-5 | T-1133 |
| SC-6 | T-1131 |
