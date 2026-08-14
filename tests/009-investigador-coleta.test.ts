/**
 * A coleta — spec 009, `SC-3`, `SC-4`, `SC-6`, `SC-8b`, `SC-9`.
 *
 * ⚠️ **Nenhum caso aqui mede milissegundos.** A afirmação de custo é sobre **contagem de
 * `exec`**, como `tests/latencia.test.ts` faz desde `D-32`: relógio em máquina carregada
 * produz vermelho que não fala do código, e vermelho assim treina o time a ignorar a suíte
 * inteira (`D-57`).
 *
 * _Requirements: FR-1, FR-2, FR-3, FR-4, FR-10c, FR-20_
 */

import { describe, expect, it } from 'vitest'
import { ColetaDeRequisicao, corpoSeguro, truncar, MAX_CORPO } from '@/lib/investigador/coleta'
import { corpoDaRequisicao, corpoDaResposta } from '@/lib/investigador/corpos'
import { fetchObservado } from '@/lib/investigador/fetch-observado'
import type { Banco, ResultadoExec, ResultadoQuery } from '@/lib/db/tipos'

const AGORA = '2026-08-14T13:00:00.000Z'

/** Banco de mentira que só conta e guarda o que foi executado. */
class BancoEspiao implements Banco {
  readonly execs: { sql: string; params: readonly unknown[] }[] = []
  constructor(private readonly falhar = false) {}
  async query(): Promise<ResultadoQuery> {
    return { columns: [], rows: [] }
  }
  async exec(sql: string, params: readonly unknown[]): Promise<ResultadoExec> {
    if (this.falhar) throw new Error('banco recusou')
    this.execs.push({ sql, params })
    return { rowsWritten: 1 }
  }
}

function novaColeta(): { coleta: ColetaDeRequisicao; db: BancoEspiao } {
  let n = 0
  return {
    coleta: new ColetaDeRequisicao('req-1', () => AGORA, () => `ev-${++n}`),
    db: new BancoEspiao(),
  }
}

const desfecho = {
  atorEmail: 'ana@gocase.com',
  metodo: 'POST',
  caminho: '/api/conversas/c1/mensagens',
  status: 200,
  duracaoMs: 1234,
}

describe('truncamento — SC-9', () => {
  it('marca o corte, nunca corta em silêncio', () => {
    const t = truncar('a'.repeat(50), 10)
    expect(t.startsWith('aaaaaaaaaa')).toBe(true)
    expect(t).toContain('[truncado, 50 caracteres]')
  })

  it('não toca no que cabe', () => {
    expect(truncar('curto', 10)).toBe('curto')
  })

  it('corpo grande chega truncado E reconhecível como truncado', () => {
    const corpo = JSON.stringify({ texto: 'x'.repeat(MAX_CORPO * 2) })
    const guardado = corpoSeguro(corpo)!
    expect(guardado.length).toBeLessThan(corpo.length)
    expect(guardado).toContain('[truncado,')
  })
})

describe('redação de credencial — SC-4', () => {
  it('chave sensível em JSON de objeto vira [REDIGIDO]', () => {
    const guardado = corpoSeguro(JSON.stringify({ email: 'ana@gocase.com', apiToken: 'ATATTxyz' }))!
    expect(guardado).toContain('ana@gocase.com')
    expect(guardado).not.toContain('ATATTxyz')
    expect(guardado).toContain('[REDIGIDO]')
  })

  it('redige também dentro de objeto aninhado', () => {
    const guardado = corpoSeguro(JSON.stringify({ a: { authorization: 'Bearer segredo' } }))!
    expect(guardado).not.toContain('segredo')
  })

  it('corpo que NÃO é JSON também é redigido — o caminho que a redação por chave não alcança', () => {
    const guardado = corpoSeguro('user=ana&api_key=abc123xyz&x=1')!
    expect(guardado).not.toContain('abc123xyz')
    expect(guardado).toContain('[REDIGIDO]')
  })

  it('redige ANTES de truncar: segredo no começo de um corpo enorme não sobrevive', () => {
    const corpo = JSON.stringify({ token: 'sup3rs3cr3t0', lixo: 'y'.repeat(MAX_CORPO * 2) })
    const guardado = corpoSeguro(corpo)!
    expect(guardado).not.toContain('sup3rs3cr3t0')
  })
})

