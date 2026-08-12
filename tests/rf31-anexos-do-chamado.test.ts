/**
 * T-084 — a pessoa vê os anexos do próprio chamado (`RF-31`, `D-45`).
 *
 * O defeito medido na staging em 12/08/2026: `GN-6898` nasceu com um arquivo anexado
 * (`anexo.estado: "anexado"`, `RF-63` funcionando) e `GET /api/chamados/GN-6898` devolvia
 * `chamado, via, verificadoRegras, area, comentarios, degradado, comentariosIndisponiveis`
 * — **nenhum campo de anexo**. A pessoa mandava o print e nunca mais o via.
 *
 * O que estes testes trancam:
 *
 * - O anexo que a própria pessoa mandou **volta** na leitura, com link **deste app**
 *   (`RNF-02`) — o navegador nunca fala com a Atlassian.
 * - **[burla]** Anexo de comentário **interno** não aparece e não baixa (`RN-05`). O
 *   endpoint do JSM filtra pelo papel de quem pergunta ("customers will only get a list
 *   of public attachments") e sob `D-01` nunca somos o cliente: quem prova publicidade é
 *   o comentário público que carrega o anexo.
 * - **[burla]** Anexo de chamado de **outra pessoa** responde 404 (`RF-30`), nunca 403.
 * - **[burla]** Nome de arquivo inventado responde a **mesma** 404 (`D-12`).
 * - Queda da Atlassian vira "não conseguimos confirmar", **nunca** "não tem anexo"
 *   (`RNF-18`, `RNF-19`) — nas duas fontes, e também quando a expansão de anexo não vem.
 * - O `Content-Type` é **afirmado** pelo app, com `nosniff` e CSP `sandbox` (`D-11`).
 *
 * _Requirements: RF-31, RF-30, RF-32, RN-05, RNF-02, RNF-18, RNF-19_
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { SqliteLocal } from '@/lib/db/sqlite-local'
import { migrar } from '@/lib/db/schema'
import { Config } from '@/lib/config'
import { montarContexto, type Contexto } from '@/lib/contexto'
import { tratarRequisicao } from '@/lib/http/rotas'
import { HEADER_EMAIL } from '@/lib/auth'
import { ClienteAtlassianFake } from '@/lib/atlassian/fake'
import {
  anexosParaExibir,
  provaDePublicidade,
  urlDoAnexoNoApp,
} from '@/lib/tickets/anexos-do-chamado'
import type { AnexoDoChamado } from '@/lib/atlassian/tipos'

const ANA = 'ana@gocase.com'
const BRUNO = 'bruno@gocase.com'
const CHEFE = 'chefe@gocase.com'
const AGORA = '2026-08-12T12:00:00.000Z'

let db: SqliteLocal
let ctx: Contexto
let n = 0

beforeEach(async () => {
  db = new SqliteLocal()
  await migrar(db)
  n = 0
  const config = new Config(db)
  await config.definir('dominios_permitidos', ['gocase.com'], CHEFE, AGORA)
  await config.definir('tipos_chamado_permitidos', ['rt-1'], CHEFE, AGORA)
  await config.definir('service_desk_id', 'sd-1', CHEFE, AGORA)
  ctx = await montarContexto({ DB: db, GOATLAS_USAR_FAKES: '1' }, () => AGORA, () => `id-${++n}`)
})

function req(
  caminho: string,
  opcoes: { metodo?: string; email?: string; corpo?: unknown } = {},
): Request {
  const headers: Record<string, string> = {}
  if (opcoes.email) headers[HEADER_EMAIL] = opcoes.email
  return new Request(`https://goatlas.devgogroup.com${caminho}`, {
    method: opcoes.metodo ?? 'GET',
    headers,
    ...(opcoes.corpo === undefined ? {} : { body: JSON.stringify(opcoes.corpo) }),
  })
}

const chamar = (r: Request) => tratarRequisicao(r, ctx, {})

async function abrirChamado(email = ANA, chave = 'k-ana'): Promise<string> {
  const r = await chamar(
    req('/api/chamados', {
      metodo: 'POST',
      email,
      corpo: {
        titulo: 'A impressora do time parou',
        descricao: 'Some da lista de impressoras desde ontem.',
        tipoChamadoId: 'rt-1',
        prioridade: 'normal',
        chaveIdempotencia: chave,
        temAnexo: false,
      },
    }),
  )
  const corpo = (await r.json()) as { issueKey?: string }
  return corpo.issueKey!
}

/** Anexa pelo caminho do produto (`RF-34`) — é ele que produz o estado real. */
async function anexar(issueKey: string, nome: string, email = ANA): Promise<void> {
  const form = new FormData()
  form.append('arquivo', new File([new Uint8Array([1, 2, 3, 4])], nome, { type: 'image/png' }))
  const r = await tratarRequisicao(
    new Request(`https://goatlas.devgogroup.com/api/chamados/${issueKey}/anexos`, {
      method: 'POST',
      headers: { [HEADER_EMAIL]: email },
      body: form,
    }),
    ctx,
    {},
  )
  expect(r.status).toBe(201)
}

