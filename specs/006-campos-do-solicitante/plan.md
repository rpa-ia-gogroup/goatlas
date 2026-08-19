# Plano técnico — 006 · Campos do solicitante

> **HOW.** O WHAT/WHY está em [`spec.md`](spec.md). Requisitos em `docs/REQUISITOS.md`.

## Fases (entregáveis independentes, `Princípio IV`)

| Fase | Entrega | Depende de |
|---|---|---|
| **1** | Mapa de campos por request type + remoção de `campo_solicitante_id` + fix do filtro por service desk | nada |
| **2** | UI: campos visíveis e editáveis na confirmação | Fase 1 |
| **3** | Área via TeamGuide (derivada, persistida, nunca enviada) | `TG_API_TOKEN` |

A Fase 3 é a única que precisa de credencial nova. **As Fases 1 e 2 vão a produção sem ela.**

---

## Fase 1 — o mapa mora no código, e é interseção com o schema

**Novo:** `src/lib/tickets/campos-do-solicitante.ts`

```
PapelDoCampo = 'nome_solicitante' | 'email_solicitante'
MAPA: Record<requestTypeId, Record<fieldId, PapelDoCampo>>
  '108' → { customfield_10089: 'nome_solicitante', customfield_10091: 'email_solicitante' }
```

🚨 **O mapa nunca é aplicado sozinho — é INTERSEÇÃO com o schema do request type.** Um
`fieldId` que o mapa conhece mas que o schema do tipo não expõe **não é enviado**. Razão
concreta: o mapa é um retrato de 11/08/2026 do Jira da Gocase; no dia em que alguém tirar o
campo do formulário, mandá-lo assim mesmo produz **400 = definitivo = chamado perdido**
(`RNF-17`). E o schema já é lido nas duas rotas de criação por causa de `RF-62` — a
interseção é grátis, não custa uma ida a mais.

É a mesma família de `organizacao.ts`: *filtro que pode não filtrar é verificado, não
acreditado*. Aqui: *mapa que pode estar velho é confirmado, não acreditado*.

**Onde entra:** `montarCamposSolicitante` (`atlassian/cliente.ts`) deixa de ler
`opcoes.campoSolicitanteId` e passa a receber os campos já resolvidos. A resolução acontece
na camada de rotas, que é quem tem o schema — o cliente continua burro quanto a política,
como já é para `RN-06`.

⚠️ **O cabeçalho de `D-13` na descrição NÃO sai.** Ele é o cinto do "cinto e suspensório"
descrito em `cliente.ts:400-411`: sem ele, chamado de tipo sem mapa chega como "aberto pelo
robô", que é o risco `R-03` inteiro. Só a parte de campo customizado muda.

**Remoções** (`campo_solicitante_id` deixa de existir):
`config/index.ts` (tipo, default, bootstrap `ATLAS_CAMPO_SOLICITANTE_ID`) ·
`config/validar.ts` (`FAMILIA`) · `contexto.ts` · `app/api.ts` · `app/admin/campos.tsx` ·
`tests/tela-admin.test.ts`.

⚠️ `FAMILIA` é `Record<ChaveConfig, …>`: remover a chave sem remover a família **não
compila**, e é assim que se quer.

**Fix junto (mesma medição):** `GET /api/tipos-chamado` filtra por
`ctx.valores.service_desk_id`. Hoje devolve os 5 desks e um id de outro desk passa pela
allowlist para falhar só na criação.

**Testes** (test-first): mapa × schema (campo ausente no schema não é enviado) · tipo sem
mapa não envia nada · burla: nome/e-mail do corpo não vencem a sessão · estrutural: nenhum
`fieldId` de solicitante aplicado fora do tipo mapeado · a listagem só devolve o desk
configurado.

## Fase 2 — a tela mostra o que vai no chamado

Campos preenchidos aparecem no formulário e na confirmação, **editáveis**, com marca
visível de origem ("vem do seu login"). Skill `frontend-design` antes de codar; a11y: o
valor pré-preenchido precisa ser anunciado, não parecer campo obrigatório vazio.

⚠️ `FR-12` × `FR-3`: **editável** enquanto não se souber se o tipo 108 serve para pedir
acesso a terceiros. Travar depois é uma linha; destravar depois de dado errado gravado, não.

## Fase 3 — TeamGuide: camada isolada, transporte próprio

**Novo:** `src/lib/teamguide/` — `contrato.ts` · `http.ts` · `fake.ts`.

**Transporte próprio, como `atlassian/organizacao.ts` (`RNF-04`).** Não reaproveitar
`atlassian/http.ts`: Bearer contra outro host, com credencial de outra origem. O token é
lido **só** em `contexto.ts` (`RNF-01`, e o teste T-094 varre `src/` por isso).

**Duas chamadas, não a árvore inteira.** `GET /employees/refs?unpaged=true` já devolve
`teams: ["RPA"]` e `position`; `GET /teams` dá a árvore. Casa-se time → nó-área pela árvore.
⚠️ **Não** replicar a enumeração de membros do godocs (`/teams/{id}/members` paginado por
raiz de cobertura): ela existe lá para montar índice de liderança, que não é nosso caso, e
custaria dezenas de idas de rede.

**Cache por isolate com TTL**, no módulo — mesmo lugar e mesmo raciocínio do
`cachesAtlassianDoIsolate` (`contexto.ts`). ⚠️ TTL obrigatório: sem ele um isolate quente
serve o retrato velho da organização para sempre, e quem mudou de time nunca aparece.
Compartilhar entre pessoas é seguro **porque o dado é o mesmo para todos** (a árvore da
empresa), e a resolução por e-mail acontece **depois**, em memória.

**Fail-open em três degraus** (`RNF-18`): sem token → `null` · erro de rede/HTTP → `null` +
auditoria `area_indisponivel` · e-mail não encontrado → `null` + auditoria
`area_nao_encontrada`. Os dois últimos são eventos **diferentes** de propósito: "a fonte
caiu" e "a pessoa não está lá" pedem ações opostas.

**Fallback:** `areas_por_email` (`FR-13`), preservando instalações sem a credencial.

🚨 **A área não entra em `NovoChamado`.** Ela já viaja hoje como argumento separado de
`abrirPorFormulario` e vive no vínculo — o payload do Jira nunca a viu. O teste estrutural de
`ScC-4` guarda isso: se um dia alguém a puser em `requestFieldValues`, quebra.

⚠️ **`RNF-36`:** a derivação não pode virar ida de rede por chamado. Com cache por isolate, o
custo é 2 chamadas no primeiro chamado do isolate e 0 nos seguintes — medido em
`tests/latencia.test.ts` por **contagem**, como o resto.

## Documentos (mesmo PR, `Princípio XIII`)

`docs/REQUISITOS.md` (RF novo para o mapa e para a área derivada; `RNF-25` já reescrito) ·
`docs/DECISOES.md` (`D-36` feito; `D-37` para a quarta credencial na Fase 3) ·
`docs/DEPLOY.md` (secret `TG_API_TOKEN`, privilégio e rotação) · `CLAUDE.md`.

## Complexity Tracking (desvios da constituição)

| Desvio | Princípio | Justificativa |
|---|---|---|
| Id de campo fixo no código | VIII (`RNF-25`) | Emendado por `D-36`. Config era o veículo do erro, não o conserto |
| Quarta credencial | IX ("as três credenciais") | `docs/DECISOES.md` `D-37` na Fase 3; mesmo tratamento das outras três (secret, um lugar só, nunca em log) |
