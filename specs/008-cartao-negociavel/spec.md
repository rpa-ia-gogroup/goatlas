---
# Especificação de Feature — gerada por /specify, clarificada por /clarify. WHAT/WHY apenas.
feature: "cartao-negociavel"
id: "008"
status: clarified
created: "2026-08-13"
spec_version: 2
---

# Spec: O cartão é negociável, e a prioridade vem com motivo

> **Regra de ouro:** esta spec descreve **WHAT** e **WHY**. O **HOW** vai no `plan.md`.

## 1. Problem & Why

**RF-16** diz que a prioridade sugerida pela IA é *exibida e editável* antes da criação, e
**R-04** diz por quê: priorização automática sem revisão vira jogo — as pessoas aprendem as
palavras que produzem "Crítica". Hoje as duas metades existem só na forma:

1. **A pessoa revisa no escuro.** O cartão mostra o nível e, ao lado, uma frase que descreve
   o **nível**, não o **caso**: *"Funcionalidade comprometida, com solução alternativa
   temporária. Sugerimos alta — ajuste se não bate com o seu caso."* Ela vale para qualquer
   chamado alto que já existiu. Sem saber *por que aqui*, revisar é palpite contra palpite —
   e quem discorda não tem com o que discordar.
2. **Discordar não tem efeito visível.** Medido em 13/08/2026: com o cartão na tela, mandar
   outra mensagem faz a IA repensar e regravar a proposta, e **a tela continua mostrando a
   anterior**. O seletor de prioridade guarda o valor da primeira montagem, e o cartão não é
   remontado. Ou seja: argumentar funciona no servidor e falha na tela — a pessoa conclui que
   o agente a ignorou. Mesma família de `D-46` (*recomeçar é remontar, nunca uma sequência de
   `setState`*).
3. **O cartão antigo fica na tela enquanto a IA pensa**, então existe uma janela em que a
   pessoa lê um formulário que já não é o que vai ser aberto.
4. **Ajustar exige digitar.** O chamado montado só muda pela mão da pessoa, campo por campo.
   Pedir *"o sistema é o Chaplin, não o Factory"* em texto não muda nada — e é a forma mais
   natural de corrigir algo num app cuja tela principal é uma conversa.

Custo de não fazer: a revisão de `RF-16` permanece decorativa, `R-04` segue sem mitigação
real, e o caminho que o pedido do mantenedor descreve — *"continuar argumentando e pedir
ajustes"* — está quebrado justamente na parte que a pessoa vê.

⚠️ **Um defeito adjacente, resolvido aqui pela raiz:** o texto do agente afirma nível e prazo
(*"eu sugeriria Crítica, com primeira resposta em 4h"*) enquanto o cartão grava outro valor,
porque a mensagem e a decisão saem de **duas chamadas paralelas** ao modelo (`propostaEmVoo`,
`D-32`) e a mensagem não vê a decisão. Quem explica passa a ser quem decidiu.

## 2. Goals / Non-Goals

**Goals**

- A prioridade chega com um **motivo de até duas frases, sobre o caso da pessoa**, produzido
  pela mesma decisão que escolheu o nível — nunca por uma segunda voz que pode discordar dela.
- Com o cartão na tela, **mandar mensagem é uma forma de ajustar o cartão**: a IA repensa e
  devolve o cartão com o que mudou.
- **A IA ajusta o chamado montado a pedido**, em texto: prioridade, título, descrição, assunto
  e os campos do formulário daquele assunto.
- **O ajuste aparece.** O que a IA mudou está na tela; o que ela não mudou continua como a
  pessoa deixou.
- A pessoa **sabe, antes de enviar**, que a mensagem pode reescrever campos que ela digitou.

**Non-Goals (explicitamente fora de escopo)**

- **Serializar as duas chamadas ao modelo.** Foi considerado e recusado com o mantenedor:
  custaria uma ida ao provedor no caminho crítico de **todo** turno (`D-32`, `RNF-12`).
