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
    /**
     * 🚨 **É um TETO da economia, não a economia** — ver `economiaConfiavel`.
     *
     * Continua sendo `assentosOciosos × preço`, que é o que aqueles assentos custam
     * **hoje**. O que não se pode concluir é que removê-los devolva esse valor.
     */
    readonly custoMensalUsd: number | null
    /**
     * `false` = `custoMensalUsd` é **teto**, não estimativa (T-134, `D-23`).
     *
     * ⚠️ O preço do JSM é **escalonado**, e por faixa: medido em 07/08/2026, a faixa
     * 1–100 tem os valores USD 9,05 e 6,70 por assento. Consequência que inverte a
     * intuição: **cortar assento pode AUMENTAR o preço unitário dos que ficam**, então
     * `ociosos × preço` superestima a economia — exatamente o número com que alguém
     * decide rebaixar o acesso de um colega.
     *
     * Só fica `true` quando existe curva configurada para **todos** os produtos que têm
     * assento ocioso. Sem curva, o default é `false`: é o mesmo raciocínio de
     * `custoConfigurado` (Q8) e de `deflexaoResolvidaConhecida` (T-235) — número que não
     * se sabe calcular não vira número que se afirma.
     */
    readonly economiaConfiavel: boolean
  }
}

/**
 * Preço por faixa de quantidade, quando o produto é escalonado.
 *
 * Vem de config (`RNF-25`), nunca do código: a tabela é da Atlassian e muda sem nos
 * avisar. `ate` é inclusivo; a última faixa usa `null` para "daí para cima".
 */
export interface FaixaPreco {
  readonly ate: number | null
  readonly precoUnitarioUsd: number
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

/**
 * Preço unitário na faixa correspondente à quantidade.
 *
 * Função separada e exportada porque é a regra que T-134 introduz, e regra que se testa
 * sem montar inventário é regra que continua testada quando o resto mudar.
 */
export function precoNaFaixa(faixas: readonly FaixaPreco[], quantidade: number): number | null {
  for (const f of faixas) {
    if (f.ate === null || quantidade <= f.ate) return f.precoUnitarioUsd
  }
  return null
}

/**
 * Economia real de remover `remover` assentos de um total de `atual`.
 *
 * ⚠️ **Não é `remover × preço`.** Com faixas, o preço unitário dos assentos que ficam
 * pode subir — então a economia é a diferença entre as duas contas completas, e pode ser
 * bem menor que a ingênua. É por isso que T-134 existe: o `HANDOFF` mediu um corte de 54
 * para 38 assentos (−30%) que baixou a fatura em **3,4%**.
 */
export function economiaComCurva(
  faixas: readonly FaixaPreco[],
  atual: number,
  remover: number,
): number | null {
  const depois = Math.max(0, atual - remover)
  const precoAntes = precoNaFaixa(faixas, atual)
  const precoDepois = precoNaFaixa(faixas, depois)
  if (precoAntes === null || precoDepois === null) return null
  // `Math.max(0, …)`: se a faixa nova for mais cara o bastante, a "economia" é zero, não
  // um número negativo que a tela mostraria como prejuízo de cortar.
  return Math.max(0, atual * precoAntes - depois * precoDepois)
}

export function calcularCusto(
  itens: readonly ItemInventario[],
  precoMensalPorProduto: Readonly<Record<string, number>>,
  ociosoDesdeDias: number,
  agoraMs: number,
  /** T-134 — curva por produto, quando configurada. Ausente = economia é teto. */
  curvaPorProduto: Readonly<Record<string, readonly FaixaPreco[]>> = {},
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
  // Começa `true` e só se mantém se TODO produto com assento ocioso tiver curva. Um
  // produto sem curva contamina a afirmação inteira, do mesmo jeito que um produto sem
  // preço derruba `custoConfigurado`.
  let economiaConfiavel = true

  for (const [produto, { usuarios, ociosos }] of porProdutoMap) {
    const preco = precoMensalPorProduto[produto]
    const custoMensalUsd = preco === undefined ? null : usuarios * preco
    porProduto.push({ produto, usuarios, ociosos, custoMensalUsd })
    ociososUsuarios += ociosos
    if (preco === undefined) {
      todosPrecificados = false
    } else {
      totalMensalUsd += usuarios * preco
      const curva = curvaPorProduto[produto]
      const comCurva = curva ? economiaComCurva(curva, usuarios, ociosos) : null
      if (comCurva === null) {
        // Sem curva (ou curva que não cobre a quantidade): cai no cálculo ingênuo, que é
        // um TETO, e a resposta passa a dizer isso.
        if (ociosos > 0) economiaConfiavel = false
        ociosoCustoMensalUsd += ociosos * preco
      } else {
        ociosoCustoMensalUsd += comCurva
      }
    }
  }

  return {
    porProduto: porProduto.sort((a, b) => a.produto.localeCompare(b.produto)),
    totalMensalUsd: todosPrecificados ? totalMensalUsd : null,
    custoConfigurado: todosPrecificados,
    ocioso: {
      usuarios: ociososUsuarios,
      custoMensalUsd: todosPrecificados ? ociosoCustoMensalUsd : null,
      // Sem nenhum assento ocioso não há economia a estimar, então não há o que ressalvar.
      economiaConfiavel: ociososUsuarios === 0 ? true : economiaConfiavel,
    },
  }
}
