---
# Plano técnico — gerado por /plan a partir da spec.md. HOW.
feature: "anexo-obrigatorio"
spec: "./spec.md"
status: draft
created: "2026-08-17"
---

# Plan: o anexo dentro da criação, e a trava que impede o 400

> **Altitude:** aqui é **HOW**. O que o app faz e por quê está na `spec.md`.

## 0. O que precisa ser MEDIDO antes de existir código

🚨 **Duas afirmações desta feature ainda não têm prova, e as duas derrubam o desenho se
saírem diferentes.** Elas são a Phase 0 — nada de `FR-3` é escrito antes.

### M-1 · O 400 é mesmo pelo anexo?

A causa foi **inferida**: `attachment` é o único obrigatório do tipo `134` que o app não
manda, e a correlação com os 6 tipos é exata. Mas o corpo da resposta da Atlassian **não é
registrado**, de propósito (`RNF-01`, `RNF-30`) — então a prova por nome não existe.

**Como medir sem risco:** uma rota de diagnóstico só-admin que tenta a criação **e devolve o
corpo do erro redigido**. Tentativa que falha **não cria nada**; tentativa que dá certo cria
um chamado real, e por isso o título vai com `[TESTE atlas - ignorar]` e alguém do time de
tech precisa apagá-lo (como o `GN-6894`).

### M-2 · A criação do JSM aceita anexo no corpo?

`POST /rest/servicedeskapi/request` aceita `requestFieldValues`. **Não está medido** se o
campo de anexo aceita `temporaryAttachmentIds` ali — a documentação da Atlassian descreve o
caminho de anexo como um `POST` separado (`/request/{key}/attachment`), que é o que `D-26`
usa hoje.

Três desfechos, e os três têm plano:

| Desfecho | O que fazer |
|---|---|
| **Aceita** | É o desenho da spec: `FR-3`/`FR-4` como escritos |
| **Não aceita, e o 400 é só do portal** | Criar → anexar (ordem de hoje) resolve sozinho, e a feature encolhe para `FR-1`/`FR-2`/`FR-5` |
| **Não aceita, e a API exige mesmo** | 🚨 Não há conserto no app. Os 6 assuntos ficam **fora** da allowlist e o pedido vira do time de tech: tornar o campo opcional no request type. Isso é resultado legítimo, e a spec precisa dizê-lo em vez de forçar código |

⚠️ **Não inverter a ordem.** Escrever `FR-3` antes de `M-2` é apostar meia feature num
comportamento de terceiro que ninguém verificou — a família de `D-38`, `D-39`, `D-48`, em que
o desenho parecia óbvio e a Atlassian discordou, sempre com 400 definitivo no meio.

## 1. Decisões técnicas

### 1.1 Os bytes moram em `anexos_conteudo`, fatiados em 512 kB

Tabela nova, uma linha por fatia:

```sql
CREATE TABLE IF NOT EXISTS anexos_conteudo (
  anexo_id TEXT NOT NULL,   -- = anexos_pendentes.id
  ordem    INTEGER NOT NULL,
  dados    TEXT NOT NULL,   -- base64
  PRIMARY KEY (anexo_id, ordem)
)
```

- **512 kB de arquivo → ~700 kB de base64**, contra o teto medido de **~2,2 MB por valor**
  (`D-74`). A folga de 3× é deliberada: o teto é medição de hoje, numa plataforma que já
  mudou de comportamento antes (`D-73`).
- **Uma linha por `INSERT`** — multi-tupla é recusada pelo `env.DB` (`D-73`).
- 8 MB = 16 linhas ≈ **9,4 s** de gravação. Isso cai no **upload**, requisição que ninguém
  está esperando — a mesma razão de `D-64` para a análise do anexo. Na confirmação seria a
  pessoa olhando a tela.
- **Base64, não binário.** Não foi medido se o transporte do `env.DB` aceita `Uint8Array`
  como parâmetro; base64 foi o que `D-74` mediu, e trocar por binário sem medir é a mesma
  aposta de `M-2`.

### 1.2 O `temporaryAttachmentId` nasce na CONFIRMAÇÃO

É o coração da feature. Hoje ele nasce no upload e envelhece; com os bytes guardados, ele
passa a nascer **segundos** antes de ser usado, e a razão de `D-26` — *id vencido derruba a
criação* — deixa de existir para esse caminho.

⚠️ **A coluna `temporary_attachment_id` é `NOT NULL`** e o SQLite não afrouxa coluna por
`ALTER`. Ela passa a receber **string vazia** no upload, e vazio significa *ainda não subiu*.
Um predicado (`aindaNaoSubiu`) e nunca `=== ''` espalhado — a comparação solta é o tipo de
condição que diverge no terceiro lugar que a escrever.

### 1.3 A exigência vem do SCHEMA, com um predicado só

```ts
// tickets/declaracao-anexo.ts (ao lado de exigeDeclaracaoDeAnexo)
export function anexoObrigatorio(schema: SchemaDoTipo): boolean
```

- Lê `campos.find(c => c.tipo === 'anexo')?.obrigatorio`, e `tipo` já vem traduzido de
  `jiraSchema.system` no cliente — **nunca `fieldId`** (`ScC-4` tem teste estrutural).
- `schema.conhecido === false` → `false` (fail-open, `D-27`).
- **Um predicado, três leitores**: o gate do servidor, o cartão e o formulário. É a lição de
  `D-70` (`tiposOferecidos`) e de `config/diagnostico.ts` — condição escrita duas vezes
  diverge em silêncio.

### 1.4 A trava é do servidor, e a tela é conveniência

- **Camada 1** (tela): o cartão mostra a exigência e trava o botão, pela frase composta de
  `D-46` — nunca uma constante.
