/**
 * Latência — os quatro custos que ninguém media, e que nenhum teste via.
 *
 * ## Por que este arquivo existe
 *
 * As 800 asserções da suíte olhavam **o que** o app responde. Nenhuma olhava **quantas
 * idas** ele faz para responder, e o resultado foi um app correto e lento em quatro
 * lugares ao mesmo tempo — cada um invisível isoladamente:
 *
 * 1. `migrar` rodava a cada requisição: 35 `CREATE` + 3 `ALTER` sequenciais antes de
 *    qualquer rota começar (medido em produção: ~400 ms de piso por requisição).
 * 2. O `CacheTtl` do cliente Atlassian morava na instância, e a instância nascia a cada
 *    requisição — então `RNF-13` nunca acertava, apesar de vários comentários do código
 *    contarem com ele.
 * 3. Laços `for … await` sobre listas de rede: chamados da pessoa, restrição por página,
 *    filhos da árvore, espaços da allowlist, classificação da Regra 2.
 * 4. O turno do agente fazia três idas ao provedor de IA em série, sendo que duas delas
 *    não dependem uma da outra.
 *
 * Teste de comportamento não pega nada disso: o resultado estava certo nos quatro casos.
 * Por isso aqui se afirma sobre **contagem de chamadas** e sobre **simultaneidade**.
 *
 * _Requirements: RNF-13, RNF-15, RNF-16, RF-08, RF-41, RN-06, RN-07, R-02_
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { SqliteLocal } from '@/lib/db/sqlite-local'
import { COLUNAS_ADICIONADAS, garantirMigracao, migrar, TABELAS } from '@/lib/db/schema'
import type { Banco, ResultadoExec, ResultadoQuery } from '@/lib/db/tipos'
import { CacheTtl } from '@/lib/atlassian/http'
import {
  ClienteAtlassianHttp,
  novasCachesAtlassian,
  type CachesAtlassian,
} from '@/lib/atlassian/cliente'
import { montarContexto } from '@/lib/contexto'
import { ClienteTeamGuideHttp, novaCacheTeamGuide } from '@/lib/teamguide/http'
import { CONCORRENCIA_ATLASSIAN, mapearComLimite } from '@/lib/paralelo'
import { CONFIG_PADRAO, type ConfigValores } from '@/lib/config'
import { AuditoriaBanco } from '@/lib/audit'
import { ClienteAtlassianFake } from '@/lib/atlassian/fake'
import { ClienteIAFake } from '@/lib/ia/fake'
import type {
  ClienteIA,
  ParametrosChat,
  ParametrosClassificacao,
  ParametrosExtracao,
  RespostaIA,
  ResultadoClassificacao,
  ResultadoExtracao,
} from '@/lib/ia/tipos'
import { RepositorioConversas } from '@/lib/agent/estado'
import { ExecutorTools } from '@/lib/agent/tools'
import { Orquestrador } from '@/lib/agent/orquestrador'
import type { PaginaConfluence, TicketHistorico } from '@/lib/atlassian/tipos'

const ANA = 'ana@gocase.com'
const AGORA = '2026-08-10T12:00:00.000Z'

const BASE = {
  baseUrl: 'https://goengenharia.atlassian.net',
  email: 'servico@gocase.com',
  apiToken: 'token',
  ttlMetadadosSeg: 900,
  ttlConteudoSeg: 300,
  campoSolicitanteId: null,
  // Sem espera de verdade: o backoff não é o assunto aqui.
  dormir: async () => {},
}

/** Banco que conta o DDL que passa por ele. */
class BancoContado implements Banco {
  ddl = 0
  falharAgora = false

  constructor(private readonly real: SqliteLocal) {}

  async query(sql: string, params: readonly unknown[]): Promise<ResultadoQuery> {
    return this.real.query(sql, params)
  }

