#!/usr/bin/env bash
# PreToolUse (GoDeploy createApp|updateApp) — regra 10 do CLAUDE.md: staging antes de prod.
# Nunca bloqueia; injeta a checklist que já custou bug em outro app da casa.

set -uo pipefail
command -v jq >/dev/null 2>&1 || exit 0

INPUT="$(cat)"
APP_ID="$(echo "$INPUT" | jq -r '.tool_input.appId // "novo app"' 2>/dev/null)"

read -r -d '' MSG <<EOF || true
[atlas] Deploy no GoDeploy — appId: $APP_ID

1. STAGING ANTES DE PROD (CLAUDE.md, regra 10). Confirme qual appId é este antes de
   seguir; mudança de código só chega a produção depois de validada na staging.
2. Testes e build rodados nesta ordem: \`npm run test && npm run build\`.
3. \`assets\` DERIVADA DO \`dist/\` REAL, varrido recursivamente agora — os hashes do
   Vite mudam a cada build e lista antiga (ou só \`assets/*\`) dá tela branca ou
   ícone faltando. Nunca reaproveite uma lista de um deploy anterior.
4. \`assetConfig.not_found_handling: "single-page-application"\` e \`entrypoint\`
   explícito.
5. \`uploadId\` é single-use — um por deploy.
6. As três credenciais são secrets do GoDeploy (\`setAppSecret\`), nunca arquivo do
   upload. Confira que nenhuma entrou no bundle.
EOF

jq -n --arg ctx "$MSG" '{
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    additionalContext: $ctx
  }
}'
