---
# Especificação de Feature — gerada por /specify. WHAT/WHY apenas.
feature: "investigador-legivel"
id: "013"
status: draft
created: "2026-08-20"
spec_version: 1
---

# Spec: O Investigador vira leitura — a linha do tempo que responde sem JSON

> **Regra de ouro:** esta spec descreve **WHAT** e **WHY**. O **HOW** vai no `plan.md`.
>
> A análise que a originou, incluindo o levantamento do Investigador do **godocs**, está em
> [`analise-e-plano.md`](./analise-e-plano.md).

## 1. Problem & Why

A spec 009 entregou o **registro**: toda requisição `/api/*`, todo turno da conversa, toda
chamada que sai do app, o payload entregue ao Jira e a resposta crua do modelo. O dado está
lá — foi ele que respondeu, em quatro linhas, por que `isaac.albano@gocase.com` perdeu três
chamados em 17/08 (`D-74`, spec 010). O registro **funciona**.

A **tela** não. Relato do mantenedor em 20/08/2026:

> *"a visualização do histórico é inexistente (apenas um conjunto de logs bizarros) e não é
> uma página útil"*

E ele está certo. São cinco defeitos, todos em `src/app/investigador.tsx`.

### 1.1 O JSON é a tela, não o detalhe

```tsx
{evento.dados_json && <BlocoJson rotulo="Dados do evento" json={evento.dados_json} />}
```

`BlocoJson` renderiza um `<pre>` **direto**, fora de qualquer `<details>`. Um turno registra
por volta de catorze eventos, e o maior deles — `ia_chat` — carrega `historicoEnviado`, que é
a conversa **inteira**, repetida a cada ciclo do turno. A linha do tempo é, literalmente, uma
parede de JSON com uma frase em português por cima.

### 1.2 O nome do evento chega em snake_case

`<span className="inv-tipo">{evento.tipo}</span>` põe na tela `ia_extracao_recusada`,
`proposta_rederivada`, `tool_executada`, `payload_final`. É a regra 4 quebrada na superfície
que existe para ser lida, e é a mesma família de `D-63` (`1incompleteO que fazer agora?`) —
identificador interno vazando porque ninguém escreveu a tradução.

Curiosamente a tela **já sabe fazer isso**, para um campo só: `MOTIVOS_SEM_PROPOSTA` traduz
os seis motivos de "não houve cartão" em frases que dizem o que fazer. O resto da tela não
recebeu o mesmo tratamento.

### 1.3 Não existe a unidade "turno" — e o dado para criá-la já está gravado

A linha do tempo é uma lista plana. Uma conversa de seis mensagens vira ~80 itens em sequência,
e a pergunta que a aba existe para responder — *"o que aconteceu neste turno, e por que ele
levou 40 segundos?"* — só se responde contando itens com o dedo.

🚨 **`investigador_eventos.requisicao_id` é gravado para todo evento** (`coleta.ts#gravar`), e
`detalharSessao` já devolve eventos **e** requisições da conversa. Uma requisição é um turno.
O agrupamento não custa uma consulta nova, uma coluna nova nem um byte a mais no payload — ele
custa não ter sido feito.

### 1.4 A conversa está escondida, e crua

As mensagens vivem num `<details>` fechado, renderizadas como `<p>{m.conteudo}</p>`. O
conteúdo das mensagens de papel `tool` é o texto que foi ao modelo — o resultado da busca no
Confluence, o histórico do Jira —, blocos de milhares de caracteres que saem sem corte, sem
tamanho declarado e sem distinção visual de uma frase que a pessoa digitou.

### 1.5 A página não sobrevive a um erro, e não se atualiza

- Uma falha em `investigadorResumo()` cai em `if (erro) return <Aviso/>` e **troca a tela
  inteira** por uma linha de aviso — inclusive as listas, que talvez tivessem respondido.
- Não há polling nem carimbo de atualização: investigar um caso ao vivo é apertar F5.
- `/investigador` não aceita id de sessão (`app/rotas.ts`), então **não existe link** para
  mandar a alguém a sessão que se acabou de achar.
- `listarRequisicoes` devolve `req_json` e `resp_json` **dentro da listagem**, até 500 linhas
  com dois corpos cada — carga que só é lida quando alguém expande uma linha.

### 1.6 Por que isto importa agora

O Investigador é o instrumento que respondeu `D-74` e que vai responder o próximo caso. Um
instrumento que exige quinze minutos de leitura de JSON para reconstruir um turno é usado uma
vez, na emergência, e nunca por curiosidade — que é exatamente quando ele acharia o defeito
antes de alguém perder um chamado. É a mesma tese de `D-73` sobre o aviso que dizia só
`(Error)`: **instrumento de investigação que não é investigável é contradição**.

