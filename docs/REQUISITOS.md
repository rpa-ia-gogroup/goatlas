# goatlas — Documento de Requisitos

**Projeto:** Porta de entrada interna para Atlassian — agente de IA para abertura de chamados, consulta ao Confluence e governança de assentos
**Autor:** João Victor Esteves
**Time:** Kaique Breno (dev principal), Luis Eduardo (apoio pontual)
**Data:** 03/08/2026 · **Versão:** 2 (integra os documentos anteriores de Tickets Tech)
**Infra:** GoDeploy · **Repositório:** `goatlas` (org de RPA no GitHub)

---

## 1. Contexto e problema

Existem hoje duas iniciativas separadas que, olhando de perto, são o mesmo produto:

**Iniciativa A — custo de assentos.** A organização Atlassian (`goengenharia.atlassian.net`) acumula assentos de Jira, Confluence e JSM, frequentemente os três para a mesma pessoa. O custo não vem do uso intenso: vem de **acesso de uso único**. A pessoa precisa abrir um chamado para o time de tech, então precisa de conta; precisa acompanhar, então precisa manter a conta. O mesmo vale para quem entra no Confluence uma vez para ler um processo.

**Iniciativa B — fluxo de tickets (documentos "Tickets Tech").** O mapeamento das áreas de FrontOffice e BackOffice identificou abertura manual e sem padrão, SLA não combinado com nenhuma área ("SLA Combinado: Não definido" em todas as 12 áreas mapeadas), cada área usando um canal diferente (Google Chat individual, grupos, fóruns, reuniões) e priorização subjetiva. A proposta anterior era um formulário no N8N com priorização automática, mais um agente de IA com regras de bloqueio de ticket.

**São o mesmo projeto.** A porta de entrada que resolve o fluxo de tickets é exatamente a porta de entrada que torna o assento Atlassian desnecessário. Construir as duas separadamente significa construir duas vezes a mesma camada de autenticação, de integração com o Jira e de notificação.

**Decisão herdada:** o N8N sai. Tudo passa a viver dentro do GoDeploy. O que o N8N faria — classificar, priorizar e criar o ticket — passa a ser feito por uma **API de inteligência artificial** chamada pelo próprio app.

### 1.1 Achados que redimensionam o problema

| Achado | Implicação |
|---|---|
| **Clientes de JSM são gratuitos e ilimitados, e o papel de customer já cobre o ciclo completo do solicitante.** A Atlassian cobra por *agente*: "Customers do not require a Jira Service Management license or Jira user license... Customers in Jira Service Management are always free, and always unlimited." O customer pode, sem licença: *"create, comment on, and track requests through the customer portal"*, criar e comentar por e-mail, anexar arquivos e adicionar participantes aos próprios chamados. | Abrir, **acompanhar**, comentar e anexar já são gratuitos hoje. Se existem pessoas com **assento** cujo único uso é abrir chamado, isso é erro de configuração, não limitação do produto — rebaixar para customer é economia imediata, sem código. O que o customer *não* faz é trabalhar o ticket (transicionar, comentar internamente, ver a fila): isso é papel de agente, e agente é pago. |
| **Existe caminho oficial de leitura de Confluence sem licença** (global permission "Use Confluence", endpoint `unlicensedview-v2`, acesso anônimo, guests, public links). | Parte do valor sai por configuração. O que esses caminhos **não** entregam é busca boa, navegação e controle granular — que é onde o app agrega. |
| **Contas Atlassian sem product role não consomem licença.** | O custo está concentrado em quem tem *product access* atribuído e não usa. |
| **A maior alavanca não é o assento: é o volume de tickets.** As regras de bloqueio do agente (seção 5, M2) evitam o ticket antes de ele existir. | Ticket não aberto não consome assento, não consome SLA e não consome tempo do time de tech. |

**Consequência prática:** existe uma economia que se captura antes de qualquer linha de código, só com auditoria e rebaixamento de assentos (Fase 0, seção 12). O app resolve o que a configuração não resolve — a **fricção** (mesmo o caminho gratuito exige conta Atlassian e um portal que ninguém lembra que existe) e o **volume** (nada hoje impede que a mesma pergunta vire ticket pela quinta vez).

### 1.2 Decisão de arquitetura de identidade

Foram avaliadas duas arquiteturas:

- **(A) Ancorada em caminhos gratuitos suportados** — cada colaborador é provisionado como customer JSM (gratuito e ilimitado), o app cria o chamado com `raiseOnBehalfOf` e o reporter no Jira é a pessoa real. Leitura de Confluence via unlicensed view. O app continua sendo a única interface: o colaborador nunca vê o portal da Atlassian.
- **(B) Proxy total via conta de serviço** — o app fala com a Atlassian por uma única conta; o colaborador não existe como identidade no Atlassian.

**Decisão: (B), proxy total.** Mais simples de implementar (uma credencial, sem rotina de provisionamento, sem assento de agente para a conta de serviço) e mais rápida de entregar.

**Esta é uma decisão consciente, tomada com a alternativa confirmada como viável.** A arquitetura (A) é tecnicamente suportada e gratuita para o solicitante — a limitação não é de licenciamento. O que se ganha em (B) é velocidade de implementação; o que se paga está explícito em três riscos:

| Custo de escolher (B) | Não existiria em (A) |
|---|---|
| **R-01** — exposição de conformidade de licenciamento no acesso ao Confluence | Em (A), a leitura usa o caminho oficial de unlicensed view |
| **R-03** — reporter único distorce fila, SLA nativo e métricas por solicitante no JSM | Em (A), o reporter é a pessoa real |
| **RF-21, RF-22, RNF-21** — campo customizado, tabela de vínculo e rotina de reconciliação existem só para compensar a ausência de identidade real | Em (A), o próprio Jira é a fonte da verdade |

O custo de (A), para registro: um assento de agente para a conta de serviço (`raiseOnBehalfOf` não é disponível a quem tem apenas permissão de customer) e uma rotina que provisiona o customer no primeiro acesso — incluindo a adição explícita à lista de Customers do projeto, necessária para funcionários que já possuem conta Atlassian corporativa.

