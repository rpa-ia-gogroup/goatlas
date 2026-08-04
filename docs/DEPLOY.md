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

| Secret | Valor | Por quê |
|---|---|---|
| `GOATLAS_MODO_DEMO` | `1` | Fakes + tarja de aviso. **Remover ao virar produção.** |
| `GOATLAS_DOMINIOS` | `gocase.com` | Bootstrap — sem ele o app nega todo mundo (`RNF-07`). **[SUPOSIÇÃO: Q7]** |
| `GOATLAS_ADMINS` | `kaique.breno@gocase.com` | Bootstrap do primeiro admin (`RF-02`) |

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

**Armadilhas que já custaram bug em outro app da casa:**

- **Nunca reaproveite a lista de assets.** O Vite gera hash novo a cada build;
  lista antiga → tela branca. E varrer só `assets/*` deixa o `favicon` de fora, e
  o SPA fallback devolve HTML no lugar dele.
- **Assets sem o prefixo `dist/`** na lista.
- **`uploadId` é single-use** — um por deploy.
- **SPA fallback é obrigatório**, senão qualquer rota que não seja `/` dá 404.

### Cron da plataforma

O cron é do **GoDeploy**, não do app (o Worker não tem processo longo). Depois do
primeiro deploy, registre:

| Rota | Sugestão | Para quê |
|---|---|---|
| `POST /api/cron/reprocessar-submissoes` | `*/5 * * * *` | `RNF-17` — chamado que ficou pendente por falha da Atlassian |
| `POST /api/cron/reconciliar-vinculos` | `0 * * * *` | `RNF-21` — vínculo órfão (criado no JSM, vínculo perdido) |

A rota exige o header assinado `X-Godeploy-Cron` conferido contra
`GODEPLOY_CRON_KEY`. **Sem a chave configurada a rota é fechada** (fail-closed) —
o contrário deixaria a rota aberta justamente na instalação que esqueceu de
configurar.

---

## As três credenciais (RNF-01, RNF-04)

Guardadas **só** como secrets do GoDeploy (`setAppSecret`). Nunca no repositório,
em log, em resposta de API ou no bundle do frontend.

| Secret | Para quê | Privilégio mínimo | Escopo |
|---|---|---|---|
| `ATLASSIAN_API_TOKEN` + `ATLASSIAN_EMAIL` | JSM REST e Confluence em `goengenharia.atlassian.net` (Basic auth) | Conta de serviço **dedicada ao app**, com acesso de agente ao projeto do portal e leitura nos espaços da allowlist | **Q1** |
| `ATLASSIAN_ORG_API_KEY` | Organizations API em `api.atlassian.com/admin` (Bearer) | **Org Admin** — privilégio alto | Fase 2 · **Q1** |
| `LLM_API_KEY` (+ `LLM_BASE_URL`) | Proxy de IA corporativo (`D-05`) | Token do gateway | — |

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
- [ ] Time de tech avisado de que o reporter muda (`R-03`, **Q10**) — é
      pré-condição de rollout, não detalhe.
