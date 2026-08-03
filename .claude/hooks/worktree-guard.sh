#!/usr/bin/env bash
# PreToolUse (Edit|Write|NotebookEdit) — Princípio XII da constituição.
#
# Bloqueia edição de CÓDIGO na árvore principal fora de worktree. Várias sessões do
# Claude mexem no repo ao mesmo tempo; editar na principal atropela as outras.
#
# Libera sempre: artefatos de planejamento (docs/, specs/, .claude/, .specify/,
# *.md da raiz) — é onde o próprio fluxo SDD vive.
# Escape hatch: GOATLAS_ALLOW_MAIN_EDIT=1.
#
# Falha em silêncio (exit 0) em qualquer situação que não dê para avaliar.

set -uo pipefail

[ "${GOATLAS_ALLOW_MAIN_EDIT:-}" = "1" ] && exit 0
command -v jq >/dev/null 2>&1 || exit 0

INPUT="$(cat)"

FILE="$(echo "$INPUT" | jq -r '.tool_input.file_path // .tool_input.notebook_path // empty' 2>/dev/null)"
[ -z "$FILE" ] && exit 0
CWD="$(echo "$INPUT" | jq -r '.cwd // empty' 2>/dev/null)"

# Canoniza caminho: barras normais, /c/x e C:/x na mesma forma, minúsculas
# (Windows é case-insensitive). Só para COMPARAR — nunca para exibir.
norm() {
  printf '%s' "$1" | tr '\\' '/' | sed -E 's|^/([a-zA-Z])/|\1:/|' | tr 'A-Z' 'a-z'
}

# Caminho relativo → resolve contra o cwd da sessão.
case "$(norm "$FILE")" in
  /*|[a-z]:/*) ;;
  *) [ -n "$CWD" ] && FILE="$CWD/$FILE" ;;
esac

# Para consultar o git precisamos de um diretório que exista: sobe até achar um.
DIR="$(dirname "$FILE")"
while [ ! -d "$DIR" ]; do
  PARENT="$(dirname "$DIR")"
  [ "$PARENT" = "$DIR" ] && break
  DIR="$PARENT"
done
[ -d "$DIR" ] || exit 0

GIT_DIR="$(git -C "$DIR" rev-parse --git-dir 2>/dev/null)" || exit 0
TOPLEVEL="$(git -C "$DIR" rev-parse --show-toplevel 2>/dev/null)" || exit 0

# Dentro de worktree vinculado → liberado (é exatamente o que queremos).
case "$GIT_DIR" in */worktrees/*) exit 0 ;; esac

# Repo sem commit ainda (bootstrap) → liberado.
git -C "$DIR" rev-parse HEAD >/dev/null 2>&1 || exit 0

NF="$(norm "$FILE")"
NT="$(norm "$TOPLEVEL")"
REL="${NF#"$NT"/}"
# Não conseguiu relativizar (arquivo fora do repo?) → não avalia.
[ "$REL" = "$NF" ] && exit 0

# Allowlist: planejamento e configuração do processo.
case "$REL" in
  docs/*|specs/*|.claude/*|.specify/*|.gitignore|.gitattributes|license) exit 0 ;;
  */*) ;;
  *.md) exit 0 ;;
esac

BRANCH="$(git -C "$DIR" rev-parse --abbrev-ref HEAD 2>/dev/null)"

if [ "$BRANCH" = "main" ] || [ "$BRANCH" = "master" ]; then
  read -r -d '' REASON <<EOF || true
Bloqueado pelo worktree-guard do goatlas (constituição, Princípio XII).

Você está editando código na ÁRVORE PRINCIPAL, na branch '$BRANCH':
  $REL

Regra do projeto: qualquer tarefa que edite código começa com branch nova em
worktree isolado — outras sessões do Claude trabalham no mesmo repo e edições na
principal atropelam as delas.

Faça isto antes de editar (nomeie a branch pela TAREFA, não pelo arquivo):
  git -C "$TOPLEVEL" fetch origin
  git -C "$TOPLEVEL" worktree add .claude/worktrees/<branch> -b <branch>
e refaça a edição em .claude/worktrees/<branch>/$REL

Editando um artefato de planejamento (docs/, specs/, .claude/, .specify/, *.md da
raiz)? Esses são liberados na principal — confira o caminho.
Precisa mesmo editar aqui? GOATLAS_ALLOW_MAIN_EDIT=1 libera, mas registre o porquê.
EOF
  jq -n --arg r "$REASON" '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: $r
    }
  }'
  exit 0
fi

# Branch de trabalho, mas na árvore principal: avisa sem bloquear.
jq -n --arg b "$BRANCH" --arg f "$REL" '{
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    additionalContext: ("[goatlas] Editando \($f) na ÁRVORE PRINCIPAL (branch \($b)), fora de worktree. Funciona, mas o padrão do projeto é worktree isolado por tarefa (constituição, Princípio XII) — outras sessões do Claude usam este repo. Se esta sessão vai continuar mexendo em código, mova o trabalho para .claude/worktrees/\($b).")
  }
}'
