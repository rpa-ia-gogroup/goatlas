/**
 * O schema do request type **como a Atlassian o entrega** — normalizado campo a
 * campo, para diagnóstico de admin.
 *
 * ## Por que existe um segundo leitor do mesmo endpoint
 *
 * `camposAdicionais` (em `cliente.ts`) responde a uma pergunta de produto: *"o que o
 * formulário de `RF-27` precisa desenhar além do que `D-04` já tem fixo?"*. Para
 * responder isso ele **descarta** `summary`, `description` e `priority` — os três já
 * cobertos pelo formulário fixo — e depois traduz o resto para o vocabulário da tela
 * (`texto`/`selecao`/`anexo`).
 *
 * As duas operações são certas para o produto e formam um **ponto cego** para
 * diagnóstico: `GET /api/tipos-chamado/:id/campos` nunca mostra `priority`, exista ele
 * ou não no formulário do Jira. Qualquer conclusão sobre prioridade tirada daquela rota
 * é inválida por construção — não porque o dado esteja errado, mas porque a pergunta
 * que ela responde é outra. E foi assim que se concluiu, em 12/08/2026, que os tipos do
 * `GN` "não têm prioridade": a rota consultada não tinha como dizer.
 *
 * Este módulo não interpreta nada. Ele só **preserva**, com nome e tipo declarados, o
 * que o outro caminho joga fora de propósito.
 *
 * ## Por que NÃO é repassar o JSON cru
 *
 * Repassar `dados.requestTypeFields` inteiro seria a rota mais curta e a que envelhece
 * pior: a resposta passaria a carregar qualquer campo novo que a Atlassian acrescente,
 * sem ninguém decidir — é assim que um oráculo cresce. A lista abaixo é fechada, e
 * campo novo só aparece na resposta quando alguém o escrever aqui.
 *
 * ⚠️ Nada aqui vira decisão de produto. Se um dia a prioridade passar a ser enviada de
 * verdade, quem decide *como* é `montarCamposSolicitante` + `tickets/`, com teste — este
 * módulo continua sendo o microscópio, nunca a política.
 *
 * _Requirements: RF-16, RF-27, RNF-25, RNF-30_
 */

/**
 * Quantas opções de um campo de seleção são listadas antes de virar só contagem.
 *
 * A contagem sempre sai; a lista é o extra. O teto existe porque campo de seleção com
 * centenas de valores (lista de sistemas, de países, de produtos) transformaria a
 * resposta de diagnóstico num dump — e ninguém lê um dump para responder "existe campo
 * de prioridade?". Vinte cobre com folga o caso que interessa: prioridade tem cinco.
 */
export const MAX_OPCOES_LISTADAS = 20

export interface OpcaoDoSchema {
  readonly id: string
  readonly rotulo: string
}

/**
 * As opções do campo, com a contagem SEMPRE presente e a lista opcional.
 *
 * ⚠️ `omitidas > 0` com `opcoes: []` não é o mesmo que `total: 0`: o primeiro é "tem
 * muitas, não listei", o segundo é "não tem nenhuma". Uma resposta que só trouxesse a
 * lista truncada apagaria a diferença, e um campo com 300 opções pareceria ter 20.
 */
export interface OpcoesDoSchema {
  readonly total: number
  readonly opcoes: readonly OpcaoDoSchema[]
  readonly omitidas: number
}

/**
 * Um campo do request type, com os nomes **da Atlassian**, não os nossos.
 *
 * De propósito: esta resposta existe para ser comparada com a documentação do JSM e
 * com o que o formulário do Jira mostra. Traduzir `required` para `obrigatorio` aqui
 * obrigaria quem lê a fazer a tradução de volta na cabeça — e é justamente a tradução
 * que introduziu o ponto cego que este módulo existe para remover.
 */
export interface CampoDoSchema {
  readonly fieldId: string
  readonly name: string
  readonly required: boolean
  readonly jiraSchema: {
    readonly type: string | null
    readonly system: string | null
    readonly custom: string | null
    readonly items: string | null
  }
  readonly validValues: OpcoesDoSchema
}

/** O que o endpoint `/field` do JSM devolve, na forma em que chega. */
interface CampoBruto {
  fieldId?: unknown
  name?: unknown
  required?: unknown
  jiraSchema?: { type?: unknown; system?: unknown; custom?: unknown; items?: unknown }
  validValues?: unknown
}

/** `string` quando é string não vazia; `null` em qualquer outro caso. */
function texto(valor: unknown): string | null {
  return typeof valor === 'string' && valor.length > 0 ? valor : null
}

/**
 * Normaliza o schema bruto para a forma acima — sem filtrar campo nenhum.
 *
 * ⚠️ **A ausência de filtro É o comportamento.** `camposAdicionais` descarta os campos de
 * sistema porque o formulário já os tem; aqui, descartar qualquer coisa reintroduziria o
 * ponto cego dentro do próprio instrumento de diagnóstico. Só campo **sem `fieldId`**
 * sai, porque um campo que não se sabe nomear não sustenta conclusão nenhuma.
 */
export function normalizarSchema(brutos: unknown): readonly CampoDoSchema[] {
  if (!Array.isArray(brutos)) return []
  const resultado: CampoDoSchema[] = []
  for (const item of brutos as CampoBruto[]) {
    const fieldId = texto(item?.fieldId)
    if (fieldId === null) continue

    const valores = Array.isArray(item?.validValues) ? item.validValues : []
    const listadas = valores.slice(0, MAX_OPCOES_LISTADAS).map((v) => {
      const bruto = (v ?? {}) as { id?: unknown; value?: unknown; label?: unknown }
      return {
        id: String(bruto.id ?? bruto.value ?? ''),
        rotulo: String(bruto.label ?? bruto.value ?? bruto.id ?? ''),
      }
    })

    resultado.push({
      fieldId,
      name: typeof item?.name === 'string' ? item.name : fieldId,
      required: Boolean(item?.required),
      jiraSchema: {
        type: texto(item?.jiraSchema?.type),
        system: texto(item?.jiraSchema?.system),
        custom: texto(item?.jiraSchema?.custom),
        items: texto(item?.jiraSchema?.items),
      },
      validValues: {
        total: valores.length,
        opcoes: listadas,
        omitidas: valores.length - listadas.length,
      },
    })
  }
  return resultado
}

/**
 * O request type expõe campo de PRIORIDADE? — a pergunta que motivou o módulo.
 *
 * 🚨 **Quem responde é `jiraSchema.system`, nunca o `fieldId`.** É a mesma regra de
 * `ScC-4` para anexo, e pelo mesmo motivo: comparar o id do campo com um literal
 * funcionaria no site da Gocase e pararia de funcionar em outro **sem quebrar nada** — a
 * resposta viraria "não tem prioridade" em silêncio, que é exatamente o erro de
 * diagnóstico que este arquivo existe para evitar. (A varredura estrutural de
 * `scc4-nenhum-fieldid-de-anexo.test.ts` cobra isso, e cobra também deste arquivo.)
 *
 * ⚠️ E `false` aqui significa **"não está no formulário do portal"**, não "o Jira não tem
 * prioridade nessa issue". O endpoint `/field` lista o formulário do request type; o
 * campo pode existir na issue e simplesmente não estar publicado. As duas leituras
 * pedem trabalhos opostos (publicar o campo × mexer no nosso código), e confundi-las é
 * o mesmo erro de `area_indisponivel` × `area_nao_encontrada`.
 */
export function temCampoDePrioridade(campos: readonly CampoDoSchema[]): boolean {
  return campos.some((c) => c.jiraSchema.system === 'priority')
}
