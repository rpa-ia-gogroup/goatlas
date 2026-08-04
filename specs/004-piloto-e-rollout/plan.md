---
feature: "Piloto, calibragem e rollout"
spec: "./spec.md"
status: draft
created: "2026-08-04"
---

# Implementation Plan: Piloto, calibragem e rollout

> ⚠️ **Esta fase é diferente das outras: o trabalho principal não é código.** Um
> plano técnico aqui corre o risco de fingir que adoção é problema de engenharia. Não
> é — `R-06` é o risco de maior severidade do produto e se resolve com combinação
> entre pessoas. O que este plano faz é listar o **pouco** de código que o piloto
> exige, e ser explícito sobre o que é do Produto.

## 1. Technical Context

Nada de novo na stack. O que o piloto exige de código:

| Necessidade | Por quê |
|---|---|
| **Escopo de piloto** | Liberar o app para 1–2 áreas sem abrir para a empresa |
| **Roteamento por área** (`RF-19`) | O chamado precisa cair na fila certa |
| **Thresholds ajustáveis com dado** | Já existe (`RF-50`); o que falta é a leitura que orienta o ajuste |
| **Comparação antes × depois** | `O2` precisa do baseline da Fase 0 |

## 2. Constitution Check

- [x] **Simplicity** — o escopo de piloto é uma allowlist a mais, não um sistema de
      feature flag.
- [x] **Right-sized** — é a fase de menos código do projeto, e o plano reflete isso.
- [ ] **Princípio II** — Q9, Q10 e Q13 em aberto, e todas são de pessoas.

## 3. Architecture & Approach

### 3.1 Escopo de piloto: uma allowlist, não um sistema de flags

`config.emails_piloto` (ou `areas_piloto`): fora da lista, o app responde com uma
tela explicando que ainda está em piloto e por onde pedir no meio-tempo. Não é
negação de acesso — é encaminhamento honesto.

Deliberadamente **não** é feature flag por usuário, nem percentual de rollout: são
1–2 áreas nomeadas (`Q13`), e uma lista de e-mails resolve. Construir infraestrutura
de rollout gradual para isso seria a definição de over-engineering.

### 3.2 Roteamento por área (`RF-19`)

Mapa `e-mail → área` em config, alimentado pela tabela da seção 3 dos requisitos, e
**correção manual sempre disponível**: o mapa envelhece, e pessoa que muda de área é
a regra, não a exceção. O roteamento sugere; a pessoa confirma no recibo (mesmo
padrão de `RF-16` com a prioridade).

⚠️ Isto interage com `R-03`: o time de tech precisa que o roteamento funcione, senão
todo chamado cai numa fila só e a mudança de reporter piora a vida deles em vez de
melhorar.

### 3.3 A calibragem precisa de leitura, não de código novo

Os thresholds já são configuráveis sem deploy (`RF-50`) e as métricas já existem
(Fase 3). O que falta é a **leitura que orienta**: para cada regra, a taxa de
override ao lado do threshold atual. Sem isso o ajuste é intuição — e o requisito
manda apertar **com dado** (`R-04`).

**A resposta certa a override alto pode não ser mexer no número.** Override é sinal
de documentação ruim (`RF-13`): a ação pode ser escrever a página que falta. A tela
precisa mostrar *qual página* foi apontada nos overrides, senão ela empurra para o
ajuste de threshold por ser o botão mais fácil.

### 3.4 Antes × depois (`O2`)

O baseline vem da **Fase 0**, que é do João e não tem código. O app guarda o número
informado em config e mostra a comparação — não tenta recalcular o passado, que
seria inventar dado.

## 4. Data Model

| Tabela / config | Papel |
|---|---|
| `config.emails_piloto` | Escopo do piloto |
| `config.mapa_areas` | `e-mail → área` (`RF-19`) |
| `config.baseline_assentos` | Número da Fase 0, para o antes × depois de `O2` |
| `area` em `vinculos` | Área resolvida na criação — permite métrica por área sem reconsultar o Jira |

## 5. Test Strategy

| Requisito | Tipo |
|---|---|
| Escopo de piloto | **bypass**: e-mail fora do piloto não abre chamado, e recebe encaminhamento (não erro cru) |
| `RF-19` | unit puro: mapa → área; e-mail desconhecido → sem área, nunca área errada |
| `RF-19` | integração: correção manual sobrevive à sugestão |
| `O2` | unit: comparação com baseline ausente **não** inventa número |

## 6. Complexity Tracking

| Decisão | Princípio tensionado | Por quê |
|---|---|---|
| Allowlist em vez de feature flag | — | É o simples que resolve. A tensão seria o contrário |
| Guardar `area` em `vinculos` | Normalização | Métrica por área sem reconsultar o Jira; e a área **no momento da criação** é o dado histórico correto, mesmo que a pessoa mude de área depois |

## 7. File / Build Order

1. `config.emails_piloto` + gate de piloto com tela de encaminhamento
2. `piloto/areas.ts` — mapa → área, função pura
3. `area` em `vinculos` + preenchimento na criação
4. Correção manual de área no recibo
5. Leitura de calibragem: threshold + taxa de override + **páginas apontadas**
6. Antes × depois com o baseline da Fase 0

## 8. O que **não** é código, e é o que decide a fase

Listado aqui porque um plano que omite isso mente sobre o esforço:

| Item | De quem | Sem isso |
|---|---|---|
| **Alinhar com o time de tech** que o reporter muda (`R-03`, **Q10**) | João | O piloto começa quebrando a fila de quem precisa trabalhar os chamados. É **pré-condição**, não tarefa paralela |
| **Automação no Jira** roteando pelo campo "Solicitante" | Time de tech ou nós — **em aberto** | O campo customizado é dado morto e todo chamado chega como "aberto pelo robô" |
| **Comunicar o SLA de 24h como piso** (`R-05`, **Q9**) | João + Produto | Growth, CX e E-comm (retorno atual de 2h30) percebem o projeto como piora |
| **Combinar com os líderes** que o canal oficial passa a ser o app (`O5`) | João | Aderência baixa sem o app ser ruim — e os dois problemas exigem respostas diferentes |
| **Escolher as áreas** (`Q13`) | João | Sugestão do requisito: CX (alto volume, alta maturidade) + Produção (baixo volume) |
| **Acordar SLA formalmente com as 12 áreas** (hoje **zero de 12**) | João + Produto | O app mede aderência a um número que ninguém prometeu |
| **Revisão trimestral** de `D-01` (`RNF-35`) | João | `R-01`/`R-03` deixam de ser reavaliados contra o que de fato aconteceu |

## 9. Bloqueios

Todos. Esta fase é a única em que os bloqueios **são** o trabalho: Q9, Q10, Q13, a
automação no Jira e o acordo de SLA. O código de §7 é pequeno e dá para adiantar; o
piloto não começa sem as linhas de §8.
