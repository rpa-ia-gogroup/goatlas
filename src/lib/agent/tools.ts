/**
 * Execução das tools — onde as Regras 1 e 2 acontecem de fato.
 *
 * Divisão de responsabilidade que sustenta as travas:
 *   - `gate.ts` decide **se pode** rodar (RF-08);
 *   - este arquivo **roda** e devolve o veredito;
 *   - `rules/` decide **se bloqueia**, como função pura.
 *
 * ⚠️ Falha de tool **não silencia a regra** (RNF-18, Princípio XI): marca a
 * conversa como "tentou e falhou", informa o usuário e faz o chamado nascer como
 * não verificado. Indisponibilidade não vira bypass silencioso — e também não vira
 * parede.
 */

import type { ClienteAtlassian, TicketHistorico } from '../atlassian/tipos'
import type { ClasseResolucao, ClienteIA } from '../ia/tipos'
import {
  montarResultadoBuscaParaModelo,
  montarResultadoHistoricoParaModelo,
} from '../ia/prompts'
import type { Auditoria } from '../audit'
import type { ConfigValores } from '../config'
import { buscarComAmpliacao } from '../confluence/busca'
import { CONCORRENCIA_IA, mapearComLimite } from '../paralelo'
import {
  avaliarRegra1,
  avaliarRegra2,
  montarMensagemBloqueio,
  regra2Disponivel,
  type TicketClassificado,
  type Veredito,
} from '../rules'
import type { Banco } from '../db/tipos'
import { primeiraLinha } from '../db/tipos'

export interface ResultadoTool {
  /** Texto que vai ao modelo como resultado da tool (já delimitado). */
  readonly paraModelo: string
  /** Veredito da regra, quando a tool executou. `null` quando falhou. */
  readonly veredito: Veredito | null
  readonly falhou: boolean
  /** Mensagem pronta para o usuário quando a regra bloqueia (RF-12). */
  readonly mensagemBloqueio: string | null
  readonly custoUsd: number
}

/**
 * Hash estável do conteúdo dos comentários — chave do cache de classificação.
 *
 * Precisa ser síncrono e sem dependência (o runtime dos Workers só tem
 * `crypto.subtle`, que é assíncrono). Um hash não-criptográfico basta: aqui ele é
 * chave de cache, não garantia de segurança. Se o comentário mudar, o hash muda e
 * a classificação é refeita — que é exatamente o comportamento desejado.
 */
export function hashConteudo(texto: string): string {
  let h1 = 0x811c9dc5
  let h2 = 0x01000193
  for (let i = 0; i < texto.length; i += 1) {
    const c = texto.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0
    h2 = Math.imul(h2 + c, 0x85ebca6b) >>> 0
  }
  return (h1.toString(16) + h2.toString(16)).padStart(16, '0')
}

export class ExecutorTools {
  constructor(
    private readonly atlassian: ClienteAtlassian,
    private readonly ia: ClienteIA,
    private readonly db: Banco,
    private readonly auditoria: Auditoria,
    private readonly agora: () => string,
  ) {}

