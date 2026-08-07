# Deploy e operação — goatlas

Atende **RNF-10** (rotação e revogação de emergência das três credenciais, sem
downtime) e **RNF-27** (privilégios de cada credencial, variáveis, como rodar
local).

> ⚠️ **Regra 10 do `CLAUDE.md`: staging antes de produção.** Nenhuma mudança de
> código chega a prod sem ter sido validada no app de staging.

---

## Rodar local (sem credencial nenhuma)

```bash
npm install
npm run dev      # http://localhost:5173
npm run test     # Vitest
npm run build    # SPA em dist/
npm run build:worker
```

O dev server serve `/api/*` com o **mesmo código do Worker**, via
`vite-plugin-api-dev.ts`. Como em produção o OAuth é do **edge do GoDeploy**
(`D-02`), o plugin injeta `x-godeploy-user-email` no lado do servidor — **nunca no
navegador**, para não existir caminho em que a identidade venha do cliente
(`RF-04`, `RNF-05`).

- Usuário de dev: `dev@gocase.com` (mude com `GOATLAS_DEV_EMAIL`).
- Clientes: **fakes** (`GOATLAS_USAR_FAKES=1`), com o fake de IA roteirizado para
  o fluxo completo passar. Nenhuma credencial é necessária.
- Banco: `.goatlas-dev.db` (gitignored). Apague o arquivo para começar do zero.
- A config é semeada no primeiro boot. **Sem ela o app é fechado** — allowlist
  vazia nega tudo (`RNF-07`), e é assim que uma instalação nova se comporta.

## Apps no GoDeploy

| Ambiente | appId | Uso |
|---|---|---|
| **demo / futura produção** | **`9c47f42f`** — https://goatlas.devgogroup.com | No ar em **modo demonstração** (`D-07`). Vira produção quando as credenciais reais entrarem |
| **staging** | *(a criar)* | ⚠️ **Criar ANTES do primeiro deploy com credencial real** — regra 10 |

### Secrets já configurados em `9c47f42f`

Estado em **07/08/2026** (conferido por `listAppSecrets` — que devolve **nomes**,
nunca valores):

| Secret | Estado | Por quê |
|---|---|---|
| `GOATLAS_SOMENTE_LEITURA` | `1` | Lê Confluence/Jira de verdade e **recusa toda escrita**. É a trava que sustenta o app hoje |
| `GOATLAS_DOMINIOS` | `gocase.com` | Bootstrap — sem ele o app nega todo mundo (`RNF-07`). **[SUPOSIÇÃO: Q7]** |
| `GOATLAS_ADMINS` | *(registrado)* | Bootstrap do primeiro admin (`RF-02`) |
| `ATLASSIAN_API_TOKEN` · `ATLASSIAN_EMAIL` · `ATLASSIAN_BASE_URL` | *(registrados)* | 🚨 **O token é da família ERRADA** — `ATCTT` onde `/rest/api/3/*` exige `ATATT`. É o 401. Ver `D-22` |
| `LLM_API_KEY` · `LLM_BASE_URL` · `LLM_MODEL` | *(registrados)* | Proxy de IA (`D-05`). ⚠️ Rotação pendente: a chave transitou por chat |
| `GODEPLOY_CRON_KEY` | *(registrado)* | 6 das 7 rotas de cron respondem **200** (medido por `listCronJobs` em 07/08). A `retencao` dá **403 de propósito** — ver a seção de cron |
| `GOATLAS_BASE_PUBLICA` · `GOATLAS_CANAL_NOTIFICACAO` | *(registrados)* | Bootstrap dos defaults de `D-20` |
| `GOATLAS_ORG_ID` | *(registrado e **VALIDADO**)* | Bootstrap do `org_id`. Não é secret. ✅ `GET /admin/v1/orgs/{id}` responde 200 (`D-23`). ⚠️ Ele tem `j`/`k` e **está certo** — org id da Atlassian não é UUID estrito; quem é UUID estrito é o `cloudId` |

