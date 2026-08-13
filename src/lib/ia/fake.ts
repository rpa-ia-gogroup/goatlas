/**
 * Cliente de IA FAKE — roteirizável.
 *
 * O ponto central: ele permite **encenar um modelo hostil**. Os testes de bypass
 * de RF-08 e RF-17 precisam de um modelo que tenta chamar `create_ticket` fora de
 * ordem, ou inventa nome de tool, ou obedece a uma instrução vinda de conteúdo do
 * Confluence. Com um provedor real isso seria não-determinístico; aqui é roteiro.
 */

import {
  ErroIA,
  type ClasseResolucao,
  type ClienteIA,
  type ParametrosChat,
  type ParametrosClassificacao,
  type RespostaIA,
  type ResultadoClassificacao,
  type ParametrosExtracao,
  type ResultadoExtracao,
  type PropostaSugerida,
  type ParametrosDescricaoArquivo,
  type ResultadoDescricaoArquivo,
} from './tipos'

export interface TurnoRoteirizado {
  readonly texto: string
  /**
   * Tools que este turno do "modelo" tenta chamar. Pode incluir nome que o
   * servidor não reconhece ou que não está permitido — é justamente o caso a
   * testar.
   */
  readonly toolsPropostas?: readonly { nome: string; argumentos?: Record<string, unknown> }[]
}

export class ClienteIAFake implements ClienteIA {
  private roteiro: TurnoRoteirizado[]
  private indice = 0
  /** Registra o que o SERVIDOR permitiu em cada turno (asserção de RF-08). */
  readonly permissoesRecebidas: string[][] = []
  readonly chatsRecebidos: ParametrosChat[] = []
  readonly classificacoesRecebidas: ParametrosClassificacao[] = []

  falharChat = false
  /** Reinicia o roteiro quando ele acaba — só para desenvolvimento. */
  repetirRoteiro = false
  falharClassificacao = false
  classePadrao: ClasseResolucao = 'resolucao_real'
  /** Classe por título de ticket, para montar histórico misto na Regra 2. */
  readonly classePorTitulo = new Map<string, ClasseResolucao>()

  constructor(roteiro: TurnoRoteirizado[] = []) {
    this.roteiro = roteiro
  }

  /** Troca o roteiro e reinicia o índice — usado pelo modo demonstração. */
  definirRoteiro(roteiro: readonly TurnoRoteirizado[]): void {
    this.roteiro = [...roteiro]
    this.indice = 0
  }

  async chat(params: ParametrosChat): Promise<RespostaIA> {
    this.chatsRecebidos.push(params)
    this.permissoesRecebidas.push(params.toolsPermitidas.map((t) => t.nome))
    if (this.falharChat) {
      throw new ErroIA('fake: IA indisponível', { transitorio: true, etapa: 'chat' })
    }
    // `repetirRoteiro` existe para o shim de desenvolvimento: sem ele, o roteiro se
    // esgota na primeira conversa e a segunda recebe "(fim do roteiro)". Fica
    // DESLIGADO por padrão porque vários testes dependem justamente do esgotamento.
    if (this.repetirRoteiro && this.roteiro.length > 0 && this.indice >= this.roteiro.length) {
      this.indice = 0
    }
    const turno = this.roteiro[this.indice]
    this.indice += 1
    if (!turno) {
      return { texto: '(fim do roteiro)', toolsPropostas: [], custoEstimadoUsd: 0 }
    }
    return {
      texto: turno.texto,
      toolsPropostas: (turno.toolsPropostas ?? []).map((t) => ({
        nome: t.nome,
        argumentos: t.argumentos ?? {},
      })),
      custoEstimadoUsd: 0.001,
    }
  }

