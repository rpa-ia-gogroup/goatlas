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

**No ar em somente leitura**, em produção (`goatlas.devgogroup.com`) e em staging. As
quatro fases estão completas em código; o que falta para o go-live não é código — é
desligar `GOATLAS_SOMENTE_LEITURA`, a decisão que `D-24` condiciona à staging validada.

Faseamento na seção 12 dos requisitos: Fase 0 diagnóstico (sem código) → Fase 1 MVP (auth
+ agente + acompanhamento) → Fase 2 conhecimento e governança → Fase 3 SLA e notificações
→ Fase 4 rollout.

⚠️ **O estado detalhado vive no [`CLAUDE.md`](CLAUDE.md), não aqui.** Duas fontes sobre o
mesmo fato divergem, e a que ninguém abre todo dia é a que envelhece — foi o que aconteceu
com este parágrafo, que dizia "nada implementado" com quatro fases prontas.

## Credenciais (quatro, distintas — RNF-01, RNF-04, RNF-10, RNF-27)

| Secret | Para quê | Privilégio | Se faltar |
|---|---|---|---|
| `ATLASSIAN_API_TOKEN` | JSM REST + Confluence, Basic auth | Conta de serviço dedicada. 🚨 Tem de ser um **`ATATT` clássico** — `ATCTT` é chave de organização e dá **401 por design**, e token *scoped* também (`D-22`) | O app não lê nem escreve na Atlassian; `/api/health` acusa |
| `ATLASSIAN_ORG_API_KEY` | Organizations API (`api.atlassian.com/admin`), Bearer | **Org Admin.** Transporte próprio, isolado do cliente de Jira/Confluence — reaproveitar o outro transformaria um bug de rota em vazamento da credencial de maior privilégio | Governança de assentos responde "não configurado" (`RNF-18`), nunca erro |
| `LLM_API_KEY` | Agente e classificação da Regra 2 | Proxy de IA corporativo | O agente recusa honestamente (`ClienteIAIndisponivel`); o formulário mínimo continua abrindo chamado (`D-04`) |
| `TG_API_TOKEN` | Área do solicitante, via TeamGuide (`D-37`) | Leitura de `/employees/refs`. ⚠️ **É o mesmo token do godocs** — rotacionar por causa de um quebra o outro | A área fica `null` e o chamado abre assim mesmo (fail-open, `RNF-18`) |

**Nenhuma no repositório**, nenhuma no bundle do frontend, nenhuma em log ou resposta de
erro — e isso é estrutural, não disciplina: são lidas **num lugar só**
(`src/lib/contexto.ts`), e `tests/rnf01-vazamento-credenciais.test.ts` varre `src/`
procurando um segundo leitor, além de provar que as camadas de transporte não repassam o
corpo da resposta na mensagem de erro.

**Rotação:** procedimento em [`docs/DEPLOY.md`](docs/DEPLOY.md), com a ordem de troca por
secret. ⚠️ `listAppSecrets` do GoDeploy devolve **só os nomes** — o valor efetivo não é
legível de fora, então conferir uma rotação se faz pelo `/api/health` e pelo console, não
pela plataforma.