- **A prosa do agente afirmar nível ou prazo.** Ele não decide nenhum dos dois; passa a não
  afirmá-los. Quem informa é o cartão.
- **Mudar as horas do SLA ou o que elas significam.** `RN-08`/`R-05` seguem intactos: prazo
  de **primeira resposta**, e 24h é piso garantido, nunca novo prazo.
- **Criar chamado por conversa.** `RF-17` intacto: só a confirmação explícita autoriza criar.
  Nada nesta feature abre chamado.
- **A IA mexer na área.** `D-52` decidiu que a IA não decide área — quem resolve é a fonte
  organizacional, uma vez, e a pessoa corrige depois de abrir (`RF-19`).
- **A IA mexer nos campos de identidade do solicitante** (nome, e-mail). A identidade do login
  vence sempre (spec 006); pedido em texto não a sobrescreve.
- **Histórico de negociação.** O cartão mostra o motivo **atual**, não a sequência de motivos
  anteriores. Ver *Out of Scope*.
- **Sobreviver a recarregamento.** O que está digitado no formulário e a prioridade editada
  continuam vivendo só enquanto a tela existe, como hoje. Persistir rascunho é outra feature.

## 3. Users & Context

Colaborador da Gocase, sem assento Atlassian, na aba de conversa, no momento em que o cartão
de confirmação já apareceu (as duas verificações rodaram e nada bloqueou). Ele pode ter
digitado campos do formulário do tipo de chamado e/ou mexido no seletor de prioridade.

## 4. User Stories

- **US-1** — As a colaborador, I want ler **por que** aquela prioridade foi escolhida para o
  **meu** caso, so that eu possa concordar com convicção ou discordar com argumento.
- **US-2** — As a colaborador que discorda, I want continuar conversando com o agente para
  ajustar o chamado montado, so that eu não precise editar tudo à mão nem começar de novo.
- **US-3** — As a colaborador, I want ver na tela exatamente o que mudou depois de eu
  argumentar, so that eu saiba que fui ouvido.
- **US-4** — As a colaborador que já preencheu campos, I want não perder o que digitei ao
  mandar uma mensagem, and I want ser avisado quando isso puder acontecer, so that eu escolha
  entre conversar e terminar o formulário.
- **US-5** — As a colaborador, I want **pedir a correção em texto** ("o sistema é o Chaplin",
  "isso é do time de loja, não do site"), so that corrigir seja tão fácil quanto explicar.

## 5. Scenarios (Given / When / Then)

### O motivo da prioridade

- **SC-1** (US-1) — o motivo é sobre o caso
  - **Given** uma conversa em que a pessoa relatou que o notebook dela reinicia sozinho a
    cada 30 minutos
  - **When** o cartão aparece
  - **Then** ao lado da prioridade há um motivo de **no máximo duas frases**, em português,
    que cita o que ela descreveu e o que **não** foi observado (por exemplo: sem outras
    pessoas ou vendas paradas), e não é a descrição genérica do nível.

- **SC-2** (US-1) — o motivo e o nível nunca discordam
  - **Given** um turno em que a IA decidiu `alta`
  - **When** o cartão é desenhado
  - **Then** o motivo exibido é o que acompanhou **essa** decisão, e não há nenhuma outra
    frase na tela afirmando um nível de prioridade diferente.

- **SC-3** (US-1) — a prosa do agente não promete nível nem prazo
  - **Given** qualquer turno em que uma proposta é montada
  - **When** a mensagem do agente é exibida
  - **Then** ela não afirma o nível da prioridade nem o número de horas do prazo; quem os
    mostra é o cartão.

