/**
 * As frases que a pessoa lê enquanto o turno roda.
 *
 * ## Por que não é uma lista fixa que gira
 *
 * 🚨 **Frase de espera é afirmação sobre o que está acontecendo.** "Analisando sua imagem…"
 * numa conversa sem imagem é o app dizendo algo falso — a mesma família de defeito de `D-33`
 * (o prompt prometia duas verificações que a instalação não tinha), de `D-41` (`lacunaDocumentacao`
 * para termo que ninguém deixou de documentar) e de `RF-43` (*"o resto do conteúdo está
 * completo"* impresso em cima de conteúdo faltando). O custo não é estético: quem lê "lendo seu
 * documento" e não mandou documento nenhum passa a duvidar do resto da tela.
 *
 * Então as frases são **função do que o turno de fato tem em mãos**: houve anexo? qual
 * verificação ainda falta? é a primeira mensagem ou a quinta?
 *
 * ## Teto de dez, e o motivo de haver teto
 *
 * Dez é o pedido, e serve: acima disso a lista deixa de ser "o app está trabalhando" e vira
 * ruído — a pessoa começa a ler as frases em vez de esperar. `MAX_FRASES` é conferido em teste
 * para o dia em que alguém quiser acrescentar a décima primeira.
 *
 * ## O que este módulo NÃO faz
 *
 * Não gira. A rotação é da tela (`TelaConversa`), e ela **respeita `prefers-reduced-motion`** —
 * texto que troca sozinho é movimento, e o piso de a11y do projeto (regra 9) vale aqui como
 * vale para animação.
 *
 * ⚠️ E a rotação é **visual**: quem anuncia para leitor de tela é **uma** frase estável, porque
 * uma região `aria-live` trocando de texto a cada 2 s vira interrupção a cada 2 s.
 *
 * _Requirements: RNF-12, RNF-28, RNF-30_
 */

/** Teto do pedido. Acima disto a pessoa lê as frases em vez de esperar. */
export const MAX_FRASES = 10

/** Quanto cada frase fica na tela. Longo o bastante para ser lida, curto para não travar. */
export const MS_POR_FRASE = 2600

export interface ContextoDaEspera {
  /** Há anexo sendo lido **agora** neste turno? (`FR-1b`) */
  readonly lendoAnexo?: boolean
  /** Quantos arquivos, para a frase falar no plural certo. */
  readonly quantosAnexos?: number
  /** A busca na documentação já rodou nesta conversa? */
  readonly documentacaoVerificada?: boolean
  /** O histórico de chamados já rodou? */
  readonly historicoVerificado?: boolean
  /** É a primeira mensagem da conversa? */
  readonly primeiraMensagem?: boolean
}

/**
 * As frases desta espera, na ordem em que aparecem.
 *
 * A ordem **é** a sequência real do turno: o anexo é lido primeiro (ele chega antes da
 * mensagem), depois a documentação, depois o histórico, e por fim a montagem da resposta. Uma
 * ordem arbitrária faria a tela contar uma história diferente da que o servidor está vivendo.
 *
 * ⚠️ **Nunca devolve lista vazia.** A última frase é genérica de propósito: sem ela, uma
 * conversa em que tudo já rodou ficaria sem indicação nenhuma de que há algo em curso — e o
 * silêncio na espera é lido como travamento.
 */
export function frasesDaEspera(ctx: ContextoDaEspera = {}): readonly string[] {
  const frases: string[] = []

  // 🚨 Só entra quando há anexo NESTE turno. É a frase mais concreta da lista e a que mais
  // custaria se fosse falsa.
  if (ctx.lendoAnexo) {
    frases.push(
      (ctx.quantosAnexos ?? 1) > 1
        ? 'lendo os arquivos que você enviou…'
        : 'lendo o arquivo que você enviou…',
    )
    frases.push('procurando erros e códigos no que você mandou…')
  }

  if (!ctx.documentacaoVerificada) {
    frases.push('procurando na documentação interna…')
    frases.push('vendo se alguém já escreveu a resposta…')
  }

  if (!ctx.historicoVerificado) {
    frases.push('olhando chamados parecidos…')
  }

  // Estas valem sempre: são o que o servidor faz em todo turno.
  frases.push('juntando o que encontrei…')
  frases.push('montando a resposta…')

  // ⚠️ Só na primeira mensagem: repetir "entendendo o seu caso" no quinto turno soaria como
  // se nada tivesse sido entendido até ali.
  if (ctx.primeiraMensagem) {
    frases.splice(frases.length - 2, 0, 'entendendo o que você descreveu…')
  }

  return frases.slice(0, MAX_FRASES)
}

/**
 * A frase única que vai ao leitor de tela.
 *
 * ⚠️ **Não é a primeira da lista por acaso**: ela precisa ser verdadeira durante a espera
 * inteira, porque não muda. "Verificando antes de responder" descreve o turno todo; "lendo o
 * arquivo" descreveria só o começo.
 */
export const FRASE_PARA_LEITOR_DE_TELA = 'Verificando antes de responder…'

/** Qual frase mostrar, dado quanto tempo passou. Pura — o relógio é de quem chama. */
export function fraseNoInstante(frases: readonly string[], msDecorridos: number): string {
  if (frases.length === 0) return FRASE_PARA_LEITOR_DE_TELA
  const i = Math.floor(Math.max(0, msDecorridos) / MS_POR_FRASE)
  // ⚠️ **Para na última, não volta ao começo.** Ciclar faria a espera longa parecer um laço
  // infinito — e a espera longa é justamente quando a pessoa está mais desconfiada (o turno
  // real leva 15–40 s contra o proxy).
  return frases[Math.min(i, frases.length - 1)]!
}
