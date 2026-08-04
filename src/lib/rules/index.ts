/**
 * Regras 1 e 2 como **funções puras** — RF-09, RF-10, RF-11.
 *
 * Decisão de desenho: a decisão de bloquear recebe o resultado já buscado e
 * devolve o veredito. Nada aqui fala com a rede. Sem isso, testar a Regra 2
 * exigiria Jira real e a suíte não rodaria em PR — e essas são exatamente as
 * regras que precisam de teste, porque errar aqui produz falso bloqueio (R-04),
 * que é o caminho mais rápido para a pessoa voltar ao Google Chat.
 */

import type { PaginaConfluence, TicketHistorico } from '../atlassian/tipos'
import type { ClasseResolucao } from '../ia/tipos'

export type Regra = 'regra1_confluence' | 'regra2_ajuste_operacional'

export interface EvidenciaRegra1 {
  readonly paginas: readonly {
    /**
     * Id da página — é ele que permite ler **dentro do app** (`RF-39`). Sem id só
     * sobra o link do Confluence, que é uma parede para quem não tem assento.
     */
    readonly id: string
    readonly titulo: string
    readonly url: string
    readonly score: number
  }[]
}

export interface EvidenciaRegra2 {
  readonly ticketsAjusteOperacional: readonly { readonly issueKey: string; readonly titulo: string }[]
  readonly totalAnalisado: number
}

export type Veredito =
  | { readonly bloquear: false; readonly motivoTecnico: string }
  | {
      readonly bloquear: true
      readonly regra: Regra
      readonly motivoTecnico: string
      readonly evidencia: EvidenciaRegra1 | EvidenciaRegra2
    }

/**
 * Regra 1 — a resposta já existe no Confluence (RF-09).
 *
 * Bloqueia quando o **melhor score** passa o threshold. Não é busca binária:
 * "achou alguma página" não é motivo para bloquear, senão qualquer termo genérico
 * bloquearia tudo.
 *
 * ⚠️ O score do CQL **não é normalizado entre queries** — o threshold é calibrado
 * empiricamente e começa conservador (R-04, Fase 4). Não trate 0.75 como verdade
 * universal; trate como ponto de partida a ajustar com dado do piloto.
 */
export function avaliarRegra1(
  paginas: readonly PaginaConfluence[],
  thresholdScore: number,
): Veredito {
  if (paginas.length === 0) {
    return { bloquear: false, motivoTecnico: 'nenhuma página relevante encontrada' }
  }
  const acimaDoThreshold = paginas
    .filter((p) => p.score >= thresholdScore)
    .sort((a, b) => b.score - a.score)

  if (acimaDoThreshold.length === 0) {
    const melhor = Math.max(...paginas.map((p) => p.score))
    return {
      bloquear: false,
      motivoTecnico: `melhor score ${melhor.toFixed(2)} abaixo do threshold ${thresholdScore}`,
    }
  }
  return {
    bloquear: true,
    regra: 'regra1_confluence',
    motivoTecnico: `${acimaDoThreshold.length} página(s) com score >= ${thresholdScore}`,
    evidencia: {
      paginas: acimaDoThreshold.map((p) => ({
        id: p.id,
        titulo: p.titulo,
        url: p.url,
        score: p.score,
      })),
    },
  }
}

export interface TicketClassificado {
  readonly ticket: TicketHistorico
  readonly classe: ClasseResolucao
}

/**
 * Regra 2 — padrão recorrente de ajuste operacional (RF-10, RF-11).
 *
 * Bloqueia quando o número de tickets classificados como "ajuste operacional" no
 * mesmo agrupamento passa o threshold de recorrência.
 *
 * ⚠️ `indeterminado` **não conta** como ajuste operacional. Contar o incerto a
 * favor do bloqueio é o desenho que produz falso bloqueio (R-04): na dúvida, o
 * ticket passa. Recorrência de **resolução real** também não bloqueia — causa raiz
 * corrigida várias vezes não é sinal de ticket evitável.
 */
export function avaliarRegra2(
  classificados: readonly TicketClassificado[],
  thresholdRecorrencia: number,
): Veredito {
  const ajustes = classificados.filter((c) => c.classe === 'ajuste_operacional')

  if (ajustes.length < thresholdRecorrencia) {
    return {
      bloquear: false,
      motivoTecnico: `${ajustes.length} ajuste(s) operacional(is) em ${classificados.length} ticket(s), abaixo do threshold ${thresholdRecorrencia}`,
    }
  }
  return {
    bloquear: true,
    regra: 'regra2_ajuste_operacional',
    motivoTecnico: `${ajustes.length} ajuste(s) operacional(is) recorrente(s), threshold ${thresholdRecorrencia}`,
    evidencia: {
      ticketsAjusteOperacional: ajustes.map((c) => ({
        issueKey: c.ticket.issueKey,
        titulo: c.ticket.titulo,
      })),
      totalAnalisado: classificados.length,
    },
  }
}

