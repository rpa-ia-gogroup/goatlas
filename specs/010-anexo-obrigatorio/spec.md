---
# Especificação de Feature — gerada por /specify. WHAT/WHY apenas.
feature: "anexo-obrigatorio"
id: "010"
status: implemented
created: "2026-08-17"
spec_version: 1
---

# Spec: O anexo viaja na criação — e os 6 assuntos que exigem evidência param de perder chamado

> **Regra de ouro:** esta spec descreve **WHAT** e **WHY**. O **HOW** vai no `plan.md`.

## 1. Problem & Why

Em **17/08/2026**, `isaac.albano@gocase.com` conversou 4 minutos com o agente, viu o cartão,
confirmou a abertura — e leu *"Não conseguimos abrir o chamado, e ele não ficou na fila para
ser aberto depois"*. Confirmou de novo. E de novo. **Três vezes, três falhas.** Nenhum chamado
nasceu.

O Investigador (`D-73`) respondeu em uma linha o que nenhuma fonte do projeto sabia antes:

```
09:13:42  confirmacao      A pessoa confirmou a abertura pela conversa
09:13:42  payload_final    Entregando ao Jira: tipo 134, prioridade normal
09:13:43  chamada_externa  atlassian POST /rest/servicedeskapi/request → 400
09:13:43  desfecho_criacao Criação falhou de forma DEFINITIVA — não será reprocessada
```

O request type **134 ("Relatar um problema (Sistema)")** tem **seis** campos obrigatórios. O app
entregou cinco. O que faltou foi **`attachment`** — *"Por favor, evidencie o problema"*.

### 1.1 Não é o caso de uma pessoa: são 6 dos 15 assuntos, e a falha é estrutural

Medido em 17/08/2026 por `GET /api/admin/tipos-chamado/schema` (a rota de `D-44`):

| Assunto | Anexo | Situação |
|---|---|---|
| `90` Solicitação/problema no Site ou Checkout | **obrigatório** | 🚨 nunca abre |
| `91` Problema com pedido de cliente | **obrigatório** | 🚨 nunca abre |
| `92` Problema com Nota Fiscal | **obrigatório** | 🚨 nunca abre |
| `94` Lote não gera | **obrigatório** | 🚨 nunca abre |
| `96` Problemas com grid | **obrigatório** | 🚨 nunca abre |
| `134` Relatar um problema (Sistema) | **obrigatório** | 🚨 nunca abre |
| `68` · `70` · `71` · `89` · `95` | opcional | abre |
| `93` · `108` · `143` · `144` | não tem campo | abre |

A causa está em duas decisões corretas que, somadas, produzem o defeito:

1. **`D-26`** — o anexo **não** viaja no corpo da criação. Ele sobe à Atlassian no momento em
   que a pessoa o escolhe, vira `temporaryAttachmentId`, e é materializado **depois** que o
   chamado existe. A razão é boa: id temporário vencido faz a criação responder 400,
   `atlassian/http.ts` classifica 400 como **definitivo**, e submissão definitiva nunca é
   reprocessada — um arquivo velho apagaria o chamado da pessoa.
2. **`D-38`** — o campo de anexo fica **fora** da checagem de obrigatórios, "senão `RN-11`
   viraria *anexe um arquivo*".

Onde o Jira **exige** o anexo, as duas juntas garantem o pior resultado possível: o app não
manda o arquivo, não percebe que faltou, entrega mesmo assim, toma 400 e **perde o chamado**.
Exatamente o modo de falha que `D-26` foi escrita para evitar — na única situação em que ela
não protege.

⚠️ **E isso explica retroativamente todo o histórico do projeto:** os chamados que já nasceram
(`GN-6894`, `GN-6897`, `GN-6898`, `GN-6902`…) são todos dos tipos `68`/`108`/`143`/`144` — os
que **não têm** campo de anexo. Nenhum dos seis quebrados jamais produziu um chamado, e ninguém
tinha como saber, porque a falha se apresenta como "algo deu errado" para a pessoa e como uma
linha de outbox `falha` para nós.

### 1.2 Os dois lados do defeito são independentes

O caso do Isaac tem os dois, e consertar um só não o resolve:

- **Quem TEM o arquivo** continua perdendo o chamado, porque o arquivo não viaja na criação.
- **Quem NÃO tem** — o Isaac declarou *"não tenho material para anexar"* — não tem conserto
  possível no nosso lado: o Jira exige. O app precisa **pedir antes**, não falhar depois.

### 1.3 A pergunta que travava o desenho já foi respondida

A saída limpa é o app **guardar os bytes** e mandá-los à Atlassian só na confirmação — sem id
temporário envelhecendo, o motivo de `D-26` desaparece. Isso dependia de saber se o banco da
plataforma aguenta um arquivo, e ✅ **`D-74` mediu, no app publicado**: `env.DB` guarda **8 MB**
(o teto de `http/anexo-entrada.ts`) e devolve **íntegro**, inclusive **entre requisições
diferentes**, desde que fatiado — o teto é de **~2,2 MB por valor**, não por arquivo.