  /** Regra 1 — a resposta já existe no Confluence (RF-09). */
  async executarBuscaConfluence(
    atorEmail: string,
    topico: string,
    config: ConfigValores,
  ): Promise<ResultadoTool> {
    try {
      /**
       * ⚠️ `buscarComAmpliacao`, nunca `buscarConfluence` direto (`D-40`). O tópico
       * que o modelo extrai é uma **frase** ("processo de deploy na Gocase"), e
       * frase inteira em `text ~` casa quase nada — o agente então afirmava que
       * não havia documentação sobre algo documentado, que é o cenário mais caro
       * do projeto (`D-33`).
       */
      const busca = await buscarComAmpliacao(this.atlassian, {
        termo: topico,
        espacosPermitidos: config.espacos_confluence,
        labelsBloqueadas: config.labels_bloqueadas,
        limite: 5,
      })
      const paginas = busca.paginas

      const veredito = avaliarRegra1(paginas, config.regra1_threshold_score)
      await this.auditoria.registrar({
        atorEmail,
        acao: 'busca_confluence',
        recurso: topico,
        resultado: 'sucesso',
        // `recurso` é o que a pessoa (ou o modelo) pediu; `consultado` é o que de
        // fato foi à Atlassian. Sem os dois lados, ampliação silenciosa faria a
        // auditoria e o mapa de lacunas contarem histórias diferentes.
        detalhe: {
          encontradas: paginas.length,
          bloqueou: veredito.bloquear,
          ampliou: busca.ampliou,
          ...(busca.ampliou ? { consultado: busca.palavras.join(' ') } : {}),
        },
      })

      // Busca sem resultado útil é o mapa das lacunas de documentação (RF-42).
      if (paginas.length === 0) {
        await this.registrarBuscaSemResultado(atorEmail, topico, busca.palavras)
      }

      return {
        paraModelo: montarResultadoBuscaParaModelo(paginas),
        veredito,
        falhou: false,
        mensagemBloqueio: veredito.bloquear ? montarMensagemBloqueio(veredito) : null,
        custoUsd: 0,
      }
    } catch (erro) {
      await this.auditoria.registrar({
        atorEmail,
        acao: 'busca_confluence',
        recurso: topico,
        resultado: 'falha',
        detalhe: { erro: erro instanceof Error ? erro.message : String(erro) },
      })
      return {
        // O modelo é INFORMADO da falha. Não pode concluir "não achei nada".
        paraModelo:
          'A busca no Confluence não pôde ser feita agora (indisponibilidade). Diga isso à pessoa com transparência e siga — o chamado será marcado como não verificado.',
        veredito: null,
        falhou: true,
        mensagemBloqueio: null,
        custoUsd: 0,
      }
    }
  }

  /** Regra 2 — padrão de ajuste operacional (RF-10, RF-11). */
  async executarHistoricoJira(
    atorEmail: string,
    tipoProblema: string,
    config: ConfigValores,
  ): Promise<ResultadoTool> {
    // RF-14 / Q3: sem exemplos reais da Gocase a regra não roda. Ela se declara
    // indisponível — nunca bloqueia por precaução nem libera em silêncio.
    if (!regra2Disponivel(config.regra2_exemplos_ajuste_operacional)) {
      await this.auditoria.registrar({
        atorEmail,
        acao: 'consulta_historico',
        recurso: tipoProblema,
        resultado: 'falha',
        detalhe: { motivo: 'sem_exemplos_configurados_RF14_Q3' },
      })
      return {
        paraModelo:
          'A verificação de histórico não está configurada nesta instalação. Diga isso com transparência e siga — o chamado será marcado como não verificado.',
        veredito: null,
        falhou: true,
        mensagemBloqueio: null,
        custoUsd: 0,
      }
    }

    try {
      const tickets = await this.atlassian.buscarHistoricoTickets({
        chaveAgrupamento: tipoProblema,
        campoAgrupamento: config.regra2_campo_agrupamento,
        janelaDias: config.regra2_janela_dias,
        limite: config.regra2_limite_tickets,
      })

      /**
       * Uma classificação de IA por ticket, **em paralelo com teto** (`paralelo.ts`).
       *
       * ⚠️ Era o maior pedaço dos ~12 s que o turno do agente levava: em série, o tempo
       * desta tool é `regra2_limite_tickets` × latência do provedor, e nada disso aparece
       * como erro em lugar nenhum — só como espera. O teto é menor que o da Atlassian
       * porque cada chamada custa dinheiro (`RNF-16`) e o provedor também responde 429.
       *
       * A ordem é preservada porque `avaliarRegra2` conta e o texto que vai ao modelo lista
       * os chamados: reordenar por quem respondeu primeiro faria a mesma conversa produzir
       * mensagens diferentes a cada execução, e o teste de determinismo é o que sustenta a
       * calibragem de `R-04`.
       */
      const resultados = await mapearComLimite(tickets, CONCORRENCIA_IA, (ticket) =>
        this.classificarComCache(ticket, config.regra2_exemplos_ajuste_operacional),
      )
      const custoTotal = resultados.reduce((soma, r) => soma + r.custoUsd, 0)
      const classificados: TicketClassificado[] = tickets.map((ticket, i) => ({
        ticket,
        classe: resultados[i]!.classe,
      }))

      const veredito = avaliarRegra2(classificados, config.regra2_threshold_recorrencia)
      await this.auditoria.registrar({
        atorEmail,
        acao: 'consulta_historico',
        recurso: tipoProblema,
        resultado: 'sucesso',
        detalhe: {
          analisados: tickets.length,
          bloqueou: veredito.bloquear,
          custoUsd: custoTotal,
        },
      })

      return {
        paraModelo: montarResultadoHistoricoParaModelo(
          classificados.map((c) => ({
            issueKey: c.ticket.issueKey,
            titulo: c.ticket.titulo,
            classe: c.classe,
          })),
        ),
        veredito,
        falhou: false,
        mensagemBloqueio: veredito.bloquear ? montarMensagemBloqueio(veredito) : null,
        custoUsd: custoTotal,
      }
    } catch (erro) {
      await this.auditoria.registrar({
        atorEmail,
        acao: 'consulta_historico',
        recurso: tipoProblema,
        resultado: 'falha',
        detalhe: { erro: erro instanceof Error ? erro.message : String(erro) },
      })
      return {
        paraModelo:
          'A verificação de chamados anteriores não pôde ser feita agora. Diga isso com transparência e siga — o chamado será marcado como não verificado.',
        veredito: null,
        falhou: true,
        mensagemBloqueio: null,
        custoUsd: 0,
      }
    }
  }

