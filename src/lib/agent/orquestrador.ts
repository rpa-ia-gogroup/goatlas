/**
 * Orquestrador da conversa — a state machine de servidor.
 *
 * O modelo **propõe**; o servidor **decide**. Cada turno:
 *   1. lê o estado durável da conversa;
 *   2. monta o conjunto de tools permitidas AGORA (`gate.toolsPermitidas`);
 *   3. chama a IA;
 *   4. para cada tool proposta: recusa o que não está autorizado, executa o que
 *      está, e persiste o resultado no estado;
 *   5. se uma regra bloqueou, a mensagem de bloqueio substitui a resposta do
 *      modelo — a regra não é sugestão ao modelo.
 *
 * ⚠️ Nada aqui cria chamado. Criar é transição disparada pelo usuário (RF-17).
 */

import type { ClienteIA } from '../ia/tipos'
import { PROMPT_AGENTE } from '../ia/prompts'
import { MENSAGEM_BLOQUEIO_PENDENTE } from '../rules'
import type { Auditoria } from '../audit'
import type { ConfigValores } from '../config'
import { toolAutorizada, toolsPermitidas, TOOLS } from './gate'
import { RepositorioConversas, type Conversa } from './estado'
import { ExecutorTools } from './tools'

export interface TurnoResultado {
  readonly texto: string
  /** `true` quando uma regra bloqueou neste turno (RF-12). */
  readonly bloqueado: boolean
  /**
   * `true` enquanto existir bloqueio sem override — inclusive de turnos
   * anteriores (RF-13, RN-07). Enquanto for `true` nenhuma proposta é montada,
   * e é ele que mantém o caminho de override na tela.
   */
  readonly bloqueioPendente: boolean
  readonly regraBloqueio: string | null
  readonly toolsExecutadas: readonly string[]
  readonly toolsRecusadas: readonly string[]
  readonly custoUsd: number
  /** RNF-16 — o teto de custo por conversa foi atingido. */
  readonly tetoCustoAtingido: boolean
}

/** Quantas idas ao modelo por turno. Sem limite, uma conversa pode custar sozinha. */
const MAX_CICLOS_TOOL = 3

export class Orquestrador {
  constructor(
    private readonly ia: ClienteIA,
    private readonly executor: ExecutorTools,
    private readonly conversas: RepositorioConversas,
    private readonly auditoria: Auditoria,
    private readonly novoId: () => string,
  ) {}

