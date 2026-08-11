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
  /** RF-19, T-304 — congelada no vínculo. `null` = mapa não conhece o e-mail. */
  readonly area: string | null
  /**
   * RF-62 — a declaração de anexo. `null` = a pergunta não existia nesta criação.
   *
   * Chega **decidida** aqui: quem avalia se a pergunta se aplica é a rota, que já leu
   * o schema do request type. O serviço não relê nada — reler seria uma segunda
   * chamada com a credencial única para responder à mesma pergunta (`R-02`), e abriria
   * a chance de as duas leituras discordarem no meio de uma criação.
   */
  readonly declarouAnexo?: boolean | null
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
    /** RF-19, T-304 — área do solicitante no momento da criação. */
    area: string | null = null,
    /** RF-62 — já decidida pela rota. `null` = a pergunta não se aplicava. */
    declarouAnexo: boolean | null = null,
    /**
     * RF-21 / `D-36` — campos do request type, com os do solicitante já resolvidos pela
     * rota (que é quem tem o schema).
     *
     * ⚠️ Existe para que os **dois** caminhos de criação produzam o mesmo chamado. Enquanto
     * só o formulário preenchia, um chamado do tipo 108 aberto pela conversa nascia sem
     * nome e sem e-mail — e ninguém veria, porque o tipo 108 raramente chega por lá.
     * Divergência silenciosa entre dois caminhos é o defeito que a spec 006 §8 nomeia.
     */
    camposDinamicos: Readonly<Record<string, string>> | null = null,
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
      area,
      declarouAnexo,
      payload: {
        titulo: proposta.titulo,
        descricao: proposta.descricao,
        tipoChamadoId: proposta.tipoChamadoId,
        serviceDeskId,
        prioridade: proposta.prioridade,
        ...(camposDinamicos && Object.keys(camposDinamicos).length > 0
          ? { camposDinamicos }
          : {}),
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
    area?: string | null
    declarouAnexo?: boolean | null
  }): Promise<ResultadoCriacao> {
    return this.abrir({
      solicitanteEmail: dados.solicitanteEmail,
      chaveIdempotencia: dados.chaveIdempotencia,
      via: 'formulario',
      conversaId: null,
      verificadoRegras: false,
      area: dados.area ?? null,
      declarouAnexo: dados.declarouAnexo ?? null,
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
      declarouAnexo: dados.declarouAnexo ?? null,
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
        ...(dados.payload.camposDinamicos ? { camposDinamicos: dados.payload.camposDinamicos } : {}),
      })

      await this.outbox.marcarCriado(submissaoId, criado.issueKey)

      // (4) Vínculo. Se falhar aqui, a submissão fica 'criado' SEM vínculo e a
      // reconciliação recupera — o chamado nunca fica órfão sem rastro (RNF-21).
      //
      // ⚠️ **A colisão de `UNIQUE (issue_key)` é caso PREVISTO, não erro.** Ela significa
      // que este `issueKey` já tem vínculo — o que acontece de verdade quando o outbox
      // reprocessa uma submissão cujo vínculo já havia sido criado, e quando a Atlassian
      // devolve a mesma chave por idempotência do lado dela.
      //
      // O bug que isto corrige: a colisão subia como erro genérico e, por não ser
      // `ErroAtlassian`, era classificada como **transitória** — a submissão voltava para
      // `pendente` e o cron tentava **para sempre**, batendo na mesma constraint. Pego no
      // app real em 07/08/2026.
      //
      // A distinção que importa: mesmo solicitante = já estava feito (idempotente). Outro
      // solicitante = anomalia grave (a Atlassian devolveu uma chave que pertence a outra
      // pessoa) e **não pode** ser aceita em silêncio — seria entregar o chamado de alguém
      // para quem abriu este.
      try {
        await this.vinculos.criar({
          issueKey: criado.issueKey,
          solicitanteEmail: dados.solicitanteEmail,
          conversaId: dados.conversaId,
          via: dados.via,
          verificadoRegras: dados.verificadoRegras,
          area: dados.area,
        })
      } catch (erroVinculo) {
        const existente = await this.vinculos.obterSemIsolamento_apenasReconciliacao(
          criado.issueKey,
        )
        if (!existente) throw erroVinculo
        if (existente.solicitanteEmail !== dados.solicitanteEmail) {
          await this.auditoria.registrar({
            atorEmail: dados.solicitanteEmail,
            acao: 'chamado_criado',
            recurso: criado.issueKey,
            resultado: 'negado',
            detalhe: { motivo: 'issue_key_ja_vinculada_a_outro_solicitante' },
          })
          throw new ErroAtlassian('chave de chamado já vinculada a outro solicitante', {
            // **Definitivo**: reprocessar não muda nada, e insistir esconderia a anomalia.
            transitorio: false,
            recurso: criado.issueKey,
          })
        }
        await this.auditoria.registrar({
          atorEmail: dados.solicitanteEmail,
          acao: 'vinculo_reconciliado',
          recurso: criado.issueKey,
          resultado: 'sucesso',
          detalhe: { motivo: 'vinculo_ja_existia' },
        })
      }

      await this.auditoria.registrar({
        atorEmail: dados.solicitanteEmail,
        acao: 'chamado_criado',
        recurso: criado.issueKey,
        resultado: 'sucesso',
        detalhe: {
          via: dados.via,
          verificadoRegras: dados.verificadoRegras,
          // SC-12 — a declaração fica no registro do chamado. `null` é gravado como
          // `null` de propósito: "não respondeu" é um fato tão auditável quanto os
          // outros dois, e omitir a chave faria as duas coisas parecerem iguais.
          declarouAnexo: dados.declarouAnexo ?? null,
        },
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
        // ⚠️ A reconciliação NÃO recalcula a área pelo mapa atual: o vínculo perdido era
        // de meses atrás, e o mapa de hoje diria a área de hoje (T-304 quer a de então).
        // `null` é honesto; a pessoa corrige no recibo (T-305) se importar.
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
        // O reprocessamento não conhece a área: ela foi decidida na requisição original
        // e vive no vínculo, que este caminho só cria se ainda não existir.
        area: null,
        // A declaração, ao contrário da área, **sobrevive**: ela foi gravada na
        // submissão e é a resposta que a pessoa deu. Reler como `null` aqui apagaria
        // da auditoria do chamado reprocessado o que ela respondeu.
        declarouAnexo: s.declarouAnexo,
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
    // ⚠️ **A leitura DEGRADA, não quebra** (`RNF-19`). Antes, uma falha aqui subia até o
    // roteador e virava **500**: a pessoa clicava no próprio chamado e lia "algo deu errado
    // do nosso lado", sem nenhuma informação — numa queda do Jira, o app inteiro parecia
    // quebrado justo na tela que ela mais precisa.
    //
    // A lista já fazia isso certo desde a Fase 1 (usa o payload do outbox e marca o status
    // como indisponível). O detalhe não fazia, e a incoerência só apareceu testando contra
    // o app real — nenhum teste local pegava, porque nos testes o chamado sempre existe.
    //
    // O que se mostra é o que NÓS gravamos: título, descrição e prioridade vêm do outbox.
    // Só o status é honestamente marcado como indisponível.
    try {
      const chamado = await this.atlassian.obterChamado(issueKey)
      await this.auditoria.registrar({
        atorEmail: solicitanteEmail,
        acao: 'chamado_lido',
        recurso: issueKey,
        resultado: 'sucesso',
      })
      return { chamado, vinculo, degradado: false as const }
    } catch (erro) {
      const submissao = await this.outbox.obterPorIssueKey(issueKey)
      await this.auditoria.registrar({
        atorEmail: solicitanteEmail,
        acao: 'chamado_lido',
        recurso: issueKey,
        resultado: 'falha',
        detalhe: {
          motivo: 'atlassian_indisponivel',
          // Sem o corpo da resposta (RNF-01) — `ErroAtlassian` já garante isso.
          erro: erro instanceof Error ? erro.message : 'falha',
          recuperadoDoOutbox: submissao !== null,
        },
      })
      return {
        vinculo,
        degradado: true as const,
        chamado: {
          issueKey,
          titulo: submissao?.payload.titulo ?? '',
          descricao: submissao?.payload.descricao ?? '',
          status: 'indisponivel',
          prioridade: submissao?.payload.prioridade ?? null,
          criadoEm: vinculo.criadoEm,
          atualizadoEm: vinculo.criadoEm,
          slaPrimeiraResposta: null,
        },
      }
    }
  }

  /** Comentários públicos do chamado — isolamento + RF-32 em duas camadas. */
  async listarComentariosDoSolicitante(issueKey: string, solicitanteEmail: string) {
    const vinculo = await this.vinculos.obterDoSolicitante(issueKey, solicitanteEmail)
    if (!vinculo) return null
    // O cliente já garante público-somente; o isolamento garante que é dele.
    return this.atlassian.listarComentariosPublicos(issueKey)
  }
}