Ainda **ausentes**: `ATLASSIAN_ORG_API_KEY` (e o valor certo para ela é o `ATCTT` que
hoje está em `ATLASSIAN_API_TOKEN`), `GOATLAS_WEBHOOK_SEGREDO`,
`GOATLAS_SERVICE_DESK_ID`, `GOATLAS_TIPOS_CHAMADO`, `GOATLAS_ESPACOS_CONFLUENCE`
(**Q5**, valores escolhidos em `D-22`) e `GOATLAS_CAMPO_SOLICITANTE_ID` (**Q4**).

#### ⚠️ `GOATLAS_MODO_DEMO` já NÃO está configurado — o app não está nos fakes

`usandoFakes` (em `contexto.ts`) é `modoDemo || GOATLAS_USAR_FAKES || !ATLASSIAN_API_TOKEN`.
Os três termos são falsos hoje: o modo demo saiu, e o token está registrado. **O app
roda com os clientes reais**, e o que impede efeito colateral é
`GOATLAS_SOMENTE_LEITURA`, não o modo demo.

⚠️ Isso desloca onde mora a segurança: enquanto o modo demo existia, nenhum secret
mudava comportamento. Agora **remover `GOATLAS_SOMENTE_LEITURA` vale na hora** — é o
único passo entre o estado atual e escrita real no JSM. Ver a ordem abaixo antes de
tocar nele.

Cada ausência silencia uma parte diferente, todas fail-closed. Configure nesta ordem,
e só então remova o modo demo:

| Falta | O que acontece com o modo demo fora |
|---|---|
| `LLM_API_KEY` | `ClienteIAIndisponivel`: `/api/health` responde **503** dizendo o motivo, o agente recusa, e o formulário mínimo (`D-04`) segue abrindo chamado. **Antes de T-132 isto era `ClienteIAFake` — Atlassian real com IA falsa** |
| `GOATLAS_TIPOS_CHAMADO` + `GOATLAS_SERVICE_DESK_ID` | Allowlist vazia → `RF-28` descarta toda proposta → ninguém abre chamado |
| `GOATLAS_ESPACOS_CONFLUENCE` (**Q5**) | Busca devolve zero com `buscaConfigurada: false`; a deflexão da Regra 1 morre |
| `GODEPLOY_CRON_KEY` | **Todas** as rotas de cron ficam fechadas — inclusive o polling do Jira e o envio de notificação, que são o que faz a Fase 3 funcionar |
| `GOATLAS_WEBHOOK_SEGREDO` | `POST /api/webhook/jira` responde 403 a tudo (fail-closed). O polling sozinho continua notificando — é por isso que `RF-47` pede duas fontes |
| `EMAIL_API_KEY` | Só importa se o canal escolhido for e-mail. Sem ela o canal recusa em vez de fingir envio |
| `GOATLAS_CANAL_NOTIFICACAO` (**Q11**) | Sem ele, o aviso é registrado e suprimido e a tela diz "ninguém definiu canal". **Com `nenhum`** (a decisão de `D-20`) o efeito é o mesmo, mas a tela passa a dizer "os avisos vivem aqui" — a diferença é a decisão, não o comportamento. Não é secret: é URL/enum |
| `GOATLAS_BASE_PUBLICA` | As notificações saem **sem link**. O cron não tem `Request` de onde derivar o host, então este valor não é descobrível. Barra final é tolerada |
| `LLM_BASE_URL` + `LLM_MODEL` | Sem eles a chave de IA sozinha não liga nada. **Valor medido em 07/08/2026, não inferido:** `https://ai-proxy.gogroupbr.com/v1` — `/v1/chat/completions` responde **401** (rota existe, pede auth) e `/chat/completions` responde **404**. A URL **sem** `/v1` daria 404 parecendo "a IA caiu". Barra final é tolerada (`D-20`) |

**Os valores não sensíveis, para copiar** (já registrados em `9c47f42f`):

```
GOATLAS_BASE_PUBLICA      = https://goatlas.devgogroup.com
GOATLAS_CANAL_NOTIFICACAO = nenhum
LLM_BASE_URL              = https://ai-proxy.gogroupbr.com/v1
LLM_MODEL                 = gpt-5.4-mini
```

