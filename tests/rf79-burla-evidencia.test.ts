/**
 * `ScB-01` (spec 010) — a trava é do SERVIDOR, e recusa antes de qualquer efeito.
 *
 * ## O caso que originou isto
 *
 * 17/08/2026: uma pessoa confirmou a abertura **três vezes** e leu três vezes *"não
 * conseguimos abrir o chamado"*. O assunto era o `134`, que exige anexo; ela declarou não
 * ter nenhum; o app entregou a criação mesmo assim; o Jira respondeu **400**, que este
 * projeto classifica como definitivo (`RNF-17`) — submissão em `falha`, nunca reprocessada.
 * O relato inteiro dela morreu ali.
 *
 * O que estes casos afirmam:
 *
 * 1. Sem arquivo, a criação é **recusada aqui** — e a Atlassian não é chamada.
 * 2. Com arquivo, passa (o contraste é o que prova que a trava não é uma parede).
 * 3. Quem chama a rota direto, sem nunca ter visto a tela, bate na mesma trava.
 *
 * _Requirements: RF-79, RN-14, RNF-17, RNF-18_
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { SqliteLocal } from '@/lib/db/sqlite-local'
import { migrar } from '@/lib/db/schema'
import { Config } from '@/lib/config'
import { montarContexto, type Contexto } from '@/lib/contexto'
import { tratarRequisicao } from '@/lib/http/rotas'
import { HEADER_EMAIL } from '@/lib/auth'
import { ClienteAtlassianFake } from '@/lib/atlassian/fake'
import { linhasComoObjetos } from '@/lib/db/tipos'

const ANA = 'ana@gocase.com'
const CHEFE = 'chefe@gocase.com'
const AGORA = '2026-08-17T12:00:00.000Z'

/** O campo de anexo do tipo `134` do `GN`, com o rótulo que o Jira devolve de verdade. */
const ANEXO_OBRIGATORIO = {
  fieldId: 'attachment',
  rotulo: 'Por favor, evidencie o problema',
  obrigatorio: true,
  tipo: 'anexo' as const,
  opcoes: [],
}
const ANEXO_OPCIONAL = { ...ANEXO_OBRIGATORIO, obrigatorio: false }

let db: SqliteLocal
let ctx: Contexto
let fake: ClienteAtlassianFake
let n = 0

beforeEach(async () => {
  db = new SqliteLocal()
  await migrar(db)
  n = 0
  const config = new Config(db)
  await config.definir('dominios_permitidos', ['gocase.com'], CHEFE, AGORA)
  await config.definir('tipos_chamado_permitidos', ['rt-1'], CHEFE, AGORA)
  await config.definir('service_desk_id', 'sd-1', CHEFE, AGORA)
  ctx = await montarContexto({ DB: db, ATLAS_USAR_FAKES: '1' }, () => AGORA, () => `id-${++n}`)
  fake = ctx.atlassian as ClienteAtlassianFake
  fake.estado.tiposChamado = [
    { id: 'rt-1', serviceDeskId: 'sd-1', nome: 'Relatar um problema (Sistema)', descricao: null },
  ]
  fake.estado.camposPorTipo.set('rt-1', [ANEXO_OBRIGATORIO])
})

const chamar = (r: Request) => tratarRequisicao(r, ctx, {})

function req(caminho: string, corpo?: unknown, metodo = 'POST', quem = ANA): Request {
  return new Request(`https://atlas.devgogroup.com${caminho}`, {
    method: metodo,
    headers: { [HEADER_EMAIL]: quem },
    ...(corpo === undefined ? {} : { body: JSON.stringify(corpo) }),
  })
}

async function conversaPronta(): Promise<string> {
  const c = await ctx.conversas.criar(ctx.novoId(), ANA)
  await ctx.conversas.marcarConfluenceVerificado(c.id, false)
  await ctx.conversas.marcarHistoricoVerificado(c.id, false)
  await ctx.conversas.definirProposta(c.id, {
    titulo: 'Falha intermitente ao salvar material no Factory',
    descricao: 'A alteração às vezes não reflete no site.',
    tipoChamadoId: 'rt-1',
    prioridade: 'alta',
    area: null,
    componente: null,
  })
  await ctx.conversas.definirEstado(c.id, 'aguardando_confirmacao')
  return c.id
}

