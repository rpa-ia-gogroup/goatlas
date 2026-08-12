/**
 * Cliente Atlassian FAKE — habilita testar todo o produto sem rede e sem
 * credencial (que não existe ainda: Q1).
 *
 * Ele existe porque a camada é isolada (RNF-22): é o retorno concreto daquela
 * exigência, não um extra de teste. Os modos de falha injetáveis são o que torna
 * RNF-18 e RNF-17 verificáveis — "degradação graciosa" que ninguém consegue
 * testar é só uma frase no documento.
 */

import {
  ErroAtlassian,
  MAX_ANEXO_BYTES,
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
  type ResultadoAnexo,
  type TicketHistorico,
  type TipoChamado,
} from './tipos'
import type { CampoDoSchema } from './schema-diagnostico'

/** Comentário como o JSM devolve: com a flag `public` que RF-32 obriga a filtrar. */
export interface ComentarioBruto {
  readonly id: string
  readonly corpo: string
  readonly autorNome: string
  readonly criadoEm: string
  readonly publico: boolean
}

/**
 * Modos de falha do fake.
 *
 * ⚠️ A distinção **transitório × definitivo** não é cosmética: ela decide se a
 * submissão fica `pendente` (o cron tenta de novo) ou vira `falha` (chamado
 * perdido). Marcar indisponibilidade como definitiva é perder o chamado de alguém
 * numa queda de 30 segundos — exatamente o que RNF-17 proíbe.
 *
 * Transitórios (o cron reprocessa): `indisponivel` (503), `rate_limit` (429),
 * `timeout` (504).
 * Definitivo (reprocessar não resolve, e insistir esconde o problema real):
 * `rejeitado` (400/403 — payload inválido, campo obrigatório faltando, permissão
 * negada).
 */
export type ModoFalha = 'nenhum' | 'indisponivel' | 'rate_limit' | 'timeout' | 'rejeitado'

const FALHAS: Readonly<Record<Exclude<ModoFalha, 'nenhum'>, { status: number; transitorio: boolean }>> =
  Object.freeze({
    indisponivel: { status: 503, transitorio: true },
    rate_limit: { status: 429, transitorio: true },
    timeout: { status: 504, transitorio: true },
    rejeitado: { status: 400, transitorio: false },
  })

/** Página como o Confluence a guarda: metadados + storage cru. */
export interface PaginaFake {
  readonly titulo: string
  /** CHAVE do espaço — o fake já entrega resolvido, como o cliente real faz. */
  readonly espaco: string
  readonly labels: readonly string[]
  readonly storage: string
  /** Mãe na árvore do espaço (`RF-41`). `null`/ausente = raiz. */
  readonly idPai?: string | null
  /** `false` = lixeira ou rascunho. Default `true`. */
  readonly atual?: boolean
  readonly atualizadoEm?: string
}

/** Anexo do fake. `tipoDeclarado` imita o que a Atlassian repete do upload. */
export interface AnexoFake {
  readonly nomeArquivo: string
  readonly tipoDeclarado: string | null
  readonly bytes: ArrayBuffer
}

