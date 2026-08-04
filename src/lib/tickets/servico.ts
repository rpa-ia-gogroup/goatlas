/**
 * Criação de chamado — o ponto onde todas as travas se encontram.
 *
 * Ordem que não pode mudar:
 *   1. **Gate** (RF-08, RF-17) — recusa antes de qualquer efeito.
 *   2. **Outbox** (RNF-17, RF-24) — persiste ANTES de chamar a Atlassian.
 *   3. **Atlassian** — cria o chamado.
 *   4. **Vínculo** (RF-22) — sem ele o autor não vê o próprio chamado (RF-30).
 *
 * O passo 2 antes do 3 é o que impede perder chamado. O passo 4 é o que impede o
 * pior caso do sistema: chamado que existe no JSM e é invisível para quem o abriu.
 * Se o 4 falhar, a submissão fica `criado` sem vínculo e a reconciliação (RNF-21)
 * a recupera — nunca fica um chamado órfão sem rastro.
 */

import { ErroAtlassian, type ClienteAtlassian } from '../atlassian/tipos'
import type { Auditoria } from '../audit'
import { CriacaoRecusada, autorizarCriacao } from '../agent/gate'
import type { Conversa } from '../agent/estado'
import { Outbox, type PayloadSubmissao } from './outbox'
import { RepositorioVinculos, type ViaAbertura } from './vinculos'

export interface ResultadoCriacao {
  readonly issueKey: string | null
  /** `pendente` = recebido e será reprocessado pelo cron. Nunca "não consegui". */
  readonly estado: 'criado' | 'pendente'
  readonly duplicada: boolean
  readonly verificadoRegras: boolean
}

export interface DadosAbertura {
  readonly solicitanteEmail: string
  readonly chaveIdempotencia: string
  readonly via: ViaAbertura
  readonly conversaId: string | null
  readonly verificadoRegras: boolean
  readonly payload: PayloadSubmissao
}

export class ServicoChamados {
  constructor(
    private readonly atlassian: ClienteAtlassian,
    private readonly outbox: Outbox,
    private readonly vinculos: RepositorioVinculos,
    private readonly auditoria: Auditoria,
    private readonly novoId: () => string,
  ) {}

  /**
   * Abertura a partir de uma conversa com o agente.
   *
   * **Toda** criação por conversa passa por aqui, e aqui passa pelo gate. Não
   * existe caminho alternativo: é a diferença entre a regra ser garantia e ser
   * recomendação.
   */
  async abrirPorConversa(
    conversa: Conversa,
    serviceDeskId: string,
    chaveIdempotencia: string,
  ): Promise<ResultadoCriacao> {
    const autorizacao = autorizarCriacao(conversa)
    if (!autorizacao.ok) {
      await this.auditoria.registrar({
        atorEmail: conversa.solicitanteEmail,
        acao: 'tool_recusada',
        recurso: `conversa:${conversa.id}`,
        resultado: 'negado',
        detalhe: { motivos: autorizacao.motivos },
      })
      throw new CriacaoRecusada(autorizacao.motivos)
    }
    const proposta = conversa.proposta
    if (!proposta) throw new CriacaoRecusada(['sem_proposta'])

    return this.abrir({
      solicitanteEmail: conversa.solicitanteEmail,
      chaveIdempotencia,
      via: 'conversa',
      conversaId: conversa.id,
      verificadoRegras: autorizacao.verificadoPelasRegras,
      payload: {
        titulo: proposta.titulo,
        descricao: proposta.descricao,
        tipoChamadoId: proposta.tipoChamadoId,
        serviceDeskId,
        prioridade: proposta.prioridade,
      },
    })
  }

  /**
   * Abertura pelo formulário mínimo — o caminho sem IA (D-04, RNF-18).
   *
   * Passa pelas MESMAS travas de idempotência, vínculo e solicitante. Não passa
   * pelo gate de RF-08 porque sem conversa não há tools a ordenar — e é
   * exatamente por isso que nasce com `verificadoRegras: false`: para que o
   * formulário não seja rota de fuga silenciosa da deflexão, e para que o volume
   * que entra por ele seja mensurável.
   */
  async abrirPorFormulario(dados: {
    solicitanteEmail: string
    chaveIdempotencia: string
    payload: PayloadSubmissao
  }): Promise<ResultadoCriacao> {
    return this.abrir({
      solicitanteEmail: dados.solicitanteEmail,
      chaveIdempotencia: dados.chaveIdempotencia,
      via: 'formulario',
      conversaId: null,
      verificadoRegras: false,
      payload: dados.payload,
    })
  }

  private async abrir(dados: DadosAbertura): Promise<ResultadoCriacao> {
    // (2) Persiste ANTES de falar com a Atlassian — RNF-17.
    const { submissao, nova } = await this.outbox.registrar({
      id: this.novoId(),
      chaveIdempotencia: dados.chaveIdempotencia,
      solicitanteEmail: dados.solicitanteEmail,
      conversaId: dados.conversaId,
      via: dados.via,
      verificadoRegras: dados.verificadoRegras,
      payload: dados.payload,
    })

    if (!nova) {
      // RF-24: duplo clique. Devolve o que já existe, sem criar segundo chamado.
      return {
        issueKey: submissao.issueKey,
        estado: submissao.issueKey ? 'criado' : 'pendente',
        duplicada: true,
        verificadoRegras: submissao.verificadoRegras,
      }
    }

    return this.processar(submissao.id, dados)
  }

