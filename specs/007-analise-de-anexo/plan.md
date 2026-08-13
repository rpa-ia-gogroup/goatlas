---
feature: "analise-de-anexo"
spec: "./spec.md"
status: draft
created: "2026-08-13"
---

# Implementation Plan: O anexo é lido antes de o agente responder

> A spec está `clarified` — as seis perguntas foram respondidas em 13/08/2026 (§10 da spec).

## 1. Technical Context

- **Linguagem / Runtime:** TypeScript, Cloudflare Workers (GoDeploy). Sem binário nativo, sem
  processo longo, sem filesystem.
- **Frameworks / Libs principais:** nenhuma dependência nova. Tudo com `fetch`, `crypto` e o
  que já existe.
- **Armazenamento / Dados:** `env.DB` (SQLite). Uma tabela nova, `analises_anexo`.
- **Integrações externas:** duas, as duas por HTTP.
  1. **Proxy de IA corporativo** (`LLM_BASE_URL`, já configurado) — agora também com **imagem**
     no corpo, formato OpenAI (`content: [{type:'image_url', image_url:{url:'data:…;base64,…'}}]`).
     O mantenedor confirmou em 13/08 que o proxy aceita imagem.
  2. **OCR Worker** — `POST https://ocr-worker.kaique-rpa.workers.dev/`,
     `Content-Type: application/pdf`, `Authorization: Bearer <OCR_WORKER_TOKEN>`, bytes crus do
     PDF → `200 {text?|content?}`. Faz camada de texto **e** OCR de escaneado num passo. É o
     **mesmo worker que o godocs usa em produção**; o contrato está exercitado em
     `analise-notas-fiscais/src/extract/ocr-worker.ts`.
- **Restrições:**
  - 🚨 **`OCR_WORKER_TOKEN` é a QUINTA credencial do projeto.** A regra 5 do `CLAUDE.md` diz
    "quatro credenciais" e passa a dizer cinco. Lida **só** em `contexto.ts` (`RNF-01`), nunca
    em log, resposta ou bundle.
  - O timeout do lado do godocs é 60 s; **aqui o teto do turno é 8 s** (`FR-1b`), então o
    nosso `AbortController` é próprio e menor.
  - Memória do Worker (128 MB) e o arquivo passando pela memória: o teto de envio já é 8 MB
    (`http/anexo-entrada.ts`), e a leitura precisa do arquivo **de novo** — ver §3.4.

## 2. Constitution Check (gates)

- [x] **Simplicity** — nenhuma lib nova; o "segundo agente" é uma função com prompt próprio,
      não um runtime paralelo. Nada de fila, nada de Durable Object (a plataforma não tem).
- [x] **No premature abstraction** — a leitura de PDF entra como **borda HTTP isolada**
      (`src/lib/ocr/`), no mesmo desenho de `teamguide/http.ts`. Não é wrapper à toa: é a
      quinta credencial atravessando a fronteira, e `RNF-04` pede transporte próprio por
      credencial.
- [x] **Test-first viável** — o analisador é função pura sobre um `ClienteIA` fake e um
      `LeitorPdf` fake; a burla de `SC-8`/`ScC-5` é roteirizável como as outras.
- [x] **Right-sized** — feature nova com credencial nova e trava nova: fluxo completo
      (`/specify` → `/clarify` → `/plan` → `/tasks` → `/analyze`).
- [x] **Travas em código, não em prompt** (Princípio III) — `FR-9` **não** é uma frase no
      prompt: as travas de `RF-08`/`RF-17` continuam em `agent/gate.ts`, e o que o analisador
      produz entra **delimitado** por `delimitarConteudoNaoConfiavel`, a mesma função do
      Confluence.
- [x] **Fail-open onde `RNF-18` manda** — nenhuma falha de leitura vira parede (`FR-7`,
      `FR-8`).

## 3. Architecture & Approach

### 3.1 Quem faz o quê

🚨 **Revisado pelo `/analyze` (achado F2), antes de uma linha de código.** A primeira versão
punha a análise em `ctx.waitUntil` e deixava a rota da mensagem "reivindicar" o que sobrasse.
Dois furos: `waitUntil` **nunca foi exercitado neste app** (o hook está em `worker.ts:19` e não
tem um único consumidor em `src/`, então nada prova que a plataforma não corta a promessa), e o
fallback era **impossível** — sem bytes não há o que analisar (§3.4). O desenho abaixo não
depende de nenhum dos dois.