  async exec(sql: string, params: readonly unknown[]): Promise<ResultadoExec> {
    if (/^\s*(CREATE|ALTER)/i.test(sql)) {
      this.ddl += 1
      if (this.falharAgora) throw new Error('banco fora do ar')
    }
    return this.real.exec(sql, params)
  }
}

describe('migração: uma vez por banco, não por requisição', () => {
  it('a segunda chamada não emite DDL nenhum', async () => {
    const db = new BancoContado(new SqliteLocal())

    await garantirMigracao(db)
    const depoisDaPrimeira = db.ddl
    expect(depoisDaPrimeira).toBeGreaterThanOrEqual(TABELAS.length)

    await garantirMigracao(db)
    await garantirMigracao(db)
    expect(db.ddl).toBe(depoisDaPrimeira)
  })

  it('duas requisições simultâneas esperam a MESMA migração', async () => {
    // Sem isto, dois cliques no mesmo instante disparariam dois `CREATE TABLE` em
    // paralelo — idempotentes, mas dobrando o custo justamente sob carga.
    const db = new BancoContado(new SqliteLocal())
    await Promise.all([garantirMigracao(db), garantirMigracao(db), garantirMigracao(db)])
    // ⚠️ O teto é **derivado**, não cravado. Era `TABELAS.length + 3`, e o `3` era a
    // quantidade de `COLUNAS_ADICIONADAS` na época — então qualquer coluna nova em qualquer
    // feature quebrava este teste sem nada ter a ver com concorrência de migração. Foi
    // exatamente o que aconteceu quando a spec 005 acrescentou duas.
    const umaMigracaoCompleta = TABELAS.length + COLUNAS_ADICIONADAS.length
    expect(db.ddl).toBeLessThanOrEqual(umaMigracaoCompleta)
  })

  it('banco DIFERENTE migra de novo — a memoização não é global', async () => {
    // A versão global desta otimização funciona em produção e deixa o segundo teste da
    // suíte rodando contra um banco sem tabela nenhuma.
    const a = new BancoContado(new SqliteLocal())
    const b = new BancoContado(new SqliteLocal())
    await garantirMigracao(a)
    await garantirMigracao(b)
    expect(b.ddl).toBeGreaterThanOrEqual(TABELAS.length)
  })

  it('falha NÃO fica memoizada — senão o isolate nunca mais tem schema', async () => {
    const db = new BancoContado(new SqliteLocal())
    db.falharAgora = true
    await expect(garantirMigracao(db)).rejects.toThrow('banco fora do ar')

    db.falharAgora = false
    await expect(garantirMigracao(db)).resolves.toBeUndefined()
    const linhas = await db.query(`SELECT name FROM sqlite_master WHERE name = 'vinculos'`, [])
    expect(linhas.rowsRead).toBe(1)
  })

  it('montar o contexto duas vezes com o mesmo banco só migra uma vez', async () => {
    // É a rota real do custo: `montarContexto` roda por requisição de propósito (config
    // alterada no console vale na seguinte), e era ela que arrastava o DDL junto.
    const db = new BancoContado(new SqliteLocal())
    await montarContexto({ DB: db })
    const depois = db.ddl
    await montarContexto({ DB: db })
    await montarContexto({ DB: db })
    expect(db.ddl).toBe(depois)
  })
})

describe('CacheTtl: teto de entradas', () => {
  it('despeja a entrada mais antiga ao passar do teto', () => {
    // Compartilhada por isolate, cache sem teto é vazamento de memória com prazo.
    const cache = new CacheTtl<number>(() => 0, 3)
    cache.definir('a', 1, 60)
    cache.definir('b', 2, 60)
    cache.definir('c', 3, 60)
    cache.definir('d', 4, 60)

    expect(cache.tamanho).toBe(3)
    expect(cache.obter('a')).toBeUndefined()
    expect(cache.obter('d')).toBe(4)
  })

  it('redefinir uma chave a move para o fim da fila de despejo', () => {
    // Sem isto, o valor recém-buscado seria o próximo a sair.
    const cache = new CacheTtl<number>(() => 0, 2)
    cache.definir('a', 1, 60)
    cache.definir('b', 2, 60)
    cache.definir('a', 10, 60)
    cache.definir('c', 3, 60)

    expect(cache.obter('a')).toBe(10)
    expect(cache.obter('b')).toBeUndefined()
  })

  it('o TTL continua valendo', () => {
    let agora = 0
    const cache = new CacheTtl<number>(() => agora, 10)
    cache.definir('a', 1, 5)
    agora = 5_001
    expect(cache.obter('a')).toBeUndefined()
  })
})