  /** Usado tanto na abertura quanto pelo cron de reprocessamento. */
  async processar(submissaoId: string, dados: DadosAbertura): Promise<ResultadoCriacao> {
    try {
      // (3) Cria no JSM.
      const criado = await this.atlassian.criarChamado({
        serviceDeskId: dados.payload.serviceDeskId,
        tipoChamadoId: dados.payload.tipoChamadoId,
        titulo: dados.payload.titulo,
        descricao: dados.payload.descricao,
        prioridade: dados.payload.prioridade,
        solicitanteEmail: dados.solicitanteEmail,
        chaveIdempotencia: dados.chaveIdempotencia,
      })

      await this.outbox.marcarCriado(submissaoId, criado.issueKey)

      // (4) Vínculo. Se falhar aqui, a submissão fica 'criado' SEM vínculo e a
      // reconciliação recupera — o chamado nunca fica órfão sem rastro (RNF-21).
      await this.vinculos.criar({
        issueKey: criado.issueKey,
        solicitanteEmail: dados.solicitanteEmail,
        conversaId: dados.conversaId,
        via: dados.via,
        verificadoRegras: dados.verificadoRegras,
      })

      await this.auditoria.registrar({
        atorEmail: dados.solicitanteEmail,
        acao: 'chamado_criado',
        recurso: criado.issueKey,
        resultado: 'sucesso',
        detalhe: { via: dados.via, verificadoRegras: dados.verificadoRegras },
      })

      return {
        issueKey: criado.issueKey,
        estado: 'criado',
        duplicada: false,
        verificadoRegras: dados.verificadoRegras,
      }
    } catch (erro) {
      const transitorio = erro instanceof ErroAtlassian ? erro.detalhe.transitorio : true
      const mensagem = erro instanceof Error ? erro.message : String(erro)
      await this.outbox.registrarTentativaFalha(submissaoId, mensagem, transitorio)
      await this.auditoria.registrar({
        atorEmail: dados.solicitanteEmail,
        acao: 'chamado_criado',
        recurso: `submissao:${submissaoId}`,
        resultado: 'falha',
        detalhe: { erro: mensagem, transitorio },
      })

      if (!transitorio) throw erro

      // RNF-17/RNF-18: a submissão NÃO se perdeu. O usuário sabe o estado real.
      return {
        issueKey: null,
        estado: 'pendente',
        duplicada: false,
        verificadoRegras: dados.verificadoRegras,
      }
    }
  }

  /**
   * Reconciliação de vínculo órfão — RNF-21.
   *
   * Varre submissões marcadas como criadas que não têm vínculo e o reconstrói.
   * É a rede que impede o pior caso do sistema de ser permanente.
   */
  async reconciliarVinculos(limite: number): Promise<number> {
    const orfas = await this.outbox.listarCriadasSemVinculo(limite)
    let recuperados = 0
    for (const s of orfas) {
      if (!s.issueKey) continue
      await this.vinculos.criar({
        issueKey: s.issueKey,
        solicitanteEmail: s.solicitanteEmail,
        conversaId: s.conversaId,
        via: s.via,
        verificadoRegras: s.verificadoRegras,
      })
      await this.auditoria.registrar({
        atorEmail: s.solicitanteEmail,
        acao: 'vinculo_reconciliado',
        recurso: s.issueKey,
        resultado: 'sucesso',
        detalhe: { submissaoId: s.id },
      })
      recuperados += 1
    }
    return recuperados
  }

  /** Reprocessa o outbox — chamado pelo cron da plataforma (RNF-17). */
  async reprocessarPendentes(limite: number): Promise<{ criados: number; aindaPendentes: number }> {
    const pendentes = await this.outbox.listarPendentes(limite)
    let criados = 0
    let aindaPendentes = 0
    for (const s of pendentes) {
      const r = await this.processar(s.id, {
        solicitanteEmail: s.solicitanteEmail,
        chaveIdempotencia: s.chaveIdempotencia,
        via: s.via,
        conversaId: s.conversaId,
        verificadoRegras: s.verificadoRegras,
        payload: s.payload,
      })
      if (r.estado === 'criado') criados += 1
      else aindaPendentes += 1
    }
    return { criados, aindaPendentes }
  }

  /** Leitura isolada por vínculo — RF-30, RN-04. Sem vínculo, sem chamado. */
  async obterChamadoDoSolicitante(issueKey: string, solicitanteEmail: string) {
    const vinculo = await this.vinculos.obterDoSolicitante(issueKey, solicitanteEmail)
    if (!vinculo) {
      await this.auditoria.registrar({
        atorEmail: solicitanteEmail,
        acao: 'chamado_lido',
        recurso: issueKey,
        resultado: 'negado',
        detalhe: { motivo: 'sem_vinculo' },
      })
      return null
    }
    const chamado = await this.atlassian.obterChamado(issueKey)
    await this.auditoria.registrar({
      atorEmail: solicitanteEmail,
      acao: 'chamado_lido',
      recurso: issueKey,
      resultado: 'sucesso',
    })
    return { chamado, vinculo }
  }

  /** Comentários públicos do chamado — isolamento + RF-32 em duas camadas. */
  async listarComentariosDoSolicitante(issueKey: string, solicitanteEmail: string) {
    const vinculo = await this.vinculos.obterDoSolicitante(issueKey, solicitanteEmail)
    if (!vinculo) return null
    // O cliente já garante público-somente; o isolamento garante que é dele.
    return this.atlassian.listarComentariosPublicos(issueKey)
  }
}