```
upload do anexo (POST /api/anexos-pendentes)
  ├─ grava anexos_pendentes (já existe)
  ├─ INSERT analises_anexo (estado='analisando')           ← FR-1
  ├─ analisa AQUI, na própria requisição  (bytes em mão)
  ├─ UPDATE estado final + descricao + custo
  └─ responde {ok, nome}   ← mais lento que hoje, e ninguém está esperando por ele

mensagem (POST /api/conversas/:id/mensagens)
  ├─ aguardarAnalises(conversaId, teto 8s do TURNO)        ← FR-1b
  │    └─ relê as linhas até nenhuma estar 'analisando' ou o teto estourar
  ├─ monta o contexto do turno COM as descrições prontas   ← FR-4
  └─ orquestrador (agente principal) responde
```

**Por que o upload é o lugar certo:** ele é a única requisição que tem os bytes (§3.4), e é a
única que a pessoa **não** está esperando — ela está digitando a mensagem. O `enviando…` por
arquivo que a tela já mostra (`D-59`) passa a cobrir também a leitura, sem uma palavra nova.

⚠️ **A espera da rota da mensagem continua existindo** e não é redundante: quem cola o print e
manda a mensagem em dois segundos chega antes de o upload terminar. O que ela **não** faz é
tentar analisar por conta própria.

O "agente auxiliar" é `analisarAnexo()` em `src/lib/agent/analise-de-anexo.ts`: um prompt
próprio, uma chamada ao provedor, saída estruturada `{ relevante, descricao }`. **Não** tem
tools, **não** vê o histórico da conversa e **não** decide nada além disso — é a versão
mínima que satisfaz a spec, e o isolamento é o que impede que uma instrução dentro do arquivo
alcance o gate.

### 3.2 A espera

O Worker é stateless: a requisição da mensagem não alcança a do upload. O estado compartilhado
é o banco, e a espera é uma releitura curta: enquanto alguma linha da conversa estiver
`analisando`, relê; para quando nenhuma estiver, ou quando o teto estourar.

⚠️ **O teto é do TURNO, não por arquivo** — três anexos não viram 24 s.

⚠️ **`INSERT` com `estado='analisando'` antes da chamada de rede** é o que torna a espera
possível: uma linha que só aparecesse *depois* da análise faria a rota da mensagem concluir
"não há nada pendente" e responder sem o arquivo — o defeito exato que a feature existe para
consertar, na versão silenciosa.

⚠️ E a espera **não** analisa nada por conta própria (achado F2). Se o upload morreu no meio, a
linha fica `analisando` para sempre; por isso a espera trata linha **velha** (mais que o teto de
um turno) como `sem_conteudo`, que cai em `FR-7` — informa, não bloqueia, e o anexo continua no
chamado.

### 3.3 O que chega ao agente principal

Uma linha por análise concluída e **relevante**, no formato de `FR-4`, e o conteúdo dentro de
`delimitarConteudoNaoConfiavel('arquivo_enviado_pela_pessoa', …)`.

⚠️ **Análise irrelevante não entra no contexto do modelo** (`FR-5b`/`SC-15`) — ela existe só
para a transcrição. Mandar "o arquivo não tem nada útil" ao modelo produz exatamente a frase
que a pessoa não deve ler.

⚠️ **Análise pendente/estourada também é dita ao modelo**, como fato: *"há um arquivo ainda
sendo lido"*. Sem isso ele responde como se não houvesse anexo, e é isso que `D-59` corrigiu
na direção oposta.

### 3.4 Ler o arquivo de novo: de onde vêm os bytes

O upload manda o arquivo ao Jira como anexo temporário e **não guarda os bytes** (`D-26`);
`temporaryAttachmentId` não é recuperável como conteúdo. Então a análise precisa dos bytes
**no momento do upload**, não depois.

Consequência de desenho: a **requisição de upload** é a única que tem os bytes. Se a análise
não acontecer ali, o arquivo só volta a ser legível **depois** da criação do chamado, pelo proxy
de leitura — tarde demais para `FR-1`.

⚠️ Isso torna `FR-1` (analisar ao anexar) **estrutural**, não uma escolha de latência: quem
"simplificar" movendo a análise para o turno da mensagem descobre que não há mais arquivo para
ler. É também o que descarta guardar os bytes numa tabela (§3.7) e o que faz a análise rodar
**dentro** da requisição, não num fire-and-forget (§3.1, achado F2).

