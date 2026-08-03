---
description: Quebra o plano em tarefas atômicas, rastreáveis e ordenadas.
argument-hint: ""
---

Gere a lista de tarefas executáveis.

1. Leia `plan.md`, `spec.md` e `.specify/templates/tasks-template.md` da feature ativa.
2. Derive tarefas **atômicas** (pequenas, revisáveis, reversíveis). Cada uma com
   `_Requirements: FR-N_`. Marque `[P]` as que podem rodar em paralelo.
3. Se o projeto usa TDD, ordene as tarefas de teste **antes** da implementação.
4. Agrupe em fases. Garanta cobertura: todo FR vira ao menos uma tarefa.
5. Escreva `tasks.md` na pasta da feature e rode o "Coverage check" do template.