O requisito **RNF-22** existe para manter a migração para (A) viável como mudança localizada, caso **R-01** ou **R-03** se materializem.

---

## 2. Objetivos e métricas

| # | Objetivo | Métrica |
|---|---|---|
| O1 | Reduzir o volume de tickets que chegam ao time de tech | **Taxa de deflexão** — % de conversas bloqueadas pelas Regras 1 e 2 que não viraram ticket |
| O2 | Reduzir o custo mensal de assentos Atlassian | Gasto mensal antes × depois |
| O3 | Eliminar a exigência de conta Atlassian para abrir e acompanhar chamado | Assentos criados com motivo "abrir ticket" → zero |
| O4 | Padronizar priorização e SLA de primeira resposta | % de tickets dentro do SLA; nº de áreas com SLA combinado (hoje: zero de 12) |
| O5 | Unificar o canal de solicitação | Taxa de aderência — tickets abertos pelo app vs. abertos por chat/reunião/Jira direto |
| O6 | Dar acesso de leitura ao Confluence a quem não tem licença | Buscas/mês por usuários sem assento |
| O7 | Tornar visível e gerenciável quem consome assento | Console de governança em produção com dado de último acesso |

### 2.1 Não-objetivos (v1)

- Substituir o Jira para o time de tech — os agentes seguem trabalhando no Jira nativo, com licença.
- Edição de conteúdo no Confluence.
- Sprints, backlog, boards ou qualquer superfície de Jira Software.
- Usuários externos à Gocase.
- Resolver o ticket automaticamente. O agente **deflete ou abre** — não executa a demanda.
- Substituir as reuniões recorrentes por área (iniciativa paralela, independente do app).

---

## 3. Personas e perfis

| Perfil | Quem é | O que faz |
|---|---|---|
| **Colaborador** | Qualquer pessoa com e-mail corporativo do grupo | Conversa com o agente, abre chamado, acompanha os próprios chamados, comenta, anexa, busca e lê Confluence |
| **Admin** | João + quem ele designar | Tudo do colaborador, mais: console de governança de assentos, allowlists, regras de priorização e bloqueio, log de auditoria, métricas |

Não há perfil intermediário na v1. Admin é definido por allowlist explícita (**RF-02**).

**Solicitantes conhecidos por área** (do mapa de áreas, insumo para **RF-52** e para o piloto):

| Bloco | Área | Solicitantes | SLA real hoje |
|---|---|---|---|
| FrontOffice | Growth | Verstappen | 2h30 |
| FrontOffice | CX | Miréia, Giovanna Sabrina | 2h30 |
| FrontOffice | E-comm / Ilustração | Aline, Ravenna | 2h30 |
| FrontOffice | Lojas | Juan Silva | ~12h |
| BackOffice | B2B | Rogaciano Jr, Rodrigo Costa, Larissa, Rayka | ~3h |
| BackOffice | Produção | Lucas Modolo | ~3h |
| BackOffice | Financeiro | Renata Lira, Marilia Dantas, Anderson Matos | ~6h |
| BackOffice | Qualidade | Felipe Nascif, Clistony Cardoso, Natália Pavão | ~3h |
| BackOffice | CX | Ytalo, Giovanna, Mireia, Marcelo Menezes | ~6h |
| BackOffice | Fiscal | Herleson Amarante, Gabrielle Liriel, Gabrielly | ~6h |
| BackOffice | Expedição | Isabela Aparecida, Wilian Souza | ~6h |
| BackOffice | Lojas | Juan Silva | ~12h |

> Observação relevante: o SLA **real** de várias áreas (2h30 a 6h) já é melhor que os 24h propostos como padrão. O SLA de 24h precisa ser comunicado como **piso garantido**, não como novo prazo — caso contrário, o projeto é percebido por Growth, CX e E-comm como uma piora. Ver **Q9**.

---

## 4. Visão de arquitetura

```
┌───────────────────────────────────────────────┐
│  Navegador — colaborador Gocase               │
│  Login: Google Workspace SSO                  │
│  Interface: chat com o agente + telas         │
└──────────────────────┬────────────────────────┘
                       │ HTTPS — sessão do app
┌──────────────────────▼────────────────────────┐
│  goatlas  (GoDeploy)                          │
│                                               │
│  ┌─────────────────────────────────────────┐  │
│  │ AGENTE DE IA  (API de LLM)              │  │
│  │  tool: search_confluence   → Regra 1    │  │
│  │  tool: check_jira_history  → Regra 2    │  │
│  │  tool: create_ticket       → bloqueada  │  │
│  │        até as duas acima rodarem        │  │
│  └─────────────────────────────────────────┘  │
│                                               │
│  Auth/SSO + RBAC · Acompanhamento · KB        │
│  Notificações · Console admin · Auditoria     │
│                                               │
│  Cliente Atlassian (camada isolada)           │
│    cache · backoff · circuit breaker          │
│  Banco: vínculos, conversas, config, auditoria│
└──────┬─────────────────────────┬──────────────┘
       │ token Jira/Confluence   │ org API key
       │ (conta de serviço)      │ (Bearer)
┌──────▼─────────────────┐ ┌─────▼──────────────┐
│ goengenharia.atlassian │ │ api.atlassian.com  │
│ JSM REST · Confluence  │ │ /admin (orgs)      │
└────────────────────────┘ └────────────────────┘
```

Três pontos centrais do design:

1. **O navegador nunca fala com a Atlassian.** A identidade do colaborador vive no app; perante a Atlassian a identidade é sempre a conta de serviço.
2. **A tabela de vínculo `chamado ↔ e-mail do solicitante`** é o que permite acompanhamento sem conta Atlassian. É o artefato mais crítico do sistema (**RNF-17**).
3. **São duas credenciais distintas, não uma.** Jira e Confluence usam API token com Basic auth em `goengenharia.atlassian.net`; a Organizations API (usada pela governança de assentos) exige uma **API key de organização** enviada como Bearer em `api.atlassian.com/admin`, e requer papel de Org Admin. Isso afeta secrets, rotação e o levantamento de privilégios.