### 3.5 Por tipo

| Tipo | Caminho | Nota |
|---|---|---|
| `image/png`, `jpeg`, `webp`, `gif` | data URL base64 → provedor de IA | teto de bytes próprio (§1) |
| `application/pdf` | OCR Worker → texto → provedor de IA | é o que pode estourar os 8 s (`SC-7b`) |
| `text/markdown`, `text/plain` | texto direto → provedor de IA | inclui a transcrição de `D-54` |
| resto (`.zip`, planilha, `svg`) | **não analisa** | `estado='tipo_nao_suportado'` → `FR-7` |

⚠️ **Quem decide o tipo é o `Content-Type` do upload mais o sniff dos primeiros bytes**
(`%PDF`), nunca a extensão do nome — mesmo raciocínio de `ScC-4` (nada decide por `fieldId`)
e de `D-11` (o app afirma o tipo).

⚠️ **`image/svg+xml` fica fora**, como em `D-11`: mandá-lo a um modelo é mandar XML com
script, e ainda por cima como se fosse imagem.

### 3.6 A visualização rápida

🚨 **Corrigido pelo `/analyze` (achado F1): as duas telas têm FONTES DIFERENTES.** Na tela do
chamado o arquivo vem do proxy (`/api/chamados/:key/anexos/:nome`); **na conversa não existe
rota que o sirva** — `urlDoAnexoNoApp` exige `issueKey` + vínculo, e o chamado ainda não
existe. Apontar o visualizador para lá na conversa daria **404 em cima do próprio print da
pessoa**, que é o pior lugar possível para um link quebrado.

| Superfície | Fonte do conteúdo |
|---|---|
| Detalhe do chamado | o proxy que já existe, com os cabeçalhos de `D-11`/`D-62` |
| Conversa | **`URL.createObjectURL(File)` no próprio navegador** — o arquivo que aquela aba acabou de anexar |

⚠️ **Isso não fura `RNF-02`**: o blob é o arquivo que a pessoa escolheu, e ele nunca sai do
navegador dela — não há chamada à Atlassian nem à IA envolvida. E é o único caminho possível:
o servidor **não guarda** os bytes (§3.4).

⚠️ **Consequência aceita, e ela precisa estar na tela:** recarregar a página perde o blob. O
anexo continua no chamado (o upload já aconteceu), mas a pré-visualização na **conversa** só
existe na sessão que o enviou — depois de criado o chamado, a visualização da tela do chamado
assume. Antes disso, sem blob, o clique não promete nada: o item simplesmente não é clicável, em
vez de abrir uma janela vazia (`FR-12`). E `URL.revokeObjectURL` no fechamento, senão cada print
colado vaza memória na aba.

Componente novo na SPA (`src/app/visualizador.tsx`), aberto pelo clique nas duas telas:

- Imagem → `<img src={url}>`
- PDF → `<iframe src={url}>` (o `Content-Security-Policy: sandbox` da resposta continua
  valendo, e é ele que torna isso seguro)
- Texto/markdown → `fetch` + `<pre>`; markdown fica **cru** (`D-62`), nunca renderizado
- Resto → a frase de `FR-12` mais o link de download

⚠️ **`Esc`, foco contido e devolução do foco** (`FR-13`) são requisito, não polimento: é uma
camada sobre a conversa, e sem isso o teclado fica preso atrás dela. Sem lib — `dialog` nativo
com `showModal()` já entrega foco contido e `Esc`.

### 3.7 Alternativas descartadas

- **Analisar dentro do orquestrador, como uma tool do agente principal.** Descartado: tool é
  escolhida pelo modelo, e `FR-1b` exige que a leitura aconteça **sempre** que houver anexo
  novo. Mesma razão de `D-52` (a IA não decide área) — o servidor decide *quando*.
- **Guardar os bytes do anexo numa tabela para analisar depois.** Descartado: cria retenção de
  conteúdo pessoal que hoje não existe, contra o Non-Goal da spec, e o teto de 8 MB × 3 em
  SQLite é o tipo de decisão que se paga por anos.
- **Streaming da análise para a tela.** Descartado pelo mesmo motivo de `D-32`: o servidor
  descarta texto quando há bloqueio, e não se transmite o que talvez seja jogado fora.
- **OCR local (pdfjs/tesseract).** Impossível na plataforma (sem binário nativo) — e foi
  exatamente o caminho que o `analise-notas-fiscais` **abandonou** em favor deste worker.

