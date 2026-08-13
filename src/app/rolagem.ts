/**
 * Quem decide se a conversa acompanha o fim — e qual é o fim.
 *
 * ## O defeito que este módulo conserta
 *
 * 🚨 **A rolagem era incondicional, e o alvo era o lugar errado.** O efeito fazia
 * `fim.scrollIntoView({ block: 'end' })` a cada mudança de `falas`, e o sentinela `fim` mora
 * **antes** do compositor. Alinhar o sentinela ao rodapé da janela para a página **270 px
 * acima** do fim real (a altura do compositor de `D-68`), e nessa posição o compositor —
 * `sticky` — é puxado para cima e **cobre a mensagem que acabou de chegar**. Relato: *"ao
 * enviar mensagem, a tela dá uma subida, sendo que eu fico com a visualização na borda
 * inferior"*.
 *
 * ⚠️ Antes de `D-68` o compositor rolava com a página e o alvo errado não custava nada. Foi
 * pinar o compositor que transformou os 270 px de diferença em conteúdo escondido — é o
 * segundo custo do fixo, depois do terço de tela que já foi medido lá.
 *
 * ## As duas regras, que são uma só decisão
 *
 * 1. **No fim da página**, mensagem nova traz a conversa junto (o comportamento que se espera
 *    de qualquer chat).
 * 2. **Lendo o histórico**, nada arrasta a pessoa para baixo — nem a resposta que chega, nem a
 *    mensagem que ela mesma acabou de mandar. Quem volta ao fim é ela, pelo atalho.
 *
 * ⚠️ **A segunda metade não é "não fazer nada".** Sem um caminho de volta, mandar mensagem
 * enquanto se lê o histórico não teria efeito visível nenhum — o próprio texto e a espera
 * nascem fora da tela. Daí o atalho no compositor: ele existe porque a regra 2 existe.
 *
 * _Requirements: RNF-12, RNF-28_
 */

/**
 * Quanto se pode estar acima do fim e ainda contar como "no fim".
 *
 * Não é folga estética: rolagem suave termina alguns pixels antes, o teclado do celular muda
 * a altura visível no meio do gesto, e zoom fracionário produz sobra de subpixel. Com
 * tolerância zero, "estou no fim" viraria `false` sozinho e a conversa pararia de acompanhar
 * sem ninguém ter rolado nada.
 */
export const TOLERANCIA_FIM_PX = 80

export interface MedidaDeRolagem {
  /** Quanto já se rolou (`window.scrollY`). */
  readonly deslocamento: number
  /** Altura da janela (`window.innerHeight`). */
  readonly alturaVisivel: number
  /** Altura total do documento (`scrollHeight`). */
  readonly alturaTotal: number
}

/**
 * A pessoa está no fim da página?
 *
 * ⚠️ Página que **não rola** (conversa recém-aberta) responde `true`: ela está no fim por não
 * haver mais nada. Responder `false` ali faria a primeira mensagem nascer com o atalho de
 * "ir para o fim" aceso apontando para onde a pessoa já está.
 */
export function estaNoFim(m: MedidaDeRolagem, tolerancia = TOLERANCIA_FIM_PX): boolean {
  const distanciaAteOFim = m.alturaTotal - m.alturaVisivel - m.deslocamento
  return distanciaAteOFim <= tolerancia
}

/**
 * O atalho de voltar ao fim aparece?
 *
 * ⚠️ **As duas condições são necessárias.** Só `longeDoFim` acenderia o atalho em quem subiu
 * para reler algo numa conversa parada — botão que não resolve nada, competindo com o campo de
 * mensagem no espaço mais caro da tela. Só `novidade` o acenderia por cima de quem está no fim
 * e já está vendo a novidade.
 */
export function deveMostrarAtalhoDoFim(estado: {
  readonly longeDoFim: boolean
  readonly novidade: boolean
}): boolean {
  return estado.longeDoFim && estado.novidade
}

/** A medida atual da janela. Guardada aqui para o efeito e o teste falarem da mesma forma. */
export function medidaDaJanela(): MedidaDeRolagem {
  if (typeof window === 'undefined') {
    return { deslocamento: 0, alturaVisivel: 0, alturaTotal: 0 }
  }
  const raiz = document.scrollingElement ?? document.documentElement
  return {
    deslocamento: window.scrollY,
    alturaVisivel: window.innerHeight,
    alturaTotal: raiz.scrollHeight,
  }
}

/**
 * Leva a página ao fim de verdade — o fim do **documento**, compositor incluído.
 *
 * 🚨 **Não é `scrollIntoView` num sentinela**: ver o cabeçalho do arquivo. E respeita
 * `prefers-reduced-motion` **em JS**, porque `behavior: 'smooth'` passado na chamada ganha do
 * `scroll-behavior: auto` que `tokens.css` declara na media query.
 */
export function rolarAoFim(): void {
  if (typeof window === 'undefined') return
  const raiz = document.scrollingElement ?? document.documentElement
  // ⚠️ **Instantâneo, não `smooth`** — e a razão é honesta sobre o que se sabe. Rolagem suave
  // é animada, então ela depende de quadros: numa aba sem quadros (fora de foco, `rAF`
  // pausado) ela **não sai do lugar** — medido em 13/08, `scrollY` parado em 0 depois de
  // 1,2 s com `prefers-reduced-motion` desligado, enquanto `auto` foi ao fim na hora. Numa aba
  // em foco a suave funciona; o que não dá é *depender* de animação para **chegar**, quando
  // chegar é a correção. Instantâneo é o único caminho que se consegue provar, e ainda
  // dispensa checar `prefers-reduced-motion` em JS: sem animação não há movimento a reduzir.
  window.scrollTo({ top: raiz.scrollHeight, behavior: 'auto' })
}

/**
 * Por quanto tempo um evento de rolagem ainda pode ser nosso.
 *
 * 🚨 **Rolagem suave dispara `scroll` a cada quadro, e no meio do voo a posição está longe do
 * fim.** Sem esta janela, o próprio movimento que leva ao fim marcava a pessoa como "lendo o
 * histórico" — e aí a correção seguinte não acontecia. Medido no navegador: a página parava
 * **200 px acima** do fim, com a mensagem nova 34 px atrás do compositor, exatamente o sintoma
 * que este `D-69` existe para consertar.
 */
export const JANELA_ROLAGEM_PROPRIA_MS = 800

/** O evento de rolagem que acabou de chegar é consequência de a gente ter rolado? */
export function ehRolagemNossa(agora: number, valeAte: number): boolean {
  return agora < valeAte
}