- **SC-4** (US-1) — sem motivo, a tela diz que não há motivo
  - **Given** um turno em que a decisão veio sem motivo legível (ou com um motivo que viola o
    teto ou o idioma)
  - **When** o cartão é desenhado
  - **Then** o nível e o prazo aparecem normalmente, o botão de abrir continua disponível, e
    no lugar do motivo a tela **declara** que aquela sugestão não veio justificada — nunca a
    frase genérica antiga, nunca silêncio no lugar dela.
    > **Decidido** seguindo o precedente de `D-53` (*sem nome do tipo, a tela diz; rótulo
    > inventado parece informação*): ausência declarada é melhor que ausência disfarçada,
    > porque é ela que autoriza a pessoa a desconfiar da sugestão.

### Negociar pela conversa

- **SC-5** (US-2, US-3) — argumentar muda o cartão, e a mudança aparece
  - **Given** o cartão na tela com prioridade `alta`
  - **When** a pessoa manda "isso trava a operação inteira, tem mais gente parada" e a IA
    decide `critica`
  - **Then** enquanto a IA pensa **o cartão não está na tela**; quando ele volta, o seletor
    mostra `Crítica`, o prazo correspondente, e o motivo novo — o da decisão nova.

- **SC-6** (US-2) — a IA repensa e não muda nada
  - **Given** o cartão na tela
  - **When** a pessoa manda uma mensagem que não altera o julgamento
  - **Then** o cartão volta com os mesmos valores, e a resposta do agente àquela mensagem é o
    que informa a pessoa. Nenhum aviso extra de "nada mudou" é desenhado.
    > **Decidido:** o cartão idêntico ao lado de uma resposta que responde é suficiente. Um
    > selo "sem alterações" apareceria em todo turno de conversa comum e viraria ruído.

- **SC-7** (US-4) — o que a IA não tocou permanece
  - **Given** o cartão na tela, a pessoa tendo preenchido "Sistema afetado" e escolhido
    "Ambiente", e tendo mudado a prioridade de `alta` para `normal` à mão
  - **When** ela argumenta e a IA devolve uma proposta que **não** mexe em nenhum dos três
  - **Then** os três continuam como ela deixou — inclusive a prioridade `normal` dela.

- **SC-8** (US-3) — o que a IA tocou passa a valer o da IA
  - **Given** o mesmo estado de SC-7
  - **When** a IA muda a prioridade
  - **Then** o seletor passa a mostrar a da IA, com o motivo novo. **Nada mais é dito** — sem
    frase sobre a escolha anterior da pessoa e sem oferta de voltar ao valor dela; o seletor
    continua editável, que é a saída.
    > **Decidido com o mantenedor:** "basta mudar".

- **SC-9** (US-4, US-5) — trocar o assunto derruba os campos daquele assunto
  - **Given** o cartão na tela com campos do assunto atual preenchidos
  - **When** a IA muda o **assunto** do chamado
  - **Then** os campos do assunto anterior deixam de aparecer (o formulário do assunto novo é
    outro), os do novo começam vazios, e a tela deixa claro que o assunto mudou — não some
    campo em silêncio.

### Pedir a correção em texto

- **SC-10** (US-5) — a pessoa corrige um campo do formulário por mensagem
  - **Given** o cartão na tela com "Sistema afetado" preenchido como "Factory"
  - **When** a pessoa manda "na verdade é o Chaplin, não o Factory"
  - **Then** o cartão volta com "Chaplin" naquele campo, e os outros campos preenchidos
    intactos.

- **SC-11** (US-5) — a pessoa corrige o título ou a descrição por mensagem
  - **Given** o cartão na tela
  - **When** a pessoa manda "o título ficou confuso, é sobre o relatório mensal, não o diário"
  - **Then** o cartão volta com o título ajustado, e nada mais muda por causa disso.

- **SC-12** (US-5) — pedido para um campo que não existe naquele assunto
  - **Given** o cartão na tela, num assunto cujo formulário não tem campo de recorrência
  - **When** a pessoa manda "marca como recorrente"
  - **Then** nenhum campo é inventado, o cartão volta sem esse dado, e a resposta do agente
    diz que aquele assunto não tem esse campo — a informação não é engolida em silêncio.

