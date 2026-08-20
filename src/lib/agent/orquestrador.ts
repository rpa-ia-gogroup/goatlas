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
import { INVESTIGADOR_DESLIGADO, type Investigador } from '../investigador/registro'
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
  /** `FR-2`/`FR-3` (spec 012) — o que aconteceu com o cartão neste turno. */
  readonly atualizacaoDoCartao: AtualizacaoDoCartao
}

/**
 * O que aconteceu com o cartão neste turno — `FR-3` (spec 012).
 *
 * 🚨 **Quatro estados, e não um booleano, porque a tela precisa de três frases e um
 * silêncio.** Antes disto, "a IA rederivou e nada mudou" e "a IA não conseguiu rederivar"
 * chegavam à tela como o mesmo `alterados: []` — e o segundo caso é o defeito medido em
 * 20/08/2026: a pessoa contou o motivo do pedido, o cartão ficou com o texto do turno
 * anterior, e nada disse que a mensagem dela não entrou. São frases opostas, como
 * `anexosIndisponiveis` × `[]` (`D-45`).
 *
 * - `nao_havia` — não houve rederivação, ou ela não produziu proposta **e não havia
 *   cartão**. Não há o que avisar: a tela fica calada.
 * - `nao_conseguiu` — não produziu proposta **e existe cartão vigente**. O único caso que a
 *   tela comenta.
 * - `atualizado` / `sem_mudanca` — derivados de `alterados`, no mesmo lugar que produz o
 *   diff (`RN-13`, um produtor só).
 */
export type AtualizacaoDoCartao = 'atualizado' | 'sem_mudanca' | 'nao_conseguiu' | 'nao_havia'

