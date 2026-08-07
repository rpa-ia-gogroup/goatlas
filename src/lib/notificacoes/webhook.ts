/**
 * Webhook do Jira — RF-48, RNF-05, T-206. **A trava da Fase 3.**
 *
 * ## Por que esta rota é diferente de todas as outras do app
 *
 * Todo o resto de `/api/*` fica atrás do SSO do edge (`RF-01`) ou do header assinado do
 * cron. Esta rota é **pública por necessidade**: quem chama é a Atlassian, que não tem
 * como fazer o OAuth do GoDeploy. Ou seja, é a única superfície do app onde qualquer
 * pessoa na internet consegue bater.
 *
 * Três decisões sustentam isso, e nenhuma é opcional:
 *
 * 1. **Segredo em comparação de tempo constante.** Um `===` em string vaza o prefixo
 *    correto pelo tempo de resposta; com um endpoint público e um laço, isso é o
 *    segredo descoberto caractere por caractere.
 * 2. **O payload é PONTEIRO, não conteúdo.** Do corpo sai uma coisa só: a chave do
 *    chamado. Nada do que vem no evento (`comment.body`, `changelog`, `user`) chega a
 *    uma mensagem — o app relê da Atlassian (ver `servico.ts`). Um evento forjado com
 *    texto de phishing não tem como virar notificação enviada.
 * 3. **A resposta é a MESMA sempre** (`202`), com ou sem vínculo local. Um 404 para
 *    chamado desconhecido transformaria a rota em oráculo de "este chamado passou pelo
 *    goatlas?" — a mesma classe de vazamento que o 404-em-vez-de-403 de `RF-30` fecha.
 */

/** Cabeçalho preferido; o Jira também permite pôr o segredo na query da URL. */
export const HEADER_WEBHOOK = 'x-goatlas-webhook'
export const PARAM_WEBHOOK = 'k'

/**
 * Comparação em **tempo constante**.
 *
 * Compara byte a byte com OR acumulado, sem `return` antecipado: o tempo passa a
 * depender só do tamanho, não do conteúdo. O tamanho diferente também é resolvido sem
 * atalho — a diferença entra no acumulador em vez de sair por um `if`.
 */
export function segredoConfere(enviado: string | null, esperado: string | undefined): boolean {
  // Fail-closed: sem segredo configurado a rota não funciona. O contrário deixaria o
  // webhook aberto exatamente na instalação que esqueceu de configurar (`RNF-07`).
  if (!esperado || esperado.length === 0) return false
  if (enviado === null) return false

  let diferenca = enviado.length ^ esperado.length
  const n = Math.max(enviado.length, esperado.length)
  for (let i = 0; i < n; i += 1) {
    diferenca |= (enviado.charCodeAt(i) || 0) ^ (esperado.charCodeAt(i) || 0)
  }
  return diferenca === 0
}

/**
 * Extrai a chave do chamado do payload.
 *
 * Aceita as duas formas que o Jira usa (`issue.key` e, em eventos de comentário mais
 * antigos, a chave no próprio comentário) e **valida o formato**: `PROJ-123`. Um
 * `issueKey` livre iria direto para uma consulta e para um `WHERE` — validar a forma é
 * o que mantém a entrada não confiável dentro de um formato conhecido.
 */
export function chaveDoPayload(corpo: unknown): string | null {
  if (!corpo || typeof corpo !== 'object') return null
  const c = corpo as { issue?: { key?: unknown }; issueKey?: unknown }
  const bruto =
    typeof c.issue?.key === 'string' ? c.issue.key : typeof c.issueKey === 'string' ? c.issueKey : null
  if (!bruto) return null
  return /^[A-Z][A-Z0-9_]{1,19}-\d{1,10}$/.test(bruto) ? bruto : null
}
