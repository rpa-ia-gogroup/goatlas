/**
 * A forma do valor que a Atlassian espera para cada campo — `D-39`.
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
 * _Requirements: RF-27, RNF-17, RNF-18, RNF-30_
 */

import type { CampoRequestType, OpcaoCampoRequestType } from '../atlassian/tipos'
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