describe('mapearComLimite: paralelo COM teto', () => {
  it('preserva a ordem do resultado', async () => {
    // Ordem por "quem respondeu primeiro" faria a lista dançar entre duas cargas da
    // mesma tela — parece defeito, e é.
    const r = await mapearComLimite([30, 20, 10, 1], 4, async (ms) => {
      await new Promise((ok) => setTimeout(ok, ms))
      return ms
    })
    expect(r).toEqual([30, 20, 10, 1])
  })

  it('nunca passa do teto de simultaneidade', async () => {
    // `Promise.all` na lista inteira é o conserto errado: o burst limit da Atlassian não
    // é publicado e a credencial é única (R-02, RNF-15).
    let emVoo = 0
    let pico = 0
    await mapearComLimite(Array.from({ length: 20 }, (_, i) => i), 4, async (i) => {
      emVoo += 1
      pico = Math.max(pico, emVoo)
      await new Promise((ok) => setTimeout(ok, 2))
      emVoo -= 1
      return i
    })
    expect(pico).toBe(4)
  })

  it('paraleliza de verdade — 8 itens de 20 ms com teto 4 levam menos que em série', async () => {
    const inicio = Date.now()
    await mapearComLimite(Array.from({ length: 8 }), 4, async () => {
      await new Promise((ok) => setTimeout(ok, 20))
    })
    // Em série seriam ~160 ms; com teto 4, ~40 ms. A folga é generosa de propósito.
    expect(Date.now() - inicio).toBeLessThan(120)
  })

  it('propaga o erro de quem falhou', async () => {
    await expect(
      mapearComLimite([1, 2, 3], 2, async (n) => {
        if (n === 2) throw new Error('estourou')
        return n
      }),
    ).rejects.toThrow('estourou')
  })

  it('lista vazia não inventa trabalhador', async () => {
    expect(await mapearComLimite([], 5, async () => 1)).toEqual([])
  })
})