export interface EstadoFake {
  tiposChamado: TipoChamado[]
  /** Schema de campos adicionais por `requestTypeId` (RF-27, T-130). */
  camposPorTipo: Map<string, CampoRequestType[]>
  /**
   * Schema BRUTO por `requestTypeId` — o diagnóstico de admin.
   *
   * ⚠️ **Mapa separado, e derivá-lo de `camposPorTipo` seria impossível de propósito.**
   * `CampoRequestType` é o vocabulário do formulário, e `summary`/`description`/
   * `priority` já foram descartados antes de chegarem lá — então um fake que gerasse o
   * bruto a partir dele **nunca conseguiria encenar um campo de prioridade**, que é a
   * única coisa que estes testes precisam encenar. Seria o dublê escondendo a
   * divergência de novo (`D-38`, `linhasComoObjetos`).
   */
  schemaPorTipo: Map<string, CampoDoSchema[]>
  paginas: PaginaConfluence[]
  /**
   * Ids de páginas com restrição de leitura (RF-40). Sob proxy total, QUALQUER
   * restrição exclui a página — não dá para avaliar "esta pessoa pode ver?".
   */
  idsRestritos: Set<string>
  /**
   * Imita o `text ~ "termo"` do CQL: a página só entra se **todas** as palavras do
   * termo aparecerem no título ou no trecho.
   *
   * **Desligado por padrão, de propósito.** Os testes de exposição (`RN-06`) buscam
   * com termos como `'x'` e afirmam sobre *quais páginas saem da camada* — se o termo
   * também filtrasse, um teste de allowlist passaria por acidente, porque a página
   * proibida teria sido excluída pelo texto e não pela regra.
   *
   * Ligado no dev e na demonstração, onde o oposto é o problema: busca que devolve
   * tudo para qualquer termo faz a tela parecer quebrada.
   */
  filtrarPorTermo: boolean
  /** Conteúdo por id, para a leitura direta (RF-39, RF-40). */
  conteudoPaginas: Map<string, PaginaFake>
  /** Espaços por chave, com a homepage que serve de raiz da árvore (`RF-41`). */
  espacos: Map<string, { nome: string; homepageId: string | null }>
  /** Anexos por id de página — a lista é o que amarra anexo à página (T-112). */
  anexos: Map<string, AnexoFake[]>
  /**
   * Teto de bytes do fake, separado de `MAX_ANEXO_BYTES` só para que o teste do
   * limite não precise alocar 12 MB.
   */
  limiteAnexoBytes: number
  historico: TicketHistorico[]
  comentarios: Map<string, ComentarioBruto[]>
  chamados: Map<string, Chamado>
  /** Falha por operação, para derrubar UMA dependência de cada vez. */
  falhas: {
    criarChamado: ModoFalha
    buscarConfluence: ModoFalha
    buscarHistorico: ModoFalha
    listarComentarios: ModoFalha
    obterPagina: ModoFalha
    obterCamposDoTipo: ModoFalha
    /** Falha própria: o diagnóstico cai sem derrubar o formulário, e vice-versa. */
    obterSchemaDoTipo: ModoFalha
    /**
     * Falha ao consultar restrição. No cliente real ela é engolida e vira
     * "restrita"; aqui ela **lança**, para provar que o gate de exposição também
     * fail-closed por conta própria — duas camadas, não uma.
     */
    paginaRestrita: ModoFalha
    obterAnexo: ModoFalha
    /** T-210 — polling fora do ar não pode avançar a marca-d'água. */
    buscarAtualizados: ModoFalha
    /** T-240 — anexo falha sem derrubar a criação do chamado (RNF-18). */
    anexarArquivo: ModoFalha
    /** T-407 — o PRIMEIRO passo falha: o arquivo nem chega a ficar pendente. */
    subirAnexoTemporario: ModoFalha
    /**
     * T-407 — o SEGUNDO passo falha, com o chamado **já criado**.
     *
     * É o modo de falha de `RF-63`, e o único que importa de verdade: aqui o chamado
     * existe e o anexo não subiu, que é exatamente o estado que a tela precisa saber
     * relatar sem assustar ninguém.
     */
    materializarAnexos: ModoFalha
    /** T-242 — projeto sem transição exposta ao cliente é caso normal, não falha. */
    transicionar: ModoFalha
  }
  /**
   * T-407 — ids temporários que **já não valem**, imitando a expiração da Atlassian.
   *
   * ⚠️ Falha diferente de `materializarAnexos: 'indisponivel'`, e é a diferença que a
   * v1 do plano não viu: id expirado é **4xx**, que `atlassian/http.ts` classifica como
   * **definitivo**. Era o caminho pelo qual um arquivo velho apagaria o chamado da
   * pessoa (`plan.md` §0). Sem poder encenar isto, `RF-63` seria testado só no caso
   * fácil — o da indisponibilidade transitória.
   */
  temporariosInvalidos: Set<string>
  /**
   * Relógio do fake, para `criadoEm`/`atualizadoEm` do chamado criado.
   *
   * O default é a **epoch** por compatibilidade com os testes das fases anteriores, que
   * afirmam sobre esse valor. Quem testa SLA (`RF-46`) precisa de uma data plausível — um
   * chamado criado em 1970 está estourado por construção, o que esconderia a diferença
   * entre "dentro do prazo" e "sem prazo calculável".
   */
  relogio: () => string
  /** T-242 — transições que o "workflow" oferece ao cliente. Vazio = sem botão. */
  transicoes: Map<string, { id: string; nome: string; statusDestino: string }[]>
  /** T-240 — anexos recebidos por chamado, para o teste afirmar sobre eles. */
  anexosDeChamado: Map<string, { nome: string; tipo: string; tamanho: number }[]>
}