⚠️ **Como descobrir o `/v1` sem chave, se um dia o proxy mudar:** `curl -o /dev/null -w
"%{http_code}" <base>/v1/models` — **401** significa "rota existe, falta auth" e **404**
significa "não é aqui". Distinguir os dois com um `curl` é mais rápido que debugar um
`ClienteIAIndisponivel` que na verdade era caminho errado.

⚠️ Estes dois **não são secret** — são URL e enum. Estão como env porque variam por
ambiente (staging tem outro host), não porque sejam sensíveis.

Os dois do meio dão para preencher no console de admin depois, sem deploy (`RF-49`).
`LLM_API_KEY`, `GODEPLOY_CRON_KEY`, `GOATLAS_WEBHOOK_SEGREDO` e `EMAIL_API_KEY` são
secret — exigem `setAppSecret`.

**Confira o health antes de anunciar o app:** `GET /api/health` devolve 503 com
`dependencias.ia.ok = false` enquanto a chave de IA não existir. É o sinal de que o
deploy está incompleto (`RF-59`) — sem ele, um app sem chave de IA parecia saudável.

O env é **bootstrap**: vale enquanto a chave não existe no banco. Assim que um admin
salva pelo console, o banco manda (`RF-49`).

Ambos precisam de `visibility: authenticated`: é isso que faz o edge injetar
`x-godeploy-user-email`. Um app `public` **não** recebe o header, e o goatlas
nega todo acesso sem identidade — ou seja, ficaria inutilizável.

### Deploy

```bash
# 1. Build (nesta ordem — o typecheck faz parte do build)
npm run test && npm run build && npm run build:worker

# 2. MCP GoDeploy: getUploadToken → guarde uploadUrl e uploadId
# 3. Suba os arquivos: TODO o dist/ (recursivo) + worker.js
# 4. MCP updateApp:
#      appId       → STAGING primeiro, prod só depois
#      uploadId    → do passo 2 (single-use)
#      entrypoint  → "worker.js"
#      assets      → lista derivada do dist/ REAL, gerada agora
#      assetConfig → { "not_found_handling": "single-page-application" }
```

**Armadilhas — as duas primeiras já morderam neste app:**

- **⚠️ O nome do campo no upload é o CAMINHO SERVIDO, e não pode ter o prefixo
  `dist/`.** Subir `-F "dist/index.html=@./dist/index.html"` faz a SPA ser servida em
  `/dist/index.html`, e a raiz dá **404** — foi exatamente o que aconteceu na
  primeira publicação. O certo:

  ```bash
  curl -X POST "$UPLOAD_URL" -H "Authorization: Bearer $TOKEN"     -F "worker.js=@./worker.js"     -F "index.html=@./dist/index.html"     -F "assets/index-abc123.js=@./dist/assets/index-abc123.js"
  #    ^^^^^^ caminho SERVIDO           ^^^^^^^^^^ arquivo LOCAL
  ```

  Sintoma de diagnóstico: nos logs, `GET /` aparece com `source: worker`. Isso
  significa que a plataforma **não achou asset** para `/` e caiu no worker, que
  devolve 404 para o que não é `/api/`.

- **⚠️ `updateApp` MESCLA os assets, não substitui.** Passar a lista certa **não**
  remove a errada — o manifest fica com as duas. Para limpar, são dois deploys:
  primeiro `assets: []` (zera), depois a lista correta. Confira o resultado com
  `getApp` + `include: ["manifest"]`; se houver caminho a mais ali, o próximo deploy
  vai confundir quem for depurar.

- **Nunca reaproveite a lista de assets.** O Vite gera hash novo a cada build;
  lista antiga → tela branca. Derive do `dist/` real, na hora.
- **`uploadId` é single-use** — um por deploy.
- **SPA fallback é obrigatório**, senão qualquer rota que não seja `/` dá 404.

### Cron da plataforma

O cron é do **GoDeploy**, não do app (o Worker não tem processo longo). Depois do
primeiro deploy, registre:

