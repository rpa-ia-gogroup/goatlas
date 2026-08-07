---
feature: "Console de administração organizado por capacidade"
id: "003"
status: draft
created: "2026-08-07"
spec_version: 1
requirements: "../../docs/REQUISITOS.md"
scope_ids: "RF-49, RF-50, RF-42, RF-53, RF-55, RF-56 · RNF-07, RNF-18, RNF-25, RNF-28"
---

# Spec 003: console de administração organizado por capacidade

> Referencia IDs de [`REQUISITOS.md`](../../docs/REQUISITOS.md); não os copia.

## 1. Problem & Why

A aba de administração cresceu por acumulação. Cada requisito que precisou de uma
superfície empilhou a sua no fim da página, e hoje ela é **um scroll único com cinco
trabalhos diferentes**: 14 campos de configuração soltos, métricas, governança de
assentos, mapa de lacunas e auditoria.

Três problemas, e o terceiro é o que dói:

1. **Sem estrutura.** Os 14 campos aparecem em ordem de implementação, não de
   assunto. "Espaços do Confluence" fica entre "campo customizado do Jira" e "labels
   bloqueadas"; o threshold da Regra 1 fica a 400px da taxa de override, que é
   exatamente o número com que ele se calibra (`R-04`).
2. **Linguagem de implementação.** Os rótulos nomeiam o campo do banco, não a
   decisão: *"Regra 2 — campo que delimita 'mesmo tipo'"*, *"score mínimo para
   bloquear"*, *"Campo customizado 'Solicitante' (Q4)"*. Quem administra não sabe o
   que muda ao mexer.
3. **Não se vê o estado do sistema.** O app é fail-closed: lista vazia **nega**
   (`RNF-07`). Mas a tela mostra um campo vazio igual a qualquer outro campo vazio —
   nada diz "com isso assim, a busca não devolve nada e a Regra 1 nunca vai
   defletir". O admin só descobre pelo relato de quem usou.

**Custo de não fazer:** `RF-49`/`RF-50` existem para permitir calibrar **sem
deploy**. Um console que ninguém entende empurra a calibração de volta para o
`curl` — ou, pior, para o "deixa como está".

## 2. Goals / Non-Goals

**Goals**
- Organizar o console por **capacidade do app**, não por tipo de dado, com cada
  ajuste ao lado do dado que ele afeta.
- Toda opção nomeada pela **decisão** que representa, em português comum, com o
  **efeito do valor atual** dito na tela.
- O estado de cada capacidade visível de entrada: ligado, parcial ou desligado — e
  a consequência de estar desligado.
- Reduzir o console ao que uma pessoa da Gocase **decide**.
- Recusar valor de tipo errado no servidor, não só na tela.

**Non-Goals**
- Mudar o que qualquer configuração **faz**. Semântica de fail-closed, defaults e
  regras continuam idênticos.
- Router, biblioteca de UI, gráficos, tema escuro (a identidade não tem —
  `identidade_visual_gogroup.md` §1.4).
- Editar em lote / salvar tudo de uma vez. Um `PUT` por chave é o que produz um
  registro de auditoria por decisão (`RF-56`).
- Governança em tempo real: os painéis de assento seguem lendo o cache diário.

## 3. Escopo do console — o que fica e o que sai

O critério é uma pergunta só: **quem na Gocase decide isto, e quando?**

**Fica (13 chaves).** Cada uma é decisão de alguém — e `RF-49`/`RF-50`/`RF-53`
nomeiam nominalmente as de allowlist, de regra e o "N configurável" do assento
ocioso.

| Capacidade | Chaves |
|---|---|
| Quem entra | `dominios_permitidos`, `admins` |
| Abertura de chamados | `service_desk_id`, `tipos_chamado_permitidos`, `campo_solicitante_id` |
| Documentação | `espacos_confluence`, `labels_bloqueadas` |
| Quando o agente interrompe | `regra1_threshold_score`, `regra2_threshold_recorrencia`, `regra2_janela_dias`, `regra2_campo_agrupamento`, `regra2_exemplos_ajuste_operacional` |
| Custo | `teto_custo_conversa_usd` |
| Assentos | `org_id`, `assentos_ocioso_dias`, `custo_mensal_por_produto` |

