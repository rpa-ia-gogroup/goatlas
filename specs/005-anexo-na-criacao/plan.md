---
feature: "Anexo na criação do chamado"
spec: "./spec.md"
status: draft
created: "2026-08-07"
revised: "2026-08-07 — v2, depois do /analyze"
---

# Implementation Plan: Anexo na criação do chamado

> O **como**. O comportamento observável está na [`spec.md`](./spec.md).

## 0. O que mudou da v1 para a v2

A primeira versão deste plano punha os `temporaryAttachmentIds` **dentro** da
chamada de criação, imitando o portal nativo. O `/analyze` mostrou que isso não
entrega `RF-63` — pelo contrário, cria a falha exata que o projeto mais teme:

- id temporário expirado faz a **criação** responder **400**;
- `atlassian/http.ts` classifica 4xx como **definitivo**;
- `tickets/servico.ts` marca a submissão como `falha`, que **nunca é reprocessada**.

Ou seja: um anexo velho apagaria o chamado da pessoa. É o mesmo bug que
`rf24-outbox-degradacao` pegou uma vez e que o `CLAUDE.md` registra como padrão a
não repetir. **A v2 tira o anexo da chamada de criação.**

## 1. Technical Context

| Peça pronta | Onde | O que dá |
|---|---|---|
| Materialização do anexo | `atlassian/cliente.ts#anexarArquivo` | o segundo passo de `RF-25`, já usado por `RF-34` |
| Validação de arquivo | `http/anexo-entrada.ts` | teto de 8 MB e nome saneado. ⚠️ O máximo de 3 arquivos **não** mora ali: é um `.slice()` na rota, que **trunca em silêncio** — inaceitável para `SC-08`, ver §11 |
| Schema do request type | `atlassian/cliente.ts#obterCamposDoTipo` | de onde se sabe **se** o tipo aceita anexo (`RF-27`) |
| Outbox + idempotência | `tickets/servico.ts` | criação persistida antes da Atlassian (`RNF-17`) |

## 2. A decisão central: o anexo NÃO viaja na criação

O objetivo do produto é **uma ação da pessoa**, não uma chamada HTTP. Isso se
consegue com o servidor fazendo dois passos dentro da mesma confirmação:

```
confirmar → cria o chamado (sem anexo)  → issueKey
          → materializa o anexo na issueKey   ← pode falhar sozinho
          → responde: chamado + situação do anexo
```

| Alternativa | Por que não |
|---|---|
| Ids dentro do `requestFieldValues` da criação | Falha de anexo vira falha **definitiva** de criação; o chamado é perdido. Ver §0. |
| Upload só no clique de confirmar | 8 MB subindo dentro da confirmação: a pessoa espera sem retorno, e queda de rede derruba a criação junto. |
| **Upload ao escolher o arquivo; materialização depois da criação** | ✅ Feedback imediato no upload, criação intocada, falha de anexo isolada — que é literalmente `RF-63`. |

**Custo aceito e explícito:** existe uma janela curta em que o chamado existe sem o
anexo. Para o solicitante é invisível (uma tela só); para quem observa a fila, um
chamado pode aparecer segundos antes do arquivo. É barato perto de perder chamado.

## 3. Onde os ids temporários vivem

Tabela nova, `anexos_pendentes`: `id`, `solicitante_email`, `conversa_id` (nulo no
formulário), `chave_idempotencia`, `temporary_attachment_id`, `nome_arquivo`,
`criado_em`.

- **O cliente nunca recebe nem envia id.** Ele manda o arquivo e recebe
  `{ nome, ok }`. Id no cliente seria o mesmo furo de `RF-30` aplicado a arquivo.
- **Isolamento por e-mail no `WHERE`**, como `tickets/vinculos.ts` — não em
  `.filter()` posterior.
- **Correlação com a criação**: a chave é a **mesma string já normalizada** que a
  submissão usa (`form:<email>:<chave>` / `conversa:<id>`), gerada por uma função só,
  chamada dos dois lados. ⚠️ Hoje a rota reescreve a chave que o cliente manda
  (`rotas.ts:307`); gravar a crua no upload e procurar a prefixada na criação faria
  **nenhuma linha casar** — o chamado nasceria sem anexo e ninguém saberia. Por isso
  a chave passa a ser **obrigatória** quando há anexo, e "anexo pendente que não
  casou" é tratado como falha de anexo visível (`RF-63`), nunca silêncio.
