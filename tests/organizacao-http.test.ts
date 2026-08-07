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
  cursorDaProximaPagina,
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

/** O corpo JSON de uma chamada, já desserializado. */
const corpoDe = (c: Chamada | undefined) =>
  JSON.parse(c?.corpo ?? '{}') as Record<string, unknown>

describe('T-122 — listarUsuarios usa `POST /users/search`, não `GET /users`', () => {
  it('usa Bearer contra api.atlassian.com — não Basic contra o site (RNF-04)', async () => {
    const { impl, chamadas } = fetchFalso(() => ({ corpo: { data: [] } }))
    await cliente(impl).listarUsuarios('org-1')
    expect(chamadas[0]?.url).toBe(`${BASE_ORGANIZACAO}/admin/v1/orgs/org-1/users/search`)
    expect(chamadas[0]?.metodo).toBe('POST')
    expect(chamadas[0]?.auth).toBe('Bearer chave-org-de-teste')
  })

  /**
   * ⚠️ O motivo de `GET /users` ter saído: ele lista só conta **gerenciada**, e a org da
   * Gocase não reivindicou domínio — devolve `{"data": []}` com HTTP 200. Um teste que
   * afirme o caminho antigo estaria certificando uma chamada que sempre volta vazia.
   */
  it('NÃO chama o endpoint de contas gerenciadas, que devolve lista vazia sem domínio', async () => {
    const { impl, chamadas } = fetchFalso(() => ({ corpo: { data: [] } }))
    await cliente(impl).listarUsuarios('org-1')
    for (const c of chamadas) {
      expect(c.url).not.toMatch(/\/users(\?|$)/)
    }
  })

  it('manda `accountTypes: ["atlassian"]` — sem ele entram ~83 contas de app/bot', async () => {
    const { impl, chamadas } = fetchFalso(() => ({ corpo: { data: [] } }))
    await cliente(impl).listarUsuarios('org-1')
    expect(corpoDe(chamadas[0]).accountTypes).toEqual(['atlassian'])
  })

  /**
   * `query`, `groupIds` e `productAccess` respondem **200 com a lista inteira**, sem
   * filtrar. Mandar um deles produz um resultado que parece filtrado e não é — por isso
   * a ausência deles é uma afirmação do teste, não um detalhe.
   */
  it('NÃO manda os filtros que respondem 200 sem filtrar nada', async () => {
    const { impl, chamadas } = fetchFalso(() => ({ corpo: { data: [] } }))
    await cliente(impl).listarUsuarios('org-1')
    for (const c of chamadas) {
      const corpo = corpoDe(c)
      expect(corpo).not.toHaveProperty('query')
      expect(corpo).not.toHaveProperty('groupIds')
      expect(corpo).not.toHaveProperty('productAccess')
    }
  })

  it('faz DUAS varreduras — `isSuspended` é o único jeito de saber quem está suspenso', async () => {
    const { impl, chamadas } = fetchFalso(() => ({ corpo: { data: [] } }))
    await cliente(impl).listarUsuarios('org-1')
    expect(chamadas).toHaveLength(2)
    expect(chamadas.map((c) => corpoDe(c).isSuspended)).toEqual([false, true])
  })

  it('traduz os campos da Atlassian para o contrato do app', async () => {
    const { impl } = fetchFalso((c) =>
      corpoDe(c).isSuspended === true
        ? { corpo: { data: [] } }
        : {
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
          },
    )
    const r = await cliente(impl).listarUsuarios('org-1')
    expect(r.usuarios).toEqual([
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
    expect(r.suspensaoConhecida).toBe(true)
    expect(r.parcial).toBe(false)
  })

  it('conta SEM produto continua na lista — ela não consome licença, mas existe', async () => {
    const { impl } = fetchFalso((c) =>
      corpoDe(c).isSuspended === true
        ? { corpo: { data: [] } }
        : { corpo: { data: [{ account_id: 'acc-9', email: 'x@gocase.com', name: 'X' }] } },
    )
    const r = await cliente(impl).listarUsuarios('org-1')
    expect(r.usuarios).toHaveLength(1)
    expect(r.usuarios[0]?.produtos).toEqual([])
  })

  it('conta desativada e conta sem `account_id` são descartadas', async () => {
    const { impl } = fetchFalso((c) =>
      corpoDe(c).isSuspended === true
        ? { corpo: { data: [] } }
        : {
            corpo: {
              data: [
                {
                  account_id: 'acc-1',
                  email: 'a@gocase.com',
                  name: 'A',
                  account_status: 'inactive',
                },
                { email: 'sem-id@gocase.com', name: 'Sem id' },
                { account_id: 'acc-2', email: 'b@gocase.com', name: 'B' },
              ],
            },
          },
    )
    const r = await cliente(impl).listarUsuarios('org-1')
    expect(r.usuarios.map((u) => u.accountId)).toEqual(['acc-2'])
  })

  it('a conta suspensa NÃO entra na lista de assentos, e é contada à parte', async () => {
    const { impl } = fetchFalso((c) =>
      corpoDe(c).isSuspended === true
        ? { corpo: { data: [{ account_id: 'sus-1', email: 's@gocase.com', name: 'S' }] } }
        : { corpo: { data: [{ account_id: 'acc-1', email: 'a@gocase.com', name: 'A' }] } },
    )
    const r = await cliente(impl).listarUsuarios('org-1')
    // Conta suspensa não consome licença: incluí-la infla o custo e produz
    // recomendação de revogar acesso de quem já não tem acesso.
    expect(r.usuarios.map((u) => u.accountId)).toEqual(['acc-1'])
    expect(r.suspensas).toBe(1)
    expect(r.suspensaoConhecida).toBe(true)
  })

  /**
   * O caso que o memo de 31/07 torna plausível: `query`/`groupIds`/`productAccess`
   * respondem 200 **sem filtrar**. Se `isSuspended` for um deles, as duas varreduras
   * devolvem o mesmo conjunto — e afirmar "nenhuma suspensa" aí seria inventar.
   */
  it('filtro de suspensão que NÃO filtra é detectado, não acreditado', async () => {
    const mesmaLista = {
      corpo: {
        data: [
          { account_id: 'acc-1', email: 'a@gocase.com', name: 'A' },
          { account_id: 'acc-2', email: 'b@gocase.com', name: 'B' },
        ],
      },
    }
    const { impl } = fetchFalso(() => mesmaLista)
    const r = await cliente(impl).listarUsuarios('org-1')
    expect(r.suspensaoConhecida).toBe(false)
    // E não afirma um número de suspensas que não mediu.
    expect(r.suspensas).toBe(0)
    // A lista de assentos continua vindo: cegueira sobre suspensão não é motivo para
    // deixar o console sem inventário nenhum (RNF-18).
    expect(r.usuarios).toHaveLength(2)
  })

  it('o cursor volta em `links.next` e é reenviado NO CORPO, não seguido como URL', async () => {
    const { impl, chamadas } = fetchFalso((c) => {
      if (corpoDe(c).isSuspended === true) return { corpo: { data: [] } }
      return corpoDe(c).cursor === 'abc123'
        ? { corpo: { data: [{ account_id: 'acc-2', email: 'b@gocase.com', name: 'B' }] } }
        : {
            corpo: {
              data: [{ account_id: 'acc-1', email: 'a@gocase.com', name: 'A' }],
              links: {
                next: `${BASE_ORGANIZACAO}/admin/v1/orgs/org-1/users/search?cursor=abc123`,
              },
            },
          }
    })
    const r = await cliente(impl).listarUsuarios('org-1')
    expect(r.usuarios.map((u) => u.accountId)).toEqual(['acc-1', 'acc-2'])
    // A URL nunca muda: é sempre o mesmo POST. O que muda é o corpo.
    expect(chamadas[1]?.url).toBe(`${BASE_ORGANIZACAO}/admin/v1/orgs/org-1/users/search`)
    expect(corpoDe(chamadas[1]).cursor).toBe('abc123')
    // A primeira página não manda cursor — mandar `undefined` viraria `"cursor":null`.
    expect(corpoDe(chamadas[0])).not.toHaveProperty('cursor')
  })

  it('`links.next` de OUTRO host é ignorado — cursor de fora não é cursor desta paginação', async () => {
    const { impl, chamadas } = fetchFalso(() => ({
      corpo: {
        data: [{ account_id: 'acc-1', email: 'a@gocase.com', name: 'A' }],
        links: { next: 'https://exfiltra.example.com/admin/v1/orgs/org-1/users/search?cursor=x' },
      },
    }))
    await cliente(impl).listarUsuarios('org-1')
    // Uma chamada por varredura, nenhuma página extra.
    expect(chamadas).toHaveLength(2)
  })

  it('`links.next` que nunca termina para no teto — e a coleta sai marcada como PARCIAL', async () => {
    const { impl, chamadas } = fetchFalso(() => ({
      corpo: {
        data: [{ account_id: 'acc-1', email: 'a@gocase.com', name: 'A' }],
        links: {
          next: `${BASE_ORGANIZACAO}/admin/v1/orgs/org-1/users/search?cursor=sempre-o-mesmo`,
        },
      },
    }))
    const r = await cliente(impl).listarUsuarios('org-1')
    expect(chamadas).toHaveLength(MAX_PAGINAS_USUARIOS * 2)
    // ⚠️ Antes o teto era atingido em SILÊNCIO: a lista voltava truncada e a tela
    // recomendava rebaixar assento com base num inventário incompleto.
    expect(r.parcial).toBe(true)
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
    // 1 recusada + 1 retentada + 1 da segunda varredura.
    expect(chamadas).toHaveLength(3)
  })
})

describe('cursorDaProximaPagina — extrai o valor, não repassa a URL', () => {
  it('tira o `cursor` da query string', () => {
    expect(
      cursorDaProximaPagina(`${BASE_ORGANIZACAO}/admin/v1/orgs/o/users/search?cursor=abc`),
    ).toBe('abc')
  })

  it('sem `cursor` na URL é fim de paginação, não string vazia', () => {
    expect(cursorDaProximaPagina(`${BASE_ORGANIZACAO}/admin/v1/orgs/o/users/search`)).toBeNull()
    expect(cursorDaProximaPagina(`${BASE_ORGANIZACAO}/x?cursor=`)).toBeNull()
  })

  it('outro host e lixo viram `null`', () => {
    expect(cursorDaProximaPagina('https://exfiltra.example.com/x?cursor=abc')).toBeNull()
    expect(cursorDaProximaPagina('não é url')).toBeNull()
    expect(cursorDaProximaPagina(null)).toBeNull()
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
