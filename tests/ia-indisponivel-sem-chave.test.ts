/**
 * Chave de IA ausente com o resto configurado — o fail-open que estava a um
 * secret de distância.
 *
 * `montarContexto` caía em `ClienteIAFake` sempre que `LLM_API_KEY` faltava,
 * **inclusive fora dos fakes**. Com o token da Atlassian configurado e o modo
 * demonstração removido, isso produzia a pior combinação do app: agente
 * respondendo roteiro de demonstração e chamado indo para o JSM de verdade.
 *
 * O teste fixa as duas metades: o fake **não** é alcançável fora de
 * `usandoFakes`, e a ausência de chave degrada de forma honesta (health denuncia,
 * agente recusa) em vez de simular um modelo.
 *
 * _Requirements: RNF-18, RNF-25, D-04, D-05_
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { SqliteLocal } from '@/lib/db/sqlite-local'
import { migrar } from '@/lib/db/schema'
import { montarContexto } from '@/lib/contexto'
import { tratarRequisicao } from '@/lib/http/rotas'
import { HEADER_EMAIL } from '@/lib/auth'
import { ClienteIAFake } from '@/lib/ia/fake'
import { ClienteIAHttp } from '@/lib/ia/cliente'
import { ClienteIAIndisponivel } from '@/lib/ia/indisponivel'
import { ClienteAtlassianFake } from '@/lib/atlassian/fake'

const ANA = 'ana@gocase.com'

let db: SqliteLocal

/**
 * O estado real do app no GoDeploy em 05/08/2026 **menos** o modo demo: trio da
 * Atlassian completo, chave de IA ausente.
 */
const ENV_ATLASSIAN_REAL = {
  ATLAS_DOMINIOS: 'gocase.com',
  ATLASSIAN_API_TOKEN: 'token-de-servico',
  ATLASSIAN_EMAIL: 'servico@gocase.com',
  ATLASSIAN_BASE_URL: 'https://goengenharia.atlassian.net',
} as const

beforeEach(async () => {
  db = new SqliteLocal()
  await migrar(db)
})

/**
 * Reaproveita um fake de Atlassian só para **não sair na rede**: `usandoFakes`
 * continua sendo calculado do env, então é o caminho real de escolha da IA que
 * está sob teste.
 */
function contexto(env: Record<string, string> = {}) {
  return montarContexto({ DB: db, ...ENV_ATLASSIAN_REAL, ...env }, undefined, undefined, {
    atlassian: new ClienteAtlassianFake(),
  })
}

describe('escolha do cliente de IA', () => {
  it('Atlassian real + sem chave de IA → indisponível, NUNCA o fake', async () => {
    const ctx = await contexto()
    expect(ctx.usandoFakes).toBe(false)
    expect(ctx.ia).toBeInstanceOf(ClienteIAIndisponivel)
    // A metade que importa: o dublê de demonstração não é alcançável aqui.
    expect(ctx.ia).not.toBeInstanceOf(ClienteIAFake)
  })

  it('com chave, o cliente real é instanciado', async () => {
    const ctx = await contexto({ LLM_API_KEY: 'chave', LLM_BASE_URL: 'https://ia.exemplo' })
    expect(ctx.ia).toBeInstanceOf(ClienteIAHttp)
  })

  it('modo demonstração continua usando o fake — sem regressão', async () => {
    const ctx = await contexto({ ATLAS_MODO_DEMO: '1' })
    expect(ctx.usandoFakes).toBe(true)
    expect(ctx.ia).toBeInstanceOf(ClienteIAFake)
  })

  it('sem token da Atlassian também segue no fake (dev sem credencial)', async () => {
    const ctx = await montarContexto({ DB: db, ATLAS_DOMINIOS: 'gocase.com' })
    expect(ctx.usandoFakes).toBe(true)
    expect(ctx.ia).toBeInstanceOf(ClienteIAFake)
  })
})

describe('degradação honesta', () => {
  async function chamar(caminho: string, metodo = 'GET', corpo?: unknown) {
    const ctx = await contexto()
    const r = await tratarRequisicao(
      new Request(`https://atlas.devgogroup.com${caminho}`, {
        method: metodo,
        headers: { [HEADER_EMAIL]: ANA },
        ...(corpo === undefined ? {} : { body: JSON.stringify(corpo) }),
      }),
      ctx,
      {},
    )
    return { status: r.status, corpo: (await r.json().catch(() => null)) as never }
  }

  it('o health denuncia a chave ausente — RF-59', async () => {
    // Sem isto, subir sem a chave parecia saudável: o app respondia roteiro de
    // demonstração e o health dizia `ok`.
    const r = await chamar('/api/health')
    expect(r.status).toBe(503)
    expect(r.corpo).toMatchObject({
      ok: false,
      usandoFakes: false,
      dependencias: { ia: { ok: false } },
    })
  })

  it('o agente RECUSA em vez de responder roteiro de demonstração', async () => {
    const { corpo: conversa, status } = await chamar('/api/conversas', 'POST')
    expect(status).toBe(201)
    const id = (conversa as { id: string }).id

    const turno = await chamar(`/api/conversas/${id}/mensagens`, 'POST', {
      texto: 'o relatório de vendas não atualizou',
    })
    // Falha visível, fail-closed. O caminho do agente morre; o formulário mínimo
    // (D-04) não passa por aqui e segue abrindo chamado (RNF-18).
    expect(turno.status).toBe(500)
    expect(JSON.stringify(turno.corpo ?? '')).not.toMatch(/relatório de vendas/i)
  })

  it('as operações de IA falham como DEFINITIVAS — repetir não resolve', async () => {
    const ia = new ClienteIAIndisponivel()
    for (const chamada of [
      () => ia.chat({ mensagens: [], toolsPermitidas: [] }),
      () =>
        ia.classificarResolucao({
          comentariosResolucao: [],
          tituloTicket: 't',
          exemplosAjusteOperacional: ['x'],
        }),
      () => ia.extrairProposta({ mensagens: [], tiposPermitidos: [] }),
    ]) {
      await expect(chamada()).rejects.toMatchObject({
        name: 'ErroIA',
        detalhe: { transitorio: false },
      })
    }
  })

  it('a mensagem de erro não carrega valor de credencial nenhum', async () => {
    const ia = new ClienteIAIndisponivel()
    let mensagem = ''
    try {
      await ia.chat({ mensagens: [], toolsPermitidas: [] })
    } catch (e) {
      mensagem = (e as Error).message
    }
    // Nome de variável de ambiente não é segredo — ele diz o que configurar. O
    // VALOR seria (RNF-01), e nenhum dos que estão no env aparece.
    expect(mensagem).toContain('LLM_API_KEY')
    for (const valor of Object.values(ENV_ATLASSIAN_REAL)) {
      expect(mensagem).not.toContain(valor)
    }
  })
})
