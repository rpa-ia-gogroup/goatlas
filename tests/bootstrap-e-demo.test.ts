/**
 * Bootstrap por env e modo demonstração — o cenário do **primeiro boot**.
 *
 * Isto existe porque o app é fail-closed: toda allowlist nasce vazia e vazio
 * significa negar (`RNF-07`). Sem bootstrap, um app recém-deployado nega **todo
 * mundo**, inclusive quem precisaria entrar para configurá-lo. O teste garante as
 * duas metades: que o bootstrap abre a porta certa, e que ele **não** afrouxa o
 * fail-closed.
 *
 * _Requirements: RF-01, RF-02, RF-49, RN-09, RNF-07, RNF-19, D-04_
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { SqliteLocal } from '@/lib/db/sqlite-local'
import { migrar } from '@/lib/db/schema'
import { Config, valoresDoBootstrap } from '@/lib/config'
import { montarContexto } from '@/lib/contexto'
import { tratarRequisicao } from '@/lib/http/rotas'
import { HEADER_EMAIL } from '@/lib/auth'
import { AVISO_DEMO, TIPO_CHAMADO_DEMO } from '@/lib/demo'
import { ClienteAtlassianHttp } from '@/lib/atlassian/cliente'

const ANA = 'ana@gocase.com'
const CHEFE = 'kaique.breno@gocase.com'

let db: SqliteLocal

const ENV_DEMO = {
  GOATLAS_MODO_DEMO: '1',
  GOATLAS_DOMINIOS: 'gocase.com',
  GOATLAS_ADMINS: CHEFE,
} as const

beforeEach(async () => {
  db = new SqliteLocal()
  await migrar(db)
})

/** Monta o contexto a CADA chamada, como o Worker faz. */
async function chamar(
  caminho: string,
  opcoes: { metodo?: string; email?: string; corpo?: unknown; env?: Record<string, string> } = {},
) {
  const ctx = await montarContexto({ DB: db, ...ENV_DEMO, ...opcoes.env })
  const r = await tratarRequisicao(
    new Request(`https://goatlas.devgogroup.com${caminho}`, {
      method: opcoes.metodo ?? 'GET',
      headers: { [HEADER_EMAIL]: opcoes.email ?? ANA },
      ...(opcoes.corpo === undefined ? {} : { body: JSON.stringify(opcoes.corpo) }),
    }),
    ctx,
    {},
  )
  return { status: r.status, corpo: (await r.json().catch(() => null)) as never }
}

describe('bootstrap por env', () => {
  it('sem env e sem banco, o app continua FECHADO', async () => {
    // A metade que importa mais: o bootstrap dá um caminho de entrada, não uma
    // porta aberta. Sem nada configurado, ninguém entra.
    const ctx = await montarContexto({ DB: db })
    const r = await tratarRequisicao(
      new Request('https://x/api/auth/me', { headers: { [HEADER_EMAIL]: ANA } }),
      ctx,
      {},
    )
    expect(r.status).toBe(403)
  })

  it('com env, o colaborador entra e o admin é reconhecido', async () => {
    const colaborador = await chamar('/api/auth/me')
    expect(colaborador.status).toBe(200)
    expect(colaborador.corpo).toMatchObject({ email: ANA, isAdmin: false })

    const admin = await chamar('/api/auth/me', { email: CHEFE })
    expect(admin.corpo).toMatchObject({ email: CHEFE, isAdmin: true })
  })

  it('domínio fora da lista continua negado', async () => {
    expect((await chamar('/api/auth/me', { email: 'alguem@gmail.com' })).status).toBe(403)
  })

  it('o BANCO vence o env — é o que faz RF-49 (mudar sem deploy) valer', async () => {
    const config = new Config(db)
    await config.definir('admins', [ANA], CHEFE, '2026-08-04T00:00:00.000Z')

    // O env ainda diz que o admin é o CHEFE, mas o banco já disse outra coisa.
    expect((await chamar('/api/auth/me')).corpo).toMatchObject({ isAdmin: true })
    expect((await chamar('/api/auth/me', { email: CHEFE })).corpo).toMatchObject({
      isAdmin: false,
    })
  })

  it('lista do env é normalizada: espaços, maiúsculas e vazios', () => {
    expect(
      valoresDoBootstrap({ GOATLAS_DOMINIOS: ' GoCase.com , ,gobeaute.com.br ' }),
    ).toEqual({ dominios_permitidos: ['gocase.com', 'gobeaute.com.br'] })
  })

  it('env vazio não sobrescreve o padrão com lista vazia', () => {
    expect(valoresDoBootstrap({ GOATLAS_DOMINIOS: '', GOATLAS_ADMINS: '  ' })).toEqual({})
  })
})

