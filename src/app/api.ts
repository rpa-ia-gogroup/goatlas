/**
 * Cliente da API do próprio app.
 *
 * ⚠️ **Nada aqui fala com a Atlassian ou com a IA** (RNF-02). Só com `/api/*`. A
 * identidade vem do edge; o navegador não envia e não escolhe e-mail.
 */

import type { No } from '../lib/confluence/sanitizar'

export interface Identidade {
  readonly email: string
  readonly nome: string
  readonly isAdmin: boolean
  /** App publicado em modo demonstração: nada é criado no Jira. */
  readonly modoDemo: boolean
  /**
   * Lê dado REAL e recusa toda escrita — o estado de desenvolvimento com credencial
   * real. Diferente de `modoDemo`: aqui o que você lê é verdadeiro.
   */
  readonly somenteLeitura: boolean
}

export type EstadoVerificacao = 'pendente' | 'ok' | 'falhou'

export interface Proposta {
  readonly titulo: string
  readonly descricao: string
  readonly tipoChamadoId: string
  readonly prioridade: Prioridade
  readonly area: string | null
  readonly componente: string | null
}

export type Prioridade = 'critica' | 'alta' | 'normal'

export interface RespostaTurno {
  readonly texto: string
  readonly bloqueado: boolean
  /** Bloqueio sem override, inclusive de turnos anteriores (RF-13, RN-07). */
  readonly bloqueioPendente: boolean
  readonly regraBloqueio: string | null
  readonly verificacoes: {
    readonly confluence: EstadoVerificacao
    readonly historico: EstadoVerificacao
  }
  readonly podeConfirmar: boolean
  /**
   * O que a IA leu de cada anexo desta conversa — spec 007, `FR-5`/`FR-5b`/`FR-7`.
   *
   * ⚠️ `descricao` vem `null` quando a análise foi **irrelevante**: a descrição existe e vai ao
   * chamado no fim, mas a tela **não diz nada** sobre a foto do crachá de alguém. `estado` é o
   * que distingue "ainda estou lendo" de "não sei ler este formato" — três frases diferentes,
   * porque pedem ações diferentes.
   */
  readonly analisesAnexo?: readonly {
    readonly nomeArquivo: string
    readonly estado: string
    readonly descricao: string | null
  }[]
  readonly proposta: Proposta | null
  /**
   * `RF-18` — o **nome** do assunto, resolvido pelo servidor (`D-53`).
   *
   * Fora de `Proposta` de propósito: é rótulo de exibição, não parte do que se grava.
   * `null` = a lista de tipos não respondeu, ou o tipo saiu da allowlist.
   */
  readonly tipoNome: string | null
  readonly tetoCustoAtingido: boolean
  /**
   * Por que **este** nível para **este** caso — `RF-68`, `FR-1`/`FR-2`.
   *
   * Já validado pelo servidor (duas frases, português, sem id interno): `null` significa
   * "não veio justificada", e a tela **declara** isso em vez de silenciar (`FR-5`,
   * precedente de `D-53`). ⚠️ Vem da **base da IA**, não da proposta vigente — editar a
   * prioridade à mão não apaga o motivo (`plan.md` §4).
   */
  readonly motivoPrioridade: string | null
  /**
   * De **quem** é o motivo — `FR-2b`.
   *
   * A prioridade que a IA sugeriu neste turno. Quando ela difere da que está na tela (a
   * pessoa mexeu no seletor), o motivo é apresentado **atribuído à sugestão** (*"a sugestão
   * era alta, porque…"*) e nunca como justificativa do nível escolhido — senão a tela
   * afirma um porquê de um nível que ninguém escolheu (`SC-2`, `SC-2b`).
   */
  readonly prioridadeSugerida: Prioridade | null
  /**
   * Valores que a IA sugeriu para os campos do formulário, por `fieldId` — `FR-11`.
   *
   * ⚠️ Sai por `fieldId` porque quem preenche o formulário é este navegador, e ele **já**
   * conhece os `fieldId` do schema que ele mesmo lê. `RNF-30` fala de **prompt e tela**: o
   * id nunca é exibido, e é o rótulo que atravessa a fronteira do modelo.
   */
  readonly camposSugeridos?: Readonly<Record<string, string>>
  /**
   * O que a IA **mudou** nesta volta — `RN-13`, `FR-8`/`FR-9`.
   *
   * 🚨 É o servidor que decide isso, comparando contra a última proposta **da IA** (nunca
   * contra a vigente, que carrega a edição da pessoa). A tela usa esta lista para o merge:
   * campo aqui vale o da IA, campo fora daqui continua como a pessoa deixou. Calcular no
   * cliente faria a tela mesclar por um critério e a auditoria contar por outro.
   */
  readonly alterados?: readonly string[]
  /**
   * Ajuste pedido em texto que **não** foi aplicado — `FR-13`/`FR-14`.
   *
   * ⚠️ Mora aqui, e não na prosa do agente, porque a prosa é escrita **antes** de a decisão
   * voltar (as duas chamadas são paralelas, `D-32`) — a mesma razão de `FR-6`. Na tela isto
   * aparece junto do cartão, ao lado do que explica.
   */
  readonly recusasDeAjuste?: readonly {
    readonly rotulo: string
    readonly motivo: 'campo_inexistente' | 'opcao_inexistente'
    /** Rótulos das opções válidas, quando o motivo é `opcao_inexistente`. Nunca ids. */
    readonly opcoes?: readonly string[]
  }[]
  /** O assunto mudou neste turno — a tela diz, e os campos do anterior somem (`FR-10`). */
  readonly assuntoMudou?: boolean
  /**
   * O que aconteceu com o cartão neste turno — `FR-2`/`FR-3` (spec 012).
   *
   * ⚠️ **Não é derivável de `alterados`**: lista vazia significa "a IA não mudou nada" **e**
   * "a IA não conseguiu rederivar", e as duas frases são opostas. Só `nao_conseguiu` vira
   * aviso na tela; `sem_mudanca` e `nao_havia` são silêncio.
   */
  readonly atualizacaoDoCartao?: 'atualizado' | 'sem_mudanca' | 'nao_conseguiu' | 'nao_havia'
  /**
   * A frase de `FR-5`, pronta, quando o motivo não pôde ser exibido.
   *
   * ⚠️ Vem do servidor em vez de a tela inventá-la porque **a rota do override** mostra o
   * mesmo cartão: duas redações da mesma ausência é a divergência silenciosa de sempre.
   */
  readonly motivoIndisponivel?: string | null
  /**
   * Há o que negociar? — `FR-21`.
   *
   * `false` sem proposta e `false` com bloqueio pendente. É o servidor quem sabe as duas
   * coisas, e é dele que a tela tira a decisão de exibir o aviso: um aviso dizendo
   * "conversar pode reescrever o cartão" na frente de uma conversa **sem** cartão seria a
   * parede que `RF-13`/`RN-07` proíbem.
   */
  readonly podeNegociar?: boolean
}

