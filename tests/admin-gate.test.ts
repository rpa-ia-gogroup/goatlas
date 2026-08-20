/**
 * T-104 — teste de burla do gate de admin em TODAS as rotas de governança.
 *
 * Não é preciosismo repetir o que `tests/rotas.test.ts` já cobre para
 * `/api/admin/config` e `/api/admin/auditoria`: este arquivo existe para que TODA
 * rota nova sob `/api/admin/*` passe pelo MESMO checklist, de uma vez, em vez de
 * confiar em alguém lembrar de escrever o bypass rota por rota — é exatamente o
 * ponto de `RN-09` (perfil admin só por lista explícita) e `RNF-04` (a governança é
 * a credencial de maior privilégio do sistema).
 *
 * _Requirements: RN-09, RNF-04_
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { SqliteLocal } from '@/lib/db/sqlite-local'
import { migrar } from '@/lib/db/schema'
import { Config } from '@/lib/config'
import { montarContexto, type Contexto } from '@/lib/contexto'
import { tratarRequisicao } from '@/lib/http/rotas'
import { HEADER_EMAIL } from '@/lib/auth'

const ANA = 'ana@gocase.com'
const CHEFE = 'chefe@gocase.com'
const AGORA = '2026-08-05T12:00:00.000Z'

let db: SqliteLocal
let ctx: Contexto
let n = 0

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

function req(caminho: string, email: string | null): Request {
  const headers: Record<string, string> = {}
  if (email) headers[HEADER_EMAIL] = email
  return new Request(`https://atlas.devgogroup.com${caminho}`, { headers })
}

const chamar = (r: Request) => tratarRequisicao(r, ctx, {})

/** Toda rota GET de admin que expõe dado de governança ou configuração. */
const ROTAS_ADMIN = [
  '/api/admin/config',
  '/api/admin/lacunas',
  '/api/admin/metricas',
  '/api/admin/auditoria',
  '/api/admin/assentos',
  '/api/admin/assentos/recomendacoes',
  '/api/admin/assentos/recomendacoes?formato=csv',
  // Diagnóstico do schema do request type: metadado de formulário, mas de toda a
  // instalação — e a rota varre a allowlist inteira. Entra no mesmo checklist.
  '/api/admin/tipos-chamado/schema',
] as const

describe.each(ROTAS_ADMIN)('BURLA — %s', (rota) => {
  it('sem identidade nenhuma: 403', async () => {
    const r = await chamar(req(rota, null))
    expect(r.status).toBe(403)
  })

  it('colaborador (fora da lista de admins): 403', async () => {
    const r = await chamar(req(rota, ANA))
    expect(r.status).toBe(403)
  })

  it('admin de verdade: NÃO é 403', async () => {
    const r = await chamar(req(rota, CHEFE))
    expect(r.status).not.toBe(403)
  })
})

describe('RNF-30 — a recusa não vaza detalhe de infraestrutura', () => {
  it('o corpo do 403 é a mesma mensagem de negação de sempre', async () => {
    for (const rota of ROTAS_ADMIN) {
      const r = await chamar(req(rota, ANA))
      const corpo = await r.json()
      expect(corpo.codigo).toBe('sem_permissao')
      expect(JSON.stringify(corpo)).not.toMatch(/\bstack\b|Error:/)
    }
  })
})

/**
 * `D-78` — o descarte de termo do mapa de lacunas (`RF-42`).
 *
 * É a única rota de admin que **apaga** dado, então tem dois deveres além do gate: casar por
 * `termo_normalizado` (a chave pela qual o mapa agrupa, não o termo cru) e não fingir sucesso
 * quando não havia nada para apagar.
 *
 * _Requirements: RF-42, RN-09_
 */
describe('D-78 — descartar termo do mapa de lacunas', () => {
  const postar = (email: string | null, corpo: unknown) => {
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (email) headers[HEADER_EMAIL] = email
    return tratarRequisicao(
      new Request('https://atlas.devgogroup.com/api/admin/lacunas/descartar', {
        method: 'POST',
        headers,
        body: JSON.stringify(corpo),
      }),
      ctx,
      {},
    )
  }

  it('colaborador não descarta: 403 — e o dado continua no mapa', async () => {
    await ctx.conhecimento.registrarBusca({ solicitanteEmail: ANA, termo: 'tehc', resultados: 0 })
    const r = await postar(ANA, { termo: 'tehc' })
    expect(r.status).toBe(403)
    const mapa = await ctx.conhecimento.agregarLacunas_apenasAdmin()
    expect(mapa.semResultado.map((t) => t.termo)).toContain('tehc')
  })

  it('admin descarta, e o termo sai do mapa — as OUTRAS buscas ficam', async () => {
    // Duas variações de caixa do mesmo termo: o mapa as agrupa numa linha só, então o
    // descarte tem de levar as duas. Casar pelo `termo` cru deixaria uma para trás.
    await ctx.conhecimento.registrarBusca({ solicitanteEmail: ANA, termo: 'AP', resultados: 0 })
    await ctx.conhecimento.registrarBusca({ solicitanteEmail: CHEFE, termo: 'ap', resultados: 0 })
    await ctx.conhecimento.registrarBusca({ solicitanteEmail: ANA, termo: 'deploy', resultados: 0 })

    const r = await postar(CHEFE, { termo: 'ap' })
    expect(r.status).toBe(200)
    expect(await r.json()).toMatchObject({ ok: true, termo: 'ap', buscasApagadas: 2 })

    const termos = (await ctx.conhecimento.agregarLacunas_apenasAdmin()).semResultado.map(
      (t) => t.termo,
    )
    expect(termos).not.toContain('ap')
    expect(termos).toContain('deploy')
  })

  it('termo que não existe NÃO é relatado como descarte feito', async () => {
    // "Apaguei 0" e "apaguei" são frases diferentes: a primeira diz que o termo já não
    // estava lá, e a auditoria registra `falha` para quem for procurar depois por que a
    // lista não mudou.
    const r = await postar(CHEFE, { termo: 'termo-que-ninguem-buscou' })
    expect(r.status).toBe(200)
    expect(await r.json()).toMatchObject({ buscasApagadas: 0 })
  })

  it('termo vazio é recusado antes de qualquer efeito', async () => {
    const r = await postar(CHEFE, { termo: '   ' })
    expect(r.status).toBe(400)
  })
})
