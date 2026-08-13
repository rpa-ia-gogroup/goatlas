/**
 * **`T-601`** — a borda HTTP da quinta credencial, com as três armadilhas conhecidas.
 *
 * O worker de OCR (`POST`, `application/pdf`, bytes crus → `{text|content}`) é o **mesmo que o
 * godocs usa em produção**, e o contrato está exercitado em
 * `analise-notas-fiscais/src/extract/ocr-worker.ts`. O que este arquivo trava não é o contrato
 * dele — é o **nosso lado**, onde três defeitos já custaram dias neste projeto:
 *
 * 1. `fetch` guardado sem `bind` → `Illegal invocation` no runtime dos Workers, **invisível**
 *    no Node dos testes (`D-50`). Aqui o receptor é encenado.
 * 2. Credencial com `\n` na ponta → `TypeError` sem abrir conexão, **mesma assinatura** do
 *    item 1 (`D-50`). Aqui ela é recusada antes da rede, com nome próprio.
 * 3. Timeout decidido por `e.name === 'AbortError'` → o nosso próprio timeout se
 *    apresentava como `erro_de_rede` (`D-40`). Aqui quem decide é o **sinal**.
 *
 * _Requirements: FR-6, FR-7, FR-8, RNF-01, RNF-04, RNF-30_
 */

import { describe, expect, it } from 'vitest'
import { criarLeitorPdf } from '@/lib/ocr/http'

const URL_OCR = 'https://ocr.exemplo.dev/'
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]) // "%PDF-1"

function leitor(
  fetchImpl: typeof fetch,
  extra: { token?: string; timeoutMs?: number } = {},
) {
  return criarLeitorPdf({
    url: URL_OCR,
    token: extra.token ?? 'tok-de-teste',
    timeoutMs: extra.timeoutMs ?? 8000,
    fetchImpl,
  })
}

function respondendo(corpo: unknown, status = 200): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(corpo), {
      status,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch
}

describe('o que vai para o worker (T-601)', () => {
  it('manda os BYTES do PDF, com o tipo e o Bearer', async () => {
    let visto: { url: string; init: RequestInit } | null = null
    const fake = (async (url: string, init: RequestInit) => {
      visto = { url, init }
      return new Response(JSON.stringify({ text: 'conteúdo do pdf' }), { status: 200 })
    }) as unknown as typeof fetch

    const r = await leitor(fake)(PDF)

    expect(r).toEqual({ estado: 'lido', texto: 'conteúdo do pdf' })
    expect(visto!.url).toBe(URL_OCR)
    expect(visto!.init.method).toBe('POST')
    const headers = new Headers(visto!.init.headers as HeadersInit)
    expect(headers.get('content-type')).toBe('application/pdf')
    expect(headers.get('authorization')).toBe('Bearer tok-de-teste')
    // O corpo são os bytes, não JSON com base64 dentro.
    expect(new Uint8Array(visto!.init.body as ArrayBuffer)).toEqual(PDF)
  })

  it('lê `text` e também `content` — o worker usa os dois nomes', async () => {
    expect(await leitor(respondendo({ content: 'por content' }))(PDF)).toEqual({
      estado: 'lido',
      texto: 'por content',
    })
  })

  it('resposta sem texto é `sem_conteudo`, NUNCA falha', async () => {
    // PDF em branco existe, e "não deu para ler" é uma frase oposta a "não tem nada escrito".
    for (const corpo of [{ text: '' }, { text: '   ' }, {}]) {
      expect(await leitor(respondendo(corpo))(PDF), JSON.stringify(corpo)).toEqual({
        estado: 'sem_conteudo',
      })
    }
  })

  it('corpo que não é JSON vira `formato_inesperado`, sem carregar o corpo', async () => {
    const fake = (async () => new Response('<html>erro</html>', { status: 200 })) as never
    const r = await leitor(fake)(PDF)
    expect(r.estado).toBe('falhou')
    expect(r).toMatchObject({ motivo: 'formato_inesperado' })
    // RNF-01/RNF-30: nada do corpo aparece no resultado.
    expect(JSON.stringify(r)).not.toContain('html')
  })
})

describe('falha rotulada, nunca exceção crua (T-601)', () => {
  it('HTTP != 2xx vira `http_<status>` e NÃO leva o corpo da resposta', async () => {
    const fake = (async () =>
      new Response('segredo-interno-do-worker', { status: 500 })) as never
    const r = await leitor(fake)(PDF)
    expect(r).toMatchObject({ estado: 'falhou', motivo: 'http_500' })
    expect(JSON.stringify(r)).not.toContain('segredo')
  })

  it('🚨 credencial com quebra de linha é RECUSADA antes de qualquer ida de rede', async () => {
    let chamou = false
    const fake = (async () => {
      chamou = true
      return new Response('{}', { status: 200 })
    }) as never
    const r = await leitor(fake, { token: 'tok\ncom-quebra' })(PDF)
    expect(r).toMatchObject({ estado: 'falhou', motivo: 'credencial_malformada' })
    expect(r).toMatchObject({ classe: 'caractere_de_controle' })
    expect(chamou, 'nem tentou abrir conexão').toBe(false)
  })

  it('token vazio também é recusado, com rótulo próprio', async () => {
    const r = await leitor(respondendo({ text: 'x' }), { token: '   ' })(PDF)
    expect(r).toMatchObject({ motivo: 'credencial_malformada', classe: 'vazia' })
  })

  it('🚨 o timeout é decidido pelo SINAL, não pelo nome do erro (D-40)', async () => {
    // Encena o pior caso: os cabeçalhos já chegaram e o aborto derruba a leitura do corpo,
    // então o runtime lança um erro genérico — NÃO `AbortError`. Quem sabe que foi o nosso
    // relógio é `signal.aborted`.
    const fake = (async (_url: string, init: RequestInit) => {
      await new Promise<void>((resolve) => {
        ;(init.signal as AbortSignal).addEventListener('abort', () => resolve())
      })
      throw new TypeError('network error')
    }) as unknown as typeof fetch

    const r = await leitor(fake, { timeoutMs: 5 })(PDF)
    expect(r).toMatchObject({ estado: 'falhou', motivo: 'timeout' })
  })

  it('erro de rede sem aborto é `erro_de_rede` com fase e classe', async () => {
    const fake = (async () => {
      throw new TypeError('failed to fetch')
    }) as never
    const r = await leitor(fake)(PDF)
    expect(r).toMatchObject({ estado: 'falhou', motivo: 'erro_de_rede', fase: 'conexao' })
    expect(r).toMatchObject({ classe: expect.stringMatching(/^[a-z0-9_]+$/) })
  })

  it('sem URL configurada, recusa sem rede — ausência é ausência (T-132)', async () => {
    let chamou = false
    const fake = (async () => {
      chamou = true
      return new Response('{}')
    }) as never
    const semUrl = criarLeitorPdf({ url: '', token: 'tok', timeoutMs: 100, fetchImpl: fake })
    expect(await semUrl(PDF)).toMatchObject({ motivo: 'nao_configurado' })
    expect(chamou).toBe(false)
  })
})
