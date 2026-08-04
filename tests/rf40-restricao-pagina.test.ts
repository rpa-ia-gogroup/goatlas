/**
 * RF-40 / RN-06 — a terceira condição de exposição: **página sem restrição**.
 *
 * Este arquivo existe porque eu tinha deixado um furo: o CQL exclui por espaço e
 * por label, mas **não** por restrição de página — e espaço liberado não implica
 * página liberada. Sem esta verificação, uma página restrita apareceria na
 * mensagem de bloqueio da Regra 1, **com título, trecho e link**.
 *
 * Sob proxy total (D-01), **qualquer** restrição exclui a página: perante a
 * Atlassian a identidade é sempre a conta de serviço, então usar a permissão dela
 * como proxy da permissão da pessoa é exatamente o vazamento que RNF-09 proíbe.
 *
 * _Requirements: RF-40, RN-06, RNF-07, RNF-09_
 */

import { describe, expect, it } from 'vitest'
import { ClienteAtlassianHttp } from '@/lib/atlassian/cliente'
import { ClienteAtlassianFake } from '@/lib/atlassian/fake'
import { avaliarRegra1, montarMensagemBloqueio } from '@/lib/rules'
import type { PaginaConfluence } from '@/lib/atlassian/tipos'

const BASE = {
  baseUrl: 'https://goengenharia.atlassian.net',
  email: 'servico@gocase.com',
  apiToken: 'token',
  ttlMetadadosSeg: 900,
  ttlConteudoSeg: 300,
  campoSolicitanteId: null,
}

function pagina(over: Partial<PaginaConfluence> = {}): PaginaConfluence {
  return {
    id: 'p1',
    titulo: 'Processo liberado',
    espaco: 'TECH',
    url: 'https://goengenharia.atlassian.net/wiki/x',
    score: 0.9,
    trecho: 'conteúdo',
    labels: [],
    ...over,
  }
}

/** Fabrica um fetch que responde por rota, para encenar busca + restrição. */
function fetchEncenado(mapa: {
  resultados: { id: string; title: string; space: string; score: number }[]
  restricoesPorId: Record<string, { usuarios: number; grupos: number }>
  falharRestricaoDe?: string
}): typeof fetch {
  return (async (url: string) => {
    if (url.includes('/wiki/rest/api/search')) {
      return new Response(
        JSON.stringify({
          results: mapa.resultados.map((r) => ({
            content: { id: r.id, title: r.title, space: { key: r.space } },
            score: r.score,
            excerpt: 'trecho',
            url: `/spaces/${r.space}/pages/${r.id}`,
          })),
        }),
        { status: 200 },
      )
    }
    if (url.includes('/restriction/byOperation/read')) {
      const id = decodeURIComponent(url.split('/content/')[1]?.split('/')[0] ?? '')
      if (mapa.falharRestricaoDe === id) return new Response('', { status: 503 })
      const r = mapa.restricoesPorId[id] ?? { usuarios: 0, grupos: 0 }
      return new Response(
        JSON.stringify({
          restrictions: {
            user: { results: Array.from({ length: r.usuarios }, (_, i) => ({ accountId: `u${i}` })) },
            group: { results: Array.from({ length: r.grupos }, (_, i) => ({ name: `g${i}` })) },
          },
        }),
        { status: 200 },
      )
    }
    return new Response('{}', { status: 200 })
  }) as unknown as typeof fetch
}

const buscar = (cliente: ClienteAtlassianHttp) =>
  cliente.buscarConfluence({
    termo: 'processo',
    espacosPermitidos: ['TECH'],
    labelsBloqueadas: ['confidencial'],
    limite: 10,
  })

