---
description: Executa as tarefas do tasks.md em passos pequenos, teste antes do código.
argument-hint: "[id da tarefa ou fase, opcional]"
---

Execute a implementação seguindo o `tasks.md`.

1. Leia constituição, `spec.md`, `plan.md` e `tasks.md` da feature ativa.
2. Trabalhe em **passos pequenos**: uma tarefa (ou fase) por vez. Se `$ARGUMENTS`
   indicar uma tarefa/fase específica, comece por ela; senão, a próxima pendente.
3. Para cada tarefa: se TDD, escreva o teste (Red) → implemente até passar (Green)
   → refatore. Marque a tarefa `[x]` no `tasks.md` ao concluir.
4. **Não implemente nada fora do escopo das tarefas.** Surgiu necessidade nova?
   Volte e atualize spec/plan/tasks primeiro (Traceability).
5. Ao fim de cada fase, rode os testes, mostre o resultado e **pare para revisão**.
