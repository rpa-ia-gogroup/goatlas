/**
 * T-122 / T-123 / T-131 — o cliente REAL da Organizations API contra `fetch` simulado.
 *
 * ⚠️ Estes testes provam o lado de cá: caminho montado, paginação seguida, tradução
 * dos campos, erro sem corpo cru, credencial certa no cabeçalho certo. Eles **não**
 * provam o contrato do outro lado — a credencial de Org Admin é Q1 e nunca falou com
 * a Atlassian (ver `ENDPOINTS_NAO_VERIFICADOS`). O que dá para garantir sem
 * credencial está aqui; o que não dá está declarado, não escondido.
 *
 * _Requirements: RF-51, RF-52, RF-57, RNF-01, RNF-04, RNF-14_
 */

import { describe, expect, it } from 'vitest'
import {
  BASE_ORGANIZACAO,
  ClienteOrganizacaoHttp,
  ENDPOINTS_NAO_VERIFICADOS,
  MAX_PAGINAS_USUARIOS,
  normalizarCarimbo,
} from '@/lib/atlassian/organizacao'

interface Chamada {
  url: string
  metodo: string
  auth: string | null
  corpo: string | null
}

function fetchFalso(
  respostas: (chamada: Chamada) => { status?: number; corpo?: unknown; headers?: Record<string, string> },
): { impl: typeof fetch; chamadas: Chamada[] } {
  const chamadas: Chamada[] = []
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    const chamada: Chamada = {
      url: String(url),
      metodo: init?.method ?? 'GET',
      auth: new Headers(init?.headers).get('Authorization'),
      corpo: typeof init?.body === 'string' ? init.body : null,
    }
    chamadas.push(chamada)
    const r = respostas(chamada)
    const status = r.status ?? 200
    // 204 não aceita corpo nem string vazia — o construtor de `Response` recusa.
    const corpo = status === 204 || r.corpo === undefined ? null : JSON.stringify(r.corpo)
    return new Response(corpo, { status, ...(r.headers ? { headers: r.headers } : {}) })
  }) as unknown as typeof fetch
  return { impl, chamadas }
}

const cliente = (impl: typeof fetch) =>
  new ClienteOrganizacaoHttp({
    apiKey: 'chave-org-de-teste',
    fetchImpl: impl,
    dormir: async () => {},
    aleatorio: () => 0.5,
  })

describe('T-122 — listarUsuarios', () => {
  it('usa Bearer contra api.atlassian.com — não Basic contra o site (RNF-04)', async () => {
    const { impl, chamadas } = fetchFalso(() => ({ corpo: { data: [] } }))
    await cliente(impl).listarUsuarios('org-1')
    expect(chamadas[0]?.url).toBe(
      `${BASE_ORGANIZACAO}/admin/v1/orgs/org-1/users?limit=100`,
    )
    expect(chamadas[0]?.auth).toBe('Bearer chave-org-de-teste')
  })

  it('traduz os campos da Atlassian para o contrato do app', async () => {
    const { impl } = fetchFalso(() => ({
      corpo: {
        data: [
          {
            account_id: 'acc-1',
            email: 'ana@gocase.com',
            name: 'Ana Souza',
            account_status: 'active',
            product_access: [
              { key: 'confluence', name: 'Confluence' },
              { key: 'jira-servicedesk', name: 'Jira Service Management' },
            ],
          },
        ],
      },
    }))
    const usuarios = await cliente(impl).listarUsuarios('org-1')
    expect(usuarios).toEqual([
      {
        accountId: 'acc-1',
        email: 'ana@gocase.com',
        nome: 'Ana Souza',
        produtos: [
          { chave: 'confluence', nome: 'Confluence' },
          { chave: 'jira-servicedesk', nome: 'Jira Service Management' },
        ],
      },
    ])
  })

  it('conta SEM produto continua na lista — ela não consome licença, mas existe', async () => {
    const { impl } = fetchFalso(() => ({
      corpo: { data: [{ account_id: 'acc-9', email: 'x@gocase.com', name: 'X' }] },
    }))
    const usuarios = await cliente(impl).listarUsuarios('org-1')
    expect(usuarios).toHaveLength(1)
    expect(usuarios[0]?.produtos).toEqual([])
  })

  it('conta desativada e conta sem `account_id` são descartadas', async () => {
    const { impl } = fetchFalso(() => ({
      corpo: {
        data: [
          { account_id: 'acc-1', email: 'a@gocase.com', name: 'A', account_status: 'inactive' },
          { email: 'sem-id@gocase.com', name: 'Sem id' },
          { account_id: 'acc-2', email: 'b@gocase.com', name: 'B' },
        ],
      },
    }))
    const usuarios = await cliente(impl).listarUsuarios('org-1')
    expect(usuarios.map((u) => u.accountId)).toEqual(['acc-2'])
  })

  it('segue `links.next` e acumula as páginas', async () => {
    const { impl, chamadas } = fetchFalso((c) =>
      c.url.includes('cursor=2')
        ? { corpo: { data: [{ account_id: 'acc-2', email: 'b@gocase.com', name: 'B' }] } }
        : {
            corpo: {
              data: [{ account_id: 'acc-1', email: 'a@gocase.com', name: 'A' }],
              links: { next: `${BASE_ORGANIZACAO}/admin/v1/orgs/org-1/users?cursor=2` },
            },
          },
    )
    const usuarios = await cliente(impl).listarUsuarios('org-1')
    expect(usuarios.map((u) => u.accountId)).toEqual(['acc-1', 'acc-2'])
    expect(chamadas).toHaveLength(2)
  })

  it('`links.next` de OUTRO host é ignorado — não se manda Org Admin para onde a resposta pedir', async () => {
    const { impl, chamadas } = fetchFalso(() => ({
      corpo: {
        data: [{ account_id: 'acc-1', email: 'a@gocase.com', name: 'A' }],
        links: { next: 'https://exfiltra.example.com/admin/v1/orgs/org-1/users' },
      },
    }))
    await cliente(impl).listarUsuarios('org-1')
    expect(chamadas).toHaveLength(1)
  })

  it('`links.next` apontando para si mesmo para no teto de páginas, não em laço infinito', async () => {
    const { impl, chamadas } = fetchFalso(() => ({
      corpo: {
        data: [{ account_id: 'acc-1', email: 'a@gocase.com', name: 'A' }],
        links: { next: `${BASE_ORGANIZACAO}/admin/v1/orgs/org-1/users?limit=100` },
      },
    }))
    await cliente(impl).listarUsuarios('org-1')
    expect(chamadas).toHaveLength(MAX_PAGINAS_USUARIOS)
  })

  it('RNF-01 — a mensagem de erro NÃO carrega o corpo da resposta da Atlassian', async () => {
    const { impl } = fetchFalso(() => ({
      status: 403,
      corpo: { message: 'token org-admin-abc123 sem permissão para dado-interno-xyz' },
    }))
    await expect(cliente(impl).listarUsuarios('org-1')).rejects.toThrow(
      /Organizations API respondeu 403/,
    )
    await expect(cliente(impl).listarUsuarios('org-1')).rejects.not.toThrow(/org-admin-abc123/)
  })

  it('RNF-14 — 429 é retentado com backoff antes de desistir', async () => {
    let n = 0
    const { impl, chamadas } = fetchFalso(() => {
      n += 1
      return n === 1 ? { status: 429, headers: { 'Retry-After': '1' } } : { corpo: { data: [] } }
    })
    await cliente(impl).listarUsuarios('org-1')
    expect(chamadas).toHaveLength(2)
  })
})

