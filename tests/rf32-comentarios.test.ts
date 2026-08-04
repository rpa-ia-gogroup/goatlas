/**
 * RF-32 / RN-05 — comentário interno NUNCA chega ao colaborador.
 *
 * A Definição de Pronto exige: *"comentário interno do agente não vaza (testado
 * explicitamente, com `internal=false` e filtro server-side)"*. As duas camadas,
 * testadas separadamente — porque o valor da segunda é justamente cobrir a falha
 * da primeira.
 *
 * _Requirements: RF-32, RN-05, RF-33, RNF-14, RNF-15, RF-60, RNF-13_
 */

import { describe, expect, it } from 'vitest'
import {
  filtrarPublicos,
  montarQueryComentarios,
  prefixarAutoria,
} from '@/lib/atlassian/comentarios'
import { CacheTtl, TransporteAtlassian } from '@/lib/atlassian/http'
import { ErroAtlassian } from '@/lib/atlassian/tipos'

const comentario = (id: string, publico: unknown, corpo: string) => ({
  id,
  public: publico,
  body: corpo,
  created: { iso8601: '2026-08-03T12:00:00.000Z' },
  author: { displayName: 'Fulano' },
})

describe('RF-32 camada 1 — a query manda internal=false EXPLICITAMENTE', () => {
  it('os dois parâmetros vão na query', () => {
    const q = montarQueryComentarios()
    expect(q).toContain('public=true')
    expect(q).toContain('internal=false')
  })

  it('passar só public=true seria o bug: internal tem default TRUE no JSM', () => {
    // Este teste documenta a armadilha. Se alguém "simplificar" a query para
    // `?public=true` numa refatoração, ele falha e explica por quê.
    expect(montarQueryComentarios()).not.toBe('?public=true')
  })
})

describe('RF-32 camada 2 — filtro server-side pelo campo public', () => {
  it('comentário interno é descartado mesmo se a API o devolver', () => {
    // Encena a camada 1 falhando: a API devolveu interno apesar de internal=false.
    const itens = [
      comentario('1', true, 'Olá, estamos verificando.'),
      comentario('2', false, 'Cliente insistente, vamos empurrar para a próxima sprint.'),
      comentario('3', true, 'Resolvido.'),
    ]
    const publicos = filtrarPublicos(itens)
    expect(publicos.map((c) => c.id)).toEqual(['1', '3'])
    expect(JSON.stringify(publicos)).not.toContain('insistente')
  })

  it('comentário SEM o campo public é tratado como interno — fail-closed', () => {
    // Assumir "público quando o campo falta" vazaria por omissão da API.
    const itens = [
      { id: '1', body: 'sem campo public', created: { iso8601: 'x' }, author: {} },
      comentario('2', true, 'público de verdade'),
    ]
    expect(filtrarPublicos(itens).map((c) => c.id)).toEqual(['2'])
  })

  it('valores "quase true" não passam — só o booleano true', () => {
    for (const valor of ['true', 1, 'yes', {}, [], null, undefined]) {
      expect(filtrarPublicos([comentario('x', valor, 'corpo')]), String(valor)).toHaveLength(0)
    }
    expect(filtrarPublicos([comentario('x', true, 'corpo')])).toHaveLength(1)
  })

  it('item malformado não derruba a listagem', () => {
    const itens = [null, 'texto solto', 42, comentario('ok', true, 'corpo')]
    expect(filtrarPublicos(itens).map((c) => c.id)).toEqual(['ok'])
  })

  it('campos ausentes viram default seguro, nunca undefined na tela', () => {
    const [c] = filtrarPublicos([{ id: 9, public: true }])
    expect(c?.corpo).toBe('')
    expect(c?.autorNome).toBe('Desconhecido')
  })
})

describe('RF-33 — comentário atribuído de forma legível ao solicitante real', () => {
  it('o prefixo identifica quem pediu, apesar de partir da conta de serviço', () => {
    const corpo = prefixarAutoria('Segue o print anexo.', 'Ana Souza', 'ana@gocase.com')
    expect(corpo).toContain('Ana Souza')
    expect(corpo).toContain('ana@gocase.com')
    expect(corpo).toContain('Segue o print anexo.')
  })
})