export interface ChamadoResumo {
  readonly issueKey: string
  readonly titulo: string | null
  readonly status: string
  readonly prioridade: Prioridade | null
  readonly atualizadoEm: string | null
  readonly via: 'conversa' | 'formulario'
  readonly verificadoRegras: boolean
  /** RF-19 - area no momento da abertura. `null` = mapa nao conhecia o e-mail. */
  readonly area: string | null
}

export interface RespostaMeusChamados {
  readonly itens: readonly ChamadoResumo[]
  /**
   * Status que EXISTEM nos chamados da pessoa (T-241).
   *
   * Vem do servidor porque os status sao do workflow do JSM - configuracao do projeto,
   * nao do app. Uma lista fixa no front seria hardcode de configuracao alheia (`RNF-25`),
   * e ficaria errada no dia em que o time de tech renomear uma coluna.
   */
  readonly statusDisponiveis: readonly string[]
  /** Total antes do filtro - e o que permite dizer "3 de 12". */
  readonly total: number
}

/** T-242 - acao que o workflow do JSM oferece ao cliente. Lista vazia = sem botao. */
export interface TransicaoDisponivel {
  readonly id: string
  readonly nome: string
}

export interface ComentarioPublico {
  readonly id: string
  /** Já **sem** o prefixo de autoria do `D-13` — quem o remove é o servidor (`D-43`). */
  readonly corpo: string
  /**
   * O nome da CONTA que registrou o comentário no Jira.
   *
   * ⚠️ **Não é uma afirmação de autoria.** Sob proxy total (`D-01`) esta pode ser a
   * conta de serviço, que hoje é a conta pessoal de um colaborador — foi exatamente
   * o que a tela imprimia como autor do comentário da própria pessoa (`D-43`).
   */
  readonly autorNome: string
  readonly criadoEm: string
  /**
   * `true` = a pessoa que está lendo escreveu este comentário, pelo atlas.
   *
   * Vem do servidor, do **mesmo** predicado que o SLA de `RF-46` usa. A tela não
   * recalcula: condição escrita só aqui divergiria em silêncio da de lá.
   */
  readonly doSolicitante: boolean
}

export interface DetalheChamado {
  readonly chamado: {
    readonly issueKey: string
    readonly titulo: string
    readonly descricao: string
    readonly status: string
    readonly prioridade: Prioridade | null
    readonly criadoEm: string
    readonly atualizadoEm: string
  }
  readonly via: 'conversa' | 'formulario'
  readonly verificadoRegras: boolean
  readonly area: string | null
  readonly comentarios: readonly ComentarioPublico[]
  /** `RF-31` — os arquivos que a pessoa pode ver, com o link **deste app** (`RNF-02`). */
  readonly anexos: readonly AnexoDoChamado[]
  /**
   * `true` = a Atlassian não respondeu e o que está na tela veio do que NÓS gravamos
   * (`RNF-19`). O chamado existe; o estado dele é que não pôde ser lido.
   */
  readonly degradado: boolean
  /** `true` = não deu para buscar as respostas. Diferente de "não há respostas ainda". */
  readonly comentariosIndisponiveis: boolean
  /**
   * `true` = **não deu para saber** quais anexos existem, nunca "não há anexos".
   *
   * A tela precisa das duas frases separadas pelo mesmo motivo de
   * `comentariosIndisponiveis`: quem lê "este chamado não tem anexos" sobre o próprio
   * print manda tudo de novo.
   */
  readonly anexosIndisponiveis: boolean
}

export interface AnexoDoChamado {
  readonly nomeArquivo: string
  readonly tipoDeclarado: string | null
  readonly tamanhoBytes: number | null
  readonly criadoEm: string | null
  readonly url: string
  /**
   * `RF-31` — de onde veio a certeza de que este arquivo pode aparecer.
   *
   * `voce` = o app o enviou a pedido desta pessoa · `time` = veio da Atlassian e passou
   * pela interseção de `D-45` · `atlas` = o app o **gerou** (a transcrição de `RF-23`).
   * A tela **diz** isso em palavras: quem mandou o print precisa reconhecê-lo, "o time
   * respondeu com um arquivo" é outra notícia, e nenhuma das duas descreve um arquivo
   * que ninguém enviou.
   */
  readonly origem?: 'voce' | 'time' | 'atlas'
}

export interface TipoChamado {
  readonly id: string
  readonly nome: string
  readonly descricao: string | null
}

/* ---------- campos adicionais do formulário sem IA (RF-27, T-130) ------ */

/**
 * ⚠️ `'anexo'` existe no contrato do servidor e **nunca chega em `itens`**: a rota o
 * filtra (T-406c), porque quem desenha o seletor de arquivo é `PerguntaDeAnexo`. Ele fica
 * aqui para o tipo não mentir sobre o que o servidor pode devolver.
 */
export type TipoCampoRequestType = 'texto' | 'texto_longo' | 'selecao' | 'anexo'

