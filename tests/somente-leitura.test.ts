/**
 * Modo somente leitura — desenvolver com **credencial real** sem escrever nada.
 *
 * ## Por que esta trava existe
 *
 * O modo demonstração é tudo-ou-nada. Faltava o estado do meio, que é onde o projeto está:
 * credenciais reais registradas, querendo **ler** Confluence e Jira para mostrar o produto
 * com dado verdadeiro, e **não querendo escrever** — nem chamado, nem comentário, nem
 * anexo, nem transição. Sem a trava, mostrar o app com dado real significa aceitar que um
 * clique errado abre chamado na fila do time de tech.
 *
 * ## O que os testes trancam
 *
 * As quatro escritas recusam, **todas as leituras passam**, e a recusa é **definitiva** —
 * marcá-la como transitória faria o outbox reprocessar para sempre algo que nunca vai ser
 * aceito enquanto a trava estiver ligada.
 *
 * _Requirements: RNF-17, RNF-18, RNF-30, D-07_
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { SqliteLocal } from '@/lib/db/sqlite-local'
import { migrar } from '@/lib/db/schema'
import { Config } from '@/lib/config'
import { montarContexto } from '@/lib/contexto'
import { tratarRequisicao } from '@/lib/http/rotas'
import { HEADER_EMAIL } from '@/lib/auth'
import { ClienteAtlassianFake } from '@/lib/atlassian/fake'
import {
  ClienteAtlassianSomenteLeitura,
  MENSAGEM_SOMENTE_LEITURA,
} from '@/lib/atlassian/somente-leitura'
import { ErroAtlassian } from '@/lib/atlassian/tipos'
import { linhasComoObjetos } from '@/lib/db/tipos'

const ANA = 'ana@gocase.com'
const CHEFE = 'chefe@gocase.com'
const AGORA = '2026-08-07T04:00:00.000Z'

describe('o decorador recusa ESCRITA e deixa passar LEITURA', () => {
  const fake = () =>
    new ClienteAtlassianFake({
      tiposChamado: [{ id: 'rt-1', serviceDeskId: 'sd-1', nome: 'Suporte', descricao: null }],
      espacos: new Map([['TECH', { nome: 'Tecnologia', homepageId: 'home' }]]),
    })

  it('as QUATRO escritas recusam', async () => {
    const cliente = new ClienteAtlassianSomenteLeitura(fake())
    const escritas: [string, () => Promise<unknown>][] = [
      [
        'criarChamado',
        () =>
          cliente.criarChamado({
            serviceDeskId: 'sd-1',
            tipoChamadoId: 'rt-1',
            titulo: 't',
            descricao: 'd',
            prioridade: 'normal',
            solicitanteEmail: ANA,
            chaveIdempotencia: 'k',
          }),
      ],
      ['comentar', () => cliente.comentar('GOATLAS-1', 'oi', ANA)],
      [
        'anexarArquivo',
        () =>
          cliente.anexarArquivo('sd-1', 'GOATLAS-1', {
            nome: 'a.png',
            tipo: 'image/png',
            bytes: new ArrayBuffer(1),
          }),
      ],
      ['transicionar', () => cliente.transicionar('GOATLAS-1', 't1')],
    ]

    for (const [nome, chamada] of escritas) {
      await expect(chamada(), nome).rejects.toThrow(MENSAGEM_SOMENTE_LEITURA)
    }
  })

  it('⚠️ a recusa é DEFINITIVA — transitória faria o outbox retentar para sempre', async () => {
    const cliente = new ClienteAtlassianSomenteLeitura(fake())
    await cliente
      .comentar('GOATLAS-1', 'oi', ANA)
      .catch((e: unknown) => {
        expect(e).toBeInstanceOf(ErroAtlassian)
        expect((e as InstanceType<typeof ErroAtlassian>).detalhe.transitorio).toBe(false)
      })
  })

  it('a leitura passa inteira — a trava é sobre efeito colateral, não sobre acesso', async () => {
    const base = fake()
    const cliente = new ClienteAtlassianSomenteLeitura(base)
    expect((await cliente.listarTiposChamado()).length).toBe(1)
    expect((await cliente.obterEspaco('TECH')).nome).toBe('Tecnologia')
    expect(await cliente.buscarConfluence({ termo: 'x', espacosPermitidos: ['TECH'], labelsBloqueadas: [], limite: 5 })).toEqual([])
    expect(await cliente.listarTransicoes('GOATLAS-1')).toEqual([])
  })

  it('`listarTransicoes` passa apesar do nome — ela só CONSULTA', async () => {
    // Quem executa é `transicionar`, que está bloqueada. Bloquear a consulta também
    // esconderia da tela que existem ações, o que é informação verdadeira.
    const cliente = new ClienteAtlassianSomenteLeitura(fake())
    await expect(cliente.listarTransicoes('GOATLAS-1')).resolves.toEqual([])
  })

  it('o health DIZ que está travado — "ok" sozinho enganaria', async () => {
    const cliente = new ClienteAtlassianSomenteLeitura(fake())
    expect((await cliente.verificarSaude()).detalhe).toMatch(/somente leitura/)
  })
})

describe('pelas rotas, com a trava ligada por env', () => {
  let db: SqliteLocal
  let n = 0

  async function montar() {
    return montarContexto(
      { DB: db, GOATLAS_USAR_FAKES: '1', GOATLAS_SOMENTE_LEITURA: '1' },
      () => AGORA,
      () => `id-${++n}`,
    )
  }

  beforeEach(async () => {
    db = new SqliteLocal()
    await migrar(db)
    n = 0
    const config = new Config(db)
    await config.definir('dominios_permitidos', ['gocase.com'], CHEFE, AGORA)
    await config.definir('admins', [CHEFE], CHEFE, AGORA)
    await config.definir('service_desk_id', 'sd-1', CHEFE, AGORA)
    await config.definir('tipos_chamado_permitidos', ['rt-1'], CHEFE, AGORA)
  })

  async function chamar(caminho: string, o: { metodo?: string; corpo?: unknown } = {}) {
    const ctx = await montar()
    const r = await tratarRequisicao(
      new Request(`https://x${caminho}`, {
        method: o.metodo ?? 'GET',
        headers: { [HEADER_EMAIL]: ANA, ...(o.corpo ? { 'content-type': 'application/json' } : {}) },
        ...(o.corpo === undefined ? {} : { body: JSON.stringify(o.corpo) }),
      }),
      ctx,
      {},
    )
    return { status: r.status, corpo: (await r.json().catch(() => null)) as never }
  }

  it('abrir chamado é recusado, e NADA fica pendente no outbox', async () => {
    const r = await chamar('/api/chamados', {
      metodo: 'POST',
      corpo: {
        titulo: 'Preciso de acesso ao painel',
        descricao: 'Entrei essa semana e ainda não tenho acesso.',
        tipoChamadoId: 'rt-1',
        prioridade: 'normal',
        chaveIdempotencia: 'k1',
      },
    })
    // ⚠️ Recusa definitiva sobe como erro; o importante é o outbox não guardar uma
    // submissão que o cron tentaria para sempre.
    expect(r.status).toBeGreaterThanOrEqual(400)
    const pendentes = linhasComoObjetos<{ estado: string }>(
      await db.query(`SELECT estado FROM submissoes`, []),
    )
    expect(pendentes.every((p) => p.estado !== 'pendente')).toBe(true)
    expect((await db.query('SELECT issue_key FROM vinculos', [])).rows).toHaveLength(0)
  })

  it('`/api/auth/me` avisa — sem isso a pessoa acha que o app quebrou', async () => {
    const r = await chamar('/api/auth/me')
    expect((r.corpo as { somenteLeitura: boolean }).somenteLeitura).toBe(true)
  })

  it('a leitura de documentação continua funcionando', async () => {
    // É o ponto todo do modo: mostrar a documentação real sem risco de escrever.
    const r = await chamar('/api/confluence/busca?q=ferias')
    expect(r.status).toBe(200)
  })

  it('sem a env, nada muda — a trava é opt-in', async () => {
    const ctx = await montarContexto(
      { DB: db, GOATLAS_USAR_FAKES: '1' },
      () => AGORA,
      () => `id-${++n}`,
    )
    expect(ctx.somenteLeitura).toBe(false)
  })
})
