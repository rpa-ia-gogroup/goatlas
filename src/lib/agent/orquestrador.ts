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
import { montarPromptAgente } from '../ia/prompts'
import { MENSAGEM_BLOQUEIO_PENDENTE, regra2Disponivel } from '../rules'
import { buscaConfigurada } from '../config/diagnostico'
import type { Auditoria } from '../audit'
import type { ConfigValores } from '../config'
import { toolAutorizada, toolsPermitidas, TOOLS } from './gate'
import { RepositorioConversas, type Conversa } from './estado'
import { ExecutorTools } from './tools'
import { tiposOferecidos, type FonteDeTipos } from '../tickets/tipos-oferecidos'
import { prosaAfirmaPrazo } from './prosa-sem-prazo'
import {
  ajustarCamposPorRotulo,
  camposParaExtracao,
  type RecusaDeAjuste,
} from '../tickets/ajuste-por-rotulo'
import { diffDeProposta, houveAjusteDeProposta, type CampoAlterado } from '../tickets/diff-de-proposta'
import type { CampoRequestType } from '../atlassian/tipos'

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
  /**
   * `RN-13` — o que a **IA** mudou nesta volta, comparado com a última proposta dela.
   *
   * ⚠️ Produzido num lugar só (`tickets/diff-de-proposta.ts`) porque tem dois consumidores:
   * a tela, que mescla com ele, e a auditoria de `FR-23`, que conta com ele. Calculado nos
   * dois lugares, a tela mesclaria por um critério e o console contaria por outro — a
   * divergência silenciosa que `D-52` (duas áreas) e `D-70` (duas listas de tipos) custaram.
   */
  readonly alterados: readonly CampoAlterado[]
  /** `FR-11` — o que a IA sugeriu para os campos do formulário, já por `fieldId`. */
  readonly camposSugeridos: Readonly<Record<string, string>>
  /** `FR-13`/`FR-14` — o que ela pediu e não coube, para a tela dizer ao lado do cartão. */
  readonly recusasDeAjuste: readonly RecusaDeAjuste[]
}

/** Um turno sem nenhuma rederivação — o estado neutro dos três campos novos. */
const SEM_REDERIVACAO = {
  alterados: [] as readonly CampoAlterado[],
  camposSugeridos: {} as Readonly<Record<string, string>>,
  recusasDeAjuste: [] as readonly RecusaDeAjuste[],
}

/**
 * O que o orquestrador precisa da Atlassian para montar o formulário do assunto vigente.
 *
 * ⚠️ Interface mínima, como `FonteDeTipos`: o orquestrador não recebe o cliente inteiro,
 * então nenhum caminho novo daqui pode chamar `criarChamado` por engano. Quem satisfaz as
 * duas em produção é o mesmo cliente, e a leitura passa pela cache de `RNF-13` que ele já
 * tem — nenhuma ida de rede a mais por turno (`R-02`).
 */
export interface FonteDeSchemaDoTipo {
  obterCamposDoTipo(
    serviceDeskId: string,
    requestTypeId: string,
  ): Promise<readonly CampoRequestType[]>
}

