---
feature: "MVP — agente de chamados e acompanhamento"
spec: "./spec.md"
status: draft          # draft | reviewed | approved
created: "2026-08-03"
---

# Implementation Plan: MVP — agente de chamados e acompanhamento

> Traduz a [`spec.md`](spec.md) em decisões técnicas. Respeita a
> [constituição](../../.specify/memory/constitution.md).
>
> ⚠️ **Este plano foi escrito com a spec ainda em `draft`**, por decisão registrada
> em `D-06`. Tudo que dependeu de pergunta não respondida está marcado
> **`[SUPOSIÇÃO]`** com a pergunta de origem. Suposição **não autoriza
> implementar** — ver *§9 Bloqueios*.

## 1. Technical Context

| | |
|---|---|
| **Linguagem / Runtime** | TypeScript strict · Cloudflare Worker no GoDeploy |
| **Frontend** | React 19 · TanStack Router (file-based SPA) · Tailwind v4 · shadcn/ui · Poppins e tokens de `identidade_visual_gogroup.md` |
| **Backend** | Worker único: `/api/*` + SPA fallback (`not_found_handling: single-page-application`) |
| **Dados** | `env.DB` (SQLite do GoDeploy), async, params sempre |
| **IA** | Proxy corporativo `ai-proxy.gogroupbr.com` (OpenAI-compatível) atrás de interface própria — `D-05` |
| **Integrações** | JSM REST + Confluence em `goengenharia.atlassian.net` (API token, Basic) · Organizations API em `api.atlassian.com/admin` (Bearer) — **só na Fase 2**, mas o secret é o mesmo cofre |
| **Build** | Vite 7 · npm · Vitest |
| **Restrições** | Sem WebSocket, sem processo longo, sem filesystem, sem TCP puro. Burst limits da Atlassian **não publicados** (`RNF-15`). Disponibilidade alvo 99% em horário comercial. |

## 2. Constitution Check (gates)

- [x] **Simplicity** — um Worker, um banco, sem serviço extra, sem fila externa (a
      "fila" de reprocessamento é uma tabela + cron da plataforma).
- [x] **No premature abstraction** — as duas únicas camadas de indireção
      (`atlassian/`, `ia/`) são **exigidas** por `RNF-22` e `RNF-23`; ver exceção
      declarada no Princípio V.
- [x] **Test-first viável** — todas as travas críticas são testáveis sem a
      Atlassian real, contra um cliente Atlassian fake (é para isso que a camada
      isolada serve).
- [x] **Right-sized** — Fase 1 é grande porque a fatia é grande; o que não é P0
      está explicitamente fora (§2 da spec).
- [x] **Princípio X (regra em código)** — o orquestrador de tools é um
      state machine de servidor; o LLM só *propõe* chamadas.
- [x] **Princípio XI (degradação)** — formulário mínimo (`D-04`) e marcação de
      "não verificado".
- [ ] **Princípio II (No Guessing)** — **violado conscientemente**, `D-06`. Ver
      *§7 Complexity Tracking*.

## 3. Architecture & Approach

```
Navegador (SPA React)
  │  cookie de sessão do edge GoDeploy
  ▼
┌──────────────────────────────────────────────────────────────┐
│ Worker atlas                                               │
│                                                              │
│  auth/        identidade do header do edge + allowlist de     │
│               domínio, revalidada A CADA requisição           │
│                                                              │
│  agent/       ORQUESTRADOR (state machine de servidor)        │
│    ├─ estado da conversa em env.DB, não na memória            │
│    ├─ decide quais tools o LLM PODE chamar agora              │
│    └─ create_ticket só existe como opção depois de            │
│       search_confluence E check_jira_history (RF-08)          │
│                                                              │
│  rules/       Regra 1 (score × threshold) · Regra 2           │
│               (classificação de resolução) · override         │
│                                                              │
│  tickets/     criação idempotente · outbox · vínculo          │
│  ia/          interface própria → proxy corporativo (RNF-23)   │
│  atlassian/   ÚNICA porta para a Atlassian (RNF-22)           │
│               cache · Retry-After · backoff+jitter · 429      │
│  audit/       append-only, inclusive falhas (RF-58)           │
└──────────────────────────────────────────────────────────────┘
```

### 3.1 A trava do `RF-08`: quem decide não é o modelo