export interface OpcaoCampoRequestType {
  readonly id: string
  readonly rotulo: string
}

export interface CampoRequestType {
  readonly fieldId: string
  readonly rotulo: string
  readonly obrigatorio: boolean
  readonly tipo: TipoCampoRequestType
  /**
   * O campo guarda lista de valores (`D-39`). A tela **não** muda por causa disto — ela
   * segue oferecendo escolha única, e quem embrulha o valor em `[…]` é o servidor. Está
   * aqui para o contrato não mentir sobre o que a rota devolve.
   */
  readonly multiplo?: boolean
  readonly opcoes: readonly OpcaoCampoRequestType[]
}

/**
 * RF-63 — o que aconteceu com o anexo, **separado** do que aconteceu com o chamado.
 *
 * `adiado` é o caso de `SC-07b`: a criação foi para a fila e o arquivo não vai com ela.
 */
export interface ResultadoAnexo {
  readonly estado: 'sem_anexo' | 'anexado' | 'parcial' | 'falhou' | 'adiado'
  readonly anexados: readonly string[]
  readonly falharam: readonly string[]
  readonly mensagem: string
}

export interface ResultadoCriacao {
  readonly issueKey: string | null
  readonly estado: 'criado' | 'pendente'
  readonly duplicada: boolean
  readonly verificadoRegras: boolean
  readonly anexo: ResultadoAnexo
  readonly prioridade: Prioridade
  readonly slaPrimeiraRespostaHoras: number
  readonly mensagem: string
}

/* ---------- Confluence (RF-37, RF-39) ---------------------------------- */

export interface ResultadoBusca {
  readonly id: string
  readonly titulo: string
  /** Chave do espaço — diz de qual base o texto veio, e é a allowlist em ação. */
  readonly espaco: string
  readonly trecho: string
  /** Insumo da Regra 1 (RF-09). Não é exibido: número que a pessoa não pode usar é ruído. */
  readonly score: number
  readonly urlOriginal: string
}

export interface RespostaBusca {
  readonly termo: string
  /**
   * Id desta busca (`T-116`). A tela o devolve ao abrir uma página, e é assim que o
   * mapa de lacunas distingue "não existe documentação" de "existe e não convence".
   */
  readonly buscaId: string | null
  /**
   * `false` = nenhum espaço na allowlist. Zero resultados por falta de configuração
   * e zero por falta de documentação são problemas de pessoas diferentes, e a tela
   * **precisa** dizer qual dos dois foi.
   */
  readonly buscaConfigurada: boolean
  readonly itens: readonly ResultadoBusca[]
}

export interface NoDaArvore {
  readonly id: string
  readonly titulo: string
}

export interface Ancestral {
  readonly id: string
  readonly titulo: string
}

export interface EspacoNavegavel {
  readonly chave: string
  readonly nome: string
  /** Página inicial — é por ela que a navegação começa. */
  readonly homepageId: string
}

export interface NivelDaArvore {
  readonly espaco: { readonly chave: string; readonly nome: string }
  readonly pai: NoDaArvore
  readonly ancestrais: readonly Ancestral[]
  readonly itens: readonly NoDaArvore[]
}

export interface PaginaLida {
  readonly id: string
  readonly titulo: string
  readonly espaco: string
  readonly atualizadoEm: string
  readonly urlOriginal: string
  /**
   * Árvore de nós **já sanitizada** no servidor (RNF-06). Não é HTML, e é por isso
   * que não existe caminho em que conteúdo do Confluence vire marcação no navegador.
   */
  /**
   * Caminho até a página (`RF-41`), já filtrado por `RN-06`: ele **para** no primeiro
   * ancestral não exposto, então pode vir curto ou vazio — e isso é correto, não um bug
   * de dado faltando.
   */
  readonly ancestrais: readonly Ancestral[]
  readonly nos: readonly No[]
  readonly truncado: boolean
}

/* ---------- notificacao e preferencia (RF-44, RF-45) -------------------- */

export type CanalNotificacao = 'chat' | 'email' | 'nenhum'

export interface Preferencia {
  readonly canal: CanalNotificacao
  readonly destino: string | null
  /** `false` = e o default da config, nao uma escolha da pessoa. */
  readonly escolhidaPelaPessoa: boolean
  /**
   * `false` = **Q11 sem resposta**: ninguem definiu canal ainda.
   *
   * A tela precisa distinguir isso de "escolhi nao receber": as duas mostram `nenhum`, e
   * so uma e decisao de quem esta lendo.
   */
  readonly canalPadraoDefinido: boolean
}

export type TipoEventoNotificacao =
  | 'chamado_criado'
  | 'status_alterado'
  | 'comentario_publico'
  | 'sla_em_risco'

export interface AvisoRecebido {
  readonly issueKey: string
  readonly tipoEvento: TipoEventoNotificacao
  readonly titulo: string
  readonly estado: 'pendente' | 'enviada' | 'falha' | 'suprimida'
  readonly canal: CanalNotificacao | null
  readonly criadoEm: string
}

/**
 * Espelha `ConfigValores` do servidor — **todas** as chaves, não só as editáveis.
 *
 * O console edita menos do que isto (`D-25`), mas o espelho precisa ser completo:
 * é ele que `diagnosticar()` recebe, e uma chave a menos aqui viraria um
 * diagnóstico que não enxerga metade da configuração.
 */