export interface RegistroChamada {
  readonly operacao: string
  readonly params: unknown
}

/** Sem acento e em minúsculas — "relatório" e "relatorio" procuram a mesma coisa. */
function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
}

function palavrasDe(termo: string): string[] {
  return normalizar(termo)
    .split(/[^a-z0-9]+/)
    .filter((p) => p.length > 0)
}

export class ClienteAtlassianFake implements ClienteAtlassian {
  readonly estado: EstadoFake
  /** Chamadas registradas — permite asserção sobre a QUERY enviada (RF-32). */
  readonly chamadas: RegistroChamada[] = []
  private contadorIssue = 0
  private contadorTemporario = 0
  /** Ids temporários emitidos, para a materialização saber o nome do arquivo. */
  private readonly temporarios = new Map<
    string,
    { nome: string; tipo: string; tamanho: number }
  >()
  /** `chaveIdempotencia` → chamado, para o teste de RF-24 e a reconciliação. */
  private readonly porChave = new Map<string, ChamadoCriado>()

  constructor(inicial: Partial<EstadoFake> = {}) {
    this.estado = {
      tiposChamado: inicial.tiposChamado ?? [],
      camposPorTipo: inicial.camposPorTipo ?? new Map(),
      schemaPorTipo: inicial.schemaPorTipo ?? new Map(),
      paginas: inicial.paginas ?? [],
      idsRestritos: inicial.idsRestritos ?? new Set(),
      filtrarPorTermo: inicial.filtrarPorTermo ?? false,
      conteudoPaginas: inicial.conteudoPaginas ?? new Map(),
      espacos: inicial.espacos ?? new Map(),
      anexos: inicial.anexos ?? new Map(),
      limiteAnexoBytes: inicial.limiteAnexoBytes ?? MAX_ANEXO_BYTES,
      historico: inicial.historico ?? [],
      comentarios: inicial.comentarios ?? new Map(),
      chamados: inicial.chamados ?? new Map(),
      relogio: inicial.relogio ?? (() => new Date(0).toISOString()),
      transicoes: inicial.transicoes ?? new Map(),
      anexosDeChamado: inicial.anexosDeChamado ?? new Map(),
      temporariosInvalidos: inicial.temporariosInvalidos ?? new Set(),
      falhas: {
        criarChamado: 'nenhum',
        buscarConfluence: 'nenhum',
        buscarHistorico: 'nenhum',
        listarComentarios: 'nenhum',
        obterPagina: 'nenhum',
        obterCamposDoTipo: 'nenhum',
        obterSchemaDoTipo: 'nenhum',
        paginaRestrita: 'nenhum',
        obterAnexo: 'nenhum',
        buscarAtualizados: 'nenhum',
        anexarArquivo: 'nenhum',
        subirAnexoTemporario: 'nenhum',
        materializarAnexos: 'nenhum',
        transicionar: 'nenhum',
        ...inicial.falhas,
      },
    }
  }

