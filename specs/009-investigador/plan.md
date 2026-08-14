---
feature: "investigador"
id: "009"
status: ready
created: "2026-08-14"
---

# Plano técnico — Investigador (HOW)

## 1. Forma geral

Um **coletor por requisição**, que acumula em memória e grava **uma vez**, no fim.

```
worker.ts → tratarRequisicao
              ├─ abre a coleta (id da requisição, e-mail, caminho)
              ├─ rotear(...)            ← eventos entram aqui e nos clientes
              └─ fecha: 1 linha de API + N eventos, em 1–2 idas ao banco
```

Nada no caminho de leitura do usuário muda. O coletor é injetado, nunca ambiente:
`montarContexto` roda **por requisição** (worker.ts:29), então o objeto de coleta é
naturalmente isolado — não existe variável de módulo compartilhada entre requisições
concorrentes, que seria o jeito de trocar a conversa de uma pessoa pela de outra.

## 2. Banco

Duas tabelas em `db/schema.ts` (`TABELAS`), com índice por `criado_em` (para o expurgo e
para a lista) e por `conversa_id` (para o detalhe).

```sql
investigador_requisicoes(
  id, ator_email, conversa_id, metodo, caminho, status, duracao_ms,
  req_bytes, resp_bytes, req_json, resp_json, erro, criado_em)

investigador_eventos(
  id, requisicao_id, conversa_id, ator_email, tipo, origem,
  resumo, dados_json, custo_usd, duracao_ms, ordem, criado_em)
```

- `ordem` é o índice do evento **dentro da requisição**. Sem ele, dois eventos gravados no
  mesmo milissegundo (o normal, já que a gravação é em lote) ficariam com ordem
  indeterminada na tela — e a pergunta que a tela responde é justamente "em que ordem?".
- `requisicao_id` liga o evento à requisição que o produziu: é como se lê "esta ida ao
  modelo aconteceu dentro daquele POST que levou 38 s".
- `origem ∈ {usuario, ia, servidor, atlassian, teamguide, ocr, jira}` — é o que a tela
  colore. União fechada em TypeScript, como `AcaoAuditada`.

⚠️ **Não são migrações de coluna** (`COLUNAS_ADICIONADAS`): tabelas novas entram em
`TABELAS`, e a marca de versão do schema é derivada do texto (`VERSAO_SCHEMA`), então não há
número a subir.

## 3. `src/lib/investigador/`

| Arquivo | Papel |
|---|---|
| `tipos.ts` | `TipoDeEvento` (união fechada), `OrigemDeEvento`, `EventoInvestigador` |
| `coleta.ts` | `ColetaDeRequisicao` — acumula, trunca, redige e **grava uma vez** |
| `registro.ts` | `Investigador` (interface) · `InvestigadorBanco` · `InvestigadorDesligado` |
| `leitura.ts` | as consultas do painel, todas agregadas (`SC-8`) |

**Truncamento e redação moram em `coleta.ts`, num lugar só.** A redação reaproveita
`redigirSensiveis` de `audit/` — duas implementações divergiriam na primeira correção, que é
a lição já escrita em `credencial-de-cabecalho.ts`.

**`InvestigadorDesligado` é objeto, não `null`.** Um `ctx.investigador?.registrar(...)`
espalhado por dez arquivos é dez lugares para esquecer o `?.`; um no-op é um lugar só. Mesmo
raciocínio de `ClienteIAIndisponivel` (T-132) e de `lerPdf` nunca ser `null`.

**Falha de gravação é engolida com `catch`** (`FR-20`) — e registrada uma vez no `console`,
que é o que aparece em `getAppLogs`. Deixar subir transformaria a ferramenta de investigação
na causa do próximo incidente.

## 4. O corpo das requisições

- **Entrada:** lida de `req.clone()` **apenas** quando `content-type` é JSON e
  `content-length` cabe no teto. Fora disso registra `{tipo, bytes}`. Ler multipart de 8 MB
  para depois descartar é dobrar a memória do Worker num caminho que já é o mais apertado do
  app (`http/anexo-entrada.ts`).
- **Saída:** `resposta.clone().text()` **apenas** quando o `content-type` da resposta é
  JSON. O proxy de anexo (`RF-31`, `D-11`) serve megabytes binários e fica de fora por
  construção.
- **Teto:** `MAX_CORPO = 16_000` caracteres, com sufixo `…[truncado, N caracteres]`.

## 5. Onde os eventos nascem