⚠️ **A ordem importa em um caso:** registre `polling-jira` **antes** de
`enviar-notificacoes`. Ao contrário, a primeira rodada de envio encontra a fila vazia e
parece que o cron não funcionou — o que leva alguém a mexer no que estava certo.

| Rota | Sugestão | Para quê |
|---|---|---|
| `POST /api/cron/reprocessar-submissoes` | `*/5 * * * *` | `RNF-17` — chamado que ficou pendente por falha da Atlassian |
| `POST /api/cron/reconciliar-vinculos` | `0 * * * *` | `RNF-21` — vínculo órfão (criado no JSM, vínculo perdido) |
| `POST /api/cron/coletar-inventario` | diário, ex. `0 6 * * *` | `RF-51`/`RF-52` — a Organizations API não serve consulta interativa (T-124). Sem `ATLASSIAN_ORG_API_KEY`/`org_id` configurados, a rota responde `ok` com `organizacao_nao_configurada` — não é erro, é ausência de credencial (**Q1**) |
| `POST /api/cron/polling-jira` | `*/5 * * * *` | `RF-47` — detecção de mudança que **não depende do webhook**. ⚠️ Sempre ligado, mesmo com o webhook registrado: a dedupe existe justamente para os dois conviverem, e notificação com mecanismo único falha em silêncio. A marca-d'água só avança no que deu certo |
| `POST /api/cron/enviar-notificacoes` | `*/5 * * * *` | `T-225` — despacha a fila. Falha transitória volta para `pendente`; só definitiva vira `falha` (mesma lógica do outbox) |
| `POST /api/cron/alertas-sla` | `0 * * * *` | `RF-46` — alerta de **primeira resposta**. `alertas_sla` impede repetir o mesmo alerta a cada rodada, e a rodada grava o retrato que o painel de admin lê (sem isso, abrir o console varreria a Atlassian) |
| `POST /api/cron/retencao` | diário, ex. `0 4 * * *` | `RNF-33` — expurgo. **Com a política toda `null` (o default) ele não apaga nada**, e é assim que deve ficar até alguém decidir os prazos. Nunca toca `vinculos`; a auditoria tem piso de 180 dias (`D-17`) |

A rota exige o header assinado `X-Godeploy-Cron` conferido contra
`GODEPLOY_CRON_KEY`. **Sem a chave configurada a rota é fechada** (fail-closed) —
o contrário deixaria a rota aberta justamente na instalação que esqueceu de
configurar.

🚨 **O header do cron é ASSINADO — não é a chave. Medido em 07/08/2026, no app real.**

Com `GODEPLOY_CRON_KEY` corretamente registrada, as sete rotas continuavam respondendo
**403**. O que a plataforma estampa em `X-Godeploy-Cron` é:

```
t=<unix 10 dígitos>;<rótulo 3 letras>=<hmac-sha256 em 64 hex>
```

Descoberto sem nunca registrar o valor: um diagnóstico logava só a **estrutura** do header
(separadores, e por segmento o tamanho e o conjunto de caracteres). O código agora verifica
por HMAC (`http/cron-auth.ts`), com janela de tempo contra replay e comparação em tempo
constante.

⚠️ **Falta um dado que só o time da plataforma tem: QUAL string é assinada.** Foram
testadas 10 construções de mensagem × 2 leituras da chave (texto e hex decodificado em 32
bytes) — **nenhuma casou**. Cada tentativa custa um ciclo de cron, e chutar não converge.

#### ✅ Resolvido por outro caminho — e a assimetria entre as rotas é de propósito

Estado medido por `listCronJobs` em 07/08/2026 (`version 18`): **6 das 7 rotas respondem
200**. O que passou a valer:

- **Rotas idempotentes → aceitam por PRESENÇA do header**, e só quando a requisição **não
  traz identidade de usuário**. Essa segunda condição é o que distingue o gateway da
  plataforma de um funcionário logado forjando o header — sem ela, a checagem por presença
  seria só decoração. É seguro porque o desenho dessas rotas já é idempotente: outbox por
  constraint, dedupe pelo carimbo do Jira, marca-d'água que só avança no que deu certo.
  Disparar duas vezes não produz efeito diferente de disparar uma.
