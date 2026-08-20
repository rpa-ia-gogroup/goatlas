# 013 — O Investigador legível

> Planejamento. Ainda **não** é a `spec.md` do SDD — é a análise que a antecede,
> incluindo o levantamento do Investigador do **godocs** pedido em 20/08/2026.

---

## 1. O diagnóstico: por que a tela de hoje não é útil

O relato foi *"a visualização do histórico é inexistente (apenas um conjunto de logs
bizarros)"*. Não é impressão — são cinco defeitos estruturais, todos em
`src/app/investigador.tsx`.

### D1 — Todo evento despeja o JSON inteiro, sempre aberto

```tsx
{evento.dados_json && <BlocoJson rotulo="Dados do evento" json={evento.dados_json} />}
```

`BlocoJson` renderiza um `<pre>` **direto**, fora de `<details>`. Um turno registra ~14
eventos, e `ia_chat` carrega `historicoEnviado` inteiro (a conversa toda, a cada ciclo).
O resultado é uma parede de JSON: a linha do tempo tem estrutura de dados na tela, não
informação.

### D2 — O `tipo` do evento aparece cru, em snake_case

`<span className="inv-tipo">{evento.tipo}</span>` mostra `ia_extracao_recusada`,
`proposta_rederivada`, `tool_executada`. Viola a regra 4 (português na tela) e é o mesmo
defeito que `D-63` corrigiu no Confluence (`1incompleteO que fazer agora?`) e que
`MOTIVOS_SEM_PROPOSTA` já corrige — para **um** campo só.

### D3 — Não existe a unidade "turno"

