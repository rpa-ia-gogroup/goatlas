/**
 * O ajuste de campo pedido em texto — do **rótulo** ao `fieldId`, e as duas recusas (`RF-71`).
 *
 * ## Por que rótulo, e não `fieldId`
 *
 * O modelo precisa saber quais campos existem para poder corrigi-los ("na verdade é o Chaplin,
 * não o Factory"). Mandar id interno no prompt viola `RNF-30` — e, antes disso, `D-36` mediu que
 * um id de campo **não significa nada** fora do request type: `customfield_10092` é
 * "Cargo/Função que exercerá dentro do time" no tipo 108 e "Em que sistema o Bug está
 * ocorrendo?" no 70. O rótulo é o texto que a pessoa já lê na tela; a volta é traduzida aqui,
 * contra o schema **daquele** assunto.
 *
 * ## As duas recusas, e por que elas são DITAS
 *
 * `ScC-6` proíbe qualquer ajuste por texto que produza criação recusada — os dois caminhos que
 * `D-38` (obrigatório faltando) e `D-39` (opção inexistente) fecharam continuam fechados. Então:
 * campo que o assunto não tem e valor fora das opções **não são gravados**. E a recusa vai à
 * tela, junto do cartão: silêncio faria a pessoa achar que o pedido pegou, e descobrir depois de
 * o chamado existir.
 *
 * ⚠️ **A recusa fala por rótulo** (`RNF-30`), como em `D-38`/`D-48`. Id de opção e `fieldId` não
 * saem daqui.
 *
 * ⚠️ **Fail-open quando não há schema** (`D-27`): sem os campos daquele assunto não há como
 * decidir se o pedido cabe, e recusar tudo com aviso encheria a tela de mensagem sobre uma
 * indisponibilidade que não é da pessoa. Zero campos ajustados, zero recusas ditas — o cartão
 * volta com o que tinha, que é exatamente o que `RNF-18` pede.
 *
 * _Requirements: RF-71, FR-11, FR-13, FR-14, FR-16, ScC-6, RNF-30_
 */

import type { CampoRequestType } from '../atlassian/tipos'
import type { CampoParaExtracao } from '../ia/tipos'

export type MotivoRecusaDeAjuste = 'campo_inexistente' | 'opcao_inexistente'

export interface RecusaDeAjuste {
  /** O rótulo **como a pessoa/modelo o nomeou** — é o que faz a frase da tela reconhecível. */
  readonly rotulo: string
  readonly motivo: MotivoRecusaDeAjuste
  /** Rótulos válidos, só em `opcao_inexistente`. */
  readonly opcoes?: readonly string[]
}

export interface AjusteDeCampos {
  /** Pronto para o merge da tela e para a base da IA: `fieldId` → valor. */
  readonly valores: Readonly<Record<string, string>>
  readonly recusas: readonly RecusaDeAjuste[]
}

/**
 * Normaliza para casar rótulo e opção: minúsculas, sem acento, sem espaço nas pontas.
 *
 * ⚠️ Casar **exato-exato** faria "producao" não achar "Produção" — e a pessoa escreve sem acento
 * o tempo todo (é o mesmo fato que sustenta o detector de idioma conservador em
 * `motivo-da-prioridade.ts`). Normalizar aqui é tolerância na **entrada**; o que viaja para o
 * Jira continua sendo o **id** do schema, nunca este texto (`D-39`).
 */
function chave(texto: string): string {
  return texto
    .trim()
    .toLowerCase()
    .normalize('NFD')
    // Faixa dos diacríticos combinantes, escrita em escapes: o intervalo literal é invisível
    // no editor e uma reformatação acidental o transformaria em outro caractere.
    .replace(/[̀-ͯ]/g, '')
}

/**
 * Campos que a pessoa pode pedir para ajustar por texto.
 *
 * ⚠️ **O campo de anexo fica fora** — `RN-11` trava *responder*, nunca *anexar*, e um "ajuste"
 * de anexo por texto não tem significado: quem anexa é o clipe da conversa (`D-59`). Deixá-lo na
 * lista faria o modelo achar que pode preencher um nome de arquivo ali.
 */
function ajustavel(campo: CampoRequestType): boolean {
  return campo.tipo !== 'anexo'
}

/**
 * O que o **modelo** vê do formulário do assunto vigente — `FR-11`.
 *
 * Sem `fieldId`, por construção: o tipo de retorno não tem o campo, então não há por onde o id
 * vazar ao prompt (`RNF-30`).
 */
export function camposParaExtracao(
  schema: readonly CampoRequestType[],
): readonly CampoParaExtracao[] {
  return schema.filter(ajustavel).map((c) => ({
    rotulo: c.rotulo,
    tipo: c.tipo,
    opcoes: c.opcoes.map((o) => o.rotulo),
  }))
}

/**
 * Traduz os pedidos por rótulo em valores por `fieldId`, recusando o que não casa.
 *
 * ⚠️ Um pedido recusado **não derruba os outros**: cada item é independente, e perder o ajuste
 * válido por causa do inválido puniria a pessoa por ter pedido duas coisas na mesma frase.
 */
export function ajustarCamposPorRotulo(
  pedidos: readonly { readonly rotulo: string; readonly valor: string }[],
  schema: readonly CampoRequestType[],
): AjusteDeCampos {
  // Fail-open declarado (`D-27`): sem schema não há o que decidir, e ninguém é avisado de uma
  // indisponibilidade que não muda nada para ela.
  if (schema.length === 0) return { valores: {}, recusas: [] }

  const porRotulo = new Map<string, CampoRequestType>()
  for (const campo of schema.filter(ajustavel)) porRotulo.set(chave(campo.rotulo), campo)

  const valores: Record<string, string> = {}
  const recusas: RecusaDeAjuste[] = []

  for (const pedido of pedidos) {
    const campo = porRotulo.get(chave(pedido.rotulo))
    if (!campo) {
      recusas.push({ rotulo: pedido.rotulo.trim(), motivo: 'campo_inexistente' })
      continue
    }
    if (campo.opcoes.length > 0) {
      const opcao = campo.opcoes.find((o) => chave(o.rotulo) === chave(pedido.valor))
      if (!opcao) {
        recusas.push({
          rotulo: campo.rotulo,
          motivo: 'opcao_inexistente',
          opcoes: campo.opcoes.map((o) => o.rotulo),
        })
        continue
      }
      // ⚠️ O que viaja é o **id do schema** (`D-39`/`D-48`), nunca o rótulo: renomear a opção no
      // Jira não pode virar 400 definitivo. A forma final (`{id}` × `[{id}]`) continua sendo
      // decidida por `valores-de-campo.ts`, na criação — uma regra, um lugar.
      valores[campo.fieldId] = opcao.id
      continue
    }
    valores[campo.fieldId] = pedido.valor.trim()
  }

  return { valores, recusas }
}

/**
 * A frase da recusa, em português, para a tela não a reinventar.
 *
 * ⚠️ Ela nomeia o campo pelo **rótulo** e, em `opcao_inexistente`, lista as opções — que é a
 * informação que permite à pessoa pedir de novo acertando. Recusa sem as opções manda ela
 * adivinhar.
 */
export function frasesDeRecusa(recusas: readonly RecusaDeAjuste[]): readonly string[] {
  return recusas.map((r) =>
    r.motivo === 'campo_inexistente'
      ? `Não registrei “${r.rotulo}”: este assunto não tem esse campo.`
      : `Não registrei “${r.rotulo}”: as opções são ${(r.opcoes ?? []).join(', ')}.`,
  )
}
