/**
 * Cliente Atlassian real — a ÚNICA porta para a Atlassian (RNF-22).
 *
 * Duas credenciais distintas, e isto importa para rotação e privilégio (RNF-01,
 * RNF-04): Jira/Confluence usam **API token com Basic auth** em
 * `goengenharia.atlassian.net`; a Organizations API (Fase 2) exige **API key de
 * organização como Bearer** em `api.atlassian.com/admin` e papel de Org Admin.
 * Este arquivo trata só da primeira.
 *
 * ⚠️ **Nenhum valor de ambiente aparece aqui** (RNF-25): service desk, request type e
 * espaço chegam por parâmetro/config. O campo estruturado do solicitante saiu da config
 * em `D-36` e é resolvido **por request type** em `tickets/campos-do-solicitante.ts` —
 * fora deste cliente, que continua burro quanto a política.
 *
 * ⚠️ Sobre a API do Confluence (R-09): a busca por **CQL só existe na v1**
 * (`/wiki/rest/api/search`), enquanto o **conteúdo já tem v2**
 * (`/wiki/api/v2/pages/{id}`). Parte da v1 está em depreciação — por isso as duas
 * versões aparecem lado a lado de propósito, e cada uma está anotada. Verificar o
 * changelog antes de fixar novos endpoints v1.
 */

import { prefixarAutoria, filtrarPublicos, montarQueryComentarios } from './comentarios'
import { CacheTtl, TransporteAtlassian, type OpcoesHttp } from './http'
import { CONCORRENCIA_ATLASSIAN, mapearComLimite } from '../paralelo'
import {
  ErroAtlassian,
  MAX_ANEXO_BYTES,
  SLA_PRIMEIRA_RESPOSTA_HORAS,
  type BuscaConfluenceParams,
  type CampoRequestType,
  type Chamado,
  type ChamadoCriado,
  type ClienteAtlassian,
  type ComentarioPublico,
  type EspacoConfluence,
  type FilhosParams,
  type HistoricoParams,
  type MetadadosPagina,
  type NovoChamado,
  type PaginaConfluence,
  type Prioridade,
  type ResultadoAnexo,
  type TicketHistorico,
  type TipoChamado,
  type TipoCampoRequestType,
} from './tipos'

/**
 * As três caches do cliente, separadas por **tamanho do valor**, não por assunto.
 *
 * `metadados` e `conteudo` guardam coisas pequenas (chave de espaço, lista de tipos,
 * booleano de restrição, resultado de busca). `corpo` guarda storage de página, que vai
 * até 400 KB — o teto que a sanitização aplica. Uma cache só, com teto único, obrigaria a
 * escolher entre guardar poucas páginas ou arriscar centenas de megabytes num Worker de
 * 128 MB; separadas, cada teto é dimensionado pelo que cabe dentro dele.
 */
export interface CachesAtlassian {
  readonly metadados: CacheTtl<unknown>
  readonly conteudo: CacheTtl<unknown>
  readonly corpo: CacheTtl<unknown>
}

/**
 * Caches novas e vazias.
 *
 * ⚠️ Quem chama decide **quanto elas vivem**, e é essa decisão que faz `RNF-13` existir ou
 * não: instância nova por requisição (o que acontecia antes) é cache que nunca acerta. Ver
 * `contexto.ts`.
 */
export function novasCachesAtlassian(agoraMs: () => number = () => Date.now()): CachesAtlassian {
  return {
    metadados: new CacheTtl(agoraMs, 500),
    conteudo: new CacheTtl(agoraMs, 400),
    // 30 × 400 KB de pior caso ≈ 12 MB. Trinta páginas cobre a navegação de uma sessão
    // inteira, e o corpo é o valor mais barato de rebuscar: uma requisição, sem as três
    // de metadados/labels/restrição que decidem a exposição.
    corpo: new CacheTtl(agoraMs, 30),
  }
}

export interface OpcoesCliente extends OpcoesHttp {
  /** TTLs de cache (RNF-13). */
  readonly ttlMetadadosSeg: number
  readonly ttlConteudoSeg: number
  readonly agoraMs?: () => number
  /**
   * Caches a reaproveitar. Omitir cria caches próprias e vazias — é o que os testes
   * querem (isolamento entre casos) e é o que **não** se quer em produção.
   */
  readonly caches?: CachesAtlassian
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
    condicaoDeTexto(params),
  ]
  for (const label of params.labelsBloqueadas) {
    partes.push(`label != "${escaparCql(label)}"`)
  }
  return partes.join(' AND ')
}

/**
 * A condição de texto: a frase inteira, ou QUALQUER uma das palavras (`D-40`).
 *
 * 🚨 **O grupo `OR` vai entre parênteses, e isso não é estilo.** Em CQL o `AND` liga
 * mais forte que o `OR`: `space in (...) AND text ~ "a" OR text ~ "b"` significa
 * `(space in (...) AND text ~ "a") OR text ~ "b"` — e a segunda palavra buscaria o
 * site **inteiro**. A allowlist de `RN-06` teria sido contornada pela própria
 * consulta que existe para aplicá-la, sem erro nenhum e com resultado plausível na
 * tela. Há teste de burla afirmando os parênteses.
 */