async function colarPrint(conversaId: string, nome = 'print.png') {
  const form = new FormData()
  form.set('arquivo', new File([new Uint8Array([1, 2, 3])], nome, { type: 'image/png' }))
  form.set('conversaId', conversaId)
  const r = await chamar(
    new Request('https://atlas.devgogroup.com/api/anexos-pendentes', {
      method: 'POST',
      headers: { [HEADER_EMAIL]: ANA },
      body: form,
    }),
  )
  expect(r.status).toBe(201)
}

describe('ScB-01 — assunto que exige arquivo não abre sem arquivo', () => {
  it('🚨 recusa ANTES de qualquer efeito: nenhum chamado nasce', async () => {
    const id = await conversaPronta()
    const antes = fake.estado.chamados.size

    const r = await chamar(req(`/api/conversas/${id}/confirmar`, { declarouAnexo: false }))

    expect(r.status).toBe(400)
    const corpo = await r.json()
    // A mensagem nomeia o campo pelo RÓTULO, em português (`RNF-30`).
    expect(corpo.erro).toContain('Por favor, evidencie o problema')
    expect(corpo.erro).not.toContain('attachment')
    // ⚠️ A prova que importa: a Atlassian não foi chamada.
    expect(fake.estado.chamados.size).toBe(antes)
  })

  it('🚨 declarar que TEM não substitui ter — quem decide é o arquivo', async () => {
    const id = await conversaPronta()
    const r = await chamar(req(`/api/conversas/${id}/confirmar`, { declarouAnexo: true }))
    expect(r.status).toBe(400)
    expect(fake.estado.chamados.size).toBe(0)
  })

  it('o CONTRASTE: com um arquivo colado, o chamado abre', async () => {
    const id = await conversaPronta()
    await colarPrint(id)

    const r = await chamar(req(`/api/conversas/${id}/confirmar`, {}))
    expect(r.status).toBe(201)
    const corpo = await r.json()
    expect(corpo.issueKey).toBeTruthy()
    // O arquivo entrou junto com o chamado, e a resposta diz isso.
    expect(corpo.anexo.estado).toBe('anexado')
    expect(corpo.anexo.anexados).toEqual(['print.png'])
  })

  it('⚠️ anexo OPCIONAL não é travado — os 9 assuntos que já funcionavam', async () => {
    fake.estado.camposPorTipo.set('rt-1', [ANEXO_OPCIONAL])
    const id = await conversaPronta()

    const r = await chamar(req(`/api/conversas/${id}/confirmar`, { declarouAnexo: false }))
    expect(r.status).toBe(201)
  })

  it('⚠️ schema indisponível NÃO inventa a trava (`D-27`, fail-open)', async () => {
    fake.estado.camposPorTipo.delete('rt-1')
    fake.estado.falhas.obterCamposDoTipo = 'indisponivel'
    const id = await conversaPronta()

    const r = await chamar(req(`/api/conversas/${id}/confirmar`, {}))
    expect(r.status).toBe(201)
  })

  it('a recusa fica auditada, com o tipo — é o sinal de roteamento ruim', async () => {
    const id = await conversaPronta()
    await chamar(req(`/api/conversas/${id}/confirmar`, { declarouAnexo: false }))

    const linhas = linhasComoObjetos<{ recurso: string; resultado: string }>(
      await db.query(
        `SELECT recurso, resultado FROM auditoria WHERE acao = 'anexo_obrigatorio_ausente'`,
        [],
      ),
    )
    expect(linhas).toEqual([{ recurso: 'rt-1', resultado: 'negado' }])
  })
})