A linha do tempo é uma lista plana. Uma conversa de seis mensagens vira ~80 itens sem
nenhum agrupamento — e a pergunta que a aba existe para responder (*"o que aconteceu
neste turno, e por que demorou 40 s?"*) exige contar itens com o dedo.

🚨 **O dado para agrupar JÁ EXISTE e não custa nada**: `investigador_eventos.requisicao_id`
é gravado em `coleta.ts#gravar` para todo evento, e `detalharSessao` já devolve as duas
listas. Uma requisição = um turno. Zero mudança de banco, zero consulta nova.

### D4 — A conversa está escondida e crua

As mensagens vivem num `<details>` fechado, como `<p>{m.conteudo}</p>`. O conteúdo das
mensagens `tool` é o texto que foi ao modelo — blocos de milhares de caracteres — e sai
sem corte, sem tamanho e sem rótulo do que é.

### D5 — A página não sobrevive a erro nem se atualiza

Uma falha em `investigadorResumo()` troca a tela inteira por um aviso (`if (erro) return`).
Não há polling, não há carimbo de atualização, não há deep link para uma sessão
(`/investigador` não aceita id — `app/rotas.ts`), e os corpos das requisições viajam
**dentro da lista** (`req_json`/`resp_json` em `listarRequisicoes`, até 500 linhas).

---

## 2. O que o godocs tem, e o que vale trazer

Fonte: `godocs-main/src/routes/_authenticated/investigador.tsx` (3.224 linhas),
`src/lib/investigador.functions.ts`, `docs/{frontend,backend,database}.md`.

### 2.1 Vale trazer — a ideia, não o código

| # | No godocs | O que resolve aqui | Custo |
|---|---|---|---|
| **A** | `linhasDoEvento(tipo, dados)` — **função pura** que traduz um evento em pares `rótulo → valor` + chips, usada pela bolha **e** pela exportação | Mata D1 e D2 de uma vez: cada `TipoDeEvento` ganha um descritor em português; o JSON cru vira `<details>` fechado | Alto valor, ~21 descritores |
| **B** | `PhaseDivider` — divisor visual entre fases | Vira **divisor de turno**: `Turno 3 · 24,3 s · US$ 0,0123 · 2 ferramentas · 6 idas à Atlassian`. Mata D3 | Baixo (dado já existe) |
| **C** | `ChatBubble` — pessoa à direita, IA à esquerda, `doc` como bloco colapsado com tamanho em kB | Mata D4: a conversa vira conversa, o resultado de tool vira bloco com tamanho e origem | Médio |
| **D** | `ComparacaoEdicao` / `computarDiff` / `LinhaDiff` — antes×depois com **Alterado / Adicionado / Removido**, campos longos abrindo em dois blocos | `proposta_rederivada` já carrega `proposta`, `baseAnterior` e `alterados` — hoje jogados como JSON. É diff pronto esperando tela (`D-71`) | Médio-alto, alto valor |
| **E** | `buildChatExport` — a sessão inteira num JSON **enxuto** (doc vira `[material extraído: 12kb]`), um clique | Tirar uma sessão daqui e colar num chat de depuração. Hoje é copiar bloco por bloco | Baixo |
| **F** | `JsonBodyViewer` — KB + nº de linhas, colapso automático acima de 3.000 caracteres, "Expandir tudo", copiar | Substitui `BlocoJson`, que não tem nada disso | Baixo |
| **G** | `/api/admin/investigador/log/:id` — corpo **sob demanda**, ao expandir a linha | Tira `req_json`/`resp_json` da listagem (até 500 linhas com dois corpos cada) | Baixo, ganho de `RNF-36` |
| **H** | `Promise.allSettled` + estado `falhas` + **mantém o dado velho** com aviso | Mata metade de D5. O comentário do godocs registra o caso real: "0 submetidos com 289 edições, impossível" | Baixo |
| **I** | Polling 8 s com **guarda de requisição em voo** (`emVooRef`) + carimbo da última atualização | A outra metade de D5. A guarda é o que evita a fila de `canceled` que eles mediram | Baixo |
| **J** | Filtros avançados em popover + **chips do que está ativo** + contador em cada aba | Hoje são 5 chips sem contador e uma busca por e-mail | Médio |

### 2.2 NÃO trazer

- **Tailwind + `lucide-react`**: o atlas é CSS próprio sobre `tokens.css`, sem lib de
  ícones. Portar as classes seria trocar o design system do app pelo de outro projeto.
- **A paleta de seis cores** (`#dc2626`, `#16a34a`, `#7c3aed`, `#0d9488`…): a identidade
  GoGroup tem duas cores de acento, e a regra 9 proíbe estado só por cor. Aqui a origem já
  é **forma + palavra** (`ORIGENS`), e isso fica.
- **Fases `doc`/`saving`/`receita`** e **versões/reenvio** (`projeto_versions`,
  `snapshot_chat`): domínio do godocs. O análogo aqui é a **evolução do cartão** via
  `proposta_rederivada`, que é o item **D**.
- **`MiniMarkdown`**: o app já tem `TextoDoAgente`, com allowlist de forma de link
  (`R-07`, `D-65`). Reescrever um renderizador de markdown ao lado dele criaria a segunda
  regra que diverge em silêncio.
- **N+1 no servidor**: `leitura.ts` já é imune por desenho, e o cabeçalho do arquivo cita
  exatamente a lição que o godocs pagou. Nada dessa parte volta.

### 2.3 O que o godocs NÃO tem, e aqui é o que mais importa

1. **O turno como unidade** — lá o eixo é a fase do formulário; aqui é a ida ao modelo.
2. **Custo por turno e por sessão** — `custo_usd` já é gravado por evento.
3. **Chamadas externas correlacionadas** — `chamada_externa` existe e hoje se perde no
   meio da lista plana. Agrupadas sob o turno, elas respondem sozinhas o achado já
   registrado em `D-73` (*6 idas à Atlassian por turno só para nomear os assuntos, ~2,6 s*).
4. **"Por que não houve cartão"** — `MOTIVOS_SEM_PROPOSTA` é a melhor coisa da tela atual e
   é o único lugar onde ela já faz o que este plano quer fazer no resto.

---

## 3. O plano

Quatro fases. Cada uma é entregável sozinha e cada uma tem PR próprio.

### Fase 1 — a linha do tempo vira leitura *(o defeito principal)*

1. **`app/investigador/eventos.ts`** — `descreverEvento(tipo, dados)`, função **pura**,
   devolvendo `{ titulo, linhas: [{rotulo, valor}], blocos: [{rotulo, texto}] }`.
   Mapa `Record<TipoDeEvento, Descritor>` — tipo novo sem descritor **não compila**
   (mesmo desenho de `FAMILIA` em `config/validar.ts` e `PAINEIS_DO_CONSOLE` em `D-49`).
2. **Agrupar por `requisicao_id`** → turnos, com cabeçalho: número, duração, custo,
   ferramentas executadas/recusadas, nº de idas externas, e o desfecho em uma palavra.
3. **JSON cru para dentro de `<details>` fechado** ("Ver o registro cru") — nunca some,
   nunca é o que se lê primeiro.
4. **Bolhas**: pessoa à direita, agente à esquerda, ferramenta/externa como bloco compacto
   com tamanho em kB e expansão.
5. **Teste estrutural**: todo `TipoDeEvento` tem descritor; nenhum rótulo em snake_case
   chega à tela.

*Entrega:* a aba deixa de ser um dump. **~1 sessão de trabalho.**

### Fase 2 — o que o cartão virou

6. **Diff do `proposta_rederivada`**: `baseAnterior` × `proposta`, classificado em
   alterado / adicionado / removido, com os campos longos (descrição) em antes×depois.
7. **Trilha "evolução do cartão"** no topo do detalhe: v1 → v2 → v3, com o que mudou em
   cada passo e a prioridade de cada um.

*Entrega:* responde *"por que o cartão ficou assim?"* sem ler JSON. **~meia sessão.**

### Fase 3 — a página fica utilizável

8. **Deep link** `/investigador/<conversaId>` em `app/rotas.ts` (`push`, com `popstate`,
   como `D-65` exige) — hoje não dá para mandar uma sessão a ninguém.
9. **`Promise.allSettled` + banner de falha + manter o dado velho** na tela.
10. **Polling** (10 s) com guarda de requisição em voo + carimbo da última atualização.
11. **Corpos sob demanda**: `GET /api/investigador/requisicoes/:id/corpos`; tirar
    `req_json`/`resp_json` da listagem.
12. **`BlocoJson` melhorado**: KB, nº de linhas, colapso acima do teto, copiar.

*Entrega:* dá para trabalhar dentro dela por meia hora. **~1 sessão.**

### Fase 4 — achar o caso

13. **Exportar a sessão** em JSON enxuto, um clique (para colar num chat de depuração).
14. **Filtros**: período, contadores em cada recorte, chips do que está ativo, e o
    recorte "parada há mais de 1 h" (o `isAbandonado` do godocs, com relógio).

*Entrega:* achar a sessão certa deixa de depender de sorte. **~meia sessão.**

---

## 4. O que este plano NÃO faz

- **Não mexe no que é gravado.** `coleta.ts`, `registro.ts` e `fetch-observado.ts` ficam
  como estão: o dado que falta na tela já está no banco. A única mudança de servidor é a
  rota de corpos sob demanda (item 11), que **remove** carga.
- **Não torna nada editável** — a tese da tela (`FR-11`..`FR-17`) não muda.
- **Não reabre `D-73`**: `investigador_*` continua separado de `auditoria`, com retenção
  curta e conteúdo pessoal.
- **Não persegue latência** — `RNF-12` foi cortado em `D-72`.

## 5. Processo

Mudança grande → fluxo SDD completo: `/specify` → `/clarify` → `/plan` → `/tasks` →
`/analyze` → `/implement`. Worktree `013-investigador-legivel` antes de qualquer edição de
código (regra 1). Documentação no mesmo PR (regra 2): `docs/DECISOES.md` ganha o `D-79`,
`CLAUDE.md` ganha as travas novas, `specs/009-investigador/tasks.md` aponta para cá.
