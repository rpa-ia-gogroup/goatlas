---
feature: "Confluence como superfície própria e governança de assentos"
id: "002"
status: draft
created: "2026-08-03"
spec_version: 1
requirements: "../../docs/REQUISITOS.md"
scope_ids: "M4 RF-37…43 · M6 RF-49…54 · RF-27 (parte dinâmica) · RF-56, RF-57"
---

# Spec 002: Confluence próprio e governança de assentos

> **Profundidade proporcional à distância** (Princípio VI). Esta spec fecha o
> essencial e será aprofundada quando a Fase 1 estiver em produção — o dado real da
> Fase 1 (o que as pessoas buscam, o que não acham) muda o desenho de M4.
> Referencia IDs de [`REQUISITOS.md`](../../docs/REQUISITOS.md); não os copia.

## 1. Problem & Why

Duas coisas que a Fase 1 deixou de fora, e por motivos diferentes.

**M4 — Confluence como tela.** Na Fase 1 o Confluence só existe a serviço da
Regra 1. Mas quem é bloqueado precisa **ler** a página, e quem só quer consultar um
processo não deveria abrir conversa para isso — nem ter assento. É a mesma camada
de busca, exposta como superfície.

**M6 — governança.** A Fase 0 captura economia **uma vez**, na mão. Sem console, o
assento ocioso volta a acumular no mês seguinte e ninguém percebe. O console é o
que torna a economia **visível e recorrente** — é ele que sustenta o objetivo O2 e
produz o número de O7.

**Custo de não fazer:** a deflexão da Regra 1 fica manca (bloqueia sem oferecer
leitura boa) e a economia de assentos regride sozinha.

## 2. Goals / Non-Goals

**Goals**
- Buscar e ler Confluence dentro do app, sem assento, respeitando as três
  condições de exposição simultâneas (`RN-06`).
- Ver quem consome assento, há quanto tempo não acessa, e quanto isso custa.
- Produzir lista **acionável** de rebaixamento/remoção, exportável.
- Fechar o `RF-27` completo (campos renderizados a partir do schema), continuando o
  formulário mínimo entregue na Fase 1 (`D-04`).

**Non-Goals**
- Edição de conteúdo no Confluence.
- Sprints, backlog, boards — qualquer superfície de Jira Software.
- Revogar acesso automaticamente. `RF-57` é P2 e exige dupla confirmação humana.

## 3. Scenarios (Given / When / Then)

### Confluence (M4)

- **SC-01** · `RF-37`, `RF-38`
  - **Given** espaços na allowlist e um termo de busca
  - **When** o colaborador busca
  - **Then** recebe resultados **só** dos espaços liberados, com trecho de contexto
    e score — e o score é o mesmo insumo da Regra 1, não um enfeite de ordenação.
- **SC-02** **[bypass]** · `RF-40`, `RN-06`
  - **Given** uma página com restrição de página, ou com label de bloqueio, dentro
    de um espaço **liberado**
  - **When** o colaborador busca por ela **ou** acessa a URL direta com o ID
  - **Then** negado nos dois caminhos. Espaço liberado não implica página liberada.
- **SC-03** · `RF-39`, `RNF-06`
  - **Given** uma página com títulos, listas, tabelas, código, imagens e anexos
  - **When** ela é renderizada
  - **Then** sai com fidelidade razoável, com anexos servidos **pelo proxy** (o
    navegador não fala com a Atlassian) e o HTML **sanitizado** — conteúdo de
    Confluence é editável por qualquer pessoa da empresa: é vetor de XSS armazenado.
- **SC-04** · `RF-43`
  - **Given** uma macro que o renderizador não suporta
  - **When** a página é exibida
  - **Then** aparece um placeholder visível. Macro que desaparece em silêncio faz o
    leitor tomar decisão com informação faltando sem saber que falta.
- **SC-05** · `RF-42`
  - **Given** buscas sem resultado útil e overrides de bloqueio da Fase 1
  - **When** o admin consulta
  - **Then** vê o **mapa das lacunas** do Confluence — o que as pessoas procuram e
    não existe documentado.

### Governança (M6)

- **SC-06** · `RF-51`
  - **Given** a credencial de organização (Bearer, Org Admin)
  - **When** o admin abre o inventário
  - **Then** vê os usuários da organização com os produtos atribuídos a cada um.
- **SC-07** · `RF-52`
  - **Given** o dado de último acesso por produto
  - **When** ele é exibido
  - **Then** vem **com as limitações oficiais na tela**: pode atrasar até 24h, e
    "ativo" significa ter visualizado uma página do produto por ao menos 2
    segundos. Sem esse aviso, alguém rebaixa o acesso de quem estava só de férias.