Custo de não fazer: seis assuntos — entre eles os de **produção parada por nota fiscal, pedido
de cliente e grid** — continuam sendo becos sem saída, e cada pessoa que cai neles perde o
relato inteiro depois de investir minutos na conversa. A mitigação aplicada em 17/08 (os seis
saíram da allowlist em produção) evita a perda **desviando as pessoas dos assuntos certos**:
o chamado nasce na fila errada, ou não nasce.

## 2. Goals / Non-Goals

**Goals**

- Nenhum chamado é perdido por causa de anexo — nem com arquivo, nem sem.
- Nos assuntos que exigem evidência, a pessoa **sabe disso antes de confirmar**, com o
  controle de anexar na mesma tela.
- O arquivo que a pessoa envia fica sob nosso controle até o chamado existir, para o
  `temporaryAttachmentId` nascer **segundos** antes de ser usado.
- Os 9 assuntos que hoje funcionam continuam funcionando exatamente como hoje.

**Non-Goals**

- Reabrir `D-26` para os assuntos em que o anexo é **opcional**: lá a materialização depois da
  criação continua sendo o desenho certo, e mexer nela é assumir risco sem contrapartida.
- Mudar a análise de anexo (`D-64`, spec 007). Ela continua rodando dentro da requisição de
  upload. (Guardar os bytes *permitiria* movê-la; fazer isso agora é feature nova.)
- Reescrever a pergunta de anexo de `RN-11` para os demais assuntos.
- Aumentar o teto de 8 MB ou o de 3 arquivos por chamado.
- Resolver `93` (exige `duedate` + `customfield_10003`, que o app não coleta) — ver §8.

## 3. Cenários

### SC-01 · Assunto que exige anexo, pessoa sem arquivo (o caso do Isaac)
**Dado** que a conversa chegou a uma proposta com assunto `134`
**E** a pessoa não enviou nenhum arquivo
**Quando** o cartão de confirmação é exibido
**Então** o cartão diz que **este assunto exige evidência** e o botão de confirmar fica travado
**E** a frase de pendência nomeia o que falta, junto com o resto que falta (`D-46`)
**E** o controle de anexar está visível ali mesmo
**E** nenhuma chamada de criação é feita.

### SC-02 · Assunto que exige anexo, pessoa anexa e confirma
**Dado** o mesmo cartão, com um print colado na conversa
**Quando** a pessoa confirma
**Então** o arquivo viaja **dentro** da criação
**E** o chamado nasce com o anexo já presente
**E** a pessoa vê o recibo com a chave do chamado.

### SC-03 · Trocar de assunto desfaz a exigência
**Dado** o cartão em `134` com a trava de evidência
**Quando** a pessoa diz na conversa que é uma dúvida, e a proposta é rederivada para `68`
**Então** a trava some, porque ela é do **assunto**, não da conversa
**E** o chamado abre sem anexo.

### SC-04 · Assunto de anexo opcional não muda de comportamento
**Dado** um chamado de assunto `70` com um arquivo enviado
**Quando** a pessoa confirma
**Então** o chamado é criado **primeiro** e o anexo materializado **depois** (`D-26` intacta)
**E** falha na materialização não derruba o chamado (`RF-63`).

### SC-05 · O arquivo sobrevive à espera
**Dado** que a pessoa colou um print e continuou conversando por 40 minutos
**Quando** ela finalmente confirma
**Então** o arquivo ainda está lá, íntegro
**E** o `temporaryAttachmentId` usado na criação foi criado **naquele instante**, não 40
minutos antes.

### SC-06 · Falha ao subir o arquivo na confirmação não perde o chamado
**Dado** um assunto que exige anexo, com arquivo guardado
**Quando** a Atlassian recusa o upload temporário por indisponibilidade (5xx)
**Então** a submissão é tratada como **transitória** e continua na fila (`RNF-17`)
**E** a pessoa lê que o chamado está sendo aberto, não que se perdeu.

### SC-07 · O agente não pede arquivo em prosa
**Dado** qualquer conversa
**Quando** o assunto proposto exige anexo
**Então** quem pede o arquivo é o **cartão**, nunca o texto do modelo (`D-59`, `D-71`)
**E** o texto do modelo continua proibido de pedir print.

### SC-08 · A tabela de conteúdo não vira depósito
**Dado** um arquivo guardado para uma conversa que nunca virou chamado
**Quando** o expurgo roda
**Então** os bytes somem na mesma janela de hoje (12 h)
**E** o registro do que aconteceu (`anexos_enviados`) permanece, sem os bytes.

### Cenários de burla

#### ScB-01 · Confirmar direto pela rota, sem anexo, em assunto que exige
**Quando** alguém chama `POST /api/conversas/:id/confirmar` sem nunca ter enviado arquivo
**Então** o servidor **recusa antes de qualquer efeito**, com o rótulo do campo em português
**E** nenhuma criação é tentada (a trava é do servidor, a tela é conveniência — `agent/gate.ts`).

