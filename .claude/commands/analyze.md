---
description: Checa consistência entre spec, plan e tasks antes de implementar.
argument-hint: ""
---

Faça uma análise de consistência cruzada (**read-only** — não edite código).

Verifique e reporte como uma tabela de achados (severidade + onde):
1. **Cobertura:** todo FR da spec tem tarefa? Toda tarefa referencia um requisito?
2. **Altitude:** a spec vazou implementação? O plano contradiz a spec?
3. **Constituição:** o plano respeita todos os princípios? As exceções estão justificadas?
4. **Ambiguidade:** restou algum `[NEEDS CLARIFICATION]`?
5. **Testabilidade:** todo requisito tem como ser verificado?

Se houver achados críticos, recomende qual fase reabrir (`/specify`, `/clarify`,
`/plan` ou `/tasks`) **antes** de `/implement`. Não implemente nada aqui.