## 4. Data Model

```sql
CREATE TABLE IF NOT EXISTS analises_anexo (
  id                TEXT PRIMARY KEY,      -- id da linha de anexos_pendentes
  conversa_id       TEXT NOT NULL,
  solicitante_email TEXT NOT NULL,         -- RF-30: toda leitura exige o e-mail
  nome_arquivo      TEXT NOT NULL,
  estado            TEXT NOT NULL,         -- pendente|analisando|pronta|irrelevante|
                                           -- tipo_nao_suportado|sem_conteudo|falhou
  descricao         TEXT,                  -- português; NULL enquanto não terminou
  custo_usd         REAL,
  criado_em         TEXT NOT NULL,
  concluido_em      TEXT,
  UNIQUE (conversa_id, nome_arquivo)       -- FR-2 vem da CONSTRAINT, não de SELECT antes
)
```

Invariantes:

- **`FR-2` é a constraint**, não um `SELECT` antes do `INSERT` — dois uploads simultâneos do
  mesmo nome disputam e um perde, como em `RF-24`.
- `estado` distingue **três** falhas (`tipo_nao_suportado`, `sem_conteudo`, `falhou`) porque
  elas pedem frases diferentes na tela — mesma família de `area_indisponivel` ×
  `area_nao_encontrada`.
- ⚠️ **O mapa dos 6 estados para as 3 ações de auditoria de `FR-10` é explícito** (achado F3),
  e vive numa função só: `pronta`/`irrelevante` → **analisado** · `tipo_nao_suportado`/`falhou`
  → **não foi possível ler** · `sem_conteudo`/`analisando` velho → **não deu para saber**. Sem
  esse mapa, tela e auditoria contam histórias diferentes sobre o mesmo arquivo.
- ⚠️ **O teto de análises vem de `MAX_ANEXOS_POR_CHAMADO`** (achado F5), importado — nunca um
  `3` escrito de novo aqui: o dia em que o teto mudar, os dois números divergem em silêncio.
- ⚠️ **A tabela NÃO guarda o conteúdo do arquivo**, só a descrição — e a descrição é derivada,
  não o dado. `descricao` é conteúdo pessoal: entra na retenção como o resto, e **nunca** na
  auditoria (`FR-10`).
- `solicitante_email` existe para a leitura ser filtrada no `WHERE`, como `vinculos`.

## 5. Contracts / Interfaces

```ts
// src/lib/ia/tipos.ts — cresce o contrato isolado (RNF-04)
descreverArquivo(params: {
  readonly nomeArquivo: string
  readonly conteudo:
    | { readonly tipo: 'imagem'; readonly base64: string; readonly midia: string }
    | { readonly tipo: 'texto'; readonly texto: string }
}): Promise<{ relevante: boolean; descricao: string; custoUsd: number }>

// src/lib/ocr/http.ts — borda HTTP da quinta credencial
export type LeitorPdf = (bytes: Uint8Array) => Promise<string>
export function criarLeitorPdf(cfg: { url: string; token: string; timeoutMs: number }): LeitorPdf
```

🚨 **Três armadilhas já conhecidas, e o `criarLeitorPdf` nasce com as três resolvidas:**

1. **`fetch.bind(globalThis)`** — `D-50`. `this.fetchImpl = opcoes.fetchImpl ?? fetch` dá
   `Illegal invocation` no runtime dos Workers, invisível no Node dos testes. A varredura de
   `src/` em `tests/rf19-area-teamguide.test.ts` **vai alcançar este arquivo novo** — é
   literalmente o caso que ela existe para pegar.
2. **Token aparado e verificado na fronteira** — `D-50`. Um `\n` colado no console do GoDeploy
   faz o `fetch` lançar com a **mesma assinatura** do item 1.
3. **Timeout decidido pelo `signal.aborted`, nunca por `e.name`** — `D-40`.

## 6. Test Strategy