#### ScB-02 · O id temporário continua invisível ao navegador
**Quando** qualquer rota devolve informação de anexo
**Então** o `temporaryAttachmentId` não aparece em nenhuma resposta (`RF-30` aplicado a arquivo).

#### ScB-03 · O conteúdo de outra pessoa não é alcançável
**Quando** alguém pede os bytes guardados de uma conversa que não é dele
**Então** a resposta é **404**, com o e-mail no `WHERE` (`RF-30`, `D-30`).

## 4. Requisitos funcionais (novos)

- **FR-1** O app guarda o conteúdo do arquivo enviado até o chamado ser criado ou o prazo de
  expurgo passar. _(novo `RF-78`)_
- **FR-2** Nos assuntos cujo schema marca o campo de anexo como obrigatório, a criação só é
  autorizada com pelo menos um arquivo — recusa **antes** de qualquer chamada à Atlassian, com
  o rótulo do campo. _(novo `RF-79`, `RN-14`)_
- **FR-3** Nesses assuntos, o arquivo viaja **dentro** da chamada de criação. Nos demais, a
  materialização continua **depois** da criação. _(emenda a `RF-61`; `D-26` preservada onde
  vale)_
- **FR-4** O `temporaryAttachmentId` é obtido na **confirmação**, imediatamente antes da
  criação — nunca no upload. _(emenda a `RF-25`)_
- **FR-5** O cartão diz, em português e antes da confirmação, que o assunto exige evidência, e
  a pendência entra na frase composta de `D-46`. _(novo `RF-80`)_
- **FR-6** Quem pede o arquivo é o cartão; o texto do agente continua proibido de pedir print
  ou arquivo. _(`D-59` preservada)_
- **FR-7** Falha ao subir o arquivo na confirmação é classificada como o transporte já
  classifica: 5xx/429/timeout **transitório**, 4xx **definitivo** — e definitivo aqui devolve
  `criacaoNaoConcluida` (`D-46`), nunca um 201 mentiroso.
- **FR-8** O expurgo apaga os **bytes** na mesma janela de `anexos_pendentes` (12 h),
  preservando o registro de `anexos_enviados` (`D-51`).

## 5. Regras de negócio

- **RN-14** "Este assunto exige evidência" é lido do **schema do request type**
  (`jiraSchema.system === 'attachment'` + `required`), nunca de uma lista de ids no código nem
  de config. Lista de ids funcionaria na Gocase e falharia calada em outra instalação — é
  literalmente o defeito de `ScC-4`.
- **RN-11 continua valendo, e não vira "anexe um arquivo"** nos outros 9 assuntos: lá a
  declaração trava **responder**, nunca **anexar**.
- **Schema indisponível não cria exigência** (`D-27`, fail-open): sem schema não há como saber
  que o anexo é obrigatório, e inventar a trava seria transformar uma queda de leitura em
  parede — o que `RNF-18` proíbe. Consequência assumida: durante uma queda de schema, esse
  chamado pode tomar 400. Ele já toma hoje.

## 6. Fora de escopo (declarado)

- Mover a análise de anexo (`D-64`) para fora da requisição de upload.
- Reprocessar as submissões que **já** falharam por este motivo. Elas estão em `falha` e
  `RNF-17` diz que não voltam; quem quiser recuperá-las abre de novo. (⚠️ Vale escrever a
  quantidade no `plan.md`: se forem muitas, vira decisão de produto.)
- O assunto `93`, que exige `duedate` e `customfield_10003` (array) — o app não coleta nenhum
  dos dois. Ele **não perde** chamado (a recusa de `D-38` acontece antes do efeito), mas
  também nunca abre. É outro trabalho.

## 7. Métricas de sucesso

- Um chamado de assunto `134` nasce, com anexo, medido na staging.
- Uma tentativa de assunto `134` **sem** anexo é recusada antes da chamada, e a linha da
  auditoria diz o motivo.
- Os 6 assuntos voltam à allowlist de produção **depois** dessas duas medições, não antes.

## 8. Perguntas em aberto — ✅ AS DUAS RESPONDIDAS (17/08/2026)

- ✅ **A causa (`M-1`): é o anexo, e o Jira diz isso por extenso.** Com todos os demais campos
  preenchidos, a criação do tipo `134` respondeu **400** com uma frase só:
  *"Por favor, adicione pelo menos um arquivo"*
  (`i18nKey: sd.validation.request.creation.failure.required.field`). A inferência estava
  certa, e agora está **lida**.
- ✅ **O mecanismo (`M-2`): a criação ACEITA anexo no corpo.**
  `requestFieldValues.attachment = [temporaryAttachmentId]` → **HTTP 201**, `GN-6916`.
- ✅ **E o caminho inteiro foi medido na tela**: `GN-6918`, tipo `134`, aberto pelo formulário
  com `evidencia-factory.png` (5,5 MB) — o primeiro chamado que esse assunto já produziu.
