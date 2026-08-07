/**
 * Ações próprias — RF-48, T-211.
 *
 * ## Por que não dá para comparar autor
 *
 * O reflexo é "se o autor do comentário é a própria pessoa, não notifica". **Não
 * funciona aqui.** Sob proxy total (`D-01`) todo comentário sai da conta de serviço:
 * o comentário que a pessoa escreveu pelo app e o que o agente do time de tech
 * escreveu no Jira têm o **mesmo autor** perante a API. Comparar autor suprimiria os
 * dois, ou nenhum.
 *
 * O que distingue é o app ter registrado a ação **no instante em que a fez**. Daí a
 * impressão digital: hash do corpo normalizado, gravado na hora do `POST`, conferido
 * quando o mesmo texto voltar pelo webhook ou pelo polling.
 *
 * ⚠️ **A normalização é a parte frágil e é de propósito conservadora.** O texto não
 * volta byte a byte: o JSM converte para ADF e de volta, e no caminho colapsa espaço,
 * troca quebra de linha e às vezes reescreve marcação. Normalizar agressivamente
 * (minúsculas, só letras e dígitos) é o que faz o hash sobreviver a essa viagem. O
 * risco do outro lado é real e aceito: se um agente do time de tech responder com
 * exatamente o mesmo texto que a pessoa escreveu, o aviso é suprimido. É um caso
 * improvável e de baixo dano; o inverso — notificar cada pessoa do próprio comentário —
 * é o que faz gente desligar a notificação e nunca mais ver as que importam.
 */

import { hashConteudo } from '../agent/tools'
import { removerPrefixoAutoria } from '../atlassian/comentarios'
import type { Banco } from '../db/tipos'
import { primeiraLinha } from '../db/tipos'
import type { TipoEvento } from './tipos'

/**
 * Reduz o texto ao que sobrevive à viagem pelo ADF do JSM.
 *
 * Descarta acento, marcação, pontuação e caixa: o que resta são as letras e os
 * números em sequência, que é o que a Atlassian não reescreve.
 */
export function normalizarParaImpressao(texto: string): string {
  // ⚠️ O prefixo de autoria sai PRIMEIRO. A impressão é gravada com o texto puro que a
  // pessoa digitou e conferida com o corpo que voltou da Atlassian — que já carrega
  // `**Nome** (email) via goatlas:`. Sem remover, as duas pontas nunca casam.
  return removerPrefixoAutoria(texto)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // marcas de acentuação separadas pelo NFD
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
}

export function impressaoDigital(texto: string): string {
  return hashConteudo(normalizarParaImpressao(texto))
}

export class RepositorioAcoesProprias {
  constructor(
    private readonly db: Banco,
    private readonly agora: () => string,
    private readonly novoId: () => string,
  ) {}

  /** Chamado NO MOMENTO da ação do app — nunca depois, nunca inferido. */
  async registrar(dados: {
    issueKey: string
    atorEmail: string
    tipoEvento: TipoEvento
    conteudo: string
  }): Promise<void> {
    await this.db.exec(
      `INSERT INTO acoes_proprias (id, issue_key, ator_email, tipo_evento, impressao_digital, criado_em)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        this.novoId(),
        dados.issueKey,
        dados.atorEmail,
        dados.tipoEvento,
        impressaoDigital(dados.conteudo),
        this.agora(),
      ],
    )
  }

  /**
   * Este fato foi a própria pessoa?
   *
   * O `issue_key` está no `WHERE` junto da impressão: o mesmo texto em dois chamados
   * diferentes são dois fatos diferentes, e casar só pelo hash suprimiria o
   * comentário de um chamado por causa do outro.
   */
  async ehAcaoPropria(dados: {
    issueKey: string
    tipoEvento: TipoEvento
    conteudo: string
  }): Promise<boolean> {
    const r = await this.db.query(
      `SELECT 1 AS achou FROM acoes_proprias
        WHERE issue_key = ? AND tipo_evento = ? AND impressao_digital = ? LIMIT 1`,
      [dados.issueKey, dados.tipoEvento, impressaoDigital(dados.conteudo)],
    )
    return primeiraLinha<{ achou: number }>(r) !== null
  }
}