O erro fácil aqui é "descrever as tools e mandar o modelo respeitar a ordem". Não.
O **servidor** mantém o estado da conversa e monta, a cada turno, o conjunto de
tools que o modelo tem permissão de chamar. `create_ticket` **não é oferecida** ao
modelo enquanto as duas verificações não constarem do estado persistido — e,
mesmo se o modelo a invocar por conta própria (nome inventado, retry, injeção), o
handler valida o estado e **recusa**, registrando em auditoria.

Duas camadas, ambas em código: *não oferecer* e *recusar se vier*. A segunda é a
que sobrevive a prompt injection (`RNF-08`, `R-07`).

O mesmo desenho vale para `RF-17`: a confirmação é uma **transição de estado
disparada por uma rota própria** que só o usuário aciona. O modelo não tem tool
capaz de confirmar em nome dele.

### 3.2 Regra 1 — score, não "achou"

`search_confluence` devolve páginas com score. A decisão de bloquear compara o
**melhor score** com um threshold em configuração (`RF-50`). Duas armadilhas
conhecidas: o score do CQL não é normalizado entre queries (então o threshold é
calibrado empiricamente, começando conservador — `R-04`), e a busca é restrita à
allowlist **na query**, não no filtro do resultado — negação por padrão de verdade
(`RN-06`).

Filtro em três condições simultâneas, todas antes de o conteúdo entrar no contexto
do LLM: espaço na allowlist **E** página sem restrição **E** sem label de bloqueio.

### 3.3 Regra 2 — classificar resolução, com cache

`check_jira_history` agrupa tickets pelo campo configurado `[SUPOSIÇÃO: label —
Q2]`, lê os comentários de resolução e classifica cada um em "ajuste operacional"
× "resolução real" via IA. O bloqueio dispara com recorrência acima do threshold
`[SUPOSIÇÃO: 3+ em 90 dias, a sugestão do próprio requisito — Q2/RF-11]`.

**Custo é o risco aqui** (`R-08`, `RNF-16`): a classificação lê vários tickets por
conversa. Mitigação no desenho: a classificação de um ticket é **cacheada por
`issueKey` + hash do comentário** — reclassificar o mesmo ticket é desperdício
puro — e a janela de histórico é limitada por configuração.

O prompt de classificação exige exemplos reais da Gocase (`RF-14`) —
**`[BLOQUEADA: Q3]`**, e essa é a que mais afeta qualidade: sem exemplos do
contexto da empresa a classificação erra, e erro aqui vira falso bloqueio (`R-04`),
que é o caminho mais rápido para a pessoa voltar ao Google Chat.

### 3.4 Nunca perder um chamado: outbox

`RNF-17` não se resolve com try/catch. A submissão confirmada é **persistida
primeiro** (`submissoes`, estado `pendente`), e só então a criação no JSM é
tentada. Falha → fica `pendente` e um **cron da plataforma** reprocessa. O usuário
vê o estado real ("recebemos e estamos abrindo"), nunca "não consegui".

O pior caso do sistema não é a Atlassian cair: é **criar no JSM e falhar ao gravar
o vínculo local** — o chamado existe e o autor não o vê (`RF-30` esconde o que não
tem vínculo). Por isso: a chave de idempotência vai **também** para o Jira (campo
customizado ou no corpo), e a reconciliação de `RNF-21` varre o Jira pelo campo
"Solicitante" para reconstruir vínculos órfãos. Sem isso, o `RF-22` é um ponto de
perda silenciosa.

### 3.5 Identidade

O edge do GoDeploy autentica e injeta o e-mail (`D-02`). O app trata esse header
como **a** identidade e revalida, a cada requisição: domínio na allowlist
`[SUPOSIÇÃO: só @gocase.com — Q7]` e conta ativa. Nenhum e-mail vindo de body,
query ou header customizado do cliente é aceito (`SC-04`).

## 4. Data Model

Tabelas em `env.DB`. Todas com `criado_em`; nomes em português, como o resto do
domínio.

| Tabela | Papel | Observações |
|---|---|---|
| `vinculos` | `issue_key` ↔ `solicitante_email` ↔ `criado_em` | **O artefato mais crítico** (`RF-22`, `RNF-17`). `issue_key` único; índice por e-mail. Base do `RF-30`. |
| `submissoes` | outbox de criação: payload, `chave_idempotencia` única, estado (`pendente`/`criado`/`falha`), tentativas, `issue_key` quando criado | `RF-24`, `RNF-17`. Reprocessada por cron. |
| `conversas` / `mensagens` | transcrição e **estado do orquestrador** (quais tools já rodaram, confirmação dada) | O estado do `RF-08` mora **aqui**, não na memória do Worker — Worker é stateless. |
| `bloqueios` | qual regra disparou, motivo, evidência (página/tickets), houve override | `RF-13`, `RF-42`, métricas de `O1` e `R-04`. |
| `classificacoes_ticket` | cache: `issue_key` + hash do comentário → classe | Contém `R-08`/`RNF-16`. |
| `auditoria` | append-only: quem, quando, ação, recurso, resultado | `RF-58`, `RN-10`. **Sem UPDATE/DELETE** no código. |
| `config` | thresholds, allowlists, TTLs, janela de histórico | `RF-49`, `RF-50` — mudança **sem deploy**, e é o que impede o hardcode do `RNF-25`. |