function condicaoDeTexto(params: BuscaConfluenceParams): string {
  const palavras = params.palavrasAlternativas ?? []
  if (palavras.length === 0) return `text ~ "${escaparCql(params.termo)}"`
  return `(${palavras.map((p) => `text ~ "${escaparCql(p)}"`).join(' OR ')})`
}

/**
 * CQL de um nível da árvore — `RF-41`.
 *
 * ⚠️ Mesma disciplina de `montarCql`: a allowlist entra na **query**, não num filtro
 * posterior. E o `idPai` vem do cliente HTTP, então ele é escapado — sem isso um
 * `pai` com `"` fecharia a string e reescreveria `space in (...)`, que é a allowlist.
 */
export function montarCqlFilhos(params: FilhosParams): string {
  const espacos = params.espacosPermitidos.map((e) => `"${escaparCql(e)}"`).join(', ')
  const partes = [
    `type = page`,
    `space in (${espacos})`,
    `parent = "${escaparCql(params.idPai)}"`,
  ]
  for (const label of params.labelsBloqueadas) {
    partes.push(`label != "${escaparCql(label)}"`)
  }
  return `${partes.join(' AND ')} ORDER BY title ASC`
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

/**
 * Janela usada quando não há marca-d'água ainda (primeiro boot, ou banco novo).
 *
 * ⚠️ **Não é "traga tudo".** Varredura completa é a forma mais fácil de descobrir os
 * burst limits não publicados da Atlassian do jeito ruim (`R-02`, `RNF-15`) — e não
 * ganharia nada: sem marca-d'água não há histórico de notificação para recuperar, e
 * chamado antigo já foi avisado (ou nunca vai ser, o que é melhor que avisar dez de uma
 * vez às 3h da manhã).
 */
export const JANELA_INICIAL_POLLING_MIN = 30

/**
 * Margem para trás na marca-d'água.
 *
 * O JQL tem precisão de **minuto**; o carimbo do Jira tem milissegundos. Sem margem,
 * uma mudança no mesmo minuto da marca fica do lado errado do `>=` e desaparece. Reler
 * um minuto duas vezes é grátis — a dedupe (`RF-47`) descarta o repetido.
 */
export const MARGEM_POLLING_MIN = 2

/**
 * Data no formato que o JQL aceita: `"2026-08-06 10:00"` em **UTC**.
 *
 * ⚠️ JQL interpreta data sem fuso no **fuso do usuário da API**, que é configuração da
 * conta de serviço no Jira — não do Worker. Isso é uma imprecisão conhecida e coberta
 * pela margem acima; o alternativa (`updated >= -35m`, relativo) evita fuso mas perde a
 * marca-d'água persistida, que é o que garante não pular janela quando um cron falha.
 */
function paraJql(ms: number): string {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(
    d.getUTCHours(),
  )}:${p(d.getUTCMinutes())}`
}

/**
 * JQL do polling incremental (T-210).
 *
 * `reporter = currentUser()` é o filtro que substitui um project key: sob proxy total
 * (`D-01`) **todo** chamado aberto pelo app tem a conta de serviço como reporter. Isso
 * mantém `RNF-25` (nada hardcoded) sem precisar de mais um campo de config, e restringe
 * a consulta ao que é nosso — chamado que o time de tech abriu direto no Jira não entra
 * na varredura.
 */
export function montarJqlAtualizados(desde: string | null, agoraMs: number): string {
  const desdeMs = desde ? Date.parse(desde) : Number.NaN
  const base = Number.isFinite(desdeMs)
    ? desdeMs - MARGEM_POLLING_MIN * 60_000
    : agoraMs - JANELA_INICIAL_POLLING_MIN * 60_000
  return `reporter = currentUser() AND updated >= "${paraJql(base)}" ORDER BY updated ASC`
}

/** `system` dos campos que o formulário fixo já cobre (RF-27) — nunca duplicar. */
const CAMPOS_DE_SISTEMA_JA_COBERTOS = new Set(['summary', 'description', 'priority'])

/**
 * Quantos service desks são varridos ao listar tipos de chamado.
 *
 * Cada um custa uma chamada, e a lista de desks vem de fora (`R-02`). O site da Gocase
 * tem 5; o teto existe para o dia em que alguém criar 80.
 */
const MAX_SERVICE_DESKS = 20

interface CampoRequestTypeBruto {
  fieldId?: unknown
  name?: unknown
  required?: unknown
  jiraSchema?: { type?: unknown; system?: unknown; custom?: unknown; items?: unknown }
  validValues?: { id?: unknown; value?: unknown; label?: unknown }[]
}

/**
 * Filtra e mapeia o schema bruto do JSM para os campos ADICIONAIS do formulário
 * (RF-27) — os três campos de sistema (`summary`/`description`/`priority`) já
 * têm input fixo (`D-04`) e nunca aparecem duas vezes.
 *
 * Exportada (como `montarCql`/`escaparCql`) para ser testável sem rede: o shape
 * exato de `jiraSchema.custom` (o que distingue texto curto de área de texto)
 * **[SUPOSIÇÃO — verificável só com credencial (Q1)]** é inferido da doc pública
 * do JSM, não de uma resposta real ainda vista.
 */
export function camposAdicionais(brutos: readonly CampoRequestTypeBruto[]): CampoRequestType[] {
  const resultado: CampoRequestType[] = []
  for (const bruto of brutos) {
    const fieldId = String(bruto.fieldId ?? '')
    const sistema = typeof bruto.jiraSchema?.system === 'string' ? bruto.jiraSchema.system : null
    if (!fieldId || (sistema !== null && CAMPOS_DE_SISTEMA_JA_COBERTOS.has(sistema))) continue

    const opcoes = (bruto.validValues ?? []).map((v) => ({
      id: String(v.id ?? v.value ?? ''),
      rotulo: String(v.label ?? v.value ?? v.id ?? ''),
    }))
    const custom = typeof bruto.jiraSchema?.custom === 'string' ? bruto.jiraSchema.custom : ''
    const tipoBruto = typeof bruto.jiraSchema?.type === 'string' ? bruto.jiraSchema.type : ''
    const itens = typeof bruto.jiraSchema?.items === 'string' ? bruto.jiraSchema.items : ''
    // ⚠️ Anexo é reconhecido ANTES do resto: o `else` final é `'texto'`, então sem
    // este ramo o campo de anexo viraria uma caixa de texto na tela (RF-27) e o
    // servidor não teria como saber que o tipo aceita arquivo (RF-62).
    const tipo: TipoCampoRequestType =
      sistema === 'attachment' || itens === 'attachment'
        ? 'anexo'
        : opcoes.length > 0 || tipoBruto === 'option'
          ? 'selecao'
          : custom.toLowerCase().includes('textarea')
            ? 'texto_longo'
            : 'texto'

    resultado.push({
      fieldId,
      rotulo: String(bruto.name ?? fieldId),
      obrigatorio: Boolean(bruto.required),
      tipo,
      // ⚠️ `'selecao'` junta escolha única e múltipla — `opcoes.length > 0` é verdade
      // nas duas. Quem as separa é `jiraSchema.type`: `array` é a Atlassian dizendo que
      // o campo guarda **lista**, e ali o valor de criação tem de vir dentro de `[…]`.
      // Sem esta linha, `tickets/valores-de-campo.ts` mandaria o objeto solto e o campo
      // múltiplo continuaria devolvendo o 400 do `D-39` — o mesmo bug, num subconjunto
      // menor de tipos, e sem nada na tela indicando.
      multiplo: tipoBruto === 'array',
      opcoes,
    })
  }
  return resultado
}

interface RespostaBusca {
  results?: ResultadoBruto[]
}

interface ResultadoBruto {
  content?: { id?: unknown; title?: unknown; space?: { key?: unknown } }
  /** O espaço do resultado — `title` é o NOME dele, `displayUrl` é `/spaces/<CHAVE>`. */
  resultGlobalContainer?: { title?: unknown; displayUrl?: unknown }
  title?: unknown
  score?: unknown
  excerpt?: unknown
  url?: unknown
}

/**
 * Expansão pedida ao endpoint **v1** de search.
 *
 * 🚨 Sem ela, `content` volta **sem** `space`, e todo resultado saía com
 * `espaco: ''` — medido na staging em 12/08/2026, os 10 itens de `?q=deploy`
 * (`D-41`). Não era furo de exposição (o CQL já restringe por `space in (...)` e
 * `RN-06` segue avaliada por página), era a origem sumindo da tela de resultados e
 * espaço vazio indo para `paginas_lidas`.
 */
const EXPAND_BUSCA = 'content.space'

/**
 * A **chave** do espaço de um resultado de busca.
 *
 * ⚠️ O fallback lê `displayUrl` (`/spaces/GT`), **nunca** `resultGlobalContainer.title`
 * — o título é o *nome* do espaço ("Gestão de Tecnologia") e a allowlist, a árvore e
 * o `?espaco=` são todos por *chave*. Nome onde se espera chave é a mesma classe de
 * bug que o `spaceId` numérico da v2 provoca: funciona na tela e nega tudo no resto.
 *
 * Não achou nenhuma das duas? Vazio, como antes. Palpite aqui é pior que ausência.
 */
function chaveDoEspaco(r: ResultadoBruto): string {
  const daExpansao = r.content?.space?.key
  if (typeof daExpansao === 'string' && daExpansao !== '') return daExpansao
  const url = r.resultGlobalContainer?.displayUrl
  const casado = typeof url === 'string' ? /\/spaces\/([^/?#]+)/.exec(url) : null
  return casado ? decodeURIComponent(casado[1]!) : ''
}

export class ClienteAtlassianHttp implements ClienteAtlassian {
  private readonly transporte: TransporteAtlassian
  private readonly cacheMetadados: CacheTtl<unknown>
  private readonly cacheConteudo: CacheTtl<unknown>
  private readonly cacheCorpo: CacheTtl<unknown>

  constructor(private readonly opcoes: OpcoesCliente) {
    this.transporte = new TransporteAtlassian(opcoes)
    const caches = opcoes.caches ?? novasCachesAtlassian(opcoes.agoraMs ?? (() => Date.now()))
    this.cacheMetadados = caches.metadados
    this.cacheConteudo = caches.conteudo
    this.cacheCorpo = caches.corpo
  }

  /** RF-60 — a única telemetria de orçamento que existe com API token (RNF-15). */
  get contadores() {
    return this.transporte.contadores
  }

  async listarTiposChamado(): Promise<readonly TipoChamado[]> {
    const cacheado = this.cacheMetadados.obter('tiposChamado')
    if (cacheado) return cacheado as TipoChamado[]

    // 🚨 **O endpoint GLOBAL `/rest/servicedeskapi/requesttype` é EXPERIMENTAL e
    // responde 412** sem o cabeçalho `X-ExperimentalApi: opt-in` — medido contra a
    // Atlassian real em 07/08/2026, com credencial válida. Era o que este método usava,
    // então `listarTiposChamado` **não funcionava em produção**: nem a allowlist de
    // `RF-28` podia ser montada, nem o formulário sem IA sabia que tipos oferecer.
    //
    // A saída não é ligar o opt-in: "experimental" é a Atlassian avisando que pode mudar
    // sem aviso, e uma allowlist que depende disso quebra num dia qualquer. O caminho
    // **estável** é por service desk (`/servicedesk/{id}/requesttype`, 200 sem cabeçalho
    // nenhum), e ele custa uma chamada a mais para listar os desks — pago uma vez por TTL
    // de cache, não por requisição de usuário.
    const desks = (await this.transporte.requisitar('/rest/servicedeskapi/servicedesk')) as {
      values?: { id?: unknown }[]
    }
    const idsDesk = (desks?.values ?? [])
      .map((d) => String(d.id ?? ''))
      .filter((id) => id.length > 0)
      // Teto: cada desk é uma chamada, e a lista vem de fora (`R-02`).
      .slice(0, MAX_SERVICE_DESKS)

    const tipos: TipoChamado[] = []
    for (const serviceDeskId of idsDesk) {
      const dados = (await this.transporte.requisitar(
        `/rest/servicedeskapi/servicedesk/${encodeURIComponent(serviceDeskId)}/requesttype`,
      )) as { values?: { id?: unknown; name?: unknown; description?: unknown }[] }

      for (const v of dados?.values ?? []) {
        const id = String(v.id ?? '')
        if (!id) continue
        tipos.push({
          id,
          // ⚠️ Vem do laço, não do corpo: o endpoint por desk **não repete**
          // `serviceDeskId` em cada item, e `String(undefined ?? '')` daria `''` —
          // um tipo sem desk é um tipo com que não se cria chamado nenhum.
          serviceDeskId,
          nome: String(v.name ?? ''),
          descricao: typeof v.description === 'string' ? v.description : null,
        })
      }
    }
    this.cacheMetadados.definir('tiposChamado', tipos, this.opcoes.ttlMetadadosSeg)
    return tipos
  }

  /**
   * Schema de campos adicionais do request type (RF-27, T-130).
   *
   * A chave de cache inclui `serviceDeskId` **e** `requestTypeId` — diferente de
   * `listarTiposChamado`, que usa uma chave fixa: aqui há um schema por tipo.
   */
  async obterCamposDoTipo(
    serviceDeskId: string,
    requestTypeId: string,
  ): Promise<readonly CampoRequestType[]> {
    const chave = `camposDoTipo:${serviceDeskId}:${requestTypeId}`
    const cacheado = this.cacheMetadados.obter(chave)
    if (cacheado) return cacheado as CampoRequestType[]

    const dados = (await this.transporte.requisitar(
      `/rest/servicedeskapi/servicedesk/${encodeURIComponent(serviceDeskId)}/requesttype/${encodeURIComponent(requestTypeId)}/field`,
    )) as { requestTypeFields?: CampoRequestTypeBruto[] }

    const campos = camposAdicionais(dados?.requestTypeFields ?? [])
    this.cacheMetadados.definir(chave, campos, this.opcoes.ttlMetadadosSeg)
    return campos
  }

  /**
   * Campos que carregam o solicitante real — RF-21, mitigação de R-03.
   *
   * ⚠️ **Cinto e suspensório, de propósito.** O e-mail vai nos campos estruturados
   * *quando o request type os expõe* **e** sempre no corpo da descrição. Motivo: sem
   * a linha na descrição, todo chamado de um tipo sem esses campos chega ao time de
   * tech como "aberto pelo robô" — o risco R-03 inteiro. Hoje **14 dos 15** tipos do
   * `GN` não têm campo de solicitante, então o cabeçalho não é redundância: é a
   * garantia, e o campo estruturado é o extra.
   *
   * 🚨 **O campo estruturado NÃO se decide aqui, e nem por config global** (`D-36`).
   * Quem resolve é `tickets/campos-do-solicitante.ts`, **por request type** e cruzando
   * com o schema, porque o mesmo `fieldId` significa coisas diferentes em tipos
   * diferentes (`customfield_10092`: cargo no 108, sistema do bug no 70). O valor chega
   * aqui já resolvido, dentro de `camposDinamicos` — este cliente continua burro quanto
   * a política, como já é para `RN-06`.
   */
  montarCamposSolicitante(dados: NovoChamado): {
    descricao: string
    camposExtra: Record<string, unknown>
  } {
    const cabecalho = `**Solicitante:** ${dados.solicitanteEmail}\n**Aberto via:** goatlas\n**Ref:** ${dados.chaveIdempotencia}\n\n---\n\n`
    const camposExtra: Record<string, unknown> = {}
    if (this.opcoes.campoPrioridadeId) {
      camposExtra[this.opcoes.campoPrioridadeId] = { name: ROTULO_PRIORIDADE[dados.prioridade] }
    }
    return { descricao: cabecalho + dados.descricao, camposExtra }
  }

  async criarChamado(dados: NovoChamado): Promise<ChamadoCriado> {
    const { descricao, camposExtra } = this.montarCamposSolicitante(dados)
    // RF-27 (T-130) — campos adicionais do request type. `camposExtra` vem DEPOIS
    // de propósito: mesmo que um `fieldId` dinâmico colida com o campo de
    // solicitante/prioridade, o valor de sistema vence (defesa em profundidade,
    // igual à dupla checagem de RF-32).
    const camposDinamicos = { ...dados.camposDinamicos }
    delete camposDinamicos.summary
    delete camposDinamicos.description
    const corpo = {
      serviceDeskId: dados.serviceDeskId,
      requestTypeId: dados.tipoChamadoId,
      requestFieldValues: {
        summary: dados.titulo,
        description: descricao,
        ...camposDinamicos,
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
      `/wiki/rest/api/search?cql=${encodeURIComponent(cql)}&limit=${params.limite}&expand=${EXPAND_BUSCA}`,
    )) as RespostaBusca

    const candidatas: PaginaConfluence[] = (dados?.results ?? []).map((r) => ({
      id: String(r.content?.id ?? ''),
      titulo: String(r.content?.title ?? r.title ?? ''),
      espaco: chaveDoEspaco(r),
      url: `${this.opcoes.baseUrl}/wiki${String(r.url ?? '')}`,
      score: typeof r.score === 'number' ? r.score : 0,
      trecho: String(r.excerpt ?? '').replace(/<[^>]*>/g, ''),
      labels: [],
    }))

    // RF-40 / RN-06 — a terceira condição: página SEM RESTRIÇÃO. O CQL exclui por
    // espaço e por label, mas não por restrição de página, e espaço liberado não
    // implica página liberada.
    //
    // Em paralelo COM TETO (ver `paralelo.ts`): eram N idas em série antes de a primeira
    // linha de resultado aparecer na tela, com N = `limite` da busca. O teto está aqui e
    // não em `Promise.all` porque a credencial é única e o burst limit da Atlassian não é
    // publicado (`R-02`). A ordem por relevância é preservada pelo `mapearComLimite`.
    const restricoes = await mapearComLimite(candidatas, CONCORRENCIA_ATLASSIAN, (p) =>
      this.paginaRestrita(p.id),
    )
    const paginas: PaginaConfluence[] = candidatas.filter((_, i) => !restricoes[i])

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

  /**
   * Metadados de página — **v2** (`/wiki/api/v2/pages/{id}`), T-110.
   *
   * ⚠️ **A v2 devolve `spaceId` numérico; a allowlist é por CHAVE de espaço**
   * (`TECH`). Comparar a allowlist com o id não dá erro visível: dá negação
   * silenciosa de tudo hoje e, se alguém "consertar" invertendo a comparação, uma
   * condição de `RN-06` que nunca reprova. Daí `chaveDoEspaco`, cacheada nos
   * metadados (chave de espaço não muda).
   *
   * ⚠️ Labels vêm em requisição separada (a v2 não as embute) e **não** têm
   * `try/catch`: sem a lista de labels não há como avaliar a segunda condição de
   * `RN-06`, e ausência de informação é negar. Quem trata a recusa é o gate em
   * `confluence/acesso.ts`.
   */
  async obterMetadadosPagina(idPagina: string): Promise<MetadadosPagina> {
    if (!idPagina) {
      throw new ErroAtlassian('página sem id', {
        transitorio: false,
        recurso: 'obterMetadadosPagina',
      })
    }
    const chave = `metadados:${idPagina}`
    const cacheado = this.cacheConteudo.obter(chave)
    if (cacheado) return cacheado as MetadadosPagina

    const dados = (await this.transporte.requisitar(
      `/wiki/api/v2/pages/${encodeURIComponent(idPagina)}`,
    )) as {
      id?: unknown
      title?: unknown
      parentId?: unknown
      spaceId?: unknown
      status?: unknown
      version?: { number?: unknown; createdAt?: unknown }
      _links?: { webui?: unknown }
    }

    /**
     * Chave do espaço e labels são **duas requisições independentes** — a v2 não embute
     * nenhuma das duas — e eram feitas em série. Juntas, em paralelo: economiza uma ida
     * inteira por página, e uma leitura com breadcrumb toca até seis páginas (`RF-41`).
     *
     * ⚠️ `allSettled` + relançar, não `Promise.all`: com `all`, a rejeição da que perdeu a
     * corrida fica sem tratamento e o runtime a reporta como erro não capturado, quando na
     * verdade ela foi tratada. E as duas continuam **obrigatórias** — ausência de
     * informação é negar (`RN-06`): sem chave de espaço não há como avaliar a allowlist,
     * sem labels não há como avaliar o bloqueio por label. O erro do espaço tem precedência
     * porque era ele que subia primeiro na versão em série.
     */
    const [resEspaco, resLabels] = await Promise.allSettled([
      this.chaveDoEspaco(String(dados?.spaceId ?? '')),
      this.labelsDaPagina(idPagina),
    ])
    if (resEspaco.status === 'rejected') throw resEspaco.reason
    if (resLabels.status === 'rejected') throw resLabels.reason

    const metadados: MetadadosPagina = {
      id: String(dados?.id ?? idPagina),
      idPai: dados?.parentId === undefined || dados?.parentId === null
        ? null
        : String(dados.parentId),
      titulo: String(dados?.title ?? ''),
      espaco: resEspaco.value,
      labels: resLabels.value,
      atual: String(dados?.status ?? '') === 'current',
      versao: Number(dados?.version?.number ?? 0),
      atualizadoEm: String(dados?.version?.createdAt ?? ''),
      url: `${this.opcoes.baseUrl}/wiki${String(dados?._links?.webui ?? '')}`,
    }
    this.cacheConteudo.definir(chave, metadados, this.opcoes.ttlConteudoSeg)
    return metadados
  }

  /** Espaço por chave — v2 (`/wiki/api/v2/spaces?keys=`). Cacheado como metadado. */
  async obterEspaco(chaveEspaco: string): Promise<EspacoConfluence> {
    const chave = `espacoPorChave:${chaveEspaco}`
    const cacheado = this.cacheMetadados.obter(chave)
    if (cacheado) return cacheado as EspacoConfluence

    const dados = (await this.transporte.requisitar(
      `/wiki/api/v2/spaces?keys=${encodeURIComponent(chaveEspaco)}&limit=1`,
    )) as { results?: { id?: unknown; key?: unknown; name?: unknown; homepageId?: unknown }[] }

    const bruto = (dados?.results ?? [])[0]
    if (!bruto) {
      throw new ErroAtlassian('espaço não encontrado', {
        status: 404,
        transitorio: false,
        recurso: 'obterEspaco',
      })
    }
    const espaco: EspacoConfluence = {
      chave: String(bruto.key ?? chaveEspaco),
      nome: String(bruto.name ?? chaveEspaco),
      homepageId: bruto.homepageId === undefined || bruto.homepageId === null
        ? null
        : String(bruto.homepageId),
    }
    // O id numérico → chave também serve para `obterMetadadosPagina`; preencher os dois
    // sentidos aqui evita uma chamada extra na primeira leitura de página do espaço.
    if (bruto.id !== undefined && bruto.id !== null) {
      this.cacheMetadados.definir(`espaco:${String(bruto.id)}`, espaco.chave, this.opcoes.ttlMetadadosSeg)
    }
    this.cacheMetadados.definir(chave, espaco, this.opcoes.ttlMetadadosSeg)
    return espaco
  }

  /**
   * Um nível da árvore (`RF-41`), pelo CQL — v1, como a busca (`R-09`).
   *
   * A terceira condição de `RN-06` (restrição por página) é aplicada **item por
   * item**, igual em `buscarConfluence`: o CQL não sabe filtrar restrição, e título de
   * página restrita numa lista de navegação é o mesmo vazamento que já apareceu na
   * mensagem de bloqueio uma vez.
   */
  async listarFilhosDaPagina(params: FilhosParams): Promise<readonly PaginaConfluence[]> {
    if (params.espacosPermitidos.length === 0 || !params.idPai) return []

    const cql = montarCqlFilhos(params)
    const chave = `filhos:${cql}:${params.limite}`
    const cacheado = this.cacheConteudo.obter(chave)
    if (cacheado) return cacheado as PaginaConfluence[]

    const dados = (await this.transporte.requisitar(
      `/wiki/rest/api/search?cql=${encodeURIComponent(cql)}&limit=${params.limite}&expand=${EXPAND_BUSCA}`,
    )) as RespostaBusca

    const candidatas: PaginaConfluence[] = (dados?.results ?? []).map((r) => ({
      id: String(r.content?.id ?? ''),
      titulo: String(r.content?.title ?? r.title ?? ''),
      espaco: chaveDoEspaco(r),
      url: `${this.opcoes.baseUrl}/wiki${String(r.url ?? '')}`,
      score: typeof r.score === 'number' ? r.score : 0,
      trecho: '',
      labels: [],
    }))

    // Mesmo desenho da busca: paralelo com teto, ordem preservada. Aqui o ganho é o mais
    // visível da tela — um clique na árvore custava até 50 idas em série (`RF-41`).
    const restricoes = await mapearComLimite(candidatas, CONCORRENCIA_ATLASSIAN, (p) =>
      this.paginaRestrita(p.id),
    )
    const filhos: PaginaConfluence[] = candidatas.filter((_, i) => !restricoes[i])
    this.cacheConteudo.definir(chave, filhos, this.opcoes.ttlConteudoSeg)
    return filhos
  }

  /** `spaceId` (v2) → chave do espaço, que é o que a allowlist usa (`RN-06`). */
  private async chaveDoEspaco(spaceId: string): Promise<string> {
    if (!spaceId) {
      throw new ErroAtlassian('página sem espaço', {
        transitorio: false,
        recurso: 'obterMetadadosPagina',
      })
    }
    const chave = `espaco:${spaceId}`
    const cacheado = this.cacheMetadados.obter(chave)
    if (typeof cacheado === 'string') return cacheado

    const dados = (await this.transporte.requisitar(
      `/wiki/api/v2/spaces/${encodeURIComponent(spaceId)}`,
    )) as { key?: unknown }
    const chaveEspaco = String(dados?.key ?? '')
    if (!chaveEspaco) {
      // Sem chave não há como avaliar a allowlist. Lançar, para o gate negar.
      throw new ErroAtlassian('espaço sem chave', {
        transitorio: false,
        recurso: 'obterMetadadosPagina',
      })
    }
    this.cacheMetadados.definir(chave, chaveEspaco, this.opcoes.ttlMetadadosSeg)
    return chaveEspaco
  }

  private async labelsDaPagina(idPagina: string): Promise<readonly string[]> {
    const dados = (await this.transporte.requisitar(
      `/wiki/api/v2/pages/${encodeURIComponent(idPagina)}/labels?limit=250`,
    )) as { results?: { name?: unknown }[] }
    return (dados?.results ?? []).map((l) => String(l.name ?? '')).filter((n) => n !== '')
  }

  /**
   * Storage format cru da página — **não sanitizado** (ver o contrato em `tipos.ts`).
   *
   * Cacheado no cache de conteúdo (`RNF-13`): a leitura repetida da mesma página é o
   * caso comum quando alguém é bloqueado pela Regra 1 e volta para reler.
   */
  async obterCorpoStorage(idPagina: string): Promise<string> {
    const chave = `storage:${idPagina}`
    // Cache própria (`cacheCorpo`), com teto pequeno: é o único valor grande que o cliente
    // guarda. Ver `novasCachesAtlassian`.
    const cacheado = this.cacheCorpo.obter(chave)
    if (typeof cacheado === 'string') return cacheado

    const dados = (await this.transporte.requisitar(
      `/wiki/api/v2/pages/${encodeURIComponent(idPagina)}?body-format=storage`,
    )) as { body?: { storage?: { value?: unknown } } }
    const storage = typeof dados?.body?.storage?.value === 'string' ? dados.body.storage.value : ''
    this.cacheCorpo.definir(chave, storage, this.opcoes.ttlConteudoSeg)
    return storage
  }

  /**
   * Anexo da página, por nome exato — T-112.
   *
   * Duas coisas que parecem detalhe e são a trava:
   *
   * 1. **O nome é casado contra a lista de anexos DAQUELA página.** Não existe
   *    "baixar anexo por caminho": o caminho vem da URL, e um caminho montado à mão
   *    alcançaria anexo de página restrita (`RF-40`).
   * 2. **`downloadLink` vem da Atlassian e só é aceito como caminho absoluto do
   *    próprio site.** Link absoluto para outro host faria o app buscar, **com a
   *    credencial**, onde a resposta mandasse.
   */
  async obterAnexo(idPagina: string, nomeArquivo: string): Promise<ResultadoAnexo> {
    if (!idPagina || !nomeArquivo) return { estado: 'nao_encontrado' }

    const lista = (await this.transporte.requisitar(
      `/wiki/api/v2/pages/${encodeURIComponent(idPagina)}/attachments?limit=250`,
    )) as {
      results?: { title?: unknown; mediaType?: unknown; fileSize?: unknown; downloadLink?: unknown }[]
    }

    const achado = (lista?.results ?? []).find((a) => String(a.title ?? '') === nomeArquivo)
    if (!achado) return { estado: 'nao_encontrado' }

    const tamanho = Number(achado.fileSize ?? 0)
    if (Number.isFinite(tamanho) && tamanho > MAX_ANEXO_BYTES) {
      // O tamanho anunciado já reprova: não vale gastar a requisição de download.
      return { estado: 'grande_demais', tamanhoBytes: tamanho }
    }

    const link = String(achado.downloadLink ?? '')
    if (!link.startsWith('/') || link.startsWith('//')) return { estado: 'nao_encontrado' }
    // [SUPOSIÇÃO — verificável só com credencial (Q1)] a v2 devolve o link relativo
    // ao contexto `/wiki`. Aceitar as duas formas evita `/wiki/wiki/...`.
    const caminho = link.startsWith('/wiki/') ? link : `/wiki${link}`

    const baixado = await this.transporte.requisitarBinario(caminho, MAX_ANEXO_BYTES)
    if (baixado.estado === 'grande_demais') return baixado

    return {
      estado: 'ok',
      anexo: {
        nomeArquivo,
        // O tipo do corpo manda; o `mediaType` da listagem é o fallback. Nenhum dos
        // dois é confiável — quem decide o que sai é `confluence/anexo.ts`.
        tipoDeclarado:
          baixado.tipoDeclarado ??
          (typeof achado.mediaType === 'string' ? achado.mediaType : null),
        bytes: baixado.bytes,
      },
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

  async buscarChamadosAtualizadosDesde(params: {
    desde: string | null
    limite: number
  }): Promise<readonly { issueKey: string; atualizadoEm: string }[]> {
    const jql = montarJqlAtualizados(params.desde, Date.now())
    const dados = (await this.transporte.requisitar(
      `/rest/api/3/search/jql?jql=${encodeURIComponent(jql)}&maxResults=${params.limite}&fields=updated`,
    )) as { issues?: { key?: unknown; fields?: { updated?: unknown } }[] }

    return (dados?.issues ?? [])
      .map((i) => ({
        issueKey: String(i.key ?? ''),
        atualizadoEm: String(i.fields?.updated ?? ''),
      }))
      .filter((i) => i.issueKey.length > 0)
  }

  /** Anexo em dois passos, os dois de uma vez — `RF-25`, `RF-34`. */
  async anexarArquivo(
    serviceDeskId: string,
    issueKey: string,
    arquivo: { nome: string; tipo: string; bytes: ArrayBuffer },
  ): Promise<void> {
    // ⚠️ **Composição, não um terceiro caminho.** `RF-34` (anexar depois) e `RF-61`
    // (anexar na criação) são os mesmos dois passos do JSM, em momentos diferentes.
    // Reimplementar o multipart aqui faria o cabeçalho de CSRF viver em dois lugares —
    // e o dia em que um deles mudasse, só metade dos anexos pararia de funcionar.
    const id = await this.subirAnexoTemporario(serviceDeskId, arquivo)
    await this.materializarAnexosTemporarios(issueKey, [id])
  }

  /**
   * ⚠️ O primeiro passo é **multipart com `X-Atlassian-Token: no-check`** — sem esse
   * cabeçalho a Atlassian recusa o upload como possível CSRF, e o erro que ela devolve
   * (403 genérico) não diz isso. É o tipo de detalhe que custa uma tarde.
   */
  async subirAnexoTemporario(
    serviceDeskId: string,
    arquivo: { nome: string; tipo: string; bytes: ArrayBuffer },
  ): Promise<string> {
    const form = new FormData()
    form.append('file', new Blob([arquivo.bytes], { type: arquivo.tipo }), arquivo.nome)

    const temporario = (await this.transporte.requisitarMultipart(
      `/rest/servicedeskapi/servicedesk/${encodeURIComponent(serviceDeskId)}/attachTemporaryFile`,
      form,
    )) as { temporaryAttachments?: { temporaryAttachmentId?: unknown }[] }

    const ids = (temporario?.temporaryAttachments ?? [])
      .map((t) => (typeof t.temporaryAttachmentId === 'string' ? t.temporaryAttachmentId : null))
      .filter((id): id is string => id !== null)

    const primeiro = ids[0]
    if (primeiro === undefined) {
      throw new ErroAtlassian('upload temporário não devolveu id de anexo', {
        transitorio: true,
        recurso: 'attachTemporaryFile',
      })
    }
    return primeiro
  }

  async materializarAnexosTemporarios(issueKey: string, ids: readonly string[]): Promise<void> {
    if (ids.length === 0) return
    await this.transporte.requisitar(
      `/rest/servicedeskapi/request/${encodeURIComponent(issueKey)}/attachment`,
      {
        method: 'POST',
        // `public: true` de propósito: é o anexo DO SOLICITANTE no próprio chamado, e
        // anexo interno seria invisível para quem o mandou (`RF-34`).
        body: JSON.stringify({ temporaryAttachmentIds: [...ids], public: true }),
      },
    )
  }

  async listarTransicoes(issueKey: string): Promise<readonly { id: string; nome: string }[]> {
    const dados = (await this.transporte.requisitar(
      `/rest/servicedeskapi/request/${encodeURIComponent(issueKey)}/transition`,
    )) as { values?: { id?: unknown; name?: unknown }[] }
    return (dados?.values ?? [])
      .map((t) => ({ id: String(t.id ?? ''), nome: String(t.name ?? '') }))
      .filter((t) => t.id.length > 0)
  }

  async transicionar(issueKey: string, transicaoId: string): Promise<void> {
    await this.transporte.requisitar(
      `/rest/servicedeskapi/request/${encodeURIComponent(issueKey)}/transition`,
      { method: 'POST', body: JSON.stringify({ id: transicaoId }) },
    )
  }

  telemetria(): { total429: number; totalRequisicoes: number } {
    return this.contadores
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
