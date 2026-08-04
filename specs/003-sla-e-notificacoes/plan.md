---
feature: "SLA, notificações e métricas"
spec: "./spec.md"
status: draft
created: "2026-08-04"
---

# Implementation Plan: SLA, notificações e métricas

> Profundidade proporcional à distância (Princípio VI): decisões técnicas fechadas
> onde há armadilha real, e menos detalhe onde a Fase 2 vai informar melhor.

## 1. Technical Context

O que entra de novo — e cada item traz uma armadilha própria:

| | Armadilha |
|---|---|
| **Webhook do Jira** | Rota pública. Sem autenticação, qualquer um fabrica evento e dispara notificação em nome do sistema |
| **Polling de fallback** | É justamente o que pode estourar burst limit (`RNF-15`) |
| **Google Chat / e-mail** | Envio duplicado é pior que envio nenhum: destrói a confiança na notificação |
| **Alerta de SLA** | Precisa de relógio. O Worker não tem processo longo — é cron |

## 2. Constitution Check

- [x] **Simplicity** — nenhum serviço novo; cron da plataforma + rotas.
- [x] **Test-first viável** — dedupe, cálculo de prazo e verificação de assinatura
      são funções puras.
- [x] **Right-sized** — `RF-36` (marcar resolvido/reabrir) é P2 e depende do
      workflow do JSM, não do app.
- [ ] **Princípio II** — Q11 (canal) em aberto; ver §9.

## 3. Architecture & Approach

### 3.1 O webhook é rota pública — trate como tal

Duas travas, em código, com teste de burla:

1. **Segredo compartilhado** conferido em **comparação de tempo constante**. Um
   `===` vaza o comprimento do prefixo correto por timing; é paranoia baixa e custo
   zero.
2. **Só o que o evento diz que é.** O payload informa o `issueKey`; o app **não
   confia nele para decidir o que mostrar**. Ele usa o `issueKey` apenas para
   *achar o vínculo local* — e se não houver vínculo, o evento é descartado em
   silêncio. Assim um evento forjado sobre um chamado que não é nosso não vira
   notificação para ninguém.

### 3.2 Webhook e polling não podem notificar duas vezes

Este é o ponto de desenho da fase. Duas fontes para o mesmo fato (`RF-47`), e
notificação duplicada é pior que atraso: a pessoa aprende a ignorar.

Solução: **tabela de notificações com chave de deduplicação** —
`issueKey + tipo_evento + carimbo_da_mudança`. Webhook e polling produzem a mesma
chave para o mesmo fato, e a chave é `UNIQUE` **no banco**. Quem chegar segundo
colide e desiste. Mesma lógica de `RF-24`: a garantia é do schema, não da
aplicação.

⚠️ O carimbo vem do **Jira**, não do nosso relógio. Com `Date.now()` as duas fontes
gerariam chaves diferentes para o mesmo fato e a dedupe não deduparia nada.

### 3.3 Não notificar a própria ação (RF-48)

Quando a pessoa comenta pelo app, o Jira emite `comment_created` e o webhook volta.
Notificá-la do próprio comentário é ruído que ensina a ignorar notificação.

Como distinguir: o app **registra o que ele mesmo causou** (`acoes_proprias`:
`issueKey` + tipo + janela de tempo) no momento da ação, e o processador de eventos
descarta o que casar. Comparar por autor não funciona — todo comentário sai da
conta de serviço (`D-01`), então **todos** pareceriam do próprio usuário.

Esse é um caso onde o proxy total (`D-01`) cobra o preço de novo, como `R-03`
previa.

### 3.4 Polling incremental, nunca varredura

JQL com `updated >= <último carimbo processado>`, ordenado, com marca-d'água
persistida. Intervalo configurável. **Nunca** varredura completa: sob API token os
burst limits não são publicados (`RNF-15`), e uma varredura periódica é a forma mais
fácil de descobri-los do jeito ruim.

O polling roda **sempre**, não só quando o webhook falha: é o que torna a
notificação independente de um único mecanismo. O custo é contido pela dedupe (§3.2)
— o polling normalmente não encontra nada novo.

### 3.5 Alerta de SLA antes do estouro (RF-46)

Cron a cada N minutos: busca chamados abertos sem primeira resposta cujo prazo cai
dentro do limiar configurado, e alerta **antes**. O prazo vem da prioridade
(`SLA_PRIMEIRA_RESPOSTA_HORAS`, já existe).

⚠️ **Timezone**: o SLA é combinado em BRT e a Atlassian responde em UTC. Cálculo
todo em UTC, exibição em BRT. E o alvo de disponibilidade é horário comercial
(`RNF-20`, seg–sex 8h–19h BRT) — vale decidir se o prazo conta hora corrida ou
horário útil. Hoje o app trata como **hora corrida**, porque é o que o requisito diz
literalmente; se a intenção era horário útil, é mudança de requisito, não de código.
Registrar em `DECISOES.md` quando a resposta vier.

### 3.6 Métricas: os dados já existem

