#!/usr/bin/env bash
# PreToolUse (Bash) — gate de documentação viva (constituição, Princípio XIII).
#
# Dispara em `git commit` e em `gh pr create`. Nunca bloqueia: informa.
#   - commit: lembra o gate de documentação e os testes das travas críticas (1x por sessão).
#   - gh pr create: compara o diff da branch contra a base e avisa quando o PR toca
#     código sem tocar documentação.

set -uo pipefail
command -v jq >/dev/null 2>&1 || exit 0

INPUT="$(cat)"
CMD="$(echo "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)"
CWD="$(echo "$INPUT" | jq -r '.cwd // empty' 2>/dev/null)"
SESSION="$(echo "$INPUT" | jq -r '.session_id // empty' 2>/dev/null)"
[ -z "$CMD" ] && exit 0

STATE_DIR="${TMPDIR:-/tmp}/atlas-hooks"
mkdir -p "$STATE_DIR" 2>/dev/null || true

MSG=""

# ---------- gh pr create -------------------------------------------------------
if echo "$CMD" | grep -qE '\bgh\s+pr\s+create\b'; then
  MSG+="[atlas] Antes de abrir o PR (constituição, Princípios IX e XIII):
- \`git fetch origin\` e incorpore \`origin/main\` — main anda por causa da regra de worktree.
- \`npm run test\` passando, incluindo os testes de bypass das travas críticas (RF-08, RF-17, RF-30, RF-32).
- Documentação atualizada NO MESMO PR: \`docs/REQUISITOS.md\` (requisito), \`docs/DECISOES.md\` (decisão/Q respondida), \`CLAUDE.md\` (regra operacional/gotcha), a \`spec.md\` da feature (escopo/cenário).
- Nenhuma das três credenciais no diff."

  if [ -n "$CWD" ] && git -C "$CWD" rev-parse --git-dir >/dev/null 2>&1; then
    BASE="$(git -C "$CWD" rev-parse --verify --quiet origin/main >/dev/null 2>&1 && echo origin/main || echo main)"
    CHANGED="$(git -C "$CWD" diff --name-only "$BASE"...HEAD 2>/dev/null)"
    if [ -n "$CHANGED" ]; then
      TOCA_CODIGO="$(echo "$CHANGED" | grep -cE '^(src|tests|scripts)/|^(worker|package|vite|tsconfig)' 2>/dev/null || true)"
      TOCA_DOC="$(echo "$CHANGED" | grep -cE '^(docs|specs)/|^CLAUDE\.md$|^\.specify/' 2>/dev/null || true)"
      if [ "${TOCA_CODIGO:-0}" -gt 0 ] && [ "${TOCA_DOC:-0}" -eq 0 ]; then
        MSG+="

⚠️  Este diff toca código (${TOCA_CODIGO} arquivo(s) em src/tests/scripts) e NÃO toca documentação
alguma (docs/, specs/, CLAUDE.md). Pelo Princípio XIII isso é uma lacuna, não um
detalhe: decida e diga explicitamente qual documento deveria mudar — ou justifique
por que a mudança é invisível para requisito, decisão, regra operacional e spec."
      fi
    fi
  fi
fi

# ---------- git commit (1x por sessão) ----------------------------------------
if echo "$CMD" | grep -qE '\bgit\b.*\bcommit\b'; then
  MARKER="$STATE_DIR/${SESSION:-nosession}-commit.seen"
  if [ ! -f "$MARKER" ]; then
    touch "$MARKER" 2>/dev/null || true
    [ -n "$MSG" ] && MSG+="

"
    MSG+="[atlas] Lembrete de commit (1x por sessão): documentação viva é gate, não cortesia
(Princípio XIII) — requisito → \`docs/REQUISITOS.md\`, decisão/Q respondida →
\`docs/DECISOES.md\`, regra operacional ou gotcha → \`CLAUDE.md\`, escopo/cenário → a
\`spec.md\`. E marque \`[x]\` no \`tasks.md\` as tarefas concluídas."
  fi
fi

[ -z "$MSG" ] && exit 0

jq -n --arg ctx "$MSG" '{
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    additionalContext: $ctx
  }
}'
