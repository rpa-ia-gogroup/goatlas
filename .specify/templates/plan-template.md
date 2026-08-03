---
# Plano de Implementação — gerado por /plan. O HOW.
feature: "<nome-da-feature>"
spec: "./spec.md"
status: draft          # draft | reviewed | approved
created: "<YYYY-MM-DD>"
---

# Implementation Plan: <Nome da Feature>

> Traduz a spec **aprovada** em decisões técnicas. Toda escolha aqui deve
> respeitar a `constitution.md`. **Não comece** enquanto a spec tiver
> `[NEEDS CLARIFICATION]` em aberto.

## 1. Technical Context
- **Linguagem / Runtime:**
- **Frameworks / Libs principais:**
- **Armazenamento / Dados:**
- **Integrações externas:**
- **Restrições (perf, prazo, infra, compliance):**

## 2. Constitution Check (gates)
<!-- Responda cada gate. Violou? Justifique em Complexity Tracking ou simplifique. -->
- [ ] **Simplicity** — é a solução mais simples que satisfaz a spec? (sem over-engineering)
- [ ] **No premature abstraction** — usando frameworks direto, sem wrappers à toa?
- [ ] **Test-first viável** — dá pra verificar cada requisito antes de codar?
- [ ] **Right-sized** — a cerimônia é proporcional ao tamanho da mudança?
- [ ] **[Princípios específicos do projeto]** —

## 3. Architecture & Approach
<!-- Componentes, fluxo de dados, decisões-chave e alternativas descartadas.
     Diagramas em texto/ASCII se ajudarem. -->

## 4. Data Model
<!-- Entidades, campos, relações, invariantes, migrações. -->

## 5. Contracts / Interfaces
<!-- APIs, schemas, eventos, contratos de CLI. Um bloco por subsistema. -->

## 6. Test Strategy
<!-- Como cada requisito será verificado. Mapeie FR → tipo de teste. -->
| Requisito | Tipo de teste            | Onde |
|-----------|--------------------------|------|
| FR-1      | contract / integration / unit | |

## 7. Complexity Tracking (exceções justificadas)
<!-- Qualquer violação de princípio aceita conscientemente, com o porquê.
     Tabela vazia é um bom sinal. -->
| Decisão | Princípio tensionado | Por que vale a pena |
|---------|----------------------|---------------------|

## 8. File / Build Order
<!-- Ordem de criação. Default SDD: contracts → testes → código que faz passar. -->
1.
