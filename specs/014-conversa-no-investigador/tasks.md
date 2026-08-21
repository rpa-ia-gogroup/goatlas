# Tarefas — 014 · A conversa no Investigador

Decisão em [`docs/DECISOES.md` § `D-80`](../../docs/DECISOES.md).
Cenários em [`spec.md`](./spec.md).

## Fase 1 — o dado chegar

- [x] **T-1401** `FiltroDeSessoes.conversaId` + as seis consultas estreitadas por ele.
  Filtro **deste** leitor, nunca um `resumirSessao` novo — os treze números do cabeçalho são os
  mesmos treze da lista. _Requirements: FR-33_
- [x] **T-1402** `SessaoInvestigador.tituloDoCartao`, de `conversas.proposta_json`.
  Nunca lança; JSON malformado devolve `null` **com `temProposta: true`**. _Requirements: FR-33_
- [x] **T-1403** `detalharSessao` devolve `sessao`, e `null` significa expurgo pela retenção —
  não 404. _Requirements: FR-33_
- [x] **T-1404** `DetalheDeSessao.sessao` e `SessaoInvestigada.tituloDoCartao` no cliente.
  _Requirements: FR-33_

## Fase 2 — a leitura

- [x] **T-1405** `app/investigador/conversa.ts` — puro: `montarConversa` junta falas e marcos na
  ordem dos carimbos, com a fala antes do marco no empate. _Requirements: FR-34, FR-35_
- [x] **T-1406** `autoriaDoMarco` — allowlist de seis ações da pessoa + quatro marcos do app, e
  `proposta_rederivada` só com `forcado`. _Requirements: FR-35_
- [x] **T-1407** `gravidadeDoEvento` + `Record<TipoDeEvento, Gravidade>` em `eventos.ts`: tipo
  novo sem gravidade não compila. _Requirements: FR-36_

## Fase 3 — a tela

- [x] **T-1408** `CabecalhoDaSessao` — assunto, selos, quem, seis números, e a frase do motivo
  quando não houve cartão. _Requirements: FR-33_
- [x] **T-1409** `SessaoAberta` com as três abas, Conversa como padrão, contagem em cada uma.
  _Requirements: FR-34_
- [x] **T-1410** `Conversa` + `MarcoDaConversa` — bolhas, tool em `<details>` fora do fluxo,
  marco centralizado com o rótulo de autoria e o `antes → depois` da edição. _Requirements:
  FR-34, FR-35_
- [x] **T-1411** `LinhaDeSessao` com o assunto na primeira linha e o e-mail abaixo.
  _Requirements: FR-33_
- [x] **T-1412** CSS: cabeçalho, abas, conversa; `data-tom` na linha do tempo; **fora** o recuo
  de 12% e a calha de 128 px dos pares. _Requirements: FR-36_

## Fase 4 — a rede

- [x] **T-1413** `tests/014-conversa-no-investigador.test.ts` — 28 casos: o payload da rota, a
  ordem da conversa, a allowlist de marcos, a gravidade e a ausência de `data-lado`.
- [x] **T-1414** Documentação no mesmo PR: `D-80`, `CLAUDE.md` (padrões + estado), esta spec.

## Fase 5 — o que só o navegador viu

- [x] **T-1417** ✅ **MEDIDO no `npm run dev`** em 21/08/2026, com uma sessão real (bloqueio da
  Regra 1 + override). O que confirmou:
  - a **lista** mostra o assunto na primeira linha e o e-mail abaixo;
  - o **cabeçalho** traz título, `coletando`/`cartão na tela`/`1 override` (lime) e os seis
    números;
  - a **conversa** lê-se como diálogo, com o bloqueio e o override como marcos rotulados
    (`O APP DECIDIU` × `A PESSOA FEZ`);
  - **os 8 eventos da linha do tempo em `esq: 91`** — todos na espinha, nenhum `data-lado`;
  - **todo `.inv-evento-linhas` com 18 px**, com 1, 2 ou 3 pares — antes eram ~20 px por par;
  - altura média por evento de **127 px** (era ~145 em produção, com pares de 3);
  - `scrollWidth === clientWidth`: nenhuma barra horizontal.
- [x] **T-1418** 🚨 **Defeito achado só no navegador:** a fala do agente saía com o **markdown
  cru** — `- [Como reprocessar…](/documentacao?pagina=p1)` e `**seu**` literais. Corrigido
  reusando `TextoDoAgente`, o mesmo renderizador da conversa que a pessoa viu (allowlist de
  forma, `R-07`, nunca `dangerouslySetInnerHTML`). ⚠️ A fala **dela** fica crua de propósito:
  ela escreveu texto, não markdown. Dois casos novos.
  ⚠️ **A suíte estava verde com o defeito** — a terceira vez na semana.

## O que falta, e não é código

- [ ] **T-1415** 🚨 **Medir na staging**, com a sessão real que originou o relato
  (`7d909d36-bb89-4d9e-9063-fff35016ff8c`). Confirmar na tela: o cabeçalho nomeando o assunto ·
  a conversa em bolhas com a ordem certa · o marco de cada intervenção · o marcador **na**
  espinha na aba Linha do tempo · e a altura da página, que era 3.311 px.
  ⚠️ A regra 10 vale, e a lição de 20/08 é que o navegador achou três defeitos com a suíte
  inteira verde.
- [ ] **T-1416** Deploy em produção depois da staging, com o **mesmo bundle** — e buildando da
  **árvore principal**, porque o mesmo commit dá CSS de hash diferente num worktree (`CLAUDE.md`,
  21/08/2026).
