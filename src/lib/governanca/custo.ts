/**
 * Custo e assento ocioso — funções PURAS (RF-53).
 *
 * `RF-53` precisa do custo unitário real por produto, e isso é **Q8**: enquanto o
 * João/financeiro não responder, o console mostra **contagem** e marca o valor
 * como não configurado. Um número inventado aqui é PIOR que nenhum — é o número
 * com que alguém decide rebaixar o acesso de um colega.
 *
 * ⚠️ `custoConfigurado` só fica `true` quando TODOS os produtos do inventário têm
 * preço na config. Somar só os produtos precificados e chamar o resultado de
 * "total" seria um número tecnicamente real e ainda assim enganoso — sub-conta sem
 * avisar que sub-contou.
 */

import type { ItemInventario } from './inventario'

export interface CustoPorProduto {
  readonly produto: string
  readonly usuarios: number
  readonly ociosos: number
  /** `null` = sem preço configurado para este produto (Q8). */
  readonly custoMensalUsd: number | null
}

export interface ResumoCusto {
  readonly porProduto: readonly CustoPorProduto[]
  /** `null` enquanto QUALQUER produto do inventário não tiver preço configurado. */
  readonly totalMensalUsd: number | null
  /** `false` = Q8 em aberto (ou parcialmente aberto) — a tela nunca mostra dinheiro. */
  readonly custoConfigurado: boolean
  readonly ocioso: {
    readonly usuarios: number
    readonly custoMensalUsd: number | null
  }
}

/**
 * Um assento é ocioso quando não há registro de acesso, ou o último acesso já
 * passou de `ociosoDesdeDias`. **Nunca visto** é o caso mais ocioso que existe —
 * não um erro de leitura a ser ignorado.
 */
export function assentoOcioso(
  ultimoAcessoEm: string | null,
  ociosoDesdeDias: number,
  agoraMs: number,
): boolean {
  if (ultimoAcessoEm === null) return true
  const diasDesdeUltimoAcesso = (agoraMs - Date.parse(ultimoAcessoEm)) / (1000 * 60 * 60 * 24)
  return diasDesdeUltimoAcesso >= ociosoDesdeDias
}

export function calcularCusto(
  itens: readonly ItemInventario[],
  precoMensalPorProduto: Readonly<Record<string, number>>,
  ociosoDesdeDias: number,
  agoraMs: number,
): ResumoCusto {
  const porProdutoMap = new Map<string, { usuarios: number; ociosos: number }>()
  for (const item of itens) {
    const atual = porProdutoMap.get(item.produto) ?? { usuarios: 0, ociosos: 0 }
    atual.usuarios += 1
    if (assentoOcioso(item.ultimoAcessoEm, ociosoDesdeDias, agoraMs)) atual.ociosos += 1
    porProdutoMap.set(item.produto, atual)
  }

  const porProduto: CustoPorProduto[] = []
  let ociososUsuarios = 0
  let todosPrecificados = porProdutoMap.size > 0
  let totalMensalUsd = 0
  let ociosoCustoMensalUsd = 0

  for (const [produto, { usuarios, ociosos }] of porProdutoMap) {
    const preco = precoMensalPorProduto[produto]
    const custoMensalUsd = preco === undefined ? null : usuarios * preco
    porProduto.push({ produto, usuarios, ociosos, custoMensalUsd })
    ociososUsuarios += ociosos
    if (preco === undefined) {
      todosPrecificados = false
    } else {
      totalMensalUsd += usuarios * preco
      ociosoCustoMensalUsd += ociosos * preco
    }
  }

  return {
    porProduto: porProduto.sort((a, b) => a.produto.localeCompare(b.produto)),
    totalMensalUsd: todosPrecificados ? totalMensalUsd : null,
    custoConfigurado: todosPrecificados,
    ocioso: {
      usuarios: ociososUsuarios,
      custoMensalUsd: todosPrecificados ? ociosoCustoMensalUsd : null,
    },
  }
}