- **Camada 2** (servidor): `autorizarDeclaracaoDeAnexo` ganha um irmão — ou um ramo — que
  recusa quando `anexoObrigatorio(schema)` e `contarDaChave(...) === 0`. Recusa **antes de
  qualquer efeito**, com o **rótulo** do campo (`RNF-30`), como `D-38`.

⚠️ **Não estender `obrigatoriosFaltando`.** Aquela função exclui `tipo === 'anexo'` de
propósito, e o comentário dela diz por quê (`RN-11` viraria "anexe um arquivo"). A exigência
nova é de outra natureza — vem do schema para **um** assunto — e misturá-las apagaria a
distinção que `RN-11` protege nos outros nove. Funções separadas, mensagens separadas.

### 1.5 Duas ordens de criação, e a divergência é declarada

| Assunto | Ordem |
|---|---|
| anexo **obrigatório** | subir agora → criar **com** o anexo |
| anexo opcional ou ausente | criar → materializar depois (`D-26`, intacto) |

Isso é uma bifurcação, e bifurcação é dívida. A alternativa — mandar o anexo na criação para
**todos** — foi recusada: ela troca um caminho que comprovadamente funciona (9 assuntos, 4
chamados reais nascidos) por um caminho medido só uma vez, e o custo do erro é chamado
perdido. O risco vai onde a alternativa é falha certa.

⚠️ Quem decide a ordem é `anexoObrigatorio(schema)`, o **mesmo** predicado do gate. Duas
condições diferentes aqui produziriam o pior caso possível: trava exigindo arquivo e criação
sem ele.

### 1.6 Classificação de falha no caminho novo

O upload na confirmação é chamada à Atlassian **dentro** da janela da criação, então herda
`RNF-17` inteiro: 5xx/429/timeout → **transitório**, a submissão fica na fila e a pessoa lê
`respostaCriacao`; 4xx → **definitivo**, e a resposta é `criacaoNaoConcluida` (`D-46`) — nunca
um 201 dizendo que nada se perdeu.

⚠️ **Isto muda o alcance do `catch` de `ServicoChamados.processar`**, e é preciso cuidado
cirúrgico: `anexo-na-criacao.ts` mora **fora** dele de propósito. O caminho novo é outro — ele
precisa que a falha conte —, e por isso é **outro módulo**, não uma flag dentro daquele.

### 1.7 Expurgo

Os bytes seguem o expurgo de `anexos_pendentes` (12 h, carona no cron do outbox — T-415), e
somem também quando a materialização conclui: guardar arquivo depois que ele já está no Jira é
custo puro, e conteúdo pessoal a mais (`D-17`, `RNF-30`). `anexos_enviados` continua sem bytes,
e é ela que a tela lê (`D-51`).

## 2. Fases

| # | O quê | Sai com |
|---|---|---|
| 0 | Medir `M-1` e `M-2` na staging | Um desfecho da tabela de §0 |
| 1 | Emendas de documento (`RF-78`…`RF-80`, `RN-14`) | Rastreabilidade antes do código |
| 2 | `anexos_conteudo` + repositório fatiado, com teste | Bytes gravam e voltam íntegros |
| 3 | `anexoObrigatorio` + gate do servidor (com burla) | `ScB-01` vermelho→verde |
| 4 | Upload passa a guardar bytes; id temporário sai de lá | `SC-05` |
| 5 | Criação com anexo no corpo (só se `M-2` aceitar) | `SC-02` |
| 6 | Cartão e formulário: exigência + pendência composta | `SC-01`, `SC-03` |
| 7 | Medição na staging e devolução dos 6 assuntos à allowlist | `SC-02` medido de verdade |

## 3. Riscos

- 🚨 **`M-2` sair "não aceita"** — metade da feature morre e o trabalho vira pedido ao time de
  tech. Por isso é Phase 0.
- 🚨 **Regressão nos 9 assuntos que funcionam.** O upload muda para todo mundo (os bytes
  passam a ser guardados), mesmo que a ordem de criação só mude para 6. Mitigação: `SC-04`
  como teste, e a medição da Phase 7 inclui **um assunto de anexo opcional**.
- ⚠️ **Tamanho do banco.** 3 arquivos × 8 MB por conversa, com 12 h de vida. Vale medir o
  espaço ocupado depois de uma semana em produção — `RNF-36` fala de idas ao banco, não de
  bytes, e este é um custo novo que ninguém orçou.
- ⚠️ **O fake vai esconder tudo isto** se os testes afirmarem sobre o que ele devolveu. A
  asserção que vale é sobre **o corpo entregue ao `fetchImpl`** (`D-47`, `T-521`).

## 4. Alternativas descartadas

- **Mandar o anexo na criação para todos os assuntos** — §1.5.
- **Reprocessar as submissões que já falharam** — `RNF-17` diz que definitivo não volta, e
  reabrir isso por uma feature de anexo mistura dois assuntos. Fora de escopo, declarado na
  spec.
- **Trocar o assunto sozinho quando falta anexo** (`134` → `68`) — roteamento silencioso. O
  assunto decide a fila, e `D-53` pôs o nome dele no cartão justamente para a pessoa ver.
  Trocar por baixo é o oposto.
- **Uma lista de ids "que exigem anexo" em config** — funcionaria na Gocase e falharia calada
  em qualquer outra instalação, exatamente como `ScC-4` descreve. O schema já sabe.
- **Guardar os bytes fora do `env.DB` (Supabase)** — `D-74` mediu que não é preciso. Um
  segundo armazenamento significaria uma segunda credencial (`RNF-01`) e um segundo lugar de
  onde apagar dado pessoal (`D-17`).
