---
description: Cria a especificação (WHAT/WHY) de uma nova feature a partir de uma descrição.
argument-hint: <descrição curta da feature>
---

Você vai criar a **especificação** de uma feature usando Spec-Driven Development.

Descrição do usuário: $ARGUMENTS

Passos:
1. Leia `.specify/memory/constitution.md` e `.specify/templates/spec-template.md`.
2. Escolha o próximo número sequencial `NNN` olhando a pasta `specs/`. Crie
   `specs/<NNN>-<slug-da-feature>/spec.md` a partir do template.
3. Preencha **apenas WHAT/WHY**: problema, goals/non-goals, user stories,
   scenarios (Given/When/Then), requisitos funcionais em **EARS**, NFRs reais,
   edge cases e success criteria mensuráveis.
4. **Não invente.** Para tudo que a descrição não deixar claro, insira
   `[NEEDS CLARIFICATION: <pergunta>]` no ponto certo e liste em *Open Questions*.
5. Não escreva NADA de implementação (sem stack/libs/arquitetura) — isso é do `/plan`.
6. Aplique o princípio *Right-Sized Rigor*: mudança pequena → spec enxuta.
7. Ao final, rode mentalmente o checklist "Requirement Completeness", informe
   quantos `[NEEDS CLARIFICATION]` restaram e sugira rodar `/clarify`.