/** Fetch encenado: conta as idas e mede simultaneidade por rota. */
function fetchEncenado(opcoes: {
  idsBusca?: string[]
  restritos?: string[]
  atrasoMs?: number
}) {
  const contagem = new Map<string, number>()
  let emVooRestricao = 0
  let picoRestricao = 0
  // ⚠️ **Pico de requisições em voo, não tempo de parede.** O `CLAUDE.md` já diz que teste
  // de latência afirma sobre CONTAGEM e SIMULTANEIDADE — este arquivo tinha um caso que
  // media milissegundos e falhava sozinho em máquina carregada (visto em 12/08/2026 com
  // 50 ms e 106 ms contra um teto de 45). Vermelho que não fala do código treina todo
  // mundo a ignorar a suíte.
  let emVooGeral = 0
  let picoGeral = 0

  const impl = (async (url: string) => {
    const atraso = opcoes.atrasoMs ?? 0

    if (url.includes('/wiki/rest/api/search')) {
      contagem.set('busca', (contagem.get('busca') ?? 0) + 1)
      return new Response(
        JSON.stringify({
          results: (opcoes.idsBusca ?? []).map((id, i) => ({
            content: { id, title: `Página ${id}`, space: { key: 'TECH' } },
            score: 1 - i / 100,
            excerpt: 'trecho',
            url: `/spaces/TECH/pages/${id}`,
          })),
        }),
        { status: 200 },
      )
    }

    if (url.includes('/restriction/byOperation/read')) {
      contagem.set('restricao', (contagem.get('restricao') ?? 0) + 1)
      emVooRestricao += 1
      picoRestricao = Math.max(picoRestricao, emVooRestricao)
      if (atraso > 0) await new Promise((ok) => setTimeout(ok, atraso))
      emVooRestricao -= 1
      const id = decodeURIComponent(url.split('/content/')[1]?.split('/')[0] ?? '')
      const restrito = (opcoes.restritos ?? []).includes(id)
      return new Response(
        JSON.stringify({
          restrictions: {
            user: { results: restrito ? [{ accountId: 'u1' }] : [] },
            group: { results: [] },
          },
        }),
        { status: 200 },
      )
    }

    // ⚠️ `labels` antes de `pages/{id}`: as duas rotas compartilham o prefixo.
    if (url.includes('/labels')) {
      contagem.set('labels', (contagem.get('labels') ?? 0) + 1)
      emVooGeral += 1
      picoGeral = Math.max(picoGeral, emVooGeral)
      if (atraso > 0) await new Promise((ok) => setTimeout(ok, atraso))
      emVooGeral -= 1
      return new Response(JSON.stringify({ results: [] }), { status: 200 })
    }
    if (url.includes('/wiki/api/v2/spaces/')) {
      contagem.set('espaco', (contagem.get('espaco') ?? 0) + 1)
      emVooGeral += 1
      picoGeral = Math.max(picoGeral, emVooGeral)
      if (atraso > 0) await new Promise((ok) => setTimeout(ok, atraso))
      emVooGeral -= 1
      return new Response(JSON.stringify({ key: 'TECH' }), { status: 200 })
    }
    if (url.includes('body-format=storage')) {
      contagem.set('corpo', (contagem.get('corpo') ?? 0) + 1)
      return new Response(
        JSON.stringify({ body: { storage: { value: '<p>oi</p>' } } }),
        { status: 200 },
      )
    }
    if (url.includes('/wiki/api/v2/pages/')) {
      contagem.set('pagina', (contagem.get('pagina') ?? 0) + 1)
      return new Response(
        JSON.stringify({
          id: 'p1',
          title: 'Página',
          spaceId: '123',
          status: 'current',
          version: { number: 1, createdAt: AGORA },
          _links: { webui: '/x' },
        }),
        { status: 200 },
      )
    }
    return new Response('{}', { status: 200 })
  }) as unknown as typeof fetch

  return {
    impl,
    contagem,
    get picoRestricao() { return picoRestricao },
    get picoGeral() { return picoGeral },
  }
}