**Invariantes que o schema sustenta:** um chamado tem exatamente um solicitante
(`RN-03`, único em `vinculos.issue_key`); sem vínculo não há acesso (`RN-04`);
`chave_idempotencia` única garante `RF-24` no banco, não na aplicação.

## 5. Contracts / Interfaces

### Rotas (`/api/*`)

| Rota | Papel |
|---|---|
| `GET /api/auth/me` | e-mail, nome, `isAdmin` — derivados do edge, resolvidos no servidor |
| `POST /api/conversas` · `POST /api/conversas/:id/mensagens` | conversa com o agente |
| `POST /api/conversas/:id/confirmar` | **a** transição que autoriza criar (`RF-17`) — só o usuário chama |
| `POST /api/conversas/:id/override` | registra que a documentação não resolveu (`RF-13`) |
| `POST /api/chamados` | formulário mínimo, caminho sem IA (`D-04`) |
| `GET /api/chamados` · `GET /api/chamados/:key` | "Meus chamados" e detalhe — filtrados por vínculo no servidor |
| `POST /api/chamados/:key/comentarios` | comentário público (`RF-33`) |
| `GET /api/health` | `RF-59` |
| `POST /api/cron/reprocessar-submissoes` | outbox; valida `X-Godeploy-Cron` |
| `POST /api/cron/reconciliar-vinculos` | `RNF-21` |

### Interface da camada de IA (`RNF-23`)

Uma função de chat com tools e uma de classificação. Nada de tipo do provedor
escapando para a lógica de negócio — trocar de modelo ou provedor não deve tocar
`rules/` nem `agent/`. Timeout com fallback direto ao provedor, herdado da lição do
godocs (`D-05`).

### Interface do cliente Atlassian (`RNF-22`)

Métodos de domínio (`criarChamado`, `buscarConfluence`, `listarComentariosPublicos`,
…) — **não** um wrapper genérico de HTTP. É o que torna a migração para
`raiseOnBehalfOf` (`D-01`) uma mudança localizada: hoje `criarChamado` usa a conta
de serviço; depois, o mesmo método passa `raiseOnBehalfOf`. Se rota de API da
Atlassian aparecer fora desta pasta, a saída de emergência do `R-01` deixou de
existir.

`listarComentariosPublicos` **encapsula a pegadinha**: envia
`?public=true&internal=false` (o default de `internal` é `true`) **e** filtra pelo
campo `public` de cada item. Duas camadas, uma função (`RF-32`).

## 6. Test Strategy

| Requisito | Tipo | Onde |
|---|---|---|
| `RF-08`/`RN-01` | **bypass**: chamada direta ao handler sem estado + conversa adversarial + injeção via conteúdo do Confluence | `tests/rf08-ordem-tools.test.ts` |
| `RF-17`/`RN-02` | **bypass**: tentar criar sem passar por `/confirmar` | `tests/rf17-confirmacao.test.ts` |
| `RF-30`/`RN-04` | **bypass**: `issue_key` de outro usuário por URL e por parâmetro | `tests/rf30-isolamento.test.ts` |
| `RF-32`/`RN-05` | unit no cliente Atlassian: query correta **e** filtro; fixture com comentário interno | `tests/rf32-comentarios.test.ts` |
| `RF-04`/`RF-05` | **bypass**: e-mail vindo do cliente; conta desativada | `tests/auth.test.ts` |
| `RF-24` | integração: submissão concorrente duplicada → 1 chamado | `tests/rf24-idempotencia.test.ts` |
| `RNF-17` | integração com Atlassian fake falhando → submissão sobrevive e reprocessa | `tests/outbox.test.ts` |
| `RNF-18`/`D-04` | IA fake indisponível → formulário funciona; tool falha → "não verificado", não bypass | `tests/degradacao.test.ts` |
| `RN-06` | unit: espaço fora da allowlist, página restrita, label de bloqueio — as três | `tests/rn06-confluence.test.ts` |
| `RF-09`/`RF-10` | unit puro nas funções de decisão (score × threshold; recorrência × threshold) | `tests/regras.test.ts` |
| `RF-58` | integração: ação que falha **também** gera registro | `tests/auditoria.test.ts` |

