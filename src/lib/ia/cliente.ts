/**
 * Cliente de IA real — camada isolada (RNF-23), apontando para o **proxy
 * corporativo** `ai-proxy.gogroupbr.com` (decisão D-05, exigência de RNF-34).
 *
 * ## A lição herdada do godocs
 *
 * O proxy pode demorar. O godocs usa timeout de ~25s com **fallback direto** ao
 * provedor — sem isso, RNF-12 (primeira resposta < 5s no p95) fica à mercê do
 * gateway. Aqui o mesmo desenho: o timeout aborta e, se houver credencial de
 * fallback configurada, a MESMA chamada é refeita direto.
 *
 * ## Contabilidade de custo não é opcional
 *
 * RNF-16: o custo escala com **volume de tickets**, não com número de usuários —
 * a classificação da Regra 2 lê vários tickets por conversa (R-08). Toda resposta
 * devolve `custoEstimadoUsd`, e quem chama soma na conversa e compara com o teto.
 *
 * ⚠️ Nenhum tipo do provedor atravessa esta fronteira. `rules/` e `agent/` não
 * sabem que existe OpenAI do outro lado.
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
} from './tipos'
import {
  PROMPT_CLASSIFICACAO_RESOLUCAO,
  PROMPT_EXTRACAO,
  montarPromptClassificacao,
  montarPromptExtracao,
} from './prompts'

export interface OpcoesClienteIA {
  /** Base do proxy corporativo. Sem ela, chamada direta com `apiKey`. */
  readonly baseUrl: string | null
  readonly apiKey: string
  readonly modelo: string
  /** Credencial de fallback direto ao provedor, quando o proxy falha (D-05). */
  readonly apiKeyFallback?: string | null
  readonly baseUrlFallback?: string
  readonly modeloFallback?: string
  readonly timeoutMs?: number
  readonly fetchImpl?: typeof fetch
  /** Preço por 1M tokens, para a estimativa de custo (RNF-16). */
  readonly precoEntradaPor1M?: number
  readonly precoSaidaPor1M?: number
}

const TIMEOUT_PADRAO_MS = 25_000
const BASE_DIRETA = 'https://api.openai.com/v1'

interface MensagemChatApi {
  role: string
  content: string
  tool_call_id?: string
  name?: string
}

interface RespostaChatApi {
  choices?: {
    message?: {
      content?: unknown
      tool_calls?: { id?: unknown; function?: { name?: unknown; arguments?: unknown } }[]
    }
  }[]
  usage?: { prompt_tokens?: unknown; completion_tokens?: unknown }
}

export class ClienteIAHttp implements ClienteIA {
  private readonly fetchImpl: typeof fetch
  private readonly timeoutMs: number
  private _custoAcumuladoUsd = 0

  constructor(private readonly opcoes: OpcoesClienteIA) {
    this.fetchImpl = opcoes.fetchImpl ?? fetch
    this.timeoutMs = opcoes.timeoutMs ?? TIMEOUT_PADRAO_MS
  }

  get custoAcumuladoUsd(): number {
    return this._custoAcumuladoUsd
  }

  private estimarCusto(entrada: number, saida: number): number {
    const pe = this.opcoes.precoEntradaPor1M ?? 0
    const ps = this.opcoes.precoSaidaPor1M ?? 0
    return (entrada / 1_000_000) * pe + (saida / 1_000_000) * ps
  }

  /**
   * Faz a chamada com timeout; se o proxy falhar ou estourar e houver fallback
   * configurado, refaz a MESMA chamada direto no provedor.
   */
  private async chamar(corpo: Record<string, unknown>, etapa: string): Promise<RespostaChatApi> {
    const viaProxy = this.opcoes.baseUrl !== null
    try {
      return await this.requisitar(
        this.opcoes.baseUrl ?? BASE_DIRETA,
        this.opcoes.apiKey,
        { ...corpo, model: this.opcoes.modelo },
        etapa,
      )
    } catch (erro) {
      const podeCairPraDireto = viaProxy && Boolean(this.opcoes.apiKeyFallback)
      if (!podeCairPraDireto) throw erro
      // Fallback direto: o gateway não pode ser ponto único de falha da porta de
      // entrada de chamados da empresa.
      return this.requisitar(
        this.opcoes.baseUrlFallback ?? BASE_DIRETA,
        this.opcoes.apiKeyFallback!,
        { ...corpo, model: this.opcoes.modeloFallback ?? this.opcoes.modelo },
        `${etapa}:fallback`,
      )
    }
  }