  /**
   * Classificação com cache — contém R-08 e RNF-16.
   *
   * Reclassificar o mesmo ticket com o mesmo comentário é desperdício puro, e o
   * custo escala com volume de tickets, não com número de usuários. A chave inclui
   * o hash do comentário: se a resolução mudar, a classificação é refeita.
   */
  private async classificarComCache(
    ticket: TicketHistorico,
    exemplos: readonly string[],
  ): Promise<{ classe: ClasseResolucao; custoUsd: number }> {
    const conteudo = ticket.comentariosResolucao.join('\n')
    const hash = hashConteudo(conteudo)

    const cacheado = primeiraLinha<{ classe: ClasseResolucao }>(
      await this.db.query(
        `SELECT classe FROM classificacoes_ticket WHERE issue_key = ? AND hash_comentario = ?`,
        [ticket.issueKey, hash],
      ),
    )
    if (cacheado) return { classe: cacheado.classe, custoUsd: 0 }

    // Sem comentário de resolução não há o que classificar — e chamar a IA para
    // isso seria pagar por uma resposta que só pode ser "indeterminado".
    if (conteudo.trim().length === 0) {
      return { classe: 'indeterminado', custoUsd: 0 }
    }

    try {
      const r = await this.ia.classificarResolucao({
        comentariosResolucao: ticket.comentariosResolucao,
        tituloTicket: ticket.titulo,
        exemplosAjusteOperacional: exemplos,
      })
      await this.db.exec(
        `INSERT INTO classificacoes_ticket (issue_key, hash_comentario, classe, justificativa, criado_em)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (issue_key, hash_comentario) DO NOTHING`,
        [ticket.issueKey, hash, r.classe, r.justificativa, this.agora()],
      )
      return { classe: r.classe, custoUsd: r.custoEstimadoUsd }
    } catch {
      // Falha de classificação de UM ticket não derruba a regra inteira: ele conta
      // como indeterminado, e indeterminado não bloqueia (na dúvida, o ticket passa).
      return { classe: 'indeterminado', custoUsd: 0 }
    }
  }

  /**
   * RF-42 — busca sem resultado útil é backlog de documentação.
   *
   * ⚠️ **Menos o zero que veio de termo sem palavra significativa** (`D-40`). "Como
   * faço isso?" não deixou de ser documentado: não houve o que procurar. É o
   * terceiro zero da família de `buscaConfigurada` (zero por configuração) e do
   * escopo vazio de `D-30` (zero por escopo) — e registrá-lo como lacuna mandaria
   * alguém escrever uma página para uma frase, não para um assunto.
   */
  private async registrarBuscaSemResultado(
    atorEmail: string,
    topico: string,
    palavras: readonly string[],
  ): Promise<void> {
    const pesquisavel = palavras.length > 0
    await this.auditoria.registrar({
      atorEmail,
      acao: 'busca_confluence',
      recurso: topico,
      resultado: 'falha',
      detalhe: pesquisavel
        ? { motivo: 'sem_resultado_util', lacunaDocumentacao: true }
        : { motivo: 'termo_sem_palavras_significativas', lacunaDocumentacao: false },
    })
  }
}
