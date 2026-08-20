---
feature: "rederivacao-que-nao-regride"
spec: "./spec.md"
status: draft
created: "2026-08-20"
---

# Implementation Plan: A rederivação que não regride

## 1. Technical Context

- **Linguagem / Runtime:** TypeScript, Cloudflare Workers (GoDeploy).
- **Frameworks / Libs:** nenhuma nova. React já existente na SPA.
- **Armazenamento / Dados:** nenhuma migração. `conversas.proposta_json` e
  `conversas.proposta_ia_json` já existem (`RN-13`).
- **Integrações externas:** provedor de IA (extração), sem chamada nova por turno.
- **Restrições:** `RNF-16` (nenhuma ida extra ao provedor), `RNF-30` (nada interno na tela
  ou no prompt), regra 4 do projeto (PT-BR acentuado), `RNF-28` (a11y).

## 2. Constitution Check (gates)

- [x] **Simplicity** — reaproveita o gancho de `RF-81` (`aceitarNaoPronto`) em vez de criar
      um segundo caminho de extração. Nenhuma tabela, nenhuma rota nova.
- [x] **No premature abstraction** — a distinção de `FR-3` é **um** campo discriminado no
      resultado do turno, não uma máquina de estados nova.
- [x] **Test-first viável** — os sete FRs são verificáveis sem rede: `ClienteIAFake` já
      registra `extracoesRecebidas`, e o cliente real é testável pelo corpo entregue ao
      `fetchImpl`.
- [x] **Right-sized** — três defeitos medidos, um arquivo de teste, seis arquivos tocados.
- [x] **Trava crítica tem duas camadas** — nada aqui é trava nova; o que a mudança precisa
      **provar** é que não afrouxa as existentes (`FR-6`), e isso é teste, não comentário.
- [x] **Prompt é instrução, nunca garantia** (`D-33`) — `FR-4` é prompt de propósito, e o
      Out of Scope da spec já diz o que fazer se não bastar (auditar como
      `prosa-sem-prazo.ts`).

## 3. Architecture & Approach

### 3.1 `FR-1` — cartão vigente rederiva em modo fechamento

Hoje `tentarMontarProposta` roda a cada turno e manda a extração **sem** contexto de que
já existe cartão. O modelo reavalia "está pronto?" do zero, e o gabarito de prontidão é de
incidente ("o que aconteceu, desde quando, qual sistema") — pedido de acesso nunca casa.

A mudança é uma linha de intenção: **quando existe proposta vigente, a pergunta deixa de
ser "está pronto?" e passa a ser "o que muda?"**. O caminho técnico já existe e é testado:
`ParametrosExtracao.forcarFechamento` → `interpretarProposta(..., { aceitarNaoPronto })`.

Não se reaproveita a **flag** do botão, e sim o mecanismo:

```
extrairProposta({ …, forcarFechamento })   // o botão de RF-81 (pedido explícito)
extrairProposta({ …, cartaoVigente })      // novo: já existe cartão nesta conversa
```

Duas flags, uma precedência declarada (botão ganha), porque os **textos** que vão ao modelo
são diferentes: `INSTRUCAO_FECHAR_AGORA` afirma *"Ela clicou no botão 'Montar o chamado
agora'"*, e dizer isso quando ninguém clicou é mentir para o modelo sobre o próprio turno.
A instrução nova (`INSTRUCAO_ATUALIZAR_CARTAO`) diz o que é verdade: já existe chamado
montado, atualize-o com o que a conversa diz agora, não invente, e registre a lacuna em
`Em aberto:`.

⚠️ Ela vai no **fim da mensagem do usuário**, nunca no system — `D-76` mediu o oposto
(anexada ao system, o modelo obedeceu à regra mais antiga e devolveu `pronto: false`).

**Alternativa descartada:** reescrever o critério de prontidão do `PROMPT_EXTRACAO` para
cobrir pedidos. Ajudaria o **primeiro** cartão (que hoje já funciona neste caso) e não
garante nada no segundo turno — a regressão volta na primeira frase ambígua. Fica no Out of
Scope da spec, para depois da medição.

