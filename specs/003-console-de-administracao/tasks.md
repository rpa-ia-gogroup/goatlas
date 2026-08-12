---
feature: "Console de administração organizado por capacidade"
id: "003"
spec: "./spec.md"
plan: "./plan.md"
---

# Tarefas 003

Ordem: o que é testável sem tela primeiro; a tela por último, já apoiada em dado
pronto. Teste antes do código onde o teste é de recusa.

## Phase 1 — o que a tela vai afirmar (sem tela)

- [x] **T-133** — `src/lib/config/diagnostico.ts`: `diagnosticar(config)` devolve as
      capacidades com estado (`ligado` | `parcial` | `desligado`) e a frase de
      consequência. Função pura, sem React.
      _Requirements: RF-49, RNF-07_
- [x] **T-134** — `tests/config-diagnostico.test.ts`: allowlist vazia desliga a
      capacidade certa; exemplos vazios desligam a Regra 2; sem `org_id` a
      governança é "não configurada"; com preço faltando é "parcial", não
      "desligada". O teste é o contrato da frase que vai à tela.
      _Requirements: RF-49, RF-53, RNF-07_

## Phase 2 — a recusa que a tela não pode garantir

- [x] **T-135** — `tests/rf49-config-validacao.test.ts` **antes** do código: `PUT`
      com tipo errado em cada família de chave (número recebendo texto, lista
      recebendo objeto, mapa de preço com valor negativo) responde 400 e **não**
      grava. Escrito e vermelho antes de T-136.
      _Requirements: RF-49, RNF-07_
- [x] **T-136** — `src/lib/config/validar.ts` + fio em `PUT /api/admin/config`.
      _Requirements: RF-49_

## Phase 3 — o console

- [~] **T-137** — `src/app/admin/campos.tsx`: descritores em linguagem de decisão
      (rótulo, ajuda, efeito derivado do valor) e os quatro editores — lista com
      pré-visualização, número com unidade, escolha, e preço por produto do
      inventário.
      _Requirements: RF-49, RF-50, RF-53, RNF-28_
      ⚠️ **Estava `[x]`; falta um dos quatro parâmetros que `RF-50` nomeia** (auditoria de
      12/08, `D-47`). Na tela estão o threshold da Regra 1 (`campos.tsx:238`), o critério de
      agrupamento (`:248`) e os exemplos do prompt (`:262`). **O threshold de recorrência da
      Regra 2 — e a janela em dias — não têm descritor em `SECOES`:**
      `regra2_threshold_recorrencia` e `regra2_janela_dias` aparecem em `ChaveEditavel`
      (`campos.tsx:41-42`) e são aceitos pelo `PUT`, mas nenhum campo os renderiza. São
      **lidos** na Visão geral (`src/lib/config/diagnostico.ts:184`) e só mudam por
      `PUT /api/admin/config` na mão — o oposto de `RF-49`/`RF-50`, que existem para o admin
      calibrar sem deploy.
      ⚠️ **É lacuna, não decisão:** `D-25` excluiu da tela TTL de cache, rate limit e
      `regra2_limite_tickets`, e `tests/tela-admin.test.ts:160-170` lista exatamente esses
      três — o threshold de recorrência **não** está lá. Também é o parâmetro que `RF-11`
      pede explicitamente ("threshold de recorrência", sugestão 3+ em 90 dias).
      ⚠️ **Não é só colar um campo:** a seção "Interrupções" já está no teto de 3 controles
      que `tela-admin.test.ts:135` impõe, então entra decidindo a estrutura — que é o
      trabalho que `D-25` fez de propósito.
- [x] **T-138** — `src/app/admin/paineis.tsx`: métricas, assentos, lacunas e
      auditoria movidos, cada um ao lado da configuração que afetam.
      _Requirements: RF-42, RF-53, RF-55, RF-56, RNF-18_
- [x] **T-139** — `src/app/admin/index.tsx` + CSS: trilha de seções com estado,
      "Visão geral" como primeira seção, responsivo.
      _Requirements: RF-49, RNF-28_
- [x] **T-140** — `tests/tela-admin.test.ts`: a visão geral nomeia a consequência;
      nenhum rótulo visível carrega nome de chave; estado não é só cor; a falha de
      um painel não derruba a edição.
      _Requirements: RF-49, RNF-18, RNF-28_

## Phase 4 — documentação no mesmo PR

- [x] **T-141** — `docs/DECISOES.md` `D-25` (o que sai do console e por quê),
      `CLAUDE.md` (estado do projeto + a trava nova de validação), `docs/REQUISITOS.md`
      se algum RF mudar de leitura. Princípio XIII.

---
## Coverage check
- [x] Toda tarefa referencia requisito
- [x] O teste de recusa (T-135) vem antes do código que ele testa (T-136)
- [x] Nenhuma `[BLOQUEADA]` — nada aqui depende de Q1/Q4/Q5/Q8. O console fica
      pronto para a resposta; as perguntas seguem em aberto.
