/**
 * `RF-78`/`RF-79`/`RN-14` (spec 010) — o anexo que viaja dentro da criação.
 *
 * 🚨 **A asserção que vale é sobre o CORPO ENTREGUE ao `fetchImpl`**, nunca sobre o que o
 * fake devolveu. `D-38`, `D-39`, `D-43`, `D-47` e `D-70` passaram todos por suítes verdes
 * porque o dublê era consistente consigo mesmo enquanto o cliente real fazia outra coisa.
 * Aqui, o que se afirma é: *o `attachment` estava no `requestFieldValues` que saiu daqui?*
 */
import { describe, expect, it } from 'vitest'

import { ClienteAtlassianHttp } from '../src/lib/atlassian/cliente'
import { RepositorioAnexosConteudo } from '../src/lib/tickets/anexos-conteudo'
import { RepositorioAnexosPendentes } from '../src/lib/tickets/anexos-pendentes'
import { SqliteLocal } from '../src/lib/db/sqlite-local'
import { migrar } from '../src/lib/db/schema'
import {
  anexoObrigatorio,
  mensagemAnexoObrigatorio,
  rotuloDoCampoDeAnexo,
} from '../src/lib/tickets/declaracao-anexo'
import { prepararAnexosParaCriacao } from '../src/lib/tickets/anexo-antes-da-criacao'
import type { SchemaDoTipo } from '../src/lib/tickets/declaracao-anexo'

const CAMPO_ANEXO = {
  fieldId: 'attachment',
  rotulo: 'Por favor, evidencie o problema',
  tipo: 'anexo' as const,
  obrigatorio: true,
  opcoes: [],
}

const schemaCom = (campos: readonly unknown[]): SchemaDoTipo =>
  ({ conhecido: true, campos }) as unknown as SchemaDoTipo

describe('RN-14 — a exigência vem do schema', () => {
  it('reconhece o campo de anexo obrigatório', () => {
    expect(anexoObrigatorio(schemaCom([CAMPO_ANEXO]))).toBe(true)
    expect(rotuloDoCampoDeAnexo(schemaCom([CAMPO_ANEXO]))).toBe(
      'Por favor, evidencie o problema',
    )
  })

  it('anexo OPCIONAL não exige nada — são os 9 assuntos que já funcionavam', () => {
    expect(anexoObrigatorio(schemaCom([{ ...CAMPO_ANEXO, obrigatorio: false }]))).toBe(false)
  })

  it('assunto sem campo de anexo não exige nada', () => {
    expect(
      anexoObrigatorio(
        schemaCom([{ fieldId: 'summary', rotulo: 'Resumo', tipo: 'texto', obrigatorio: true }]),
      ),
    ).toBe(false)
  })

  it('🚨 schema DESCONHECIDO é fail-open (`D-27`): indisponibilidade não vira parede', () => {
    expect(anexoObrigatorio({ conhecido: false, campos: [] } as unknown as SchemaDoTipo)).toBe(
      false,
    )
  })

  it('a mensagem nomeia o campo, em português, e oferece saída', () => {
    const m = mensagemAnexoObrigatorio('Por favor, evidencie o problema')
    expect(m).toContain('Por favor, evidencie o problema')
    expect(m).toContain('troco o assunto')
    // ⚠️ Nunca o `fieldId` (`RNF-30`) — quem lê não sabe o que é `attachment`.
    expect(m).not.toContain('attachment')
  })
})