---

## 5. Requisitos Funcionais

Prioridade: **P0** = MVP · **P1** = próxima iteração · **P2** = desejável.

### M1 — Autenticação e autorização

| ID | Requisito | Pri |
|---|---|---|
| RF-01 | Autenticação exclusivamente via Google Workspace (OAuth 2.0), restrita aos domínios corporativos do grupo. Nenhum outro método. | P0 |
| RF-02 | Dois perfis — `colaborador` e `admin`. Admin por allowlist de e-mails ou grupo do Workspace, configurável sem deploy. | P0 |
| RF-03 | Sessão com expiração configurável e logout explícito. | P0 |
| RF-04 | O e-mail corporativo é a chave de identidade única e é gravado em toda operação e log. | P0 |
| RF-05 | Conta fora do domínio permitido, ou desativada no Workspace, tem acesso negado — inclusive em sessão já aberta, na requisição seguinte. | P0 |
| RF-06 | Primeiro acesso sem cadastro, aceite ou provisionamento manual: do login à conversa em um clique. | P0 |

### M2 — Agente de IA e abertura de chamados

O agente é a porta de entrada. O colaborador descreve a demanda em linguagem natural; o agente investiga antes de deixar abrir ticket.

**Tools do agente**

| Tool | Input | Responsabilidade |
|---|---|---|
| `search_confluence` | Tópico extraído da conversa (ex.: "tabela orders", "pipeline de vendas diário") | Regra 1 — verifica se já existe resposta documentada. Retorna páginas com score de relevância. |
| `check_jira_history` | Tipo de problema identificado na conversa | Regra 2 — analisa tickets anteriores similares e classifica as resoluções via IA em "ajuste operacional" ou "resolução real". |
| `create_ticket` | Campos extraídos da conversa: título, descrição, tipo, componente, área, prioridade | Cria o chamado no Jira com campos pré-preenchidos. |

| ID | Requisito | Pri |
|---|---|---|
| RF-07 | Interface conversacional: o colaborador descreve a demanda em texto livre; o agente conduz o diálogo até ter contexto suficiente. | P0 |
| RF-08 | **Regra crítica de orquestração:** `create_ticket` **nunca** pode ser executada sem que `search_confluence` **e** `check_jira_history` tenham sido executadas antes na mesma conversa. Isso é validado no **servidor**, não apenas instruído no system prompt — um modelo pode ignorar instrução; código não. | P0 |
| RF-09 | **Regra 1 — resposta já existe no Confluence.** `search_confluence` retorna score de relevância por página. O bloqueio dispara quando o score ultrapassa um threshold configurável. Não é busca binária. | P0 |
| RF-10 | **Regra 2 — padrão de ajuste operacional.** `check_jira_history` busca tickets anteriores do mesmo tipo, lê os comentários de resolução e classifica cada um via IA em: **"ajuste operacional"** (contorna sem resolver a causa raiz — "atualizei o pipeline manualmente", "reparticionei a tabela", "ajustei o cron") ou **"resolução real"** (causa raiz corrigida). O bloqueio dispara ao encontrar padrão recorrente de ajuste operacional para o mesmo tipo de problema. | P0 |
| RF-11 | Parâmetros da Regra 2 configuráveis pelo admin: **threshold de recorrência** (sugestão inicial: 3+ tickets em 90 dias) e **critério de agrupamento** — qual campo do Jira delimita "mesmo tipo" (label, componente ou tipo de issue). Ver **Q2**. | P0 |
| RF-12 | **Formato obrigatório da mensagem de bloqueio**, com três elementos: (1) qual regra disparou, (2) motivo em linguagem natural, para que o solicitante saiba como agir, (3) link da página do Confluence — sempre na Regra 1, e na Regra 2 quando houver documentação relacionada. | P0 |
| RF-13 | **Bloqueio não é parede.** O colaborador pode registrar que a documentação não resolveu o caso dele e prosseguir. A tentativa de bloqueio e o override ficam registrados — o override é sinal de documentação ruim, não de usuário teimoso. O registro passa por um **controle explícito** (o botão), nunca por continuar a conversa: ver `RN-07` e `D-21`. | P0 |
| RF-14 | O prompt de classificação da Regra 2 deve conter **exemplos reais de ajuste operacional da Gocase**. Sem exemplos do contexto da empresa, a classificação é imprecisa. Levantar esses exemplos é pré-requisito de implementação, não refinamento posterior. | P0 |
| RF-15 | **Priorização automática** a partir da conversa, em três níveis, substituindo a classificação subjetiva atual: | P0 |

| Prioridade | SLA 1ª resposta | Critério | O que a resposta traz |
|---|---|---|---|
| **Crítica** | 4h | Sistema fora do ar, impacto direto em vendas ou operação | Ação imediata, time acionado |
| **Alta** | 12h | Funcionalidade comprometida, com solução alternativa temporária | Plano de ação e previsão |
| **Normal** | 24h | Melhorias, ajustes pontuais, mudanças de pedido na operação, sugestões de backlog | Visibilidade de como será encaminhada |

