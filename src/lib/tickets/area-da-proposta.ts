/**
 * A área que a pessoa VÊ no cartão é a que será GRAVADA no vínculo — `RF-19`, `D-52`.
 *
 * ## O defeito: existiam duas áreas, e a visível era a que não valia
 *
 * Achado pela auditoria de `D-47` e confirmado no código:
 *
 * | Área | Origem | Onde aparecia | O que acontecia com ela |
 * |---|---|---|---|
 * | `proposta.area` | **extraída pela IA** do texto da conversa | cartão de confirmação (`RF-18`) | descartada na criação |
 * | `vinculo.area` | `resolverArea` — TeamGuide, com o mapa de config como fallback | nenhum lugar, antes de criar | gravada |
 *
 * Quem corrigisse a área no cartão via a alteração ser aceita e o valor **sumir**, sem
 * erro nenhum. É a família de `urlDeLeituraNoApp`/`entradaDaUrl` e da chave de
 * idempotência: dois lados que parecem falar do mesmo dado e não falam — e o sintoma é
 * sempre silencioso, porque cada lado funciona sozinho.
 *
 * ## A decisão: uma fonte, resolvida uma vez
 *
 * A IA **deixa de opinar sobre área**. Quem responde é `resolverArea`, e o valor é
 * gravado **na proposta**, no primeiro momento em que ela existe. A criação usa o que
 * está na proposta. Assim não são duas resoluções que podem divergir (cache expirada,
 * pessoa que mudou de time entre a conversa e o clique): é literalmente o mesmo valor.
 *
 * ⚠️ **Por que a IA não decide isto.** A área vira roteamento e métrica; `D-37` já
 * registra que área errada é pior que área nenhuma — a primeira pessoa medida tinha uma
 * área (`RPA`) que sequer existe entre as 15 opções do campo do Jira. Adivinhar a área a
 * partir do texto de quem pede ajuda é exatamente o tipo de palpite que fica plausível na
 * tela e errado no dado.
 *
 * ⚠️ **Fonte indisponível não vira área inventada** (`RNF-18`): fica `null`, a tela diz
 * "não identificada", e a correção manual continua sendo o caminho — antes de criar
 * (aqui) ou depois (`PUT /api/chamados/:key/area`, `T-305`).
 *
 * _Requirements: RF-18, RF-19, RNF-18_
 */

import type { Conversa, PropostaChamado, RepositorioConversas } from '../agent/estado'

/**
 * Garante que a proposta carregue a área real, resolvendo **uma vez**.
 *
 * Devolve a proposta como ela deve ser exibida — com a área já preenchida quando foi
 * possível descobri-la.
 *
 * ⚠️ **Não resolve de novo se a proposta já tem área.** Isso é o que impede uma ida de
 * rede (e uma linha de auditoria) por mensagem trocada: a conversa tem várias idas e
 * vindas depois de a proposta existir, e o mapa da empresa não muda no meio delas.
 */
export async function garantirAreaNaProposta(
  conversa: Conversa,
  conversas: Pick<RepositorioConversas, 'definirProposta'>,
  resolver: () => Promise<string | null>,
): Promise<PropostaChamado | null> {
  const proposta = conversa.proposta
  if (!proposta) return null
  if (proposta.area !== null && proposta.area !== '') return proposta

  const area = await resolver()
  // Sem área descoberta, nada a persistir: a proposta já está com `null`, e gravar de
  // novo só gastaria uma escrita para dizer o mesmo.
  if (area === null) return proposta

  const atualizada: PropostaChamado = { ...proposta, area }
  await conversas.definirProposta(conversa.id, atualizada)
  return atualizada
}