**Sai (4 chaves).** Nenhum requisito pede que estejam no console, e **nenhuma delas
é decisão de negócio** — são botões de desempenho com default são, cujo efeito só é
avaliável lendo o código:

- `ttl_metadados_seg`, `ttl_conteudo_seg` — cache (`RNF-13`).
- `regra2_limite_tickets` — teto de leitura por conversa (`R-08`).
- `limite_requisicoes_por_minuto` — rate limit (`RNF-11`).

As três primeiras **já não tinham tela**; a quarta tinha, e é a única remoção real
de superfície. Continuam sendo configuração de banco com bootstrap por env
(`RNF-25`) — some do console, não do sistema. Decisão registrada em `D-15`.

## 4. Scenarios (Given / When / Then)

**ScA — o estado do sistema é a porta de entrada**
Dado um admin abrindo a aba de administração
Quando a tela carrega
Então a primeira seção lista as capacidades do app com estado (ligado / parcial /
desligado), cada uma com **uma frase de consequência** derivada da configuração
atual — e nunca comunica o estado só por cor.

**ScB — desligado por lista vazia é dito como desligado**
Dado `espacos_confluence` vazio
Quando o admin abre o console
Então a capacidade "Busca na documentação" aparece como **desligada**, dizendo que a
busca não devolve nada e que a Regra 1 não vai defletir — em vez de um campo de
texto vazio indistinguível de qualquer outro.

**ScC — cada campo diz o efeito do valor que está lá**
Dado qualquer campo do console
Quando ele tem valor
Então a tela mostra, abaixo do controle, o que acontece **com aquele valor** — e não
apenas o que o campo significa em abstrato.

**ScD — o ajuste mora ao lado do que ele afeta**
Dado o threshold da Regra 1 (`RF-50`)
Quando o admin abre a seção "Quando o agente interrompe"
Então a taxa de override e a taxa de deflexão por regra (`RF-55`) estão na **mesma
seção** — o número com que o threshold se calibra (`R-04`).

**ScE — preço de assento é por produto encontrado**
Dado que a coleta diária de inventário já rodou
Quando o admin abre a seção de assentos
Então há um campo de preço mensal **por produto presente no inventário**, e salvar
qualquer um deles passa o painel de custo a mostrar dinheiro em vez de contagem
(`RF-53`, `Q8`).
E dado que nenhuma coleta rodou, a seção diz isso, sem inventar produto.

**ScF — valor de tipo errado é recusado pelo servidor**
Dado um `PUT /api/admin/config` com `{chave: 'regra1_threshold_score', valor: 'alto'}`
Quando a requisição chega, mesmo vinda de fora da tela
Então a resposta é 400 e a configuração **não** muda.
E o mesmo vale para lista onde se espera número, objeto onde se espera lista, e
preço negativo.

**ScG — o console continua funcionando em pedaços**
Dado que `/api/admin/metricas` falha
Quando o admin abre o console
Então a seção afetada diz que não carregou e **todo o resto continua editável**
(`RNF-18`).

**ScH — celular**
Dado um admin no telefone (`RNF-28`)
Quando abre o console
Então a navegação entre seções vira uma faixa rolável de pílulas, sem scroll
horizontal na página.

## 5. Acceptance criteria

- [ ] Nenhuma seção do console mostra mais de **3 controles** de uma vez.
- [ ] Nenhum rótulo visível contém nome de chave, `customfield_`, "score",
      "threshold" ou "ID" sem tradução.
- [ ] Todo campo tem uma frase de efeito **derivada do valor atual**.
- [ ] O diagnóstico é função **pura** de `ConfigValores`, com teste, e não duplica
      regra: quem decide "desligado" é a mesma condição que o servidor aplica.
- [ ] Estado nunca só por cor: símbolo + palavra em todos os selos de estado.
- [ ] `PUT /api/admin/config` valida o tipo de **toda** chave conhecida.
- [ ] Nenhuma configuração muda de default, de semântica ou de nome de chave.

## 6. Fora de escopo desta spec

`RF-57` (revogar produto pelo console) segue P2 e bloqueado por **Q1**. As chamadas
reais de inventário (T-122/T-123) continuam bloqueadas pela credencial de Org Admin
— esta spec organiza a superfície, não desbloqueia a API.
