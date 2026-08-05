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
  readonly comentarios: readonly ComentarioPublico[]
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

/** Espelha `ConfigValores` do servidor no que a tela de admin edita. */
export interface ConfigValores {
  readonly dominios_permitidos: string[]
  readonly admins: string[]
  readonly espacos_confluence: string[]
  readonly labels_bloqueadas: string[]
  readonly tipos_chamado_permitidos: string[]
  readonly service_desk_id: string | null
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

  meusChamados: () => chamar<{ itens: ChamadoResumo[] }>('/api/chamados'),

  detalhe: (issueKey: string) =>
    chamar<DetalheChamado>(`/api/chamados/${encodeURIComponent(issueKey)}`),

  comentar: (issueKey: string, texto: string) =>
    chamar<{ ok: true }>(`/api/chamados/${encodeURIComponent(issueKey)}/comentarios`, {
      method: 'POST',
      body: JSON.stringify({ texto }),
    }),

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
