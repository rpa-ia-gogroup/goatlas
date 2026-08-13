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

```
upload do anexo (POST /api/anexos-pendentes)
  ├─ grava anexos_pendentes (já existe)
  ├─ INSERT analises_anexo (estado='pendente')            ← FR-1
  └─ ctx.waitUntil( analisar(...) )   ← devolve {ok,nome} sem esperar

mensagem (POST /api/conversas/:id/mensagens)
  ├─ aguardarAnalises(conversaId, teto 8s)                ← FR-1b
  │    ├─ reivindica pendente que ninguém pegou → analisa aqui
  │    └─ pendente já reivindicado → relê a linha até terminar/estourar
  ├─ monta o contexto do turno COM as descrições prontas   ← FR-4
  └─ orquestrador (agente principal) responde
```

O "agente auxiliar" é `analisarAnexo()` em `src/lib/agent/analise-de-anexo.ts`: um prompt
próprio, uma chamada ao provedor, saída estruturada `{ relevante, descricao }`. **Não** tem
tools, **não** vê o histórico da conversa e **não** decide nada além disso — é a versão
mínima que satisfaz a spec, e o isolamento é o que impede que uma instrução dentro do arquivo
alcance o gate.

### 3.2 A espera, sem polling ingênuo

O Worker é stateless: a promessa iniciada no upload **não** é alcançável pela requisição da
mensagem. Duas requisições, um estado compartilhado — o banco.

🚨 **A reivindicação é `UPDATE … WHERE estado='pendente'`, e vem ANTES da chamada de rede** —
o mesmo lock de `anexos_pendentes.reivindicar`. Sem ele, upload e mensagem analisam o mesmo
arquivo em paralelo: duas chamadas pagas, duas descrições, e a segunda sobrescrevendo a
primeira.

Quem não consegue reivindicar **não** refaz o trabalho: relê a linha em intervalos curtos até
`estado != 'analisando'` ou até o teto de 8 s. ⚠️ O teto é **do turno**, não por arquivo:
três anexos não viram 24 s.

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

Consequência de desenho: o `ctx.waitUntil` do upload recebe os bytes **em memória**, e é o
único caminho que os tem. Se a análise não acontecer ali, o arquivo só volta a ser legível
**depois** da criação do chamado, pelo proxy de leitura — tarde demais para `FR-1`.

⚠️ Isso torna `FR-1` (analisar ao anexar) **estrutural**, não uma escolha de latência: quem
"simplificar" movendo a análise para o turno da mensagem descobre que não há mais arquivo
para ler. A reivindicação da mensagem (§3.2) serve para o caso em que o `waitUntil` foi
cortado pela plataforma — e nesse caso a análise falha por falta de bytes, com
`estado='sem_conteudo'`, que é honesto e cai em `FR-7`.

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

Componente novo na SPA (`src/app/visualizador.tsx`), aberto pelo clique no anexo nas duas
telas (conversa e detalhe do chamado). Ele **não** busca conteúdo novo: aponta para as rotas
que já servem o arquivo, com os cabeçalhos de `D-11`/`D-62`.

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
| Espera de até 8 s no turno | `RNF-12` (< 5 s no p95) | A espera só existe com anexo pendente, e `FR-1` a leva a ~zero no caso comum. O alternativo é o agente responder sobre um arquivo que não viu |
| Análise gasta quando a pessoa anexa e nunca escreve | custo | É o preço da espera zero. Teto de 3 por chamado limita o desperdício |
| `descricao` persistida | privacidade | É o que faz `FR-2` e `US-4` funcionarem. Entra na retenção como o resto; nunca na auditoria |

## 8. File / Build Order

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