/** O resultado de uma rederivação, incluindo o custo — que se paga mesmo quando descarta. */
interface Rederivacao {
  readonly custoUsd: number
  readonly alterados: readonly CampoAlterado[]
  readonly camposSugeridos: Readonly<Record<string, string>>
  readonly recusasDeAjuste: readonly RecusaDeAjuste[]
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
    /**
     * 🚨 Está aqui **só** para nomear os assuntos na extração da proposta (`D-70`).
     *
     * Nada nesta classe chama a Atlassian de outra forma — quem executa tool é o
     * `ExecutorTools`, e é assim que se mantém. Sem esta fonte o prompt de extração
     * listava `- 92: 92` e o modelo escolhia a fila do chamado entre números.
     */
    private readonly fonteDeTipos: FonteDeTipos & FonteDeSchemaDoTipo,
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
        // Nada foi rederivado: `RN-07` mantém a proposta parada até o override (`D-21`).
        ...SEM_REDERIVACAO,
      }
    }

    const historico = await this.montarHistorico(conversa.id)
    const executadas: string[] = []
    const recusadas: string[] = []
    let custoTurno = 0
    let bloqueio: { texto: string; regra: string } | null = null
    let atual = conversa
    let ultimoTexto = ''
    /**
     * A extração da proposta, **em voo junto com a última ida ao modelo**.
     *
     * ⚠️ Era daqui que vinha a maior parte da latência do turno. Um turno normal faz
     * **três** chamadas em série ao provedor: (1) o modelo pede as tools, (2) depois dos
     * resultados ele escreve a resposta para a pessoa, (3) `extrairProposta` monta o
     * chamado. A (2) e a (3) partem do **mesmo** histórico — a resposta do modelo só é
     * persistida no fim de `processarMensagem`, depois da extração, então a (3) nunca viu
     * a (2). Serializar duas chamadas independentes custava uma ida inteira ao provedor
     * (segundos) em todo turno que gera proposta.
     *
     * É seguro arrancar cedo por uma razão estrutural, não por otimismo: só se arranca
     * quando as duas verificações estão concluídas, e nesse estado `toolsPermitidas`
     * devolve lista **vazia** — o ciclo seguinte não pode executar tool nenhuma, logo não
     * pode nascer bloqueio concorrente que devesse impedir a proposta. Ainda assim
     * `tentarMontarProposta` reconfere `temBloqueioPendente` antes de gravar: raciocínio
     * é documentação, e `RN-07` já foi burlada uma vez (`D-21`).
     */
    let propostaEmVoo: Promise<Rederivacao> | null = null

    /**
     * 🚨 **A rederivação arranca ANTES do laço** — é isto que faz o cartão ser negociável
     * (`FR-8`, `FR-11`). Enquanto a condição era `!atual.proposta`, a proposta nascia uma
     * vez e congelava: argumentar depois dela montada não mudava nada, e *"na verdade é no
     * Protheus"* virava uma frase simpática do agente com um chamado idêntico ao anterior.
     *
     * ⚠️ Seguro pela razão que já vale para `propostaEmVoo`, e por uma a mais:
     * (1) com as duas verificações concluídas `toolsPermitidas` devolve lista **vazia**,
     * então nenhum ciclo executa tool e não pode nascer bloqueio concorrente; e
     * (2) bloqueio de turnos anteriores já saiu pelo `return` no topo deste método.
     * O turno em que as verificações **fecham** mantém o comportamento de hoje — lá a
     * rederivação continua arrancando no fim do laço, onde ainda pode nascer bloqueio.
     */
    if (
      this.verificacoesConcluidas(atual) &&
      atual.custoUsd < config.teto_custo_conversa_usd
    ) {
      propostaEmVoo = this.tentarMontarProposta(atual, config)
    }

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
          ...SEM_REDERIVACAO,
        }
      }

      const permitidas = toolsPermitidas(atual)
      const resposta = await this.ia.chat({
        mensagens: [{ papel: 'system', conteudo: this.promptDoAgente(config) }, ...historico],
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

      // As tools deste ciclo rodaram e nada bloqueou: se já dá para montar a proposta, ela
      // arranca AGORA, em paralelo com a ida ao modelo do ciclo seguinte. Ver
      // `propostaEmVoo`. O teto de custo é o mesmo predicado do começo do laço — sem ele,
      // a proposta gastaria uma chamada que o teto acabaria de recusar (RNF-16).
      if (
        !propostaEmVoo &&
        this.verificacoesConcluidas(atual) &&
        atual.custoUsd + custoTurno < config.teto_custo_conversa_usd
      ) {
        propostaEmVoo = this.tentarMontarProposta(atual, config)
      }
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
    let rederivacao: Rederivacao | null = null
    if (propostaEmVoo) {
      // Já estava em voo — desde o início do turno, ou desde o fim do ciclo das tools.
      // Aqui só se espera o que sobrou.
      rederivacao = await propostaEmVoo
      custoTurno += rederivacao.custoUsd
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

    // `FR-6` — a prosa afirmou nível ou horas? Só MEDE: o texto vai inteiro para a pessoa,
    // e o achado (nunca a frase, `RNF-30`) vai para a auditoria. Recortar mutilaria o
    // parágrafo, e o defeito voltaria com outra redação — a escalada, se a medição mostrar
    // vazamento recorrente, é com dado (§3.6 do plano da 008).
    // ⚠️ Só o texto do MODELO é avaliado: com bloqueio quem fala é o servidor, e auditar a
    // nossa própria mensagem mediria a nossa copy, não o que o provedor escreveu.
    if (!bloqueio && !bloqueioPendente) {
      for (const achado of prosaAfirmaPrazo(textoFinal)) {
        await this.auditoria.registrar({
          atorEmail: atual.solicitanteEmail,
          acao: 'prosa_afirmou_prazo',
          recurso: `conversa:${atual.id}`,
          resultado: 'sucesso',
          detalhe: { achado },
        })
      }
    }

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
      alterados: rederivacao?.alterados ?? SEM_REDERIVACAO.alterados,
      camposSugeridos: rederivacao?.camposSugeridos ?? SEM_REDERIVACAO.camposSugeridos,
      recusasDeAjuste: rederivacao?.recusasDeAjuste ?? SEM_REDERIVACAO.recusasDeAjuste,
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
    const { custoUsd } = await this.tentarMontarProposta(conversa, config)
    if (custoUsd > 0) await this.conversas.somarCusto(conversa.id, custoUsd)
    return Boolean((await this.conversas.obter(conversa.id))?.proposta)
  }

  /**
   * O system prompt desta instalação — RNF-24, RNF-18.
   *
   * ⚠️ Os dois predicados são **reaproveitados**, não reescritos: `buscaConfigurada` é o
   * mesmo que a rota de busca aplica e `regra2Disponivel` é o mesmo que `ExecutorTools`
   * consulta antes de rodar a Regra 2. Uma condição escrita só aqui divergiria em
   * silêncio no dia em que a de origem mudasse, e o sintoma seria o agente prometendo
   * uma verificação que o servidor já não faz — que é o bug que este contexto existe para
   * fechar.
   */
  private promptDoAgente(config: ConfigValores): string {
    return montarPromptAgente({
      buscaDocumentacaoDisponivel: buscaConfigurada(config.espacos_confluence),
      historicoDisponivel: regra2Disponivel(config.regra2_exemplos_ajuste_operacional),
    })
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
  ): Promise<Rederivacao> {
    if (config.tipos_chamado_permitidos.length === 0) return { custoUsd: 0, ...SEM_REDERIVACAO }
    try {
      /**
       * 🚨 **Os tipos vão COM NOME, e sem nome não se propõe** (`D-70`).
       *
       * Antes daqui saía `config.tipos_chamado_permitidos.map((id) => ({ id, nome: id }))`,
       * e o prompt de extração listava `- 92: 92`: o modelo escolhia a fila do chamado
       * entre números, sem um único dado que distinguisse um assunto do outro. Medido em
       * 13/08/2026 — "notebook desligando sozinho" saiu como *"Problema com Nota Fiscal
       * específica ou grupo de Notas"*.
       *
       * ⚠️ **Falha de leitura NÃO cai para os ids.** Cair seria reproduzir o bug em
       * silêncio justamente quando ninguém está olhando; e a escolha certa já está
       * escrita em `RF-28` — *sem proposta o agente continua perguntando, o que é o pior
       * caso aceitável; criar na fila errada não é*. O `catch` abaixo é esse caminho, e
       * ele não custa nada à pessoa: o formulário sem IA (`D-04`) continua de pé.
       *
       * ⚠️ E a lista vazia **encerra antes da ida ao provedor**: pagar uma chamada de IA
       * para oferecer `(nenhum)` é gasto sem resultado possível (`RNF-16`).
       */
      const tiposPermitidos = await tiposOferecidos(this.fonteDeTipos, config)
      if (tiposPermitidos.length === 0) return { custoUsd: 0, ...SEM_REDERIVACAO }

      /**
       * O formulário do assunto **vigente**, para a pessoa poder corrigi-lo conversando
       * (`FR-11`). Vazio antes da primeira proposta (não há assunto de que falar) e vazio
       * quando o schema não pôde ser lido — o fail-open de `D-27`.
       */
      const schema = await this.schemaDoAssuntoVigente(conversa, config)

      const r = await this.ia.extrairProposta({
        mensagens: await this.conversas.listarMensagens(conversa.id),
        tiposPermitidos,
        camposDoAssunto: camposParaExtracao(schema),
      })
      /**
       * ⚠️ Segunda camada de `RN-07`, e ela passou a valer de verdade quando a extração
       * virou concorrente (ver `propostaEmVoo`). A chamada começa quando não há bloqueio;
       * a **gravação** confere de novo, porque entre começar e voltar passa uma ida ao
       * provedor. Bloqueio sem override não deixa proposta nascer, e um `if` que roda antes
       * do `await` não protege o que acontece depois dele.
       *
       * O custo da chamada é devolvido de qualquer forma: ela aconteceu e foi paga
       * (`RNF-16` mede gasto, não gasto aproveitado).
       */
      if (!r.proposta) return { custoUsd: r.custoEstimadoUsd, ...SEM_REDERIVACAO }
      if (await this.conversas.temBloqueioPendente(conversa.id)) {
        return { custoUsd: r.custoEstimadoUsd, ...SEM_REDERIVACAO }
      }

      /**
       * `FR-16` — o assunto mudou **neste** pedido: os campos não são preenchidos, e nem
       * recusados. Os rótulos que a IA devolveu descrevem o formulário **anterior**, e o do
       * assunto novo ela ainda não viu; avaliá-los contra o schema velho produziria recusa
       * sobre um formulário que já não é o vigente — ruído com cara de erro da pessoa.
       */
      const assuntoMudou = r.proposta.tipoChamadoId !== conversa.proposta?.tipoChamadoId
      const ajuste = assuntoMudou
        ? { valores: {}, recusas: [] }
        : ajustarCamposPorRotulo(r.proposta.campos, schema)

      const nova = {
        titulo: r.proposta.titulo,
        descricao: r.proposta.descricao,
        tipoChamadoId: r.proposta.tipoChamadoId,
        prioridade: r.proposta.prioridade,
        // ⚠️ **A IA não decide área** (`D-52`). O extrator ainda pode devolver uma —
        // ela vem do texto da conversa —, e usá-la produzia a divergência que a
        // auditoria de `D-47` achou: o cartão mostrava a área adivinhada e o vínculo
        // gravava a de `resolverArea`, sem nada na tela indicando. Quem preenche este
        // campo agora é `garantirAreaNaProposta`, com a fonte organizacional.
        area: null,
        componente: null,
        motivoPrioridade: r.proposta.motivoPrioridade,
        campos: ajuste.valores,
      }
      const alterados = diffDeProposta(conversa.propostaDaIa, nova)
      // Vigente **e** base na mesma escrita (`RN-13`): gravar só uma faria o diff do turno
      // seguinte comparar contra a proposta errada, e o sintoma apareceria turnos depois.
      await this.conversas.definirPropostaDaIa(conversa.id, nova)

      await this.registrarAjuste(conversa, alterados, ajuste.recusas)
      return {
        custoUsd: r.custoEstimadoUsd,
        alterados,
        camposSugeridos: ajuste.valores,
        recusasDeAjuste: ajuste.recusas,
      }
    } catch {
      return { custoUsd: 0, ...SEM_REDERIVACAO }
    }
  }

  /**
   * O schema do assunto vigente, ou vazio.
   *
   * ⚠️ **Nada aqui lança** — `D-27`, o mesmo fail-open de `RF-62`: schema ilegível não
   * ajusta campo nenhum e **não** derruba o resto do turno. Fail-closed aqui seria deixar de
   * corrigir o título por causa de uma queda na leitura de um formulário.
   */
  private async schemaDoAssuntoVigente(
    conversa: Conversa,
    config: ConfigValores,
  ): Promise<readonly CampoRequestType[]> {
    const tipo = conversa.proposta?.tipoChamadoId
    const desk = config.service_desk_id
    if (!tipo || !desk) return []
    try {
      return await this.fonteDeTipos.obterCamposDoTipo(desk, tipo)
    } catch {
      return []
    }
  }

  /**
   * `FR-23` — o registro do ajuste: **nomes** de campo, nunca valores.
   *
   * ⚠️ O conteúdo do chamado não entra na auditoria (`RN-10`, `RNF-30`): guardar o título
   * gravaria o relato da pessoa numa tabela com piso de retenção de 180 dias (`D-17`).
   *
   * ⚠️ E motivo reescrito sozinho **não** é ajuste (`ScC-9`): o modelo redige o motivo de
   * novo a cada rederivação, então contá-lo faria *toda* mensagem virar `proposta_ajustada`
   * e a pergunta "em quais campos a argumentação pega?" mediria variação de redação.
   */
  private async registrarAjuste(
    conversa: Conversa,
    alterados: readonly CampoAlterado[],
    recusas: readonly RecusaDeAjuste[],
  ): Promise<void> {
    if (houveAjusteDeProposta(alterados)) {
      await this.auditoria.registrar({
        atorEmail: conversa.solicitanteEmail,
        acao: 'proposta_ajustada',
        recurso: `conversa:${conversa.id}`,
        resultado: 'sucesso',
        detalhe: { campos: alterados },
      })
    }
    for (const recusa of recusas) {
      await this.auditoria.registrar({
        atorEmail: conversa.solicitanteEmail,
        acao: 'ajuste_recusado',
        recurso: `conversa:${conversa.id}`,
        resultado: 'negado',
        detalhe: { rotulo: recusa.rotulo, motivo: recusa.motivo },
      })
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
