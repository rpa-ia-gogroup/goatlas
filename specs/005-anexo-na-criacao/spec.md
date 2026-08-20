---
feature: "Anexo na criação do chamado"
id: "005"
status: draft
created: "2026-08-07"
revised: "2026-08-07 — v2: SC-05b, SC-07b, SC-12, ScC-6, ScC-7"
spec_version: 2
requirements: "../../docs/REQUISITOS.md"
scope_ids: "RF-61 · RF-62 · RF-63 · RN-11 — apoiando-se em RF-17, RF-24, RF-25, RF-27, RF-30, RF-34, RF-44, RF-55, RN-10, RNF-17, RNF-18, RNF-22, RNF-25, RNF-28, RNF-30, RNF-33, R-02, R-06"
---

# Spec 005: Anexo na criação do chamado

> Referencia IDs de [`REQUISITOS.md`](../../docs/REQUISITOS.md). Comportamento
> observável apenas — tecnologia vai no `plan.md`.

## 1. Problem & Why

Hoje o atlas só anexa **depois** que o chamado existe (`RF-34`), porque a rota
precisa da `issueKey`. Isso não é uma limitação de implementação: é o que o
requisito diz, e diverge do JSM.

**No portal nativo do JSM, anexar na criação é o padrão.** O request type expõe um
campo de anexo no próprio formulário, e o arquivo entra na mesma chamada que cria a
solicitação. Quem usou o portal antes espera isso; quem nunca usou espera de
qualquer coisa que peça para descrever um problema.

**O custo de exigir dois passos não é conveniência, é evidência perdida.** Quem
escreve *"o relatório de vendas veio errado"* está com o print na tela naquele
momento. Pedir que crie o chamado e **volte** para anexar é uma segunda ação
deliberada, e boa parte das pessoas não faz. O chamado chega ao time de tech sem a
única coisa que tornaria a primeira resposta útil, e a primeira resposta vira
*"consegue mandar um print?"* — uma ida e volta inteira dentro de um SLA que é
justamente de **primeira resposta** (`RN-08`). O prazo é cumprido e o problema não
andou.

**Por que a declaração é obrigatória, e não um campo opcional.** Um campo de anexo
opcional é ignorado por padrão: ele fica ao lado dos outros, ninguém precisa
decidir nada, e a pessoa segue direto para o botão. Uma pergunta que precisa ser
respondida força **uma** decisão consciente, no único momento em que a pessoa ainda
tem o material à mão. E produz um dado que hoje não existe: chamado aberto por
alguém que declarou *não ter* material é diferente de chamado aberto por alguém que
não pensou no assunto — o primeiro é informação sobre o caso, o segundo é omissão.

⚠️ **O que isto NÃO pode virar.** A pergunta trava a criação até ser respondida;
ela nunca trava a criação até haver arquivo (`RN-11`). Quem declara "tenho" e
desiste volta para "não tenho" e abre o chamado. E anexo que falha ao subir não
segura o chamado (`RF-63`) — o mesmo raciocínio de `RNF-18` que vale para as regras:
indisponibilidade degrada, não vira parede.

## 2. Goals / Non-Goals

**Goals**
- Anexar **na criação**, nos dois caminhos: conversa e formulário direto (`D-04`).
- Obrigar a declaração antes de confirmar, sem opção pré-marcada.
- Manter o chamado nascendo quando o anexo falhar, dizendo o que aconteceu.
- Deixar o caminho **pronto para ligar** quando a credencial real existir (`Q1`):
  nenhum id de campo hardcoded, fake exercitando o fluxo, testes sem rede.

**Non-Goals**
- **O agente não lê o anexo.** Nada de OCR, visão ou classificação a partir do
  arquivo. O anexo é evidência para o time de tech, não entrada para a IA — ler
  conteúdo enviado pelo usuário dentro do prompt é a superfície de injeção que
  `R-07` já trata em conteúdo do Confluence, e não vale a pena abrir outra.
- Anexar por outro caminho que não o do próprio solicitante (webhook, cron, e-mail).
- Mexer no proxy de anexo do Confluence (`D-11`) — é o sentido oposto do tráfego.
- Substituir `RF-34`: anexar depois continua existindo, e é para onde `RF-63` manda
  quem falhou.

## 3. Scenarios (Given / When / Then)

### A declaração

- **SC-01** · `RF-62`, `RN-11`, `RF-17`
  - **Given** a proposta do chamado montada e exibida para conferência
  - **When** a pessoa ainda não declarou se tem material para anexar
  - **Then** o botão de abrir o chamado **não** está disponível, e a tela explica
    que falta responder — sem nenhuma das duas opções pré-marcada.
- **SC-02** · `RF-62`, `RN-11`
  - **Given** a pergunta na tela
  - **When** a pessoa responde **"não tenho"**
  - **Then** o chamado pode ser aberto imediatamente, e a resposta fica registrada
    com o chamado.