  async processarMensagem(
    conversa: Conversa,
    textoUsuario: string,
    config: ConfigValores,
  ): Promise<TurnoResultado> {
    await this.conversas.adicionarMensagem(
      this.novoId(),
      conversa.id,
      'user',
      textoUsuario,
      null,
    )

    // Bloqueio de pé: nem chama o modelo. O texto dele seria descartado de
    // qualquer forma (a regra em vigor é quem fala), e pagar por uma resposta que
    // ninguém vai ver, a cada mensagem, é o tipo de gasto que `RNF-16` existe para
    // evitar — o turno do bloqueio descarta UMA vez; aqui seria toda vez.
    if (await this.conversas.temBloqueioPendente(conversa.id)) {
      await this.conversas.adicionarMensagem(
        this.novoId(),
        conversa.id,
        'assistant',
        MENSAGEM_BLOQUEIO_PENDENTE,
        null,
      )
      return {
        texto: MENSAGEM_BLOQUEIO_PENDENTE,
        bloqueado: false,
        bloqueioPendente: true,
        regraBloqueio: null,
        toolsExecutadas: [],
        toolsRecusadas: [],
        custoUsd: 0,
        tetoCustoAtingido: false,
      }
    }

    const historico = await this.montarHistorico(conversa.id)
    const executadas: string[] = []
    const recusadas: string[] = []
    let custoTurno = 0
    let bloqueio: { texto: string; regra: string } | null = null
    let atual = conversa
    let ultimoTexto = ''

    for (let ciclo = 0; ciclo < MAX_CICLOS_TOOL; ciclo += 1) {
      // RNF-16 — teto de custo por conversa. Atingido, o turno para e o caminho
      // do formulário mínimo (D-04) continua disponível.
      if (atual.custoUsd + custoTurno >= config.teto_custo_conversa_usd) {
        await this.auditoria.registrar({
          atorEmail: atual.solicitanteEmail,
          acao: 'limite_excedido',
          recurso: `conversa:${atual.id}`,
          resultado: 'negado',
          detalhe: { motivo: 'teto_custo_conversa', custoUsd: atual.custoUsd + custoTurno },
        })
        return {
          texto:
            'Esta conversa ficou longa e vou precisar encerrá-la por aqui. Você pode abrir o chamado pelo formulário, ou começar uma conversa nova com o resumo do que ficou pendente.',
          bloqueado: false,
          // Teto de custo não apaga bloqueio: se havia um pendente, o caminho de
          // override continua na tela mesmo com a conversa encerrada.
          bloqueioPendente: await this.conversas.temBloqueioPendente(atual.id),
          regraBloqueio: null,
          toolsExecutadas: executadas,
          toolsRecusadas: recusadas,
          custoUsd: custoTurno,
          tetoCustoAtingido: true,
        }
      }

      const permitidas = toolsPermitidas(atual)
      const resposta = await this.ia.chat({
        mensagens: [{ papel: 'system', conteudo: PROMPT_AGENTE }, ...historico],
        toolsPermitidas: permitidas,
      })
      custoTurno += resposta.custoEstimadoUsd
      ultimoTexto = resposta.texto

      if (resposta.toolsPropostas.length === 0) break

      for (const proposta of resposta.toolsPropostas) {
        // A camada que sobrevive a prompt injection e a nome inventado: o servidor
        // só reconhece o que ele mesmo autorizou neste turno.
        if (!toolAutorizada(atual, proposta.nome)) {
          recusadas.push(proposta.nome)
          await this.auditoria.registrar({
            atorEmail: atual.solicitanteEmail,
            acao: 'tool_recusada',
            recurso: `conversa:${atual.id}`,
            resultado: 'negado',
            detalhe: { toolProposta: proposta.nome, permitidas: permitidas.map((t) => t.nome) },
          })
          historico.push({
            papel: 'tool',
            conteudo: `A ferramenta "${proposta.nome}" não está disponível neste momento da conversa.`,
            toolNome: 'search_confluence',
          })
          continue
        }

        const r = await this.rodarTool(atual, proposta.nome, proposta.argumentos, config)
        custoTurno += r.custoUsd
        executadas.push(proposta.nome)
        historico.push({
          papel: 'tool',
          conteudo: r.paraModelo,
          toolNome: proposta.nome as 'search_confluence' | 'check_jira_history',
        })
        await this.conversas.adicionarMensagem(
          this.novoId(),
          atual.id,
          'tool',
          r.paraModelo,
          proposta.nome,
        )

        if (r.mensagemBloqueio && r.veredito?.bloquear) {
          bloqueio = { texto: r.mensagemBloqueio, regra: r.veredito.regra }
          await this.registrarBloqueio(atual, r.veredito.regra, r.veredito.motivoTecnico, r.veredito.evidencia)
        }

        const relido = await this.conversas.obter(atual.id)
        if (relido) atual = relido
      }

      // Regra que bloqueou encerra o turno: a mensagem de bloqueio SUBSTITUI a
      // resposta do modelo. Se o modelo pudesse continuar, a "regra" seria uma
      // sugestão que ele poderia contornar com boa retórica.
      if (bloqueio) break
    }

    // RF-15 / RF-18 — a proposta é montada pelo SERVIDOR, deterministicamente:
    // as duas verificações já aconteceram, nada bloqueou, e ainda não há proposta.
    // Não é o modelo que decide QUANDO propor; ele só preenche o conteúdo. E o que
    // sai daqui é sugestão: exibida e editável antes de criar (RF-16).
    //
    // ⚠️ `bloqueio` é só DESTE turno. `temBloqueioPendente` olha os turnos
    // anteriores: bloqueio sem override não deixa a proposta nascer, por mais
    // mensagens que venham. É o que impede o bypass por conversa (RN-07).
    const bloqueioPendente = await this.conversas.temBloqueioPendente(atual.id)
    if (!bloqueio && !bloqueioPendente && !atual.proposta && this.verificacoesConcluidas(atual)) {
      custoTurno += await this.tentarMontarProposta(atual, config)
      const relido = await this.conversas.obter(atual.id)
      if (relido) atual = relido
    }

    await this.conversas.somarCusto(atual.id, custoTurno)

    // Bloqueio pendente de turno ANTERIOR: o modelo não sabe que o servidor não vai
    // montar proposta, e escreve "montei o chamado abaixo" com nada abaixo. Enquanto
    // a regra está em vigor quem fala é o servidor — o texto do modelo é DESCARTADO,
    // exatamente como no turno em que o bloqueio dispara (ver `bloqueio?.texto`).
    // Acrescentar o aviso ao texto do modelo, em vez de substituí-lo, produzia uma
    // resposta que se contradizia sozinha.
    const textoFinal = bloqueio?.texto ?? (bloqueioPendente ? MENSAGEM_BLOQUEIO_PENDENTE : ultimoTexto)
    await this.conversas.adicionarMensagem(
      this.novoId(),
      atual.id,
      'assistant',
      textoFinal,
      null,
    )
    if (bloqueio) await this.conversas.definirEstado(atual.id, 'bloqueado')

    return {
      texto: textoFinal,
      bloqueado: bloqueio !== null,
      // Persiste entre turnos, ao contrário de `bloqueado`. É por ele que a UI
      // decide mostrar o caminho de override: se dependesse de `bloqueado`, o
      // botão sumiria na mensagem seguinte e o bloqueio viraria parede — o
      // oposto do que RN-07 pede.
      bloqueioPendente,
      regraBloqueio: bloqueio?.regra ?? null,
      toolsExecutadas: executadas,
      toolsRecusadas: recusadas,
      custoUsd: custoTurno,
      tetoCustoAtingido: false,
    }
  }

