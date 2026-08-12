/**
 * A forma do valor que a Atlassian espera para cada campo — `D-39` e, na segunda
 * metade do arquivo, a **prioridade** de `D-48`.
 *
 * ## O que quebrava
 *
 * Medido na staging em 12/08/2026 com o request type **70**: a criação respondia
 * **400** e a pessoa lia *"Algo deu errado do nosso lado"*. O corpo que a tela mandou
 * trazia `customfield_10071: "10127"` — "Recorrência", campo de **seleção**. Para
 * campo de opção, `POST /rest/servicedeskapi/request` espera um **objeto**
 * (`{"id":"10127"}`); a string crua é recusada.
 *
 * 🚨 E 400, neste projeto, é **definitivo**: a submissão vira `falha` e **nunca** é
 * reprocessada (`RNF-17`). Não era um erro de digitação numa tela — era o chamado da
 * pessoa desaparecendo. O mesmo caminho com o tipo 68 (sem campo dinâmico) devolvia
 * 201, que é o que isolou a causa nos campos dinâmicos.
 *
 * ## Quem responde "qual é a forma?" é o TIPO do campo, e o tipo vem do schema
 *
 * Mesma regra de `ScC-4`: nada aqui decide pelo **id** do campo. Uma comparação do id
 * com uma constante funcionaria na Gocase e pararia de funcionar em outra instalação
 * **sem quebrar nada** — os chamados voltariam a morrer no 400, em silêncio. Quem
 * responde é `campo.tipo`, traduzido de `jiraSchema` em `atlassian/cliente.ts`.
 *
 * O schema já é lido pelas duas rotas de criação (`RF-62` e `obrigatoriosFaltando`),
 * então isto não custa uma ida a mais (`R-02`).
 *
 * ## `id` ou `value`?
 *
 * O navegador manda **sempre** `opcoes[].id`, que é o identificador que o schema
 * ofereceu (`validValues[].id ?? .value`) — nunca o rótulo. Então o valor que chega
 * aqui é um id, e `{"id": …}` é a forma certa. `{"value": …}` exigiria o **rótulo**,
 * que é texto exibido: mudaria com um "renomear opção" no Jira, e casaria por acento
 * e caixa.
 *
 * ⚠️ A exceção é medível, não é palpite: quando `id` e `rotulo` voltam **idênticos**,
 * o que a Atlassian ofereceu foi o texto, não um id — e aí `{"id": …}` seria uma busca
 * por um id que não existe, ou seja o mesmo 400. Nesse caso, e só nele, vai `{"value"}`.
 *
 * ## Traduzir não é validar
 *
 * `opcoesDesconhecidas` existe porque valor fora da lista dá o mesmo 400 definitivo —
 * é o raciocínio já registrado em `D-37` para a área do solicitante. Recusar antes de
 * qualquer efeito transforma "chamado perdido" em "corrija e reenvie".
 *
 * _Requirements: RF-16, RF-27, RNF-17, RNF-18, RNF-30_
 */

import type { CampoRequestType, OpcaoCampoRequestType, Prioridade } from '../atlassian/tipos'
import type { SchemaDoTipo } from './declaracao-anexo'

/** Ver o bloco "`id` ou `value`?" acima — a igualdade é o único critério. */
function referenciaDaOpcao(opcao: OpcaoCampoRequestType): Record<string, string> {
  return opcao.id === opcao.rotulo ? { value: opcao.id } : { id: opcao.id }
}

function ehSelecaoComOpcoes(campo: CampoRequestType): boolean {
  return campo.tipo === 'selecao' && campo.opcoes.length > 0
}

/**
 * Os RÓTULOS dos campos de seleção cujo valor não está entre as opções do schema.
 *
 * Rótulo, nunca `fieldId` (`RNF-30`) — quem lê a mensagem é quem abre o chamado.
 *
 * Fail-open nos dois casos de dúvida, pelo motivo de `D-27`: **schema desconhecido**
 * não é evidência de valor errado, e **seleção sem opções conhecidas** não é lista
 * para comparar contra. Campo vazio é assunto de `obrigatoriosFaltando`, não daqui —
 * duas mensagens para a mesma falta seriam duas telas dizendo coisas diferentes.
 */
