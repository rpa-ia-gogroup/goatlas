/**
 * Arquivo já enviado responde a pergunta — `D-69`.
 *
 * ## O relato
 *
 * 13/08/2026: a pessoa colou **dois prints** na conversa e o cartão de confirmação
 * perguntou se ela tinha material para anexar, *"como se eu já não tivesse enviado duas"*.
 * Junto vinham duas perguntas que este arquivo responde por asserção:
 *
 * - *"se eu marcar que não tenho, ele vai ignorar as duas?"* — **não**, e nunca ignorou:
 *   `materializarAnexosDoChamado` lê `anexos_pendentes` pela chave e **nunca** consultou a
 *   declaração. O que a resposta negativa fazia era sujar o indicador de `T-422`, gravando
 *   `declarouNaoTer` para quem tinha colaborado.
 * - *"se eu marcar que tenho, dá para somar até 3?"* — **sim**: o teto é do servidor, por
 *   chave (`MAX_ANEXOS_POR_CHAMADO`), e os prints da conversa e o input do cartão usam a
 *   **mesma** chave `conversa:<id>`. O que faltava era a tela saber disso.
 *
 * ⚠️ **Os dois lados são testados**: a rota que expõe o que já subiu (e o que ela NÃO expõe)
 * e o gate, que deixou de pedir uma resposta que o servidor já tinha — sem afrouxar `RN-11`
 * para quem não anexou nada.
 *
 * _Requirements: RF-61, RF-62, RF-63, RF-30, RN-11, RNF-18_
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { SqliteLocal } from '@/lib/db/sqlite-local'
import { migrar } from '@/lib/db/schema'
import { Config } from '@/lib/config'
import { montarContexto, type Contexto } from '@/lib/contexto'
import { tratarRequisicao } from '@/lib/http/rotas'
import { HEADER_EMAIL } from '@/lib/auth'
import { ClienteAtlassianFake } from '@/lib/atlassian/fake'
import { primeiraLinha } from '@/lib/db/tipos'
import { MAX_ANEXOS_POR_CHAMADO } from '@/lib/tickets/anexos-pendentes'
import { PerguntaDeAnexo } from '@/app/anexo'

const ANA = 'ana@gocase.com'
const BRUNO = 'bruno@gocase.com'
const CHEFE = 'chefe@gocase.com'
const AGORA = '2026-08-13T12:00:00.000Z'

const CAMPO_ANEXO = {
  fieldId: 'customfield_20031',
  rotulo: 'Anexo',
  obrigatorio: false,
  tipo: 'anexo' as const,
  opcoes: [],
}

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
  ctx = await montarContexto({ DB: db, GOATLAS_USAR_FAKES: '1' }, () => AGORA, () => `id-${++n}`)
  fake = ctx.atlassian as ClienteAtlassianFake
  fake.estado.tiposChamado = [
    { id: 'rt-1', serviceDeskId: 'sd-1', nome: 'Relatar um problema', descricao: null },
  ]
  // O tipo expõe campo de anexo: é nele que `RN-11` exige resposta.
  fake.estado.camposPorTipo.set('rt-1', [CAMPO_ANEXO])
})

function req(caminho: string, corpo?: unknown, metodo = 'POST', quem = ANA): Request {
  return new Request(`https://goatlas.devgogroup.com${caminho}`, {
    method: metodo,
    headers: { [HEADER_EMAIL]: quem },
    ...(corpo === undefined ? {} : { body: JSON.stringify(corpo) }),
  })
}

const chamar = (r: Request) => tratarRequisicao(r, ctx, {})

/** Conversa no ponto exato em que `RF-17` permite confirmar. */
async function conversaPronta(quem = ANA): Promise<string> {
  const c = await ctx.conversas.criar(ctx.novoId(), quem)
  await ctx.conversas.marcarConfluenceVerificado(c.id, false)
  await ctx.conversas.marcarHistoricoVerificado(c.id, false)
  await ctx.conversas.definirProposta(c.id, {
    titulo: 'Notebook desliga sozinho a cada poucos minutos',
    descricao: 'O equipamento não fica ligado por mais de 30 minutos.',
    tipoChamadoId: 'rt-1',
    prioridade: 'alta',
    area: null,
    componente: null,
  })
  await ctx.conversas.definirEstado(c.id, 'aguardando_confirmacao')
  return c.id
}