  /**
   * Avança o contador de chaves para além do que já existe — só demonstração/teste.
   *
   * ⚠️ O Worker é **stateless**: `contadorIssue` volta a zero a cada requisição, então o
   * segundo chamado aberto na demonstração também nascia `GOATLAS-1` e batia no
   * `UNIQUE (vinculos.issue_key)`. Pego no app real em 07/08/2026.
   *
   * Em produção nada disto existe: a chave é do JSM, que não repete.
   */
  ajustarContadorIssue(minimo: number): void {
    if (minimo > this.contadorIssue) this.contadorIssue = minimo
  }

  /**
   * Muda o chamado como o time de tech mudaria — só para teste e demonstração.
   *
   * Existe porque a Fase 3 precisa encenar o outro lado: status que muda, comentário
   * que o agente escreve. Sem isso, o teste de notificação só conseguiria observar o
   * que o próprio app faz — e é exatamente o que ele **não** deve notificar (`RF-48`).
   */
  simularMudancaDoTime(
    issueKey: string,
    mudanca: { status?: string; comentarioPublico?: { corpo: string; autorNome: string; criadoEm: string }; atualizadoEm?: string },
  ): void {
    const atual = this.estado.chamados.get(issueKey)
    if (atual) {
      this.estado.chamados.set(issueKey, {
        ...atual,
        status: mudanca.status ?? atual.status,
        atualizadoEm: mudanca.atualizadoEm ?? atual.atualizadoEm,
      })
    }
    if (mudanca.comentarioPublico) {
      const atuais = this.estado.comentarios.get(issueKey) ?? []
      this.estado.comentarios.set(issueKey, [
        ...atuais,
        {
          id: `t${atuais.length + 1}`,
          corpo: mudanca.comentarioPublico.corpo,
          autorNome: mudanca.comentarioPublico.autorNome,
          criadoEm: mudanca.comentarioPublico.criadoEm,
          publico: true,
        },
      ])
    }
  }

  private checar(modo: ModoFalha, recurso: string): void {
    if (modo === 'nenhum') return
    const { status, transitorio } = FALHAS[modo]
    throw new ErroAtlassian(`fake: ${modo}`, { status, transitorio, recurso })
  }

  async listarTiposChamado(): Promise<readonly TipoChamado[]> {
    this.chamadas.push({ operacao: 'listarTiposChamado', params: null })
    return this.estado.tiposChamado
  }

  async obterCamposDoTipo(
    serviceDeskId: string,
    requestTypeId: string,
  ): Promise<readonly CampoRequestType[]> {
    this.chamadas.push({ operacao: 'obterCamposDoTipo', params: { serviceDeskId, requestTypeId } })
    this.checar(this.estado.falhas.obterCamposDoTipo, 'obterCamposDoTipo')
    return this.estado.camposPorTipo.get(requestTypeId) ?? []
  }

  async obterSchemaDoTipo(
    serviceDeskId: string,
    requestTypeId: string,
  ): Promise<readonly CampoDoSchema[]> {
    this.chamadas.push({ operacao: 'obterSchemaDoTipo', params: { serviceDeskId, requestTypeId } })
    this.checar(this.estado.falhas.obterSchemaDoTipo, 'obterSchemaDoTipo')
    return this.estado.schemaPorTipo.get(requestTypeId) ?? []
  }