/**
 * URL de leitura **dentro do app** — `RF-39`, `T-118`.
 *
 * ⚠️ **Este formato é contrato com o frontend**: `entradaDaUrl` em
 * `src/app/confluence.tsx` interpreta exatamente `?pagina=<id>`, e `TextoDoAgente`
 * só transforma em link o caminho que casa com esta forma. Existe teste que gera a
 * URL aqui e a faz voltar por lá — um comentário pedindo que as duas camadas
 * concordem não impediria a divergência silenciosa (o link continuaria bonito e
 * levaria a 404).
 *
 * A alternativa era o servidor não conhecer rota de tela nenhuma e devolver a lista
 * de páginas estruturada para a UI montar o link. Fica para quando existir uma
 * segunda superfície consumindo a mensagem; hoje seria indireção sem consumidor.
 */
export function urlDeLeituraNoApp(idPagina: string): string {
  return `/?pagina=${encodeURIComponent(idPagina)}`
}

/**
 * Mensagem de bloqueio com os **três elementos obrigatórios** de RF-12:
 *   1. qual regra disparou
 *   2. motivo em linguagem natural — para o solicitante saber COMO AGIR
 *   3. link da página — sempre na Regra 1, e na Regra 2 quando houver
 *
 * ⚠️ O link é o da **leitura no app**, não o do Confluence (`T-118`). Quem usa o
 * goatlas não tem assento Atlassian: linkar `atlassian.net` derrubava a deflexão
 * exatamente no clique, depois de a pessoa ter sido convencida a ler primeiro. A
 * rota interna já aplica as três condições de `RN-06`, então o link não amplia
 * exposição.
 *
 * ⚠️ A redação define a percepção do produto inteiro (RNF-31): o bloqueio precisa
 * soar como **ajuda**, não como recusa. E precisa deixar o caminho de override
 * visível (RF-13, RN-07) — bloqueio não é parede.
 */
export function montarMensagemBloqueio(veredito: Veredito & { bloquear: true }): string {
  if (veredito.regra === 'regra1_confluence') {
    const ev = veredito.evidencia as EvidenciaRegra1
    const links = ev.paginas
      .slice(0, 3)
      // Sem id não há como abrir aqui dentro; o link externo é pior que o interno e
      // melhor que nenhum — a alternativa seria mostrar o título de algo que a pessoa
      // não tem como abrir.
      .map((p) => `- [${p.titulo}](${p.id ? urlDeLeituraNoApp(p.id) : p.url})`)
      .join('\n')
    return [
      'Achei documentação que parece responder exatamente isso — vale olhar antes de abrir o chamado, porque a resposta pode estar a um clique daqui:',
      '',
      links,
      '',
      'Se essas páginas não resolvem o **seu** caso, me diga o que ficou de fora e eu abro o chamado na sequência. Isso também me ajuda a sinalizar que a documentação precisa melhorar.',
    ].join('\n')
  }

  const ev = veredito.evidencia as EvidenciaRegra2
  const lista = ev.ticketsAjusteOperacional
    .slice(0, 5)
    .map((t) => `- ${t.issueKey} — ${t.titulo}`)
    .join('\n')
  return [
    `Esse problema já apareceu ${ev.ticketsAjusteOperacional.length} vezes, e nas vezes anteriores foi resolvido com um ajuste manual em vez de correção da causa raiz:`,
    '',
    lista,
    '',
    'Abrir de novo provavelmente traria o mesmo ajuste temporário. Faz mais sentido tratar a causa — posso registrar isso como um chamado de causa raiz, com o histórico anexado.',
    '',
    'Se o seu caso é diferente dos anteriores, me diga o que muda e eu abro normalmente.',
  ].join('\n')
}

/**
 * A Regra 2 **não roda sem os exemplos reais da Gocase** (RF-14, Q3).
 *
 * Sem exemplos do contexto da empresa a classificação é imprecisa, e imprecisão
 * aqui vira falso bloqueio. O requisito é explícito: levantar os exemplos é
 * pré-requisito de implementação, não refinamento posterior. Então, sem eles, a
 * regra se declara **indisponível** — e cai no tratamento de RNF-18 (informa que
 * não conseguiu verificar e marca o ticket como não verificado), nunca em
 * "bloqueia por precaução" nem em "libera silenciosamente".
 */
export function regra2Disponivel(exemplos: readonly string[]): boolean {
  return exemplos.length > 0
}