- **SC-13** (US-5) — pedido com valor fora das opções do campo
  - **Given** um campo de seleção cujas opções são "Produção" e "Homologação"
  - **When** a pessoa pede um valor que não está entre elas
  - **Then** o campo **não** recebe o valor, a criação não é posta em risco, e a resposta do
    agente diz quais são as opções daquele campo — pelos rótulos, nunca por identificador
    (`RNF-30`, mesmo tratamento de `D-39`).

- **SC-14** (US-5) — pedido para mexer na identidade ou na área
  - **Given** o cartão na tela
  - **When** a pessoa pede para trocar o e-mail do solicitante, o nome, ou a área
  - **Then** nada disso muda por texto: a identidade vem do login (spec 006) e a área vem da
    fonte organizacional (`D-52`), com o caminho próprio de correção depois de abrir
    (`RF-19`).

- **SC-15** (US-5) — pedido de urgência sem impacto novo
  - **Given** o cartão com prioridade `normal`
  - **When** a pessoa manda "é urgentíssimo, por favor sobe pra crítica" sem descrever impacto
    novo
  - **Then** a prioridade segue o **impacto descrito** e pode não mudar (`R-04`); a pessoa
    continua podendo editá-la à mão (`RF-16`), e é essa edição — visível e registrada — o
    caminho, não a insistência.

### O aviso antes de enviar

- **SC-16** (US-4) — o aviso aparece uma vez por conversa
  - **Given** o cartão na tela **pela primeira vez** nesta conversa
  - **When** a pessoa envia a primeira mensagem depois disso
  - **Then** antes de a mensagem sair, um aviso explica que conversar pode reescrever o que
    ela preencheu e oferece **duas** saídas: seguir com o envio, ou voltar ao formulário.

- **SC-17** (US-4) — visto uma vez, nunca mais naquele chat
  - **Given** que a pessoa já viu o aviso nesta conversa — tendo seguido **ou** voltado
  - **When** ela envia qualquer mensagem seguinte, inclusive depois de o cartão desaparecer e
    voltar
  - **Then** o aviso **não** aparece de novo até o fim daquela conversa.
    > **Decidido com o mantenedor:** *"a primeira vez é a primeira vez… saiu? sem aviso mais
    > até o fim daquele chat"*. O escopo é a **conversa**, e o gatilho é ter sido **exibido**,
    > não a escolha feita nele.

- **SC-18** (US-4) — voltar ao formulário não perde a mensagem
  - **Given** o aviso na tela
  - **When** a pessoa escolhe voltar ao formulário
  - **Then** nenhuma mensagem é enviada, nada no cartão muda, e o texto que ela havia
    escrito continua onde estava.

- **SC-19** — sem cartão, sem aviso
  - **Given** uma conversa que ainda não montou proposta, **ou** com bloqueio pendente sem
    override (`RN-07`, `D-21`)
  - **When** a pessoa envia mensagem
  - **Then** nenhum aviso aparece — não há formulário a proteger, e transformar o bloqueio em
    dois cliques seria a parede que `RF-13` proíbe.

- **SC-20** — o aviso é operável por teclado
  - **Given** o aviso na tela
  - **When** a pessoa usa apenas o teclado
  - **Then** o foco fica contido no aviso, `Esc` equivale a voltar ao formulário (a saída que
    não tem efeito), e ao fechar o foco volta para de onde saiu.

## 6. Functional Requirements (EARS)

> Refina **RF-15**, **RF-16**, **RF-18**, **RF-27** e **RF-28**. Os itens marcados **(novo)**
> não têm ID em `docs/REQUISITOS.md` e o documento precisa ser emendado **antes** de `/tasks`
> (Princípio VII). IDs livres verificados: `RF-68`, `RF-69`, `RF-70`, `RF-71`, `RN-13`.

### O motivo