export function opcoesDesconhecidas(
  schema: SchemaDoTipo,
  valores: Readonly<Record<string, string>> | null,
): readonly string[] {
  if (!schema.conhecido || !valores) return []
  return schema.campos
    .filter(ehSelecaoComOpcoes)
    .filter((c) => {
      const valor = (valores[c.fieldId] ?? '').trim()
      return valor.length > 0 && !c.opcoes.some((o) => o.id === valor)
    })
    .map((c) => c.rotulo)
}

/** A mensagem, em português e nomeando o campo. */
export function mensagemOpcoesDesconhecidas(rotulos: readonly string[]): string {
  const lista = rotulos.join(', ')
  return rotulos.length === 1
    ? `A opção escolhida para "${lista}" não é uma das oferecidas por este tipo de chamado. Escolha uma das opções da lista.`
    : `As opções escolhidas para: ${lista} não estão entre as oferecidas por este tipo de chamado. Escolha uma das opções de cada lista.`
}

/**
 * Os valores no formato que a criação do JSM aceita.
 *
 * Texto continua string; seleção vira objeto; seleção **múltipla** vira array de
 * objeto — `jiraSchema.type === 'array'` é a Atlassian dizendo que o campo guarda
 * lista, e mandar o objeto solto ali é o mesmo 400 que este módulo existe para
 * fechar.
 *
 * ⚠️ Devolve o valor **cru** em toda dúvida (schema desconhecido, campo fora do
 * schema, opção não reconhecida): é o comportamento de hoje, e o que decide recusar
 * é `opcoesDesconhecidas`, chamado antes. Inventar forma aqui seria a mesma classe
 * de erro, com outra roupa.
 *
 * O resultado é o que o outbox persiste — então o reprocessamento de `RNF-17`
 * reenvia exatamente o mesmo corpo, sem reler o schema.
 */
export function paraValoresDoJira(
  schema: SchemaDoTipo,
  valores: Readonly<Record<string, string>> | null,
): Record<string, unknown> | null {
  if (!valores || Object.keys(valores).length === 0) return null
  if (!schema.conhecido) return { ...valores }

  const porFieldId = new Map(schema.campos.map((c) => [c.fieldId, c]))
  const saida: Record<string, unknown> = {}
  for (const [fieldId, valor] of Object.entries(valores)) {
    const campo = porFieldId.get(fieldId)
    const opcao =
      campo && ehSelecaoComOpcoes(campo) ? campo.opcoes.find((o) => o.id === valor) : undefined
    if (!campo || !opcao) {
      saida[fieldId] = valor
      continue
    }
    const referencia = referenciaDaOpcao(opcao)
    saida[fieldId] = campo.multiplo ? [referencia] : referencia
  }
  return saida
}

/* ---------------------------------------------------------------------- */
/* PRIORIDADE — `D-48`                                                     */
/* ---------------------------------------------------------------------- */

/**
 * O vocabulário de prioridade da Atlassian, do mais urgente ao menos.
 *
 * ## Por que uma tabela de RÓTULO existe num arquivo que prega não usar rótulo
 *
 * Porque não há alternativa: `RF-16` oferece três prioridades **nossas**
 * (`crítica`/`alta`/`normal`) e o Jira oferece as **dele**, com ids que variam por
 * instalação (`1`–`5` na Gocase, medidos em 12/08/2026). Alguma coisa tem de casar as
 * duas listas, e o único dado comum é o texto.
 *
 * 🚨 **Mas o rótulo casa a OPÇÃO; o que vai ao Jira é o `id` que veio no `validValues`.**
 * É a diferença que importa: a antiga `ROTULO_PRIORIDADE` mandava `{name: "Highest"}` —
 * renomear a prioridade no Jira viraria **400 = definitivo = chamado perdido**
 * (`RNF-17`). Aqui, renomear faz o casamento **falhar**, e falhar tem tratamento
 * (omitir, ou recusar antes de qualquer efeito). Erro que se apresenta é preferível a
 * erro que apaga chamado.
 *
 * ## `escrita: false` não é redundância
 *
 * `Low`/`Lowest` **são lidas** como `normal` — nosso vocabulário não tem "baixa", e
 * mostrar `null` ali diria "chamado sem prioridade" sobre um chamado que tem. Mas elas
 * **nunca** são escritas: um `normal` que virasse `Low` porque `Low` aparece antes de
 * `Medium` na lista seria rebaixamento silencioso do que a pessoa escolheu. A leitura é
 * tolerante; a escrita, não. Uma tabela só, com a distinção declarada, é o que impede as
 * duas de divergirem — o raciocínio de `ehComentarioDoSolicitante` em `D-43`.
 *
 * _Requirements: RF-16, RNF-17, RNF-18, RNF-30_
 */