describe('RF-78 — os bytes voltam íntegros do banco', () => {
  it('guarda 3 MB fatiado e devolve exatamente os mesmos bytes', async () => {
    const db = new SqliteLocal()
    await migrar(db)
    const pendentes = new RepositorioAnexosPendentes(db, () => '2026-08-17T12:00:00.000Z')
    const conteudo = new RepositorioAnexosConteudo(db)

    await pendentes.registrar({
      id: 'anexo-1',
      solicitanteEmail: 'a@gocase.com',
      conversaId: 'c1',
      chaveIdempotencia: 'conversa:c1',
      temporaryAttachmentId: 'temp-antigo',
      nomeArquivo: 'print.png',
      tipoArquivo: 'image/png',
    })

    // Bytes pseudoaleatórios: conteúdo compressível passaria por qualquer transporte que
    // comprima e diria "cabe" sobre um caso que não existe (`D-74`).
    const original = new Uint8Array(3 * 1024 * 1024)
    for (let i = 0; i < original.length; i += 1) original[i] = (i * 31 + 7) % 256
    await conteudo.guardar('anexo-1', original.buffer as ArrayBuffer)

    const lidos = await conteudo.lerDaChave('conversa:c1', 'a@gocase.com')
    expect(lidos).toHaveLength(1)
    expect(lidos[0]!.tipoArquivo).toBe('image/png')
    const volta = new Uint8Array(lidos[0]!.bytes)
    expect(volta.length).toBe(original.length)
    expect(volta[0]).toBe(original[0])
    expect(volta[1_500_000]).toBe(original[1_500_000])
    expect(volta[original.length - 1]).toBe(original[original.length - 1])
  })

  it('🚨 conversa de OUTRA pessoa não devolve nada (`RF-30`, o filtro no `WHERE`)', async () => {
    const db = new SqliteLocal()
    await migrar(db)
    const pendentes = new RepositorioAnexosPendentes(db, () => '2026-08-17T12:00:00.000Z')
    const conteudo = new RepositorioAnexosConteudo(db)
    await pendentes.registrar({
      id: 'anexo-1',
      solicitanteEmail: 'dono@gocase.com',
      conversaId: 'c1',
      chaveIdempotencia: 'conversa:c1',
      temporaryAttachmentId: 't',
      nomeArquivo: 'print.png',
      tipoArquivo: 'image/png',
    })
    await conteudo.guardar('anexo-1', new Uint8Array([1, 2, 3]).buffer as ArrayBuffer)

    expect(await conteudo.lerDaChave('conversa:c1', 'outro@gocase.com')).toEqual([])
  })

  it('o expurgo leva os bytes órfãos, e só eles', async () => {
    const db = new SqliteLocal()
    await migrar(db)
    const pendentes = new RepositorioAnexosPendentes(db, () => '2026-08-17T12:00:00.000Z')
    const conteudo = new RepositorioAnexosConteudo(db)
    await pendentes.registrar({
      id: 'vivo',
      solicitanteEmail: 'a@gocase.com',
      conversaId: null,
      chaveIdempotencia: 'form:a@gocase.com:1',
      temporaryAttachmentId: 't',
      nomeArquivo: 'a.png',
    })
    await conteudo.guardar('vivo', new Uint8Array([1]).buffer as ArrayBuffer)
    await conteudo.guardar('morto', new Uint8Array([2]).buffer as ArrayBuffer)

    expect(await conteudo.expurgarOrfaos()).toBe(1)
    expect(await conteudo.lerDaChave('form:a@gocase.com:1', 'a@gocase.com')).toHaveLength(1)
  })
})