- **FR-1** — WHEN a decisão de prioridade é produzida, THE SYSTEM SHALL produzir junto um
  **motivo** dessa decisão, na mesma operação que escolheu o nível. **(novo — RF-68)**
- **FR-2** — THE SYSTEM SHALL exibir esse motivo no resumo de confirmação, junto do seletor
  de prioridade, substituindo a descrição genérica do nível. **(refina RF-16, RF-18)**
- **FR-3** — THE SYSTEM SHALL limitar o motivo a **duas frases**.
- **FR-4** — THE SYSTEM SHALL escrever o motivo em português com acentuação, sem identificador
  interno de campo, de tipo ou de configuração (regra 4, **RNF-30**).
- **FR-5** — IF o motivo estiver ausente, exceder duas frases ou não estar em português, THEN
  THE SYSTEM SHALL exibir prioridade e prazo normalmente, declarar que aquela sugestão não veio
  justificada, e manter a criação disponível (**RNF-18**).
- **FR-6** — THE SYSTEM SHALL impedir que a mensagem do agente afirme nível de prioridade ou
  quantidade de horas de prazo. **(novo — RF-68)**

### O cartão negociável

- **FR-7** — WHILE um turno está em andamento com uma proposta já existente, THE SYSTEM SHALL
  ocultar o resumo de confirmação até o turno terminar. **(novo — RF-69)**
- **FR-8** — WHEN um turno termina com uma proposta diferente da anterior, THE SYSTEM SHALL
  exibir os valores novos, inclusive nos controles que a pessoa já havia mexido, sem nenhuma
  frase adicional sobre a substituição. **(novo — RF-69)**
- **FR-9** — WHEN um turno termina com uma proposta, THE SYSTEM SHALL preservar os valores
  digitados pela pessoa nos campos que a proposta nova **não** alterou, e adotar os da
  proposta nos campos que ela alterou. **(novo — RN-13)**
- **FR-10** — WHEN o assunto da proposta muda, THE SYSTEM SHALL descartar os valores dos campos
  do assunto anterior, começar os do novo vazios, e informar que o assunto mudou. **(refina
  RF-27)**

### A IA ajustando a pedido

- **FR-11** — WHEN a pessoa pede em texto uma correção no chamado montado, THE SYSTEM SHALL
  poder ajustar prioridade, título, descrição, assunto e os campos do formulário do assunto
  vigente. **(novo — RF-71)**
- **FR-12** — THE SYSTEM SHALL restringir o assunto ao conjunto que a instalação oferece
  (**RF-28**, `D-70`); pedido por um assunto fora dele não muda o assunto.
- **FR-13** — IF um valor pedido não existir entre as opções do campo, THEN THE SYSTEM SHALL
  não gravá-lo e informar as opções válidas pelos **rótulos** (`D-39`, **RNF-30**).
- **FR-14** — IF a pessoa pedir um campo que o assunto vigente não tem, THEN THE SYSTEM SHALL
  não inventar campo e informar que aquele assunto não o tem.
- **FR-15** — THE SYSTEM SHALL não alterar por pedido em texto: os campos de identidade do
  solicitante (spec 006) e a área (`D-52`).
- **FR-16** — WHEN o assunto muda no mesmo pedido, THE SYSTEM SHALL não preencher campos do
  assunto novo naquele turno (o formulário dele começa vazio).
  > Limite deliberado: os campos possíveis dependem do assunto, e o assunto acabou de ser
  > escolhido na mesma decisão. Preencher os dois de uma vez exigiria decidir o assunto antes
  > de saber quais campos existem.
- **FR-17** — THE SYSTEM SHALL manter a prioridade seguindo o **impacto descrito**, não a
  urgência pedida (**R-04**), e manter a edição manual como o caminho da pessoa (**RF-16**).

### O aviso

- **FR-18** — WHEN a pessoa envia a primeira mensagem com o resumo de confirmação disponível
  naquela conversa, THE SYSTEM SHALL pedir uma confirmação que declare que conversar pode
  reescrever campos preenchidos, oferecendo seguir ou voltar ao formulário. **(novo — RF-70)**