| ID | Requisito | Pri |
|---|---|---|
| RF-16 | A prioridade sugerida pela IA é **exibida e editável** antes da criação. Priorização automática sem revisão vira jogo: as pessoas aprendem as palavras que produzem "Crítica". | P0 |
| RF-17 | **Confirmação explícita do usuário** antes de `create_ticket` executar. O agente nunca cria chamado sozinho. | P0 |
| RF-18 | Antes de confirmar, exibir o resumo estruturado do que será criado: título, descrição, tipo, componente, área, prioridade e SLA correspondente. | P0 |
| RF-19 | Roteamento por área a partir do e-mail do solicitante e do mapa de áreas (seção 3), com possibilidade de correção manual. | P1 |
| RF-20 | Criar o chamado via `POST /rest/servicedeskapi/request`, com a conta de serviço como reporter. | P0 |
| RF-21 | Gravar o solicitante real em campo customizado do Jira ("Solicitante") **e** como request participant quando aplicável. Sem isso, todo chamado chega ao time de tech como aberto pelo robô (**R-03**). | P0 |
| RF-22 | Persistir o vínculo `issueKey ↔ e-mail do solicitante ↔ timestamp`, base do acompanhamento e do isolamento. | P0 |
| RF-23 | Persistir a transcrição da conversa que originou o ticket e anexá-la (ou linká-la) ao chamado — é o contexto que o time de tech mais perde hoje. | P1 |
| RF-24 | Chave de idempotência por submissão: duplo clique ou reenvio não geram chamados duplicados. | P0 |
| RF-25 | Anexos: subir via `POST /rest/servicedeskapi/servicedesk/{serviceDeskId}/attachTemporaryFile` (que devolve apenas `temporaryAttachmentIds`) e materializar via `POST /rest/servicedeskapi/request/{issueIdOrKey}/attachment`. | P1 |
| RF-26 | Confirmação final com a chave do chamado, prioridade, prazo de primeira resposta e link para acompanhamento interno. | P0 |
| RF-27 | Fallback de formulário estruturado para quem preferir não conversar, renderizado dinamicamente a partir do schema de campos do tipo de chamado (`/servicedesk/{serviceDeskId}/requesttype/{requestTypeId}/field`). Campos não podem ser hardcoded. | P1 |
| RF-28 | Exibir apenas tipos de chamado presentes na allowlist do admin (**RF-49**). Nada exposto por padrão. | P0 |

### M3 — Acompanhamento de chamados

| ID | Requisito | Pri |
|---|---|---|
| RF-29 | Tela "Meus chamados": chamados vinculados ao e-mail logado, com resumo, status, prioridade, SLA e data da última atualização. | P0 |
| RF-30 | **Isolamento:** o colaborador só vê chamados vinculados ao próprio e-mail. Verificação no servidor, a cada requisição, contra a tabela de vínculo — nunca por parâmetro vindo do cliente. | P0 |
| RF-31 | Detalhe do chamado: descrição, campos, comentários **públicos**, anexos, status e o histórico de SLA. | P0 |
| RF-32 | **Nunca** exibir comentários internos nem campos internos do Jira. A chamada correta é `GET /rest/servicedeskapi/request/{issueIdOrKey}/comment?public=true&internal=false` — atenção: `internal` tem **default `true`**, então passar só `public=true` retorna públicos **e** internos. Além disso, filtrar server-side pelo campo `public` de cada comentário (defesa em profundidade). | P0 |
| RF-33 | Adicionar comentário público, atribuído de forma legível ao solicitante real. | P0 |
| RF-34 | Anexar arquivo a chamado existente. | P1 |
| RF-35 | Filtro por status e busca textual na lista. | P1 |
| RF-36 | Permitir marcar como resolvido / reabrir, quando o workflow do JSM oferecer a transição ao cliente. | P2 |

### M4 — Base de conhecimento (Confluence)

Serve ao colaborador diretamente **e** ao agente, via `search_confluence`. É a mesma camada.

| ID | Requisito | Pri |
|---|---|---|
| RF-37 | Busca full-text via CQL restrita aos espaços da allowlist, com trecho de contexto e **score de relevância** — o score é insumo da Regra 1 (**RF-09**), não só ordenação visual. ⚠️ `?espaco=` **estreita** a allowlist (interseção, nunca substituição — `D-30`), para o bloco de busca do Confluence funcionar. | P0 |
| RF-38 | **Allowlist explícita de espaços** — nada exposto por padrão. Exclusão por label (ex.: `confidencial`) mesmo dentro de espaço liberado. | P0 |
| RF-39 | Renderizar a página com fidelidade razoável (títulos, listas, tabelas, código, imagens e anexos servidos pelo proxy). | P0 |
| RF-40 | Respeitar page restrictions: página restrita não aparece na busca nem é acessível por URL direta, ainda que o espaço esteja liberado. | P0 |
| RF-41 | Navegação pela árvore do espaço, com breadcrumbs. | P1 |
| RF-42 | Registrar **buscas sem resultado útil** e **overrides de bloqueio** (**RF-13**) como backlog de documentação. Esse é o mapa das lacunas do Confluence. | P1 |
| RF-43 | Macro não suportada degrada de forma visível (placeholder), nunca some em silêncio. | P1 |

### M5 — Notificações e SLA

| ID | Requisito | Pri |
|---|---|---|
| RF-44 | Notificar o solicitante na criação (número, prioridade, prazo de primeira resposta) e a cada mudança de status ou comentário público. | P0 |
| RF-45 | Canais: Google Chat e/ou e-mail, com preferência por usuário. Google Chat é onde as áreas já vivem hoje. | P1 |
| RF-46 | **Alerta interno de SLA prestes a estourar**, notificando o time de produto/tech antes do limite. | P1 |
| RF-47 | Detecção de mudanças por **webhook** do Jira (`jira:issue_updated`, `comment_created`) registrado pela administração do Jira, com **fallback de polling** incremental via JQL. Nota: o endpoint de webhook dinâmico via REST (`/rest/api/3/webhook`, expiração de 30 dias com renovação) é destinado a apps Connect/OAuth 2.0 e não se aplica a integração por API token; para webhooks registrados pela administração a documentação não define prazo de expiração. | P1 |
| RF-48 | Endpoint de webhook autenticado por segredo compartilhado, com validação de origem, e não notificar o usuário sobre a própria ação. | P1 |

### M6 — Console de administração e governança

