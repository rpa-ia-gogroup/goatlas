---
# Especificação de Feature — gerada por /specify. WHAT/WHY apenas.
feature: "<nome-curto-da-feature>"
id: "<NNN>"            # sequencial: 001, 002, ...
status: draft          # draft | clarified | planned | in-progress | done
created: "<YYYY-MM-DD>"
spec_version: 1
---

# Spec: <Nome da Feature>

> **Regra de ouro:** esta spec descreve **WHAT** (o quê) e **WHY** (por quê).
> O **HOW** (stack, libs, arquitetura, SQL, nomes de classe) vai no `plan.md`.
> Se sentir vontade de citar tecnologia aqui, pare — é decisão de plano.
> **Não invente:** marque ambiguidades com `[NEEDS CLARIFICATION: <pergunta>]`.

## 1. Problem & Why
<!-- Que problema de usuário/negócio isto resolve? Por que agora? Qual o custo
     de NÃO fazer? Mantenha curto e concreto. -->

## 2. Goals / Non-Goals
**Goals**
-

**Non-Goals (explicitamente fora de escopo)**
<!-- Tão importante quanto os goals. É aqui que se evita o escopo inflar. -->
-

## 3. Users & Context
<!-- Quem usa? Em que situação? Pré-condições/ambiente relevantes. Apague se óbvio. -->

## 4. User Stories
<!-- Formato: As a <persona>, I want <capacidade>, so that <benefício>. -->
- **US-1** — As a ..., I want ..., so that ...

## 5. Scenarios (Given / When / Then)
<!-- Comportamento observável e testável. Um cenário por caminho relevante,
     incluindo caminhos de erro. -->
- **SC-1** (US-1)
  - **Given** ...
  - **When** ...
  - **Then** ...

## 6. Functional Requirements (EARS)
<!--
Notação EARS (Easy Approach to Requirements Syntax) — cada requisito testável e
numerado (FR-N). Padrões:
  • Ubiquitous:   THE SYSTEM SHALL <resposta>
  • Event-driven: WHEN <gatilho> THE SYSTEM SHALL <resposta>
  • State-driven: WHILE <estado> THE SYSTEM SHALL <resposta>
  • Unwanted:     IF <condição>, THEN THE SYSTEM SHALL <resposta>
  • Optional:     WHERE <feature presente> THE SYSTEM SHALL <resposta>
-->
- **FR-1** — WHEN <...> THE SYSTEM SHALL <...>
- **FR-2** — THE SYSTEM SHALL <...>
- **FR-3** — IF <...>, THEN THE SYSTEM SHALL <...>

## 7. Non-Functional Requirements
<!-- Só o que for real para esta feature. Apague as linhas não aplicáveis. -->
- **Performance:**
- **Security / Privacy:**
- **Reliability / Availability:**
- **Accessibility / i18n:**
- **Observability:**

## 8. Edge Cases & Error Conditions
-

## 9. Success Criteria (measurable)
<!-- Como saberemos que deu certo? Métricas/condições verificáveis, não "vibes". -->
- **ScC-1** —

## 10. Open Questions
<!-- Todo `[NEEDS CLARIFICATION]` do texto acima deve aparecer aqui, resolvido
     ou pendente. -->
- [ ] [NEEDS CLARIFICATION: ...]

## 11. Out of Scope (defer)
-

---
## Requirement Completeness — checklist (gate antes do /plan)
- [ ] Nenhum `[NEEDS CLARIFICATION]` pendente
- [ ] Todo FR é testável e não-ambíguo
- [ ] Todo FR mapeia a pelo menos um Scenario
- [ ] Success Criteria são mensuráveis
- [ ] Non-Goals / Out of Scope explícitos
- [ ] Nenhum detalhe de implementação (HOW) vazou para a spec