- **SC-03** · `RF-62`, `RN-11`
  - **Given** a pessoa respondeu **"tenho"** e o envio está aberto
  - **When** ela desiste sem escolher arquivo
  - **Then** ela consegue voltar para "não tenho" e abrir o chamado. A declaração
    trava a criação; a ausência de arquivo não.

### O anexo na criação

- **SC-04** · `RF-61`, `RF-25`, `RF-27`
  - **Given** um request type cujo schema expõe campo de anexo
  - **When** a pessoa anexa um arquivo e confirma
  - **Then** a pessoa sai da confirmação com o chamado aberto **e** o arquivo já
    anexado nele — uma ação só, sem passo posterior e sem ver o chamado "vazio".
- **SC-05** · `RF-61`, `RF-27`, `RNF-18`
  - **Given** um request type cujo schema **não** expõe campo de anexo
  - **When** a pessoa chega à confirmação
  - **Then** a pergunta de `RF-62` não aparece e o chamado abre normalmente. Um tipo
    de chamado sem anexo não pode virar um chamado que não abre.
- **SC-05b** · `RF-62`, `RNF-18`, `RN-10`
  - **Given** que o schema do request type **não pôde ser lido**
  - **When** a pessoa chega à confirmação
  - **Then** a pergunta não aparece e o chamado abre — indisponibilidade de leitura
    de schema não pode virar "não consigo abrir seu chamado". O evento fica na
    auditoria, para que ninguém confunda "o tipo não aceita anexo" com "não deu para
    saber".
- **SC-06** · `RF-61`, `D-04`
  - **Given** o formulário direto, que já renderiza os campos do schema (`RF-27`)
  - **When** o tipo escolhido aceita anexo
  - **Then** a mesma pergunta e o mesmo envio aparecem ali, com o mesmo
    comportamento da conversa.

### Quando dá errado

- **SC-07** · `RF-63`, `RNF-18`
  - **Given** a pessoa anexou um arquivo e confirmou
  - **When** o envio do anexo falha (envio indisponível, limite de taxa, tempo
    esgotado, ou o arquivo enviado antes já não vale mais)
  - **Then** o **chamado é criado**, a tela diz claramente que o anexo não subiu, e
    oferece anexar de novo pelo caminho de `RF-34` — com a chave do chamado à mão.
  - ⚠️ **Nunca o contrário:** problema com o anexo não pode impedir o chamado de
    nascer, nem marcá-lo como falha definitiva. Perder o chamado de alguém por causa
    de um arquivo é o pior resultado possível desta feature.
- **SC-07b** · `RF-63`, `RNF-17`, `RF-44`
  - **Given** que a criação não pôde ser concluída na hora e ficou na fila
  - **When** a pessoa confirma com um arquivo anexado
  - **Then** a tela diz que o chamado está na fila **e que o anexo precisará ser
    adicionado quando ele nascer** — o aviso posterior repete isso. Prometer que o
    arquivo vai junto seria mentira, porque o envio anterior não sobrevive à espera.
- **SC-08** · `RF-63`, `RNF-30`
  - **Given** o arquivo excede o teto de tamanho ou o número máximo de arquivos
  - **When** a pessoa tenta anexar
  - **Then** a recusa acontece **antes** de qualquer chamada à Atlassian, com
    mensagem em português dizendo o limite e o que fazer.
- **SC-09** · `RF-24`
  - **Given** um duplo clique ou reenvio da confirmação
  - **When** a criação já aconteceu
  - **Then** não nasce um segundo chamado nem um segundo anexo — e o duplo clique no
    seletor de arquivo também não gera dois envios do mesmo arquivo.
- **SC-10** · `RNF-18`, `RF-30`
  - **Given** o app impedido de escrever na Atlassian
  - **When** a pessoa tenta anexar
  - **Then** a recusa é honesta e explícita, nunca um sucesso simulado.

- **SC-11** · `RF-30`
  - **Given** um arquivo que outra pessoa enviou e ainda não virou chamado
  - **When** alguém tenta fazê-lo entrar no próprio chamado
  - **Then** não entra. O que identifica um envio pendente não trafega pelo
    navegador, e o vínculo com quem enviou é verificado no servidor.

### Registro

- **SC-12** · `RN-10`, `RF-62`
  - **Given** qualquer criação com declaração de anexo
  - **When** o chamado nasce
  - **Then** a auditoria registra a declaração e o resultado do envio — inclusive
    quando o envio falhou.

## 4. Success Criteria

- **ScC-1** — Abrir chamado com anexo é **uma** confirmação, não duas ações.
- **ScC-2** — Nenhum caminho permite criar sem responder a pergunta, e nenhum
  caminho exige arquivo para criar.
