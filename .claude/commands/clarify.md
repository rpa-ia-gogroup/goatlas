---
description: Resolve os [NEEDS CLARIFICATION] da spec com perguntas objetivas.
argument-hint: "[caminho da spec, opcional]"
---

Objetivo: eliminar ambiguidade da spec **antes** do planejamento.

1. Localize a spec ativa (use `$ARGUMENTS` se fornecido; senão, a spec mais
   recente em `specs/`).
2. Liste cada `[NEEDS CLARIFICATION]` e transforme em perguntas **objetivas** —
   de preferência com opções e uma recomendação, não perguntas abertas demais.
3. Faça as perguntas (poucas e diretas) e aguarde as respostas do usuário.
4. Atualize a spec incorporando as respostas e removendo os marcadores resolvidos.
5. Quando não restar nenhum marcador, mude o `status` da spec para `clarified`.
6. **Não avance** para o plano enquanto houver `[NEEDS CLARIFICATION]` em aberto.
