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

import type { ComentarioPublico } from './tipos'

/** Monta a query string dos comentários. Os DOIS parâmetros, sempre explícitos. */
export function montarQueryComentarios(): string {
  return '?public=true&internal=false'
}

interface ComentarioApi {
  readonly id?: unknown
  readonly public?: unknown
  readonly body?: unknown
  readonly created?: { readonly iso8601?: unknown }
  readonly author?: { readonly displayName?: unknown }
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
  return `**${autorNome}** (${autorEmail}) via goatlas:\n\n${corpo}`
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
  return PREFIXO_GOATLAS.test(corpo.trimStart())
}

const PREFIXO_GOATLAS = /^\*\*.+?\*\* \(.+?@.+?\) via goatlas:\s*/

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
  return corpo.trimStart().replace(PREFIXO_GOATLAS, '')
}