describe('T-123 — ultimoAcesso', () => {
  it('monta o caminho de last-active-dates e traduz por produto', async () => {
    const { impl, chamadas } = fetchFalso(() => ({
      corpo: {
        data: {
          account_id: 'acc-1',
          product_access: [
            { key: 'confluence', name: 'Confluence', last_active: '2026-08-04T10:00:00.000Z' },
            { key: 'jira-servicedesk', name: 'JSM' },
          ],
        },
      },
    }))
    const r = await cliente(impl).ultimoAcesso('org-1', 'acc-1')
    expect(chamadas[0]?.url).toBe(
      `${BASE_ORGANIZACAO}/admin/v1/orgs/org-1/directory/users/acc-1/last-active-dates`,
    )
    expect(r.porProduto).toEqual([
      { produto: 'confluence', ultimoAcessoEm: '2026-08-04T10:00:00.000Z' },
      // Sem `last_active` = nunca visto pela API, não erro de leitura.
      { produto: 'jira-servicedesk', ultimoAcessoEm: null },
    ])
  })

  it('accountId com caractere especial é escapado no caminho', async () => {
    const { impl, chamadas } = fetchFalso(() => ({ corpo: { data: { product_access: [] } } }))
    await cliente(impl).ultimoAcesso('org-1', 'acc/../outro')
    expect(chamadas[0]?.url).toContain('acc%2F..%2Foutro')
  })
})

describe('normalizarCarimbo — 55 anos de diferença entre segundos e milissegundos', () => {
  it('ISO válido passa normalizado', () => {
    expect(normalizarCarimbo('2026-08-04T10:00:00Z')).toBe('2026-08-04T10:00:00.000Z')
  })

  it('epoch em SEGUNDOS não é lido como milissegundos', () => {
    expect(normalizarCarimbo(1_754_308_800)).toBe('2025-08-04T12:00:00.000Z')
  })

  it('epoch em milissegundos passa direto', () => {
    expect(normalizarCarimbo(1_754_308_800_000)).toBe('2025-08-04T12:00:00.000Z')
  })

  it('lixo vira `null` — sem dado é honesto, dado errado rebaixa quem trabalha', () => {
    expect(normalizarCarimbo('ontem')).toBeNull()
    expect(normalizarCarimbo(null)).toBeNull()
    expect(normalizarCarimbo(0)).toBeNull()
    expect(normalizarCarimbo({})).toBeNull()
  })
})

describe('T-131 — revogarProduto', () => {
  it('é DELETE, com o produto no corpo', async () => {
    const { impl, chamadas } = fetchFalso(() => ({ status: 204 }))
    await cliente(impl).revogarProduto('org-1', 'acc-1', 'confluence')
    expect(chamadas[0]?.metodo).toBe('DELETE')
    expect(chamadas[0]?.url).toBe(
      `${BASE_ORGANIZACAO}/admin/v1/orgs/org-1/directory/users/acc-1/manage/product-access`,
    )
    expect(JSON.parse(chamadas[0]!.corpo!)).toEqual({ productKey: 'confluence' })
  })

  it('erro NÃO é engolido — "revogado" falso marcaria economia que não aconteceu', async () => {
    const { impl } = fetchFalso(() => ({ status: 400 }))
    await expect(cliente(impl).revogarProduto('org-1', 'acc-1', 'confluence')).rejects.toThrow()
  })
})

describe('honestidade sobre o que não foi verificado', () => {
  it('a lista de endpoints não verificados é código, não rodapé de documento', () => {
    expect(ENDPOINTS_NAO_VERIFICADOS.length).toBe(3)
    expect(ENDPOINTS_NAO_VERIFICADOS.map((e) => e.metodo)).toContain('DELETE')
    for (const e of ENDPOINTS_NAO_VERIFICADOS) {
      expect(e.risco.length).toBeGreaterThan(20)
    }
  })
})
