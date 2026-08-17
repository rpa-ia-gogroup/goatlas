/**
 * Transporte HTTP da camada Atlassian — RNF-14, RNF-15, RF-60.
 *
 * ## Sobre rate limit, e por que não há telemetria de orçamento
 *
 * O regime de orçamento por pontos da Atlassian (65.000 pts/h) vale para apps
 * **Forge, Connect e OAuth 2.0**. Tráfego por **API token** — o nosso — segue
 * governado por *burst limits* cujos valores **não são publicados**, e os headers
 * `X-RateLimit-*` só aparecem **em respostas 429**.
 *
 * Consequência prática: não existe como saber quanto orçamento resta. O controle é
 * cache + backoff + **medição empírica da taxa de 429** (RF-60). Migrar para
 * OAuth 2.0 é o plano B se o limite virar problema (R-02).
 */

import { ErroAtlassian } from './tipos'

export interface OpcoesHttp {
  readonly baseUrl: string
  readonly email: string
  readonly apiToken: string
  /** Injetável para o teste não dormir de verdade. */
  readonly dormir?: (ms: number) => Promise<void>
  readonly fetchImpl?: typeof fetch
  readonly aleatorio?: () => number
  readonly maxTentativas?: number
}

export interface ContadorRateLimit {
  /** RF-60 — a única telemetria de orçamento que existe. */
  readonly total429: number
  readonly totalRequisicoes: number
}

const BASE_BACKOFF_MS = 2000
const TETO_BACKOFF_MS = 30_000
const MAX_TENTATIVAS_PADRAO = 4

export class TransporteAtlassian {
  private readonly dormir: (ms: number) => Promise<void>
  private readonly fetchImpl: typeof fetch
  private readonly aleatorio: () => number
  private readonly maxTentativas: number
  private _total429 = 0
  private _totalRequisicoes = 0

  constructor(private readonly opcoes: OpcoesHttp) {
    this.dormir = opcoes.dormir ?? ((ms) => new Promise((r) => setTimeout(r, ms)))
    // ⚠️ **`fetch` PRECISA vir com `this` amarrado ao global.** Guardado numa propriedade e
    // chamado como `this.fetchImpl(...)`, o `this` passa a ser este objeto, e o runtime dos
    // Workers recusa com `Illegal invocation` — a chamada nem sai. No Node dos testes
    // funciona, porque lá o `fetch` não confere o `this`: por isso 643 testes verdes
    // conviviam com um cliente que não conseguia fazer uma única requisição em produção.
    // Descoberto em 07/08/2026, no instante em que o modo demonstração saiu.
    this.fetchImpl = opcoes.fetchImpl ?? fetch.bind(globalThis)
    this.aleatorio = opcoes.aleatorio ?? Math.random
    this.maxTentativas = opcoes.maxTentativas ?? MAX_TENTATIVAS_PADRAO
  }

  get contadores(): ContadorRateLimit {
    return { total429: this._total429, totalRequisicoes: this._totalRequisicoes }
  }

  /**
   * Backoff exponencial com **jitter** (RNF-14): base 2s, teto ~30s.
   *
   * O jitter não é enfeite: sem ele, N requisições que tomam 429 juntas voltam
   * juntas e tomam 429 juntas de novo. `Retry-After`, quando presente, manda — é
   * o servidor dizendo quanto esperar, e ignorá-lo é o caminho para o bloqueio
   * piorar.
   */
  calcularEspera(tentativa: number, retryAfterSeg: number | null): number {
    if (retryAfterSeg !== null && retryAfterSeg > 0) return retryAfterSeg * 1000
    const exponencial = Math.min(BASE_BACKOFF_MS * 2 ** (tentativa - 1), TETO_BACKOFF_MS)
    const jitter = exponencial * 0.25 * this.aleatorio()
    return Math.round(exponencial - exponencial * 0.125 + jitter)
  }

  private cabecalhoAuth(): string {
    const cred = `${this.opcoes.email}:${this.opcoes.apiToken}`
    // btoa existe no runtime dos Workers; Buffer não.
    return `Basic ${btoa(cred)}`
  }

  async requisitar(
    caminho: string,
    init: { method?: string; body?: string; headers?: Record<string, string> } = {},
  ): Promise<unknown> {
    const resposta = await this.enviar(caminho, init, 'application/json')
    const texto = await resposta.text()
    return texto.length > 0 ? (JSON.parse(texto) as unknown) : null
  }