- **SC-08** · `RF-53`
  - **Given** o custo unitário por produto **[BLOQUEADA: Q8]**
  - **When** o console calcula
  - **Then** mostra custo mensal por produto e total, destacando o **agregado dos
    assentos ociosos** (sem acesso há N dias, N configurável).
- **SC-09** · `RF-54`
  - **Given** o inventário cruzado com último acesso
  - **When** o admin pede as recomendações
  - **Then** recebe lista acionável de rebaixamento/remoção, exportável em CSV —
    incluindo o caso central: quem tem assento cujo único uso é abrir chamado
    (customer de JSM é gratuito e ilimitado).
- **SC-10** **[bypass]** · `RF-02`, `RN-09`, `RNF-04`
  - **Given** um colaborador que **não** é admin
  - **When** ele tenta qualquer rota de governança
  - **Then** negado. A credencial de organização é **Org Admin** — privilégio alto,
    isolado do resto: uma falha de autorização aqui expõe a organização inteira.
- **SC-11** · `RF-56`
  - **Given** o log de auditoria
  - **When** o admin filtra por usuário, período e ação
  - **Then** visualiza e exporta.
- **SC-12** · `RF-57` (P2)
  - **Given** uma recomendação de remoção
  - **When** o admin revoga o acesso pelo console
  - **Then** exige **dupla confirmação** e registra em auditoria.
- **SC-13** · `RF-27`
  - **Given** o formulário sem IA (`D-04`) e o schema de campos do request type
    selecionado
  - **When** a pessoa preenche os campos adicionais (nenhum hardcoded) e envia
  - **Then** o chamado é criado com esses valores — e se a busca do schema falhar,
    o formulário **fixo** (título, descrição, tipo, prioridade) continua abrindo
    chamado normalmente, porque `RF-27` é aditivo e não pode regredir `D-04`.

## 4. Requisitos cobertos

| Bloco | IDs | Cenários |
|---|---|---|
| M4 busca e leitura | `RF-37`…`RF-41`, `RF-43`, `RNF-06` | SC-01 … SC-04 |
| M4 lacunas | `RF-42` | SC-05 |
| M6 inventário e custo | `RF-51`…`RF-54` | SC-06 … SC-09 |
| M6 acesso e auditoria | `RF-49`, `RF-56`, `RF-57`, `RN-09` | SC-10 … SC-12 |
| `RF-27` completo | campos do schema do request type, aditivos ao formulário mínimo (`D-04`) | SC-13 |

## 5. NFRs em foco

- `RNF-06` sanitização — o requisito mais crítico desta fase, porque aqui o HTML de
  terceiros passa a ser **renderizado**, não só lido por um modelo.
- `RNF-04`/`RNF-01` isolamento da credencial de Org Admin.
- `RNF-12`/`RNF-13` busca < 2s no p95, com cache — busca é a rota mais chamada.
- `RNF-25` zero hardcode de espaço ou `orgId`.

## 6. Success Criteria

- **ScC-1** — Um colaborador **sem licença** busca e lê uma página de espaço
  liberado; e comprovadamente **não** acessa página restrita nem espaço fora da
  allowlist (testado, não presumido).
- **ScC-2** — O console mostra o gasto mensal e o agregado ocioso, com as
  limitações do dado de último acesso visíveis na tela.
- **ScC-3** — A lista de recomendações reproduz, agora automaticamente, o que a
  Fase 0 fez à mão — e é a mesma economia, agora recorrente.
- **ScC-4** — Nenhum não-admin alcança qualquer rota de governança.

## 7. Open Questions

- [ ] **Q5** — Quais espaços entram na allowlist inicial. *(João)* → `RF-38`.
- [ ] **Q8** — Custo unitário real por produto Atlassian hoje. *(João/financeiro)*
      → `RF-53`; sem ele o console mostra contagem, não dinheiro.
- [ ] `[NEEDS CLARIFICATION: R-01 fica mais exposto nesta fase — servir conteúdo de
      Confluence a quem não tem licença, via token admin, é exatamente o que uma
      auditoria leria como circunvenção. O requisito manda revisar com
      jurídico/procurement antes de escalar. Essa revisão acontece antes da Fase 2
      ir a produção, ou a fase entra só para o piloto?]`
- [ ] `[NEEDS CLARIFICATION: parte das APIs v1 do Confluence tem equivalente v2 com
      depreciação em curso (R-09). Verificar quais endpoints usar antes de fixar
      `/wiki/rest/api/*` — busca por CQL só existe em v1, conteúdo já tem v2.]`