export interface ConfigValores {
  readonly dominios_permitidos: string[]
  readonly admins: string[]
  readonly espacos_confluence: string[]
  readonly labels_bloqueadas: string[]
  readonly tipos_chamado_permitidos: string[]
  readonly service_desk_id: string | null
  readonly org_id: string | null
  readonly assentos_ocioso_dias: number
  readonly custo_mensal_por_produto: Record<string, number>
  readonly regra1_threshold_score: number
  readonly regra2_threshold_recorrencia: number
  readonly regra2_janela_dias: number
  readonly regra2_campo_agrupamento: string
  readonly regra2_exemplos_ajuste_operacional: string[]
  readonly regra2_limite_tickets: number
  readonly ttl_metadados_seg: number
  readonly ttl_conteudo_seg: number
  readonly limite_requisicoes_por_minuto: number
  readonly teto_custo_conversa_usd: number
  readonly canal_notificacao_padrao: CanalNotificacao | null
  readonly chat_webhook_url: string | null
  readonly email_endpoint: string | null
  readonly email_remetente: string | null
  readonly base_publica_app: string | null
  readonly sla_fracao_aviso: number
  readonly emails_piloto: string[]
  readonly areas_por_email: Record<string, string>
  readonly baseline_assentos: BaselineAssentos | null
  readonly retencao_conversas_dias: number | null
  readonly retencao_auditoria_dias: number | null
  readonly retencao_notificacoes_dias: number | null
  /**
   * Spec 009 — o Investigador. Sem campo no console (`D-25`), como TTL e rate limit; estão
   * aqui porque este tipo espelha `ConfigValores` inteiro e o compilador cobra o par.
   */
  readonly investigador_ligado: boolean
  readonly investigador_retencao_dias: number
  /** T-134 — faixas de preço por produto. Vazio = economia de ocioso sai como teto. */
  readonly curva_preco_por_produto: Record<
    string,
    { readonly ate: number | null; readonly precoUnitarioUsd: number }[]
  >
}

export interface BaselineAssentos {
  readonly coletadoEm: string
  readonly porProduto: Record<string, number>
}

/* ---------- mapa de lacunas (RF-42) ------------------------------------ */

export interface TermoComLacuna {
  readonly termo: string
  readonly ocorrencias: number
  /** Pessoas distintas — o mapa conta, não nomeia (ver `confluence/registro.ts`). */
  readonly pessoas: number
  readonly ultimaEm: string
}

export interface OverrideRegistrado {
  readonly regra: string
  readonly motivo: string
  readonly criadoEm: string
}

export interface MapaDeLacunas {
  readonly semResultado: readonly TermoComLacuna[]
  readonly semClique: readonly TermoComLacuna[]
  readonly overrides: readonly OverrideRegistrado[]
}

/* ---------- métricas mínimas (T-095, O1, R-04, RF-42) ------------------ */

export interface DeflexaoPorRegra {
  readonly regra: string
  readonly totalBloqueios: number
  readonly overrides: number
  /** `null` = nenhum bloqueio ainda dessa regra. */
  readonly taxaDeflexaoPct: number | null
}

export interface ResumoBuscasMetricas {
  readonly total: number
  readonly semResultado: number
  /** `null` = nenhuma busca ainda. */
  readonly taxaSemResultadoPct: number | null
}

/* ---------- o painel completo de RF-55 (T-232, T-234, T-310) ----------- */

export interface CalibragemRegra {
  readonly regra: string
  readonly thresholdAtual: number
  readonly totalBloqueios: number
  readonly overrides: number
  readonly taxaOverridePct: number | null
  /**
   * T-310 - o que as pessoas escreveram ao insistir.
   *
   * Sem isto, a tela empurraria para mexer no threshold, que e o botao mais facil que
   * existe ali - quando a resposta certa costuma ser escrever a pagina que falta.
   */
  readonly motivosDeOverride: readonly string[]
  readonly paginasApontadas: readonly { readonly titulo: string; readonly vezes: number }[]
}

export interface ResumoSla {
  readonly totalAvaliados: number
  readonly respondidos: number
  readonly dentroDoPrazo: number
  /** `null` = ninguem respondeu nada ainda. Nunca `0`. */
  readonly aderenciaPct: number | null
  readonly emRisco: number
  readonly estourados: number
}

export interface ResumoPainel {
  readonly chamadosPorArea: readonly { readonly area: string | null; readonly total: number }[]
  readonly chamadosPorPrioridade: Readonly<Record<string, number>>
  readonly canal: {
    readonly porVia: Readonly<Record<string, number>>
    readonly totalPeloApp: number
  }
  readonly calibragem: readonly CalibragemRegra[]
  readonly notificacoes: Readonly<
    Record<'pendente' | 'enviada' | 'falha' | 'suprimida', number>
  >
  readonly telemetriaAtlassian: {
    readonly total429: number
    readonly totalRequisicoes: number
    readonly taxa429Pct: number | null
    readonly acimaDoLimiar: boolean
  }
  readonly ia: {
    readonly conversas: number
    readonly custoTotalUsd: number
    readonly custoMedioUsd: number | null
    readonly conversasNoTeto: number
  }
  readonly sla: ResumoSla
  /**
   * T-422 / `ScC-7` — a evidência que chega junto com o chamado.
   *
   * `declarouTerEFalhou` é o número que exige ação nossa, e o único que uma taxa
   * sozinha esconderia: ele derruba a evidência sem ninguém ter deixado de colaborar.
   */
  readonly evidencia: {
    readonly chamadosCriados: number
    readonly perguntados: number
    readonly comEvidencia: number
    readonly declarouTerEFalhou: number
    readonly declarouNaoTer: number
    readonly semPergunta: number
    /** `null` enquanto ninguém foi perguntado. Nunca `0%`. */
    readonly taxaPct: number | null
  }
  /** T-235: o número é PROXY, não medição (`D-20`). O painel diz isso na tela. */
  readonly deflexaoResolvidaConhecida: false
  readonly avisoDeflexao: string
  readonly deflexaoAparente: {
    readonly bloqueiosSemOverride: number
    readonly semChamadoDepois: number
    /** `null` = nenhum bloqueio ainda. Nunca `0%`. */
    readonly taxaPct: number | null
    readonly janelaDias: number
    /** O viés declarado — vai JUNTO do número na tela, nunca em rodapé. */
    readonly viesConhecido: string
  }
}