- **Materialização é uma vez só**: `anexos_pendentes` tem `materializado_em` e
  `UNIQUE` que transforma a segunda tentativa em colisão tratada. Sem isso,
  reconfirmar (que devolve `duplicada: true` com o mesmo `issueKey`) anexaria o
  arquivo de novo — idempotência vem da constraint, como no resto do projeto.
- **Expurgo com TTL próprio e curto**, independente da política de retenção pessoal.
  ⚠️ `aplicarRetencao` não apaga nada quando a política é `null`, que é o default do
  MVP (`D-20`) — apoiar-se nela deixaria a tabela crescer para sempre. O id temporário
  já expirou do lado da Atlassian: a linha não vale nada depois de algumas horas.

## 4. ⚠️ Um furo que já existe no código, e que esta feature agravaria

`camposDinamicos` chega **do corpo da requisição** (`rotas.ts:314`) e é mesclado em
`requestFieldValues` sem allowlist de chave — só `summary` e `description` são
removidos (`cliente.ts:347`). Hoje o dano é limitado (o Jira recusa campo que não
pertence ao request type). **Com um campo de anexo no schema, passaria a ser o
caminho para colar id de anexo de outra pessoa no próprio chamado.**

A correção é independente desta feature e deve vir **antes** dela: as chaves de
`camposDinamicos` passam a ser validadas contra o schema do request type, e o
`fieldId` de anexo é excluído sempre — o anexo entra só pelo caminho do §2.

⚠️ **Schema indisponível descarta os campos adicionais** (fail-closed), o chamado
abre sem eles, e o evento vai para a auditoria. O oposto deixaria o furo aberto para
quem conseguisse derrubar ou estrangular a chamada de schema — validação que se
desliga sob pressão não é validação. Perder campo extra numa indisponibilidade é
aceitável; perder o chamado não seria (`RNF-18`).

⚠️ Isto **endurece `RF-27`/T-130** (spec 002): campo extra que hoje passa deixará de
passar. Vai documentado.

## 5. Data Model

| Mudança | Por quê |
|---|---|
| Tabela `anexos_pendentes` (com `materializado_em`) | §3 |
| `submissoes` ganha `declarou_anexo` (`0/1`, nulo = não respondeu) | `RF-62` precisa ser verificável no servidor, não só na UI |
| `ClienteAtlassian` ganha `subirAnexoTemporario` | Hoje `anexarArquivo` é atômica e exige `issueKey`; o §2 precisa dos dois passos separados. Interface + Http + Fake + `somente-leitura` (que **recusa**) — `RNF-22` |
| `TipoCampoRequestType` ganha `'anexo'` | ⚠️ Hoje o tipo é `'texto' \| 'texto_longo' \| 'selecao'` e o desconhecido cai em `'texto'` (`cliente.ts:230`). Ou seja: **um campo de anexo no schema já hoje seria renderizado como caixa de texto**. Sem este tipo não há como o §6 saber se o request type aceita anexo, e `RF-27` continuaria desenhando um input errado ao lado do seletor de arquivo |

## 6. A trava, em duas camadas

Como toda trava crítica (`agent/gate.ts` é o modelo):

1. **UI** — o botão de abrir não fica disponível antes da declaração.
2. **Servidor** — a rota de criação recusa proposta sem declaração.

A camada 2 sozinha basta; a 1 sozinha é teatro.

**A regra exata:** o gate vale quando o schema do request type é **conhecido e
expõe** campo de anexo. Schema indisponível → sem pergunta, chamado abre, evento
auditado.

⚠️ **`RF-62` é qualidade de produto, não trava de segurança — e a distinção é o que
resolve a contradição.** Uma trava de segurança não pode ser fail-open, porque
derrubar a chamada de schema viraria o caminho da burla. Aqui o "burlado" só
consegue abrir o próprio chamado sem responder uma pergunta: não há exposição, não
há dado de terceiro, não há escrita indevida. O que se perde é a evidência — dele
mesmo. Fail-closed no lugar disto significaria não abrir chamado durante uma
indisponibilidade de leitura de schema, que é caro e é exatamente o que `RNF-18`
proíbe.