## 2. Goals / Non-Goals

### Goals

- **G1** — A linha do tempo é lida como narrativa: turno a turno, em português, sem JSON na
  primeira leitura.
- **G2** — O JSON cru continua **sempre disponível**, a um clique, e nunca é o que se lê
  primeiro.
- **G3** — Responder *"por que o cartão ficou assim?"* sem abrir um único bloco de dados.
- **G4** — A página sobrevive a falha parcial, se atualiza sozinha e tem endereço por sessão.
- **G5** — Uma sessão inteira sai daqui em um clique, num formato que se cola num chat de
  depuração.

### Non-Goals

- **NG1** — **Não muda o que é gravado.** `coleta.ts`, `registro.ts`, `fetch-observado.ts` e
  o schema ficam como estão. Todo dado que falta na tela já está no banco.
- **NG2** — **Nada vira editável.** A tese de `FR-11`..`FR-17` não muda: escrita numa tela de
  investigação é a forma de perder a evidência que se foi buscar.
- **NG3** — **Não funde com a auditoria** (`D-73`): retenção curta, conteúdo pessoal e
  propósito continuam separados.
- **NG4** — **Não persegue latência do agente** — `RNF-12` foi cortado em `D-72`.
- **NG5** — Não traz o design system do godocs (Tailwind, `lucide-react`, paleta de seis
  cores). A identidade é `identidade_visual_gogroup.md`, e origem continua sendo **forma +
  palavra**, nunca cor (regra 9).

## 3. Users & Context

Um público só: **admin** — hoje, na prática, o mantenedor e quem for depurar com ele. O gate
real continua no servidor (`FR-11`). A pessoa chega aqui com uma pergunta concreta e um nome
ou um horário na mão, e quase sempre uma destas quatro:

1. *"Fulano diz que conversou e não abriu chamado. O que aconteceu?"*
2. *"Por que o cartão saiu com esse assunto / essa prioridade?"*
3. *"Por que este turno demorou 40 segundos?"*
4. *"Isto está acontecendo com mais gente?"*

## 4. User Stories

- **US-1** — Como admin, quero **ler um turno como uma narrativa** — o que a pessoa mandou, o
  que o modelo respondeu, que ferramenta rodou e o que ela devolveu — para entender o caso sem
  reconstruir JSON.
- **US-2** — Como admin, quero **ver o que mudou no cartão a cada turno**, para saber se foi a
  IA que mudou de opinião ou a pessoa que corrigiu.
- **US-3** — Como admin, quero **mandar a sessão para alguém** por link, e **exportá-la** num
  bloco só.
- **US-4** — Como admin, quero que a tela **continue mostrando o que deu certo** quando parte
  dela falha, e que ela **se atualize sozinha** enquanto acompanho um caso ao vivo.

## 5. Scenarios (Given / When / Then)

### Grupo A — a linha do tempo

- **ScA-01** — **Dado** uma conversa com três turnos, **quando** abro o detalhe, **então** vejo
  três blocos de turno, cada um com número, duração, custo, ferramentas e nº de idas externas —
  e **não** vejo nenhum bloco de JSON aberto.
- **ScA-02** — **Dado** um evento de qualquer `TipoDeEvento`, **quando** ele aparece na tela,
  **então** seu título está em português e nenhum identificador em snake_case é exibido.
- **ScA-03** — **Dado** um evento com dados, **quando** abro "Ver o registro cru", **então** o
  JSON aparece **exatamente** como gravado, com a marca de truncamento (`FR-3`) se houver.
- **ScA-04** — **Dado** um evento de tipo que ainda não tem tradução, **quando** ele aparece,
  **então** o rótulo cru é exibido em vez de o evento sumir — feio e correto, como `ORIGENS`
  já faz hoje.
- **ScA-05** — **Dado** um turno em que o texto do modelo foi **descartado** (bloqueio,
  `D-21`), **quando** leio o turno, **então** a tela diz isso em palavras e mostra os **dois**
  textos: o que o modelo escreveu e o que a pessoa leu.
- **ScA-06** — **Dado** um resultado de ferramenta com 12 kB, **quando** leio o turno,
  **então** vejo o nome da ferramenta, o tamanho e se ela falhou — e o texto só aparece se eu
  abrir.
- **ScA-07** — **Dado** um turno com seis chamadas à Atlassian, **quando** leio o turno,
  **então** elas aparecem **agrupadas** com o total e o tempo somado, não como seis linhas
  soltas no meio da conversa.

