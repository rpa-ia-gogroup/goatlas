---
# Tarefas — geradas por /tasks a partir do plan.md.
feature: "<nome-da-feature>"
plan: "./plan.md"
status: draft
created: "<YYYY-MM-DD>"
---

# Tasks: <Nome da Feature>

> Lista de tarefas **atômicas** derivada do `plan.md`. Cada tarefa: pequena,
> revisável e revertível isoladamente, e rastreável a um requisito.

## Legenda
- `[ ]` pendente · `[~]` em progresso · `[x]` concluída
- `[P]` paralelizável (sem dependência com as outras `[P]` do mesmo grupo)
- `_Requirements: FR-N_` — rastreabilidade obrigatória
- Se o projeto usa TDD, a tarefa de **teste** vem **antes** da implementação.

## Phase 1 — <ex.: Foundations / Contracts>
- [ ] **T-001** Descrição clara da tarefa. _Requirements: FR-1_
- [ ] **T-002** [P] Outra tarefa independente. _Requirements: FR-2_

## Phase 2 — <ex.: Implementation>
- [ ] **T-010** Escrever teste para X (Red). _Requirements: FR-1_
- [ ] **T-011** Implementar X até o teste passar (Green). _Requirements: FR-1_

## Phase 3 — <ex.: Integration / Polish>
- [ ] **T-020** Tarefa de integração/refino. _Requirements: NFR-performance_

---
## Coverage check (gate antes do /implement)
- [ ] Todo FR da spec aparece em ao menos uma tarefa
- [ ] Toda tarefa referencia um requisito
- [ ] A ordem respeita dependências (testes antes da impl, se TDD)