- **`/api/cron/retencao` → mantém HMAC obrigatório, e por isso segue em 403.** É a única
  rota que **apaga dados**, e para ela "não consegui verificar quem chamou" tem de significar
  "não executo". **Fail-closed deliberado, não defeito.** Custo aceito: a retenção não roda —
  hoje inócuo, porque a política é toda `null` (`D-20`) e ela não apagaria nada de qualquer
  forma. Quando os prazos forem decididos, a pergunta abaixo volta a ser bloqueio.

⚠️ **Diagnóstico de cron é `listCronJobs`, não leitura de código.** Ele mostra o status do
último disparo por job: `404` = rota não deployada · `403` = gate · `500` = handler explodiu
(aí `getAppLogs`). Foi assim que se descobriu que o `CLAUDE.md` ainda afirmava "403 nas sete
rotas" muito depois de seis terem voltado a funcionar — e que o 403 de 04:00 da `retencao`
era **anterior** ao deploy das 04:16.

⚠️ **Cron é UTC.** BRT é UTC−3 sem horário de verão, então *hora desejada em BRT + 3*.
`0 4 * * *` dispara à **01:00 em Brasília**. Conferir isso antes de agendar qualquer job
novo é mais barato que descobrir pelo log.

**A pergunta exata para a plataforma:**

> No header `X-Godeploy-Cron` (`t=<unix>;<rótulo>=<hmac-sha256-hex>`), qual é a string
> exata usada como mensagem do HMAC, e a `GODEPLOY_CRON_KEY` entra como texto ASCII ou
> hex-decodificada em bytes?

Com a resposta, é editar `mensagensCandidatas` em `http/cron-auth.ts` — e reduzir a lista à
construção confirmada, que é o estado desejável.

**Até lá os sete crons estão registrados e recusando**, o que significa: notificação só
chega por quem abre o app, o outbox não reprocessa sozinho, o inventário de assentos não
coleta e a retenção não roda. Nada se perde — só não acontece sozinho.

⚠️ **A plataforma NÃO provisiona `GODEPLOY_CRON_KEY`** — conferido no `godaily`, onde ela
foi criada à mão junto com os outros secrets. E cuidado com a **confusão de credencial**:
uma chave de prefixo `gdk_` parece ser da **plataforma** (a que deploya e lê secrets de
todos os seus apps), não do cron deste app. Guardar uma dessas num env de app exporia,
dentro do app, algo com muito mais poder do que ele precisa — é a mesma família de troca
já registrada em `D-14`.

**Como saber POR QUE recusou, sem logar segredo nenhum:** o `detalhe_json` da auditoria
de `acesso_negado` traz o motivo, e o log da plataforma traz a estrutura do header —
**comprimentos e conjuntos de caracteres, nunca valores nem prefixos**.

| `detalhe` | O que significa |
|---|---|
| `header_ausente` | O cron não está chegando à rota (rota errada, ou o edge barrou) |
| `chave_ausente` | Falta o secret `GODEPLOY_CRON_KEY` |
| `formato_desconhecido` | A plataforma mudou o esquema de assinatura |
| `carimbo_fora_da_janela` | Relógio torto, ou requisição repetida fora da janela de replay |
| `assinatura_invalida` | Chave errada — **ou** a mensagem assinada não é nenhuma das candidatas |
| nada na auditoria e `200` no log | Funcionou; o log diz qual combinação casou |

Essa distinção existe porque o sintoma dos cinco casos é idêntico (403), e adivinhar entre
eles é o que fez este bug custar uma noite.

### Webhook do Jira (RF-48)

🚨 **MEDIDO EM 07/08/2026, NO APP REAL: o webhook NÃO é alcançável de fora hoje.**

Com `visibility: authenticated`, o edge do GoDeploy intercepta **tudo** antes do worker e
responde **302** para o OAuth — inclusive `/api/webhook/jira` e `/api/health`. Conferido
com `curl` contra `https://goatlas.devgogroup.com`: a requisição **não aparece nos logs do
app**, porque nunca chegou ao worker. A Atlassian não faz o OAuth do GoDeploy, então ela
receberia o mesmo 302 e o evento se perderia.