/** Um turno sem nenhuma rederivação — o estado neutro dos campos de negociação. */
const SEM_REDERIVACAO = {
  alterados: [] as readonly CampoAlterado[],
  camposSugeridos: {} as Readonly<Record<string, string>>,
  recusasDeAjuste: [] as readonly RecusaDeAjuste[],
  atualizacaoDoCartao: 'nao_havia' as AtualizacaoDoCartao,
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
  readonly atualizacaoDoCartao: AtualizacaoDoCartao
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
    /**
     * O registro de depuração do turno — spec 009, `FR-5`.
     *
     * ⚠️ **Opcional com no-op como default, nunca `null`**: os testes que já existiam
     * constroem o orquestrador com seis argumentos, e um parâmetro obrigatório aqui
     * transformaria um instrumento de investigação em um patch de trinta arquivos de teste.
     * `INVESTIGADOR_DESLIGADO` é o mesmo objeto de `contexto.ts` com a config desligada.
     */
    private readonly investigador: Investigador = INVESTIGADOR_DESLIGADO,
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
    this.investigador.emConversa(conversa.id)
    this.investigador.registrar({
      tipo: 'mensagem_usuario',
      origem: 'usuario',
      conversaId: conversa.id,
      resumo: `Mensagem da pessoa (${textoUsuario.length} caracteres)`,
      dados: { texto: textoUsuario, estadoDaConversa: conversa.estado },
    })

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
      /**
       * `FR-5` — a ida ao modelo, dos dois lados.
       *
       * ⚠️ **O histórico vai sem o system prompt.** Ele é configuração da instalação
       * (`D-33`), é o mesmo em toda requisição, e repeti-lo por ciclo encheria a tabela com
       * o mesmo texto — a razão pela qual `D-54` também o deixa fora da transcrição.
       */
      this.investigador.registrar({
        tipo: 'ia_chat',
        origem: 'ia',
        conversaId: atual.id,
        resumo: `Ciclo ${ciclo + 1}: modelo respondeu ${resposta.texto.length} caracteres e propôs ${resposta.toolsPropostas.length} ferramenta(s)`,
        custoUsd: resposta.custoEstimadoUsd,
        dados: {
          ciclo: ciclo + 1,
          toolsPermitidas: permitidas.map((t) => t.nome),
          historicoEnviado: historico.map((m) => ({
            papel: m.papel,
            toolNome: m.toolNome ?? null,
            conteudo: m.conteudo,
          })),
          textoDoModelo: resposta.texto,
          toolsPropostas: resposta.toolsPropostas,
        },
      })

      if (resposta.toolsPropostas.length === 0) break

      for (const proposta of resposta.toolsPropostas) {
        // A camada que sobrevive a prompt injection e a nome inventado: o servidor
        // só reconhece o que ele mesmo autorizou neste turno.
        if (!toolAutorizada(atual, proposta.nome)) {
          recusadas.push(proposta.nome)
          this.investigador.registrar({
            tipo: 'tool_recusada',
            origem: 'servidor',
            conversaId: atual.id,
            resumo: `Ferramenta "${proposta.nome}" recusada — não está autorizada neste momento`,
            dados: {
              toolProposta: proposta.nome,
              argumentos: proposta.argumentos,
              permitidas: permitidas.map((t) => t.nome),
            },
          })
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
        // `FR-5` — o que a tool devolveu **ao modelo**. É o texto que decide o turno
        // seguinte, e sem ele "a busca não achou nada" e "a busca nem foi configurada"
        // continuam indistinguíveis depois do fato (`D-33`, `D-41`).
        this.investigador.registrar({
          tipo: 'tool_executada',
          origem: 'servidor',
          conversaId: atual.id,
          resumo: `Ferramenta "${proposta.nome}" executada${r.falhou ? ' e FALHOU' : ''}`,
          custoUsd: r.custoUsd,
          dados: {
            tool: proposta.nome,
            argumentos: proposta.argumentos,
            falhou: r.falhou,
            paraModelo: r.paraModelo,
            bloqueou: Boolean(r.veredito?.bloquear),
          },
        })
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
    /**
     * `FR-5` — o que a pessoa leu, e se foi o modelo quem falou.
     *
     * ⚠️ **`textoDoModeloDescartado` é o campo que importa aqui.** Com bloqueio pendente o
     * servidor **substitui** a resposta do modelo (`D-21`), e sem esta linha o registro
     * mostraria a frase do servidor como se fosse a do provedor — a mesma confusão que já
     * fez o agente mandar clicar num botão que não estava na tela.
     */
    this.investigador.registrar({
      tipo: 'resposta_agente',
      origem: 'servidor',
      conversaId: atual.id,
      resumo: bloqueio
        ? 'Resposta do turno: mensagem de BLOQUEIO (texto do modelo descartado)'
        : bloqueioPendente
          ? 'Resposta do turno: bloqueio pendente (texto do modelo descartado)'
          : 'Resposta do turno: texto do modelo',
      custoUsd: custoTurno,
      dados: {
        textoExibido: textoFinal,
        textoDoModeloDescartado: Boolean(bloqueio || bloqueioPendente),
        textoDoModelo: ultimoTexto,
        bloqueioPendente,
        toolsExecutadas: executadas,
        toolsRecusadas: recusadas,
        // O que a tela decide com isto: sem proposta não há cartão (`FR-7` da 008).
        temProposta: Boolean(atual.proposta),
      },
    })
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
      atualizacaoDoCartao:
        rederivacao?.atualizacaoDoCartao ?? SEM_REDERIVACAO.atualizacaoDoCartao,
    }
  }

  /**
   * Monta a proposta imediatamente — usado depois do override (RF-13) e pelo botão de
   * `RF-81` (spec 011).
   *
   * Sem isso, o agente diz "vamos seguir com o chamado" e nada acontece até a
   * pessoa digitar outra mensagem: um beco sem saída logo depois de ela ter
   * insistido. O override É o sinal de seguir.
   *
   * 🚨 **`forcarFechamento` não afrouxa trava nenhuma** (`RF-81`). As duas verificações de
   * `RF-08` continuam sendo pré-condição logo abaixo, o bloqueio de `RN-07` continua
   * descartando a proposta na gravação, a allowlist de `RF-28` continua valendo e `RF-17`
   * — a confirmação — continua sendo o que autoriza criar. O que muda é **uma** coisa: o
   * modelo deixa de decidir sozinho quando parar de perguntar.
   *
   * ⚠️ E com `forcarFechamento` a proposta é **rederivada mesmo que já exista**: o botão é
   * o pedido de fechar com o que há agora, e devolver a proposta velha ignoraria as
   * mensagens que vieram depois dela.
   */
  async montarPropostaAgora(
    conversa: Conversa,
    config: ConfigValores,
    opcoes: { readonly forcarFechamento?: boolean } = {},
  ): Promise<boolean> {
    if (conversa.proposta && !opcoes.forcarFechamento) return true
    if (!this.verificacoesConcluidas(conversa)) return false
    // Segunda camada da trava de RN-07. A rota de override já limpou os
    // bloqueios antes de chamar aqui, então em uso normal isto nunca reprova —
    // ele existe para que um caminho FUTURO que chame este método sem passar
    // pelo override não vire o bypass que acabamos de fechar.
    if (await this.conversas.temBloqueioPendente(conversa.id)) return false
    const { custoUsd } = await this.tentarMontarProposta(conversa, config, opcoes)
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
    /** `RF-81` (spec 011) — a pessoa clicou em "montar o chamado agora". */
    opcoes: { readonly forcarFechamento?: boolean } = {},
  ): Promise<Rederivacao> {
    if (config.tipos_chamado_permitidos.length === 0) {
      this.semProposta(conversa, 'allowlist_de_tipos_vazia', {
        detalhe: 'Nenhum tipo de chamado liberado na configuração (RF-28).',
      })
      return { custoUsd: 0, ...SEM_REDERIVACAO }
    }
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
      if (tiposPermitidos.length === 0) {
        this.semProposta(conversa, 'nenhum_tipo_com_nome', {
          detalhe:
            'A allowlist tem tipos, mas nenhum deles saiu do service desk configurado com nome (D-70).',
          idsNaAllowlist: config.tipos_chamado_permitidos,
          serviceDeskId: config.service_desk_id,
        })
        return { custoUsd: 0, ...SEM_REDERIVACAO }
      }

      /**
       * O formulário do assunto **vigente**, para a pessoa poder corrigi-lo conversando
       * (`FR-11`). Vazio antes da primeira proposta (não há assunto de que falar) e vazio
       * quando o schema não pôde ser lido — o fail-open de `D-27`.
       */
      const schema = await this.schemaDoAssuntoVigente(conversa, config)

      /**
       * `FR-1` (spec 012) — **cartão que existe não volta a "não estou pronto".**
       *
       * Com proposta vigente, a pergunta da extração deixa de ser "está pronto?" e passa a
       * ser "o que muda?". Sem isto, o turno seguinte reavaliava a prontidão do zero contra
       * um gabarito de incidente ("o que aconteceu, desde quando") — e num pedido de acesso
       * ele nunca casa: medido em 20/08/2026, a pessoa contou o motivo do pedido e o cartão
       * ficou com o texto do turno anterior, sem nada na tela.
       *
       * ⚠️ **O botão ganha** (`instrucaoDeFechamento`, em `ia/cliente.ts`): ele é pedido
       * explícito daquele turno, e o texto que vai ao modelo é outro.
       */
      const cartaoVigente = Boolean(conversa.proposta)
      const r = await this.ia.extrairProposta({
        mensagens: await this.conversas.listarMensagens(conversa.id),
        tiposPermitidos,
        camposDoAssunto: camposParaExtracao(schema),
        ...(opcoes.forcarFechamento ? { forcarFechamento: true } : {}),
        ...(cartaoVigente ? { cartaoVigente: true } : {}),
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
      if (!r.proposta) {
        /**
         * 🚨 **O evento que responde à pergunta de 14/08/2026** (`FR-6`).
         *
         * `interpretarProposta` devolve `null` em quatro situações — o modelo não se
         * declarou pronto, título ou descrição curtos demais, prioridade fora da união, ou
         * `tipoChamadoId` fora da allowlist (`RF-28`). As quatro chegam aqui **idênticas**,
         * e a pessoa vê a mesma coisa nas quatro: o cartão nunca aparece. É por isso que a
         * resposta crua do modelo vai junto: sem ela, o registro só confirmaria o que já se
         * sabia — que não houve proposta.
         */
        this.semProposta(conversa, 'extracao_sem_proposta', {
          detalhe:
            'O modelo respondeu e a proposta foi recusada na interpretação — a resposta crua diz qual das condições falhou.',
          respostaBrutaDoModelo: r.respostaBruta ?? null,
          tiposOferecidos: tiposPermitidos,
          camposDoAssunto: camposParaExtracao(schema),
        })
        /**
         * `FR-2` — a vigente **permanece**, e a tela precisa poder dizer isso. "Não mudou
         * nada" e "não consegui atualizar" são frases opostas; sem esta distinção, a
         * segunda chegava à tela disfarçada de primeira e a mensagem da pessoa evaporava em
         * silêncio.
         */
        return {
          custoUsd: r.custoEstimadoUsd,
          ...SEM_REDERIVACAO,
          atualizacaoDoCartao: cartaoVigente ? 'nao_conseguiu' : 'nao_havia',
        }
      }
      if (await this.conversas.temBloqueioPendente(conversa.id)) {
        this.semProposta(conversa, 'bloqueio_pendente_na_gravacao', {
          detalhe:
            'A proposta veio pronta e foi descartada: nasceu um bloqueio enquanto a extração estava em voo (RN-07).',
        })
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
      /**
       * `FR-7` — a proposta com **valores**, ao contrário da auditoria, que carrega só os
       * nomes dos campos (`RN-10`). Aqui o valor é o ponto: é ele que se compara com o que a
       * pessoa disse ter pedido.
       */
      this.investigador.registrar({
        tipo: 'proposta_rederivada',
        origem: 'ia',
        conversaId: conversa.id,
        resumo:
          alterados.length > 0
            ? `Proposta rederivada — a IA mudou: ${alterados.join(', ')}`
            : 'Proposta rederivada — a IA não mudou nada',
        custoUsd: r.custoEstimadoUsd,
        dados: {
          proposta: nova,
          alterados,
          assuntoMudou,
          camposSugeridos: ajuste.valores,
          recusasDeAjuste: ajuste.recusas,
          baseAnterior: conversa.propostaDaIa ?? null,
          /**
           * `FR-7` — qual modo fechou este cartão. Sem ele, "fechou porque a pessoa clicou
           * no botão" e "fechou porque já havia cartão" ficam indistinguíveis no registro,
           * e a investigação volta a depender de adivinhação.
           */
          modo: opcoes.forcarFechamento
            ? 'botao'
            : cartaoVigente
              ? 'cartao_vigente'
              : 'primeiro_cartao',
        },
      })
      return {
        custoUsd: r.custoEstimadoUsd,
        alterados,
        camposSugeridos: ajuste.valores,
        recusasDeAjuste: ajuste.recusas,
        // Derivado do MESMO `alterados` que a tela mescla e a auditoria conta (`RN-13`).
        atualizacaoDoCartao: alterados.length > 0 ? 'atualizado' : 'sem_mudanca',
      }
    } catch (e) {
      // ⚠️ Este `catch` engolia a exceção **inteira**, e era o buraco mais fundo: leitura de
      // tipos, leitura de schema e a ida ao provedor caem todas aqui, e o resultado para
      // quem usa é sempre o mesmo — o agente continua perguntando, para sempre.
      this.semProposta(conversa, 'excecao_na_extracao', {
        detalhe: 'A extração lançou. O agente segue conversando (RF-28), e ninguém é avisado.',
        classe: e instanceof Error ? e.name : typeof e,
        mensagem: e instanceof Error ? e.message : String(e),
      })
      return { custoUsd: 0, ...SEM_REDERIVACAO }
    }
  }

  /**
   * O registro de **por que não houve proposta** — spec 009, `FR-6`.
   *
   * ⚠️ **Uma função só, e um `motivo` fechado por chamada.** As seis saídas sem proposta
   * pedem trabalho diferente de quem investiga (configurar allowlist · conferir o service
   * desk · ler a resposta do modelo · usar o override · olhar a exceção), e é exatamente a
   * distinção que `area_indisponivel` × `area_nao_encontrada` já defende em outro canto do
   * app. Uma linha genérica "não houve proposta" repetiria o silêncio que este arquivo
   * inteiro existe para desfazer.
   */
  private semProposta(
    conversa: Conversa,
    motivo: string,
    dados: Readonly<Record<string, unknown>>,
  ): void {
    this.investigador.registrar({
      tipo: 'ia_extracao_recusada',
      origem: 'ia',
      conversaId: conversa.id,
      resumo: `Sem proposta: ${motivo}`,
      dados: { motivo, ...dados },
    })
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
    // `FR-5` — com a evidência, que a auditoria não carrega (`RN-10`). É ela que responde
    // "qual página o app achou que resolvia o caso dessa pessoa?".
    this.investigador.registrar({
      tipo: 'bloqueio',
      origem: 'servidor',
      conversaId: conversa.id,
      resumo: `Bloqueio por ${regra} — a conversa fica parada até o override (RF-13)`,
      dados: { regra, motivo, evidencia },
    })
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