- **FR-19** — WHEN esse aviso já foi exibido uma vez naquela conversa, THE SYSTEM SHALL não
  exibi-lo novamente até o fim dela, independentemente da escolha feita nele e de o cartão ter
  desaparecido e voltado.
- **FR-20** — IF a pessoa escolher voltar ao formulário, THEN THE SYSTEM SHALL não enviar a
  mensagem, não alterar a proposta e preservar o texto já escrito.
- **FR-21** — WHILE não houver proposta, ou WHILE houver bloqueio pendente sem override, THE
  SYSTEM SHALL não pedir essa confirmação (**RN-07**, **RF-13**).
- **FR-22** — THE SYSTEM SHALL informar, na etapa em que o formulário está disponível, que
  conversar pode alterar o que foi preenchido — sem depender de a pessoa ter visto o aviso.

### Registro

- **FR-23** — THE SYSTEM SHALL registrar em auditoria a exibição e o desfecho do aviso, e o
  fato de uma proposta ter sido ajustada por argumentação, com **quais** campos mudaram —
  nunca os valores digitados (**RN-10**, **RNF-30**).

## 7. Non-Functional Requirements

- **Performance:** nenhuma ida adicional ao provedor de IA por turno em relação a hoje — o
  motivo e os ajustes viajam com a decisão que já existia (**RNF-12**, `D-32`). Nenhuma
  chamada nova à Atlassian por turno além do schema que a tela já lê (**R-02**).
- **Security / Privacy:** o motivo e os valores ajustados são texto gerado sobre o que a
  pessoa escreveu; não podem conter identificador interno (**RNF-30**) nem conteúdo de
  terceiros trazido por tool (`R-07`).
- **Reliability:** ausência de motivo, falha de extração, valor fora das opções ou proposta
  inalterada **degradam** para o comportamento de hoje, nunca para botão travado (**RNF-18**).
  Nenhum ajuste por texto pode produzir um chamado que a criação recuse (`D-38`, `D-39`).
- **Accessibility / i18n:** o aviso segue o piso do projeto — foco contido, `Esc` pela saída
  sem efeito, foco devolvido, estado nunca só por cor; tudo em português acentuado. A mudança
  de valores no cartão precisa ser perceptível a leitor de tela, não só visualmente.
- **Observability:** eventos que permitam contar propostas ajustadas por argumentação, campos
  ajustados por pedido, valores recusados por não existirem, e desfechos do aviso.

## 8. Edge Cases & Error Conditions

- Turno que **não** produz proposta nova: a proposta anterior continua valendo e volta à tela.
- Turno que produz bloqueio: o cartão não volta enquanto o bloqueio estiver pendente
  (`RN-07`); o caminho de override é a saída.
- Recarregar a página: o formulário volta do estado persistido e o que estava digitado se
  perde — comportamento de hoje, declarado como non-goal.
- Duas abas na mesma conversa: a segunda pode ter um cartão mais velho. **Fora de escopo** —
  o app não sincroniza abas em nenhuma tela, e tratar aqui seria a única exceção.
- Teto de custo da conversa atingido no meio da negociação: o turno encerra pelo caminho já
  existente, e o cartão anterior continua válido.
- Pessoa pede ajuste e a leitura do schema do assunto falha: nenhum campo do formulário é
  ajustado naquele turno, e o cartão volta com o que já tinha (`D-27`, fail-open).
- Pedido ambíguo ("muda o sistema") sem dizer para quê: nada é gravado no escuro; o agente
  pergunta.

## 9. Success Criteria (measurable)

- **ScC-1** — Em 100% dos cartões com proposta, existe um motivo de até duas frases exibido
  junto da prioridade, ou a declaração de FR-5. Nenhum cartão exibe a descrição genérica do
  nível.
