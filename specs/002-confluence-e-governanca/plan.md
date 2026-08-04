---
feature: "Confluence como superfície própria e governança de assentos"
spec: "./spec.md"
status: draft
created: "2026-08-04"
---

# Implementation Plan: Confluence próprio e governança de assentos

> Traduz a [`spec.md`](spec.md) em decisões técnicas. Respeita a
> [constituição](../../.specify/memory/constitution.md).
>
> ⚠️ Suposições marcadas **`[SUPOSIÇÃO]`** com a pergunta de origem (`D-06`).
> Tarefa **`[BLOQUEADA: Qn]`** não entra em `/implement`.

## 1. Technical Context

Herda tudo da Fase 1 — mesmo Worker, mesmo `env.DB`, mesmas camadas isoladas. O
que **entra de novo**:

| | |
|---|---|
| **Sanitização de HTML** | Único ponto novo de risco alto. Ver §3.1. |
| **Segunda credencial** | `ATLASSIAN_ORG_API_KEY` — Bearer em `api.atlassian.com/admin`, **Org Admin** |
| **Proxy de anexos** | Imagens e arquivos do Confluence servidos pelo app, nunca pelo navegador direto (`RNF-02`) |
| **Confluence v2** | Conteúdo por `/wiki/api/v2/pages/{id}`; a busca por CQL segue em v1 (não há equivalente) |

## 2. Constitution Check (gates)

- [x] **Simplicity** — nenhum serviço novo. O console é mais rotas no mesmo Worker.
- [x] **No premature abstraction** — a Organizations API entra **atrás do mesmo
      cliente isolado** (`RNF-22`), como um módulo separado por causa da credencial
      distinta, não como uma segunda arquitetura.
- [x] **Test-first viável** — sanitização e cálculo de custo são funções puras; o
      inventário da organização tem fake, como a Fase 1.
- [x] **Right-sized** — `RF-57` (revogar acesso) é P2 e fica por último, com dupla
      confirmação.
- [ ] **Princípio II (No Guessing)** — violado conscientemente em Q5 e Q8 (`D-06`).

## 3. Architecture & Approach

### 3.1 A sanitização é a trava desta fase

Na Fase 1 o HTML do Confluence era **lido por um modelo**. Aqui ele passa a ser
**renderizado no navegador de um colega**. A diferença é toda: qualquer pessoa da
empresa pode editar uma página, e uma página é vetor de **XSS armazenado**
(`RNF-06`). Um `<img onerror>` numa página que o Fiscal edita rodaria no navegador
de quem lê — com a sessão do app.

Desenho, na ordem em que importa:

1. **Allowlist de tags e atributos**, nunca blocklist. Blocklist perde a corrida
   contra vetores novos; allowlist erra para o lado de não renderizar.
2. **A sanitização é do servidor**, não do cliente. Sanitizar no navegador
   significaria que o HTML sujo já chegou lá — e um bug de renderização passa a ser
   um bug de segurança.
3. **`dangerouslySetInnerHTML` continua proibido.** O storage format do Confluence
   é XML-ish; o servidor o converte numa **árvore de nós tipada** que o React
   renderiza como elementos. Assim não existe caminho em que string vira HTML.
4. **URL de `href`/`src` só `http(s)`** — `javascript:`, `data:` e `vbscript:` são
   descartados. `data:` fica de fora inclusive em imagem: é caminho conhecido de
   bypass de CSP.

⚠️ Isto é uma **trava**, com teste de burla, igual às seis da Fase 1: uma página
com `<script>`, `onerror`, `javascript:` e `<iframe>` tem de sair inerte.

### 3.2 Anexos e imagens pelo proxy

Imagem de página do Confluence exige autenticação. O navegador **não** pode buscá-la
(`RNF-02`, e ele não tem credencial). Então: `GET /api/confluence/anexo/:pageId/:nome`
busca pelo cliente isolado e re-serve.

Duas coisas que esta rota não pode fazer:
- **Servir anexo de página que a pessoa não poderia ler.** Ela repassa as três
  condições de `RN-06` — mesma verificação da busca, incluindo restrição de página.
  Uma rota de anexo sem essa checagem é o vazamento mais fácil de escrever aqui.