describe('a tela precisa SABER que o assunto exige — `GET /api/tipos-chamado/:id/campos`', () => {
  it('🚨 devolve `anexoObrigatorio`, porque o campo de anexo é filtrado da lista', async () => {
    const r = await chamar(req('/api/tipos-chamado/rt-1/campos', undefined, 'GET'))
    expect(r.status).toBe(200)
    const corpo = await r.json()
    // O campo some da lista de propósito (`T-406c`) — e é por isso que a tela não tem como
    // descobrir a exigência sozinha. Medido no navegador em 17/08/2026: sem esta flag, o
    // botão nunca travava e a pessoa só descobria no 400.
    expect(corpo.itens.some((c: { tipo: string }) => c.tipo === 'anexo')).toBe(false)
    expect(corpo.aceitaAnexo).toBe(true)
    expect(corpo.anexoObrigatorio).toBe(true)
  })

  it('anexo opcional devolve `anexoObrigatorio: false`', async () => {
    ;(ctx.atlassian as ClienteAtlassianFake).estado.camposPorTipo.set('rt-1', [ANEXO_OPCIONAL])
    const corpo = await (await chamar(req('/api/tipos-chamado/rt-1/campos', undefined, 'GET'))).json()
    expect(corpo.aceitaAnexo).toBe(true)
    expect(corpo.anexoObrigatorio).toBe(false)
  })
})

describe('ScB-01 — o formulário direto tem a MESMA trava', () => {
  it('🚨 recusa sem arquivo, e nada é criado', async () => {
    const antes = fake.estado.chamados.size
    const r = await chamar(
      req('/api/chamados', {
        titulo: 'Falha ao salvar material',
        descricao: 'Não reflete no site.',
        tipoChamadoId: 'rt-1',
        prioridade: 'alta',
        chaveIdempotencia: 'chave-1',
        declarouAnexo: false,
      }),
    )
    expect(r.status).toBe(400)
    expect((await r.json()).erro).toContain('Por favor, evidencie o problema')
    expect(fake.estado.chamados.size).toBe(antes)
  })
})

describe('a frase de pendência não repete a mesma coisa duas vezes', () => {
  it('🚨 a exigência ABSORVE a pergunta de `RN-11`', async () => {
    const { pendenciasParaAbrir, mensagemDePendencias } = await import('@/app/pendencias')
    const p = pendenciasParaAbrir({
      campos: [],
      valores: {},
      faltaDeclararAnexo: true,
      anexoExigido: true,
      anexosEnviados: 0,
    })
    expect(p.declaracaoDeAnexo).toBe(false)
    const frase = mensagemDePendencias(p)
    // Medido na tela em 17/08/2026: saía "…anexar pelo menos um arquivo (este assunto
    // exige) E responder se você tem algo para anexar" — a segunda metade oferecendo uma
    // saída ("não tenho") que ali não abre chamado nenhum.
    expect(frase).toContain('anexar pelo menos um arquivo')
    expect(frase).not.toContain('responder se você tem algo')
  })

  it('🚨 com o arquivo JÁ anexado, a pergunta NÃO volta', async () => {
    const { pendenciasParaAbrir, faltaAlgumaCoisa } = await import('@/app/pendencias')
    const p = pendenciasParaAbrir({
      campos: [],
      valores: {},
      faltaDeclararAnexo: true,
      anexoExigido: true,
      anexosEnviados: 1,
    })
    // Medido na tela em 17/08/2026: anexar desligava a absorção e "Falta responder se você
    // tem algo para anexar" reaparecia logo abaixo do arquivo enviado, travando o botão.
    expect(p.evidenciaObrigatoria).toBe(false)
    expect(p.declaracaoDeAnexo).toBe(false)
    expect(faltaAlgumaCoisa(p)).toBe(false)
  })

  it('sem exigência, a pergunta de `RN-11` continua igual', async () => {
    const { pendenciasParaAbrir, mensagemDePendencias } = await import('@/app/pendencias')
    const p = pendenciasParaAbrir({ campos: [], valores: {}, faltaDeclararAnexo: true })
    expect(mensagemDePendencias(p)).toContain('responder se você tem algo para anexar')
  })
})