| ID | Requisito | Pri |
|---|---|---|
| RF-49 | Gestão das allowlists (espaços do Confluence, tipos de chamado) pela interface, sem deploy. | P0 |
| RF-50 | Gestão dos parâmetros das regras de bloqueio: threshold de score da Regra 1, threshold de recorrência e critério de agrupamento da Regra 2, exemplos do prompt de classificação. | P0 |
| RF-51 | Inventário de usuários da organização com produtos atribuídos, via `GET https://api.atlassian.com/admin/v1/orgs/{orgId}/users`. | P0 |
| RF-52 | Último acesso por produto, via `GET https://api.atlassian.com/admin/v1/orgs/{orgId}/directory/users/{accountId}/last-active-dates`. Exibir as limitações oficiais: o dado pode atrasar até 24h e "ativo" significa ter visualizado uma página do produto por no mínimo 2 segundos. | P0 |
| RF-53 | Custo mensal por produto e total, com destaque para o agregado dos assentos ociosos (sem acesso há N dias, N configurável). | P0 |
| RF-54 | Lista acionável de recomendações de rebaixamento/remoção, exportável em CSV. | P0 |
| RF-55 | Painel de métricas: taxa de deflexão por regra, taxa de override, tickets por área e prioridade, aderência ao SLA, aderência de canal (app vs. manual), buscas sem resultado. | P1 |
| RF-56 | Visualização e exportação do log de auditoria, com filtro por usuário, período e ação. | P1 |
| RF-57 | Revogar acesso a produto pelo console, com dupla confirmação e registro em auditoria. | P2 |

### M7 — Observabilidade e auditoria

| ID | Requisito | Pri |
|---|---|---|
| RF-58 | Log de auditoria append-only de toda ação que toque a Atlassian ou a API de IA: quem, quando, o quê, qual recurso, resultado. | P0 |
| RF-59 | Health check das dependências (Atlassian, API de IA, banco, SSO) em rota própria. | P0 |
| RF-60 | Monitorar a taxa de respostas 429 da Atlassian e o custo/latência da API de IA, com alerta em limiar configurável. | P1 |

---

## 6. Requisitos Não-Funcionais

Organizados pelas características de qualidade da ISO/IEC 25010:2023.

### 6.1 Segurança

| ID | Requisito |
|---|---|
| RNF-01 | Credenciais como **secrets do GoDeploy**. São **três**: (a) API token de Jira/Confluence, (b) API key de organização para a Organizations API, (c) chave da API de IA. Nunca no repositório, nunca expostas ao frontend, nunca em log. |
| RNF-02 | **Nenhuma** chamada à Atlassian ou à API de IA parte do navegador. |
| RNF-03 | A conta de serviço é **dedicada ao app** — não a conta pessoal do João. Conta pessoal derruba o serviço a cada troca de senha, MFA ou desligamento. |
| RNF-04 | Menor privilégio que atenda aos requisitos, não "admin de tudo por conveniência". Privilégios efetivos documentados no README. Atenção: a Organizations API exige papel de **Org Admin**, o que é privilégio alto — isolar essa credencial do restante. |
| RNF-05 | Toda decisão de autorização é tomada no servidor. Nenhum identificador vindo do cliente é aceito sem revalidação contra a sessão. |
| RNF-06 | HTML vindo do Confluence é sanitizado antes de renderizar (XSS armazenado). |
| RNF-07 | Negação por padrão em toda exposição de conteúdo. |
| RNF-08 | **Proteção contra prompt injection.** O agente injeta no contexto do LLM conteúdo de Confluence e comentários de Jira — texto que qualquer pessoa da empresa pode editar. Conteúdo recuperado é tratado como **dado não confiável**, nunca como instrução. A regra do **RF-08** e a confirmação do **RF-17** são aplicadas em código justamente porque o modelo pode ser induzido a ignorar o system prompt. |
| RNF-09 | O agente só recebe conteúdo que o solicitante já teria direito de ver pelas allowlists. O LLM não é um caminho lateral para conteúdo restrito. |
| RNF-10 | Procedimento documentado de rotação e revogação de emergência de cada uma das três credenciais, executável sem downtime. |
| RNF-11 | Rate limit por usuário no app, para que um colaborador (ou um script) não consuma o orçamento de API nem o de IA da organização inteira. |

### 6.2 Desempenho e eficiência

| ID | Requisito |
|---|---|
| RNF-12 | Busca no Confluence < 2s no p95. Primeira resposta do agente < 5s no p95 (as duas tools rodam antes de ele poder concluir — isso precisa ser transparente na UI, com indicação de progresso). |
| RNF-13 | Cache de conteúdo do Confluence, de resultados de busca e de metadados de tipos de chamado, com TTL configurável (sugestão: 15 min metadados, 5 min conteúdo). Sem cache o app vira amplificador de chamadas. |
| RNF-14 | Toda chamada à Atlassian respeita `Retry-After` e usa backoff exponencial com jitter (base 2s, teto ~30s, máx. ~4 tentativas). |
| RNF-15 | **Sobre rate limits:** o regime de orçamento por pontos da Atlassian (65.000 pts/h no pool global; 100.000 + 10 por usuário/hora no Standard por tenant) aplica-se a apps **Forge, Connect e OAuth 2.0** — a documentação afirma que "API token-based traffic is not affected by this change, and will continue to be governed by existing burst rate limits". Como o goatlas usa API token, cai em **burst limits cujos valores não são publicados**, e os headers `X-RateLimit-*` só aparecem em respostas 429. Logo: não há telemetria contínua de orçamento; o controle é cache + backoff + **medição empírica da taxa de 429** (**RF-60**). Migrar para OAuth 2.0 é a alternativa se o limite virar problema. |
| RNF-16 | Custo da API de IA monitorado por conversa e no agregado, com teto configurável. O agente faz múltiplas chamadas por conversa (classificação da Regra 2 lê vários tickets) — o custo escala com o volume, não com o número de usuários. |

### 6.3 Confiabilidade

