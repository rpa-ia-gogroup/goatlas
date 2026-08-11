# Tarefas — 006 · Campos do solicitante

Teste antes do código em toda tarefa que muda comportamento (`Princípio III`).

## Fase 1 — mapa por request type (sem credencial nova)

- [x] **T-501** — Teste: mapa × schema. Campo mapeado que o schema **não** expõe não é
      enviado; campo mapeado e exposto é. _Requirements: RF-21, RNF-17_
- [x] **T-502** — Teste: o valor da pessoa vence o do login (`FR-3`), e **editá-lo não muda
      quem abriu** — `solicitanteEmail` continua vindo da identidade resolvida no roteador.
      _Requirements: RF-04, RNF-05, RF-30_
- [x] **T-503** — Teste estrutural: nenhum `fieldId` de solicitante é aplicado a um request
      type que não o mapeou; `customfield_10092`/`10093` **nunca** entram no mapa.
      _Requirements: RF-21, D-36_
- [x] **T-504** — `src/lib/tickets/campos-do-solicitante.ts`: o mapa e
      `resolverCamposDoSolicitante(tipoId, schema, identidade)`. _Requirements: RF-21, D-36_
- [~] **T-505** — Ligado na rota de **formulário** (`POST /api/chamados`), reusando o
      `schema` que `RF-62` já lê. ⚠️ **Falta a rota da conversa**
      (`POST /api/conversas/:id/confirmar`): `abrirPorConversa` monta o payload a partir de
      `conversa.proposta` e não recebe campos dinâmicos hoje. Sem isso os dois caminhos
      divergem — e a spec §8 diz que divergir em silêncio é o defeito. Na prática o tipo 108
      não é alcançável pela conversa (tem 6 campos obrigatórios que o agente não coleta),
      mas isso é acidente, não garantia. _Requirements: RF-21, RF-62_
- [x] **T-506** — `montarCamposSolicitante` deixa de ler `campoSolicitanteId`; o cabeçalho
      de `D-13` **permanece**. _Requirements: RF-21, R-03_
- [x] **T-507** — Remover `campo_solicitante_id` de `config/index.ts`, `config/validar.ts`,
      `contexto.ts`, `app/api.ts`, `app/admin/campos.tsx` e do bootstrap
      `GOATLAS_CAMPO_SOLICITANTE_ID`. _Requirements: RNF-25, D-36, D-25_
- [x] **T-508** — Testes de config/console atualizados; `bootstrap-e-demo` passa a **provar
      que a chave não existe** em vez de exercitá-la. _Requirements: D-25, D-36_
- [x] **T-509** — Teste + fix: `GET /api/tipos-chamado` devolve **só** o service desk
      configurado. _Requirements: RF-28_

## Fase 2 — a tela (skill `frontend-design` antes)

- [x] **T-510** — Bloco "Quem vai usar" no formulário: `fieldset` com espinha lime, os
      campos do solicitante pré-preenchidos do login e **editáveis**, com uma linha de
      orientação. ⚠️ **Um bloco, não um selo por campo** — o selo nomearia o mecanismo
      ("preenchido automaticamente") e repetiria duas vezes o que é uma informação só.
      Reusa o `legend` com `float: left` de `.pergunta-anexo`, no **mesmo seletor**, para
      o gotcha continuar tendo uma explicação só. _Requirements: RF-27, RF-21_
- [x] **T-511** — Teste estrutural: a tela **não escreve `customfield_`**, importa o mapa
      compartilhado, e o grupo não é `readOnly`/`disabled`. ⚠️ O que se protege é
      divergência silenciosa entre tela e servidor, não aparência. _Requirements: RF-27_
- [ ] **T-511b** — A tela da **conversa** (`RF-17`) não mostra esses campos, porque a rota
      dela ainda não os envia (ver `T-505`). Os dois caminhos precisam coincidir.

## Fase 3 — área via TeamGuide (precisa de `TG_API_TOKEN`)

⚠️ **Decisão do mantenedor (11/08/2026): reusar o MESMO token do godocs.** Custo aceito e
que precisa estar escrito: os dois apps passam a depender de uma credencial só, então
**rotacionar por causa de um quebra o outro sem aviso** — e o goatlas falharia em silêncio,
porque a derivação de área é fail-open (`SC-05`). Vai para `docs/DEPLOY.md` junto do secret,
e é o primeiro item a revisitar se um dia o godocs rotacionar.

- [x] **T-512** — `teamguide/contrato.ts` (três estados no tipo, nada lança) + `fake.ts`
      roteirizável + `TeamGuideIndisponivel`. _Requirements: RNF-04, RNF-18_
- [x] **T-513** — Testes: área derivada vence o mapa · fonte fora do ar → `area_indisponivel`
      · e-mail desconhecido → `area_nao_encontrada` · sem cliente = comportamento de antes.
      _Requirements: RF-19, RNF-18, RF-58, FR-13_
- [x] **T-514** — `teamguide/http.ts` com transporte próprio, cache no **módulo** com TTL,
      **uma** chamada (`/employees/refs`), sem a árvore. ⚠️ Só o sucesso é cacheado.
      _Requirements: RNF-04, RNF-13, RNF-36_
- [x] **T-515** — `TG_API_TOKEN` lido só em `contexto.ts`, e coberto por
      `rnf01-vazamento-credenciais` no mesmo dia em que passou a existir.
      _Requirements: RNF-01_
- [x] **T-516** — `resolverArea` nas **duas** rotas de criação. _Requirements: RF-19, FR-7_
- [x] **T-517** — Teste estrutural: `criarChamado` e `NovoChamado` não conhecem "área".
      _Requirements: FR-7 (ScC-4)_
- [~] **T-518** — A propriedade ("uma leitura por isolate, não por chamado") tem teste em
      `rf19-area-teamguide`. ⚠️ **Não** foi acrescentada asserção em `tests/latencia.test.ts`,
      que mede contagem no nível da rota — é onde uma regressão de fiação apareceria.
      _Requirements: RNF-12, RNF-36_
- [x] **T-519** — `D-37`, `docs/DEPLOY.md` (privilégio, o que lê, e o acoplamento do token
      com o godocs), `RF-19` reescrito e `CLAUDE.md`. _Requirements: RNF-01, RNF-27_
- [ ] **T-520** — O console de admin não mostra nada sobre a fonte organizacional. Hoje só a
      auditoria diz que houve `area_indisponivel`. Provável seção em `D-25`, se o volume
      justificar.

## Fora desta spec

- Enviar `Setor Gocase` ao Jira — depende de o campo ser publicado num formulário de portal.
- Preencher cargo automaticamente (`spec.md` §2).
- ⚠️ **Investigar `prioridade: null`** — o `GN-6894` voltou sem prioridade e sem SLA. Ou o
  tipo 68 não expõe o campo, ou `campoPrioridadeId` não está configurado. Se for o segundo,
  `RF-16` não tem efeito no Jira. É outro assunto, com outra causa provável.