  private async requisitar(
    base: string,
    chave: string,
    corpo: Record<string, unknown>,
    etapa: string,
  ): Promise<RespostaChatApi> {
    const controlador = new AbortController()
    const timer = setTimeout(() => controlador.abort(), this.timeoutMs)
    try {
      const resposta = await this.fetchImpl(`${base}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${chave}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(corpo),
        signal: controlador.signal,
      })
      if (!resposta.ok) {
        // Nunca inclui o corpo da resposta na mensagem (RNF-01).
        throw new ErroIA(`provedor de IA respondeu ${resposta.status}`, {
          transitorio: resposta.status === 429 || resposta.status >= 500,
          etapa,
        })
      }
      return (await resposta.json()) as RespostaChatApi
    } catch (erro) {
      if (erro instanceof ErroIA) throw erro
      const abortou = erro instanceof Error && erro.name === 'AbortError'
      throw new ErroIA(abortou ? 'tempo esgotado na IA' : 'falha ao falar com a IA', {
        transitorio: true,
        etapa,
      })
    } finally {
      clearTimeout(timer)
    }
  }

  async chat(params: ParametrosChat): Promise<RespostaIA> {
    const mensagens: MensagemChatApi[] = params.mensagens.map((m) => ({
      role: m.papel === 'tool' ? 'user' : m.papel,
      // Resultado de tool entra como conteúdo de usuário rotulado: o resultado da
      // busca é DADO (RNF-08), e o rótulo evita que o modelo o confunda com
      // instrução do sistema.
      content: m.papel === 'tool' ? `[resultado de ${m.toolNome}]\n${m.conteudo}` : m.conteudo,
    }))

    const corpo: Record<string, unknown> = {
      messages: mensagens,
      ...(params.maxTokens ? { max_tokens: params.maxTokens } : {}),
    }
    if (params.toolsPermitidas.length > 0) {
      corpo.tools = params.toolsPermitidas.map((t) => ({
        type: 'function',
        function: { name: t.nome, description: t.descricao, parameters: t.parametros },
      }))
    }

    const dados = await this.chamar(corpo, 'chat')
    const mensagem = dados.choices?.[0]?.message
    const custo = this.estimarCusto(
      Number(dados.usage?.prompt_tokens ?? 0),
      Number(dados.usage?.completion_tokens ?? 0),
    )
    this._custoAcumuladoUsd += custo

    return {
      texto: typeof mensagem?.content === 'string' ? mensagem.content : '',
      toolsPropostas: (mensagem?.tool_calls ?? []).map((c) => ({
        // `nome` fica string: o modelo pode inventar nome de tool, e o
        // orquestrador precisa recusar o que não reconhece.
        nome: String(c.function?.name ?? ''),
        argumentos: parseArgumentos(c.function?.arguments),
      })),
      custoEstimadoUsd: custo,
    }
  }

  async classificarResolucao(
    params: ParametrosClassificacao,
  ): Promise<ResultadoClassificacao> {
    if (params.exemplosAjusteOperacional.length === 0) {
      // RF-14 / Q3: sem exemplos reais da Gocase a classificação é imprecisa, e
      // imprecisão aqui vira falso bloqueio (R-04). Falha explícita, nunca chute.
      throw new ErroIA('classificação sem exemplos reais da Gocase (RF-14, Q3)', {
        transitorio: false,
        etapa: 'classificacao',
      })
    }

    const dados = await this.chamar(
      {
        messages: [
          { role: 'system', content: PROMPT_CLASSIFICACAO_RESOLUCAO },
          { role: 'user', content: montarPromptClassificacao(params) },
        ],
        response_format: { type: 'json_object' },
      },
      'classificacao',
    )

    const custo = this.estimarCusto(
      Number(dados.usage?.prompt_tokens ?? 0),
      Number(dados.usage?.completion_tokens ?? 0),
    )
    this._custoAcumuladoUsd += custo

    const bruto = dados.choices?.[0]?.message?.content
    const { classe, justificativa } = interpretarClassificacao(bruto)
    return { classe, justificativa, custoEstimadoUsd: custo }
  }

  async extrairProposta(params: ParametrosExtracao): Promise<ResultadoExtracao> {
    const dados = await this.chamar(
      {
        messages: [
          { role: 'system', content: PROMPT_EXTRACAO },
          { role: 'user', content: montarPromptExtracao(params) },
        ],
        response_format: { type: 'json_object' },
      },
      'extracao',
    )
    const custo = this.estimarCusto(
      Number(dados.usage?.prompt_tokens ?? 0),
      Number(dados.usage?.completion_tokens ?? 0),
    )
    this._custoAcumuladoUsd += custo
    return {
      proposta: interpretarProposta(
        dados.choices?.[0]?.message?.content,
        params.tiposPermitidos.map((t) => t.id),
      ),
      custoEstimadoUsd: custo,
    }
  }

  async verificarSaude(): Promise<{ ok: boolean; detalhe: string }> {
    try {
      await this.chat({
        mensagens: [{ papel: 'user', conteudo: 'ping' }],
        toolsPermitidas: [],
        maxTokens: 1,
      })
      return { ok: true, detalhe: this.opcoes.baseUrl ? 'proxy corporativo' : 'direto' }
    } catch (erro) {
      return { ok: false, detalhe: erro instanceof Error ? erro.message : 'falha' }
    }
  }
}

function parseArgumentos(bruto: unknown): Record<string, unknown> {
  if (typeof bruto !== 'string') return {}
  try {
    const v = JSON.parse(bruto)
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

/**
 * Interpreta a resposta do classificador.
 *
 * ⚠️ Resposta ilegível ou classe desconhecida → **`indeterminado`**, nunca
 * `ajuste_operacional`. `indeterminado` não conta para o bloqueio (ver `rules/`):
 * na dúvida, o ticket passa. O contrário transformaria erro de parsing em falso
 * bloqueio (R-04).
 */
export function interpretarClassificacao(bruto: unknown): {
  classe: ClasseResolucao
  justificativa: string
} {
  if (typeof bruto !== 'string' || bruto.trim().length === 0) {
    return { classe: 'indeterminado', justificativa: 'resposta vazia do classificador' }
  }
  try {
    const v = JSON.parse(bruto) as { classe?: unknown; justificativa?: unknown }
    const classe =
      v.classe === 'ajuste_operacional' || v.classe === 'resolucao_real'
        ? v.classe
        : 'indeterminado'
    return {
      classe,
      justificativa:
        typeof v.justificativa === 'string' ? v.justificativa : 'sem justificativa',
    }
  } catch {
    return { classe: 'indeterminado', justificativa: 'resposta não era JSON válido' }
  }
}

/**
 * Interpreta a extração.
 *
 * ⚠️ **`tipoChamadoId` fora da allowlist descarta a proposta inteira** (RF-28). O
 * modelo pode inventar id — ou ser induzido a isso por conteúdo recuperado — e
 * aceitar um id inventado colocaria o chamado numa fila que o admin não liberou.
 * Na dúvida, sem proposta: o agente continua perguntando, que é o pior caso
 * aceitável. Criar na fila errada não é.
 */
export function interpretarProposta(
  bruto: unknown,
  idsPermitidos: readonly string[],
): PropostaSugerida | null {
  if (typeof bruto !== 'string' || bruto.trim().length === 0) return null
  let v: Record<string, unknown>
  try {
    const parsed = JSON.parse(bruto)
    if (!parsed || typeof parsed !== 'object') return null
    v = parsed as Record<string, unknown>
  } catch {
    return null
  }

  if (v.pronto !== true) return null

  const titulo = typeof v.titulo === 'string' ? v.titulo.trim() : ''
  const descricao = typeof v.descricao === 'string' ? v.descricao.trim() : ''
  const tipoChamadoId = typeof v.tipoChamadoId === 'string' ? v.tipoChamadoId : ''
  const prioridade = v.prioridade

  if (titulo.length < 5 || descricao.length < 10) return null
  if (prioridade !== 'critica' && prioridade !== 'alta' && prioridade !== 'normal') return null
  if (!idsPermitidos.includes(tipoChamadoId)) return null

  return {
    titulo,
    descricao,
    prioridade,
    tipoChamadoId,
    area: typeof v.area === 'string' && v.area.trim().length > 0 ? v.area.trim() : null,
  }
}