export interface ResumoMetricas {
  readonly deflexaoPorRegra: readonly DeflexaoPorRegra[]
  readonly totalBloqueios: number
  readonly totalOverrides: number
  /** `null` = nenhum bloqueio ainda, de nenhuma regra. */
  readonly taxaOverrideGlobalPct: number | null
  readonly chamadosPorVia: Readonly<Record<string, number>>
  readonly buscas: ResumoBuscasMetricas
  /** T-520 — a fonte organizacional da área do solicitante (`RF-19`, `D-37`). */
  readonly area: {
    readonly comArea: number
    readonly semArea: number
    /** Cadastro faltando na TeamGuide — resolve-se cadastrando. */
    readonly naoEncontrada: number
    /** A fonte fora do ar — resolve-se olhando o token ou a API. */
    readonly indisponivel: number
  }
  readonly painel: ResumoPainel
  readonly baselineAssentos: BaselineAssentos | null
  readonly canalNotificacaoDefinido: boolean
  readonly piloto: { readonly ligado: boolean; readonly pessoas: number }
}

/* ---------- governança de assentos (RF-51 a RF-54) --------------------- */

export interface CustoPorProduto {
  readonly produto: string
  readonly usuarios: number
  readonly ociosos: number
  /** `null` = sem preço configurado para este produto (Q8). */
  readonly custoMensalUsd: number | null
}

export interface ResumoCusto {
  readonly porProduto: readonly CustoPorProduto[]
  /** `null` enquanto QUALQUER produto não tiver preço configurado — nunca um total
   * que sub-conta em silêncio. */
  readonly totalMensalUsd: number | null
  readonly custoConfigurado: boolean
  readonly ocioso: {
    readonly usuarios: number
    /** ⚠️ **TETO** da economia quando `economiaConfiavel` é `false`, não a economia. */
    readonly custoMensalUsd: number | null
    /** `false` = preço escalonado sem curva configurada (T-134). A tela mostra a ressalva
     * ao lado do número, porque é aqui que se decide cortar acesso de alguém. */
    readonly economiaConfiavel: boolean
  }
}

export interface LimitacoesUltimoAcesso {
  readonly atrasoMaximoHoras: number
  readonly criterioAtivo: string
}

export interface ItemInventarioAssento {
  readonly accountId: string
  readonly email: string
  readonly nome: string
  readonly produto: string
  readonly ultimoAcessoEm: string | null
}

export interface EndpointNaoVerificado {
  readonly metodo: string
  readonly caminho: string
  readonly risco: string
}

export interface RespostaAssentos {
  /** `null` = a coleta diaria ainda nao rodou nenhuma vez. */
  readonly coletadoEm: string | null
  readonly ociosoDesdeDias: number
  readonly limitacoesUltimoAcesso: LimitacoesUltimoAcesso
  readonly itens: readonly ItemInventarioAssento[]
  readonly custo: ResumoCusto
  readonly organizacaoConfigurada: boolean
  readonly usandoFakes: boolean
  /**
   * O que ainda nao foi verificado contra a API real (Q1).
   *
   * Vai **para a tela**: um console que promete revogar assento e falha no clique e pior
   * que um console que avisa antes.
   */
  readonly endpointsNaoVerificados: readonly EndpointNaoVerificado[]
  readonly baseline: BaselineAssentos | null
}

export type TipoRecomendacao = 'rebaixar_para_customer' | 'remover_ocioso'

export interface Recomendacao {
  readonly accountId: string
  readonly email: string
  readonly nome: string
  readonly tipo: TipoRecomendacao
  readonly motivo: string
  readonly produtosAfetados: readonly string[]
}

export interface RegistroAuditoria {
  readonly id: string
  readonly ator_email: string
  readonly acao: string
  readonly recurso: string | null
  readonly resultado: 'sucesso' | 'falha' | 'negado'
  readonly criado_em: string
}

/** Erro com a mensagem que o backend escreveu — já em linguagem de negócio (RNF-30). */
export class ErroApi extends Error {
  constructor(
    message: string,
    readonly codigo: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'ErroApi'
  }
}

