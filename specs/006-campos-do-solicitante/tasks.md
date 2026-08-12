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
- [x] **T-518** — Asserção em `tests/latencia.test.ts`, no nível da **fiação**: duas
      instâncias que compartilham a cache do módulo fazem **uma** leitura; sem compartilhar,
      duas (o estado que o defeito de `RNF-13` produzia); e sem credencial o contexto nem
      cria cliente. _Requirements: RNF-12, RNF-36_
- [x] **T-519** — `D-37`, `docs/DEPLOY.md` (privilégio, o que lê, e o acoplamento do token
      com o godocs), `RF-19` reescrito e `CLAUDE.md`. _Requirements: RNF-01, RNF-27_
- [x] **T-520** — Painel "Área de quem abre" nas métricas: com/sem área pelo **vínculo**,
      e os dois motivos **separados** pela auditoria. ⚠️ Sem campo editável — não há o que
      decidir (o token é secret, está lá ou não), e `D-25` diz que o console mostra o que se
      decide e **relata** o resto. Sem chamado nenhum, a tela diz "sem dado" em vez de `0`.
      _Requirements: RF-19, RF-55, D-25, D-37_

## Fase 4 — a FORMA do valor que vai ao Jira (`D-39`, 12/08/2026)

🚨 **Medido na staging com o tipo 70, já com os obrigatórios de `D-38` respondidos:** a
criação devolveu `400` (`chamado_criado falha … "transitorio":false`) porque
`customfield_10071` ("Recorrência", seleção) ia como a **string** `"10127"`. O mesmo caminho
com o tipo 68 — sem campo dinâmico — devolveu `201`. 400 é definitivo: a submissão vira
`falha` e **nunca** é reprocessada (`RNF-17`), então o chamado da pessoa se perde. Afeta os
tipos **70, 89, 91, 92, 94 e 95** do `GN`.

- [x] **T-521** — Testes **antes**: `paraValoresDoJira` (texto → string · seleção → `{id}` ·
      seleção múltipla → `[{id}]` · `id === rotulo` → `{value}` · schema desconhecido → cru)
      e `opcoesDesconhecidas` (rótulo, nunca `fieldId`). ⚠️ E os testes de rota afirmam sobre
      o **corpo enviado ao transporte** (`fetchImpl`) e sobre o **payload persistido** — o
      `ClienteAtlassianFake` não valida nada, e foi ele que escondeu `D-38`.
      _Requirements: RF-27, RNF-17, RNF-30_
- [x] **T-522** — `src/lib/tickets/valores-de-campo.ts` (função pura) + `multiplo` em
      `CampoRequestType`, derivado de `jiraSchema.type === 'array'` no cliente.
      _Requirements: RF-27, RNF-17_
- [x] **T-523** — Ligado nas **duas** rotas de criação, na ordem *obrigatórios → opções
      válidas → traduzir → persistir*; na conversa, as duas recusas vêm **antes** de
      `registrarConfirmacao`. Os tipos de `camposDinamicos` (cliente, outbox, serviço) passam
      a `unknown`, porque o outbox guarda o valor **já traduzido**.
      _Requirements: RF-27, RF-17, RNF-17_
- [x] **T-524** — `D-39` em `docs/DECISOES.md`, `CLAUDE.md` na seção de padrões, e este
      arquivo. _Requirements: RNF-27_
- [ ] **T-525** — **Verificação de go-live:** abrir um chamado do tipo **70** pela staging
      com a escrita ligada e confirmar `201` **e** o valor de "Recorrência" gravado no Jira.
      Só isso separa "a forma está certa" de "a forma parece certa" — é a mesma classe de
      verificação de `T-425`. _Requirements: RF-27, D-24_

## Fora desta spec

- Enviar `Setor Gocase` ao Jira — depende de o campo ser publicado num formulário de portal.
- Preencher cargo automaticamente (`spec.md` §2).
- ⚠️ **Investigar `prioridade: null`** — o `GN-6894` voltou sem prioridade e sem SLA. Ou o
  tipo 68 não expõe o campo, ou `campoPrioridadeId` não está configurado. Se for o segundo,
  `RF-16` não tem efeito no Jira. É outro assunto, com outra causa provável.