| Evento | Lugar |
|---|---|
| `mensagem_usuario`, `resposta_agente`, `ia_chat`, `ia_extracao`, `tool_executada`, `tool_recusada`, `bloqueio`, `proposta_rederivada` | `agent/orquestrador.ts` |
| `proposta_editada` | rota `PUT /api/conversas/:id/proposta` |
| `override` | rota de override |
| `formulario_alterado` | `POST /api/investigador/formulario` (a tela declara) |
| `declaracao_anexo`, `anexo_recebido`, `anexo_analisado` | rotas de anexo e `http/analise-no-upload.ts` |
| `payload_final` + `desfecho_criacao` | `tickets/servico.ts`, onde o payload já está pronto e serve **os dois** caminhos de criação |
| `chamada_externa` | os cinco transportes (§6) |

⚠️ `payload_final` mora em `servico.ts`, não nas rotas: as duas rotas de criação montam o
mesmo objeto e registrar nas duas produziria a divergência que `D-52` (duas áreas) e `D-70`
(duas listas de tipos) já custaram.

⚠️ **A extração registra a resposta bruta do modelo quando não há proposta** (`FR-6`). Isso
exige um campo novo, opcional, em `ResultadoExtracao` — documentado como *só para o
Investigador*. Não fere `RNF-23`: o que atravessa é o texto que o próprio modelo escreveu,
nunca um tipo do provedor.

## 6. Chamadas externas — o ponto de ruptura

Um `observador` opcional injetado em cada transporte, sempre a partir de `contexto.ts`:

- `atlassian/http.ts` (Jira + Confluence) · `atlassian/organizacao.ts` ·
  `ia/cliente.ts` (`chamar`) · `teamguide/http.ts` · `ocr/http.ts`.

O que vai: `alvo` (`atlassian` · `organizacao` · `ia` · `teamguide` · `ocr`), método,
**caminho** (nunca a query inteira — ela carrega CQL e JQL, e JQL pode nomear projeto que
quem lê não deveria conhecer, `RNF-30`), status, duração, e o motivo classificado no erro.
**Nunca cabeçalho, nunca corpo da chamada externa** — é por ali que a credencial anda
(`RNF-01`).

## 7. Rotas (`/api/investigador/*`, todas com `if (!eu.isAdmin) return ERROS.semPermissao()`)

| Rota | Devolve |
|---|---|
| `GET /sessoes` | lista com métricas agregadas, filtros por query |
| `GET /sessoes/:id` | linha do tempo (mensagens + eventos), requisições daquela conversa |
| `GET /requisicoes` | log global de API, filtros `status`, `caminho`, `q` |
| `GET /resumo` | totais, taxa de erro, duração média, por endpoint |
| `POST /formulario` | **a única escrita**, e a única vinda do cliente (`FR-8`) |

⚠️ `POST /formulario` aceita dado do cliente, então: o `tipo` é fixado **no servidor**, o
e-mail vem do header (nunca do corpo), o valor é truncado como qualquer outro, e a rota já
está sob o rate limit de `RNF-11` (todo `POST` passa por ele).

## 8. Configuração

Duas chaves novas em `ConfigValores`, com família em `config/validar.ts`:

- `investigador_ligado: boolean` — default **`true`**. É a única chave do projeto cujo
  default não é fail-closed, e a razão é que ela não governa **exposição**: governa se
  existe registro. O precedente é `emails_piloto` (`D-16`), onde o vazio libera porque negar
  trancaria a empresa fora do canal de suporte.
- `investigador_retencao_dias: number` — default **30**.

**Sem campo no console** (`D-25`): como TTL, rate limit e teto de tickets, são ajustes que
ninguém decide sem ler o código. `tests/tela-admin.test.ts` continua reprovando quem os
puser na tela sem passar por uma decisão.

## 9. Expurgo

Pega carona no cron do **outbox** (`/api/cron/reprocessar-submissoes`), como o expurgo dos
anexos pendentes (T-415), e pelas duas mesmas razões: `aplicarRetencao` não apaga nada com
política `null` (`D-20`) e `/api/cron/retencao` responde **403** hoje. Código pendurado lá
nunca rodaria.

## 10. A tela

`src/app/investigador.tsx`, aba nova em `App.tsx`/`rotas.ts` (`/investigador`, `soAdmin`),
folha própria `investigador.css`. Segue `identidade_visual_gogroup.md`; estado nunca só por
cor (cada origem tem **palavra**, não só faixa colorida); `prefers-reduced-motion`; foco
visível. A lista e o detalhe são duas telas dentro da aba, com o histórico empilhando como
o resto do app (`D-65`).

## 11. Riscos aceitos

- Uma requisição que morra **antes** do `finally` perde o próprio rastro. Alternativa
  (gravar evento a evento) custa uma ida de rede por evento e é justamente o que `FR-10c`
  recusa. Crash duro continua aparecendo em `getAppLogs`.
- O registro guarda conteúdo pessoal. Mitigado por: gate de admin no servidor, retenção
  curta, redação de credencial e a separação declarada de `auditoria`.
- `+1` ida ao banco por requisição `/api/*`. Medida, não estimada: entra em
  `tests/latencia.test.ts` como contagem.