describe('gate de corpo — SC-3', () => {
  it('upload de arquivo não tem o conteúdo lido, só o tamanho', async () => {
    const bytes = new Uint8Array(5_000_000)
    const r = new Request('https://x/api/anexos-pendentes', {
      method: 'POST',
      headers: { 'content-type': 'multipart/form-data; boundary=x', 'content-length': '5000000' },
      body: bytes,
    })
    const observado = await corpoDaRequisicao(r)
    expect(observado.texto).toBeNull()
    expect(observado.bytes).toBe(5_000_000)
  })

  it('JSON acima do teto de leitura também fica de fora', async () => {
    const r = new Request('https://x/api/x', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': '999999' },
      body: '{}',
    })
    expect((await corpoDaRequisicao(r)).texto).toBeNull()
  })

  it('JSON pequeno é lido, e o corpo original continua consumível pelo handler', async () => {
    const r = new Request('https://x/api/x', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"texto":"oi"}',
    })
    expect((await corpoDaRequisicao(r)).texto).toBe('{"texto":"oi"}')
    // ⚠️ A prova de que o clone não roubou o corpo: sem isto, toda rota POST ficaria sem
    // corpo — o modo mais caro possível de descobrir que o registro existe.
    expect(await r.json()).toEqual({ texto: 'oi' })
  })

  it('resposta binária do proxy de anexo não entra no registro', async () => {
    const r = new Response(new Uint8Array(1000), {
      headers: { 'content-type': 'image/png', 'content-length': '1000' },
    })
    const observado = await corpoDaResposta(r)
    expect(observado.texto).toBeNull()
    expect(observado.bytes).toBe(1000)
  })
})

describe('gravação em lote — SC-8b', () => {
  it('40 eventos custam UMA ida ao banco, mais a da requisição — nunca 41', async () => {
    const { coleta, db } = novaColeta()
    for (let i = 0; i < 40; i += 1) {
      coleta.registrar({ tipo: 'ia_chat', origem: 'ia', resumo: `evento ${i}` })
    }
    await coleta.gravar(db, desfecho)
    expect(db.execs).toHaveLength(2)
    expect(db.execs[0]!.sql).toContain('investigador_requisicoes')
    expect(db.execs[1]!.sql).toContain('investigador_eventos')
  })

  it('cada evento carrega o instante em que ACONTECEU, e a ordem desempata', async () => {
    // 🚨 Medido na staging em 14/08: carimbando tudo no `gravar`, um turno de 21 s mostrava
    // catorze eventos no mesmo segundo — a informação principal da tela, apagada.
    const instantes = ['2026-08-14T13:00:01.000Z', '2026-08-14T13:00:09.000Z']
    let i = 0
    let n = 0
    const coleta = new ColetaDeRequisicao(
      'req-1',
      () => instantes[Math.min(i++, instantes.length - 1)]!,
      () => `ev-${++n}`,
    )
    coleta.registrar({ tipo: 'mensagem_usuario', origem: 'usuario', resumo: 'primeiro' })
    coleta.registrar({ tipo: 'ia_chat', origem: 'ia', resumo: 'segundo' })
    const db = new BancoEspiao()
    await coleta.gravar(db, desfecho)

    const params = db.execs[1]!.params
    // 12 colunas por evento; `ordem` é a 11ª e `criado_em` a 12ª.
    expect(params[10]).toBe(0)
    expect(params[11]).toBe(instantes[0])
    expect(params[22]).toBe(1)
    expect(params[23]).toBe(instantes[1])
  })

  it('a ordem continua existindo — dois eventos no mesmo milissegundo são o caso comum', async () => {
    const { coleta, db } = novaColeta()
    coleta.registrar({ tipo: 'mensagem_usuario', origem: 'usuario', resumo: 'primeiro' })
    coleta.registrar({ tipo: 'ia_chat', origem: 'ia', resumo: 'segundo' })
    await coleta.gravar(db, desfecho)
    const params = db.execs[1]!.params
    expect(params[11]).toBe(params[23])
    expect(params[10]).toBe(0)
    expect(params[22]).toBe(1)
  })

  it('acima do teto de eventos o registro DIZ quantos ficaram de fora', async () => {
    const { coleta, db } = novaColeta()
    for (let i = 0; i < 405; i += 1) {
      coleta.registrar({ tipo: 'chamada_externa', origem: 'atlassian', resumo: `c${i}` })
    }
    await coleta.gravar(db, desfecho)
    const todos = db.execs.flatMap((e) => e.params).map(String)
    expect(todos.some((p) => p.includes('Teto de eventos atingido'))).toBe(true)
  })
})