  async criarChamado(dados: NovoChamado): Promise<ChamadoCriado> {
    this.chamadas.push({ operacao: 'criarChamado', params: dados })
    this.checar(this.estado.falhas.criarChamado, 'criarChamado')

    // O fake honra a idempotência do lado do Jira: a mesma chave devolve o mesmo
    // chamado. Sem isso, o teste de RF-24 mediria só a trava local e não veria o
    // caso "criou no JSM e o vínculo se perdeu" (RNF-21).
    const existente = this.porChave.get(dados.chaveIdempotencia)
    if (existente) return existente

    this.contadorIssue += 1
    const criado: ChamadoCriado = {
      issueKey: `GOATLAS-${this.contadorIssue}`,
      issueId: String(10000 + this.contadorIssue),
    }
    this.porChave.set(dados.chaveIdempotencia, criado)
    this.estado.chamados.set(criado.issueKey, {
      issueKey: criado.issueKey,
      titulo: dados.titulo,
      descricao: dados.descricao,
      status: 'Aberto',
      prioridade: dados.prioridade,
      criadoEm: this.estado.relogio(),
      atualizadoEm: this.estado.relogio(),
      slaPrimeiraResposta: { prazo: null, cumprido: null },
    })
    return criado
  }

  async obterChamado(issueKey: string): Promise<Chamado> {
    this.chamadas.push({ operacao: 'obterChamado', params: issueKey })
    const c = this.estado.chamados.get(issueKey)
    if (!c) {
      throw new ErroAtlassian('chamado não encontrado', {
        status: 404,
        transitorio: false,
        recurso: issueKey,
      })
    }
    return c
  }

  async listarComentariosPublicos(issueKey: string): Promise<readonly ComentarioPublico[]> {
    this.chamadas.push({ operacao: 'listarComentariosPublicos', params: issueKey })
    this.checar(this.estado.falhas.listarComentarios, 'listarComentariosPublicos')
    const todos = this.estado.comentarios.get(issueKey) ?? []
    // O FAKE devolve o bruto filtrado, imitando o que o cliente real precisa
    // fazer. O teste de RF-32 confere as duas camadas no cliente real.
    return todos
      .filter((c) => c.publico)
      .map(({ id, corpo, autorNome, criadoEm }) => ({ id, corpo, autorNome, criadoEm }))
  }

  /** Só para teste: devolve TUDO, inclusive interno — para provar que não vazou. */
  comentariosBrutos(issueKey: string): readonly ComentarioBruto[] {
    return this.estado.comentarios.get(issueKey) ?? []
  }

  async comentar(
    issueKey: string,
    corpo: string,
    autorEmail: string,
    autorNome?: string,
  ): Promise<void> {
    this.chamadas.push({ operacao: 'comentar', params: { issueKey, corpo, autorEmail, autorNome } })
    const atuais = this.estado.comentarios.get(issueKey) ?? []
    this.estado.comentarios.set(issueKey, [
      ...atuais,
      {
        id: `c${atuais.length + 1}`,
        corpo,
        autorNome: autorNome ?? autorEmail,
        criadoEm: new Date(0).toISOString(),
        publico: true,
      },
    ])
  }

  async buscarConfluence(
    params: BuscaConfluenceParams,
  ): Promise<readonly PaginaConfluence[]> {
    this.chamadas.push({ operacao: 'buscarConfluence', params })
    this.checar(this.estado.falhas.buscarConfluence, 'buscarConfluence')

    // Imita o comportamento CORRETO: a restrição de espaço é aplicada na busca.
    // Página restrita e label bloqueada também não saem daqui — o teste de RN-06
    // confere que a decisão de exposição não depende de filtro acima da camada.
    const permitidos = new Set(params.espacosPermitidos)
    const bloqueadas = new Set(params.labelsBloqueadas)
    const palavras = this.estado.filtrarPorTermo ? palavrasDe(params.termo) : []
    return this.estado.paginas
      .filter((p) => {
        if (palavras.length === 0) return true
        const texto = normalizar(`${p.titulo} ${p.trecho}`)
        return palavras.every((palavra) => texto.includes(palavra))
      })
      .filter((p) => permitidos.has(p.espaco))
      .filter((p) => !p.labels.some((l) => bloqueadas.has(l)))
      // A terceira condição de RN-06: página sem restrição. Espaço liberado NÃO
      // implica página liberada.
      .filter((p) => !this.estado.idsRestritos.has(p.id))
      .sort((a, b) => b.score - a.score)
      .slice(0, params.limite)
  }