**Isso não derruba a Fase 3, e não é acidente:** `RF-47` exige que a notificação **não
dependa de mecanismo único**, e é exatamente por isso que o polling existe e fica **sempre
ligado**. Com o webhook bloqueado, a notificação chega com o atraso de uma janela de cron
(5 minutos na sugestão acima) em vez de em segundos. Todo o resto funciona igual.

**As três saídas, e por que duas não servem:**

| Saída | Veredito |
|---|---|
| `setAppPublic` no app | ❌ **Não.** Tornaria o app **inteiro** público, e `RF-01`/`RF-05` dependem de o edge injetar `x-godeploy-user-email`. Sem o edge, não há identidade — é trocar um atraso de 5 minutos por um app aberto |
| Exceção de rota no edge (só `/api/webhook/*` público) | ⏳ **A perguntar à plataforma.** É a saída certa se existir. O código já está pronto para ela: o segredo próprio, a comparação de tempo constante e o `202` uniforme existem justamente porque essa rota é desenhada para viver fora do SSO |
| Ficar só com o polling | ✅ **É o estado atual, e é aceitável.** Notificação em até 5 minutos, sem nenhuma superfície pública |

Quando a exceção existir, quem registra é o **time de tech**, no Jira: `Configurações do
sistema → Webhooks`, apontando para

```
https://<dominio-do-app>/api/webhook/jira?k=<GOATLAS_WEBHOOK_SEGREDO>
```

Eventos: criação e atualização de issue, e criação de comentário. O segredo também é
aceito no cabeçalho `x-goatlas-webhook`, para quem preferir não pôr nada na URL.

⚠️ **Três coisas para não estranhar quando testar:**

1. **A resposta é sempre `202`**, com ou sem vínculo local. Um 404 para chamado
   desconhecido seria oráculo de "este chamado passou pelo goatlas?" (`D-15`).
2. **Segredo errado dá `403` com corpo idêntico ao de segredo ausente**, e a comparação é
   de tempo constante. A tentativa fica na auditoria — **sem** o segredo enviado.
3. **O corpo do evento é ponteiro, não conteúdo.** O app tira dele só a chave do chamado
   e relê tudo da Atlassian. Testar mandando um `comment.body` inventado não produz
   notificação com aquele texto — e é de propósito.

**O webhook é opcional** — e hoje, na prática, desligado pelo edge (ver o aviso acima).
Sem ele o polling notifica sozinho. É o que `RF-47` pede: notificação não pode depender de
mecanismo único, e este é o caso em que essa exigência pagou.

⚠️ **`/api/health` está no mesmo barco.** Ele foi escrito como rota pública de propósito
(`RF-59` — precisa responder mesmo com o SSO ou a config quebrados), e o edge o fecha do
mesmo jeito. Para monitoração externa vale a mesma exceção de rota; de dentro, com sessão,
ele responde normalmente.

---

## As três credenciais (RNF-01, RNF-04)

Guardadas **só** como secrets do GoDeploy (`setAppSecret`). Nunca no repositório,
em log, em resposta de API ou no bundle do frontend.

| Secret | Para quê | Privilégio mínimo | Escopo |
|---|---|---|---|
| `ATLASSIAN_API_TOKEN` + `ATLASSIAN_EMAIL` | JSM REST e Confluence em `goengenharia.atlassian.net` (Basic auth) | Conta de serviço **dedicada ao app**, com acesso de agente ao projeto do portal e leitura nos espaços da allowlist | **Q1** |
| `ATLASSIAN_ORG_API_KEY` | Organizations API em `api.atlassian.com/admin` (Bearer) | **Org Admin** — privilégio alto | Fase 2 · **Q1** |
| `LLM_API_KEY` (+ `LLM_BASE_URL`) | Proxy de IA corporativo (`D-05`) | Token do gateway | — |

