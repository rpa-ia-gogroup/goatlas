---
feature: "Piloto, calibragem e rollout"
id: "004"
status: draft
created: "2026-08-03"
spec_version: 1
requirements: "../../docs/REQUISITOS.md"
scope_ids: "Fase 4 · RF-19 · O1…O7 · R-03, R-04, R-05, R-06"
---

# Spec 004: Piloto, calibragem e rollout

> **Esta fase é a que decide se o projeto funcionou** — e é a única cujo trabalho
> principal não é código. Referencia IDs de [`REQUISITOS.md`](../../docs/REQUISITOS.md).

## 1. Problem & Why

As Fases 1–3 entregam o app. Nenhuma delas garante **adoção**, e adoção é o risco
de maior severidade do produto (`R-06`): se o app não for melhor que mandar
mensagem no Google Chat, ninguém usa e nada muda — a economia de assentos não
aparece, o volume não cai, o SLA não se padroniza.

Três coisas precisam acontecer fora do código, e todas podem matar o projeto:

1. **Os thresholds precisam de dado real.** Threshold de score (Regra 1) e de
   recorrência (Regra 2) começam conservadores por decisão de projeto; apertá-los
   sem medir produz falso bloqueio (`R-04`), e duas ou três vezes disso e a pessoa
   volta para o chat — de onde não volta mais.
2. **O time de tech é usuário afetado, não espectador** (`R-03`). Todo chamado passa
   a chegar com o mesmo reporter, o que quebra fila por solicitante, métricas por
   área e o "responder ao cliente" nativo do JSM. Descobrir isso depois do rollout é
   perder o aliado que precisa trabalhar os tickets.
3. **O SLA de 24h soa como piora** para Growth, CX e E-comm, que hoje têm retorno em
   **2h30** (`R-05`). Comunicado errado, o projeto é percebido como retrocesso
   justamente pelas áreas de maior volume e maturidade.

## 2. Goals / Non-Goals

**Goals**
- Validar com 1–2 áreas antes de expor a empresa.
- Calibrar os thresholds com dado observado, não com intuição.
- Combinar com os líderes que o canal oficial **passa a ser o app**.
- Medir os objetivos O1–O7 com baseline de antes.

**Non-Goals**
- Ampliar escopo funcional. Se algo aparecer, é requisito novo em
  `REQUISITOS.md` — não um "ajuste do rollout".
- Substituir as reuniões recorrentes por área (iniciativa paralela, independente).
- Usuários externos à Gocase.

## 3. Scenarios (Given / When / Then)

- **SC-01** · `Q13`, `R-06`
  - **Given** duas áreas escolhidas — sugestão do requisito: uma de **alto volume e
    alta maturidade** (CX) e uma de **baixo volume** (Produção)
  - **When** o piloto começa
  - **Then** os solicitantes conhecidos dessas áreas (§3 dos requisitos) estão
    avisados, sabem que o canal é o app, e têm para onde reclamar quando algo falha.
- **SC-02** · `R-03`, `Q10`
  - **Given** o time de tech
  - **When** o piloto começa
  - **Then** eles **já sabem** que o reporter mudou, e existe automação no Jira
    roteando pelo campo "Solicitante". Alinhamento é **pré-condição** do piloto, não
    tarefa paralela.
- **SC-03** · `R-05`, `Q9`
  - **Given** áreas com SLA real de 2h30 hoje
  - **When** o SLA do app é comunicado
  - **Then** os 24h aparecem como **piso garantido**, nunca como novo prazo — e a
    priorização automática de fato classifica essas áreas como Crítica/Alta quando é
    o caso, senão a promessa não se sustenta na prática.
- **SC-04** · `R-04`, `RF-11`, `RF-50`
  - **Given** taxa de override medida no piloto
  - **When** ela está alta para uma regra
  - **Then** o threshold é afrouxado **ou** a documentação apontada é corrigida — o
    override é sinal de documentação ruim (`RF-13`), e a resposta certa pode ser
    escrever a página, não mexer no número.