/** Um print colado na conversa — o caminho de `D-59`/`D-62`. */
async function colarPrint(conversaId: string, nome: string, quem = ANA) {
  const form = new FormData()
  form.set('arquivo', new File([new Uint8Array([1, 2, 3])], nome, { type: 'image/png' }))
  form.set('conversaId', conversaId)
  const r = await chamar(
    new Request('https://goatlas.devgogroup.com/api/anexos-pendentes', {
      method: 'POST',
      headers: { [HEADER_EMAIL]: quem },
      body: form,
    }),
  )
  expect(r.status).toBe(201)
}

async function declaracaoPersistida(conversaId: string): Promise<number | null> {
  const r = await db.query(`SELECT declarou_anexo FROM submissoes WHERE chave_idempotencia = ?`, [
    `conversa:${conversaId}`,
  ])
  return primeiraLinha<{ declarou_anexo: number | null }>(r)?.declarou_anexo ?? null
}

describe('GET /api/conversas/:id/anexos — o que a tela não tinha como saber', () => {
  it('lista os nomes já enviados, na ordem, com o teto do servidor', async () => {
    const id = await conversaPronta()
    await colarPrint(id, 'image.png')
    await colarPrint(id, 'erro-do-console.png')

    const r = await chamar(req(`/api/conversas/${id}/anexos`, undefined, 'GET'))
    expect(r.status).toBe(200)
    const corpo = await r.json()
    expect(corpo.itens.map((a: { nome: string }) => a.nome)).toEqual([
      'image.png',
      'erro-do-console.png',
    ])
    // O número na tela é o do servidor — um `3` escrito na frase divergiria em silêncio.
    expect(corpo.teto).toBe(MAX_ANEXOS_POR_CHAMADO)
  })

  it('conversa sem anexo devolve lista vazia — e é a pergunta que volta', async () => {
    const id = await conversaPronta()
    const corpo = await (await chamar(req(`/api/conversas/${id}/anexos`, undefined, 'GET'))).json()
    expect(corpo.itens).toEqual([])
  })

  it('🚨 NÃO devolve o `temporaryAttachmentId` — só o nome (RF-30)', async () => {
    const id = await conversaPronta()
    await colarPrint(id, 'image.png')
    const bruto = await (await chamar(req(`/api/conversas/${id}/anexos`, undefined, 'GET'))).text()
    expect(bruto).toContain('image.png')
    expect(bruto).not.toMatch(/temporary/i)
    // O fake devolve `tmp-…` como id temporário; nada disso pode aparecer no corpo.
    expect(bruto).not.toMatch(/tmp-/)
  })

  it('🚨 conversa de outra pessoa devolve 404, nunca a lista (RF-30)', async () => {
    const dela = await conversaPronta(BRUNO)
    await colarPrint(dela, 'print-do-bruno.png', BRUNO)

    const r = await chamar(req(`/api/conversas/${dela}/anexos`, undefined, 'GET', ANA))
    expect(r.status).toBe(404)
    expect(await r.text()).not.toContain('print-do-bruno')
  })
})