### 3.2 `FR-2`/`FR-3` — "não mudou" ≠ "não consegui"

`Rederivacao` e `TurnoResultado` ganham **um** campo discriminado:

```ts
type AtualizacaoDoCartao = 'atualizado' | 'sem_mudanca' | 'nao_conseguiu' | 'nao_havia'
```

- `nao_havia` — não houve rederivação neste turno (o estado neutro de `SEM_REDERIVACAO`),
  ou a extração não produziu proposta **e não havia cartão**: não há o que avisar.
- `nao_conseguiu` — a extração não produziu proposta utilizável **e existe cartão vigente**.
  É o único caso que a tela comenta.
- `atualizado` / `sem_mudanca` — derivados de `alterados.length`, no **mesmo** lugar que já
  produz o diff (`RN-13`, um produtor só).

O campo viaja em `negociacaoNaResposta` junto de `alterados`/`recusasDeAjuste`, e a tela o
lê no mesmo `setNegociacao` — não há caminho novo de dados.

Na tela: uma linha ao lado do cartão, irmã de `RecusasDeAjuste`, com texto e ícone/rótulo
em palavras (nunca cor sozinha):

> **Não atualizei o resumo com a sua última mensagem.** Confira o que está aqui e ajuste o
> que precisar antes de abrir.

**Alternativa descartada:** um `boolean rederivacaoFalhou`. Boolean responde "falhou?" e a
tela precisa distinguir **três** situações; o quarto estado (`nao_havia`) existe justamente
para o aviso não aparecer em conversa sem cartão, que é onde ele seria mentira.

### 3.3 `FR-4` — o agente não pede identificação