const VOCABULARIO_PRIORIDADE: readonly {
  readonly prioridade: Prioridade
  readonly escrita: boolean
  readonly rotulos: readonly string[]
}[] = [
  {
    prioridade: 'critica',
    escrita: true,
    rotulos: ['highest', 'critical', 'critica', 'blocker', 'urgent', 'urgente', 'muito alta'],
  },
  { prioridade: 'alta', escrita: true, rotulos: ['high', 'alta', 'major'] },
  { prioridade: 'normal', escrita: true, rotulos: ['medium', 'media', 'normal', 'moderate'] },
  {
    prioridade: 'normal',
    escrita: false,
    rotulos: ['low', 'baixa', 'lowest', 'muito baixa', 'minor', 'trivial'],
  },
]

/**
 * Minúscula, sem acento e sem espaço sobrando.
 *
 * ⚠️ Sem a remoção de acento, `Média` (o rótulo em português) não casaria com `media` e
 * a instalação em pt-BR ficaria sem prioridade nenhuma — o defeito que este módulo
 * fecha, de volta por um detalhe de codificação.
 */
function normalizarRotulo(rotulo: string): string {
  return rotulo
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
}

/**
 * A prioridade **nossa** que um rótulo do Jira representa — o caminho de LEITURA.
 *
 * Rótulo desconhecido devolve `null`, nunca um palpite: é o mesmo critério de
 * `chaveDoEspaco` em `D-42` ("palpite aqui é pior que ausência"). A tela mostra o
 * chamado sem prioridade em vez de afirmar uma que ninguém escolheu.
 */
export function prioridadeDoRotulo(rotulo: string): Prioridade | null {
  const alvo = normalizarRotulo(rotulo)
  if (alvo === '') return null
  for (const entrada of VOCABULARIO_PRIORIDADE) {
    if (entrada.rotulos.includes(alvo)) return entrada.prioridade
  }
  return null
}

/**
 * Quando a prioridade pedida não existe no site, qual se aceita no lugar — e a
 * ordem é o comportamento.
 *
 * 🚨 **Só desce, nunca sobe.** Esquema de três níveis (`High`/`Medium`/`Low`) é comum, e
 * nele "crítica" honestamente é o `High` do site. Subir seria o oposto: um `normal`
 * virando `High` inflaria a fila com a prioridade que `RF-16` existe para não deixar
 * ninguém conquistar escrevendo as palavras certas.
 *
 * ⚠️ E `normal` **não** desce para `Low`: ver `escrita: false` acima.
 */
const APROXIMACAO_PRIORIDADE: Readonly<Record<Prioridade, readonly Prioridade[]>> =
  Object.freeze({
    critica: ['critica', 'alta', 'normal'],
    alta: ['alta', 'normal'],
    normal: ['normal'],
  })

/**
 * A opção do request type que corresponde à prioridade escolhida — ou `null`.
 *
 * Percorre a aproximação na ordem declarada e, dentro de cada nível, procura entre as
 * opções **que o schema ofereceu**. Nunca inventa id.
 */
