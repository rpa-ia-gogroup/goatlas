---
description: Gera o plano técnico (HOW) a partir da spec aprovada.
argument-hint: "[notas de stack/arquitetura, opcional]"
---

Você vai criar o **plano de implementação** (o HOW).

1. Leia a constituição, a `spec.md` ativa e `.specify/templates/plan-template.md`.
   Se a spec ainda tiver `[NEEDS CLARIFICATION]`, **pare** e peça `/clarify` antes.
2. Considere as preferências do usuário, se houver: $ARGUMENTS
3. Crie `plan.md` na pasta da feature a partir do template: technical context,
   arquitetura, data model, contracts e estratégia de testes (mapeando FR → teste).
4. Preencha o **Constitution Check**. Qualquer violação vai em *Complexity
   Tracking* com justificativa — ou simplifique para não violar.
5. Defina a ordem de criação de arquivos (default: contracts → testes → código).
6. Reporte ao usuário as decisões-chave e quaisquer trade-offs relevantes.
