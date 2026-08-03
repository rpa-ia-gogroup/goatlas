---
feature: "SLA, notificações e métricas"
id: "003"
status: draft
created: "2026-08-03"
spec_version: 1
requirements: "../../docs/REQUISITOS.md"
scope_ids: "M5 RF-44…48 · RF-55 · RF-60 · RF-34…36 (P1/P2 de M3)"
---

# Spec 003: SLA, notificações e métricas

> **Profundidade proporcional à distância** (Princípio VI). Fecha o essencial;
> aprofunda quando as Fases 1–2 estiverem em produção. Referencia IDs de
> [`REQUISITOS.md`](../../docs/REQUISITOS.md).

## 1. Problem & Why

Na Fase 1 o colaborador precisa **voltar ao app** para saber se algo andou. Isso
mata a adoção (`R-06`): o Google Chat avisa, o app não — então o Google Chat ganha.

E o SLA, que é a promessa central do produto (`O4`), não tem quem o vigie: sem
alerta de estouro, "SLA de primeira resposta em 24h" é aspiração, não compromisso.

Por último, sem o painel de métricas, os thresholds das regras são calibrados por
intuição — quando o requisito manda começar conservador e **apertar com dado**
(`R-04`).

## 2. Goals / Non-Goals

**Goals**
- O solicitante é avisado onde ele já vive, sem precisar voltar ao app.
- O time é avisado **antes** do SLA estourar, não depois.
- Deflexão, override, aderência de canal e aderência de SLA são números visíveis.

**Non-Goals**
- SLA de resolução. É de **primeira resposta** (`RN-08`) — e isso precisa estar
  explícito em toda comunicação do app, não só na documentação.
- Notificar o próprio autor da ação que ele acabou de fazer (`RF-48`).
- Substituir as reuniões recorrentes por área (iniciativa paralela).

## 3. Scenarios (Given / When / Then)

- **SC-01** · `RF-44`
  - **Given** um chamado criado
  - **When** a criação conclui
  - **Then** o solicitante é notificado com número, prioridade e **prazo de primeira
    resposta**; e depois a cada mudança de status e a cada comentário **público**.
- **SC-02** · `RF-45`, `Q11`
  - **Given** a preferência de canal do usuário
  - **When** há algo a notificar
  - **Then** vai por Google Chat e/ou e-mail conforme a preferência. Google Chat é
    onde as áreas já vivem hoje — é lá que a notificação é lida.
- **SC-03** · `RF-47`
  - **Given** um webhook do Jira registrado pela **administração** (`jira:issue_updated`,
    `comment_created`)
  - **When** o evento chega
  - **Then** a mudança é detectada sem polling. **Nota que não pode se perder:** o
    endpoint de webhook dinâmico via REST (`/rest/api/3/webhook`, expiração de 30
    dias) é para apps Connect/OAuth 2.0 e **não se aplica** a integração por API
    token — daí o registro ser pela administração.
- **SC-04** · `RF-47`
  - **Given** o webhook indisponível, não registrado ou com evento perdido
  - **When** o tempo passa
  - **Then** um polling incremental por JQL cobre a lacuna. Notificação é a promessa
    do produto: não pode depender de um único mecanismo.
- **SC-05** **[bypass]** · `RF-48`
  - **Given** uma requisição no endpoint de webhook **sem** o segredo compartilhado,
    ou de origem inesperada
  - **When** ela chega
  - **Then** rejeitada. Webhook é rota pública: sem autenticação, qualquer um
    fabrica evento e dispara notificação em nome do sistema.
- **SC-06** · `RF-48`
  - **Given** uma ação feita pelo próprio usuário no app
  - **When** o webhook correspondente volta
  - **Then** ele **não** é notificado da própria ação.
- **SC-07** · `RF-46`
  - **Given** um chamado se aproximando do limite de primeira resposta
  - **When** o limiar configurado é atingido
  - **Then** o time de produto/tech é alertado **antes** do estouro.
- **SC-08** · `RF-55`
  - **Given** dados acumulados desde a Fase 1
  - **When** o admin abre o painel
  - **Then** vê taxa de deflexão **por regra**, taxa de override, chamados por área
    e prioridade, aderência ao SLA, aderência de canal (app × chat/reunião/Jira
    direto) e buscas sem resultado.
- **SC-09** · `RF-60`
  - **Given** tráfego real contra a Atlassian
  - **When** a taxa de 429 ou o custo/latência da IA passa o limiar configurado
  - **Then** há alerta. Como os burst limits do API token **não são publicados** e
    os headers `X-RateLimit-*` só aparecem **em respostas 429**, medir 429 é a única
    telemetria de orçamento que existe (`RNF-15`).
- **SC-10** · `RF-34`, `RF-35`, `RF-36`
  - **Given** um chamado do próprio colaborador
  - **When** ele quer anexar arquivo, filtrar/buscar na lista, ou marcar como
    resolvido/reabrir
  - **Then** consegue — o último **só** quando o workflow do JSM oferecer a transição
    ao cliente (`RF-36` é P2 e depende do projeto, não do app).

## 4. Requisitos cobertos

| Bloco | IDs | Cenários |
|---|---|---|
| Notificação | `RF-44`, `RF-45` | SC-01, SC-02 |
| Detecção de mudança | `RF-47`, `RF-48` | SC-03 … SC-06 |
| Alerta de SLA | `RF-46` | SC-07 |
| Métricas | `RF-55`, `RF-60` | SC-08, SC-09 |
| M3 restante | `RF-34`, `RF-35`, `RF-36` | SC-10 |

## 5. NFRs em foco

- `RNF-14`/`RNF-15` — o polling de fallback é justamente o que pode estourar burst
  limit: incremental por JQL, com intervalo configurável, nunca varredura completa.
- `RNF-33` — retenção definida para vínculos, conversas e auditoria; nesta fase o
  volume de dados pessoais cresce (preferências, histórico de notificação).
- `RNF-30` — a notificação é texto de produto: linguagem de negócio, e sempre
  dizendo que o prazo é de **primeira resposta**.

## 6. Success Criteria

- **ScC-1** — Uma mudança de status no Jira chega ao solicitante sem ele abrir o
  app, e chega **uma** vez (webhook e polling não duplicam).
- **ScC-2** — Com o webhook desligado de propósito, a notificação ainda acontece
  (pelo polling) — testado.
- **ScC-3** — Requisição forjada no endpoint de webhook é rejeitada.
- **ScC-4** — O painel responde à pergunta que justifica o projeto: **quantos
  tickets não foram abertos**, e quantos bloqueios foram override (documentação
  ruim).
- **ScC-5** — Existe alerta configurado de 429 e de custo de IA, com limiar.

## 7. Open Questions

- [ ] **Q11** — Google Chat, e-mail ou ambos na v1. *(João)* → `RF-45`.
- [ ] `[NEEDS CLARIFICATION: quem registra o webhook na administração do Jira, e
      isso é permitido pela governança do time de tech? Liga a Q1 (privilégios) e a
      Q10 (o time saber que a integração existe).]`
- [ ] `[NEEDS CLARIFICATION: o alerta de SLA (RF-46) vai para qual destino — o
      mesmo Google Chat das áreas, um canal do time de tech, ou o console? Muda
      quem age no aviso.]`
- [ ] `[NEEDS CLARIFICATION: a taxa de deflexão (O1) precisa distinguir "foi
      defletido e resolveu" de "desistiu e foi pro chat". Sem essa distinção o
      número infla e o projeto se auto-avalia bem por engano. Como medir a
      diferença — pergunta de follow-up ao usuário, ou cruzamento com volume de
      chamados por área?]`