`GOATLAS_ORG_ID` (bootstrap do `org_id` — `RNF-25`, não é secret) identifica a
organização Atlassian alvo da Organizations API. Sem `ATLASSIAN_ORG_API_KEY` **e**
`org_id`, `ctx.organizacao` é `null` e a governança de assentos se declara
indisponível (fail-closed, não erro) — ver T-120/T-122/T-123.

⚠️ **Três confusões que já aconteceram** ao reunir estas credenciais (`D-14`), todas
silenciosas — nenhuma dá erro no momento de configurar:

- 🚨 **API token não é chave de Organizations API — e o PREFIXO desmente o que este
  documento dizia até 07/08/2026.** A versão anterior mandava `ATCTT3x…` para
  `ATLASSIAN_API_TOKEN`. **Está invertido, e foi essa instrução que produziu o 401 do
  app** (`D-22`). O certo:

  | Família | Prefixo | Onde se gera | Vai em | Auth |
  |---|---|---|---|---|
  | Token de **usuário** | `ATATT` | `id.atlassian.com/manage-profile/security/api-tokens` | `ATLASSIAN_API_TOKEN` (+ `ATLASSIAN_EMAIL`) | Basic, contra `<site>.atlassian.net` |
  | Chave de **organização** | `ATCTT` | `admin.atlassian.com` → Settings → API keys | `ATLASSIAN_ORG_API_KEY` | Bearer, contra `api.atlassian.com/admin` |

  As duas não têm relação; escopo de uma não afeta a outra. Um `ATCTT` em
  `ATLASSIAN_API_TOKEN` dá **401 por design** em `/rest/api/3/*` — com o e-mail certo,
  sem barra final e no site correto. ⚠️ **O e-mail tem de ser o da conta que gerou o
  `ATATT`**, senão o Basic auth falha igual e pela razão errada.

- 🚨 **Peça o `ATATT` CLÁSSICO, não o scoped — os dois dão o MESMO 401 na URL do site.**
  Na tela de criação, "Create API token" (clássico) e "Create API token with scopes" são
  botões diferentes, e a Atlassian empurra o segundo.

  | Tipo | Base que aceita |
  |---|---|
  | Clássico | `https://<site>.atlassian.net/rest/api/3/…` — **é o que este app usa** |
  | Scoped | `https://api.atlassian.com/ex/jira/{cloudId}/…` **e** `…/ex/confluence/{cloudId}/…` |

  Como o sintoma é idêntico ao erro de família, um token scoped registrado por engano faz
  parecer que o diagnóstico do `D-22` não valeu. ⚠️ E adotar scoped **não é config**:
  `ATLASSIAN_BASE_URL` é **uma só** e hoje serve Jira e Confluence no mesmo host, enquanto
  scoped tem gateway separado para cada — exigiria partir a base em duas, no código.
- **`cloudId` não é `orgId`.** Os dois são UUID e ficam no mesmo console. O que a
  Organizations API quer é o **orgId**, o da URL `admin.atlassian.com/o/<id>/`.
- 🚨 ~~**UUID só admite `0-9a-f`.**~~ **Esta "confusão" era um erro nosso, refutado por
  teste (`D-23`).** O **org id da Atlassian NÃO é UUID estrito** — o da Gocase tem `j` e
  `k` e responde **200**. O `cloudId` **é** UUID estrito, e é essa coexistência que faz a
  regra falsa parecer válida. Não "conserte" um org id que tem letras fora de hex; teste-o
  com `GET /admin/v1/orgs/{orgId}` antes de concluir qualquer coisa.

Complementares: `LLM_MODEL`, `LLM_FALLBACK`, `LLM_FALLBACK_MODEL` (fallback direto
quando o proxy falha), `GODEPLOY_CRON_KEY`, `ATLASSIAN_BASE_URL`.

**A conta de serviço não é a conta pessoal de ninguém** (`RNF-03`). Conta pessoal
derruba o serviço a cada troca de senha, MFA novo ou desligamento.

**A credencial de Org Admin fica isolada das outras** (`RNF-04`). Ela dá acesso à
organização inteira; nada da Fase 1 precisa dela, e vazá-la é incidente de outra
ordem de grandeza.

