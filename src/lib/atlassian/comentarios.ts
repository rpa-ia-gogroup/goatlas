/**
 * A pegadinha do `internal` — RF-32, RN-05.
 *
 * ## O bug que este arquivo existe para impedir
 *
 * No JSM, `GET /rest/servicedeskapi/request/{key}/comment` tem **`public=true` E
 * `internal=true` como defaults**. Ou seja: passar só `?public=true` — o que
 * parece obviamente correto — retorna comentários públicos **e internos**. O
 * comentário interno do time de tech ("cliente insistente, vamos empurrar") iria
 * direto para a tela do colaborador, e o app pareceria funcionar perfeitamente.
 *
 * ## Duas camadas, dentro de uma função
 *
 * 1. A query manda `internal=false` **explicitamente**.
 * 2. O servidor **filtra pelo campo `public`** de cada item que voltou.
 *
 * A camada 2 parece redundante e não é: ela é a defesa contra a Atlassian mudar o
 * default, contra alguém "simplificar" a query numa refatoração, e contra o
 * parâmetro ser ignorado por qualquer motivo. O custo é um `.filter()`; o custo de
 * errar é vazar comunicação interna sobre a pessoa, para a própria pessoa.
 *
 * Estas funções são puras de propósito — dá para testá-las sem HTTP.
 */

import type { AnexoDoChamado, ComentarioPublico } from './tipos'

/**
 * Monta a query string dos comentários. Os DOIS parâmetros, sempre explícitos.
 *
 * `comAnexos` acrescenta a expansão que `RF-31` usa como **prova de publicidade** do
 * anexo (`D-45`). Ela é opcional no parâmetro porque é opcional no comportamento: se a
 * Atlassian recusar a expansão, o cliente repete a chamada sem ela — comentário é `RF-32`,
 * P0, e não pode cair junto com um enfeite de outro requisito.
 */
export function montarQueryComentarios(comAnexos = false): string {
  return `?public=true&internal=false${comAnexos ? '&expand=attachment' : ''}`
}

interface ComentarioApi {
  readonly id?: unknown
  readonly public?: unknown
  readonly body?: unknown
  readonly created?: { readonly iso8601?: unknown }
  readonly author?: { readonly displayName?: unknown }
  readonly attachment?: unknown
}

/** Um anexo como o JSM o descreve, dentro da expansão de um comentário ou da lista. */
interface AnexoApi {
  readonly filename?: unknown
  readonly mimeType?: unknown
  readonly size?: unknown
  readonly created?: { readonly iso8601?: unknown }
}

/**
 * Traduz o objeto de anexo do JSM. Campo ausente vira `null`, nunca `0` nem `''`:
 * "não sei o tamanho" e "o arquivo tem zero byte" são afirmações diferentes, e a
 * segunda é falsa.
 */
export function anexoDaApi(bruto: unknown): AnexoDoChamado | null {
  if (!bruto || typeof bruto !== 'object') return null
  const a = bruto as AnexoApi
  const nomeArquivo = typeof a.filename === 'string' ? a.filename : ''
  if (nomeArquivo === '') return null
  const tamanho = typeof a.size === 'number' && Number.isFinite(a.size) ? a.size : null
  return {
    nomeArquivo,
    tipoDeclarado: typeof a.mimeType === 'string' && a.mimeType !== '' ? a.mimeType : null,
    tamanhoBytes: tamanho,
    criadoEm: typeof a.created?.iso8601 === 'string' ? a.created.iso8601 : null,
  }
}

/**
 * A expansão `attachment` de UM comentário — `null` quando ela não veio.
 *
 * 🚨 **Ausência do campo ≠ lista vazia**, e a distinção é o requisito inteiro: sem a
 * expansão não há como provar que um anexo é público, e tratar isso como "nenhum anexo"
 * é o app afirmando o contrário do que sabe. A Atlassian devolve a expansão como um
 * *bean* paginado (`{values: []}`); aceitar também o array cru é tolerância a formato,
 * não palpite — as duas formas trazem a mesma informação.
 */
function anexosDoComentario(bruto: unknown): readonly AnexoDoChamado[] | null {
  if (Array.isArray(bruto)) {
    return bruto.map(anexoDaApi).filter((a): a is AnexoDoChamado => a !== null)
  }
  if (bruto && typeof bruto === 'object') {
    const valores = (bruto as { values?: unknown }).values
    if (Array.isArray(valores)) {
      return valores.map(anexoDaApi).filter((a): a is AnexoDoChamado => a !== null)
    }
  }
  return null
}