Um parágrafo em `montarPromptAgente`, na seção "O que você nunca faz". A regra já existe no
`PROMPT_EXTRACAO` ("os dados de identificação do solicitante e a área dele vêm do cadastro
da empresa, não da conversa") — falta a metade que a **pessoa** lê. O texto diz o que é
verdade e por quê: o e-mail vem do login corporativo e já vai no chamado, então pedir isso
gasta uma mensagem e o valor seria descartado.

### 3.4 `FR-7` — registro

O evento `proposta_rederivada` do Investigador ganha, no `dados`, o modo daquela extração
(`cartao_vigente` ou `botao`), para "fechou porque havia cartão" ser distinguível de
"fechou porque clicaram" e de `ia_extracao_recusada`. Nenhum id interno vai junto.

## 4. Data Model

Sem mudança de schema. Nenhuma coluna, nenhum `ALTER`, nenhum expurgo novo.

## 5. Contracts / Interfaces

**`src/lib/ia/tipos.ts`**
```ts
interface ParametrosExtracao {
  // … existentes
  /** `FR-1` — já existe cartão nesta conversa: atualize-o, não reavalie se está pronto. */
  readonly cartaoVigente?: boolean
}
```

**`src/lib/ia/prompts.ts`**
```ts
export const INSTRUCAO_ATUALIZAR_CARTAO: string   // vai no FIM da mensagem do usuário
// montarPromptAgente: + parágrafo de FR-4
```

**`src/lib/agent/orquestrador.ts`**
```ts
type AtualizacaoDoCartao = 'atualizado' | 'sem_mudanca' | 'nao_conseguiu' | 'nao_havia'
interface TurnoResultado { /* … */ readonly atualizacaoDoCartao: AtualizacaoDoCartao }
```

**`POST /api/conversas/:id/mensagens`** (resposta, dentro do bloco de negociação)
```json
{ "atualizacaoDoCartao": "atualizado|sem_mudanca|nao_conseguiu|nao_havia" }
```

**`src/app/api.ts` / `src/app/telas.tsx`** — o campo opcional no tipo da resposta e no
estado `negociacao`; componente `AvisoCartaoNaoAtualizado`.

## 6. Test Strategy

Arquivo novo: `tests/spec012-rederivacao-que-nao-regride.test.ts`.

| Requisito | Tipo de teste | Onde / o que afirma |
|---|---|---|
| FR-1 | integration (orquestrador + `ClienteIAFake`) | com proposta vigente, `extracoesRecebidas[n].cartaoVigente === true`; sem proposta vigente, `!== true`. **Afirma sobre o que a camada de IA recebeu** (`D-47`), não sobre o que o fake devolveu |
| FR-1 | contract (cliente real + `fetchImpl`) | o corpo entregue ao provedor termina com `INSTRUCAO_ATUALIZAR_CARTAO` na mensagem **do usuário**, e o system continua sendo só `PROMPT_EXTRACAO` (`D-76`) |
| FR-1 | unit (`interpretarProposta`) | `pronto: false` com `aceitarNaoPronto` produz proposta; sem ele, `null` (já coberto por spec 011 — o caso aqui é o par com `cartaoVigente`) |
| FR-1 | integration | o caso medido: turno 1 fecha, turno 2 com `pronto:false` **atualiza** a vigente em vez de congelar |
| FR-2 | integration | extração sem proposta **com** vigente → `atualizacaoDoCartao === 'nao_conseguiu'` e a vigente permanece |
| FR-3 | integration | rederivação com `alterados: []` → `'sem_mudanca'`; turno sem rederivação → `'nao_havia'` |
| FR-2/FR-3 | render (`renderToStaticMarkup`) | `'nao_conseguiu'` desenha a frase; `'sem_mudanca'` e `'nao_havia'` não desenham nada |
| FR-4 | structural (prompt) | `montarPromptAgente` contém a proibição, e o texto não cita nome de campo do Jira |
| FR-5 | contract | a instrução nova manda registrar `Em aberto:` e proíbe inventar |
| FR-6 | integration (bypass) | com `cartaoVigente`: bloqueio pendente descarta a proposta na gravação (`RN-07`); id fora da allowlist descarta a proposta inteira (`RF-28`); verificações incompletas não rederivam (`RF-08`); criar continua exigindo confirmação (`RF-17`) |
| FR-7 | integration | `proposta_rederivada` registra o modo; `ia_extracao_recusada` continua distinguível |

⚠️ **Nenhum caso afirma tempo de parede** — a suíte já tem um flake desses e o
`CLAUDE.md` proíbe criar outro.

## 7. Complexity Tracking

| Decisão | Princípio tensionado | Por que vale a pena |
|---|---|---|
| Duas flags (`forcarFechamento`, `cartaoVigente`) em vez de uma | Simplicity | Os textos enviados ao modelo são diferentes, e um deles **afirma** que a pessoa clicou num botão. Unificar exigiria mentir para o modelo ou perder a distinção no registro (`FR-7`) |
| Quatro estados em `atualizacaoDoCartao` | Simplicity | Três frases diferentes na tela e um estado silencioso. Boolean colapsaria "não mudou" com "não consegui" — que é exatamente o defeito nº 3 |
| `FR-4` fica só no prompt | Trava em código (Princípio X) | Não é trava de segurança: o pior caso é uma pergunta redundante. Auditoria em código está no Out of Scope, condicionada à medição |

## 8. File / Build Order

1. `tests/spec012-rederivacao-que-nao-regride.test.ts` — os casos de FR-1 a FR-7 (vermelho).
2. `src/lib/ia/tipos.ts` — `cartaoVigente` em `ParametrosExtracao`.
3. `src/lib/ia/prompts.ts` — `INSTRUCAO_ATUALIZAR_CARTAO` + parágrafo de `FR-4`.
4. `src/lib/ia/cliente.ts` — seleção da instrução e `aceitarNaoPronto`.
5. `src/lib/agent/orquestrador.ts` — `cartaoVigente`, `atualizacaoDoCartao`, registro.
6. `src/lib/http/rotas.ts` — o campo na resposta do turno.
7. `src/app/api.ts` + `src/app/telas.tsx` + `src/app/estilos.css` — o aviso de `FR-2`.
8. Documentação no mesmo PR: `docs/DECISOES.md` (`D-78`), `CLAUDE.md` (padrões e estado),
   `specs/012-.../tasks.md` marcado.
9. `npm run test` · `npm run typecheck` · `npm run build`.
10. Staging (`3936ca2d`) com as duas mensagens medidas — `ScC-1`/`ScC-2`/`ScC-3` — antes de
    qualquer deploy em produção (regra 10).