export function opcaoDePrioridade(
  opcoes: readonly OpcaoCampoRequestType[],
  prioridade: Prioridade,
): OpcaoCampoRequestType | null {
  for (const nivel of APROXIMACAO_PRIORIDADE[prioridade]) {
    const rotulos = VOCABULARIO_PRIORIDADE.filter(
      (e) => e.escrita && e.prioridade === nivel,
    ).flatMap((e) => e.rotulos)
    const achada = opcoes.find((o) => rotulos.includes(normalizarRotulo(o.rotulo)))
    if (achada) return achada
  }
  return null
}

export type ResultadoPrioridade =
  | { readonly ok: true; readonly campos: Record<string, unknown> }
  | { readonly ok: false; readonly mensagem: string }

/** A mensagem, em português e nomeando o campo pelo **rótulo** (`RNF-30`). */
export function mensagemPrioridadeSemCorrespondencia(rotulo: string): string {
  return `Este tipo de chamado exige o campo "${rotulo}", e nenhuma das prioridades oferecidas aqui (crítica, alta, normal) corresponde às opções que o Jira aceita nele. Fale com o time de tech — nada foi perdido, e o chamado abre assim que isso for ajustado.`
}

/**
 * O campo de prioridade no formato da criação — ou a recusa.
 *
 * ## As quatro saídas, e por que nenhuma é "manda do jeito que der"
 *
 * 1. **O tipo não expõe prioridade** (`campo === null`, inclusive quando o schema não
 *    pôde ser lido): `{}`. Mandar `priority` para um request type que não o publica é
 *    campo desconhecido na criação — e a criação recusa com 400.
 * 2. **Casou**: `{ [fieldId]: {id} }`, com o id **do `validValues`** e a exceção
 *    `id === rotulo` de `D-39`. O `fieldId` também vem do schema: nada aqui escreve
 *    `'priority'` (`ScC-4`).
 * 3. **Não casou e o campo é opcional**: `{}`. Fail-open — `RNF-18` manda degradar, e o
 *    chamado abre sem prioridade, que é exatamente o comportamento de hoje.
 * 4. 🚨 **Não casou e o campo é OBRIGATÓRIO**: recusa. Aqui "degradar" não existe —
 *    omitir um obrigatório é o **400 definitivo** que este módulo existe para fechar, e
 *    ele apaga o chamado sem deixar nada na tela. A recusa é o mesmo desenho de `D-38`:
 *    erro corrigível, antes de qualquer efeito, com o rótulo do campo. **Não** contraria
 *    `RNF-18` pelo mesmo motivo que `D-38` não contraria: "não bloquear" nunca resultou
 *    em chamado aberto neste caminho.
 */
export function prioridadeParaOJira(
  campo: CampoRequestType | null,
  prioridade: Prioridade,
): ResultadoPrioridade {
  if (!campo) return { ok: true, campos: {} }
  const opcao = opcaoDePrioridade(campo.opcoes, prioridade)
  if (opcao) return { ok: true, campos: { [campo.fieldId]: referenciaDaOpcao(opcao) } }
  if (!campo.obrigatorio) return { ok: true, campos: {} }
  return { ok: false, mensagem: mensagemPrioridadeSemCorrespondencia(campo.rotulo) }
}

/**
 * Junta a prioridade aos campos dinâmicos já traduzidos.
 *
 * ⚠️ A prioridade entra **por último** de propósito: ela é resolvida no servidor, a
 * partir da proposta, e não pode ser sobrescrita por um `camposDinamicos` vindo do
 * cliente. (A primeira camada já é `filtrarPeloSchema`, que só conhece os campos
 * adicionais — `priority` nunca está lá. Esta é a segunda, como em `agent/gate.ts`.)
 *
 * `null` quando não sobrou nada: é o que `payload.camposDinamicos` espera para "não há
 * campo nenhum", e um `{}` gravado no outbox mudaria o corpo persistido à toa.
 */
export function juntarCamposDaCriacao(
  traduzidos: Record<string, unknown> | null,
  prioridade: Record<string, unknown>,
): Record<string, unknown> | null {
  const juntos = { ...(traduzidos ?? {}), ...prioridade }
  return Object.keys(juntos).length > 0 ? juntos : null
}