`bloqueios` (com override), `vinculos.via`, `classificacoes_ticket`, `auditoria` e
`buscas` (Fase 2) já são gravados. `RF-55` é **superfície**, não coleta — e é por
isso que instrumentar desde o dia 1 foi decisão de Fase 1.

⚠️ **A taxa de deflexão precisa distinguir "defletido e resolveu" de "desistiu e foi
para o chat"** (`O1`, `SC-05`). Sem isso o número infla e o projeto se auto-avalia
bem por engano. Duas fontes possíveis: uma pergunta de follow-up leve na conversa
bloqueada ("resolveu?"), ou cruzamento com o volume de chamados da área. Fica em
aberto na spec — é decisão de produto, não de implementação.

## 4. Data Model

| Tabela | Papel |
|---|---|
| `notificacoes` | `UNIQUE(issue_key, tipo_evento, carimbo_mudanca)` — a dedupe de §3.2. Guarda canal, destinatário, estado de envio e tentativas |
| `acoes_proprias` | O que o app causou, para não notificar a própria ação (§3.3) |
| `preferencias_notificacao` | Canal por usuário (`RF-45`) |
| `marca_agua_polling` | Último `updated` processado (§3.4) |
| `alertas_sla` | Alerta já disparado, para não repetir a cada rodada do cron |

## 5. Contracts / Interfaces

| Rota | Papel |
|---|---|
| `POST /api/webhook/jira` | Pública, autenticada por segredo (§3.1) |
| `POST /api/cron/polling-jira` | Fallback incremental |
| `POST /api/cron/alertas-sla` | `RF-46` |
| `POST /api/cron/enviar-notificacoes` | Fila de envio com retry |
| `GET/PUT /api/preferencias` | Canal do usuário (`RF-45`) |
| `GET /api/admin/metricas` | `RF-55` |
| `POST /api/chamados/:key/anexos` | `RF-34` (P1) |

**Camada de notificação isolada**, como Atlassian e IA: `enviar(canal, destino,
mensagem)`. Google Chat e e-mail são implementações. Trocar canal não deve tocar a
lógica de quando notificar — e `Q11` é exatamente "qual canal", então essa fronteira
é o que permite responder Q11 depois.

## 6. Test Strategy

| Requisito | Tipo |
|---|---|
| `RF-48` | **bypass**: sem segredo, com segredo errado, com payload de chamado sem vínculo |
| `RF-47` | integração: webhook e polling para o mesmo fato → **uma** notificação |
| `RF-48` | integração: ação própria não gera notificação para quem a fez |
| `RF-46` | unit puro: cálculo de prazo por prioridade, em UTC, com limiar |
| `RF-44` | integração: criação e mudança de status notificam com prazo de **primeira resposta** |
| `RF-45` | unit: preferência respeitada; sem preferência, o default |
| `RF-55` | unit puro sobre dados semeados |
| `RF-60` | unit: limiar de 429 e de custo dispara alerta |
| `RNF-15` | unit: o JQL do polling é **incremental** — nunca sem cláusula de `updated` |

## 7. Complexity Tracking

| Decisão | Princípio tensionado | Por quê |
|---|---|---|
| `notificacoes` com `UNIQUE` composto | V — simplicidade | Duas fontes para o mesmo fato. Dedupe na aplicação tem corrida; no banco, não |
| `acoes_proprias` | V — YAGNI | Sob proxy total não há como distinguir por autor: todo comentário sai da conta de serviço |
| Polling **sempre** ligado, não só no fallback | V — simplicidade | Notificação é promessa do produto; não pode depender de um mecanismo único. O custo é contido pela dedupe |

## 8. File / Build Order

1. `notificacoes/tipos.ts` — contrato do canal
2. Schema: as 5 tabelas de §4
3. **Testes de burla do webhook** (§3.1) — vermelhos primeiro
4. `notificacoes/dedupe.ts` — chave e verificação, funções puras
5. `POST /api/webhook/jira`
6. `polling` incremental + marca-d'água
7. `notificacoes/canais/` — Google Chat, e-mail *(qual entra depende de Q11)*
8. Cron de envio com retry
9. `RF-46` alerta de SLA
10. `RF-55` painel de métricas
11. `RF-34` anexos · `RF-35` filtro e busca · `RF-36` (P2)

## 9. Bloqueios

| Bloqueio | Trava | Some quando |
|---|---|---|
| **Q11** canal (Chat, e-mail ou ambos) | Qual implementação de canal entra. A camada isolada é agnóstica | João |
| Quem registra o webhook na administração do Jira | Sem isso, só polling — funciona, mas com latência maior | Alinhamento com o time de tech (liga a Q1/Q10) |
| Destino do alerta de SLA | Muda quem age no aviso | Produto |
| Deflexão: "resolveu" × "desistiu" | Não trava código; **invalida a métrica** `O1` se ignorado | Produto |
| SLA em hora corrida × horário útil | Hoje é hora corrida (o requisito diz isso literalmente) | Confirmar com Produto |