  async obterMetadadosPagina(idPagina: string): Promise<MetadadosPagina> {
    this.chamadas.push({ operacao: 'obterMetadadosPagina', params: idPagina })
    this.checar(this.estado.falhas.obterPagina, 'obterMetadadosPagina')
    const p = this.estado.conteudoPaginas.get(idPagina)
    if (!p) {
      throw new ErroAtlassian('página não encontrada', {
        status: 404,
        transitorio: false,
        recurso: 'obterMetadadosPagina',
      })
    }
    return {
      id: idPagina,
      idPai: p.idPai ?? null,
      titulo: p.titulo,
      espaco: p.espaco,
      labels: p.labels,
      atual: p.atual ?? true,
      versao: 1,
      atualizadoEm: p.atualizadoEm ?? new Date(0).toISOString(),
      url: `https://exemplo.invalid/wiki/pages/${idPagina}`,
    }
  }

  async paginaRestrita(idPagina: string): Promise<boolean> {
    this.chamadas.push({ operacao: 'paginaRestrita', params: idPagina })
    this.checar(this.estado.falhas.paginaRestrita, 'paginaRestrita')
    if (!idPagina) return true
    return this.estado.idsRestritos.has(idPagina)
  }

  async obterEspaco(chaveEspaco: string): Promise<EspacoConfluence> {
    this.chamadas.push({ operacao: 'obterEspaco', params: chaveEspaco })
    this.checar(this.estado.falhas.obterPagina, 'obterEspaco')
    const e = this.estado.espacos.get(chaveEspaco)
    if (!e) {
      throw new ErroAtlassian('espaço não encontrado', {
        status: 404,
        transitorio: false,
        recurso: 'obterEspaco',
      })
    }
    return { chave: chaveEspaco, nome: e.nome, homepageId: e.homepageId }
  }

  async listarFilhosDaPagina(params: FilhosParams): Promise<readonly PaginaConfluence[]> {
    this.chamadas.push({ operacao: 'listarFilhosDaPagina', params })
    this.checar(this.estado.falhas.buscarConfluence, 'listarFilhosDaPagina')
    if (params.espacosPermitidos.length === 0) return []

    const permitidos = new Set(params.espacosPermitidos)
    const bloqueadas = new Set(params.labelsBloqueadas.map((l) => l.toLowerCase()))
    const filhos: PaginaConfluence[] = []
    for (const [id, p] of this.estado.conteudoPaginas) {
      if ((p.idPai ?? null) !== params.idPai) continue
      // As mesmas três condições, na mesma ordem em que o cliente real as aplica.
      if (!permitidos.has(p.espaco)) continue
      if (p.labels.some((l) => bloqueadas.has(l.toLowerCase()))) continue
      if (this.estado.idsRestritos.has(id)) continue
      filhos.push({
        id,
        titulo: p.titulo,
        espaco: p.espaco,
        url: `https://exemplo.invalid/wiki/pages/${id}`,
        score: 0,
        trecho: '',
        labels: [...p.labels],
      })
    }
    return filhos
      .sort((a, b) => a.titulo.localeCompare(b.titulo, 'pt-BR'))
      .slice(0, params.limite)
  }

  async obterCorpoStorage(idPagina: string): Promise<string> {
    this.chamadas.push({ operacao: 'obterCorpoStorage', params: idPagina })
    this.checar(this.estado.falhas.obterPagina, 'obterCorpoStorage')
    const p = this.estado.conteudoPaginas.get(idPagina)
    if (!p) {
      throw new ErroAtlassian('página não encontrada', {
        status: 404,
        transitorio: false,
        recurso: 'obterCorpoStorage',
      })
    }
    return p.storage
  }