describe('RNF-14 / RNF-15 / RF-60 — backoff, Retry-After e contagem de 429', () => {
  function transporte(
    respostas: Response[],
    opcoes: { dormiu?: number[] } = {},
  ): TransporteAtlassian {
    let i = 0
    return new TransporteAtlassian({
      baseUrl: 'https://exemplo.atlassian.net',
      email: 'servico@gocase.com',
      apiToken: 'token-fake',
      aleatorio: () => 0.5,
      dormir: async (ms) => {
        opcoes.dormiu?.push(ms)
      },
      fetchImpl: (async () => respostas[i++] ?? respostas.at(-1)) as unknown as typeof fetch,
    })
  }

  it('Retry-After MANDA sobre o backoff calculado', () => {
    const t = transporte([])
    // O servidor disse 7s: obedecer é o que evita o bloqueio piorar.
    expect(t.calcularEspera(1, 7)).toBe(7000)
    expect(t.calcularEspera(3, 7)).toBe(7000)
  })

  it('sem Retry-After, o backoff é exponencial com teto ~30s', () => {
    const t = transporte([])
    const e1 = t.calcularEspera(1, null)
    const e2 = t.calcularEspera(2, null)
    const e5 = t.calcularEspera(5, null)
    expect(e1).toBeGreaterThan(1500)
    expect(e2).toBeGreaterThan(e1)
    expect(e5).toBeLessThanOrEqual(31_000)
  })

  it('o jitter existe — sem ele, N clientes em 429 voltam todos juntos', () => {
    const baixo = new TransporteAtlassian({
      baseUrl: 'x',
      email: 'a@b.c',
      apiToken: 't',
      aleatorio: () => 0,
    })
    const alto = new TransporteAtlassian({
      baseUrl: 'x',
      email: 'a@b.c',
      apiToken: 't',
      aleatorio: () => 1,
    })
    expect(baixo.calcularEspera(2, null)).not.toBe(alto.calcularEspera(2, null))
  })

  it('429 é contado (RF-60) e a requisição é retentada', async () => {
    const dormiu: number[] = []
    const t = transporte(
      [
        new Response('', { status: 429, headers: { 'Retry-After': '1' } }),
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
      ],
      { dormiu },
    )
    await expect(t.requisitar('/rest/api/x')).resolves.toEqual({ ok: true })
    expect(t.contadores.total429).toBe(1)
    expect(t.contadores.totalRequisicoes).toBe(2)
    expect(dormiu).toEqual([1000])
  })

  it('erro 4xx que não é 429 NÃO é retentado — insistir esconde o problema', async () => {
    const t = transporte([new Response('', { status: 400 })])
    await expect(t.requisitar('/rest/api/x')).rejects.toThrow(ErroAtlassian)
    expect(t.contadores.totalRequisicoes).toBe(1)
  })

  it('a mensagem de erro nunca inclui o corpo da resposta (RNF-01, RNF-30)', async () => {
    const t = transporte([
      new Response(JSON.stringify({ erro: 'token abc123 inválido para conta-servico' }), {
        status: 403,
      }),
    ])
    await expect(t.requisitar('/rest/api/x')).rejects.toThrow(/respondeu 403/)
    await t.requisitar('/rest/api/x').catch((e: Error) => {
      expect(e.message).not.toContain('abc123')
      expect(e.message).not.toContain('conta-servico')
    })
  })
})

describe('RNF-13 — cache com TTL', () => {
  it('devolve do cache até expirar, e some depois', () => {
    let agora = 1_000_000
    const cache = new CacheTtl<string>(() => agora)
    cache.definir('k', 'valor', 300)

    expect(cache.obter('k')).toBe('valor')
    agora += 299_000
    expect(cache.obter('k')).toBe('valor')
    agora += 2_000
    expect(cache.obter('k')).toBeUndefined()
  })
})