describe('cache do Atlassian: sobrevive entre requisições (RNF-13)', () => {
  it('duas instâncias que compartilham as caches não repetem a busca', async () => {
    // É exatamente o que acontece em produção: cliente novo por requisição, caches do
    // isolate. Antes, cada requisição rebuscava tudo — o TTL era decorativo.
    const caches: CachesAtlassian = novasCachesAtlassian(() => 0)
    const rede = fetchEncenado({ idsBusca: ['p1'] })

    const primeira = new ClienteAtlassianHttp({ ...BASE, caches, fetchImpl: rede.impl })
    const segunda = new ClienteAtlassianHttp({ ...BASE, caches, fetchImpl: rede.impl })

    const params = { termo: 'pipeline', espacosPermitidos: ['TECH'], labelsBloqueadas: [], limite: 5 }
    await primeira.buscarConfluence(params)
    const idas = rede.contagem.get('busca')
    await segunda.buscarConfluence(params)

    expect(idas).toBe(1)
    expect(rede.contagem.get('busca')).toBe(1)
  })

  it('sem compartilhar as caches, cada instância rebusca — o estado ANTERIOR', async () => {
    // Prova que o teste acima mede o compartilhamento, e não um acerto por acidente.
    const rede = fetchEncenado({ idsBusca: ['p1'] })
    const params = { termo: 'pipeline', espacosPermitidos: ['TECH'], labelsBloqueadas: [], limite: 5 }
    await new ClienteAtlassianHttp({ ...BASE, fetchImpl: rede.impl }).buscarConfluence(params)
    await new ClienteAtlassianHttp({ ...BASE, fetchImpl: rede.impl }).buscarConfluence(params)
    expect(rede.contagem.get('busca')).toBe(2)
  })

  it('o corpo da página tem cache PRÓPRIA — teto pequeno, valor grande', async () => {
    const caches = novasCachesAtlassian(() => 0)
    const rede = fetchEncenado({})
    const cliente = new ClienteAtlassianHttp({ ...BASE, caches, fetchImpl: rede.impl })
    await cliente.obterCorpoStorage('pX')
    await cliente.obterCorpoStorage('pX')
    expect(rede.contagem.get('corpo')).toBe(1)
  })

  it('montarContexto compartilha as caches entre contextos (o fio até a produção)', async () => {
    // Sem esta asserção, alguém "limpa" o `caches:` de `contexto.ts` e a regressão volta
    // sem quebrar teste nenhum — foi assim que ela nasceu.
    const rede = fetchEncenado({ idsBusca: ['pz'] })
    const original = globalThis.fetch
    globalThis.fetch = rede.impl
    try {
      const env = {
        DB: new SqliteLocal(),
        ATLASSIAN_BASE_URL: BASE.baseUrl,
        ATLASSIAN_EMAIL: BASE.email,
        ATLASSIAN_API_TOKEN: 'token-real',
      }
      const params = {
        termo: 'contexto-compartilhado',
        espacosPermitidos: ['TECH'],
        labelsBloqueadas: [],
        limite: 5,
      }
      const a = await montarContexto(env)
      await a.atlassian.buscarConfluence(params)
      const b = await montarContexto(env)
      await b.atlassian.buscarConfluence(params)
      expect(rede.contagem.get('busca')).toBe(1)
    } finally {
      globalThis.fetch = original
    }
  })
})

describe('restrição por página: paralela, com teto e ordem preservada (RN-06)', () => {
  it('as verificações saem juntas, sem passar do teto', async () => {
    const ids = Array.from({ length: 12 }, (_, i) => `p${i + 1}`)
    const rede = fetchEncenado({ idsBusca: ids, atrasoMs: 5 })
    const cliente = new ClienteAtlassianHttp({ ...BASE, fetchImpl: rede.impl })

    await cliente.buscarConfluence({
      termo: 'x',
      espacosPermitidos: ['TECH'],
      labelsBloqueadas: [],
      limite: 12,
    })

    expect(rede.contagem.get('restricao')).toBe(12)
    expect(rede.picoRestricao).toBeGreaterThan(1)
    expect(rede.picoRestricao).toBeLessThanOrEqual(CONCORRENCIA_ATLASSIAN)
  })

  it('a página restrita continua fora, e a ordem por relevância continua de pé', async () => {
    // O ganho de latência não pode custar a terceira condição de RN-06 nem a ordem.
    const rede = fetchEncenado({
      idsBusca: ['p1', 'p2', 'p3', 'p4'],
      restritos: ['p2', 'p4'],
    })
    const cliente = new ClienteAtlassianHttp({ ...BASE, fetchImpl: rede.impl })

    const paginas = await cliente.buscarConfluence({
      termo: 'x',
      espacosPermitidos: ['TECH'],
      labelsBloqueadas: [],
      limite: 4,
    })
    expect(paginas.map((p) => p.id)).toEqual(['p1', 'p3'])
  })

  it('metadados: chave de espaço e labels saem em paralelo', async () => {
    // Duas requisições independentes que estavam em série, e uma leitura com breadcrumb
    // toca até seis páginas (RF-41).
    const rede = fetchEncenado({ atrasoMs: 25 })
    const cliente = new ClienteAtlassianHttp({ ...BASE, fetchImpl: rede.impl })
    await cliente.obterMetadadosPagina('p1')
    // Em série o pico é 1; em paralelo, 2. É a MESMA afirmação de antes ("as duas saem
    // juntas") sem depender do relógio da máquina que roda o teste.
    expect(rede.picoGeral).toBeGreaterThanOrEqual(2)
  })

  it('metadados: se a chave do espaço não resolve, ainda NEGA (fail-closed)', async () => {
    // Paralelizar não pode transformar "sem informação" em "segue em frente": sem chave
    // de espaço não há como avaliar a allowlist (RN-06).
    const semEspaco = (async (url: string) => {
      if (url.includes('/labels')) return new Response(JSON.stringify({ results: [] }), { status: 200 })
      if (url.includes('/wiki/api/v2/spaces/')) return new Response(JSON.stringify({}), { status: 200 })
      return new Response(
        JSON.stringify({
          id: 'p1',
          title: 'Página',
          spaceId: '123',
          status: 'current',
          version: { number: 1, createdAt: AGORA },
          _links: { webui: '/x' },
        }),
        { status: 200 },
      )
    }) as unknown as typeof fetch

    const cliente = new ClienteAtlassianHttp({ ...BASE, fetchImpl: semEspaco })
    await expect(cliente.obterMetadadosPagina('p1')).rejects.toThrow()
  })
})