- **Devolver `Content-Type` vindo da Atlassian sem conferir.** Anexo com
  `text/html` servido do nosso domínio é XSS de novo. Tipos de imagem e PDF
  passam; o resto vira download (`Content-Disposition: attachment`) com
  `X-Content-Type-Options: nosniff`. **`image/svg+xml` não passa** apesar de ser
  imagem — SVG é XML com `<script>` (`D-11`). E o **nome do arquivo** vem de quem
  edita a página e entra num cabeçalho: CRLF nele é injeção de cabeçalho.

### 3.3 Governança: a credencial que dá medo

`ATLASSIAN_ORG_API_KEY` é **Org Admin** — enxerga a organização inteira. Três
decisões por causa disso (`RNF-04`):

1. **Módulo separado** (`atlassian/organizacao.ts`), com transporte próprio. Ele
   não compartilha instância com o cliente de Jira/Confluence, para que um bug de
   roteamento não faça uma chamada de usuário sair com a credencial de Org Admin.
2. **Nenhuma rota de colaborador o alcança.** Só `/api/admin/*`, e o gate de admin
   é a primeira linha de cada handler.
3. **Read-only por padrão.** `RF-57` (revogar acesso) é a única escrita, é P2, e
   exige dupla confirmação + auditoria.

### 3.4 Custo e assento ocioso

`RF-53` precisa do custo unitário (**Q8**). Enquanto não vier, o console mostra
**contagem** e marca o valor como não configurado — nunca um número inventado, que
seria pior que nenhum: alguém decide rebaixamento com base nele.

O cálculo é função pura: `(usuários × produto × preço) → total`, e "ocioso" é
`último acesso > N dias`, N configurável (`RF-53`).

⚠️ **O dado de último acesso tem limitação oficial** (`RF-52`): atrasa até 24h, e
"ativo" significa ter visto uma página por ≥2 segundos. Isso vai **na tela**, não
no rodapé de um documento — sem isso alguém rebaixa o acesso de quem estava de
férias.

### 3.5 `RF-27` completo

O formulário mínimo da Fase 1 (`D-04`) ganha os campos vindos do schema do request
type (`/servicedesk/{id}/requesttype/{id}/field`). Campos **não** podem ser
hardcoded. O que já existe continua funcionando: os campos dinâmicos são
adicionais, e o caminho sem IA não pode regredir.

## 4. Data Model

Acrescenta ao schema da Fase 1:

| Tabela | Papel |
|---|---|
| `paginas_lidas` | Quem leu qual página e quando — alimenta `O6` (buscas/mês por quem não tem assento) e a auditoria (`RF-58`) |
| `buscas` | Termo, nº de resultados, houve clique — é o mapa das lacunas de documentação (`RF-42`), hoje só em auditoria |
| `inventario_assentos` | Cache do inventário da organização + último acesso, com `coletado_em` |

`inventario_assentos` existe por dois motivos: a Organizations API é lenta para
consulta interativa, e o histórico permite ver **tendência** de assento ocioso — o
que torna a economia recorrente em vez de um retrato (`O2`, `O7`).

## 5. Contracts / Interfaces

| Rota | Papel |
|---|---|
| `GET /api/confluence/busca?q=` | Busca (a mesma da Regra 1), agora como superfície |
| `GET /api/confluence/pagina/:id` | Conteúdo **sanitizado**, em árvore de nós |
| `GET /api/confluence/anexo/:id/:nome` | Proxy de anexo, com as três condições de `RN-06` |
| `GET /api/confluence/arvore/:espaco` | Navegação e breadcrumbs (`RF-41`, P1) |
| `GET /api/admin/assentos` | Inventário + último acesso + custo |
| `GET /api/admin/assentos/recomendacoes` | Lista acionável, `?formato=csv` para `RF-54` |
| `GET /api/admin/lacunas` | Buscas sem resultado + overrides (`RF-42`) |
| `POST /api/admin/assentos/revogar` | `RF-57`, P2, dupla confirmação |
| `POST /api/cron/coletar-inventario` | Diário — a Organizations API não serve consulta interativa |

### Interface da Organizations API