| Requisito | Tipo de teste | Onde |
|---|---|---|
| FR-1, FR-1b | integração (rota + banco), com relógio injetado | `tests/007-analise-anexo.test.ts` |
| FR-2 | constraint: duas análises do mesmo (conversa, nome) | idem |
| FR-3, FR-5, FR-5b | unidade sobre o analisador, com `ClienteIAFake` roteirizado | idem |
| FR-5c | o teto da conversa não se move com N análises | `tests/latencia.test.ts` (contagem) |
| FR-6 | um caso por tipo, incluindo sniff `%PDF` e tipo não suportado | idem |
| FR-7, FR-8 | falha injetada no leitor e no provedor → chamado abre | idem |
| **FR-9** | 🚨 **burla**: arquivo cujo texto manda criar chamado sem verificação | `tests/rn01-*`, junto das outras |
| FR-10 | auditoria tem as três ações e **não** tem o conteúdo | `tests/rnf01-vazamento-credenciais.test.ts` (varredura) |
| FR-11…FR-13 | descritor + estados do visualizador (sem DOM) | `tests/visualizador.test.ts` |
| ScC-8 | contagem de esperas quando a análise já terminou = 0 | `tests/latencia.test.ts` |

⚠️ **O fake é o ponto cego conhecido** (`D-47`, quatro ocorrências). O teste que vale para
`descreverArquivo` afirma sobre o **corpo entregue ao `fetchImpl`** — que a imagem foi como
`image_url` com data URL, e que o texto do arquivo foi **delimitado**. Afirmar sobre o que o
fake devolveu só prova que o fake é consistente consigo mesmo.

## 7. Complexity Tracking (exceções justificadas)

| Decisão | Princípio tensionado | Por que vale a pena |
|---|---|---|
| Quinta credencial (`OCR_WORKER_TOKEN`) | "quatro credenciais" (regra 5) | PDF é metade do pedido, e OCR local é impossível na plataforma. O worker já roda em produção no godocs |
| Análise **dentro** da requisição de upload | "resposta rápida" | O upload é a única requisição com os bytes, e a única que ninguém está esperando. A alternativa (`waitUntil`) depende de um mecanismo **sem nenhum consumidor hoje** neste app — achado F2 |
| Pré-visualização por blob na conversa | duas fontes para a mesma tela | Não existe rota para anexo pendente e o servidor não guarda bytes. Uma fonte só significaria 404 no print da própria pessoa — achado F1 |
| Espera de até 8 s no turno | `RNF-12` (< 5 s no p95) | A espera só existe com anexo pendente, e `FR-1` a leva a ~zero no caso comum. O alternativo é o agente responder sobre um arquivo que não viu |
| Análise gasta quando a pessoa anexa e nunca escreve | custo | É o preço da espera zero. Teto de 3 por chamado limita o desperdício |
| `descricao` persistida | privacidade | É o que faz `FR-2` e `US-4` funcionarem. Entra na retenção como o resto; nunca na auditoria |

## 8. File / Build Order

> ⚠️ Ordem revisada pelo `/analyze`: sem `espera-de-analises` como reivindicador, e com o
> visualizador partido em duas fontes.

1. `src/lib/ocr/http.ts` + fake — a borda HTTP, com as três armadilhas de `D-50`/`D-40`
   fechadas, **e o teste da varredura de `bind` rodando antes**.
2. `src/lib/ia/tipos.ts` (contrato `descreverArquivo`) → `fake.ts` roteirizável →
   `indisponivel.ts` → `cliente.ts` (corpo com `image_url`).
3. `src/lib/db/schema.ts` — `analises_anexo` (`TABELAS`; a marca do schema é derivada do
   texto, sem versão a subir).
4. `src/lib/tickets/analises-anexo.ts` — repositório com `reivindicar` (o `UPDATE … WHERE`),
   leitura **com e-mail no `WHERE`**.
5. `src/lib/agent/analise-de-anexo.ts` — o analisador: prompt próprio, sem tools,
   `delimitarConteudoNaoConfiavel` na saída. **Testes de burla primeiro.**
6. `src/lib/agent/espera-de-analises.ts` — o teto de 8 s do turno, com relógio injetado.
7. Rotas: upload (`ctx.waitUntil`) e mensagem (esperar + injetar no contexto).
8. `src/lib/tickets/transcricao.ts` — as descrições entram no arquivo (`FR-5b`, `SC-13`).
9. `src/app/visualizador.tsx` + `estilos.css` — `dialog` nativo, `Esc`, foco devolvido.
10. `contexto.ts` — a quinta credencial, lida **em um lugar só**; `/api/health` ganha a sonda
    do OCR Worker **fora** do `ok` agregado (mesmo raciocínio de `D-40` para a TeamGuide).
11. Documentação: `docs/REQUISITOS.md` (RF novos), `docs/DECISOES.md`, `CLAUDE.md` (regra 5
    passa a dizer **cinco** credenciais), `docs/DEPLOY.md` (o secret novo).