// ---------------------------------------------------------------------------
// O turno do agente: a proposta em paralelo com a última ida ao modelo.
// ---------------------------------------------------------------------------

const CONFIG: ConfigValores = {
  ...CONFIG_PADRAO,
  dominios_permitidos: ['gocase.com'],
  espacos_confluence: ['TECH'],
  tipos_chamado_permitidos: ['70'],
  // Alto de propósito: o assunto aqui é latência, não bloqueio.
  regra1_threshold_score: 0.99,
  regra2_exemplos_ajuste_operacional: ['Rodei o pipeline manualmente'],
}

const PROPOSTA = {
  titulo: 'Pipeline não roda',
  descricao: 'Falha ao reprocessar.',
  tipoChamadoId: '70',
  prioridade: 'normal' as const,
  area: null,
  componente: null,
}

/**
 * IA de teste que **encena a sobreposição**: a segunda ida ao modelo só termina depois de
 * a extração da proposta ter começado.
 *
 * É o desenho que faz o teste falhar por *timeout* se alguém voltar a serializar as duas:
 * em série, o `chat` nº 2 esperaria para sempre por uma extração que só aconteceria depois
 * dele. Asserção de tempo seria frágil; deadlock é determinístico.
 */
class IaQueExigeSobreposicao implements ClienteIA {
  private chats = 0
  extracoes = 0
  private extracaoComecou!: () => void
  private readonly esperaExtracao = new Promise<void>((ok) => {
    this.extracaoComecou = ok
  })

  /** Roda antes de a extração gravar a proposta — usado no teste da trava de RN-07. */
  antesDeExtrair: (() => Promise<void>) | null = null

  async chat(params: ParametrosChat): Promise<RespostaIA> {
    this.chats += 1
    if (this.chats === 1) {
      return {
        texto: 'Vou verificar as duas coisas.',
        toolsPropostas: [
          { nome: 'search_confluence', argumentos: { topico: 'pipeline' } },
          { nome: 'check_jira_history', argumentos: { tipoProblema: 'pipeline' } },
        ],
        custoEstimadoUsd: 0.0001,
      }
    }
    // A resposta final ao usuário: só sai depois que a extração já está em voo.
    await this.esperaExtracao
    void params
    return { texto: 'Montei o chamado abaixo.', toolsPropostas: [], custoEstimadoUsd: 0.0001 }
  }

  async extrairProposta(params: ParametrosExtracao): Promise<ResultadoExtracao> {
    this.extracoes += 1
    this.extracaoComecou()
    if (this.antesDeExtrair) await this.antesDeExtrair()
    const permitido = params.tiposPermitidos.some((t) => t.id === PROPOSTA.tipoChamadoId)
    return { proposta: permitido ? PROPOSTA : null, custoEstimadoUsd: 0.0002 }
  }

