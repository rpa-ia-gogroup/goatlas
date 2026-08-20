/**
 * **`T-636`/`T-643`/`T-644`** — o caminho observável, pelas rotas HTTP.
 *
 * Os testes anteriores afirmam sobre as peças (borda de OCR, contrato de IA, repositório,
 * analisador, espera). Este afirma sobre o que **acontece de fora**: anexar → o turno responder
 * com a leitura, uma vez só, e o `irrelevante` não chegando à tela.
 *
 * ⚠️ É o par de `ScC-1` e `ScC-2`, que estavam sem tarefa antes do achado `F4` do `/analyze`.
 *
 * _Requirements: FR-1, FR-1b, FR-2, FR-4, FR-5, FR-5b, ScC-1, ScC-2_
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { SqliteLocal } from '@/lib/db/sqlite-local'
import { migrar } from '@/lib/db/schema'
import { Config } from '@/lib/config'
import { montarContexto, type Contexto } from '@/lib/contexto'
import { tratarRequisicao } from '@/lib/http/rotas'
import type { ClienteIAFake } from '@/lib/ia/fake'

const ANA = 'ana@gocase.com'
const AGORA = '2026-08-13T10:00:00.000Z'
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10])

let db: SqliteLocal
let ctx: Contexto
let ia: ClienteIAFake
let n = 0

beforeEach(async () => {
  n = 0
  db = new SqliteLocal()
  await migrar(db)
  const config = new Config(db)
  await config.definir('dominios_permitidos', ['gocase.com'], ANA, AGORA)
  await config.definir('service_desk_id', '4', ANA, AGORA)
  ctx = await montarContexto(
    { DB: db, ATLAS_USAR_FAKES: '1' },
    () => AGORA,
    () => `id-${++n}`,
  )
  ia = ctx.ia as ClienteIAFake
})

const cabecalhos = { 'x-godeploy-user-email': ANA }

async function pedir(caminho: string, init: RequestInit = {}): Promise<Response> {
  return tratarRequisicao(
    new Request(`https://app.local${caminho}`, {
      ...init,
      headers: { ...cabecalhos, ...((init.headers as Record<string, string>) ?? {}) },
    }),
    ctx,
    {} as never,
  )
}

async function novaConversa(): Promise<string> {
  const r = await pedir('/api/conversas', { method: 'POST' })
  return ((await r.json()) as { id: string }).id
}

async function anexar(conversaId: string, nome: string): Promise<Response> {
  const form = new FormData()
  form.append('conversaId', conversaId)
  form.append('arquivo', new File([PNG], nome, { type: 'image/png' }))
  return pedir('/api/anexos-pendentes', { method: 'POST', body: form })
}

async function mandarMensagem(conversaId: string, texto: string) {
  const r = await pedir(`/api/conversas/${conversaId}/mensagens`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ texto }),
  })
  return (await r.json()) as {
    analisesAnexo?: readonly { nomeArquivo: string; estado: string; descricao: string | null }[]
  }
}

describe('o anexo é lido, e o turno já responde sabendo (T-643)', () => {
  it('🚨 anexar → a mensagem seguinte volta com a leitura pronta (ScC-1)', async () => {
    const conversa = await novaConversa()
    expect((await anexar(conversa, 'print.png')).status).toBe(201)

    const turno = await mandarMensagem(conversa, 'o relatório não atualizou')

    expect(turno.analisesAnexo).toHaveLength(1)
    expect(turno.analisesAnexo![0]).toMatchObject({
      nomeArquivo: 'print.png',
      estado: 'pronta',
    })
    expect(turno.analisesAnexo![0]!.descricao).toContain('PIPELINE_TIMEOUT')
  })

  it('🚨 o modelo RECEBE a descrição, delimitada (FR-4, FR-9)', async () => {
    const conversa = await novaConversa()
    await anexar(conversa, 'print.png')
    await mandarMensagem(conversa, 'o relatório não atualizou')

    // O que importa é o que chegou ao provedor: a descrição, e dentro do delimitador.
    const enviado = ia.chatsRecebidos.flatMap((c) => c.mensagens.map((m) => m.conteudo)).join('\n')
    expect(enviado).toContain('PIPELINE_TIMEOUT')
    expect(enviado).toContain('<dados_nao_confiaveis')
    expect(enviado).toContain('arquivo:print.png')
  })

  it('🚨 análise IRRELEVANTE não chega à tela nem ao modelo (FR-5b, SC-15)', async () => {
    ia.descricaoPorArquivo.set('cracha.png', { relevante: false, descricao: 'foto de crachá' })

    const conversa = await novaConversa()
    await anexar(conversa, 'cracha.png')
    const turno = await mandarMensagem(conversa, 'preciso de ajuda com o pedido 123')

    // A análise existe (vai à transcrição), com a descrição escondida da tela.
    expect(turno.analisesAnexo).toHaveLength(1)
    expect(turno.analisesAnexo![0]).toMatchObject({ estado: 'irrelevante', descricao: null })

    const enviado = ia.chatsRecebidos.flatMap((c) => c.mensagens.map((m) => m.conteudo)).join('\n')
    expect(enviado, 'o modelo não fala sobre a foto dela').not.toContain('crachá')
  })

  it('🚨 o mesmo anexo NÃO é analisado duas vezes (FR-2, ScC-2)', async () => {
    const conversa = await novaConversa()
    await anexar(conversa, 'print.png')
    await mandarMensagem(conversa, 'primeira')
    const antes = ia.descricoesRecebidas.length

    await mandarMensagem(conversa, 'segunda')

    expect(ia.descricoesRecebidas.length, 'nenhuma análise nova').toBe(antes)
    expect(antes).toBe(1)
  })

  it('conversa sem anexo não paga análise nenhuma', async () => {
    const conversa = await novaConversa()
    await mandarMensagem(conversa, 'só uma dúvida')
    expect(ia.descricoesRecebidas).toHaveLength(0)
  })

  it('🚨 a leitura falhando NÃO derruba o upload nem a conversa (FR-8, ScC-4)', async () => {
    ia.falharDescricao = true

    const conversa = await novaConversa()
    // O upload responde 201: o arquivo **está** na Atlassian; o que falhou foi a leitura.
    expect((await anexar(conversa, 'print.png')).status).toBe(201)

    const turno = await mandarMensagem(conversa, 'o relatório não atualizou')
    expect(turno.analisesAnexo![0]).toMatchObject({ estado: 'falhou' })
  })
})