```
listarUsuarios(orgId)            → usuários com produtos atribuídos
ultimoAcesso(orgId, accountId)   → por produto, com a data de coleta
revogarProduto(orgId, accountId, produto)   // P2, escrita
```

Métodos de domínio, como na Fase 1. `orgId` vem de config (`RNF-25`).

## 6. Test Strategy

| Requisito | Tipo | Onde |
|---|---|---|
| `RNF-06` | **bypass**: `<script>`, `onerror`, `javascript:`, `data:`, `<iframe>`, tag aninhada malformada, atributo com maiúsculas/espaços | `tests/rnf06-sanitizacao.test.ts` |
| `RF-40`/`RN-06` na leitura direta | **bypass**: URL direta de página restrita e de espaço fora da allowlist | `tests/rf40-leitura-direta.test.ts` |
| Proxy de anexo | **bypass**: anexo de página restrita; `Content-Type` `text/html` | `tests/anexo-proxy.test.ts` |
| `RF-51`/`RF-52` | integração com fake de organização | `tests/governanca.test.ts` |
| `RF-52` | unit: a limitação do dado aparece no payload | idem |
| `RF-53` | unit puro: custo e ocioso; e **sem Q8, nada de número inventado** | `tests/custo.test.ts` |
| `RF-54` | unit: CSV com escape correto (vírgula e aspas em nome) | idem |
| `SC-10`/`RN-09` | **bypass**: não-admin em toda rota de governança | `tests/admin-gate.test.ts` |
| `RF-43` | unit: macro não suportada vira placeholder visível | sanitização |

## 7. Complexity Tracking

| Decisão | Princípio tensionado | Por quê |
|---|---|---|
| Árvore de nós em vez de string de HTML | V — simplicidade | É o que torna `dangerouslySetInnerHTML` desnecessário por construção. String sanitizada depende de o sanitizador estar certo; árvore tipada depende de o renderizador não inventar. |
| Transporte separado para a Organizations API | V — sem duplicação | `RNF-04`: a credencial é Org Admin. Compartilhar instância transforma bug de roteamento em vazamento de escopo alto. |
| `inventario_assentos` como cache histórico | V — YAGNI | O histórico é o que faz `O2` ser recorrente em vez de retrato único; e a API é lenta demais para consulta interativa. |
| Planejar sem Q5/Q8 | II — No Guessing | `D-06`, com marcação e tarefa bloqueada. |

## 8. File / Build Order

1. `src/lib/confluence/sanitizar.ts` — allowlist, árvore de nós, funções puras
2. **Testes de burla da sanitização** — vermelhos primeiro
3. `src/lib/confluence/renderizar.tsx` — árvore → React, sem `innerHTML`
4. `src/lib/atlassian/cliente.ts` — `obterMetadadosPagina` + `obterCorpoStorage`
   (o "obterPagina" do plano, partido em dois: metadados → decidir → conteúdo, para
   que o corpo de página negada não entre na memória do app), `obterAnexo`,
   `listarArvore`
5. Rotas de Confluence + proxy de anexo
6. `src/lib/atlassian/organizacao.ts` + fake
7. `src/lib/governanca/` — custo, ocioso, recomendações, CSV (puros)
8. Rotas `/api/admin/assentos*` + cron de coleta
9. Telas: busca, leitura, console de assentos, lacunas
10. `RF-27` completo: campos dinâmicos no formulário
11. `RF-57` (P2) por último

## 9. Bloqueios

| Bloqueio | Trava | Some quando |
|---|---|---|
| **Q5** allowlist de espaços | Nada em código — entra como config. A **exposição real** depende dela | João listar os espaços |
| **Q8** custo unitário | `RF-53` mostra contagem, não dinheiro | João/financeiro |
| **Q1** credencial de Org Admin | Toda a M6 contra a API real (o fake cobre o desenvolvimento) | João criar a credencial |
| **R-01** revisão jurídica | Não trava código; trava **produção**. Servir Confluence a quem não tem licença é o ponto que uma auditoria leria como circunvenção | Revisão com jurídico/procurement |

**`[SUPOSIÇÃO]` neste plano:** nenhuma sobre comportamento. Q5 e Q8 mudam
**dados**, não desenho — é o efeito de tudo ser config (`RNF-25`).