- **ScC-3** — Anexo que falha nunca impede o chamado; a pessoa sai da tela sabendo
  que o anexo não subiu e como resolver.
- **ScC-4** — Nenhum id de campo de anexo aparece no código: tudo vem do schema
  (`RF-27`) ou de configuração (`RNF-25`).
- **ScC-5** — Toda a suíte roda sem credencial e sem rede, com o fake exercitando
  sucesso e falha do envio.
- **ScC-6** — **Nenhum chamado é perdido por causa de anexo.** Nenhum caminho de
  falha de envio marca a criação como falha definitiva.
- **ScC-7** — Depois do piloto, a proporção de chamados que chegam com evidência é
  observável no painel (`RF-55`). Sem esse número, "a evidência não chegava" continua
  sendo intuição, e não dá para saber se a pergunta obrigatória valeu a pena.

### 4.1 Fechamento (T-424, 10/08/2026)

Item por item, com **onde** cada um está travado. Critério fechado sem teste é intenção.

| | Critério | Estado | Onde |
|---|---|---|---|
| **ScC-1** | Abrir com anexo é **uma** confirmação | ✅ | `SC-04` em `rf63-falha-de-anexo`: uma requisição de criação, e o arquivo já está no chamado. A ordem (criar → materializar) tem teste próprio |
| **ScC-2** | Ninguém cria sem responder; ninguém precisa de arquivo para criar | ✅ | `rf62-declaracao-anexo`: burla nos dois caminhos (400, nada criado) · `T-405`/`SC-03`: "tenho" sem arquivo abre igual |
| **ScC-3** | Anexo que falha não impede o chamado, e a pessoa sabe como resolver | ✅ | `T-412`: submissão fica `criado`, resposta traz `anexo.estado` e a mensagem manda anexar por `RF-34` |
| **ScC-4** | Nenhum id de campo de anexo no código | ✅ | `scc4-nenhum-fieldid-de-anexo`: varredura de `src/` + prova de que id arbitrário funciona e campo de texto chamado "attachment" **não** conta |
| **ScC-5** | Suíte sem credencial e sem rede, com fake exercitando sucesso e falha | ✅ | `falhas.subirAnexoTemporario`, `falhas.materializarAnexos` e `temporariosInvalidos` (id vencido = 4xx definitivo, o caso que importa) |
| **ScC-6** | **Nenhum chamado perdido por causa de anexo** | ✅ | Estrutural, não só testado: a materialização mora fora de `ServicoChamados.processar` e **não lança** (`D-26`) |
| **ScC-7** | Proporção de chamados com evidência observável no painel | ✅ | `scc7-evidencia-no-painel` + `PainelEvidencia`. Sinal **durável** (`submissoes.anexos_anexados`), denominador = **perguntados**, taxa `null` sem dado |

⚠️ **`ScC-7` está entregue como instrumento, não como resultado.** O número existe e é
honesto; se a pergunta obrigatória valeu a pena só se sabe **depois do piloto**, com ele
preenchido. É deliberado: a alternativa era não medir e manter a fricção por convicção.

**O que continua sem verificação, e por que não bloqueia esta spec:** ninguém confirmou
contra a Atlassian real que o request type do portal expõe campo de anexo. Isso **saiu da
spec** (a antiga `T-425`) porque é verificação de go-live: sem o campo o código cai em
`SC-05` e a feature fica **dormente** sem quebrar nada, e com o campo ela funciona sem uma
linha a mudar. O item vive na tabela "o que falta não é código" do `CLAUDE.md`, junto das
outras verificações que dependem de desligar `ATLAS_SOMENTE_LEITURA` (`D-24`).

## 5. Dependências e o que fica pendente

- **`Q1`** — sem a credencial funcionando (a Atlassian responde **401** hoje) não é
  possível confirmar que o request type do portal da Gocase **expõe** campo de
  anexo, nem observar o envio real. A spec é escrita para que isso seja
  **verificação**, não implementação: o código lê o schema e se adapta; se o campo
  não existir, cai em `SC-05`.
- **Modo somente leitura** — enquanto ligado, `SC-04` só é observável contra o
  dublê. `SC-10` é o cenário que vale em produção hoje.
- **Pré-requisito de segurança, independente desta feature** — os campos adicionais
  que o formulário envia hoje não são validados contra o schema do tipo de chamado.
  Isso precisa ser corrigido **antes**, porque um campo de anexo no schema
  transformaria essa folga no caminho de `SC-12`. Detalhe em `plan.md` §4.

## 6. Fora de escopo desta spec, registrado para não se perder

- Anexo **na deflexão** (a pessoa manda um print e a Regra 1 usa isso) — depende de
  o agente ler o arquivo, o que está em Non-Goals.
- Colar imagem da área de transferência. É melhoria de conveniência sobre o mesmo
  mecanismo; entra depois que o caminho básico estiver validado contra a Atlassian
  real.
