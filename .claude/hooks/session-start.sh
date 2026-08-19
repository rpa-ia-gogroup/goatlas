#!/usr/bin/env bash
# SessionStart — injeta o protocolo operacional do atlas em toda sessão.
# Re-dispara em resume/clear/compact para o protocolo sobreviver à compactação.
# Falha em silêncio; nunca bloqueia o início da sessão.

set -uo pipefail

read -r -d '' CTX <<'PROTOCOLO' || true
[atlas — protocolo do projeto, injetado por hook]

Este projeto usa Spec-Driven Development. A lei é `.specify/memory/constitution.md`
e a fonte da verdade dos requisitos é `docs/REQUISITOS.md` (IDs RF/RNF/RN/R/Q).
Leia `CLAUDE.md` antes de agir. O que se aplica sem ninguém pedir:

1. WORKTREE — qualquer tarefa que edite CÓDIGO começa criando branch + worktree em
   `.claude/worktrees/<branch>`. Um hook bloqueia edição de código na árvore
   principal. Planejamento (`docs/`, `specs/`, `.claude/`, `.specify/`, `*.md` da
   raiz) pode ser editado na principal.

2. SDD — feature/mudança não-trivial passa por `/specify` → `/clarify` → `/plan` →
   `/tasks` → `/analyze` → `/implement`. Toda tarefa e todo teste rastreiam a um ID
   (`_Requirements: RF-08, RN-01_`). Specs REFERENCIAM os IDs, não copiam os
   requisitos. Bug trivial não precisa do fluxo (Right-Sized Rigor).

3. DOCUMENTAÇÃO NO MESMO PR — mudou comportamento, mudaram os documentos:
   requisito → `docs/REQUISITOS.md`; decisão/Q respondida → `docs/DECISOES.md`;
   regra operacional ou gotcha → `CLAUDE.md`; escopo/cenário → a `spec.md`.
   Não espere ser pedido.

4. NÃO ADIVINHE — ambiguidade vira `[NEEDS CLARIFICATION: ...]` e pergunta. As
   perguntas Q1–Q13 de `docs/REQUISITOS.md` são bloqueio de implementação até
   estarem respondidas em `docs/DECISOES.md`.

5. TRAVAS QUE MORAM EM CÓDIGO, NUNCA EM PROMPT — RF-08 (create_ticket exige
   search_confluence E check_jira_history antes, na mesma conversa), RF-17
   (confirmação explícita), RF-30 (isolamento por e-mail), RF-32 (`internal=false`
   + filtro server-side). Com teste de bypass na suíte.

6. PT-BR com acentuação em todo texto visível. UI segue
   `identidade_visual_gogroup.md` (skill `frontend-design` antes de codar).

7. Três credenciais só em secrets do GoDeploy; nada de chamada à Atlassian ou à IA
   pelo navegador; negação por padrão em toda exposição de conteúdo.

Decisões que NÃO se "consertam" por engano (ver seção própria no CLAUDE.md):
proxy total via conta de serviço · bloqueio com override sempre disponível · SLA de
primeira resposta com 24h como piso · prioridade da IA editável · N8N descartado.
PROTOCOLO

if command -v jq >/dev/null 2>&1; then
  jq -n --arg ctx "$CTX" '{
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: $ctx
    }
  }'
else
  printf '%s\n' "$CTX"
fi
