# Roadmap SDD — goatlas

Traduz o faseamento da seção 12 de [`REQUISITOS.md`](REQUISITOS.md) em specs.
Cada fase é **uma** spec (`specs/<NNN>-<slug>/`) com seu `plan.md` e `tasks.md`;
a granularidade atômica vive no `tasks.md`, e cada tarefa vira uma branch em
worktree.

| Fase | Spec | Escopo (IDs) | Estado | Depende de |
|---|---|---|---|---|
| **0 — Diagnóstico** | *não tem spec (sem código)* | Levantamento via Organizations API; rebaixamento de assentos óbvios | Pendente — **João** | Q1 (credencial de Org Admin) |
| **1 — MVP** | [`001-mvp-chamados-e-agente`](../specs/001-mvp-chamados-e-agente/spec.md) | M1 `RF-01…06` · M2 `RF-07…26` · `RF-27` parcial (**D-04**) · M3 `RF-29…33` · transversais `RF-58`, `RF-59` | **49 de 58 tarefas · 166 testes · no ar em demo** | Q1, Q2, Q3, Q4, Q7 |
| **2 — Conhecimento e governança** | [`002-confluence-e-governanca`](../specs/002-confluence-e-governanca/spec.md) | M4 `RF-37…43` · M6 `RF-49…54`, `RF-56`, `RF-57` · `RF-27` completo | **spec + plan + tasks** — 32 tarefas, 5 bloqueadas | Fase 1 · Q5, Q8 · Fase 0 (números) |
| **3 — SLA e notificações** | [`003-sla-e-notificacoes`](../specs/003-sla-e-notificacoes/spec.md) | M5 `RF-44…48` · `RF-55`, `RF-60` · `RF-34…36` | **spec + plan + tasks** — 25 tarefas, 5 bloqueadas | Fase 1 · Q11 |
| **4 — Rollout** | [`004-piloto-e-rollout`](../specs/004-piloto-e-rollout/spec.md) | Piloto, calibragem com dado real, `RF-19`, métricas O1–O7 | **spec + plan + tasks** — 12 de código, **7 `[HUMANO]`** | Fases 1–3 · Q9, Q10, Q13 |

**Todas as quatro fases têm spec, `plan.md` e `tasks.md`** (decisão `D-06`:
planejar tudo marcando suposições). A profundidade é proporcional à distância, e cada
plano nomeia **a trava da sua fase** — o requisito que, se falhar, não é bug, é
incidente:

| Fase | A trava da fase |
|---|---|
| 1 | As seis travas de servidor (`RF-08`, `RF-17`, `RF-30`, `RF-32`, `RF-24`, `RNF-17`) — **feitas, com teste de burla** |
| 2 | **`RNF-06` sanitização** — é onde HTML editável por qualquer pessoa da empresa passa a ser *renderizado*, não só lido por um modelo |
| 3 | **`RF-48` webhook** — rota pública; sem autenticação qualquer um fabrica evento e notifica em nome do sistema. E a **dedupe** webhook × polling, porque notificação duplicada ensina a ignorar |
| 4 | Nenhuma técnica. A trava é **humana**: sem o alinhamento com o time de tech (`R-03`/Q10), o piloto começa quebrando a fila de quem trabalha os chamados |

⚠️ O `tasks.md` da Fase 4 lista **7 tarefas `[HUMANO]`**. Isso é proposital: um plano
que só tem código mente sobre o esforço daquela fase, e ela é a que decide se o
projeto funcionou.

**Estado em 04/08/2026:** a Fase 1 está completa no que não depende de credencial —
49 de 58 tarefas, 166 testes, e o app **no ar em modo demonstração** em
https://goatlas.devgogroup.com (`D-07`).

**O que dá para fazer sem nenhuma resposta nova:**
- **Fase 2:** a trava da fase inteira (sanitização, renderização, proxy de anexo) e
  quase toda a superfície de Confluence — tudo contra o fake.
- **Fase 3:** webhook, dedupe, polling e cálculo de SLA. O que trava é *para onde*
  mandar a notificação (Q11), não *quando* nem *o quê*.
- **Fase 4:** o gate de piloto, o mapa de áreas e a leitura de calibragem.

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

1. **Mergear os PRs #1 a #5**, nesta ordem — estão empilhados.
2. **Q1 (conta de serviço)** — é o único bloqueio que destrava *muita* coisa de uma
   vez: `criarChamado` real, a Fase 0, a governança da Fase 2 e o deploy com
   credencial. Vale antecipar a credencial de **Org Admin** junto, porque a Fase 0
   e a Fase 2 dependem dela.
3. **Q3 (exemplos reais de "ajuste operacional")** — é a que mais afeta *qualidade*.
   Hoje a Regra 2 se declara indisponível sem eles, o que é o comportamento certo,
   mas significa que metade da deflexão está desligada. Exemplos inventados
   produziriam falso bloqueio (`R-04`), que é pior.
4. **Q7, Q2, Q4, Q5, Q8** — todas entram como **configuração**, não como código.
   Responder é preencher um campo no console.
5. **Fase 0 em paralelo** (João) — não depende de nada nosso e dá o baseline de `O2`.
6. **Antes do primeiro deploy com credencial real: criar o app de staging** (regra
   10 do `CLAUDE.md`, pendência de `D-07`). O app atual tem o slug bom e vira
   produção.

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
