/**
 * Cliente Atlassian real — a ÚNICA porta para a Atlassian (RNF-22).
 *
 * Duas credenciais distintas, e isto importa para rotação e privilégio (RNF-01,
 * RNF-04): Jira/Confluence usam **API token com Basic auth** em
 * `goengenharia.atlassian.net`; a Organizations API (Fase 2) exige **API key de
 * organização como Bearer** em `api.atlassian.com/admin` e papel de Org Admin.
 * Este arquivo trata só da primeira.
 *
 * ⚠️ **Zero hardcode** (RNF-25): service desk, request type, espaço e o id do campo
 * customizado "Solicitante" chegam por parâmetro/config. Nenhum valor de ambiente
 * aparece aqui.
 *
 * ⚠️ Sobre a API do Confluence (R-09): a busca por **CQL só existe na v1**
 * (`/wiki/rest/api/search`), enquanto o **conteúdo já tem v2**
 * (`/wiki/api/v2/pages/{id}`). Parte da v1 está em depreciação — por isso as duas
 * versões aparecem lado a lado de propósito, e cada uma está anotada. Verificar o
 * changelog antes de fixar novos endpoints v1.
 */

import { prefixarAutoria, filtrarPublicos, montarQueryComentarios } from './comentarios'
import { CacheTtl, TransporteAtlassian, type OpcoesHttp } from './http'
import {
  ErroAtlassian,
  SLA_PRIMEIRA_RESPOSTA_HORAS,
  type BuscaConfluenceParams,
  type Chamado,
  type ChamadoCriado,
  type ClienteAtlassian,
  type ComentarioPublico,
  type HistoricoParams,
  type NovoChamado,
  type PaginaConfluence,
  type Prioridade,
  type TicketHistorico,
  type TipoChamado,
} from './tipos'

export interface OpcoesCliente extends OpcoesHttp {
  /** TTLs de cache (RNF-13). */
  readonly ttlMetadadosSeg: number
  readonly ttlConteudoSeg: number
  readonly agoraMs?: () => number
  /**
   * Id do campo customizado "Solicitante" no Jira (RF-21), ex.: `customfield_10050`.
   * `null` = ainda não sabemos (Q4) — ver `montarCamposSolicitante`.
   */
  readonly campoSolicitanteId: string | null
  /** Nome do campo de prioridade no request type, quando houver. */
  readonly campoPrioridadeId?: string | null
}

/** Rótulo da prioridade no Jira. Configurável seria melhor; por ora, o mapa explícito. */
const ROTULO_PRIORIDADE: Readonly<Record<Prioridade, string>> = Object.freeze({
  critica: 'Highest',
  alta: 'High',
  normal: 'Medium',
})

const PRIORIDADE_POR_ROTULO: Readonly<Record<string, Prioridade>> = Object.freeze({
  Highest: 'critica',
  High: 'alta',
  Medium: 'normal',
  Low: 'normal',
  Lowest: 'normal',
})

/**
 * Escapa valor para dentro de string CQL.
 *
 * ⚠️ **Injeção de CQL é o risco real da busca** (RNF-07, RN-06): o termo vem do
 * usuário — e, pior, pode vir de um tópico que o LLM extraiu de conteúdo
 * recuperado. Um termo com `"` fecharia a string e permitiria reescrever a
 * cláusula `space in (...)`, que é justamente a allowlist. Escapar aqui é o que
 * mantém a negação por padrão intacta.
 */