describe('o gate de RN-11 — a pergunta que o servidor já sabe responder', () => {
  it('🚨 quem JÁ anexou confirma sem declarar nada — a pergunta não é feita de novo', async () => {
    const id = await conversaPronta()
    await colarPrint(id, 'image.png')
    await colarPrint(id, 'image (2).png')

    // Nenhum `declarouAnexo` no corpo: era exatamente isto que dava 400 antes.
    const r = await chamar(req(`/api/conversas/${id}/confirmar`, {}))
    expect(r.status).toBe(201)
    // E o fato é o que fica registrado: ela TEM evidência.
    expect(await declaracaoPersistida(id)).toBe(1)
  })

  it('RN-11 continua de pé para quem NÃO anexou: sem resposta, não abre', async () => {
    const id = await conversaPronta()
    const r = await chamar(req(`/api/conversas/${id}/confirmar`, {}))
    expect(r.status).toBe(400)
    expect(await r.text()).toMatch(/anexar/i)
  })

  it('🚨 `false` explícito NÃO apaga dois arquivos a caminho do chamado', async () => {
    const id = await conversaPronta()
    await colarPrint(id, 'image.png')

    const r = await chamar(req(`/api/conversas/${id}/confirmar`, { declarouAnexo: false }))
    expect(r.status).toBe(201)
    const criado = await r.json()
    expect(criado.issueKey).toBeTruthy()
    // O arquivo vai junto de qualquer forma — `materializarAnexosDoChamado` lê
    // `anexos_pendentes` pela chave e nunca consultou a declaração.
    expect(criado.anexo?.anexados).toContain('image.png')
    // E gravar `declarouNaoTer` diria a `T-422` que esta pessoa não colaborou.
    expect(await declaracaoPersistida(id)).toBe(1)
  })

  it('sem anexo, a resposta negativa continua abrindo chamado (SC-03)', async () => {
    const id = await conversaPronta()
    const r = await chamar(req(`/api/conversas/${id}/confirmar`, { declarouAnexo: false }))
    expect(r.status).toBe(201)
    expect(await declaracaoPersistida(id)).toBe(0)
  })
})

describe('a tela — sem pergunta quando ela já foi respondida por ato', () => {
  const render = (jaEnviados: readonly string[]) =>
    renderToStaticMarkup(
      createElement(PerguntaDeAnexo, {
        alvo: { via: 'conversa' as const, conversaId: 'c1' },
        declarou: null,
        aoDeclarar: () => {},
        jaEnviados,
        teto: MAX_ANEXOS_POR_CHAMADO,
      }),
    )

  it('🚨 com arquivo já enviado não há rádio para responder — e os nomes aparecem', () => {
    const html = render(['image.png', 'image (2).png'])
    expect(html).not.toContain('type="radio"')
    expect(html).not.toContain('Você tem algo para anexar?')
    expect(html).toContain('Você já anexou 2 arquivos')
    expect(html).toContain('image.png')
    expect(html).toContain('image (2).png')
  })

  it('a frase diz quantos AINDA cabem, não o teto inteiro', () => {
    // Dois enviados de três: a nota antiga dizia "Até 3 arquivos" com dois já gastos.
    expect(render(['a.png', 'b.png'])).toContain('Ainda cabem 1')
    expect(render(['a.png'])).toContain('Ainda cabem 2')
  })

  it('no teto, oferece parar em vez de um botão que só pode falhar', () => {
    const html = render(['a.png', 'b.png', 'c.png'])
    expect(html).toContain(`limite de ${MAX_ANEXOS_POR_CHAMADO} arquivos`)
    expect(html).not.toContain('Anexar outro arquivo')
  })

  it('🚨 no teto a LISTA continua na tela — foi o defeito medido no navegador', () => {
    // A primeira versão punha a lista dentro de `{cabem > 0 && …}`: o terceiro arquivo
    // subia e a tela voltava a mostrar dois, com a frase do limite ao lado. Arquivo no
    // chamado e nenhuma linha na tela é o defeito de `D-62` de novo.
    const html = render(['a.png', 'b.png', 'c.png'])
    expect(html).toContain('a.png')
    expect(html).toContain('b.png')
    expect(html).toContain('c.png')
    expect(html).toContain('Você já anexou 3 arquivos')
  })

  it('singular quando é um só — concordância é conteúdo (regra 4)', () => {
    expect(render(['unico.png'])).toContain('Você já anexou 1 arquivo')
    expect(render(['unico.png'])).not.toContain('1 arquivos')
  })

  it('sem nada enviado, a pergunta de RF-62 continua exatamente como era', () => {
    const html = render([])
    expect(html).toContain('Você tem algo para anexar?')
    expect(html).toContain('type="radio"')
    expect(html).toContain('Não tenho material para anexar')
  })
})
