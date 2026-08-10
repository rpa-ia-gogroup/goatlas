/**
 * A declaração de anexo — `RF-62`, `RN-11`.
 *
 * ## Duas coisas que parecem a mesma e não são
 *
 * - **Responder** é obrigatório: é o que trava a criação.
 * - **Anexar** nunca é. Quem diz "tenho" e desiste abre o chamado igual (`SC-03`).
 *
 * Confundir as duas transformaria a pergunta em exigência de arquivo, que é a
 * parede que a spec §1 recusa explicitamente.
 *
 * ## Funções puras, e isso é a metade que importa
 *
 * A regra ("quando a pergunta existe" e "o que conta como resposta") mora aqui, sem
 * requisição, sem banco e sem Atlassian. É o mesmo desenho de `agent/gate.ts`: regra
 * que se testa sem montar cenário continua testada quando a rota mudar de forma.
 *
 * ## ⚠️ Isto é fail-OPEN, e é um desvio consciente do padrão do projeto
 *
 * Em todo o resto do goatlas, ausência de informação nega (`CLAUDE.md`). Aqui,
 * schema que **não pôde ser lido** faz a pergunta não existir e o chamado abrir.
 * Registrado em `plan.md` §9, e a razão é a natureza do requisito:
 *
 * `RF-62` é **qualidade de produto, não trava de segurança**. Quem "burla" só
 * consegue abrir o **próprio** chamado sem responder uma pergunta — não há dado de
 * terceiro, não há exposição, não há escrita indevida. O que se perde é a evidência
 * dele mesmo. Fail-closed aqui significaria não abrir chamado durante uma
 * indisponibilidade de **leitura de schema**, que é exatamente a parede que `RNF-18`
 * proíbe — e trocar "chamado sem print" por "chamado nenhum" é péssimo negócio.
 *
 * A distinção que sustenta o desvio: uma trava de segurança fail-open convida à
 * burla (derrubar a chamada de schema viraria o caminho). Esta não tem prêmio.
 *
 * _Requirements: RF-62, RN-11, RF-27, RNF-18_
 */

import type { CampoRequestType } from '../atlassian/tipos'

/**
 * O schema do request type, com a incerteza explícita no tipo.
 *
 * ⚠️ `{ conhecido: false }` **não** é `{ conhecido: true, campos: [] }`. "O tipo não
 * tem campo de anexo" e "não deu para saber quais campos o tipo tem" levam à mesma
 * tela e a registros de auditoria diferentes; um `readonly campos: []` para os dois
 * apagaria a distinção no único lugar onde ela é recuperável.
 */
export type SchemaDoTipo =
  | { readonly conhecido: true; readonly campos: readonly CampoRequestType[] }
  | { readonly conhecido: false }

/**
 * O request type aceita arquivo?
 *
 * Pergunta respondida pelo **tipo do campo**, nunca pelo `fieldId`. O id do campo de
 * anexo é dado da instalação (`RNF-25`, `ScC-4`): compará-lo com uma constante aqui
 * funcionaria no site da Gocase e silenciosamente pararia de funcionar em qualquer
 * outro — e `tipoAceitaAnexo` passaria a devolver `false` sem nada na tela.
 */
export function tipoAceitaAnexo(campos: readonly CampoRequestType[]): boolean {
  return campos.some((c) => c.tipo === 'anexo')
}

/**
 * A pergunta de `RF-62` existe nesta criação?
 *
 * Só quando o schema é **conhecido E expõe** anexo (`plan.md` §6). As duas metades
 * têm teste próprio, porque errar cada uma dá um bug diferente: sem a primeira,
 * indisponibilidade vira parede (`SC-05b`); sem a segunda, tipo que não aceita
 * arquivo passa a pedir declaração para nada (`SC-05`).
 */
export function exigeDeclaracaoDeAnexo(schema: SchemaDoTipo): boolean {
  return schema.conhecido && tipoAceitaAnexo(schema.campos)
}

export type ResultadoDeclaracao =
  | { readonly ok: true; readonly declarouAnexo: boolean | null }
  | { readonly ok: false; readonly mensagem: string }

/**
 * ⚠️ A copy da opção negativa é parte do requisito, não enfeite.
 *
 * "Pular" sugeriria que anexar era o dever e que a pessoa está deixando de fazer
 * algo. Quem legitimamente não tem print precisa de uma saída que não pareça
 * desistência — senão a resposta honesta ("não tenho") vira a resposta que ninguém
 * escolhe, e o dado que a pergunta produz deixa de valer.
 */
export const MENSAGEM_DECLARACAO_AUSENTE =
  'Antes de abrir o chamado, responda se você tem algo para anexar — print, planilha ou log ajudam a primeira resposta a ser útil. Se não tiver, escolha "não tenho material para anexar" e o chamado abre do mesmo jeito.'

/**
 * O que o cliente mandou conta como resposta?
 *
 * Regras, em ordem:
 *
 * 1. **Pergunta que não existe não tem resposta.** `exigida === false` devolve
 *    `null` sempre — inclusive se o cliente mandar um booleano. Gravar `false` ali
 *    seria afirmar que alguém disse "não tenho" quando ninguém foi perguntado, e é
 *    esse `null` que separa "respondeu que não" de "não respondeu" no banco.
 * 2. **Só booleano é resposta.** `'sim'`, `1` e `'true'` são entrada malformada, e
 *    entrada malformada é **ausência** — não "respondeu que não". Aceitar
 *    truthy/falsy transformaria `declarouAnexo: 'não'` (string) em `true`.
 */
export function validarDeclaracao(bruto: unknown, exigida: boolean): ResultadoDeclaracao {
  if (!exigida) return { ok: true, declarouAnexo: null }
  if (typeof bruto !== 'boolean') return { ok: false, mensagem: MENSAGEM_DECLARACAO_AUSENTE }
  return { ok: true, declarouAnexo: bruto }
}
