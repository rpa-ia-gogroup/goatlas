/**
 * Quais assuntos esta instalação oferece, e como eles se chamam — `RF-28`, `D-53`, `D-68`.
 *
 * ## O bug que este módulo existe para não acontecer
 *
 * Três lugares precisam da **mesma** resposta para "que tipos dá para abrir aqui?":
 * a rota que monta o formulário (`GET /api/tipos-chamado`), o cartão que nomeia o assunto
 * antes de confirmar (`D-53`) e a **extração da proposta**, que é quem escolhe o tipo.
 *
 * Os dois primeiros já aplicavam a regra completa — allowlist de `RF-28` **mais** o filtro
 * pelo service desk configurado. O terceiro recebia só os ids
 * (`config.tipos_chamado_permitidos.map((id) => ({ id, nome: id }))`), então o prompt de
 * extração listava `- 92: 92` e o modelo escolhia **às cegas entre números**. Medido em
 * 13/08/2026: um relato de notebook desligando sozinho virou o tipo `92`, *"Problema com
 * Nota Fiscal específica ou grupo de Notas"* — nome que só o cartão resolvia, e só depois
 * de a escolha já estar feita.
 *
 * ⚠️ **O nome não é enfeite: é o único dado que distingue um tipo do outro.** Sem ele a
 * escolha do modelo não tem como ser melhor que um sorteio, e o tipo decide **qual fila**
 * recebe o chamado.
 *
 * ## Por que o filtro de desk vem junto
 *
 * `listarTiposChamado` varre **todos** os service desks do site, e a allowlist é lista de
 * ids: um id de outro desk passa por ela e por `validarProposta` para **falhar só na
 * criação**, onde o `serviceDeskId` vem fixo da config. Oferecer ao modelo um tipo que a
 * criação recusa é o caminho mais curto para o chamado da pessoa se perder — e faria a
 * extração e o cartão discordarem, com o cartão dizendo "assunto não identificado" sobre
 * um assunto que o próprio servidor escolheu.
 *
 * Sem desk configurado a lista é **vazia**, coerente com a rota de criação, que já recusa
 * nesse estado (negação por padrão, `RNF-07`).
 *
 * _Requirements: RF-18, RF-28, RNF-07, RNF-30_
 */

import type { TipoNomeavel } from './nome-do-tipo'

/** O mínimo do cliente Atlassian de que este módulo precisa. */
export interface FonteDeTipos {
  listarTiposChamado(): Promise<readonly { id: string; serviceDeskId: string; nome: string }[]>
}

/** O mínimo da config de que este módulo precisa. */
export interface EscopoDeTipos {
  readonly tipos_chamado_permitidos: readonly string[]
  readonly service_desk_id: string | null
}

/**
 * Os tipos que esta instalação de fato oferece, com nome.
 *
 * ⚠️ **Lança** o que a Atlassian lançar: quem chama decide o que fazer com a
 * indisponibilidade, e as três decisões são diferentes (a rota sobe o erro, o cartão cai
 * para `null`, a extração não propõe). Engolir aqui daria a todos a pior delas.
 */
export async function tiposOferecidos(
  atlassian: FonteDeTipos,
  valores: EscopoDeTipos,
): Promise<readonly TipoNomeavel[]> {
  const desk = valores.service_desk_id
  if (desk === null) return []
  const permitidos = new Set(valores.tipos_chamado_permitidos)
  if (permitidos.size === 0) return []
  const todos = await atlassian.listarTiposChamado()
  return todos.filter((t) => t.serviceDeskId === desk && permitidos.has(t.id))
}
