# Roadmap SDD — goatlas

Traduz o faseamento da seção 12 de [`REQUISITOS.md`](REQUISITOS.md) em specs.
Cada fase é **uma** spec (`specs/<NNN>-<slug>/`) com seu `plan.md` e `tasks.md`;
a granularidade atômica vive no `tasks.md`, e cada tarefa vira uma branch em
worktree.

| Fase | Spec | Escopo (IDs) | Estado | Depende de |
|---|---|---|---|---|
| **0 — Diagnóstico** | *não tem spec (sem código)* | Levantamento via Organizations API; rebaixamento de assentos óbvios | Pendente — **João** | Q1 (credencial de Org Admin) |
| **1 — MVP** | [`001-mvp-chamados-e-agente`](../specs/001-mvp-chamados-e-agente/spec.md) | M1 `RF-01…06` · M2 `RF-07…26` · M3 `RF-29…33` | **spec em draft** | Q1, Q2, Q3, Q4, Q6, Q7 |
| **2 — Conhecimento e governança** | `002-confluence-e-governanca` | M4 `RF-37…40` · M6 `RF-49…54` | Não iniciada | Fase 1 · Q5, Q8 · Fase 0 (números) |
| **3 — SLA e notificações** | `003-sla-e-notificacoes` | M5 `RF-44…48` · `RF-55` | Não iniciada | Fase 1 · Q11 |
| **4 — Rollout** | `004-piloto-e-rollout` | Piloto, calibragem de thresholds com dado real | Não iniciada | Fases 1–3 · Q9, Q10, Q13 |

**M7 (observabilidade e auditoria) não é uma fase.** `RF-58` (auditoria
append-only), `RF-59` (health check) e `RN-10` são transversais e entram já na
Fase 1 — auditoria retroativa não existe, e a Definição de Pronto da Fase 1
(§13) exige log de conversa, bloqueio, override, criação e leitura.

## Por que uma spec por fase, e não por módulo

A Definição de Pronto da Fase 1 é **ponta a ponta** ("um colaborador sem nenhum
assento conversa com o agente e abre um chamado; o chamado chega ao time de tech
com o solicitante correto"). Quebrar M1/M2/M3 em três specs fragmentaria
justamente o critério que importa. Os módulos aparecem como seções dentro da
spec, e a decomposição pequena e reversível (Princípio IV) acontece no
`tasks.md`.

## Fase 0 não tem spec, mas tem entrega

É a única fase que **captura economia sem código** — auditoria de quem tem qual
produto e há quanto tempo não acessa, rebaixamento de quem tem assento só para
abrir chamado (customer de JSM é gratuito e ilimitado) e remoção de product
access de quem não usa. Duas consequências para o roadmap:

1. É ela que produz o número que justifica o resto — e a resposta de **Q8**
   (custo unitário por produto), sem a qual `RF-53` não fecha.
2. Ela exige a credencial de **Org Admin** (Q1) antes de qualquer código. Vale
   antecipar essa credencial: ela também é pré-requisito da Fase 2.

## Ordem sugerida de trabalho

1. **Responder Q1, Q6 e Q7** — sem conta de serviço, sem API de IA e sem lista de
   domínios não existe Fase 1. São bloqueio duro.
2. **Fase 0 em paralelo** (João) — não depende de código e dá o baseline de O2.
3. **`/clarify` na spec 001**, depois `/plan` e `/tasks`.
4. **Q2, Q3 e Q4 antes da Regra 2 e do campo "Solicitante"** — dá para começar a
   Fase 1 por M1 e pela casca de M2/M3 enquanto elas não voltam, mas
   `check_jira_history` (`RF-10`, `RF-11`) e `RF-21` param sem elas. **Q3 em
   especial**: exemplos reais de "ajuste operacional" da Gocase são
   pré-requisito de implementação, não refinamento posterior (`RF-14`).

## Riscos que mudam o roadmap, não só o código

- **R-11 (escopo maior que o prazo)** é o risco de maior severidade para o
  planejamento. A Fase 1 entrega valor sozinha — se algo tiver de cair, cai da
  Fase 2 para frente, nunca das travas de segurança da Fase 1.
- **R-01 / R-03** podem forçar a migração de identidade prevista em `RNF-22`.
  Enquanto o cliente Atlassian for uma camada isolada de verdade, isso é uma
  mudança localizada; se ela vazar para dentro da lógica de negócio, deixa de
  ser. Revisão trimestral (`RNF-35`) — ver `D-01` em [`DECISOES.md`](DECISOES.md).
- **R-06 (adoção)** não se resolve com código: o app tem de ser melhor que mandar
  mensagem no Google Chat. Mobile (`RNF-28`) e primeiro acesso em um clique
  (`RF-06`) são requisitos de adoção, não polimento.