describe('RF-40 — página restrita em espaço liberado não sai da camada', () => {
  it('restrição por USUÁRIO exclui a página', async () => {
    const cliente = new ClienteAtlassianHttp({
      ...BASE,
      maxTentativas: 1,
      fetchImpl: fetchEncenado({
        resultados: [
          { id: 'livre', title: 'Processo liberado', space: 'TECH', score: 0.9 },
          { id: 'restrita', title: 'Salários 2026', space: 'TECH', score: 0.99 },
        ],
        restricoesPorId: { restrita: { usuarios: 2, grupos: 0 } },
      }),
    })
    const r = await buscar(cliente)
    expect(r.map((p) => p.id)).toEqual(['livre'])
    // A restrita tinha o MAIOR score — seria a primeira da mensagem de bloqueio.
    expect(JSON.stringify(r)).not.toContain('Salários')
  })

  it('restrição por GRUPO também exclui', async () => {
    const cliente = new ClienteAtlassianHttp({
      ...BASE,
      maxTentativas: 1,
      fetchImpl: fetchEncenado({
        resultados: [{ id: 'restrita', title: 'Só diretoria', space: 'TECH', score: 0.9 }],
        restricoesPorId: { restrita: { usuarios: 0, grupos: 1 } },
      }),
    })
    expect(await buscar(cliente)).toEqual([])
  })

  it('FALHA ao consultar a restrição também exclui — fail-closed', async () => {
    // Na dúvida sobre exposição, não expor. Custa uma página a menos na deflexão;
    // o contrário custa conteúdo restrito na tela de quem não devia ver.
    const cliente = new ClienteAtlassianHttp({
      ...BASE,
      maxTentativas: 1,
      fetchImpl: fetchEncenado({
        resultados: [{ id: 'incerta', title: 'Talvez restrita', space: 'TECH', score: 0.9 }],
        restricoesPorId: {},
        falharRestricaoDe: 'incerta',
      }),
    })
    expect(await buscar(cliente)).toEqual([])
  })

  it('página sem id é excluída — id vazio impede verificar restrição', async () => {
    const cliente = new ClienteAtlassianHttp({ ...BASE, maxTentativas: 1 })
    expect(await cliente.paginaRestrita('')).toBe(true)
  })

  it('a verificação é CACHEADA por página (RNF-13)', async () => {
    let consultasRestricao = 0
    const cliente = new ClienteAtlassianHttp({
      ...BASE,
      maxTentativas: 1,
      fetchImpl: (async (url: string) => {
        if (url.includes('/restriction/')) {
          consultasRestricao += 1
          return new Response(
            JSON.stringify({ restrictions: { user: { results: [] }, group: { results: [] } } }),
            { status: 200 },
          )
        }
        return new Response('{}', { status: 200 })
      }) as unknown as typeof fetch,
    })

    expect(await cliente.paginaRestrita('p1')).toBe(false)
    expect(await cliente.paginaRestrita('p1')).toBe(false)
    expect(consultasRestricao).toBe(1)
  })
})

describe('RN-06 — as três condições, juntas, no fake', () => {
  it('espaço fora, label bloqueada e página restrita: nenhuma das três passa', async () => {
    const atlassian = new ClienteAtlassianFake({
      paginas: [
        pagina({ id: 'ok' }),
        pagina({ id: 'espaco-errado', espaco: 'RH' }),
        pagina({ id: 'label-bloqueada', labels: ['confidencial'] }),
        pagina({ id: 'restrita' }),
      ],
      idsRestritos: new Set(['restrita']),
    })

    const r = await atlassian.buscarConfluence({
      termo: 'x',
      espacosPermitidos: ['TECH'],
      labelsBloqueadas: ['confidencial'],
      limite: 10,
    })
    expect(r.map((p) => p.id)).toEqual(['ok'])
  })

  it('a mensagem de bloqueio nunca cita página restrita', async () => {
    const atlassian = new ClienteAtlassianFake({
      paginas: [
        pagina({ id: 'ok', titulo: 'Como reprocessar', score: 0.8 }),
        pagina({ id: 'restrita', titulo: 'Plano de demissões', score: 0.99 }),
      ],
      idsRestritos: new Set(['restrita']),
    })
    const paginas = await atlassian.buscarConfluence({
      termo: 'x',
      espacosPermitidos: ['TECH'],
      labelsBloqueadas: [],
      limite: 10,
    })
    const veredito = avaliarRegra1(paginas, 0.75)
    expect(veredito.bloquear).toBe(true)
    if (!veredito.bloquear) return
    const msg = montarMensagemBloqueio(veredito)
    expect(msg).toContain('Como reprocessar')
    expect(msg).not.toContain('demissões')
  })
})
