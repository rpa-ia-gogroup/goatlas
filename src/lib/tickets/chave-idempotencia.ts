/**
 * A chave de idempotência, escrita por **uma** função — `RF-24`, T-409b.
 *
 * ## O bug que este módulo existe para não acontecer
 *
 * A chave sempre foi normalizada: o formulário manda `k1` e o servidor grava
 * `form:<email>:k1` (escopo por pessoa — sem ele, duas pessoas com a mesma chave
 * colidiriam); a conversa usa `conversa:<id>`. Enquanto só a criação escrevia a chave,
 * ela podia morar dentro da rota.
 *
 * A partir do anexo na criação, **dois lugares** precisam produzir exatamente a mesma
 * string: o upload, que grava a linha em `anexos_pendentes`, e a criação, que a
 * procura. Duplicar a interpolação faria o upload gravar `k1` e a criação buscar
 * `form:ana@gocase.com:k1` — **nenhuma linha casaria**, o chamado nasceria sem anexo,
 * e não haveria erro nenhum: os dois lados funcionando, cada um com a sua chave.
 *
 * É a mesma classe de bug de `urlDeLeituraNoApp`/`entradaDaUrl` (um escreve, outro lê,
 * e divergir é silencioso) e da dedupe de notificação com o carimbo errado. A defesa é
 * a mesma: **um** produtor, e teste que gera de um lado e lê do outro.
 *
 * _Requirements: RF-24, RF-63_
 */

/**
 * De onde a chave vem. União fechada de propósito: uma via nova não compila sem
 * decidir como a chave dela é escrita.
 */
export type OrigemDaChave =
  | {
      readonly via: 'formulario'
      readonly solicitanteEmail: string
      /** O que o cliente mandou — já validado por `chaveDoClienteValida`. */
      readonly chaveDoCliente: string
    }
  | { readonly via: 'conversa'; readonly conversaId: string }

/**
 * A única função que escreve a chave.
 *
 * ⚠️ O formulário leva o e-mail **dentro** da chave, e isso é trava, não formato: é o
 * que faz a chave de outra pessoa ser inalcançável por construção (`SC-11`) — quem
 * manda `k1` só consegue produzir a linha de `form:<próprio e-mail>:k1`. A conversa não
 * precisa, porque o id dela já é verificado contra o solicitante antes de chegar aqui.
 */
export function normalizarChaveIdempotencia(origem: OrigemDaChave): string {
  return origem.via === 'conversa'
    ? `conversa:${origem.conversaId}`
    : `form:${origem.solicitanteEmail}:${origem.chaveDoCliente}`
}

/**
 * A chave que o cliente mandou serve?
 *
 * `null` = não mandou nada utilizável. Na criação **sem anexo** isso é tolerável (a
 * rota gera uma e a proteção de duplo clique se perde apenas para quem não manda
 * chave). Com anexo, não: sem chave o upload não tem onde se pendurar, e é por isso que
 * a rota de upload a exige em vez de inventar uma.
 */
export function chaveDoClienteValida(bruto: unknown): string | null {
  if (typeof bruto !== 'string') return null
  const limpa = bruto.trim()
  // Teto de tamanho porque a chave entra num `UNIQUE` e vem do cliente: string de
  // 1 MB não é chave, é payload.
  if (limpa.length === 0 || limpa.length > 200) return null
  return limpa
}