### Onde os secrets são lidos

`src/lib/contexto.ts`, e **só ali**. Se um segundo lugar começar a ler
`env.ATLASSIAN_API_TOKEN`, a garantia de `RNF-01` passa a depender de disciplina
em vez de estrutura — trate isso como bug de revisão.

---

## Rotação sem downtime (RNF-10)

O app lê os secrets a cada requisição (`montarContexto` roda por requisição), e o
GoDeploy propaga secret novo **sem redeploy**. Então a rotação é:

### API token de Jira/Confluence

1. Crie um token **novo** na conta de serviço (o antigo continua valendo).
2. `setAppSecret` com o mesmo nome (`ATLASSIAN_API_TOKEN`) e o valor novo — em
   **staging** primeiro.
3. `GET /api/health` em staging: `dependencias.atlassian.ok` deve ser `true`.
4. Repita em produção e confira o health.
5. **Só então** revogue o token antigo na Atlassian.

Zero downtime porque os dois tokens são válidos durante a troca. Revogar antes de
trocar é o que causa indisponibilidade — e, pior, ela aparece como chamado perdido
para quem estava submetendo.

### Chave da API de IA

Mesmo procedimento. Enquanto a chave nova não estiver ativa, o **fallback**
(`LLM_FALLBACK`) mantém o agente de pé; e se a IA cair de vez, o **formulário
mínimo** (`D-04`) mantém a abertura de chamados funcionando (`RNF-18`).

### API key de organização

Mesmo procedimento, e com **mais cuidado**: é Org Admin. Rotacione fora do
horário comercial e confirme no health antes de revogar a antiga.

## Revogação de emergência

Suspeita de vazamento:

1. **Revogue a credencial na origem imediatamente** (Atlassian ou provedor de IA).
   Não espere pelo procedimento ordenado — o dano de uma credencial vazada é maior
   que o de indisponibilidade.
2. O app degrada de forma explícita: `GET /api/health` acusa a dependência, o
   formulário mínimo segue abrindo chamado, e submissões que falharem ficam no
   outbox para reprocessamento (`RNF-17`) — **nada se perde**.
3. Gere credencial nova, `setAppSecret`, confira o health.
4. Investigue pela **auditoria** (`RF-58`): `GET /api/admin/auditoria` (admin) ou a
   tabela `auditoria`, que registra toda ação — inclusive as que falharam e as que
   foram negadas.

⚠️ Se a suspeita for do **API token de Jira/Confluence**, revogá-lo derruba
criação e leitura de chamado. Avise as áreas antes, se houver escolha; se não
houver, revogue de todo modo.

---

## Checklist antes de produção

- [ ] `npm run test` verde, incluindo os testes de burla (`RF-08`, `RF-17`,
      `RF-30`, `RF-32`, `RF-05`, `RF-04`, `RF-24`, `RF-28`, `RF-40`).
- [ ] Validado em **staging**, no navegador e **no celular** (`RNF-28`).
- [ ] `visibility: authenticated` nos dois apps.
- [ ] Config preenchida pelo console de admin: `dominios_permitidos` (**Q7**),
      `admins`, `tipos_chamado_permitidos`, `service_desk_id` (**Q1**),
      `espacos_confluence` (**Q5**), `regra2_campo_agrupamento` (**Q2**),
      `regra2_exemplos_ajuste_operacional` (**Q3**).
      **Sem elas o app é fechado, de propósito.**
- [ ] Cron registrado nas duas rotas.
- [ ] `GET /api/health` com todas as dependências `ok` e `usandoFakes: false`.
- [ ] Varredura confirmando que nenhuma das três credenciais aparece em log,
      resposta ou bundle (`RNF-01`).
- [ ] **`RF-03` decidido com o João**: o app não tem logout (`D-08`), e o requisito
      pede logout explícito. Enquanto não houver aval, é divergência aberta.
- [ ] Time de tech avisado de que o reporter muda (`R-03`, **Q10**) — é
      pré-condição de rollout, não detalhe.