### Grupo B — o cartão

- **ScB-01** — **Dado** um evento `proposta_rederivada` com `alterados` não vazio, **quando**
  leio o turno, **então** vejo antes×depois **por campo**, classificado em alterado /
  adicionado / removido.
- **ScB-02** — **Dado** um `proposta_rederivada` sem nada alterado, **então** a tela diz "a IA
  não mudou nada" e **não** desenha uma tabela de diff vazia.
- **ScB-03** — **Dado** que a base do diff é `baseAnterior` (a última proposta **da IA**),
  **quando** a pessoa tinha editado o cartão pelo `PUT`, **então** o diff **não** acusa
  mudança por causa da edição dela — a assimetria de `D-71` é preservada na tela.
- **ScB-04** — **Dado** uma conversa com três rederivações, **quando** abro o detalhe,
  **então** existe uma trilha v1 → v2 → v3 mostrando o que mudou em cada passo.

### Grupo C — a página

- **ScC-01** — **Dado** que o resumo falha e as listas respondem, **quando** abro a aba,
  **então** vejo as listas **e** um aviso dizendo o que não carregou — nunca a tela inteira
  trocada por um erro.
- **ScC-02** — **Dado** que uma atualização automática falha, **quando** ela falha, **então** o
  dado anterior **permanece** na tela, marcado como desatualizado. Zero nunca é afirmado por
  falha.
- **ScC-03** — **Dado** que uma rodada de atualização demora mais que o intervalo, **quando** o
  próximo tique chega, **então** ele é **ignorado** — as chamadas não se empilham.
- **ScC-04** — **Dado** que abri uma sessão, **quando** copio a URL e a abro em outra aba,
  **então** caio na mesma sessão; e o ← do navegador volta para a lista.
- **ScC-05** — **Dado** a lista de chamadas de API, **quando** ela carrega, **então** os corpos
  **não** vêm no payload; eles são buscados ao expandir a linha.
- **ScC-06** — **Dado** um corpo de 60 kB, **quando** expando, **então** vejo tamanho, nº de
  linhas e um trecho — com "expandir tudo" e "copiar" disponíveis.

### Grupo D — achar o caso

- **ScD-01** — **Dado** uma sessão aberta, **quando** clico em exportar, **então** o
  clipboard recebe um JSON **enxuto** da sessão: turnos, mensagens, decisões e desfecho, com
  os blocos grandes reduzidos a marcador de tamanho.
- **ScD-02** — **Dado** os recortes da lista, **quando** a lista carrega, **então** cada
  recorte mostra **quantas** sessões ele tem, e os filtros ativos aparecem como chips
  removíveis.

## 6. Functional Requirements (EARS)

- **FR-21** — O sistema **deve** agrupar os eventos do detalhe por `requisicao_id`, exibindo
  cada grupo como um turno com número, instante, duração, custo, ferramentas executadas e
  recusadas, e quantidade/tempo de chamadas externas.
- **FR-22** — O sistema **deve** exibir todo evento com título e campos em **português**, a
  partir de um descritor por `TipoDeEvento`; quando não houver descritor, **deve** exibir o
  rótulo cru em vez de omitir o evento.
- **FR-23** — O sistema **deve** manter o JSON do evento acessível a um clique, fechado por
  padrão, preservando o conteúdo gravado sem reescrita.
- **FR-24** — Quando um evento carregar texto longo (histórico enviado, resultado de
  ferramenta, corpo de requisição), o sistema **deve** exibir tamanho e origem antes do
  conteúdo, e só exibir o conteúdo sob demanda.
- **FR-25** — Quando houver `proposta_rederivada` com campos alterados, o sistema **deve**
  exibir a comparação antes×depois por campo, tendo `baseAnterior` como base.
- **FR-26** — O sistema **deve** oferecer uma trilha das versões do cartão dentro da sessão.
- **FR-27** — Quando uma das fontes da tela falhar, o sistema **deve** exibir as demais e
  declarar o que não carregou, mantendo o último dado bom.
- **FR-28** — O sistema **deve** atualizar a lista periodicamente, ignorando um tique novo
  enquanto o anterior estiver em voo, e **deve** exibir o instante da última atualização.
- **FR-29** — O sistema **deve** dar endereço próprio a cada sessão
  (`/investigador/<conversaId>`), com o voltar do navegador funcionando.
- **FR-30** — O sistema **deve** buscar os corpos de uma requisição **sob demanda**, e não
  os incluir na listagem.
- **FR-31** — O sistema **deve** permitir copiar a sessão inteira num JSON enxuto.
- **FR-32** — O sistema **deve** exibir a contagem de cada recorte e os filtros ativos como
  chips removíveis.

