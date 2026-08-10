---
feature: "Console de administração organizado por capacidade"
id: "003"
spec: "./spec.md"
---

# Plano 003 — HOW

## Decisões estruturais

**O diagnóstico é função pura, no `lib`, não na tela.** `diagnosticar(config)` vive
em `src/lib/config/diagnostico.ts` e devolve dados; a tela só desenha. Duas razões:
testar "com espaço vazio a busca está desligada" não deveria precisar de DOM, e a
frase de consequência é conhecimento de domínio — se ficar dentro do JSX, o dia que
`RN-06` ganhar uma condição a tela mente sem ninguém perceber.

⚠️ **O diagnóstico não reimplementa regra.** Ele lê os mesmos valores que o servidor
lê e afirma o mesmo que o código já faz (allowlist vazia nega, exemplos vazios
desligam a Regra 2, `custoConfigurado` falso mostra contagem). Qualquer condição
nova aqui é sinal de que a regra devia estar no `lib` de origem.

**A validação de tipo é da rota, não do editor.** `validarValorDeConfig` em
`src/lib/config/validar.ts`, chamada por `PUT /api/admin/config`. Hoje a rota checa
só se a chave existe e grava `valor as never` — um `PUT` fora da tela pode gravar
`"alto"` em `regra1_threshold_score`, e o `JSON.parse` de `Config.carregar` aceita,
porque o JSON é válido. O default fail-closed não protege disto: o valor corrompido
**é** o valor. É o mesmo padrão das outras travas — o servidor recusa, a tela é
conveniência.

**Navegação por estado, como o resto do app** (Princípio V). O console é um `useState`
de seção. Nada de router: `App.tsx` já navega assim e o deep link do Confluence é
leitura única no boot, não roteamento.

**Um `PUT` por chave, mantido.** Cada salvamento é um registro de auditoria com o
nome da chave (`RF-56`). Batch trocaria isso por um "config_alterada" genérico.

## Arquivos

| Arquivo | O quê |
|---|---|
| `src/lib/config/diagnostico.ts` | **novo** — capacidades, estado e consequência, puro |
| `src/lib/config/validar.ts` | **novo** — tipo esperado por chave |
| `src/lib/http/rotas.ts` | `PUT /api/admin/config` passa a validar |
| `src/app/admin/index.tsx` | **novo** — casca, trilha de seções, estado |
| `src/app/admin/campos.tsx` | **novo** — descritores em linguagem de decisão + editores |
| `src/app/admin/paineis.tsx` | **novo** — métricas, assentos, lacunas, auditoria |
| `src/app/admin.tsx` | **removido** — vira a pasta acima |
| `src/app/api.ts` | espelha as 3 chaves de assento; `ConfigValores` alinhado |
| `src/app/estilos.css` | trilha lateral, cartões de capacidade, campo com efeito |
| `src/app/App.tsx` | rótulo da aba: "Configuração" → "Administração" |

## Layout

Trilha lateral a partir de 900px, faixa de pílulas rolável abaixo disso (`RNF-28`).
A trilha carrega o estado de cada seção — é navegação **e** diagnóstico, o mesmo
princípio da trilha de verificação da conversa: o motivo dos três círculos da marca
carregando informação em vez de decoração.

```
┌───────────────────┬──────────────────────────────────┐
│ CONFIGURAR        │  Quando o agente interrompe      │
│  Visão geral      │  ────────────────────────────    │
│  Quem entra    ⚠  │  [3 controles no máximo]         │
│ ▸Chamados      ✓  │                                  │
│  Documentação  ⚠  │  ↓ o dado que calibra o ajuste   │
│  Interrupções  ✓  │  Taxa de override · deflexão     │
│  Custo         ✓  │                                  │
│ ACOMPANHAR        │                                  │
│  Assentos      —  │                                  │
│  Auditoria        │                                  │
└───────────────────┴──────────────────────────────────┘
```

## Riscos

- **Retrabalho de copy.** Mitigado escrevendo os descritores como dado
  (`campos.tsx`), não espalhados no JSX: mudar uma frase é mudar uma linha.
- **Remover o rate limit da tela** é a única perda de superfície. Registrado em
  `D-25`; restaurar é adicionar um descritor.
- **Teste de tela sem navegador.** Mesmo caminho de `tests/tela-confluence.test.ts`:
  `renderToStaticMarkup` afirmando o que a tela **diz**, não como parece.
