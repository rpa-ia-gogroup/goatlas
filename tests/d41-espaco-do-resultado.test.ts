/**
 * **`D-41`** — todo resultado da busca voltava com `espaco: ""`.
 *
 * Medido na staging em 12/08/2026: `GET /api/confluence/busca?q=deploy` devolveu
 * os 10 itens com `"espaco": ""`. A origem é o endpoint **v1** de search, que
 * **não expande `content.space`** sem `&expand=` — o código lia
 * `r.content?.space?.key` de um `content` que nunca trouxe `space`.
 *
 * Não é furo de exposição: o CQL já restringe por `space in (...)` e `RN-06`
 * continua avaliada por página. O que se perdia era a **origem** na tela de
 * resultados.
 *
 * ⚠️ A armadilha do conserto está no fallback. `resultGlobalContainer.title` é o
 * **nome** do espaço ("Gestão de Tecnologia"); a allowlist e toda a navegação são
 * por **chave** (`GT`). Usar o título casaria com a expectativa visual e poria um
 * nome onde o resto do app espera uma chave — a mesma confusão que a v2 provoca
 * com `spaceId` numérico. Por isso o fallback lê o `displayUrl` (`/spaces/GT`), e
 * há teste afirmando que o título **não** é usado.
 *
 * _Requirements: RF-37, RF-41, RN-06_
 */

import { describe, expect, it } from 'vitest'
import { ClienteAtlassianHttp } from '@/lib/atlassian/cliente'

const BASE = {
  baseUrl: 'https://goengenharia.atlassian.net',
  email: 'servico@gocase.com',
  apiToken: 'token',
  ttlMetadadosSeg: 900,
  ttlConteudoSeg: 300,
}

/** Cliente com rede de mentira: guarda as URLs e devolve o corpo roteirizado. */
function clienteFalso(corpoDaBusca: unknown): {
  cliente: ClienteAtlassianHttp
  urls: string[]
} {
  const urls: string[] = []
  const fetchImpl = (async (url: string | URL | Request) => {
    const u = String(url)
    urls.push(u)
    // A verificação de restrição de `RN-06` — sem restrição nenhuma.
    if (u.includes('/restriction/byOperation/read')) {
      return new Response(JSON.stringify({ restrictions: {} }), { status: 200 })
    }
    return new Response(JSON.stringify(corpoDaBusca), { status: 200 })
  }) as unknown as typeof fetch
  return { cliente: new ClienteAtlassianHttp({ ...BASE, fetchImpl }), urls }
}

const PARAMS = {
  termo: 'deploy',
  espacosPermitidos: ['GT'],
  labelsBloqueadas: [],
  limite: 5,
}

describe('a busca devolve a CHAVE do espaço de cada resultado', () => {
  it('pede a expansão de `content.space` — sem ela a v1 não manda o espaço', async () => {
    const { cliente, urls } = clienteFalso({ results: [] })
    await cliente.buscarConfluence(PARAMS)
    const busca = urls.find((u) => u.includes('/wiki/rest/api/search'))!
    expect(busca).toContain('expand=content.space')
  })

  it('a chave vem da expansão quando ela chega', async () => {
    const { cliente } = clienteFalso({
      results: [
        {
          content: { id: '123', title: 'Conventional Deploys', space: { key: 'GT' } },
          url: '/spaces/GT/pages/123',
          score: 0.8,
          excerpt: 'como entregar',
        },
      ],
    })
    const [p] = await cliente.buscarConfluence(PARAMS)
    expect(p!.espaco).toBe('GT')
  })

  it('🚨 sem a expansão, a chave sai do `displayUrl` — NUNCA do nome do espaço', async () => {
    const { cliente } = clienteFalso({
      results: [
        {
          content: { id: '123', title: 'Conventional Deploys' },
          resultGlobalContainer: { title: 'Gestão de Tecnologia', displayUrl: '/spaces/GT' },
          url: '/spaces/GT/pages/123',
          score: 0.8,
        },
      ],
    })
    const [p] = await cliente.buscarConfluence(PARAMS)
    // A allowlist, a árvore e o `?espaco=` são todos por CHAVE. Um nome aqui
    // funcionaria na tela e quebraria em silêncio em todo o resto.
    expect(p!.espaco).toBe('GT')
    expect(p!.espaco).not.toBe('Gestão de Tecnologia')
  })

  it('sem expansão e sem `displayUrl` reconhecível, fica vazio — nunca um palpite', async () => {
    const { cliente } = clienteFalso({
      results: [
        {
          content: { id: '123', title: 'Sem espaço' },
          resultGlobalContainer: { title: 'Gestão de Tecnologia' },
          url: '/x',
          score: 0.1,
        },
      ],
    })
    const [p] = await cliente.buscarConfluence(PARAMS)
    expect(p!.espaco).toBe('')
  })
})