describe('lote que a plataforma recusa cai para linha a linha', () => {
  /**
   * 🚨 **Medido na staging em 14/08/2026.** O `INSERT` de múltiplas tuplas grava no shim de
   * teste (`node:sqlite`) e **falhou** contra o `env.DB` do GoDeploy: a linha da requisição
   * entrava, o lote de eventos não, e a tabela ficava vazia com a lista de sessões
   * funcionando. Família de `linhasComoObjetos` — o dublê implementa o documentado, a
   * plataforma faz outra coisa, e o teste fica verde.
   */
  it('grava todos os eventos, um por vez, quando o lote é recusado', async () => {
    class RecusaLote extends BancoEspiao {
      override async exec(sql: string, params: readonly unknown[]): Promise<ResultadoExec> {
        // Só o INSERT com mais de uma tupla é recusado — como a plataforma fez.
        if (sql.includes('investigador_eventos') && sql.split('), (').length > 1) {
          throw new Error('D1_ERROR: too many SQL variables')
        }
        return super.exec(sql, params)
      }
    }
    const db = new RecusaLote()
    let n = 0
    const coleta = new ColetaDeRequisicao('req-1', () => AGORA, () => `ev-${++n}`)
    coleta.registrar({ tipo: 'mensagem_usuario', origem: 'usuario', resumo: 'primeiro' })
    coleta.registrar({ tipo: 'ia_chat', origem: 'ia', resumo: 'segundo' })
    coleta.registrar({ tipo: 'resposta_agente', origem: 'servidor', resumo: 'terceiro' })

    await coleta.gravar(db, desfecho)

    const eventos = db.execs.filter((e) => e.sql.includes('investigador_eventos'))
    // Nenhum evento se perde: três `INSERT` individuais depois do lote recusado.
    expect(eventos).toHaveLength(3)
    expect(db.execs.flatMap((e) => e.params)).toContain('terceiro')
  })
})

describe('falha do registro não derruba nada — SC-6', () => {
  it('banco recusando o INSERT não lança', async () => {
    const coleta = new ColetaDeRequisicao('req-1', () => AGORA, () => 'ev-1')
    coleta.registrar({ tipo: 'ia_chat', origem: 'ia', resumo: 'x' })
    await expect(coleta.gravar(new BancoEspiao(true), desfecho)).resolves.toBeUndefined()
  })

  it('evento com estrutura cíclica não lança na serialização', async () => {
    const { coleta, db } = novaColeta()
    const ciclico: Record<string, unknown> = {}
    ciclico.eu = ciclico
    coleta.registrar({ tipo: 'erro_de_rota', origem: 'servidor', resumo: 'x', dados: ciclico })
    await expect(coleta.gravar(db, desfecho)).resolves.toBeUndefined()
  })
})

describe('chamadas externas — FR-10b', () => {
  it('registra alvo, caminho e status, e devolve a resposta intacta', async () => {
    const vistas: unknown[] = []
    const espiao = fetchObservado(
      'atlassian',
      (c) => vistas.push(c),
      async () => new Response('{}', { status: 429 }),
      () => 0,
    )
    const r = await espiao('https://gocase.atlassian.net/rest/api/3/search?jql=segredo')
    expect(r.status).toBe(429)
    expect(vistas).toEqual([
      { alvo: 'atlassian', metodo: 'GET', caminho: '/rest/api/3/search', status: 429, duracaoMs: 0 },
    ])
  })

  it('a query NÃO entra no registro — ela carrega JQL e CQL', async () => {
    const vistas: { caminho: string }[] = []
    const espiao = fetchObservado(
      'atlassian',
      (c) => vistas.push(c),
      async () => new Response('{}'),
      () => 0,
    )
    await espiao('https://x/rest/api/3/search?jql=project%3DSEGREDO')
    expect(JSON.stringify(vistas)).not.toContain('SEGREDO')
  })

  it('falha de rede vira rótulo e o erro CONTINUA subindo', async () => {
    const vistas: { status: number | null; falha?: string | null }[] = []
    const espiao = fetchObservado(
      'teamguide',
      (c) => vistas.push(c),
      async () => {
        throw new TypeError('Illegal invocation')
      },
      () => 0,
    )
    await expect(espiao('https://x/employees/refs')).rejects.toThrow('Illegal invocation')
    // ⚠️ `status: null`, nunca `0`: "o servidor recusou" e "não houve resposta" são dois
    // plantões diferentes (`D-40`).
    expect(vistas[0]!.status).toBeNull()
    expect(vistas[0]!.falha).toBe('typeerror')
  })

  it('o rótulo da falha é o NOME do erro, nunca a mensagem', async () => {
    const vistas: { falha?: string | null }[] = []
    const espiao = fetchObservado(
      'ocr',
      (c) => vistas.push(c),
      async () => {
        throw new Error('token ATATT123 recusado pelo host interno')
      },
      () => 0,
    )
    await expect(espiao('https://x/ocr')).rejects.toThrow()
    expect(vistas[0]!.falha).toBe('error')
    expect(JSON.stringify(vistas)).not.toContain('ATATT123')
  })
})