**Decisão de testabilidade:** as regras são **funções puras** que recebem
resultado de busca/histórico e devolvem decisão. O que fala com a rede fica nas
camadas isoladas, substituídas por fake nos testes. Sem isso, testar a Regra 2
exigiria Jira real e a suíte não roda em PR.

## 7. Complexity Tracking (exceções justificadas)

| Decisão | Princípio tensionado | Por que vale a pena |
|---|---|---|
| Planejar as 4 fases com suposições marcadas | **II — No Guessing** | `D-06`: visão completa do trabalho antes de começar. Mitigado por marcação obrigatória, tarefas `[BLOQUEADA: Qn]` e revisão (não remendo) quando a resposta chegar. |
| Camadas `atlassian/` e `ia/` | V — sem wrapper à toa | São `RNF-22`/`RNF-23` — a saída de emergência de `R-01` e `R-09`. Exceção já declarada na constituição. |
| Outbox + cron para criar chamado | V — simplicidade | `RNF-17`: perder o chamado de alguém destrói a confiança no app de uma vez. Try/catch não sobrevive a Worker sem processo longo. |
| Estado da conversa no banco | V — simplicidade | Worker é stateless; a trava do `RF-08` **precisa** de estado durável, senão basta abrir outra requisição para burlar. |

## 8. File / Build Order

Ordem: contratos → testes → código que faz passar.

1. `src/lib/db/schema.ts` + migração idempotente (tabelas de §4)
2. `src/lib/atlassian/tipos.ts` (contrato) e `src/lib/ia/tipos.ts` (contrato)
3. **Fakes** de Atlassian e IA — habilitam tudo abaixo sem rede
4. **Testes de bypass** (§6) — vermelhos de propósito
5. `src/lib/auth/` — identidade do edge + allowlist de domínio
6. `src/lib/audit/` — append-only
7. `src/lib/atlassian/cliente.ts` — cache, `Retry-After`, backoff+jitter, 429
8. `src/lib/ia/cliente.ts` — proxy corporativo, timeout, fallback
9. `src/lib/rules/` — funções puras da Regra 1 e 2
10. `src/lib/agent/orquestrador.ts` — state machine, gate do `RF-08`
11. `src/lib/tickets/` — outbox, idempotência, vínculo, reconciliação
12. Rotas `/api/*` (§5) + `worker.ts`
13. Frontend: conversa → confirmação → meus chamados → detalhe → formulário mínimo
14. `docs/DEPLOY.md` (rotação das 3 credenciais, `RNF-10`/`RNF-27`) + staging

## 9. Bloqueios — o que **não** pode ser implementado ainda

| Bloqueio | Trava | Some quando |
|---|---|---|
| **Q1** conta de serviço e privilégios | Qualquer chamada real à Atlassian. Passos 7 e 11 só rodam contra o fake. | João criar a conta e informar os privilégios |
| **Q2** campo de agrupamento da Regra 2 | `RF-10`/`RF-11` — o agrupamento é o coração da regra | João + time de tech |
| **Q3** exemplos reais de "ajuste operacional" | O prompt de classificação (`RF-14`). É pré-requisito, não refinamento | João + tech/dados |
| **Q4** campo "Solicitante" existe? | `RF-21` e a reconciliação de `RNF-21` | João + time de tech |
| **Q7** domínios válidos | A allowlist de domínio de `RF-01`/`RF-05` | João |
| **Q6 (resto)** retenção do provedor de IA | Não trava código; trava **rollout** (`RNF-34`) | João verificar com o fornecedor |
| Comportamento do edge com conta desativada | O quanto de `RF-05` é do app | Verificação técnica no GoDeploy (minha) |
| Como atribuir comentário ao solicitante real | `RF-33` | Alinhamento com o time de tech (liga a `R-03`/Q10) |

**Suposições assumidas neste plano** (`D-06`) — cada uma marcada no texto:
agrupamento por **label** (Q2) · recorrência **3+ em 90 dias** (Q2/`RF-11`) ·
domínio **só `@gocase.com`** (Q7). Se uma delas mudar, as tarefas correspondentes
são **reabertas**, não corrigidas de raspão.
