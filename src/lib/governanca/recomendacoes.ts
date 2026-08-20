/**
 * Recomendações de rebaixamento/remoção (RF-54).
 *
 * O caso central do requisito: um assento cujo ÚNICO uso é abrir chamado. O papel
 * "customer" do JSM é gratuito e ilimitado — manter esse acesso como "agent" paga
 * mensalmente por algo que teria custo zero.
 */

import { assentoOcioso } from './custo'
import type { ItemInventario } from './inventario'

/**
 * Chave do produto do papel "agent" no JSM. É ESTE acesso que tem custo; o papel
 * "customer" (abrir e acompanhar chamado) é gratuito e ilimitado — a própria razão
 * de existir de `atlas` (dar isolamento de conta sem exigir assento).
 */
export const PRODUTO_SERVICE_DESK_AGENTE = 'jira-servicedesk'

export type TipoRecomendacao = 'rebaixar_para_customer' | 'remover_ocioso'

export interface Recomendacao {
  readonly accountId: string
  readonly email: string
  readonly nome: string
  readonly tipo: TipoRecomendacao
  readonly motivo: string
  readonly produtosAfetados: readonly string[]
}

export function gerarRecomendacoes(
  itens: readonly ItemInventario[],
  ociosoDesdeDias: number,
  agoraMs: number,
): Recomendacao[] {
  const porConta = new Map<string, { email: string; nome: string; itens: ItemInventario[] }>()
  for (const item of itens) {
    const atual = porConta.get(item.accountId) ?? { email: item.email, nome: item.nome, itens: [] }
    atual.itens.push(item)
    porConta.set(item.accountId, atual)
  }

  const ocioso = (i: ItemInventario) => assentoOcioso(i.ultimoAcessoEm, ociosoDesdeDias, agoraMs)
  const recomendacoes: Recomendacao[] = []

  for (const [accountId, { email, nome, itens: doUsuario }] of porConta) {
    const temServiceDesk = doUsuario.some((i) => i.produto === PRODUTO_SERVICE_DESK_AGENTE)
    const outrosProdutos = doUsuario.filter((i) => i.produto !== PRODUTO_SERVICE_DESK_AGENTE)
    const todosOsOutrosOciosos = outrosProdutos.length > 0 && outrosProdutos.every(ocioso)

    // Caso central do requisito: só usa o assento para abrir chamado.
    if (temServiceDesk && (outrosProdutos.length === 0 || todosOsOutrosOciosos)) {
      recomendacoes.push({
        accountId,
        email,
        nome,
        tipo: 'rebaixar_para_customer',
        motivo:
          'Este assento só é usado para abrir e acompanhar chamado — o perfil customer do JSM é gratuito e ilimitado.',
        produtosAfetados: [PRODUTO_SERVICE_DESK_AGENTE, ...outrosProdutos.map((i) => i.produto)],
      })
      continue
    }

    if (doUsuario.length > 0 && doUsuario.every(ocioso)) {
      recomendacoes.push({
        accountId,
        email,
        nome,
        tipo: 'remover_ocioso',
        motivo: `Sem uso de nenhum produto atribuído há pelo menos ${ociosoDesdeDias} dias.`,
        produtosAfetados: doUsuario.map((i) => i.produto),
      })
    }
  }

  return recomendacoes.sort((a, b) => a.email.localeCompare(b.email, 'pt-BR'))
}