  async obterAnexo(idPagina: string, nomeArquivo: string): Promise<ResultadoAnexo> {
    this.chamadas.push({ operacao: 'obterAnexo', params: { idPagina, nomeArquivo } })
    this.checar(this.estado.falhas.obterAnexo, 'obterAnexo')
    // Casa por nome exato DENTRO da página, como o cliente real: é isso que impede
    // um nome montado à mão de alcançar anexo de outra página (RF-40).
    const daPagina = this.estado.anexos.get(idPagina) ?? []
    const achado = daPagina.find((a) => a.nomeArquivo === nomeArquivo)
    if (!achado) return { estado: 'nao_encontrado' }
    if (achado.bytes.byteLength > this.estado.limiteAnexoBytes) {
      return { estado: 'grande_demais', tamanhoBytes: achado.bytes.byteLength }
    }
    return { estado: 'ok', anexo: achado }
  }

  async buscarHistoricoTickets(
    params: HistoricoParams,
  ): Promise<readonly TicketHistorico[]> {
    this.chamadas.push({ operacao: 'buscarHistoricoTickets', params })
    this.checar(this.estado.falhas.buscarHistorico, 'buscarHistoricoTickets')
    return this.estado.historico
      .filter((t) => t.chaveAgrupamento === params.chaveAgrupamento)
      .slice(0, params.limite)
  }

  async buscarChamadosPorChaveIdempotencia(
    chave: string,
  ): Promise<readonly ChamadoCriado[]> {
    this.chamadas.push({ operacao: 'buscarChamadosPorChaveIdempotencia', params: chave })
    const c = this.porChave.get(chave)
    return c ? [c] : []
  }

  /**
   * T-210 — chamados alterados desde um instante.
   *
   * O fake compara `atualizadoEm` do próprio estado. Ele **não** aplica a margem nem o
   * formato de JQL: isso é responsabilidade do cliente real, e tem teste próprio
   * (`montarJqlAtualizados`). Aqui o que interessa é o serviço de notificação receber a
   * lista certa.
   */
  async buscarChamadosAtualizadosDesde(params: {
    desde: string | null
    limite: number
  }): Promise<readonly { issueKey: string; atualizadoEm: string }[]> {
    this.chamadas.push({ operacao: 'buscarChamadosAtualizadosDesde', params })
    this.checar(this.estado.falhas.buscarAtualizados, 'buscarChamadosAtualizadosDesde')
    const desdeMs = params.desde ? Date.parse(params.desde) : Number.NaN
    return [...this.estado.chamados.values()]
      .filter((c) => {
        if (!Number.isFinite(desdeMs)) return true
        const ms = Date.parse(c.atualizadoEm)
        return Number.isFinite(ms) ? ms >= desdeMs : true
      })
      .map((c) => ({ issueKey: c.issueKey, atualizadoEm: c.atualizadoEm }))
      .sort((a, b) => a.atualizadoEm.localeCompare(b.atualizadoEm))
      .slice(0, params.limite)
  }

  async anexarArquivo(
    serviceDeskId: string,
    issueKey: string,
    arquivo: { nome: string; tipo: string; bytes: ArrayBuffer },
  ): Promise<void> {
    this.chamadas.push({
      operacao: 'anexarArquivo',
      // ⚠️ Os BYTES não vão para o registro: o teste que imprime `chamadas` num diff
      // despejaria o arquivo inteiro.
      params: { serviceDeskId, issueKey, nome: arquivo.nome, tipo: arquivo.tipo },
    })
    this.checar(this.estado.falhas.anexarArquivo, 'anexarArquivo')
    const atuais = this.estado.anexosDeChamado.get(issueKey) ?? []
    this.estado.anexosDeChamado.set(issueKey, [
      ...atuais,
      { nome: arquivo.nome, tipo: arquivo.tipo, tamanho: arquivo.bytes.byteLength },
    ])
  }

