/**
 * Cache histórico do inventário de assentos (RF-51, RF-52, T-124).
 *
 * A Organizations API é lenta demais para consulta interativa, e o histórico é o
 * que torna o assento ocioso um dado que se **acompanha** ao longo do tempo (O2,
 * O7), não um retrato único. Por isso cada coleta INSERE, nunca faz `UPDATE` — e a
 * leitura pega só a coleta mais recente pelo `MAX(coletado_em)`.
 */

import type { Banco } from '../db/tipos'
import { linhasComoObjetos } from '../db/tipos'
import type { UltimoAcesso, UsuarioOrganizacao } from '../atlassian/organizacao'

export interface ItemInventario {
  readonly accountId: string
  readonly email: string
  readonly nome: string
  readonly produto: string
  /** `null` = a API nunca viu esta pessoa usar este produto. */
  readonly ultimoAcessoEm: string | null
}

export interface SnapshotInventario {
  /** `null` = nenhuma coleta ainda rodou. */
  readonly coletadoEm: string | null
  readonly itens: readonly ItemInventario[]
}

export interface ColetaEntrada {
  readonly usuario: UsuarioOrganizacao
  /** `null` quando `ultimoAcesso` falhou para esta conta (RNF-18: a coleta segue
   * para as outras contas em vez de abortar tudo). */
  readonly ultimoAcesso: UltimoAcesso | null
}

export class RepositorioInventario {
  constructor(
    private readonly db: Banco,
    private readonly novoId: () => string,
  ) {}

  /** Uma linha por (usuário × produto atribuído), carimbada com o instante desta coleta. */
  async registrarColeta(
    entradas: readonly ColetaEntrada[],
    coletadoEm: string,
  ): Promise<{ readonly registros: number }> {
    let registros = 0
    for (const { usuario, ultimoAcesso } of entradas) {
      const porProduto = new Map(
        (ultimoAcesso?.porProduto ?? []).map((p) => [p.produto, p.ultimoAcessoEm] as const),
      )
      /**
       * 🚨 **Os produtos vêm da UNIÃO das duas fontes, e hoje só a segunda entrega.**
       *
       * Iterar apenas `usuario.produtos` fazia a coleta gravar **zero linha**: medido em
       * 07/08/2026, `POST /users/search` **não devolve produto atribuído** (e
       * `expand:["PRODUCT_ACCESS"]` responde 400). Quem sabe o produto é
       * `last-active-dates`, que o cron já chama por conta.
       *
       * A união, e não a troca, é de propósito: se um dia a listagem passar a trazer
       * produto, uma conta cujo `ultimoAcesso` falhou (`null`, `RNF-18`) continua entrando
       * no inventário em vez de desaparecer dele — e conta que desaparece do inventário é
       * assento que ninguém revisa.
       */
      const chaves = new Set([
        ...usuario.produtos.map((p) => p.chave),
        ...porProduto.keys(),
      ])
      const produtos = [...chaves].map(
        (chave) => usuario.produtos.find((p) => p.chave === chave) ?? { chave, nome: chave },
      )
      for (const produto of produtos) {
        await this.db.exec(
          `INSERT INTO inventario_assentos
             (id, account_id, email, nome, produto, ultimo_acesso_em, coletado_em)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            this.novoId(),
            usuario.accountId,
            usuario.email,
            usuario.nome,
            produto.chave,
            porProduto.get(produto.chave) ?? null,
            coletadoEm,
          ],
        )
        registros += 1
      }
    }
    return { registros }
  }

  /** A coleta mais recente — é o que a tela e o cálculo de custo/ocioso leem. */
  async obterMaisRecente(): Promise<SnapshotInventario> {
    const maisRecente = await this.db.query(
      'SELECT MAX(coletado_em) AS coletado_em FROM inventario_assentos',
      [],
    )
    const [linha] = linhasComoObjetos<{ coletado_em: string | null }>(maisRecente)
    const coletadoEm = linha?.coletado_em ?? null
    if (!coletadoEm) return { coletadoEm: null, itens: [] }

    const r = await this.db.query(
      `SELECT account_id, email, nome, produto, ultimo_acesso_em
         FROM inventario_assentos WHERE coletado_em = ?
         ORDER BY email, produto`,
      [coletadoEm],
    )
    const itens = linhasComoObjetos<{
      account_id: string
      email: string
      nome: string
      produto: string
      ultimo_acesso_em: string | null
    }>(r).map(
      (l): ItemInventario => ({
        accountId: l.account_id,
        email: l.email,
        nome: l.nome,
        produto: l.produto,
        ultimoAcessoEm: l.ultimo_acesso_em,
      }),
    )
    return { coletadoEm, itens }
  }
}