> ⚠️ Os IDs `FR-21`..`FR-32` são **locais desta spec** (a spec 009 usa `FR-1`..`FR-20` no
> mesmo espaço). Rastreiam para os requisitos globais `RF-64`+ quando/se promovidos —
> `docs/REQUISITOS.md` não muda por esta feature, que é superfície sobre dado existente.

## 7. Non-Functional Requirements

- **NFR-1** (`RNF-36`) — O detalhe continua com **número constante** de consultas; a lista de
  chamadas fica **mais leve** ao perder os corpos. Nenhum N+1 é introduzido.
- **NFR-2** (`RNF-30`, `RNF-01`) — Nada exibido aumenta a superfície: a tela mostra o que a
  coleta já redigiu e truncou. Nenhum valor de credencial, nenhum id técnico como rótulo.
- **NFR-3** (regra 9 / a11y) — Turno, origem e estado são distinguidos por **forma e palavra**;
  cor nunca é o único sinal. Foco visível, `prefers-reduced-motion` respeitado.
- **NFR-4** (regra 4) — Todo texto visível em português com acentuação, inclusive plurais
  concordados (`1 mensagem` × `2 mensagens`).
- **NFR-5** — Sem lib nova. React + CSS próprio sobre `tokens.css`, como o resto do app
  (Princípio V).

## 8. Edge Cases & Error Conditions

- Sessão **sem nenhum evento** (anterior ao Investigador, ou registro desligado) — a tela já
  diz isso e continua dizendo.
- Evento **sem `requisicao_id`** (dado antigo): cai num grupo "fora de turno", nunca some.
- Evento de tipo desconhecido: rótulo cru (`ScA-04`).
- `dados_json` **truncado** (`FR-3`): não parseia, e o bloco cru mostra assim mesmo, com a
  marca — nunca formatação silenciosa que esconde o corte.
- Sessão com **2.000 eventos** (teto de `detalharSessao`): a tela declara que o teto foi
  atingido, como `coleta.ts` já faz com os eventos descartados.
- `clipboard` indisponível: o botão de copiar falha em silêncio hoje; passa a dizer.

## 9. Success Criteria (measurable)

- **SC-1** — Zero identificadores em snake_case na tela renderizada — teste estrutural sobre a
  saída, não sobre a intenção.
- **SC-2** — Todo `TipoDeEvento` tem descritor, e tipo novo sem descritor **não compila**
  (`Record<TipoDeEvento, …>`, mesmo desenho de `FAMILIA` e `PAINEIS_DO_CONSOLE`).
- **SC-3** — Nenhum `<pre>` de JSON é renderizado fora de um `<details>` fechado.
- **SC-4** — Um turno de conversa real é lido na tela sem abrir nenhum bloco cru — validado
  **no navegador**, com a sessão medida na staging.
- **SC-5** — A listagem de chamadas de API não contém `req_json`/`resp_json` no payload.
- **SC-6** — Falha simulada em uma das três fontes não zera as outras.

## 10. Open Questions

Nenhuma bloqueia implementação. As duas que existem são de calibragem e têm default:

- **Q-A** — Intervalo do polling. Default proposto: **10 s** (o godocs usa 8 s e mediu fila de
  `canceled`; aqui a lista é mais barata, mas o público é uma pessoa). Ajustável sem deploy?
  **Não** — é constante de tela, como `LENTO_MS`. Se virar incômodo, vira config.
- **Q-B** — Teto de caracteres antes de colapsar um bloco. Default proposto: **2.000**
  exibidos, colapso acima de **3.000** (os números do godocs, que já passaram por uso).

## 11. Out of Scope (defer)

- Gráfico de série temporal de erros ou custo — é pergunta de **painel** (`D-25`), e o console
  é a casa dela.
- Busca full-text dentro dos eventos.
- Exportar em CSV.
- Comparar duas sessões lado a lado.
- Qualquer campo novo no console de administração (`D-25`, `D-60`: campo é uma **pergunta**).

## Requirement Completeness — checklist (gate antes do /plan)

- [x] Todo `FR` tem ao menos um cenário.
- [x] Todo cenário é observável na tela, sem depender de implementação.
- [x] Goals e Non-Goals separados, com o que **não** muda declarado (NG1 é o mais importante).
- [x] Nenhum `[NEEDS CLARIFICATION]` pendente.
- [x] Decisões existentes que a feature toca estão nomeadas: `D-21`, `D-25`, `D-71`, `D-73`,
      `D-65` (deep link/`popstate`), `D-72` (latência fora), `D-63` (identificador cru).