  async classificarResolucao(_: ParametrosClassificacao): Promise<ResultadoClassificacao> {
    return { classe: 'resolucao_real', justificativa: 'teste', custoEstimadoUsd: 0.0001 }
  }

  /**
   * Não participa da sobreposição que este arquivo mede (spec 007): a análise de anexo roda
   * na requisição de **upload**, não no turno. Está aqui só para o dublê satisfazer o
   * contrato — e o `throw` denuncia se algum dia o turno passar a chamá-la sem querer.
   */
  async descreverArquivo(): Promise<never> {
    throw new Error('o turno não deve descrever arquivo — a análise roda no upload')
  }

  async verificarSaude() {
    return { ok: true, detalhe: 'teste' }
  }
}

function pagina(over: Partial<PaginaConfluence> = {}): PaginaConfluence {
  return {
    id: 'p1',
    titulo: 'Como reprocessar o pipeline',
    espaco: 'TECH',
    url: 'https://goengenharia.atlassian.net/wiki/spaces/TECH/pages/1',
    score: 0.5,
    trecho: 'Rode o comando X.',
    labels: [],
    ...over,
  }
}

function ticket(over: Partial<TicketHistorico> = {}): TicketHistorico {
  return {
    issueKey: 'TECH-1',
    titulo: 'Pipeline não rodou',
    criadoEm: AGORA,
    resolvidoEm: AGORA,
    chaveAgrupamento: 'pipeline',
    comentariosResolucao: ['Rodei manualmente.'],
    ...over,
  }
}

describe('turno do agente: a proposta não espera a resposta do modelo', () => {
  let db: SqliteLocal
  let conversas: RepositorioConversas
  let ia: IaQueExigeSobreposicao
  let orquestrador: Orquestrador

  beforeEach(async () => {
    db = new SqliteLocal()
    await migrar(db)
    conversas = new RepositorioConversas(db, () => AGORA)
    let n = 0
    const novoId = () => `id-${++n}`
    const auditoria = new AuditoriaBanco(db, () => AGORA, novoId)
    const atlassian = new ClienteAtlassianFake({ paginas: [pagina()], historico: [ticket()] })
    ia = new IaQueExigeSobreposicao()
    // O executor usa o fake padrão: quem está sob teste é a orquestração das idas ao
    // modelo, não a classificação.
    const executor = new ExecutorTools(atlassian, new ClienteIAFake(), db, auditoria, () => AGORA)
    orquestrador = new Orquestrador(ia, executor, conversas, auditoria, novoId)
  })

  it('a extração começa ANTES da resposta final do modelo terminar', async () => {
    const c = await conversas.criar('c1', ANA)
    const r = await orquestrador.processarMensagem(c, 'o pipeline não rodou', CONFIG)

    // Se as duas voltassem a ser sequenciais, este teste não falharia por asserção:
    // travaria, porque o `chat` nº 2 espera a extração.
    expect(ia.extracoes).toBe(1)
    expect(r.texto).toBe('Montei o chamado abaixo.')
    expect((await conversas.obter('c1'))?.proposta?.titulo).toBe(PROPOSTA.titulo)
  })

  it('bloqueio que aparece DURANTE a extração impede a proposta (RN-07)', async () => {
    // A trava não pode depender de um `if` que rodou antes do `await`: entre começar a
    // extração e voltar dela passa uma ida ao provedor. `D-21` já foi burlada uma vez.
    const c = await conversas.criar('c2', ANA)
    ia.antesDeExtrair = async () => {
      await conversas.registrarBloqueio('b1', 'c2', 'regra1_confluence', 'teste', null)
    }

    const r = await orquestrador.processarMensagem(c, 'o pipeline não rodou', CONFIG)

    expect((await conversas.obter('c2'))?.proposta).toBeNull()
    expect(r.bloqueioPendente).toBe(true)
    // E quem fala é o servidor, não o modelo: ele diria "montei o chamado abaixo".
    expect(r.texto).not.toBe('Montei o chamado abaixo.')
  })

  it('o custo da extração continua sendo contado, mesmo descartada', async () => {
    // RNF-16 mede gasto, não gasto aproveitado: a chamada aconteceu e foi paga.
    const c = await conversas.criar('c3', ANA)
    ia.antesDeExtrair = async () => {
      await conversas.registrarBloqueio('b2', 'c3', 'regra1_confluence', 'teste', null)
    }
    const r = await orquestrador.processarMensagem(c, 'x', CONFIG)
    expect(r.custoUsd).toBeGreaterThan(0.0002)
  })
})