| ID | Requisito |
|---|---|
| RNF-17 | Falha da API Atlassian **não pode perder um chamado em submissão**. A submissão é persistida antes da chamada e reprocessada com retry. Perder o chamado de alguém destrói a confiança no app de uma vez. |
| RNF-18 | **Degradação graciosa e explícita.** Se a API de IA falhar, cai no formulário estruturado (**RF-27**) — nunca em "não consegui abrir seu chamado". Se `search_confluence` ou `check_jira_history` falharem, o agente **não** silencia a regra: informa que não conseguiu verificar e registra o ticket como não verificado, para não transformar indisponibilidade em bypass. |
| RNF-19 | Confluence indisponível não impede abrir chamado, e vice-versa. |
| RNF-20 | Disponibilidade alvo de 99% em horário comercial (seg–sex, 8h–19h BRT). |
| RNF-21 | A tabela de vínculo `chamado ↔ solicitante` é dado crítico: backup e rotina de reconciliação contra o Jira via o campo customizado (**RF-21**), para poder ser reconstruída. |

### 6.4 Manutenibilidade e flexibilidade

| ID | Requisito |
|---|---|
| RNF-22 | O cliente Atlassian é uma **camada isolada**. Trocar a estratégia de identidade (proxy total → `raiseOnBehalfOf` por usuário) deve ser mudança localizada. É a saída de emergência do risco **R-01**. |
| RNF-23 | A camada de IA é isolada atrás de uma interface própria — trocar de modelo ou de provedor não deve tocar a lógica de negócio. |
| RNF-24 | Prompts versionados no repositório, revisáveis em pull request. Prompt é regra de negócio, não configuração solta. |
| RNF-25 | Zero hardcode de IDs de projeto, service desk, espaço ou campo customizado. Tudo em configuração ou secret. |
| RNF-26 | Logs estruturados legíveis via `getAppLogs` do GoDeploy; erros de frontend encaminhados ao backend para caírem no mesmo lugar. |
| RNF-27 | README com privilégios exigidos de cada credencial, variáveis de ambiente, procedimento de rotação e como rodar local. |

### 6.5 Usabilidade e compatibilidade

| ID | Requisito |
|---|---|
| RNF-28 | Interface responsiva. Boa parte das solicitações nasce do celular; se não funcionar bem no telefone, o app não substitui o Google Chat. |
| RNF-29 | Português do Brasil como idioma padrão. |
| RNF-30 | Erros em linguagem de negócio, nunca stack trace ou código HTTP cru. |
| RNF-31 | O bloqueio precisa soar como ajuda, não como recusa. A redação de **RF-12** define a percepção do produto inteiro. |
| RNF-32 | Versões atuais de Chrome, Safari e Edge, desktop e mobile. |

### 6.6 Conformidade

| ID | Requisito |
|---|---|
| RNF-33 | Dados pessoais no mínimo necessário (nome e e-mail corporativo), com retenção definida para vínculos, conversas e auditoria. |
| RNF-34 | Conteúdo interno (tickets, Confluence) trafega para uma API de IA externa. Verificar a política de retenção e treinamento do provedor; preferir o proxy de IA corporativo, se já existir, em vez de contratar acesso novo. Ver **Q6**. |
| RNF-35 | A decisão pela arquitetura de proxy total (1.2) fica registrada como decisão consciente, com revisão trimestral e caminho de saída em **RNF-22**. |

---

## 7. Regras de negócio

| ID | Regra |
|---|---|
| RN-01 | `create_ticket` nunca executa sem `search_confluence` e `check_jira_history` na mesma conversa. Validado em código. |
| RN-02 | Nenhum ticket é criado sem confirmação explícita do solicitante. |
| RN-03 | Um chamado pertence a exatamente um solicitante — o e-mail autenticado na criação. |
| RN-04 | Visibilidade de chamado é por vínculo local, não por permissão do Jira. Sem vínculo, sem acesso. |
| RN-05 | Comentário interno do agente nunca chega ao colaborador. |
| RN-06 | Conteúdo do Confluence só é exposto se: espaço na allowlist **E** página sem restrição **E** sem label de bloqueio. Todas simultaneamente. |
| RN-07 | Bloqueio é orientação, não parede: sempre há caminho de override, e o override é registrado. **O override é o ÚNICO caminho de saída** — enquanto houver bloqueio sem override, nenhuma proposta de chamado é montada, por mais mensagens que a conversa receba (ver `D-21`). Sem isso a segunda metade da regra era falsa: dava para sair pelo chat sem registro. |
| RN-08 | O SLA é de **primeira resposta**, não de resolução. Isso precisa estar explícito em toda comunicação do app. |
| RN-09 | Perfil admin é concedido por lista explícita, nunca por inferência. |
| RN-10 | Toda ação que toca Atlassian ou IA gera registro de auditoria, inclusive as que falham. |

---

## 8. Riscos

