---
feature: "Piloto, calibragem e rollout"
plan: "./plan.md"
status: draft
created: "2026-08-04"
---

# Tasks: Piloto, calibragem e rollout

> ⚠️ **A maior parte do trabalho desta fase não é tarefa de código.** As tarefas
> `[HUMANO]` abaixo são de pessoas, e o piloto **não começa** sem elas. Listá-las
> aqui é proposital: um `tasks.md` que só tem código mente sobre o esforço da fase.

## Phase 1 — O pouco de código que o piloto exige

- [x] **T-301** Teste de burla do escopo de piloto: e-mail fora da lista não abre
      chamado, e recebe **encaminhamento** (para onde pedir no meio-tempo), não erro
      cru. _Requirements: RNF-30_
- [x] **T-302** `config.emails_piloto` + gate com tela de encaminhamento. Allowlist
      simples — **não** feature flag por usuário nem percentual de rollout: são 1–2
      áreas nomeadas, e construir infra de rollout gradual para isso seria
      over-engineering. ⚠️ **O gate existe; falta a lista (Q13).** Vazio mantém o piloto
      desligado — a única allowlist do projeto cujo vazio libera, e é deliberado (`D-16`).
      _Requirements: R-06_
- [x] **T-303** [P] `piloto/areas.ts` — mapa `e-mail → área`, função pura. E-mail
      desconhecido → **sem área**, nunca área errada. _Requirements: RF-19_
- [x] **T-304** Coluna `area` em `vinculos`, preenchida na criação. A área **no
      momento da criação** é o dado histórico correto, mesmo que a pessoa mude de área
      depois — e permite métrica por área sem reconsultar o Jira.
      _Requirements: RF-19, RF-55_
- [x] **T-305** Correção manual da área no recibo, mesmo padrão de `RF-16` com a
      prioridade: o mapa envelhece e pessoa que muda de área é a regra.
      _Requirements: RF-19_

## Phase 2 — Calibragem com dado

- [x] **T-310** Leitura de calibragem por regra: threshold atual **ao lado** da taxa
      de override, **e as páginas apontadas nos overrides**. Sem as páginas, a tela
      empurra para o ajuste de threshold por ser o botão mais fácil — quando a
      resposta certa pode ser escrever a página que falta (`RF-13`).
      _Requirements: RF-50, RF-42, R-04_
- [x] **T-311** [P] `config.baseline_assentos` + comparação antes × depois. Baseline
      ausente **não** inventa número — a tela diz "sem baseline" em vez de comparar contra
      zero, que mostraria economia de 100%. ⚠️ **O dado depende da Fase 0 (João).**
      _Requirements: O2_
- [x] **T-312** [P] Métrica por área e por prioridade, usando `vinculos.area`.
      _Requirements: RF-55_

## Phase 3 — Rollout

- [ ] **T-320** Ampliar a allowlist por blocos (FrontOffice, depois BackOffice) com os
      thresholds **já calibrados** no piloto — não um big-bang para 12 áreas
      (`R-11`). _Requirements: R-11_
- [ ] **T-321** Fechar os Success Criteria da spec 004, incluindo `ScC-4`: nenhuma
      área com SLA real melhor que 24h percebeu piora. _Requirements: todos_

## Trabalho humano — o piloto não começa sem isto

- [ ] **T-330** `[HUMANO: João]` **Alinhar com o time de tech que o reporter muda**
      (`R-03`, **Q10**). É **pré-condição** do piloto, não tarefa paralela: sem isso
      o piloto começa quebrando a fila de quem precisa trabalhar os chamados.
- [ ] **T-331** `[HUMANO: em aberto]` **Automação no Jira roteando pelo campo
      "Solicitante"**. Sem ela o campo customizado é dado morto e todo chamado chega
      como "aberto pelo robô" — a mitigação de `R-03` não existe de fato. Definir
      **quem constrói**: time de tech ou nós.
- [ ] **T-332** `[HUMANO: João + Produto]` **Comunicar o SLA de 24h como piso
      garantido** (`R-05`, **Q9**). Growth, CX e E-comm têm retorno atual de 2h30;
      comunicado errado, o projeto é percebido como piora pelas áreas de maior volume.
- [ ] **T-333** `[HUMANO: João]` **Combinar com os líderes que o canal oficial passa a
      ser o app** (`O5`). Aderência baixa com satisfação alta significa que o app é
      bom e a combinação não pegou — problemas diferentes, respostas diferentes.
- [ ] **T-334** `[HUMANO: João]` **Escolher as 1–2 áreas** (**Q13**). Sugestão do
      requisito: CX (alto volume, alta maturidade) + Produção (baixo volume).
- [ ] **T-335** `[HUMANO: João + Produto]` **Acordar o SLA formalmente com as áreas** —
      hoje **zero de 12** têm SLA combinado. O app mede aderência a um número que
      alguém precisa ter prometido; medir sem acordo é medir contra nada.
- [ ] **T-336** `[HUMANO: João]` **Revisão trimestral de `D-01`** (`RNF-35`):
      reavaliar `R-01` e `R-03` contra o que de fato aconteceu, e decidir se a
      migração de identidade prevista em `RNF-22` deve ser acionada.

---
## Coverage check
- [x] Todo item da spec 004 aparece em ao menos uma tarefa
- [x] O trabalho humano está listado, não escondido
- [x] **Todo o código desta fase está feito** — T-301 a T-305, T-310 a T-312.
- [ ] **Falta DADO, não código:** a lista de Q13 (T-302) e o baseline da Fase 0 (T-311).
      Os dois são campos de config, sem deploy.
- [ ] **As 7 `[HUMANO]` seguem abertas** — e são elas que decidem quando o piloto começa,
      não o código.

> **Caminho livre hoje:** T-301, T-303, T-304, T-305 e T-310 — o gate de piloto, o
> mapa de áreas e a leitura de calibragem. Pequeno, e é tudo que o código desta fase
> pede.