interface DetalheNaTela {
  readonly anexos: readonly { nomeArquivo: string; url: string; tamanhoBytes: number | null }[]
  readonly anexosIndisponiveis: boolean
  readonly comentariosIndisponiveis: boolean
}

async function detalhe(issueKey: string, email = ANA): Promise<DetalheNaTela> {
  const r = await chamar(req(`/api/chamados/${issueKey}`, { email }))
  expect(r.status).toBe(200)
  return (await r.json()) as DetalheNaTela
}

describe('T-084 — o anexo do solicitante volta na leitura do chamado', () => {
  it('o arquivo que a pessoa anexou aparece no detalhe, com link deste app', async () => {
    const issueKey = await abrirChamado()
    await anexar(issueKey, 'print-da-fila.png')

    const d = await detalhe(issueKey)
    expect(d.anexosIndisponiveis).toBe(false)
    expect(d.anexos.map((a) => a.nomeArquivo)).toEqual(['print-da-fila.png'])
    // `RNF-02` — o link é do app, nunca `atlassian.net`.
    expect(d.anexos[0]!.url).toBe(urlDoAnexoNoApp(issueKey, 'print-da-fila.png'))
    expect(d.anexos[0]!.url.startsWith('/api/')).toBe(true)
  })

  it('chamado sem anexo diz "não tem", e isso é diferente de "não sei"', async () => {
    const d = await detalhe(await abrirChamado())
    expect(d.anexos).toEqual([])
    expect(d.anexosIndisponiveis).toBe(false)
  })

  it('a URL gerada casa com a rota que a serve — contrato entre as duas camadas', async () => {
    const issueKey = await abrirChamado()
    await anexar(issueKey, 'relatório com espaço.png')

    const d = await detalhe(issueKey)
    const r = await chamar(req(d.anexos[0]!.url, { email: ANA }))
    expect(r.status).toBe(200)
  })

  it('serve os bytes com o Content-Type AFIRMADO pelo app e as travas de `D-11`', async () => {
    const issueKey = await abrirChamado()
    await anexar(issueKey, 'print.png')

    const r = await chamar(req(urlDoAnexoNoApp(issueKey, 'print.png'), { email: ANA }))
    expect(r.status).toBe(200)
    expect(r.headers.get('Content-Type')).toBe('image/png')
    expect(r.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(r.headers.get('Content-Security-Policy')).toContain('sandbox')
    expect(r.headers.get('Content-Disposition')).toContain('filename="print.png"')
  })

  it('tipo fora da allowlist vira download opaco, nunca inline (`D-11`)', async () => {
    const issueKey = await abrirChamado()
    const fake = ctx.atlassian as ClienteAtlassianFake
    // Um `.png` cujo tipo de upload é `text/html` — o vetor que `D-11` fecha.
    fake.estado.anexosDeChamado.set(issueKey, [
      { nome: 'armadilha.png', tipo: 'text/html', tamanho: 4 },
    ])
    fake.estado.comentarios.set(issueKey, [
      {
        id: 'c1',
        corpo: '',
        autorNome: 'Conta de serviço goatlas',
        criadoEm: AGORA,
        publico: true,
        anexos: [{ nome: 'armadilha.png', tipo: 'text/html', tamanho: 4 }],
      },
    ])

    const r = await chamar(req(urlDoAnexoNoApp(issueKey, 'armadilha.png'), { email: ANA }))
    expect(r.status).toBe(200)
    expect(r.headers.get('Content-Type')).toBe('application/octet-stream')
    expect(r.headers.get('Content-Disposition')).toContain('attachment')
  })
})

describe('T-084 [burla] — o anexo de outra pessoa e o anexo interno', () => {
  it('anexo de chamado de OUTRA pessoa responde 404, nunca 403 (`RF-30`)', async () => {
    const issueKey = await abrirChamado(ANA, 'k-ana')
    await anexar(issueKey, 'print.png')

    const r = await chamar(req(urlDoAnexoNoApp(issueKey, 'print.png'), { email: BRUNO }))
    // 403 diria "existe, mas não é seu" — já é informação sobre o chamado alheio.
    expect(r.status).toBe(404)
    expect(await r.text()).not.toContain('print.png')
  })

  it('o detalhe de outra pessoa nem chega a listar anexo', async () => {
    const issueKey = await abrirChamado(ANA, 'k-ana')
    await anexar(issueKey, 'print.png')

    const r = await chamar(req(`/api/chamados/${issueKey}`, { email: BRUNO }))
    expect(r.status).toBe(404)
  })

  it('anexo de comentário INTERNO não aparece na lista (`RN-05`)', async () => {
    const issueKey = await abrirChamado()
    await anexar(issueKey, 'print-da-pessoa.png')

    const fake = ctx.atlassian as ClienteAtlassianFake
    // O time anexa um arquivo num comentário interno. Ele EXISTE no chamado, e o
    // endpoint de anexos o devolve — porque quem pergunta é a conta de serviço, que é
    // agente. Sem a prova de publicidade, ele iria para a tela da pessoa.
    fake.estado.anexosDeChamado.set(issueKey, [
      ...(fake.estado.anexosDeChamado.get(issueKey) ?? []),
      { nome: 'analise-interna.pdf', tipo: 'application/pdf', tamanho: 10, publico: false },
    ])

    const d = await detalhe(issueKey)
    expect(d.anexos.map((a) => a.nomeArquivo)).toEqual(['print-da-pessoa.png'])
    expect(d.anexosIndisponiveis).toBe(false)
  })

  it('anexo interno também não BAIXA, e a recusa é a mesma 404 de tudo (`D-12`)', async () => {
    const issueKey = await abrirChamado()
    await anexar(issueKey, 'print-da-pessoa.png')
    const fake = ctx.atlassian as ClienteAtlassianFake
    fake.estado.anexosDeChamado.set(issueKey, [
      ...(fake.estado.anexosDeChamado.get(issueKey) ?? []),
      { nome: 'analise-interna.pdf', tipo: 'application/pdf', tamanho: 10, publico: false },
    ])

    const interno = await chamar(
      req(urlDoAnexoNoApp(issueKey, 'analise-interna.pdf'), { email: ANA }),
    )
    const inexistente = await chamar(
      req(urlDoAnexoNoApp(issueKey, 'nunca-existiu.pdf'), { email: ANA }),
    )
    expect(interno.status).toBe(404)
    // Corpo idêntico: motivo diferente por resposta diferente seria oráculo.
    expect(await interno.text()).toBe(await inexistente.text())
  })

  it('a auditoria registra a recusa, com o motivo e SEM o nome do arquivo (`RNF-30`)', async () => {
    const issueKey = await abrirChamado()
    await anexar(issueKey, 'print.png')
    await chamar(req(urlDoAnexoNoApp(issueKey, 'segredo-do-time.pdf'), { email: ANA }))

    const registros = await ctx.auditoria.listarRecentes(50)
    const negado = registros.find(
      (r) => r.acao === 'anexo_servido' && r.resultado === 'negado',
    )
    expect(negado).toBeDefined()
    expect(JSON.stringify(negado)).toContain('anexo_nao_autorizado')
    expect(JSON.stringify(negado)).not.toContain('segredo-do-time')
  })
})

describe('T-084 — degradação: "não sei" nunca vira "não tem" (`RNF-18`)', () => {
  it('lista de anexos fora do ar → `anexosIndisponiveis`, e o chamado continua legível', async () => {
    const issueKey = await abrirChamado()
    await anexar(issueKey, 'print.png')
    const fake = ctx.atlassian as ClienteAtlassianFake
    fake.estado.falhas.listarAnexosDoChamado = 'indisponivel'

    const d = await detalhe(issueKey)
    expect(d.anexosIndisponiveis).toBe(true)
    expect(d.anexos).toEqual([])
    // A queda é só dos anexos: a conversa continua de pé.
    expect(d.comentariosIndisponiveis).toBe(false)
  })

  it('comentários fora do ar levam junto a PROVA de publicidade, não a lista inteira do app', async () => {
    const issueKey = await abrirChamado()
    await anexar(issueKey, 'print.png')
    const fake = ctx.atlassian as ClienteAtlassianFake
    fake.estado.falhas.listarComentarios = 'indisponivel'

    const d = await detalhe(issueKey)
    expect(d.comentariosIndisponiveis).toBe(true)
    // Sem prova, não se afirma nada — e o que NÃO pode acontecer é uma lista vazia
    // silenciosa, que a pessoa leria como "meu print sumiu".
    expect(d.anexosIndisponiveis).toBe(true)
    expect(d.anexos).toEqual([])
  })

  it('expansão de anexo ausente na resposta do JSM não vira "chamado sem anexos"', async () => {
    const issueKey = await abrirChamado()
    await anexar(issueKey, 'print.png')
    const fake = ctx.atlassian as ClienteAtlassianFake
    // Encena o pior caso do `D-45`: o endpoint aceita `expand=attachment` e devolve
    // 200 **sem** a expansão. Sem esta distinção, o app diria "não tem anexo".
    fake.estado.expansaoDeAnexoIndisponivel = true

    const d = await detalhe(issueKey)
    expect(d.anexosIndisponiveis).toBe(true)
    expect(d.anexos).toEqual([])
  })

  it('durante a queda, baixar responde 503 — não 404, que diria que o arquivo sumiu', async () => {
    const issueKey = await abrirChamado()
    await anexar(issueKey, 'print.png')
    const fake = ctx.atlassian as ClienteAtlassianFake
    fake.estado.falhas.listarAnexosDoChamado = 'indisponivel'

    const r = await chamar(req(urlDoAnexoNoApp(issueKey, 'print.png'), { email: ANA }))
    expect(r.status).toBe(503)
  })
})

describe('T-084 — a interseção, como função pura (`D-45`)', () => {
  const anexo = (nome: string, tamanho: number | null = 10): AnexoDoChamado => ({
    nomeArquivo: nome,
    tipoDeclarado: 'image/png',
    tamanhoBytes: tamanho,
    criadoEm: AGORA,
  })

  it('existe sem prova de publicidade = indisponível, nunca lista vazia', () => {
    const r = anexosParaExibir('GN-1', [anexo('a.png')], { disponivel: false, anexos: [] })
    expect(r).toEqual({ itens: [], indisponivel: true })
  })

  it('prova disponível e nenhum casamento = chamado só com anexo interno, e isso é sabido', () => {
    const r = anexosParaExibir('GN-1', [anexo('interno.pdf')], {
      disponivel: true,
      anexos: [anexo('outro.png')],
    })
    expect(r).toEqual({ itens: [], indisponivel: false })
  })

  it('mesmo nome com tamanho diferente NÃO herda a publicidade do outro', () => {
    const r = anexosParaExibir('GN-1', [anexo('print.png', 999)], {
      disponivel: true,
      anexos: [anexo('print.png', 10)],
    })
    expect(r.itens).toEqual([])
  })

  it('tamanho desconhecido de um dos lados casa pelo nome — some o anexo seria pior', () => {
    const r = anexosParaExibir('GN-1', [anexo('print.png', null)], {
      disponivel: true,
      anexos: [anexo('print.png', 10)],
    })
    expect(r.itens.map((a) => a.nomeArquivo)).toEqual(['print.png'])
  })

  it('um comentário sem a expansão derruba a prova inteira — fail-closed', () => {
    const prova = provaDePublicidade([
      { id: 'c1', corpo: '', autorNome: 'x', criadoEm: AGORA, anexos: [anexo('a.png')] },
      { id: 'c2', corpo: 'oi', autorNome: 'x', criadoEm: AGORA, anexos: null },
    ])
    expect(prova.disponivel).toBe(false)
  })

  it('chamado sem comentário nenhum é prova VAZIA, não prova ausente', () => {
    expect(provaDePublicidade([])).toEqual({ disponivel: true, anexos: [] })
  })

  it('a testemunha caída (`null`) é indisponível, e sem ela não se afirma "não tem"', () => {
    expect(anexosParaExibir('GN-1', null, { disponivel: true, anexos: [] })).toEqual({
      itens: [],
      indisponivel: true,
    })
  })
})