- **SC-05** · `O1`
  - **Given** conversas bloqueadas pelas Regras 1 e 2
  - **When** a taxa de deflexão é calculada
  - **Then** distingue quem foi defletido **e resolveu** de quem **desistiu e foi
    para o chat**. Sem essa distinção o número infla e o projeto se auto-avalia bem
    por engano.
- **SC-06** · `O5`
  - **Given** o canal oficial combinado com os líderes
  - **When** a aderência é medida
  - **Then** compara chamados abertos pelo app × abertos por chat, reunião ou Jira
    direto. Aderência baixa com satisfação alta significa que o app é bom e a
    combinação não pegou — problemas diferentes, respostas diferentes.
- **SC-07** · `RF-19`
  - **Given** o mapa de áreas e o e-mail do solicitante
  - **When** o chamado é criado
  - **Then** é roteado para a área certa, **com correção manual disponível** — o mapa
    envelhece, e pessoa que muda de área é a regra, não a exceção.
- **SC-08** · `O2`, `O3`, `O7`
  - **Given** o baseline da Fase 0
  - **When** o rollout completa
  - **Then** há comparação antes × depois de gasto mensal com assentos, e o número
    de assentos criados com motivo "abrir ticket" é **zero**.
- **SC-09** · `RNF-35`, `D-01`
  - **Given** o app em produção
  - **When** o trimestre fecha
  - **Then** a decisão de proxy total é revisada, e `R-01`/`R-03` são reavaliados
    contra o que de fato aconteceu.
- **SC-10** · `R-11`
  - **Given** FrontOffice e BackOffice
  - **When** o rollout avança
  - **Then** é por blocos, com os thresholds já calibrados no piloto — não um
    big-bang para 12 áreas.

## 4. Métricas de saída (os objetivos do projeto)

| Obj | Métrica | Baseline |
|---|---|---|
| O1 | Taxa de deflexão — % de conversas bloqueadas que não viraram ticket | não existe hoje |
| O2 | Gasto mensal com assentos, antes × depois | **Fase 0** |
| O3 | Assentos criados com motivo "abrir ticket" | meta: zero |
| O4 | % de tickets dentro do SLA · nº de áreas com SLA combinado | hoje **0 de 12** |
| O5 | Aderência de canal: app × chat/reunião/Jira direto | não existe hoje |
| O6 | Buscas/mês por usuários sem assento | Fase 2 |
| O7 | Console em produção com dado de último acesso | Fase 2 |

## 5. Success Criteria

- **ScC-1** — O piloto termina com as duas áreas **preferindo** o app ao Google Chat
  — medido por aderência, não por opinião coletada em reunião.
- **ScC-2** — Thresholds ajustados **com base em dado** do piloto, e a mudança
  registrada em `DECISOES.md` com o número que a motivou.
- **ScC-3** — O time de tech confirma que consegue trabalhar os chamados: sabe quem
  pediu e a fila continua utilizável.
- **ScC-4** — Nenhuma área com SLA real melhor que 24h percebeu piora.
- **ScC-5** — O2 tem número: quanto se economizou, comparado ao baseline da Fase 0.

## 6. Open Questions

- [ ] **Q9** — Como comunicar os 24h sem soar como piora. *(João + Produto)* → é a
      redação que evita `R-05`.
- [ ] **Q10** — O time de tech está ciente da mudança de reporter. *(João)* →
      pré-condição do piloto.
- [ ] **Q13** — Quais 1–2 áreas no piloto. *(João)* → sugestão: CX + Produção.
- [ ] `[NEEDS CLARIFICATION: existe automação no Jira roteando pelo campo
      "Solicitante" (mitigação de R-03), e quem a constrói — o time de tech ou nós?
      Sem ela, o campo customizado é dado morto e todo chamado continua chegando
      como "aberto pelo robô".]`
- [ ] `[NEEDS CLARIFICATION: o SLA passa a ser acordado formalmente com as 12 áreas
      (hoje zero de 12), e quem faz esse acordo? O app mede aderência a um SLA que
      alguém precisa ter combinado — medir sem acordo é medir contra número que
      ninguém prometeu.]`
