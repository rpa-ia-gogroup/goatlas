/**
 * **`T-631`/`T-632`** — por onde cada tipo de arquivo passa, e as três formas de não ler.
 *
 * ⚠️ **Quem decide o tipo é o CONTEÚDO, não a extensão do nome.** `Content-Type` de upload é
 * escolhido pelo cliente e o nome é livre; `%PDF` nos primeiros bytes é fato. Mesma família de
 * `ScC-4` (nada decide "é anexo?" por `fieldId`).
 *
 * ⚠️ E `analisarAnexo` **nunca lança**: quem chama está no meio de um upload que não pode cair
 * por causa de leitura (`FR-8`).
 *
 * _Requirements: FR-3, FR-6, FR-7, FR-8_
 */

import { describe, expect, it } from 'vitest'
import { analisarAnexo, MAX_BYTES_IMAGEM } from '@/lib/agent/analise-de-anexo'
import { ClienteIAFake } from '@/lib/ia/fake'
import { ErroIA } from '@/lib/ia/tipos'
import type { LeitorPdf, ResultadoOcr } from '@/lib/ocr/contrato'

const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37])
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])

function deps(ocr: ResultadoOcr = { estado: 'lido', texto: 'texto do pdf' }) {
  const ia = new ClienteIAFake()
  const lidos: number[] = []
  const lerPdf: LeitorPdf = async (bytes) => {
    lidos.push(bytes.byteLength)
    return ocr
  }
  return { ia, lerPdf, lidos }
}

describe('roteamento por tipo (T-631)', () => {
  it('imagem vai ao modelo como imagem, com a mídia declarada', async () => {
    const d = deps()
    const r = await analisarAnexo(
      { nome: 'print.png', tipoDeclarado: 'image/png', bytes: PNG_BYTES },
      d,
    )
    expect(r.estado).toBe('pronta')
    expect(d.ia.descricoesRecebidas[0]!.conteudo).toMatchObject({
      tipo: 'imagem',
      midia: 'image/png',
    })
    expect(d.lidos, 'imagem não passa pelo OCR').toEqual([])
  })

  it('🚨 `%PDF` nos bytes ganha do que o navegador declarou', async () => {
    const d = deps()
    // O cliente jurou que era PNG; o conteúdo é PDF. Quem manda é o conteúdo.
    const r = await analisarAnexo(
      { nome: 'relatorio.png', tipoDeclarado: 'image/png', bytes: PDF_BYTES },
      d,
    )
    expect(r.estado).toBe('pronta')
    expect(d.lidos, 'foi para o OCR').toEqual([PDF_BYTES.byteLength])
    expect(d.ia.descricoesRecebidas[0]!.conteudo).toMatchObject({ tipo: 'texto' })
  })

  it('texto e markdown vão direto, sem OCR', async () => {
    for (const tipo of ['text/plain', 'text/markdown']) {
      const d = deps()
      const bytes = new TextEncoder().encode('# Conversa\n\nerro X às 10h')
      const r = await analisarAnexo({ nome: 'conversa.md', tipoDeclarado: tipo, bytes }, d)
      expect(r.estado, tipo).toBe('pronta')
      expect(d.lidos).toEqual([])
      expect(d.ia.descricoesRecebidas[0]!.conteudo).toMatchObject({ tipo: 'texto' })
    }
  })

  it('🚨 `.zip` e SVG caem em `tipo_nao_suportado` — e o tipo não aparece na frase', async () => {
    for (const tipo of ['application/zip', 'image/svg+xml', 'application/vnd.ms-excel', null]) {
      const d = deps()
      const r = await analisarAnexo(
        { nome: 'log.zip', tipoDeclarado: tipo, bytes: new Uint8Array([1, 2, 3]) },
        d,
      )
      expect(r.estado, String(tipo)).toBe('tipo_nao_suportado')
      // `RNF-30`: `Content-Type` vem do cliente e pode ser qualquer string.
      expect(r.descricao).not.toContain('zip')
      expect(r.descricao).not.toContain('svg')
      expect(d.ia.descricoesRecebidas, 'não paga chamada ao modelo').toHaveLength(0)
    }
  })
})

describe('as três formas de não ter lido (T-632)', () => {
  it('arquivo vazio é `sem_conteudo`, não falha', async () => {
    const r = await analisarAnexo(
      { nome: 'x.png', tipoDeclarado: 'image/png', bytes: new Uint8Array() },
      deps(),
    )
    expect(r.estado).toBe('sem_conteudo')
  })

  it('PDF sem texto é `sem_conteudo`; PDF que o worker não leu é `falhou`', async () => {
    const semTexto = await analisarAnexo(
      { nome: 'a.pdf', tipoDeclarado: 'application/pdf', bytes: PDF_BYTES },
      deps({ estado: 'sem_conteudo' }),
    )
    expect(semTexto.estado).toBe('sem_conteudo')

    const caiu = await analisarAnexo(
      { nome: 'a.pdf', tipoDeclarado: 'application/pdf', bytes: PDF_BYTES },
      deps({ estado: 'falhou', motivo: 'http_500' }),
    )
    expect(caiu.estado).toBe('falhou')
    // O rótulo é vocabulário nosso, e ajuda quem investiga.
    expect(caiu.descricao).toContain('http_500')
  })

  it('imagem grande demais é `sem_conteudo` — determinístico, sobre o arquivo', async () => {
    const d = deps()
    const grande = new Uint8Array(MAX_BYTES_IMAGEM + 1)
    grande[0] = 0x89
    const r = await analisarAnexo({ nome: 'g.png', tipoDeclarado: 'image/png', bytes: grande }, d)
    expect(r.estado).toBe('sem_conteudo')
    expect(d.ia.descricoesRecebidas, 'não manda MB ao provedor à toa').toHaveLength(0)
  })

  it('🚨 provedor fora vira `falhou` — e a MENSAGEM do erro não vaza para a tela', async () => {
    const d = deps()
    d.ia.falharDescricao = true
    const r = await analisarAnexo(
      { nome: 'x.png', tipoDeclarado: 'image/png', bytes: PNG_BYTES },
      d,
    )
    expect(r.estado).toBe('falhou')
    // `RNF-01`: mensagem de erro do provedor pode carregar corpo de resposta.
    expect(r.descricao).not.toContain('fake')
    expect(r.descricao).toMatch(/não consegui ler o arquivo agora/i)
  })

  it('nunca lança, nem quando o provedor explode com erro não-ErroIA', async () => {
    const ia = new ClienteIAFake()
    ia.descreverArquivo = async () => {
      throw new ErroIA('boom', { transitorio: true, etapa: 'descricao_arquivo' })
    }
    await expect(
      analisarAnexo(
        { nome: 'x.png', tipoDeclarado: 'image/png', bytes: PNG_BYTES },
        { ia, lerPdf: async () => ({ estado: 'sem_conteudo' }) },
      ),
    ).resolves.toMatchObject({ estado: 'falhou' })
  })
})
