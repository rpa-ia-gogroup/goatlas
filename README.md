# goatlas

Porta de entrada interna para a Atlassian: um app no **GoDeploy** onde o
colaborador da Gocase conversa com um agente de IA que **investiga antes de deixar
abrir chamado**, abre o chamado no **Jira Service Management** quando cabe,
acompanha os próprios chamados e lê o **Confluence** — tudo **sem assento
Atlassian**. Inclui o console de **governança de assentos** (Organizations API).

Substitui duas iniciativas que eram o mesmo produto: o custo de assentos de uso
único e a falta de padrão no fluxo de tickets do time de tech. O N8N está fora —
classificar, priorizar e criar acontecem dentro do app, via API de IA.

- **Infra:** GoDeploy (Cloudflare Workers) · app `goatlas`
- **Autor dos requisitos:** João Victor Esteves
- **Dev:** Kaique Breno (principal), Luis Eduardo (apoio pontual)

## Documentação

| Documento | Conteúdo |
|---|---|
| [`docs/REQUISITOS.md`](docs/REQUISITOS.md) | **Fonte da verdade** — RF-01…RF-60, RNF-01…RNF-35, RN-01…RN-10, riscos R-01…R-11, perguntas Q1…Q13, faseamento |
| [`docs/DECISOES.md`](docs/DECISOES.md) | Decisões conscientes, respostas às perguntas em aberto, trade-offs aceitos |
| [`CLAUDE.md`](CLAUDE.md) | Como se trabalha neste repo: regras obrigatórias, plataforma, worktrees, hooks |
| [`.specify/memory/constitution.md`](.specify/memory/constitution.md) | A lei do projeto (SDD) |
| [`identidade_visual_gogroup.md`](identidade_visual_gogroup.md) | Design system GoGroup |
| `specs/<NNN>-<slug>/` | Spec, plano e tarefas por feature |

## Método

**Spec-Driven Development.** A especificação é o artefato primário; o código é a
expressão dela. Fluxo: `/specify` → `/clarify` → `/plan` → `/tasks` → `/analyze` →
`/implement`. Toda tarefa rastreia a um ID de `docs/REQUISITOS.md`.

O processo é aplicado por hooks (`.claude/hooks/`), não por lembrete humano:
worktree obrigatório para editar código, gate de documentação no commit/PR e
checklist de deploy. Detalhe em [`CLAUDE.md`](CLAUDE.md).

## Estado

Planejamento. Nada implementado. Faseamento na seção 12 dos requisitos:
Fase 0 diagnóstico (sem código) → **Fase 1 MVP** (auth + agente + acompanhamento) →
Fase 2 conhecimento e governança → Fase 3 SLA e notificações → Fase 4 rollout.

## Credenciais (três, distintas — ver RNF-01, RNF-04, RNF-10)

| Secret | Para quê | Privilégio |
|---|---|---|
| API token Jira/Confluence | JSM REST + Confluence em `goengenharia.atlassian.net` (Basic auth) | conta de serviço dedicada ao app |
| API key de organização | Organizations API em `api.atlassian.com/admin` (Bearer) | **Org Admin** — isolar do resto |
| Chave da API de IA | Agente, classificação da Regra 2 | preferir o proxy de IA corporativo |

Nenhuma no repositório. Todas como secrets do GoDeploy. Procedimento de rotação em
`docs/DEPLOY.md` (a criar, **RNF-10**/**RNF-27**).