/**
 * Camada 2: filtra pelo campo `public` de cada comentário.
 *
 * ⚠️ Comentário **sem** o campo `public` é tratado como **interno** (descartado).
 * Fail-closed: na ausência de informação, não expor. O contrário — assumir público
 * quando o campo falta — seria vazar por omissão da API.
 */
export function filtrarPublicos(itens: readonly unknown[]): readonly ComentarioPublico[] {
  const saida: ComentarioPublico[] = []
  for (const bruto of itens) {
    if (!bruto || typeof bruto !== 'object') continue
    const c = bruto as ComentarioApi
    if (c.public !== true) continue
    saida.push({
      id: String(c.id ?? ''),
      corpo: typeof c.body === 'string' ? c.body : '',
      autorNome: typeof c.author?.displayName === 'string' ? c.author.displayName : 'Desconhecido',
      criadoEm: typeof c.created?.iso8601 === 'string' ? c.created.iso8601 : '',
      // ⚠️ `null` quando a expansão não veio — ver `anexosDoComentario`. É este `null`
      // que vira "não conseguimos confirmar os anexos" em vez de "não há anexos".
      anexos: anexosDoComentario(c.attachment),
    })
  }
  return saida
}

/**
 * Prefixo que atribui o comentário ao solicitante real — RF-33.
 *
 * Tecnicamente o comentário parte da conta de serviço (D-01, proxy total), então a
 * atribuição precisa estar no corpo para ser legível no Jira nativo, onde o time
 * de tech trabalha.
 *
 * ⚠️ O **formato** ainda é pergunta aberta na spec 001 §10: este prefixo é o
 * default assumido, e depende de alinhamento com o time de tech (liga a R-03/Q10).
 * Está isolado nesta função justamente para que mudar o formato seja mudar uma
 * linha.
 */
export function prefixarAutoria(corpo: string, autorNome: string, autorEmail: string): string {
  return `**${autorNome}** (${autorEmail}) via atlas:\n\n${corpo}`
}

/**
 * O comentário foi escrito pelo solicitante, via app?
 *
 * ⚠️ **É o par de `prefixarAutoria`, e a dependência não é óbvia.** O cálculo de SLA
 * (`notificacoes/sla.ts`) precisa saber qual comentário público é resposta **do time de
 * tech** — e sob proxy total (`D-01`) o autor perante a API é o mesmo nos dois casos.
 * O que sobra para distinguir é o prefixo que o próprio app escreveu.
 *
 * A spec 001 §10 diz que o formato do prefixo pode mudar. Se mudar aqui sem mudar lá,
 * comentário do solicitante passa a contar como primeira resposta do time e a aderência
 * ao SLA sobe sem ninguém ter respondido nada — por isso o teste de `RF-46` gera com
 * `prefixarAutoria` e lê com esta função, para que divergência quebre a suíte.
 */
export function ehComentarioDoSolicitante(corpo: string): boolean {
  return PREFIXO_ATLAS.test(corpo.trimStart())
}

/**
 * ⚠️ **Lê `atlas` E `goatlas`; escreve só `atlas`.** O app chamou-se `goatlas` até
 * 19/08/2026, e o prefixo antigo está gravado dentro de **todo comentário que já
 * existe no Jira** — não há como reescrevê-los. Regex só com a forma nova faria cada
 * comentário antigo do solicitante deixar de ser reconhecido: pelo SLA de `RF-46` ele
 * passaria a contar como **primeira resposta do time** (aderência inflada, alerta que
 * nunca dispara — o defeito de `D-56`), e na tela voltaria a aparecer assinado pela
 * conta de serviço (`D-43`). O `(?:go)?` é o que impede as duas coisas.
 *
 * Mesma forma de `linhasComoObjetos`: aceitar as duas leituras, produzir uma escrita.
 */
const PREFIXO_ATLAS = /^\*\*.+?\*\* \(.+?@.+?\) via (?:go)?atlas:\s*/

/**
 * Remove o prefixo de autoria, deixando só o que a pessoa escreveu.
 *
 * ⚠️ Existe por causa da supressão de ação própria (`RF-48`, `notificacoes/acoes.ts`). A
 * impressão digital é gravada quando a pessoa **envia** o comentário — texto puro — e
 * conferida quando o comentário **volta** da Atlassian, já com o prefixo que
 * `prefixarAutoria` acrescentou. Sem tirar o prefixo antes de normalizar, as duas pontas
 * geram hashes diferentes, a supressão nunca casa, e cada pessoa é notificada do próprio
 * comentário — o bug que faz gente desligar a notificação e nunca mais ver as que
 * importam.
 *
 * Corpo sem prefixo volta inalterado: comentário do time de tech não tem o que remover.
 */
export function removerPrefixoAutoria(corpo: string): string {
  return corpo.trimStart().replace(PREFIXO_ATLAS, '')
}
