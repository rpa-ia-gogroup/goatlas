/**
 * Os campos que carregam o solicitante — `RF-21`, `D-36`.
 *
 * ## Por que este mapa é POR REQUEST TYPE, e não uma config global
 *
 * Medido contra o Jira da Gocase em 11/08/2026, pela staging:
 *
 * | id | request type 108 | request type 70 |
 * |---|---|---|
 * | `customfield_10092` | "Cargo/Função que exercerá dentro do time" | "Em que sistema o Bug está ocorrendo?" |
 * | `customfield_10093` | "Sistema que solicita acesso" | (no 134) "Em que sistema o erro está acontecendo?" |
 *
 * 🚨 **Um id de campo não significa nada fora do request type.** A configuração
 * anterior (`campo_solicitante_id`, `Q4`) era **um id global**: aplicá-la escreveria o
 * e-mail do solicitante dentro do campo "Em que sistema o Bug está ocorrendo?" de todo
 * chamado de bug — com **HTTP 201** e nada na tela indicando o erro. Config não
 * conserta isso; config era o veículo do erro. Ver `D-36`.
 *
 * ## O mapa nunca é aplicado sozinho
 *
 * `resolverCamposDoSolicitante` é a **interseção** do mapa com o schema real do request
 * type. Um `fieldId` que o mapa conhece e que o schema não expõe **não é enviado**.
 *
 * ⚠️ Não é zelo: este mapa é um retrato de um dia. No dia em que alguém tirar o campo do
 * formulário do portal, mandá-lo assim mesmo faz a criação responder **400**, que
 * `atlassian/http.ts` classifica como **definitivo** — submissão definitiva nunca é
 * reprocessada, e o chamado da pessoa se perde (`RNF-17`). O schema já é lido nas duas
 * rotas de criação por causa de `RF-62`, então a interseção não custa uma ida a mais.
 *
 * Mesma família de `organizacao.ts`: *filtro que pode não filtrar é verificado, não
 * acreditado*. Aqui: *mapa que pode estar velho é confirmado, não acreditado*.
 *
 * ## O que este módulo NÃO faz
 *
 * Não toca o cabeçalho de autoria na descrição (`D-13`). Ele é o "cinto" do cinto e
 * suspensório de `cliente.ts`: chamado de um tipo **sem** mapa continua identificando o
 * solicitante em texto, que é o que impede o `R-03` (todo chamado chegando como "aberto
 * pelo robô") de acontecer em silêncio.
 *
 * _Requirements: RF-21, RF-62, RNF-17, RNF-25, R-03_
 */

import type { SchemaDoTipo } from './declaracao-anexo'

export type PapelDoCampo = 'nome_solicitante' | 'email_solicitante'

/**
 * `requestTypeId` → (`fieldId` → papel).
 *
 * ⚠️ **Só entra aqui campo cujo papel foi CONFERIDO no schema daquele tipo.** Um id
 * copiado da tela de campos do Jira (que mostra o nome canônico, não o rótulo do
 * formulário) é exatamente o erro que `D-36` descreve.
 *
 * Hoje só o tipo **108** ("Solicitar acesso/permissão a um Sistema") expõe o par.
 * Os outros 14 tipos do `GN` não têm campo de solicitante — e é por isso que o
 * cabeçalho de `D-13` continua sendo a garantia, não este mapa.
 */
export const MAPA_CAMPOS_DO_SOLICITANTE: Readonly<
  Record<string, Readonly<Record<string, PapelDoCampo>>>
> = {
  '108': {
    customfield_10089: 'nome_solicitante',
    customfield_10091: 'email_solicitante',
  },
}

export interface IdentidadeDoSolicitante {
  readonly nome: string
  readonly email: string
}

/**
 * Os campos a enviar para este request type, já cruzados com o schema.
 *
 * Devolve `{}` — nunca lança — em todos os caminhos de dúvida:
 *
 * - tipo sem mapa (o caso comum: 14 dos 15 tipos do `GN`);
 * - **schema desconhecido** (`RF-62`/`D-27`: fail-open no chamado, fail-closed no campo —
 *   não dá para afirmar que o campo existe, então não se manda);
 * - campo mapeado que o schema não expõe;
 * - valor vazio na identidade (mandar `""` num campo obrigatório é pior que não mandar:
 *   o Jira aceita e o chamado nasce com o campo em branco, parecendo respondido).
 */
export function resolverCamposDoSolicitante(
  tipoChamadoId: string,
  schema: SchemaDoTipo,
  identidade: IdentidadeDoSolicitante,
): Record<string, string> {
  const mapa = MAPA_CAMPOS_DO_SOLICITANTE[tipoChamadoId]
  if (!mapa) return {}
  if (!schema.conhecido) return {}

  const expostos = new Set(schema.campos.map((c) => c.fieldId))
  const saida: Record<string, string> = {}
  for (const [fieldId, papel] of Object.entries(mapa)) {
    if (!expostos.has(fieldId)) continue
    const valor = (papel === 'nome_solicitante' ? identidade.nome : identidade.email).trim()
    if (valor.length > 0) saida[fieldId] = valor
  }
  return saida
}

/** Os `fieldId` que este tipo preenche sozinho — para a tela marcar a origem (`FR-12`). */
export function camposPreenchidosPeloApp(tipoChamadoId: string): readonly string[] {
  return Object.keys(MAPA_CAMPOS_DO_SOLICITANTE[tipoChamadoId] ?? {})
}