/**
 * T-518 — a fonte organizacional não vira ida de rede por chamado aberto.
 *
 * ⚠️ Afirmado no nível da **rota**, não do cliente. O cliente já tem teste próprio da
 * cache em `rf19-area-teamguide`; o que só aqui aparece é a **fiação**: o dia em que
 * `contexto.ts` construir um cliente novo por requisição — com cache nova junto —, o teste
 * do cliente continua verde e cada chamado aberto passa a custar uma leitura da base
 * inteira da empresa. É exatamente o defeito nº 2 desta lista, na versão nova.
 */
describe('fonte organizacional: uma leitura por isolate, não por chamado (RNF-36)', () => {
  it('duas aberturas seguidas fazem UMA leitura da base', async () => {
    let leituras = 0
    const fetchImpl = (async () => {
      leituras++
      return new Response(
        JSON.stringify([{ contactEmail: 'ana@gocase.com', teams: ['RPA'] }]),
        { status: 200 },
      )
    }) as unknown as typeof fetch

    const cache = novaCacheTeamGuide()
    // Duas instâncias, como duas requisições — o que as liga é a cache do MÓDULO.
    const um = new ClienteTeamGuideHttp({ token: 't', fetchImpl, cache, agoraMs: () => 1000 })
    const dois = new ClienteTeamGuideHttp({ token: 't', fetchImpl, cache, agoraMs: () => 1000 })

    expect(await um.areaDe('ana@gocase.com')).toEqual({ estado: 'encontrada', area: 'RPA' })
    expect(await dois.areaDe('ana@gocase.com')).toEqual({ estado: 'encontrada', area: 'RPA' })
    expect(leituras).toBe(1)
  })

  it('cache NÃO compartilhada rebusca — é o estado que o defeito de RNF-13 produzia', async () => {
    let leituras = 0
    const fetchImpl = (async () => {
      leituras++
      return new Response(JSON.stringify([]), { status: 200 })
    }) as unknown as typeof fetch

    await new ClienteTeamGuideHttp({ token: 't', fetchImpl }).areaDe('ana@gocase.com')
    await new ClienteTeamGuideHttp({ token: 't', fetchImpl }).areaDe('ana@gocase.com')
    expect(leituras).toBe(2)
  })

  it('a abertura de chamado NÃO chama a fonte quando ela não está configurada', async () => {
    // `FR-13`: instalação sem a credencial se comporta como antes — e "como antes"
    // inclui não pagar ida de rede nenhuma.
    const db = new SqliteLocal()
    await migrar(db)
    // ⚠️ Precisa de `ATLASSIAN_API_TOKEN`: sem ele `usandoFakes` é verdadeiro e o
    // contexto instancia o dublê — que é o comportamento certo em teste, e justamente o
    // que este caso NÃO quer medir.
    const ctx = await montarContexto({
      DB: db,
      ATLASSIAN_API_TOKEN: 'token',
      ATLASSIAN_EMAIL: 'servico@gocase.com',
      ATLASSIAN_BASE_URL: 'https://goengenharia.atlassian.net',
    })
    expect(ctx.teamguide).toBeNull()
  })
})