  async subirAnexoTemporario(
    serviceDeskId: string,
    arquivo: { nome: string; tipo: string; bytes: ArrayBuffer },
  ): Promise<string> {
    this.chamadas.push({
      operacao: 'subirAnexoTemporario',
      params: { serviceDeskId, nome: arquivo.nome, tipo: arquivo.tipo },
    })
    this.checar(this.estado.falhas.subirAnexoTemporario, 'subirAnexoTemporario')
    this.contadorTemporario += 1
    const id = `tmp-${this.contadorTemporario}`
    this.temporarios.set(id, {
      nome: arquivo.nome,
      tipo: arquivo.tipo,
      tamanho: arquivo.bytes.byteLength,
    })
    return id
  }

  async materializarAnexosTemporarios(issueKey: string, ids: readonly string[]): Promise<void> {
    this.chamadas.push({ operacao: 'materializarAnexosTemporarios', params: { issueKey, ids } })
    this.checar(this.estado.falhas.materializarAnexos, 'materializarAnexosTemporarios')

    // Id que já não vale é **definitivo** (4xx), como na Atlassian real. É o que faz o
    // teste de `RF-63` provar que a criação não é arrastada junto.
    const vencido = ids.find((id) => this.estado.temporariosInvalidos.has(id))
    if (vencido !== undefined) {
      throw new ErroAtlassian('fake: id de anexo temporário expirado', {
        status: 400,
        transitorio: false,
        recurso: 'materializarAnexosTemporarios',
      })
    }

    const atuais = this.estado.anexosDeChamado.get(issueKey) ?? []
    const novos = ids.map((id) => {
      const t = this.temporarios.get(id)
      // Id que o fake nunca emitiu não é erro aqui: quem testa o caminho de expiração
      // usa `temporariosInvalidos`, e inventar um erro para id desconhecido faria o
      // teste de materialização depender da ordem em que o fake foi montado.
      return { nome: t?.nome ?? id, tipo: t?.tipo ?? 'application/octet-stream', tamanho: t?.tamanho ?? 0 }
    })
    this.estado.anexosDeChamado.set(issueKey, [...atuais, ...novos])
  }

  async listarTransicoes(issueKey: string): Promise<readonly { id: string; nome: string }[]> {
    this.chamadas.push({ operacao: 'listarTransicoes', params: issueKey })
    // Sem falha injetada aqui de propósito: lista vazia (projeto que não expõe
    // transição ao cliente) é o caso NORMAL de `RF-36`, não uma indisponibilidade.
    return (this.estado.transicoes.get(issueKey) ?? []).map(({ id, nome }) => ({ id, nome }))
  }

  async transicionar(issueKey: string, transicaoId: string): Promise<void> {
    this.chamadas.push({ operacao: 'transicionar', params: { issueKey, transicaoId } })
    this.checar(this.estado.falhas.transicionar, 'transicionar')
    const disponiveis = this.estado.transicoes.get(issueKey) ?? []
    const alvo = disponiveis.find((t) => t.id === transicaoId)
    if (!alvo) {
      throw new ErroAtlassian('transição não disponível', {
        status: 400,
        transitorio: false,
        recurso: issueKey,
      })
    }
    const atual = this.estado.chamados.get(issueKey)
    if (atual) {
      this.estado.chamados.set(issueKey, { ...atual, status: alvo.statusDestino })
    }
  }

  telemetria(): { total429: number; totalRequisicoes: number } {
    // O fake não faz HTTP: `0/0` é honesto. Inventar número aqui faria a tela de
    // telemetria (T-234) parecer que há medição de orçamento em modo demonstração.
    return { total429: 0, totalRequisicoes: 0 }
  }

  async verificarSaude(): Promise<{ ok: boolean; detalhe: string }> {
    const algumaFalha = Object.values(this.estado.falhas).some((f) => f !== 'nenhum')
    return algumaFalha
      ? { ok: false, detalhe: 'fake com falha injetada' }
      : { ok: true, detalhe: 'fake' }
  }
}