describe('RF-79 — o anexo entra no corpo da criação', () => {
  /** Um `fetch` que grava tudo o que passou por ele. É o único oráculo confiável (`D-47`). */
  function fetchGravado(respostas: Record<string, unknown>) {
    const chamadas: { url: string; body: string | null }[] = []
    const impl = (async (url: string, init?: RequestInit) => {
      chamadas.push({ url, body: typeof init?.body === 'string' ? init.body : null })
      const chave = Object.keys(respostas).find((k) => url.includes(k))
      return new Response(JSON.stringify(chave ? respostas[chave] : {}), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }) as unknown as typeof fetch
    return { chamadas, impl }
  }

  it('🚨 `attachment` vai em `requestFieldValues` — o que `M-2` mediu contra o Jira real', async () => {
    const { chamadas, impl } = fetchGravado({
      '/rest/servicedeskapi/request': { issueKey: 'GN-1', issueId: '1' },
    })
    const cliente = new ClienteAtlassianHttp({
      baseUrl: 'https://exemplo.atlassian.net',
      email: 'conta@gocase.com',
      apiToken: 'ATATT-xxx',
      fetchImpl: impl,
      ttlMetadadosSeg: 60,
      ttlConteudoSeg: 60,
    })

    await cliente.criarChamado({
      serviceDeskId: '4',
      tipoChamadoId: '134',
      titulo: 'Falha ao salvar',
      descricao: 'texto',
      prioridade: 'normal',
      solicitanteEmail: 'a@gocase.com',
      chaveIdempotencia: 'conversa:c1',
      camposDinamicos: { attachment: ['temp-novo-1'], customfield_10093: 'Factory' },
    })

    const criacao = chamadas.find((c) => c.url.endsWith('/rest/servicedeskapi/request'))
    expect(criacao).toBeDefined()
    const corpo = JSON.parse(criacao!.body!) as {
      requestFieldValues: Record<string, unknown>
    }
    expect(corpo.requestFieldValues.attachment).toEqual(['temp-novo-1'])
    expect(corpo.requestFieldValues.customfield_10093).toBe('Factory')
  })

  it('sem anexo no campo, o corpo continua exatamente como antes (os 9 que funcionam)', async () => {
    const { chamadas, impl } = fetchGravado({
      '/rest/servicedeskapi/request': { issueKey: 'GN-2', issueId: '2' },
    })
    const cliente = new ClienteAtlassianHttp({
      baseUrl: 'https://exemplo.atlassian.net',
      email: 'conta@gocase.com',
      apiToken: 'ATATT-xxx',
      fetchImpl: impl,
      ttlMetadadosSeg: 60,
      ttlConteudoSeg: 60,
    })
    await cliente.criarChamado({
      serviceDeskId: '4',
      tipoChamadoId: '68',
      titulo: 'Dúvida',
      descricao: 'texto',
      prioridade: 'normal',
      solicitanteEmail: 'a@gocase.com',
      chaveIdempotencia: 'conversa:c2',
    })
    const corpo = JSON.parse(chamadas[0]!.body!) as { requestFieldValues: Record<string, unknown> }
    expect('attachment' in corpo.requestFieldValues).toBe(false)
  })

  it('o id temporário é NOVO — sobe de novo a partir dos bytes guardados', async () => {
    const db = new SqliteLocal()
    await migrar(db)
    const pendentes = new RepositorioAnexosPendentes(db, () => '2026-08-17T12:00:00.000Z')
    const conteudo = new RepositorioAnexosConteudo(db)
    await pendentes.registrar({
      id: 'anexo-1',
      solicitanteEmail: 'a@gocase.com',
      conversaId: 'c1',
      chaveIdempotencia: 'conversa:c1',
      temporaryAttachmentId: 'temp-de-40-minutos-atras',
      nomeArquivo: 'print.png',
      tipoArquivo: 'image/png',
    })
    await conteudo.guardar('anexo-1', new Uint8Array([9, 9, 9]).buffer as ArrayBuffer)

    const subidos: { nome: string; tipo: string }[] = []
    const preparado = await prepararAnexosParaCriacao(
      {
        anexosPendentes: pendentes,
        anexosConteudo: conteudo,
        atlassian: {
          async subirAnexoTemporario(_desk: string, arquivo: { nome: string; tipo: string }) {
            subidos.push({ nome: arquivo.nome, tipo: arquivo.tipo })
            return 'temp-NOVO'
          },
        } as never,
        auditoria: { async registrar() {} } as never,
      },
      {
        chaveIdempotencia: 'conversa:c1',
        solicitanteEmail: 'a@gocase.com',
        serviceDeskId: '4',
      },
    )

    expect(preparado.ids).toEqual(['temp-NOVO'])
    expect(preparado.usouIdAntigo).toBe(false)
    expect(subidos).toEqual([{ nome: 'print.png', tipo: 'image/png' }])
  })

  it('⚠️ sem bytes guardados, cai para o id antigo E DIZ que caiu (`RNF-18`)', async () => {
    const db = new SqliteLocal()
    await migrar(db)
    const pendentes = new RepositorioAnexosPendentes(db, () => '2026-08-17T12:00:00.000Z')
    const conteudo = new RepositorioAnexosConteudo(db)
    await pendentes.registrar({
      id: 'anexo-1',
      solicitanteEmail: 'a@gocase.com',
      conversaId: 'c1',
      chaveIdempotencia: 'conversa:c1',
      temporaryAttachmentId: 'temp-antigo',
      nomeArquivo: 'print.png',
    })

    const preparado = await prepararAnexosParaCriacao(
      {
        anexosPendentes: pendentes,
        anexosConteudo: conteudo,
        atlassian: {
          async subirAnexoTemporario() {
            throw new Error('não deveria subir nada — não há bytes')
          },
        } as never,
        auditoria: { async registrar() {} } as never,
      },
      {
        chaveIdempotencia: 'conversa:c1',
        solicitanteEmail: 'a@gocase.com',
        serviceDeskId: '4',
      },
    )

    expect(preparado.ids).toEqual(['temp-antigo'])
    expect(preparado.usouIdAntigo).toBe(true)
  })
})