- **ScC-2** — Não existe, na tela, nenhuma frase do agente afirmando nível de prioridade ou
  número de horas de prazo (verificável sobre o prompt e sobre a saída).
- **ScC-3** — Depois de um turno que muda a prioridade, o valor lido na tela é igual ao valor
  que a criação usaria — sempre. (Hoje é falso: a tela mostra o valor da primeira montagem.)
- **ScC-4** — Depois de um turno que **não** muda um campo preenchido pela pessoa, o valor
  dela continua na tela — sempre.
- **ScC-5** — Um pedido em texto que nomeia um campo do assunto vigente e um valor válido
  resulta naquele campo com aquele valor no cartão seguinte.
- **ScC-6** — Nenhum ajuste por texto produz criação recusada por campo obrigatório faltando
  ou opção inexistente (os dois caminhos de `D-38`/`D-39` continuam cobertos).
- **ScC-7** — O aviso aparece exatamente uma vez por conversa e não é pré-requisito de nenhuma
  outra ação.
- **ScC-8** — A contagem de idas ao provedor de IA por turno não aumenta (teste de contagem de
  chamadas, como `tests/latencia.test.ts` já faz).
- **ScC-9** — A auditoria responde "quantas propostas foram ajustadas por argumentação, e em
  quais campos?" sem ler o banco à mão.

## 10. Open Questions

Todas resolvidas — nenhuma pendente para `/plan`.

- [x] **Teto do motivo** → **duas frases** (mantenedor). Acima do teto cai em FR-5. → FR-3
- [x] **Sem motivo** → a tela **declara** que a sugestão não veio justificada, seguindo o
      precedente de `D-53`. → SC-4, FR-5
- [x] **Escopo do "uma vez"** → por **conversa**, disparado pela **exibição**, e não volta nem
      se o cartão desaparecer e voltar (mantenedor). → SC-17, FR-19
- [x] **Substituir a escolha da pessoa** → **basta mudar** o seletor; nenhuma frase, nenhuma
      oferta de reverter (mantenedor). → SC-8, FR-8
- [x] **"Nada mudou" é dito?** → não; o cartão idêntico e a resposta do agente bastam. → SC-6
- [x] **Alcance da IA** → **aumenta**: ela ajusta a pedido a prioridade, o título, a descrição,
      o assunto e os campos do formulário do assunto vigente (mantenedor: *"faça a IA
      conseguir mudar a pedido do usuário"*). Fora do alcance: identidade e área. → FR-11 a
      FR-16, SC-10 a SC-14
- [x] **Sobrevivência a recarregamento** → fora de escopo; comportamento de hoje. → Non-Goals
- [x] **Duas abas** → fora de escopo. → Edge Cases

## 11. Out of Scope (defer)

- Histórico de motivos ("antes eu havia sugerido alta porque…").
- Serializar a mensagem e a decisão para o agente narrar a escolha em prosa — recusado por
  custo de latência; reabrir só com medição.
- Realce comparativo (diff) do que mudou entre um cartão e o seguinte.
- Preencher campos do assunto novo no mesmo turno em que o assunto muda (FR-16).
- Persistir rascunho do formulário entre recarregamentos.
- Negociação depois de o chamado existir — isso é comentário no chamado (`RF-32`).

---
## Requirement Completeness — checklist (gate antes do /plan)
- [x] Nenhum `[NEEDS CLARIFICATION]` pendente — **0 pendentes**
- [x] Todo FR é testável e não-ambíguo
- [x] Todo FR mapeia a pelo menos um Scenario
- [x] Success Criteria são mensuráveis
- [x] Non-Goals / Out of Scope explícitos
- [x] Nenhum detalhe de implementação (HOW) vazou para a spec
- [ ] **Pendência de rastreabilidade (Princípio VII):** cinco comportamentos novos não têm ID
      em `docs/REQUISITOS.md`. Emendar o documento (`RF-68`, `RF-69`, `RF-70`, `RF-71`,
      `RN-13`) **antes** de `/tasks`.
