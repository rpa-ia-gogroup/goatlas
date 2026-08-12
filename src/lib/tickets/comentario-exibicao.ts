/**
 * Quem escreveu este comentário? — `D-40`, `RF-31`, `RF-32`, `RF-33`.
 *
 * ## O defeito que este arquivo existe para impedir
 *
 * Sob proxy total (`D-01`) **todo** comentário que o app escreve sai da conta de
 * serviço. O JSM devolve o `displayName` dessa conta, e a tela de detalhe imprimia
 * esse nome como autor. Medido na staging em 12/08/2026, no `GN-6897`:
 *
 * ```
 * JOÃO VICTOR TAVARES ESTEVES            ← nome da conta de serviço
 * **Kaique Breno** (kaique.breno@gocase.com) via goatlas:
 * Comentário de teste…
 * ```
 *
 * O texto era do Kaique; o nome em cima dele, de um colega. Duas afirmações de
 * autoria contraditórias no mesmo bloco, e a pior leitura possível é a natural:
 * *alguém escreveu em meu nome*.
 *
 * ## Por que a classificação mora AQUI, e não na tela
 *
 * O app já sabe distinguir — `ehComentarioDoSolicitante` é o mesmo predicado que o
 * SLA de `RF-46` usa para decidir se **houve** primeira resposta do time. Escrever na
 * tela uma segunda condição (comparar nome, comparar e-mail) criaria duas regras para
 * o mesmo fato, e elas divergiriam em silêncio: a tela diria "Você" sobre um
 * comentário que o SLA conta como resposta do time, ou o contrário. É o mesmo motivo
 * pelo qual `config/diagnostico.ts` **relata** o estado em vez de recalculá-lo.
 *
 * Este módulo é a **única** tradução de "corpo cru da Atlassian" para "o que a tela
 * mostra", e é puro de propósito — dá para testá-lo sem HTTP e sem banco.
 *
 * ## As três decisões que ele carrega
 *
 * 1. **`doSolicitante` vem do prefixo, nunca do autor.** Ver acima.
 * 2. **O prefixo sai do corpo exibido.** Ele existe para ser lido no **Jira nativo**
 *    (`D-13`), onde o time trabalha e onde não há linha de autor nossa. Dentro do
 *    goatlas a linha de autor já diz de quem é, então o prefixo vira repetição — e
 *    repetição em Markdown cru (`**Nome** (email) via goatlas:`), porque
 *    `TextoDoAgente` não interpreta negrito. Quem remove é `removerPrefixoAutoria`,
 *    a mesma função que `RF-48` usa: um `replace` novo aqui divergiria do de lá no
 *    dia em que o formato mudar (a spec 001 §10 diz que ele pode mudar).
 * 3. **`autorNome` continua saindo, e continua sendo o nome da CONTA.** Apagá-lo
 *    resolveria o caso da conta de serviço e estragaria o caso comum — o agente que
 *    respondeu de verdade, pelo Jira, com a conta dele. Quem decide como enunciar
 *    isso sem afirmar autoria é a tela (`Conta que registrou: …`).
 */

import { ehComentarioDoSolicitante, removerPrefixoAutoria } from '../atlassian/comentarios'
import type { ComentarioPublico } from '../atlassian/tipos'

/** Um comentário público já classificado quanto à autoria. */
export interface ComentarioExibido {
  readonly id: string
  /** O que a pessoa escreveu, **sem** o prefixo de `D-13`. */
  readonly corpo: string
  /**
   * O `displayName` da conta que registrou o comentário no Jira.
   *
   * ⚠️ **Não é uma afirmação de autoria.** Sob `D-01` esta pode ser a conta de
   * serviço, e ela hoje é a conta pessoal de um colaborador.
   */
  readonly autorNome: string
  readonly criadoEm: string
  /**
   * `true` = escrito pelo solicitante, pelo goatlas.
   *
   * ⚠️ E o solicitante é **quem está lendo**: `UNIQUE (vinculos.issue_key)` dá um
   * vínculo por chamado, e colisão com outro solicitante é recusa definitiva — logo
   * o único caminho para um comentário prefixado existir neste chamado passou pela
   * pessoa que a rota já isolou por e-mail (`RF-30`). É isso que autoriza a tela a
   * dizer "Você" sem comparar nome nem e-mail.
   */
  readonly doSolicitante: boolean
}

/** Traduz os comentários crus da Atlassian para o que a tela pode afirmar. */
export function paraExibicao(
  comentarios: readonly ComentarioPublico[],
): readonly ComentarioExibido[] {
  return comentarios.map((c) => ({
    id: c.id,
    corpo: removerPrefixoAutoria(c.corpo),
    autorNome: c.autorNome,
    criadoEm: c.criadoEm,
    doSolicitante: ehComentarioDoSolicitante(c.corpo),
  }))
}
