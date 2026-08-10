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
  readonly proposta: Proposta | null
  readonly tetoCustoAtingido: boolean
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
  readonly corpo: string
  readonly autorNome: string
  readonly criadoEm: string
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
  /**
   * `true` = a Atlassian não respondeu e o que está na tela veio do que NÓS gravamos
   * (`RNF-19`). O chamado existe; o estado dele é que não pôde ser lido.
   */
  readonly degradado: boolean
  /** `true` = não deu para buscar as respostas. Diferente de "não há respostas ainda". */
  readonly comentariosIndisponiveis: boolean
}

export interface TipoChamado {
  readonly id: string
  readonly nome: string
  readonly descricao: string | null
}

/* ---------- campos adicionais do formulário sem IA (RF-27, T-130) ------ */

export type TipoCampoRequestType = 'texto' | 'texto_longo' | 'selecao'

export interface OpcaoCampoRequestType {
  readonly id: string
  readonly rotulo: string
}

export interface CampoRequestType {
  readonly fieldId: string
  readonly rotulo: string
  readonly obrigatorio: boolean
  readonly tipo: TipoCampoRequestType
  readonly opcoes: readonly OpcaoCampoRequestType[]
}

export interface ResultadoCriacao {
  readonly issueKey: string | null
  readonly estado: 'criado' | 'pendente'
  readonly duplicada: boolean
  readonly verificadoRegras: boolean
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
  readonly campo_solicitante_id: string | null
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
    chamar<{ ok: true; proposta: Proposta | null }>(
      `/api/conversas/${encodeURIComponent(conversaId)}/override`, {
      method: 'POST',
      body: JSON.stringify({ motivo }),
    }),

  salvarProposta: (conversaId: string, proposta: Proposta) =>
    chamar<{ proposta: Proposta; slaPrimeiraRespostaHoras: number }>(
      `/api/conversas/${encodeURIComponent(conversaId)}/proposta`,
      { method: 'PUT', body: JSON.stringify(proposta) },
    ),

  confirmar: (conversaId: string) =>
    chamar<ResultadoCriacao>(`/api/conversas/${encodeURIComponent(conversaId)}/confirmar`, {
      method: 'POST',
    }),

  abrirPorFormulario: (dados: {
    titulo: string
    descricao: string
    tipoChamadoId: string
    prioridade: Prioridade
    chaveIdempotencia: string
    /** RF-27 (T-130) — valores dos campos adicionais do request type. */
    camposDinamicos?: Record<string, string>
  }) => chamar<ResultadoCriacao>('/api/chamados', { method: 'POST', body: JSON.stringify(dados) }),

  camposDoTipo: (requestTypeId: string) =>
    chamar<{ itens: CampoRequestType[] }>(
      `/api/tipos-chamado/${encodeURIComponent(requestTypeId)}/campos`,
    ),

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

  buscarDocumentacao: (termo: string) =>
    chamar<RespostaBusca>(`/api/confluence/busca?q=${encodeURIComponent(termo)}`),

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