  /**
   * Upload multipart — `attachTemporaryFile` do JSM (`RF-25`, T-240).
   *
   * ⚠️ Dois detalhes que a Atlassian não perdoa:
   *
   * 1. **`X-Atlassian-Token: no-check`** é obrigatório. Sem ele o upload é recusado
   *    como possível CSRF, com um 403 genérico que não explica nada.
   * 2. **Não se define `Content-Type`.** O `fetch` gera o boundary junto com o corpo;
   *    declarar `multipart/form-data` à mão produz um boundary que não corresponde ao
   *    do corpo, e a Atlassian responde 400 como se o arquivo estivesse errado.
   */
  async requisitarMultipart(caminho: string, form: FormData): Promise<unknown> {
    const resposta = await this.enviar(
      caminho,
      { method: 'POST', corpoBruto: form, headers: { 'X-Atlassian-Token': 'no-check' } },
      'application/json',
    )
    const texto = await resposta.text()
    return texto.length > 0 ? (JSON.parse(texto) as unknown) : null
  }

  /**
   * Diagnóstico: **uma** requisição, sem retentativa, devolvendo status e corpo CRU.
   *
   * ## Por que este caminho existe, sendo o oposto do resto do arquivo
   *
   * `enviar` **nunca** repassa o corpo da resposta de erro (`RNF-01`, `RNF-30`) — e isso
   * está certo, porque aquele erro sobe até o log. A consequência apareceu em 17/08/2026:
   * a criação do tipo `134` respondeu 400 e **ninguém tinha como saber por quê**. A causa
   * (`attachment` obrigatório) foi *inferida* pela interseção com o schema, não lida.
   *
   * Aqui o corpo volta porque quem chama é uma rota **de admin** que o redige antes de
   * responder (`corpoSeguro`). O corpo não entra em log, não entra em exceção e não sai
   * daqui por nenhum outro caminho — a única chamadora é a rota de diagnóstico.
   *
   * ⚠️ **Sem retentativa de propósito:** medir "o que a Atlassian responde a este corpo"
   * com backoff no meio produziria três tentativas para uma pergunta que é sobre a
   * primeira. E `ok` não é traduzido em exceção: 400 aqui é **resultado**, não falha.
   */
  async requisitarDiagnostico(
    caminho: string,
    init: { method?: string; body?: string },
  ): Promise<{ readonly status: number; readonly corpo: string }> {
    this._totalRequisicoes += 1
    const resposta = await this.fetchImpl(`${this.opcoes.baseUrl}${caminho}`, {
      method: init.method ?? 'GET',
      headers: {
        Authorization: this.cabecalhoAuth(),
        Accept: 'application/json',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(init.body === undefined ? {} : { body: init.body }),
    })
    return { status: resposta.status, corpo: await resposta.text() }
  }

  /**
   * Baixa **bytes**, não JSON — anexo de página (`RNF-02`: o navegador não fala com
   * a Atlassian, então o app re-serve).
   *
   * ⚠️ O teto de tamanho é conferido **antes** de ler o corpo, pelo `Content-Length`,
   * e **de novo** depois: com `Transfer-Encoding: chunked` não há `Content-Length`
   * para conferir, e ler primeiro para medir depois é exatamente o jeito de o Worker
   * morrer de memória. Estourar o teto não é erro — é um resultado previsto, e quem
   * chama transforma em mensagem de negócio.
   */
  async requisitarBinario(
    caminho: string,
    maxBytes: number,
  ): Promise<
    | { readonly estado: 'ok'; readonly bytes: ArrayBuffer; readonly tipoDeclarado: string | null }
    | { readonly estado: 'grande_demais'; readonly tamanhoBytes: number }
  > {
    const resposta = await this.enviar(caminho, {}, '*/*')

    const declarado = Number(resposta.headers.get('Content-Length'))
    if (Number.isFinite(declarado) && declarado > maxBytes) {
      return { estado: 'grande_demais', tamanhoBytes: declarado }
    }

    const bytes = await resposta.arrayBuffer()
    if (bytes.byteLength > maxBytes) {
      return { estado: 'grande_demais', tamanhoBytes: bytes.byteLength }
    }
    return {
      estado: 'ok',
      bytes,
      tipoDeclarado: resposta.headers.get('Content-Type'),
    }
  }

  /**
   * O laço de retentativa, compartilhado por JSON e binário.
   *
   * Compartilhar não é economia de linhas: um segundo caminho de rede com backoff
   * próprio (ou sem backoff) faria `RNF-14` valer para uma parte do tráfego só, e a
   * contagem de 429 de `RF-60` mediria menos do que acontece.
   */
  private async enviar(
    caminho: string,
    init: {
      method?: string
      body?: string
      /** `FormData` — o `fetch` gera o boundary; nunca declarar `Content-Type`. */
      corpoBruto?: FormData
      headers?: Record<string, string>
    },
    aceitar: string,
  ): Promise<Response> {
    const url = `${this.opcoes.baseUrl}${caminho}`
    let ultimoErro: ErroAtlassian | null = null

    for (let tentativa = 1; tentativa <= this.maxTentativas; tentativa += 1) {
      this._totalRequisicoes += 1
      const resposta = await this.fetchImpl(url, {
        method: init.method ?? 'GET',
        headers: {
          Authorization: this.cabecalhoAuth(),
          Accept: aceitar,
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
          ...init.headers,
        },
        ...(init.body === undefined ? {} : { body: init.body }),
        ...(init.corpoBruto === undefined ? {} : { body: init.corpoBruto }),
      })

      if (resposta.ok) return resposta

      if (resposta.status === 429) this._total429 += 1

      const transitorio = resposta.status === 429 || resposta.status >= 500
      // ⚠️ A mensagem NUNCA inclui o corpo da resposta: ele pode conter dado
      // interno, e o erro sobe até o log (RNF-01, RNF-30).
      ultimoErro = new ErroAtlassian(`Atlassian respondeu ${resposta.status}`, {
        status: resposta.status,
        transitorio,
        recurso: caminho,
      })

      if (!transitorio || tentativa === this.maxTentativas) throw ultimoErro

      const retryAfter = Number(resposta.headers.get('Retry-After'))
      await this.dormir(this.calcularEspera(tentativa, Number.isFinite(retryAfter) ? retryAfter : null))
    }

    throw ultimoErro ?? new ErroAtlassian('falha desconhecida', { transitorio: true, recurso: caminho })
  }
}

/**
 * Cache com TTL — RNF-13. Sem cache o app vira amplificador de chamadas.
 *
 * ⚠️ **Teto de entradas não é enfeite desde que a cache passou a viver por isolate**
 * (`contexto.ts`). Enquanto ela morria com a requisição, crescer sem limite era inócuo;
 * compartilhada, uma cache sem teto é vazamento de memória com prazo — o isolate acumula
 * até a plataforma matá-lo, e o sintoma aparece como erro em requisição alheia. O
 * despejo é FIFO por ordem de inserção (`Map` preserva), que é o mais barato e suficiente:
 * o que importa aqui é o teto existir, não escolher a vítima com sabedoria.
 */
export class CacheTtl<T> {
  private readonly mapa = new Map<string, { valor: T; expiraEm: number }>()

  constructor(
    private readonly agoraMs: () => number,
    private readonly maxEntradas = 500,
  ) {}

  obter(chave: string): T | undefined {
    const entrada = this.mapa.get(chave)
    if (!entrada) return undefined
    if (entrada.expiraEm <= this.agoraMs()) {
      this.mapa.delete(chave)
      return undefined
    }
    return entrada.valor
  }

  definir(chave: string, valor: T, ttlSeg: number): void {
    // Reinserir move para o fim da ordem FIFO: chave já presente é atualização, e
    // manter a posição antiga faria o valor recém-buscado ser o próximo despejado.
    this.mapa.delete(chave)
    this.mapa.set(chave, { valor, expiraEm: this.agoraMs() + ttlSeg * 1000 })

    while (this.mapa.size > this.maxEntradas) {
      const maisAntiga = this.mapa.keys().next()
      if (maisAntiga.done) break
      this.mapa.delete(maisAntiga.value)
    }
  }

  limpar(): void {
    this.mapa.clear()
  }

  /** Só para teste e diagnóstico: quantas entradas estão guardadas agora. */
  get tamanho(): number {
    return this.mapa.size
  }
}