| ID | Risco | Sev. | Mitigação |
|---|---|---|---|
| **R-01** | **Conformidade de licenciamento.** Servir conteúdo Atlassian a pessoas sem licença, via token admin, pode ser lido como circunvenção numa auditoria. | Alta | Registrar a decisão e o racional; revisar com jurídico/procurement antes de escalar; não expor conteúdo sensível; manter **RNF-22** viável; revisão trimestral. |
| **R-02** | **Conta única = gargalo e ponto único de falha.** Todo o tráfego passa por uma credencial; revogada, tudo cai. Burst limits não são documentados. | Alta | Conta de serviço dedicada (**RNF-03**); cache (**RNF-13**); backoff (**RNF-14**); monitorar 429 (**RF-60**); rotação documentada (**RNF-10**); OAuth 2.0 como plano B. |
| **R-03** | **Reporter único distorce o JSM.** Todos os chamados chegam como abertos pela conta de serviço — quebra fila por solicitante, métricas por área e o "responder ao cliente" nativo. | Alta | Campo customizado "Solicitante" obrigatório (**RF-21**); automação no Jira para roteamento por esse campo; **alinhar com o time de tech antes do rollout** — eles são usuários afetados, não espectadores. |
| **R-04** | **Falso bloqueio.** A IA bloqueia um ticket legítimo apontando documentação que não resolve o caso. Duas ou três vezes e a pessoa volta para o Google Chat. | Alta | Override sempre disponível (**RF-13**); monitorar taxa de override (**RF-55**); começar com threshold conservador e apertar com dado; exemplos reais no prompt (**RF-14**). |
| **R-05** | **Percepção de piora no SLA.** Growth, CX e E-comm têm SLA real de 2h30 hoje; "24h" soa como retrocesso. | Alta | Comunicar 24h como piso garantido, não como novo prazo; priorização automática precisa mesmo classificar essas áreas corretamente; ver **Q9**. |
| **R-06** | **Adoção.** Se o app não for melhor que mandar mensagem no chat, ninguém usa e nada muda. | Alta | UX como requisito (**RNF-28**, **RF-06**); medir aderência (**RF-55**); piloto com 1–2 áreas antes do rollout; combinar com os líderes que o canal oficial passa a ser o app. |
| **R-07** | **Prompt injection** via conteúdo de Confluence ou comentário de Jira. | Média | **RNF-08**, **RNF-09**; regras críticas em código, não em prompt. |
| **R-08** | **Custo da API de IA** cresce com o volume de tickets e com o tamanho do histórico lido pela Regra 2. | Média | Teto e monitoramento (**RNF-16**); cache de classificações de tickets já analisados; limitar a janela de histórico. |
| **R-09** | **Mudança na API da Atlassian** quebra o app em silêncio. | Média | Camada isolada (**RNF-22**); health check (**RF-59**); acompanhar o changelog do Cloud Admin. Nota: parte das APIs v1 do Confluence tem equivalente v2 e depreciação em curso — verificar antes de fixar `/wiki/rest/api/*`. |
| **R-10** | **Vazamento de conteúdo restrito** por allowlist mal configurada. | Média | Negação por padrão (**RNF-07**, **RN-06**); revisão da allowlist por um segundo par de olhos; auditoria (**RF-58**). |
| **R-11** | **Escopo maior que o prazo.** Os módulos não cabem em uma semana. | Alta | Faseamento da seção 12; a Fase 1 entrega valor sozinha. |

---

## 9. Referências técnicas

Verificadas contra a documentação e as specs OpenAPI oficiais da Atlassian.

**Jira Service Management** — base `https://goengenharia.atlassian.net`, API token com Basic auth
- `GET /rest/servicedeskapi/servicedesk` — lista service desks
- `GET /rest/servicedeskapi/requesttype` — todos os tipos do site (útil para montar a allowlist de **RF-28**)
- `GET /rest/servicedeskapi/servicedesk/{serviceDeskId}/requesttype/{requestTypeId}/field` — schema de campos (**RF-27**)
- `POST /rest/servicedeskapi/request` — cria chamado
- `GET /rest/servicedeskapi/request/{issueIdOrKey}` — detalhe
- `GET /rest/servicedeskapi/request/{issueIdOrKey}/comment?public=true&internal=false` — **ambos os parâmetros têm default `true`**; omitir `internal=false` retorna comentários internos (**RF-32**)
- `POST /rest/servicedeskapi/servicedesk/{serviceDeskId}/attachTemporaryFile` → devolve `temporaryAttachmentIds`
- `POST /rest/servicedeskapi/request/{issueIdOrKey}/attachment` → materializa o anexo

> Sobre `raiseOnBehalfOf`: recebe o `accountId` do customer. A restrição documentada é negativa — "`raiseOnBehalfOf` is not available to Users who have the customer permission only" —, o que na prática exige acesso de agente. A mesma nota vale para `requestParticipants`, usado em **RF-21**, que depende de o recurso estar habilitado no projeto. Não é usado na arquitetura escolhida, mas é o caminho da migração prevista em **RNF-22**.

**Confluence** — base `https://goengenharia.atlassian.net`
- `GET /wiki/rest/api/search?cql=...` — busca por CQL. Não suporta campos de usuário no CQL (`user`, `user.accountid`); para isso existe `/wiki/rest/api/search/user`
- `GET /wiki/api/v2/pages/{id}?body-format=storage` — conteúdo (API v2)
- `GET /wiki/rest/api/content/{id}/restriction` — restrições de página (**RF-40**); variantes `/restriction/byOperation` e `/restriction/byOperation/{operationKey}` são mais diretas

**Administração da organização** — base `https://api.atlassian.com/admin`, **API key de organização** como `Authorization: Bearer`, exige Org Admin. Credencial distinta da anterior.
- `GET /v1/orgs/{orgId}/users` — usuários e product access
- `GET /v1/orgs/{orgId}/directory/users/{accountId}/last-active-dates` — último acesso por produto

**Rate limiting** — ver **RNF-15**. Headers `Retry-After`, `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`, `RateLimit-Reason` são retornados **apenas em respostas 429**.

**Webhooks** — eventos `jira:issue_updated` e `comment_created`. Ver **RF-47** para a ressalva sobre registro dinâmico via REST vs. administração do Jira.

---

## 10. Perguntas em aberto

| # | Pergunta | Quem decide |
|---|---|---|
| Q1 | Qual conta de serviço será criada, e quais privilégios exatos em cada uma das três credenciais? | João |
| Q2 | Qual campo do Jira delimita "mesmo tipo de ticket" para a Regra 2 — label, componente ou tipo de issue? | João + time de tech |
| Q3 | Quais são os exemplos reais de "ajuste operacional" da Gocase para o prompt de classificação (**RF-14**)? | João + time de tech/dados |
| Q4 | O campo customizado "Solicitante" já existe no projeto do portal 4, ou precisa ser criado? | João + time de tech |
| Q5 | Quais espaços do Confluence entram na allowlist inicial? | João |
| Q6 | Qual API de IA — existe proxy de IA corporativo já contratado, ou o app contrata acesso próprio? Qual a política de retenção do provedor (**RNF-34**)? | João |
| Q7 | Quais domínios de e-mail além de `@gocase.com` são válidos (marcas do grupo)? | João |
| Q8 | Qual o custo unitário real por produto Atlassian hoje, para o cálculo de **RF-53**? | João / financeiro |
| Q9 | Como comunicar o SLA de 24h às áreas que hoje têm retorno em 2h30 sem que soe como piora (**R-05**)? | João + Produto |
| Q10 | O time de tech está ciente de que o reporter dos chamados vai mudar (**R-03**)? | João |
| Q11 | Google Chat, e-mail ou ambos na v1 de notificações? | João |
| Q12 | O GoDeploy já oferece SSO Google pronto, ou o app implementa o OAuth? | Kaique |
| Q13 | Quais 1–2 áreas entram no piloto? Sugestão: uma de alto volume e alta maturidade (CX) e uma de baixo volume (Produção). | João |

