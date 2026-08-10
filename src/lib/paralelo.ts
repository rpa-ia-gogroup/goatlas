/**
 * Paralelismo **com teto** — o único jeito honesto de tirar latência de um laço de rede
 * neste app.
 *
 * ## Por que existe, em vez de `Promise.all` direto
 *
 * Vários laços do app faziam `for (const x of lista) await chamada(x)`: a lista de
 * chamados da pessoa (até 100 `obterChamado`), a restrição por página candidata da busca
 * e da árvore (`RN-06`), a classificação da Regra 2 (uma chamada de IA por ticket). Em
 * série, o tempo de parede é a soma — e como cada item é uma ida à Atlassian de algumas
 * centenas de milissegundos, a lista de chamados de quem abriu 40 tickets levava mais de
 * dez segundos sem nada de errado acontecendo.
 *
 * ⚠️ **`Promise.all` na lista inteira é o conserto errado.** O regime de rate limit da
 * Atlassian por API token é *burst limit* com valores **não publicados** (`R-02`,
 * `RNF-15`), e os headers `X-RateLimit-*` só aparecem **na resposta 429**. Disparar 100
 * requisições simultâneas com a credencial única é o jeito mais rápido de descobrir o
 * limite do jeito ruim — e o custo cai sobre o app inteiro, não sobre quem clicou.
 * Existe backoff (`atlassian/http.ts`), mas backoff é rede de segurança, não estratégia:
 * um turno que toma 429 e espera 2 s ficou **mais** lento que o laço em série.
 *
 * Daí o teto. Quatro a seis em voo cobre quase todo o ganho (a soma vira a soma dividida
 * pelo teto) e mantém a taxa de requisição na mesma ordem de grandeza de antes.
 */

/**
 * Teto para chamadas à Atlassian. Deliberadamente baixo — ver o aviso acima.
 *
 * Vale por **laço**, não global: dois usuários simultâneos somam. É outro motivo para não
 * subir esse número sem olhar a telemetria de 429 (`RF-60`), que existe justamente porque
 * o orçamento não é consultável.
 */
export const CONCORRENCIA_ATLASSIAN = 5

/**
 * Teto para chamadas ao provedor de IA. Menor que o da Atlassian de propósito: cada uma
 * custa dinheiro (`RNF-16`) e o provedor também responde 429.
 */
export const CONCORRENCIA_IA = 3

/**
 * `map` assíncrono com no máximo `limite` chamadas em voo, **preservando a ordem** do
 * resultado.
 *
 * A ordem importa mais do que parece: a busca do Confluence devolve as páginas por
 * relevância e a árvore por título, e reordenar por "quem respondeu primeiro" faria a
 * lista dançar entre dois carregamentos da mesma tela — parece bug de tela, e é.
 *
 * Se `fn` rejeitar, esta função rejeita com o **primeiro** erro, mas só depois de todos
 * os trabalhadores terminarem: `Promise.all` rejeitaria de imediato e as rejeições dos
 * outros ficariam sem tratamento, o que no runtime dos Workers vira ruído no log de um
 * erro que já foi tratado aqui.
 */
export async function mapearComLimite<T, R>(
  itens: readonly T[],
  limite: number,
  fn: (item: T, indice: number) => Promise<R>,
): Promise<R[]> {
  if (itens.length === 0) return []

  const resultados = new Array<R>(itens.length)
  const trabalhadores = Math.max(1, Math.min(Math.floor(limite), itens.length))
  let proximo = 0

  const conclusoes = await Promise.allSettled(
    Array.from({ length: trabalhadores }, async () => {
      for (;;) {
        const indice = proximo
        proximo += 1
        if (indice >= itens.length) return
        resultados[indice] = await fn(itens[indice] as T, indice)
      }
    }),
  )

  const falha = conclusoes.find((c) => c.status === 'rejected')
  if (falha && falha.status === 'rejected') throw falha.reason
  return resultados
}