  async classificarResolucao(
    params: ParametrosClassificacao,
  ): Promise<ResultadoClassificacao> {
    this.classificacoesRecebidas.push(params)
    if (this.falharClassificacao) {
      throw new ErroIA('fake: classificação indisponível', {
        transitorio: true,
        etapa: 'classificacao',
      })
    }
    return {
      classe: this.classePorTitulo.get(params.tituloTicket) ?? this.classePadrao,
      justificativa: 'fake',
      custoEstimadoUsd: 0.0005,
    }
  }

  /* ---------- análise de anexo (spec 007) --------------------------------- */

  readonly descricoesRecebidas: ParametrosDescricaoArquivo[] = []
  /**
   * O que o analisador devolve. Roteirizável **por nome de arquivo** porque um teste realista
   * tem dois anexos com destinos diferentes: um relevante, um não.
   */
  readonly descricaoPorArquivo = new Map<string, { relevante: boolean; descricao: string }>()
  descricaoPadrao: { relevante: boolean; descricao: string } = {
    relevante: true,
    descricao: 'fake: a imagem mostra a mensagem de erro "PIPELINE_TIMEOUT" na tela de vendas',
  }
  falharDescricao = false
  /** Atrasa a resposta, para exercitar a espera do turno (`FR-1b`) sem relógio de parede. */
  atrasoDescricao: Promise<void> | null = null

  async descreverArquivo(
    params: ParametrosDescricaoArquivo,
  ): Promise<ResultadoDescricaoArquivo> {
    this.descricoesRecebidas.push(params)
    if (this.atrasoDescricao) await this.atrasoDescricao
    if (this.falharDescricao) {
      throw new ErroIA('fake: leitura de arquivo indisponível', {
        transitorio: true,
        etapa: 'descricao_arquivo',
      })
    }
    const escolhido = this.descricaoPorArquivo.get(params.nomeArquivo) ?? this.descricaoPadrao
    return { ...escolhido, custoEstimadoUsd: 0.0009 }
  }

  /**
   * Proposta que o fake devolve. `null` simula "ainda falta informação", que é o
   * caso a testar tanto quanto o caminho pronto.
   */
  propostaSugerida: PropostaSugerida | null = {
    titulo: 'Pipeline de vendas não atualizou',
    descricao: 'O relatório diário de vendas não trouxe os dados de ontem.',
    prioridade: 'alta',
    tipoChamadoId: 'rt-1',
    area: null,
    /**
     * ⚠️ **O default vem COM motivo, e isso é escolha de dublê** (`FR-1`): o caminho comum de
     * produção tem motivo, então um fake sem ele faria todo teste de tela exercitar o caminho
     * de exceção (`FR-5`) sem ninguém notar. Quem testa a ausência a escreve explicitamente.
     *
     * 🚨 **E nenhum caso prova comportamento pelo que sai daqui** (`D-47`, cinco ocorrências):
     * motivo válido é o que `motivo-da-prioridade.ts` diz, e campo ajustado é o que
     * `ajuste-por-rotulo.ts` casa contra o schema. Aqui é roteiro, não evidência.
     */
    motivoPrioridade:
      'O relatório diário está sem os dados de ontem, com contorno manual disponível. Nenhuma venda parada foi relatada.',
    campos: [],
  }
  readonly extracoesRecebidas: ParametrosExtracao[] = []

  async extrairProposta(params: ParametrosExtracao): Promise<ResultadoExtracao> {
    this.extracoesRecebidas.push(params)
    if (this.falharChat) {
      throw new ErroIA('fake: extração indisponível', { transitorio: true, etapa: 'extracao' })
    }
    const p = this.propostaSugerida
    // Respeita a allowlist como o cliente real: id fora da lista descarta.
    const permitido = p && params.tiposPermitidos.some((t) => t.id === p.tipoChamadoId)
    return { proposta: permitido ? p : null, custoEstimadoUsd: 0.0002 }
  }

  async verificarSaude(): Promise<{ ok: boolean; detalhe: string }> {
    return this.falharChat ? { ok: false, detalhe: 'fake com falha' } : { ok: true, detalhe: 'fake' }
  }
}
