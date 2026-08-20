/**
 * `D-78` — limpeza de dado de teste em produção.
 *
 * O que estes casos travam não é "o DELETE funciona": é que ele apaga **só o que a lista
 * nomeia**. O banco de produção tem duas semanas de desenvolvimento misturadas com gente de
 * verdade, e o modo de errar aqui é irreversível e silencioso — some a conversa de um colega e
 * ninguém descobre, porque o próprio dado que provaria o erro deixou de existir.
 *
 * _Requirements: RF-42, RN-09, RNF-33, D-17_
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { SqliteLocal } from '@/lib/db/sqlite-local'
import { migrar } from '@/lib/db/schema'
import { primeiraLinha } from '@/lib/db/tipos'
import { descartar, inventariar, TABELAS_DE_USO } from '@/lib/governanca/limpeza'
import { Config } from '@/lib/config'
import { montarContexto, type Contexto } from '@/lib/contexto'
import { tratarRequisicao } from '@/lib/http/rotas'
import { HEADER_EMAIL } from '@/lib/auth'

const ANA = 'ana@gocase.com'
const CHEFE = 'chefe@gocase.com'
const AGORA = '2026-08-20T12:00:00.000Z'

let db: SqliteLocal
let ctx: Contexto
let n = 0

/** Uma conversa que virou chamado, com mensagem, bloqueio e busca — o rastro completo. */
async function semear(issueKey: string, email: string, conversaId: string): Promise<void> {
  await db.exec(
    `INSERT INTO conversas (id, solicitante_email, estado, criado_em, atualizado_em)
     VALUES (?, ?, 'coletando', ?, ?)`,
    [conversaId, email, AGORA, AGORA],
  )
  await db.exec(
    `INSERT INTO mensagens (id, conversa_id, papel, conteudo, criado_em)
     VALUES (?, ?, 'usuario', 'oi', ?)`,
    [`msg-${conversaId}`, conversaId, AGORA],
  )
  await db.exec(
    `INSERT INTO bloqueios (id, conversa_id, regra, motivo, houve_override, override_motivo, override_em, criado_em)
     VALUES (?, ?, 'regra1_confluence', 'ha pagina que responde', 1, 'a pagina fala da loja fisica', ?, ?)`,
    [`blq-${conversaId}`, conversaId, AGORA, AGORA],
  )
  await db.exec(
    `INSERT INTO vinculos (issue_key, solicitante_email, conversa_id, criado_em)
     VALUES (?, ?, ?, ?)`,
    [issueKey, email, conversaId, AGORA],
  )
  await db.exec(
    `INSERT INTO notificacoes
       (id, issue_key, destinatario_email, tipo_evento, carimbo_mudanca, fonte,
        titulo, corpo, estado, criado_em, atualizado_em)
     VALUES (?, ?, ?, 'chamado_criado', ?, 'app', 'Chamado aberto', 'corpo', 'suprimida', ?, ?)`,
    [`ntf-${issueKey}`, issueKey, email, AGORA, AGORA, AGORA],
  )
}

const contar = async (tabela: string): Promise<number> => {
  const r = await db.query(`SELECT COUNT(*) AS n FROM ${tabela}`, [])
  return Number(primeiraLinha<{ n: number }>(r)?.n ?? 0)
}

beforeEach(async () => {
  db = new SqliteLocal()
  await migrar(db)
  n = 0
  const config = new Config(db)
  await config.definir('dominios_permitidos', ['gocase.com'], CHEFE, AGORA)
  await config.definir('admins', [CHEFE], CHEFE, AGORA)
  ctx = await montarContexto(
    { DB: db, ATLAS_USAR_FAKES: '1' },
    () => AGORA,
    () => `id-${++n}`,
  )
})

describe('inventário', () => {
  it('marca a chave do FAKE, que é chamado que não existe no Jira', async () => {
    await semear('GOATLAS-1', CHEFE, 'conv-fake')
    await semear('GN-7000', ANA, 'conv-real')

    const inv = await inventariar(db)
    const porChave = new Map(inv.vinculos.map((v) => [v.issueKey, v]))
    expect(porChave.get('GOATLAS-1')?.ehChaveDeFake).toBe(true)
    expect(porChave.get('GN-7000')?.ehChaveDeFake).toBe(false)
  })

  it('NÃO relata `auditoria` nem `config` — elas não entram na limpeza', () => {
    // `D-17`: a auditoria é append-only com piso de 180 dias, e é o único rastro que sobra
    // desta operação. Relatá-la aqui convidaria a apagá-la junto com o resto.
    expect(TABELAS_DE_USO).not.toContain('auditoria')
    expect(TABELAS_DE_USO).not.toContain('config')
  })
})