  /**
   * Monta a proposta imediatamente — usado depois do override (RF-13).
   *
   * Sem isso, o agente diz "vamos seguir com o chamado" e nada acontece até a
   * pessoa digitar outra mensagem: um beco sem saída logo depois de ela ter
   * insistido. O override É o sinal de seguir.
   */
  async montarPropostaAgora(conversa: Conversa, config: ConfigValores): Promise<boolean> {
    if (conversa.proposta) return true
    if (!this.verificacoesConcluidas(conversa)) return false
    // Segunda camada da trava de RN-07. A rota de override já limpou os
    // bloqueios antes de chamar aqui, então em uso normal isto nunca reprova —
    // ele existe para que um caminho FUTURO que chame este método sem passar
    // pelo override não vire o bypass que acabamos de fechar.
    if (await this.conversas.temBloqueioPendente(conversa.id)) return false
    const custo = await this.tentarMontarProposta(conversa, config)
    if (custo > 0) await this.conversas.somarCusto(conversa.id, custo)
    return Boolean((await this.conversas.obter(conversa.id))?.proposta)
  }

  /** Ambas as tools foram TENTADAS — verificada ou falhada (RNF-18). */
  private verificacoesConcluidas(c: Conversa): boolean {
    return (
      (c.confluenceVerificado || c.confluenceFalhou) &&
      (c.historicoVerificado || c.historicoFalhou)
    )
  }

  /**
   * Tenta extrair a proposta. Falha ou contexto insuficiente **não é erro**: o
   * agente segue conversando, que é o comportamento certo quando ainda falta
   * informação — inventar campos para poder propor seria pior.
   */
  private async tentarMontarProposta(
    conversa: Conversa,
    config: ConfigValores,
  ): Promise<number> {
    if (config.tipos_chamado_permitidos.length === 0) return 0
    try {
      const r = await this.ia.extrairProposta({
        mensagens: await this.conversas.listarMensagens(conversa.id),
        tiposPermitidos: config.tipos_chamado_permitidos.map((id) => ({ id, nome: id })),
      })
      if (r.proposta) {
        await this.conversas.definirProposta(conversa.id, {
          titulo: r.proposta.titulo,
          descricao: r.proposta.descricao,
          tipoChamadoId: r.proposta.tipoChamadoId,
          prioridade: r.proposta.prioridade,
          area: r.proposta.area,
          componente: null,
        })
      }
      return r.custoEstimadoUsd
    } catch {
      return 0
    }
  }

  private async rodarTool(
    conversa: Conversa,
    nome: string,
    argumentos: Record<string, unknown>,
    config: ConfigValores,
  ) {
    if (nome === TOOLS.search_confluence.nome) {
      const topico = String(argumentos.topico ?? '').trim()
      const r = await this.executor.executarBuscaConfluence(
        conversa.solicitanteEmail,
        topico,
        config,
      )
      await this.conversas.marcarConfluenceVerificado(conversa.id, r.falhou)
      return r
    }
    const tipo = String(argumentos.tipoProblema ?? '').trim()
    const r = await this.executor.executarHistoricoJira(conversa.solicitanteEmail, tipo, config)
    await this.conversas.marcarHistoricoVerificado(conversa.id, r.falhou)
    return r
  }

  private async registrarBloqueio(
    conversa: Conversa,
    regra: string,
    motivo: string,
    evidencia: unknown,
  ): Promise<void> {
    await this.conversas.registrarBloqueio(this.novoId(), conversa.id, regra, motivo, evidencia)
    await this.auditoria.registrar({
      atorEmail: conversa.solicitanteEmail,
      acao: 'bloqueio_disparado',
      recurso: `conversa:${conversa.id}`,
      resultado: 'sucesso',
      detalhe: { regra, motivo },
    })
  }

  private async montarHistorico(conversaId: string) {
    return this.conversas.listarMensagens(conversaId)
  }
}