describe('modo demonstração', () => {
  it('a identidade carrega `modoDemo` — a UI precisa avisar de forma permanente', async () => {
    expect((await chamar('/api/auth/me')).corpo).toMatchObject({ modoDemo: true })
    const semDemo = await chamar('/api/auth/me', { env: { GOATLAS_MODO_DEMO: '0' } })
    expect(semDemo.corpo).toMatchObject({ modoDemo: false })
  })

  it('o health também expõe o modo', async () => {
    const r = await chamar('/api/health')
    expect(r.corpo).toMatchObject({ modoDemo: true, usandoFakes: true })
  })

  it('a demo semeia o mínimo para o app ser clicável', async () => {
    const tipos = await chamar('/api/tipos-chamado')
    expect((tipos.corpo as { itens: { id: string }[] }).itens.map((t) => t.id)).toEqual([
      TIPO_CHAMADO_DEMO,
    ])
  })

  it('a demo NÃO decide quem entra — domínio e admin vêm sempre do env/banco', async () => {
    // Se `configDemo()` pudesse mexer em `dominios_permitidos`, publicar em demo
    // abriria o app para qualquer conta Google. Ela não mexe.
    const r = await chamar('/api/auth/me', {
      email: 'estranho@outraempresa.com',
      env: { GOATLAS_DOMINIOS: 'gocase.com' },
    })
    expect(r.status).toBe(403)
  })

  it('os exemplos da Regra 2 na demo são explicitamente FICTÍCIOS', async () => {
    // Q3 pede exemplos reais da Gocase. Os da demo são rotulados para que ninguém
    // os copie para produção pensando que servem.
    const r = await chamar('/api/admin/config', { email: CHEFE })
    const exemplos = (r.corpo as { config: { regra2_exemplos_ajuste_operacional: string[] } })
      .config.regra2_exemplos_ajuste_operacional
    expect(exemplos.length).toBeGreaterThan(0)
    expect(exemplos.every((e) => e.includes('FICTÍCIO'))).toBe(true)
  })

  it('o aviso existe e diz o que precisa dizer', () => {
    expect(AVISO_DEMO).toMatch(/fict/i)
    expect(AVISO_DEMO).toMatch(/não chegam ao time de tech/i)
  })

  it('fluxo completo na demo: deflexão → override → proposta → chamado', async () => {
    const { corpo: conversa } = await chamar('/api/conversas', { metodo: 'POST' })
    const id = (conversa as { id: string }).id

    const turno = await chamar(`/api/conversas/${id}/mensagens`, {
      metodo: 'POST',
      corpo: { texto: 'o relatório de vendas não atualizou' },
    })
    expect(turno.corpo).toMatchObject({ bloqueado: true, regraBloqueio: 'regra1_confluence' })

    const override = await chamar(`/api/conversas/${id}/override`, {
      metodo: 'POST',
      corpo: { motivo: 'meu caso é o painel novo' },
    })
    expect((override.corpo as { proposta: { titulo: string } }).proposta.titulo).toBeTruthy()

    const criado = await chamar(`/api/conversas/${id}/confirmar`, { metodo: 'POST' })
    expect(criado.corpo).toMatchObject({ estado: 'criado', verificadoRegras: true })
  })
})

describe('RF-21 / Q4 — campo_solicitante_id é CONFIG, nunca hardcoded', () => {
  it('sem config, o cliente real nasce sem o campo (só a descrição identifica)', async () => {
    const ctx = await montarContexto({
      DB: db,
      ATLASSIAN_API_TOKEN: 'token',
      ATLASSIAN_EMAIL: 'servico@gocase.com',
      ATLASSIAN_BASE_URL: 'https://goengenharia.atlassian.net',
    })
    const cliente = ctx.atlassian as ClienteAtlassianHttp
    const { camposExtra } = cliente.montarCamposSolicitante({
      serviceDeskId: 'sd-1',
      tipoChamadoId: 'rt-1',
      titulo: 't',
      descricao: 'd',
      prioridade: 'normal',
      solicitanteEmail: 'ana@gocase.com',
      chaveIdempotencia: 'k1',
    })
    expect(Object.keys(camposExtra)).toHaveLength(0)
  })

  it('com o valor salvo no banco (RF-49, sem deploy), o cliente real passa a usar o campo', async () => {
    const config = new Config(db)
    await config.definir('campo_solicitante_id', 'customfield_10050', 'chefe@gocase.com', '2026-08-05T00:00:00.000Z')
    const ctx = await montarContexto({
      DB: db,
      ATLASSIAN_API_TOKEN: 'token',
      ATLASSIAN_EMAIL: 'servico@gocase.com',
      ATLASSIAN_BASE_URL: 'https://goengenharia.atlassian.net',
    })
    const cliente = ctx.atlassian as ClienteAtlassianHttp
    const { camposExtra } = cliente.montarCamposSolicitante({
      serviceDeskId: 'sd-1',
      tipoChamadoId: 'rt-1',
      titulo: 't',
      descricao: 'd',
      prioridade: 'normal',
      solicitanteEmail: 'ana@gocase.com',
      chaveIdempotencia: 'k1',
    })
    expect(camposExtra.customfield_10050).toBe('ana@gocase.com')
  })
})

describe('RNF-19 — Atlassian fora, a lista ainda mostra conteúdo', () => {
  it('título e prioridade vêm do NOSSO registro quando o chamado não é legível', async () => {
    // No Worker o fake é recriado a cada requisição, então o chamado criado numa
    // requisição não é legível na seguinte — o mesmo efeito de a Atlassian estar
    // fora. Antes isso mostrava "título indisponível"; agora usa o outbox.
    const criado = await chamar('/api/chamados', {
      metodo: 'POST',
      corpo: {
        titulo: 'Etiquetas saindo cortadas',
        descricao: 'O código de barras sai cortado na impressão.',
        tipoChamadoId: TIPO_CHAMADO_DEMO,
        prioridade: 'alta',
        chaveIdempotencia: 'k1',
      },
    })
    expect(criado.status).toBe(201)

    const meus = await chamar('/api/chamados')
    const itens = (meus.corpo as { itens: { titulo: string; status: string; prioridade: string }[] })
      .itens
    expect(itens).toHaveLength(1)
    expect(itens[0]?.titulo).toBe('Etiquetas saindo cortadas')
    expect(itens[0]?.prioridade).toBe('alta')
    // O status é honestamente marcado como indisponível — o que não sabemos, não
    // inventamos.
    expect(itens[0]?.status).toBe('indisponivel')
  })
})