export function escaparCql(valor: string): string {
  return valor.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

/**
 * Monta o CQL da busca com a allowlist **na query**, não em filtro posterior.
 *
 * Restringir depois significaria que o conteúdo restrito já saiu da Atlassian e
 * está na memória do app — e bastaria um caminho esquecer o filtro para vazar.
 */
export function montarCql(params: BuscaConfluenceParams): string {
  const espacos = params.espacosPermitidos.map((e) => `"${escaparCql(e)}"`).join(', ')
  const partes = [
    `type = page`,
    `space in (${espacos})`,
    `text ~ "${escaparCql(params.termo)}"`,
  ]
  for (const label of params.labelsBloqueadas) {
    partes.push(`label != "${escaparCql(label)}"`)
  }
  return partes.join(' AND ')
}

/**
 * JQL do histórico da Regra 2, com a janela e o campo de agrupamento vindos de
 * config (Q2 decide qual campo).
 */
export function montarJql(params: HistoricoParams): string {
  const campo = params.campoAgrupamento
  const valor = escaparCql(params.chaveAgrupamento)
  return [
    `${campo} = "${valor}"`,
    `created >= -${params.janelaDias}d`,
    `statusCategory = Done`,
  ].join(' AND ')
}

interface RespostaBusca {
  results?: {
    content?: { id?: unknown; title?: unknown; space?: { key?: unknown } }
    title?: unknown
    score?: unknown
    excerpt?: unknown
    url?: unknown
  }[]
}

export class ClienteAtlassianHttp implements ClienteAtlassian {
  private readonly transporte: TransporteAtlassian
  private readonly cacheMetadados: CacheTtl<unknown>
  private readonly cacheConteudo: CacheTtl<unknown>

  constructor(private readonly opcoes: OpcoesCliente) {
    this.transporte = new TransporteAtlassian(opcoes)
    const agoraMs = opcoes.agoraMs ?? (() => Date.now())
    this.cacheMetadados = new CacheTtl(agoraMs)
    this.cacheConteudo = new CacheTtl(agoraMs)
  }

  /** RF-60 — a única telemetria de orçamento que existe com API token (RNF-15). */
  get contadores() {
    return this.transporte.contadores
  }

  async listarTiposChamado(): Promise<readonly TipoChamado[]> {
    const cacheado = this.cacheMetadados.obter('tiposChamado')
    if (cacheado) return cacheado as TipoChamado[]

    const dados = (await this.transporte.requisitar('/rest/servicedeskapi/requesttype')) as {
      values?: { id?: unknown; serviceDeskId?: unknown; name?: unknown; description?: unknown }[]
    }
    const tipos: TipoChamado[] = (dados?.values ?? []).map((v) => ({
      id: String(v.id ?? ''),
      serviceDeskId: String(v.serviceDeskId ?? ''),
      nome: String(v.name ?? ''),
      descricao: typeof v.description === 'string' ? v.description : null,
    }))
    this.cacheMetadados.definir('tiposChamado', tipos, this.opcoes.ttlMetadadosSeg)
    return tipos
  }

  /**
   * Campos que carregam o solicitante real — RF-21, mitigação de R-03.
   *
   * ⚠️ **Cinto e suspensório, de propósito.** O e-mail vai no campo customizado
   * *quando ele existe* (Q4) **e** sempre no corpo da descrição. Motivo: sem o
   * campo, todo chamado chega ao time de tech como "aberto pelo robô" — o risco
   * R-03 inteiro. Deixar a identificação depender de uma configuração que pode
   * estar ausente seria aceitar que o pior caso aconteça em silêncio.
   *
   * Quando Q4 responder, o campo customizado passa a ser a fonte estruturada (é
   * ele que a automação de roteamento do Jira lê); a linha na descrição continua,
   * porque é ela que um humano vê primeiro.
   */
  montarCamposSolicitante(dados: NovoChamado): {
    descricao: string
    camposExtra: Record<string, unknown>
  } {
    const cabecalho = `**Solicitante:** ${dados.solicitanteEmail}\n**Aberto via:** goatlas\n**Ref:** ${dados.chaveIdempotencia}\n\n---\n\n`
    const camposExtra: Record<string, unknown> = {}
    if (this.opcoes.campoSolicitanteId) {
      camposExtra[this.opcoes.campoSolicitanteId] = dados.solicitanteEmail
    }
    if (this.opcoes.campoPrioridadeId) {
      camposExtra[this.opcoes.campoPrioridadeId] = { name: ROTULO_PRIORIDADE[dados.prioridade] }
    }
    return { descricao: cabecalho + dados.descricao, camposExtra }
  }

  async criarChamado(dados: NovoChamado): Promise<ChamadoCriado> {
    const { descricao, camposExtra } = this.montarCamposSolicitante(dados)
    const corpo = {
      serviceDeskId: dados.serviceDeskId,
      requestTypeId: dados.tipoChamadoId,
      requestFieldValues: {
        summary: dados.titulo,
        description: descricao,
        ...camposExtra,
      },
    }
    const resposta = (await this.transporte.requisitar('/rest/servicedeskapi/request', {
      method: 'POST',
      body: JSON.stringify(corpo),
    })) as { issueKey?: unknown; issueId?: unknown }

    const issueKey = String(resposta?.issueKey ?? '')
    if (!issueKey) {
      throw new ErroAtlassian('resposta de criação sem issueKey', {
        transitorio: false,
        recurso: 'criarChamado',
      })
    }
    return { issueKey, issueId: String(resposta?.issueId ?? '') }
  }

  async obterChamado(issueKey: string): Promise<Chamado> {
    const dados = (await this.transporte.requisitar(
      `/rest/servicedeskapi/request/${encodeURIComponent(issueKey)}?expand=requestType,sla,status`,
    )) as {
      issueKey?: unknown
      requestFieldValues?: { fieldId?: unknown; value?: unknown }[]
      currentStatus?: { status?: unknown; statusDate?: { iso8601?: unknown } }
      createdDate?: { iso8601?: unknown }
    }

    const campos = new Map<string, unknown>(
      (dados?.requestFieldValues ?? []).map((f) => [String(f.fieldId ?? ''), f.value]),
    )
    const rotulo = String(
      (campos.get('priority') as { name?: unknown } | undefined)?.name ?? '',
    )

    return {
      issueKey: String(dados?.issueKey ?? issueKey),
      titulo: String(campos.get('summary') ?? ''),
      descricao: String(campos.get('description') ?? ''),
      status: String(dados?.currentStatus?.status ?? 'Desconhecido'),
      prioridade: PRIORIDADE_POR_ROTULO[rotulo] ?? null,
      criadoEm: String(dados?.createdDate?.iso8601 ?? ''),
      atualizadoEm: String(dados?.currentStatus?.statusDate?.iso8601 ?? ''),
      slaPrimeiraResposta: null,
    }
  }

  /** RF-32 / RN-05 — as duas camadas. Ver `comentarios.ts` para o porquê. */
  async listarComentariosPublicos(issueKey: string): Promise<readonly ComentarioPublico[]> {
    const dados = (await this.transporte.requisitar(
      `/rest/servicedeskapi/request/${encodeURIComponent(issueKey)}/comment${montarQueryComentarios()}`,
    )) as { values?: unknown[] }
    return filtrarPublicos(dados?.values ?? [])
  }

  async comentar(issueKey: string, corpo: string, autorEmail: string, autorNome?: string): Promise<void> {
    await this.transporte.requisitar(
      `/rest/servicedeskapi/request/${encodeURIComponent(issueKey)}/comment`,
      {
        method: 'POST',
        body: JSON.stringify({
          body: prefixarAutoria(corpo, autorNome ?? autorEmail, autorEmail),
          public: true,
        }),
      },
    )
  }

  /** Busca por CQL — endpoint **v1**; não há equivalente v2 para CQL (R-09). */
  async buscarConfluence(params: BuscaConfluenceParams): Promise<readonly PaginaConfluence[]> {
    if (params.espacosPermitidos.length === 0) {
      // Negação por padrão (RNF-07): sem allowlist, não se busca. Nem chega a
      // sair requisição — allowlist vazia com query aberta buscaria o site todo.
      return []
    }
    const cql = montarCql(params)
    const chave = `busca:${cql}:${params.limite}`
    const cacheado = this.cacheConteudo.obter(chave)
    if (cacheado) return cacheado as PaginaConfluence[]

    const dados = (await this.transporte.requisitar(
      `/wiki/rest/api/search?cql=${encodeURIComponent(cql)}&limit=${params.limite}`,
    )) as RespostaBusca

    const candidatas: PaginaConfluence[] = (dados?.results ?? []).map((r) => ({
      id: String(r.content?.id ?? ''),
      titulo: String(r.content?.title ?? r.title ?? ''),
      espaco: String(r.content?.space?.key ?? ''),
      url: `${this.opcoes.baseUrl}/wiki${String(r.url ?? '')}`,
      score: typeof r.score === 'number' ? r.score : 0,
      trecho: String(r.excerpt ?? '').replace(/<[^>]*>/g, ''),
      labels: [],
    }))

    // RF-40 / RN-06 — a terceira condição: página SEM RESTRIÇÃO. O CQL exclui por
    // espaço e por label, mas não por restrição de página, e espaço liberado não
    // implica página liberada.
    const paginas: PaginaConfluence[] = []
    for (const p of candidatas) {
      if (await this.paginaRestrita(p.id)) continue
      paginas.push(p)
    }

    this.cacheConteudo.definir(chave, paginas, this.opcoes.ttlConteudoSeg)
    return paginas
  }

  /**
   * A página tem qualquer restrição de leitura? — RF-40, RN-06.
   *
   * ⚠️ **Sob proxy total (D-01), QUALQUER restrição exclui a página.** Não dá para
   * avaliar "esta pessoa pode ver?": perante a Atlassian a identidade é sempre a
   * conta de serviço, e o colaborador não existe como usuário. A conta de serviço
   * enxerga tudo a que ela tem acesso — então usar a permissão dela como proxy da
   * permissão da pessoa é exatamente o vazamento que RNF-09 proíbe. Restrição
   * presente = não expor (RNF-07).
   *
   * ⚠️ Erro ao consultar a restrição também **exclui** a página. Fail-closed: na
   * dúvida sobre exposição, não expor. Custa uma página a menos na deflexão; o
   * contrário custa conteúdo restrito na tela de quem não devia ver.
   *
   * Custo: uma chamada por página candidata. Contido pelo cache de conteúdo
   * (RNF-13) e pelo `limite` da busca — correção antes de latência, num requisito
   * de exposição.
   */
  async paginaRestrita(idPagina: string): Promise<boolean> {
    if (!idPagina) return true
    const chave = `restricao:${idPagina}`
    const cacheado = this.cacheConteudo.obter(chave)
    if (cacheado !== undefined) return cacheado as boolean

    try {
      const dados = (await this.transporte.requisitar(
        `/wiki/rest/api/content/${encodeURIComponent(idPagina)}/restriction/byOperation/read`,
      )) as {
        restrictions?: {
          user?: { results?: unknown[] }
          group?: { results?: unknown[] }
        }
      }
      const usuarios = dados?.restrictions?.user?.results ?? []
      const grupos = dados?.restrictions?.group?.results ?? []
      const restrita = usuarios.length > 0 || grupos.length > 0
      this.cacheConteudo.definir(chave, restrita, this.opcoes.ttlConteudoSeg)
      return restrita
    } catch {
      // Não cacheia a falha: indisponibilidade momentânea não deve esconder a
      // página pelo TTL inteiro.
      return true
    }
  }

  async buscarHistoricoTickets(params: HistoricoParams): Promise<readonly TicketHistorico[]> {
    const jql = montarJql(params)
    const dados = (await this.transporte.requisitar(
      `/rest/api/3/search/jql?jql=${encodeURIComponent(jql)}&maxResults=${params.limite}&fields=summary,created,resolutiondate,comment,labels`,
    )) as {
      issues?: {
        key?: unknown
        fields?: {
          summary?: unknown
          created?: unknown
          resolutiondate?: unknown
          labels?: unknown
          comment?: { comments?: { body?: unknown }[] }
        }
      }[]
    }

    return (dados?.issues ?? []).map((issue) => {
      const comentarios = issue.fields?.comment?.comments ?? []
      return {
        issueKey: String(issue.key ?? ''),
        titulo: String(issue.fields?.summary ?? ''),
        criadoEm: String(issue.fields?.created ?? ''),
        resolvidoEm: issue.fields?.resolutiondate ? String(issue.fields.resolutiondate) : null,
        chaveAgrupamento: params.chaveAgrupamento,
        // Só os últimos comentários interessam: a resolução costuma estar no fim,
        // e ler o histórico inteiro multiplica o custo de IA (R-08).
        comentariosResolucao: comentarios
          .slice(-3)
          .map((c) => (typeof c.body === 'string' ? c.body : JSON.stringify(c.body ?? '')))
          .filter((s) => s.length > 0),
      }
    })
  }

  async buscarChamadosPorChaveIdempotencia(chave: string): Promise<readonly ChamadoCriado[]> {
    // A chave é gravada na descrição por `montarCamposSolicitante` — é o que
    // permite reconciliar o pior caso (RNF-21) mesmo sem o campo customizado (Q4).
    const jql = `text ~ "${escaparCql(chave)}" ORDER BY created DESC`
    const dados = (await this.transporte.requisitar(
      `/rest/api/3/search/jql?jql=${encodeURIComponent(jql)}&maxResults=5&fields=id`,
    )) as { issues?: { key?: unknown; id?: unknown }[] }
    return (dados?.issues ?? []).map((i) => ({
      issueKey: String(i.key ?? ''),
      issueId: String(i.id ?? ''),
    }))
  }

  async verificarSaude(): Promise<{ ok: boolean; detalhe: string }> {
    try {
      await this.transporte.requisitar('/rest/servicedeskapi/servicedesk?limit=1')
      const { total429, totalRequisicoes } = this.contadores
      return { ok: true, detalhe: `ok · 429s: ${total429}/${totalRequisicoes}` }
    } catch (erro) {
      // Mensagem sem corpo de resposta (RNF-01) — `ErroAtlassian` já garante isso.
      return { ok: false, detalhe: erro instanceof Error ? erro.message : 'falha' }
    }
  }
}

export { SLA_PRIMEIRA_RESPOSTA_HORAS }