describe('descarte por chave de chamado', () => {
  it('leva o rastro inteiro daquele chamado — e não toca no do colega', async () => {
    await semear('GOATLAS-1', CHEFE, 'conv-fake')
    await semear('GN-7000', ANA, 'conv-real')

    const apagadas = await descartar(db, { issueKeys: ['GOATLAS-1'] })

    expect(apagadas.vinculos).toBe(1)
    expect(apagadas.notificacoes).toBe(1)
    // A conversa do chamado descartado vai junto: deixá-la faria a estatística de deflexão
    // contá-la como uma conversa que NÃO virou chamado — o oposto do que aconteceu.
    expect(apagadas.conversas).toBe(1)
    expect(apagadas.mensagens).toBe(1)
    expect(apagadas.bloqueios).toBe(1)

    const restantes = await db.query('SELECT issue_key FROM vinculos', [])
    expect(JSON.stringify(restantes)).toContain('GN-7000')
    expect(await contar('conversas')).toBe(1)
    expect(await contar('mensagens')).toBe(1)
  })

  it('a auditoria NÃO é apagada — nem quando tudo o mais é', async () => {
    await semear('GOATLAS-1', CHEFE, 'conv-fake')
    await ctx.auditoria.registrar({
      atorEmail: CHEFE,
      acao: 'chamado_criado',
      recurso: 'GOATLAS-1',
      resultado: 'sucesso',
    })
    const antes = await contar('auditoria')
    expect(antes).toBeGreaterThan(0)

    await descartar(db, { issueKeys: ['GOATLAS-1'], conversaIds: ['conv-fake'] })
    expect(await contar('auditoria')).toBe(antes)
  })
})

describe('descarte de busca e de override', () => {
  it('o termo casa NORMALIZADO e o override casa pelo carimbo exato', async () => {
    await ctx.conhecimento.registrarBusca({ solicitanteEmail: ANA, termo: 'SA', resultados: 3 })
    await ctx.conhecimento.registrarBusca({ solicitanteEmail: ANA, termo: 'deploy', resultados: 3 })
    await semear('GN-7001', ANA, 'conv-o')

    const apagadas = await descartar(db, { termos: ['sa'], overridesEm: [AGORA] })
    expect(apagadas.buscas).toBe(1)
    expect(apagadas.bloqueios).toBe(1)
    expect(await contar('buscas')).toBe(1)
    // O vínculo continua: apagar o override não é apagar o chamado.
    expect(await contar('vinculos')).toBe(1)
  })
})

describe('BURLA — a rota', () => {
  const req = (metodo: 'GET' | 'POST', email: string | null, corpo?: unknown) => {
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (email) headers[HEADER_EMAIL] = email
    return tratarRequisicao(
      new Request(
        'https://atlas.devgogroup.com/api/admin/limpeza',
        metodo === 'POST'
          ? { method: metodo, headers, body: JSON.stringify(corpo ?? {}) }
          : { method: metodo, headers },
      ),
      ctx,
      {},
    )
  }

  it('colaborador não inventaria e não apaga', async () => {
    await semear('GOATLAS-1', CHEFE, 'conv-fake')
    expect((await req('GET', ANA)).status).toBe(403)
    expect((await req('POST', ANA, { issueKeys: ['GOATLAS-1'] })).status).toBe(403)
    expect(await contar('vinculos')).toBe(1)
  })

  it('admin com lista VAZIA é recusado — nunca "apaga tudo"', async () => {
    await semear('GOATLAS-1', CHEFE, 'conv-fake')
    const r = await req('POST', CHEFE, {})
    expect(r.status).toBe(400)
    expect(await contar('vinculos')).toBe(1)
  })

  it('admin com lista apaga, e o que fez fica na auditoria', async () => {
    await semear('GOATLAS-1', CHEFE, 'conv-fake')
    const r = await req('POST', CHEFE, { issueKeys: ['GOATLAS-1'] })
    expect(r.status).toBe(200)
    expect(await contar('vinculos')).toBe(0)

    const aud = await db.query(
      "SELECT acao FROM auditoria WHERE acao = 'limpeza_executada'",
      [],
    )
    expect(JSON.stringify(aud)).toContain('limpeza_executada')
  })
})