async function chamar<T>(caminho: string, init: RequestInit = {}): Promise<T> {
  const resposta = await fetch(caminho, {
    ...init,
    headers: {
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  })

  const texto = await resposta.text()
  let dados: unknown = null
  try {
    dados = texto.length > 0 ? JSON.parse(texto) : null
  } catch {
    // O edge pode devolver HTML (página de login, erro de gateway). Não deixa isso
    // virar "Unexpected token < in JSON" na cara da pessoa.
    throw new ErroApi(
      'Perdemos a conexão com o app. Recarregue a página e tente de novo.',
      'resposta_invalida',
      resposta.status,
    )
  }

  if (!resposta.ok) {
    const corpo = dados as { erro?: string; codigo?: string } | null
    throw new ErroApi(
      corpo?.erro ?? 'Algo deu errado. Tente novamente em instantes.',
      corpo?.codigo ?? 'desconhecido',
      resposta.status,
    )
  }
  return dados as T
}

export const api = {
  eu: () => chamar<Identidade>('/api/auth/me'),

  iniciarConversa: () =>
    chamar<{ id: string }>('/api/conversas', { method: 'POST' }),

  enviarMensagem: (conversaId: string, texto: string) =>
    chamar<RespostaTurno>(`/api/conversas/${encodeURIComponent(conversaId)}/mensagens`, {
      method: 'POST',
      body: JSON.stringify({ texto }),
    }),

  registrarOverride: (conversaId: string, motivo: string) =>
    chamar<{ ok: true; proposta: Proposta | null; tipoNome: string | null }>(
      `/api/conversas/${encodeURIComponent(conversaId)}/override`, {
      method: 'POST',
      body: JSON.stringify({ motivo }),
    }),

  /**
   * `RF-81` (spec 011) — "montar o chamado agora", com o que a conversa já tem.
   *
   * ⚠️ Devolve `ok: false` **com 200** quando nem forçando saiu proposta: não é erro de
   * rede nem de permissão, é a resposta honesta de que ainda falta o essencial. Tratar
   * como exceção faria a tela mostrar "algo deu errado" para um caso previsto.
   */
  montarChamadoAgora: (conversaId: string) =>
    chamar<{
      ok: boolean
      proposta: Proposta | null
      tipoNome?: string | null
      mensagem?: string
    }>(`/api/conversas/${encodeURIComponent(conversaId)}/montar-chamado`, { method: 'POST' }),

  salvarProposta: (conversaId: string, proposta: Proposta) =>
    chamar<{ proposta: Proposta; slaPrimeiraRespostaHoras: number }>(
      `/api/conversas/${encodeURIComponent(conversaId)}/proposta`,
      { method: 'PUT', body: JSON.stringify(proposta) },
    ),

  /**
   * O que esta conversa já tem anexado — `D-70`.
   *
   * ⚠️ Só o **nome**: o `temporaryAttachmentId` nunca trafega pelo navegador (`RF-30`
   * aplicado a arquivo). O `teto` vem do servidor pelo mesmo motivo — número escrito na
   * tela divergiria dele em silêncio.
   */
  anexosDaConversa: (conversaId: string) =>
    chamar<{ itens: { nome: string }[]; teto: number }>(
      `/api/conversas/${encodeURIComponent(conversaId)}/anexos`,
    ),

  /**
   * O desfecho do aviso de negociação — `FR-23`.
   *
   * ⚠️ **Disparado sem `await` na frente do envio:** auditoria não entra no caminho crítico
   * de uma mensagem, e falha dela não pode impedir a pessoa de falar. Um caminho só para os
   * dois desfechos, porque duas mecânicas divergiriam na primeira correção.
   */
  registrarAvisoDeNegociacao: (conversaId: string, desfecho: 'seguiu' | 'voltou') =>
    chamar<{ ok: true }>(
      `/api/conversas/${encodeURIComponent(conversaId)}/aviso-negociacao`,
      { method: 'POST', body: JSON.stringify({ desfecho }) },
    ),

  /**
   * RF-62 — `declarouAnexo` só vai quando o tipo aceita anexo. Mandar `false` num tipo
   * que não pergunta gravaria "disse que não tinha" para quem nunca foi perguntado.
   */
  confirmar: (
    conversaId: string,
    declarouAnexo?: boolean,
    /**
     * RF-27 na conversa (`D-38`). Sem isto, um tipo com campo obrigatório — 70, 134, 108,
     * 93 — não abria chamado por aqui: dava 500 e a pessoa não sabia o que corrigir.
     */
    camposDinamicos?: Record<string, string>,
  ) => {
    const corpo: Record<string, unknown> = {}
    if (declarouAnexo !== undefined) corpo.declarouAnexo = declarouAnexo
    if (camposDinamicos && Object.keys(camposDinamicos).length > 0) {
      corpo.camposDinamicos = camposDinamicos
    }
    return chamar<ResultadoCriacao>(
      `/api/conversas/${encodeURIComponent(conversaId)}/confirmar`,
      {
        method: 'POST',
        ...(Object.keys(corpo).length === 0 ? {} : { body: JSON.stringify(corpo) }),
      },
    )
  },

  abrirPorFormulario: (dados: {
    titulo: string
    descricao: string
    tipoChamadoId: string
    prioridade: Prioridade
    chaveIdempotencia: string
    /** RF-27 (T-130) — valores dos campos adicionais do request type. */
    camposDinamicos?: Record<string, string>
    /** RF-62 — ausente quando o tipo não expõe campo de anexo. */
    declarouAnexo?: boolean
  }) => chamar<ResultadoCriacao>('/api/chamados', { method: 'POST', body: JSON.stringify(dados) }),

  camposDoTipo: (requestTypeId: string) =>
    chamar<{ itens: CampoRequestType[]; aceitaAnexo: boolean; anexoObrigatorio?: boolean }>(
      `/api/tipos-chamado/${encodeURIComponent(requestTypeId)}/campos`,
    ),

  /**
   * RF-61 (T-409) — anexo ANTES de o chamado existir.
   *
   * Manda a chave crua (ou o id da conversa) e o arquivo; recebe `{ ok, nome }`. Nenhum
   * identificador de anexo trafega nos dois sentidos — quem normaliza a chave e guarda o
   * id temporário é o servidor.
   *
   * `FormData` sem `Content-Type` explícito de propósito: o `fetch` gera o boundary junto
   * com o corpo, e declarar o tipo à mão produz um boundary que não corresponde.
   */
  anexarAntesDoChamado: async (
    alvo:
      | { readonly via: 'formulario'; readonly chaveIdempotencia: string }
      | { readonly via: 'conversa'; readonly conversaId: string },
    arquivo: File,
  ) => {
    const form = new FormData()
    if (alvo.via === 'conversa') form.append('conversaId', alvo.conversaId)
    else form.append('chaveIdempotencia', alvo.chaveIdempotencia)
    form.append('arquivo', arquivo)
    const resposta = await fetch('/api/anexos-pendentes', { method: 'POST', body: form })
    const dados = (await resposta.json().catch(() => null)) as
      | { ok?: boolean; nome?: string; erro?: string; mensagem?: string }
      | null
    if (!resposta.ok) {
      throw new ErroApi(
        dados?.erro ?? dados?.mensagem ?? 'Não consegui enviar o arquivo agora.',
        'anexo_pendente',
        resposta.status,
      )
    }
    return { nome: dados?.nome ?? arquivo.name }
  },

  meusChamados: (filtros: { status?: string; termo?: string } = {}) => {
    const q = new URLSearchParams()
    if (filtros.status) q.set('status', filtros.status)
    if (filtros.termo) q.set('q', filtros.termo)
    const sufixo = q.toString()
    return chamar<RespostaMeusChamados>('/api/chamados' + (sufixo ? '?' + sufixo : ''))
  },

  detalhe: (issueKey: string) =>
    chamar<DetalheChamado>(`/api/chamados/${encodeURIComponent(issueKey)}`),

  comentar: (issueKey: string, texto: string) =>
    chamar<{ ok: true }>(`/api/chamados/${encodeURIComponent(issueKey)}/comentarios`, {
      method: 'POST',
      body: JSON.stringify({ texto }),
    }),

  /**
   * T-240 - anexo do solicitante no proprio chamado.
   *
   * `FormData` sem `Content-Type` explicito de proposito: o `fetch` gera o boundary junto
   * com o corpo, e declarar o tipo a mao produz um boundary que nao corresponde.
   */
  anexar: async (issueKey: string, arquivos: readonly File[]) => {
    const form = new FormData()
    for (const arquivo of arquivos) form.append('arquivo', arquivo)
    const resposta = await fetch('/api/chamados/' + encodeURIComponent(issueKey) + '/anexos', {
      method: 'POST',
      body: form,
    })
    const dados = (await resposta.json().catch(() => null)) as
      | { ok?: boolean; enviados?: string[]; erro?: string; mensagem?: string }
      | null
    if (!resposta.ok) {
      throw new ErroApi(
        dados?.mensagem ?? dados?.erro ?? 'Nao consegui anexar agora.',
        'anexo',
        resposta.status,
      )
    }
    return { enviados: dados?.enviados ?? [] }
  },

  transicoes: (issueKey: string) =>
    chamar<{ itens: TransicaoDisponivel[] }>(
      '/api/chamados/' + encodeURIComponent(issueKey) + '/transicoes',
    ),

  transicionar: (issueKey: string, transicaoId: string) =>
    chamar<{ ok: true }>('/api/chamados/' + encodeURIComponent(issueKey) + '/transicoes', {
      method: 'POST',
      body: JSON.stringify({ transicaoId }),
    }),

  corrigirArea: (issueKey: string, area: string | null) =>
    chamar<{ ok: true; area: string | null; areasConhecidas: string[] }>(
      '/api/chamados/' + encodeURIComponent(issueKey) + '/area',
      { method: 'PUT', body: JSON.stringify({ area: area ?? '' }) },
    ),

  preferencia: () => chamar<Preferencia>('/api/preferencias'),

  salvarPreferencia: (canal: CanalNotificacao, destino: string | null) =>
    chamar<{ ok: true; canal: CanalNotificacao; destino: string | null }>('/api/preferencias', {
      method: 'PUT',
      body: JSON.stringify({ canal, destino }),
    }),

  meusAvisos: () => chamar<{ itens: AvisoRecebido[] }>('/api/notificacoes'),

  tiposChamado: () => chamar<{ itens: TipoChamado[] }>('/api/tipos-chamado'),

  /**
   * `espaco` ESTREITA a busca dentro da allowlist — nunca amplia (`RF-37`).
   *
   * O servidor faz a interseção com `espacos_confluence`, então mandar um espaço que o app
   * não expõe devolve lista vazia, não o espaço. A regra "a allowlist nunca vem do cliente"
   * continua intacta: o cliente só consegue pedir MENOS.
   */
  buscarDocumentacao: (termo: string, espaco?: string) =>
    chamar<RespostaBusca>(
      `/api/confluence/busca?q=${encodeURIComponent(termo)}` +
        (espaco ? `&espaco=${encodeURIComponent(espaco)}` : ''),
    ),

  lerPagina: (id: string, deBusca?: string | null) =>
    chamar<PaginaLida>(
      `/api/confluence/pagina/${encodeURIComponent(id)}` +
        (deBusca ? `?de=${encodeURIComponent(deBusca)}` : ''),
    ),

  espacos: () => chamar<{ itens: EspacoNavegavel[] }>('/api/confluence/espacos'),

  arvore: (espaco: string, pai?: string) =>
    chamar<NivelDaArvore>(
      `/api/confluence/arvore?espaco=${encodeURIComponent(espaco)}` +
        (pai ? `&pai=${encodeURIComponent(pai)}` : ''),
    ),

  adminConfig: () => chamar<{ config: ConfigValores }>('/api/admin/config'),

  adminSalvarConfig: (chave: keyof ConfigValores, valor: unknown) =>
    chamar<{ ok: true }>('/api/admin/config', {
      method: 'PUT',
      body: JSON.stringify({ chave, valor }),
    }),

  adminLacunas: () => chamar<MapaDeLacunas>('/api/admin/lacunas'),

  adminMetricas: () => chamar<ResumoMetricas>('/api/admin/metricas'),

  adminAssentos: () => chamar<RespostaAssentos>('/api/admin/assentos'),

  adminRecomendacoesAssentos: () =>
    chamar<{ itens: Recomendacao[] }>('/api/admin/assentos/recomendacoes'),

  /**
   * T-131 - revogar produto. `emailConfirmado` e a **segunda** confirmacao.
   *
   * Nao e um "tem certeza?" clicavel: digitar o e-mail obriga a olhar QUEM esta sendo
   * afetado. O erro a evitar nao e clicar sem querer - e revogar a linha errada de uma
   * tabela que estava ordenada de outro jeito do que se esperava.
   */
  adminRevogarAssento: (dados: {
    accountId: string
    produto: string
    email: string
    emailConfirmado: string
  }) =>
    chamar<{ ok: true; aviso: string }>('/api/admin/assentos/revogar', {
      method: 'POST',
      body: JSON.stringify(dados),
    }),

  adminAuditoria: (email?: string) =>
    chamar<{ itens: RegistroAuditoria[] }>(
      email ? `/api/admin/auditoria?email=${encodeURIComponent(email)}` : '/api/admin/auditoria',
    ),

  // --- Investigador (spec 009) — só admin, e o gate real é do servidor ---------
  investigadorSessoes: (filtro: { recorte?: string; email?: string } = {}) => {
    const q = new URLSearchParams()
    if (filtro.recorte) q.set('recorte', filtro.recorte)
    if (filtro.email) q.set('email', filtro.email)
    const cauda = q.toString()
    return chamar<RespostaSessoes>(`/api/investigador/sessoes${cauda ? `?${cauda}` : ''}`)
  },

  investigadorSessao: (id: string) =>
    chamar<DetalheDeSessao>(`/api/investigador/sessoes/${encodeURIComponent(id)}`),

  investigadorRequisicoes: (filtro: { recorte?: string; caminho?: string } = {}) => {
    const q = new URLSearchParams()
    if (filtro.recorte) q.set('recorte', filtro.recorte)
    if (filtro.caminho) q.set('caminho', filtro.caminho)
    const cauda = q.toString()
    return chamar<{ itens: RequisicaoRegistrada[] }>(
      `/api/investigador/requisicoes${cauda ? `?${cauda}` : ''}`,
    )
  },

  investigadorResumo: () => chamar<ResumoInvestigador>('/api/investigador/resumo'),

  /**
   * Os dois corpos de uma chamada — `FR-30`.
   *
   * ⚠️ Sob demanda de propósito: a listagem traz até 500 linhas e a tela lê um par por vez.
   */
  investigadorCorpos: (id: string) =>
    chamar<CorposDaRequisicao>(`/api/investigador/requisicoes/${encodeURIComponent(id)}/corpos`),

  /**
   * `FR-8` — a tela declara que um campo mudou.
   *
   * ⚠️ **Nunca lança para quem chamou.** É registro de depuração: derrubar o preenchimento
   * de um formulário porque o log falhou seria trocar o problema por um pior (`FR-20`), na
   * ponta do cliente.
   */
  investigadorFormulario: (dados: {
    tela: string
    campo: string
    de?: unknown
    para?: unknown
    conversaId?: string | null
  }) =>
    chamar<{ ok: boolean }>('/api/investigador/formulario', {
      method: 'POST',
      body: JSON.stringify(dados),
    }).catch(() => ({ ok: false })),
}

export interface SessaoInvestigada {
  readonly conversaId: string
  readonly solicitanteEmail: string
  readonly estado: string
  readonly criadoEm: string
  readonly ultimaAtividade: string
  readonly custoUsd: number
  readonly mensagensDaPessoa: number
  readonly mensagensDoAgente: number
  readonly bloqueios: number
  readonly overrides: number
  readonly temProposta: boolean
  /** O título do cartão vigente — o que diz DE QUE a conversa trata (spec 014, `FR-33`). */
  readonly tituloDoCartao: string | null
  readonly confirmadoEm: string | null
  readonly issueKey: string | null
  readonly requisicoes: number
  readonly errosDeApi: number
  readonly duracaoMaximaMs: number | null
  readonly motivoSemProposta: string | null
}

export interface RespostaSessoes {
  readonly itens: SessaoInvestigada[]
  readonly ligado: boolean
  readonly retencaoDias: number
}

export interface EventoRegistrado {
  readonly id: string
  readonly requisicao_id: string | null
  readonly conversa_id: string | null
  readonly ator_email: string
  readonly tipo: string
  readonly origem: string
  readonly resumo: string | null
  readonly dados_json: string | null
  readonly custo_usd: number | null
  readonly duracao_ms: number | null
  readonly ordem: number
  readonly criado_em: string
}

export interface RequisicaoRegistrada {
  readonly id: string
  readonly ator_email: string
  readonly conversa_id: string | null
  readonly metodo: string
  readonly caminho: string
  readonly status: number
  readonly duracao_ms: number
  readonly req_bytes: number | null
  readonly resp_bytes: number | null
  readonly erro: string | null
  readonly criado_em: string
}

/** Os dois corpos, buscados só quando alguém expande a linha — spec 013, `FR-30`. */
export interface CorposDaRequisicao {
  readonly req_json: string | null
  readonly resp_json: string | null
}

export interface DetalheDeSessao {
  /**
   * O resumo da sessão — spec 014, `FR-33`.
   *
   * ⚠️ `null` significa **expurgada pela retenção**, nunca falha de rede: a rota responde 200
   * com este campo nulo, e a tela diz isso em palavras.
   */
  readonly sessao: SessaoInvestigada | null
  readonly eventos: EventoRegistrado[]
  readonly requisicoes: RequisicaoRegistrada[]
  readonly mensagens: {
    readonly id: string
    readonly papel: string
    readonly conteudo: string
    readonly tool_nome: string | null
    readonly criado_em: string
  }[]
}

export interface ResumoInvestigador {
  readonly totalRequisicoes: number
  readonly totalErros: number
  readonly taxaErro: number | null
  readonly duracaoMediaMs: number | null
  readonly lentas: number
  readonly porCaminho: {
    readonly caminho: string
    readonly total: number
    readonly erros: number
    readonly duracaoMediaMs: number
    readonly duracaoMaximaMs: number
  }[]
  readonly totalEventos: number
  readonly custoIaUsd: number
  readonly ligado: boolean
  readonly retencaoDias: number
}

/** Rótulos de prioridade com o SLA de PRIMEIRA RESPOSTA explícito (RN-08). */
export const PRIORIDADES: readonly {
  valor: Prioridade
  rotulo: string
  horas: number
  criterio: string
}[] = [
  {
    valor: 'critica',
    rotulo: 'Crítica',
    horas: 4,
    criterio: 'Sistema fora do ar, impacto direto em vendas ou operação',
  },
  {
    valor: 'alta',
    rotulo: 'Alta',
    horas: 12,
    criterio: 'Funcionalidade comprometida, com solução alternativa temporária',
  },
  {
    valor: 'normal',
    rotulo: 'Normal',
    horas: 24,
    criterio: 'Melhoria, ajuste pontual ou sugestão',
  },
]

export const prioridadePor = (valor: Prioridade) =>
  PRIORIDADES.find((p) => p.valor === valor) ?? PRIORIDADES[2]!
