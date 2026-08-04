/**
 * Cliente da API do próprio app.
 *
 * ⚠️ **Nada aqui fala com a Atlassian ou com a IA** (RNF-02). Só com `/api/*`. A
 * identidade vem do edge; o navegador não envia e não escolhe e-mail.
 */

export interface Identidade {
  readonly email: string
  readonly nome: string
  readonly isAdmin: boolean
  /** App publicado em modo demonstração: nada é criado no Jira. */
  readonly modoDemo: boolean
  /** Logout do edge. `null` em dev, onde não há sessão do edge para encerrar. */
  readonly urlLogout: string | null
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

export interface ResultadoCriacao {
  readonly issueKey: string | null
  readonly estado: 'criado' | 'pendente'
  readonly duplicada: boolean
  readonly verificadoRegras: boolean
  readonly prioridade: Prioridade
  readonly slaPrimeiraRespostaHoras: number
  readonly mensagem: string
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
  }) => chamar<ResultadoCriacao>('/api/chamados', { method: 'POST', body: JSON.stringify(dados) }),

  meusChamados: () => chamar<{ itens: ChamadoResumo[] }>('/api/chamados'),

  detalhe: (issueKey: string) =>
    chamar<DetalheChamado>(`/api/chamados/${encodeURIComponent(issueKey)}`),

  comentar: (issueKey: string, texto: string) =>
    chamar<{ ok: true }>(`/api/chamados/${encodeURIComponent(issueKey)}/comentarios`, {
      method: 'POST',
      body: JSON.stringify({ texto }),
    }),

  tiposChamado: () => chamar<{ itens: TipoChamado[] }>('/api/tipos-chamado'),
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