---

## 11. O que vem dos documentos anteriores

Rastreabilidade em relação ao material de "Tickets Tech", para nada se perder na migração do N8N:

| Origem | Item | Onde foi parar |
|---|---|---|
| Arquitetura_Agente_Jira | 3 tools do agente | M2, tabela de tools |
| Arquitetura_Agente_Jira | Regra crítica de ordem das tools | **RF-08** (agora validada em código) |
| Arquitetura_Agente_Jira | Regra 1 — score de relevância no Confluence | **RF-09** |
| Arquitetura_Agente_Jira | Regra 2 — ajuste operacional × resolução real | **RF-10** |
| Arquitetura_Agente_Jira | Pendências: threshold e agrupamento | **RF-11**, **Q2** |
| Arquitetura_Agente_Jira | Ação: levantar exemplos reais da Gocase | **RF-14**, **Q3** |
| Arquitetura_Agente_Jira | Output do bloqueio com 3 elementos | **RF-12** |
| Arquitetura_Agente_Jira | Confirmação explícita antes de criar | **RF-17** |
| apresentacao-novo-fluxo | F-01 formulário classificador | **RF-07** (vira conversa) + **RF-27** (fallback) |
| apresentacao-novo-fluxo | F-02 integração → Jira | **RF-20** |
| apresentacao-novo-fluxo | F-03 priorização automática | **RF-15**, **RF-16** |
| apresentacao-novo-fluxo | F-04 SLA de primeira resposta | **RF-15**, **RN-08** |
| apresentacao-novo-fluxo | F-05 notificação ao stakeholder | **RF-44** |
| apresentacao-novo-fluxo | F-06 alerta de SLA prestes a estourar | **RF-46** |
| apresentacao-novo-fluxo | F-07/F-08 rollout Front e BackOffice | Seção 12, Fase 4 |
| mapa-areas-solicitacoes | Áreas, solicitantes e SLA real | Seção 3 · **RF-19** roteamento · **R-05** |
| — | Execução via N8N | **Descartado.** Tudo no GoDeploy, com API de IA. |

---

## 12. Faseamento

O escopo não cabe em uma semana. A sequência abaixo entrega valor a cada fase e preserva o compromisso de ter algo no ar rápido.

**Fase 0 — Diagnóstico (1 dia, João, sem código).**
Levantar via Organizations API quem tem qual produto e há quanto tempo não acessa. Rebaixar os casos óbvios: quem tem assento só para abrir chamado vira customer (gratuito); quem não acessa Confluence há 90 dias perde o product access. Isso mede o problema, captura economia imediata e produz o número que justifica o resto.

**Fase 1 — MVP (semana 1).**
M1 completo + M2 no essencial (**RF-07** a **RF-26**, sem o fallback de formulário) + M3 (**RF-29** a **RF-33**). O colaborador entra com a conta Google, conversa com o agente, é defletido quando cabe, abre o chamado quando não cabe, e acompanha. É a fatia com maior dor e maior impacto.

**Fase 2 — Conhecimento e governança.**
M4 (**RF-37** a **RF-40**) como superfície própria, além de servir ao agente + M6 de governança (**RF-49** a **RF-54**). O console é o que torna a economia visível e recorrente.

**Fase 3 — SLA e notificações.**
M5 completo, alerta de SLA, métricas de deflexão e adoção (**RF-55**).

**Fase 4 — Rollout.**
Piloto com 1–2 áreas (**Q13**), ajuste dos thresholds com dado real, depois FrontOffice e BackOffice.

---

## 13. Definição de pronto (Fase 1)

- [ ] Um colaborador sem nenhum assento Atlassian conversa com o agente e abre um chamado ponta a ponta; o chamado chega ao time de tech com o solicitante correto identificado.
- [ ] `create_ticket` é **comprovadamente** impossível de executar sem as duas tools anteriores — testado tentando burlar pelo prompt, não só pelo caminho feliz.
- [ ] Uma pergunta já respondida no Confluence é bloqueada, com link, motivo legível e caminho de override funcionando.
- [ ] Um problema com histórico de ajuste operacional recorrente é bloqueado pela Regra 2.
- [ ] Nenhum chamado é criado sem confirmação explícita.
- [ ] Um colaborador **não** consegue ver o chamado de outro (testado explicitamente).
- [ ] Comentário interno do agente não vaza (testado explicitamente, com `internal=false` e filtro server-side).
- [ ] Nenhuma das três credenciais aparece em log, resposta ou bundle de frontend.
- [ ] Falha da API de IA não impede abrir chamado; falha de uma tool não vira bypass silencioso da regra.
- [ ] Log de auditoria registra conversa, bloqueio, override, criação e leitura.
- [ ] Fluxo completo validado no celular.
- [ ] README com privilégios de cada credencial e procedimento de rotação.

---

## 14. Nome do repositório

**Sugestão principal: `goatlas`**

Segue a convenção já estabelecida na casa (godeploy, godocs, godash, gorag, gohits, gowd) e "atlas" cobre toda a superfície do projeto — agente de tickets, Confluence e governança de assentos — com o trocadilho evidente com Atlassian.

Alternativas: `godesk` (mais direto, mas sugere só help desk e envelhece mal com o Confluence e a governança dentro) · `goticket` (estreito demais, ignora metade do projeto) · `goportal` (genérico).

- **Repositório:** `goatlas`, na organização de RPA
- **App no GoDeploy:** `goatlas`
- **Documentação:** `docs/REQUISITOS.md` (este arquivo)
