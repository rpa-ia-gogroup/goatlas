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

- [ ] **T-510** — Campos do solicitante visíveis e **editáveis**, com marca de origem, no
      formulário e na confirmação. _Requirements: RF-27, RNF-06 (a11y)_
- [ ] **T-511** — Teste de tela: valor pré-preenchido presente, editável, e rótulo
      associado para leitor de tela. _Requirements: RF-27_

## Fase 3 — área via TeamGuide (precisa de `TG_API_TOKEN`)

- [ ] **T-512** — `src/lib/teamguide/contrato.ts` + `fake.ts` roteirizável, com falha
      injetável por operação. _Requirements: RNF-04, RNF-18_
- [ ] **T-513** — Testes: área derivada · fonte fora do ar → `null` + `area_indisponivel` ·
      e-mail desconhecido → `null` + `area_nao_encontrada` · fallback `areas_por_email`.
      _Requirements: RF-19, RNF-18, RF-58_
- [ ] **T-514** — `teamguide/http.ts` com transporte próprio (Bearer, host próprio), cache
      por isolate com TTL, sem enumeração de membros. _Requirements: RNF-04, RNF-13_
- [ ] **T-515** — Token lido **só** em `contexto.ts`; `tests/rnf01-vazamento-credenciais.ts`
      passa a cobrir o quarto secret. _Requirements: RNF-01_
- [ ] **T-516** — Ligar na abertura: área derivada → vínculo. **Nunca** no payload.
      _Requirements: RF-19, FR-7_
- [ ] **T-517** — Teste estrutural: a área não aparece em nenhum payload enviado à
      Atlassian. _Requirements: FR-7 (ScC-4)_
- [ ] **T-518** — `tests/latencia.test.ts`: a abertura não ganha ida de rede por chamado.
      _Requirements: RNF-12, RNF-36_
- [ ] **T-519** — `D-37` (quarta credencial) + `docs/DEPLOY.md` (privilégio, rotação, dono).
      _Requirements: RNF-01, RNF-27_

## Fora desta spec

- Enviar `Setor Gocase` ao Jira — depende de o campo ser publicado num formulário de portal.
- Preencher cargo automaticamente (`spec.md` §2).
- ⚠️ **Investigar `prioridade: null`** — o `GN-6894` voltou sem prioridade e sem SLA. Ou o
  tipo 68 não expõe o campo, ou `campoPrioridadeId` não está configurado. Se for o segundo,
  `RF-16` não tem efeito no Jira. É outro assunto, com outra causa provável.