**Mitigação barata, ainda assim:** usar o schema **em cache** (`ttlMetadadosSeg` já
existe) antes de cair no fail-open. Uma indisponibilidade curta não faz a pergunta
sumir para quem acabou de vê-la.

Isto é um desvio consciente do padrão fail-closed do projeto, e está declarado no §9.

## 7. Criação diferida (o caminho que a v1 esqueceu)

Quando a criação vai para o outbox (`estado: 'pendente'`, `RNF-17`), não há
`issueKey` para materializar o anexo, e o id temporário terá expirado quando o cron
rodar. **Decisão: o anexo não é carregado para o reprocessamento.** A confirmação
diz que o chamado está na fila e que o anexo precisará ser adicionado quando ele
nascer; o aviso de `RF-44` repete isso. Fingir que o arquivo vai junto seria pior
que dizer a verdade.

## 8. Ordem de execução

1. A correção do §4 (independente, e pré-requisito de segurança).
2. Caminho **sem IA** (`D-04`) — já renderiza o schema, o campo é aditivo, e é o
   caminho que sobrevive à IA fora do ar. Lugar mais barato de errar.
3. Conversa.

## 9. Complexity Tracking

| Desvio | Justificativa | Alternativa descartada |
|---|---|---|
| **Persistência nova** (`anexos_pendentes`) | Sem ela, ou o id vai para o cliente (furo de `RF-30`) ou o upload acontece dentro da confirmação (§2) | Guardar em memória do Worker — impossível: stateless entre requisições, e foi bug real (`CLAUDE.md`) |
| **Upload antes da confirmação** | Feedback imediato e criação intocada | Upload no confirm — rejeitado no §2 |
| **Requisito P1 virando pré-condição de fluxo P0** | A declaração (`RF-62`, P1) bloqueia a abertura (P0). Aceito porque o bloqueio é de **uma pergunta**, sempre respondível, e some quando o tipo não aceita anexo (§6) | Campo opcional — é o desenho que a spec §1 rejeita, porque ninguém responde |
| **`RF-62` é fail-OPEN, contra o padrão do projeto** | Schema indisponível abre o chamado sem perguntar. Justificado no §6: não é trava de segurança, e o "burlado" só perde a própria evidência. Mitigado por cache de schema | Fail-closed — não abrir chamado numa indisponibilidade de leitura de schema, contra `RNF-18` |
| **Mudança de contrato em `TipoCampoRequestType`** (§5) | Sem ela não há como saber se o tipo aceita anexo, e `RF-27` renderiza o campo como texto | Inferir por nome do campo — heurística sobre dado de terceiro, quebra em qualquer renomeação |

## 10. Riscos

| Risco | Mitigação |
|---|---|
| Request type da Gocase não expõe campo de anexo (`Q1`) | A pergunta some e o chamado abre. Feature dormente, nada quebra. |
| Memória do Worker | Teto de 8 MB já existe, menor que o de leitura por este motivo. Um arquivo por requisição. |
| **Upload que nunca vira chamado** consome a credencial única (`R-02`) | Teto por pessoa/janela na rota de upload, e expurgo das órfãs (§3) |
| Pessoa entende a pergunta como "preciso ter anexo" | Copy: "não tenho material para anexar", nunca "pular" |
| Duplo clique no seletor gera dois temporários | Dedupe por `(chave_idempotencia, nome_arquivo)` |

## 11. O teto de arquivos muda de dono

Hoje `MAX_ANEXOS_POR_ENVIO = 3` é **por requisição**, aplicado com um `.slice()` na
rota (`rotas.ts:571`) — que **trunca em silêncio**. Com upload um a um (§10), "3 por
requisição" deixa de significar qualquer coisa: a pessoa sobe um de cada vez.

O teto passa a ser **por chamado**, contado nas linhas de `anexos_pendentes` da mesma
chave, e a recusa é uma **mensagem** — nunca truncar. `SC-08` exige dizer o limite; um
`.slice()` faz o quarto arquivo desaparecer sem nada na tela, que é a versão silenciosa
do mesmo problema que esta feature veio resolver.
