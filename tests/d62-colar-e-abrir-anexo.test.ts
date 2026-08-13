/**
 * **`D-62`** — o Ctrl+V não colava, o segundo print parecia não existir, e o anexo não abria.
 *
 * Três relatos de quem usou o app de verdade, no mesmo dia:
 *
 * 1. *"só consigo enviar um anexo se clicar fora do campo de texto"* — o `onPaste` vivia no
 *    `textarea`, e `clipboardData.files` vem **vazio** para print de algumas origens.
 * 2. *"dei Ctrl+V novamente e não inseriu nada"* — todo print colado chega como `image.png`,
 *    e a lista de envios era indexada por nome: o segundo substituía a linha do primeiro
 *    **enquanto o arquivo subia**. Dois anexos, uma linha.
 * 3. *"deve ser possível clicar no anexo e abrir"* — o `<a download>` forçava salvar em disco
 *    até nos tipos que o servidor já entrega `inline`, e o `.md` da transcrição (`D-54`) não
 *    era exibível de jeito nenhum.
 *
 * ## Por que estes três casos e não um teste de tela
 *
 * A suíte roda em `environment: 'node'`: não há clique nem `paste`. O que dá para travar é a
 * **decisão** — quais arquivos saem de um clipboard, qual nome evita a colisão, e o que o
 * servidor afirma para cada tipo. É o mesmo desenho de `ROTULOS_ENVIO` e `LinhaDePessoa`:
 * extrair a regra para uma função pura é o que a torna testável sem DOM.
 *
 * _Requirements: RF-31, RF-61, RF-63, RNF-06, RNF-28_
 */

import { describe, expect, it } from 'vitest'
import { arquivosDoColar, nomeUnicoDeAnexo } from '@/app/anexo'
import { decidirEntrega, TIPO_OPACO } from '@/lib/confluence/anexo'

/** Um `DataTransfer` de mentira: só o que `arquivosDoColar` lê. */
function clipboard(opcoes: {
  files?: readonly File[]
  items?: readonly { kind: string; arquivo?: File }[]
}): DataTransfer {
  return {
    files: (opcoes.files ?? []) as unknown as FileList,
    items: (opcoes.items ?? []).map((i) => ({
      kind: i.kind,
      getAsFile: () => i.arquivo ?? null,
    })) as unknown as DataTransferItemList,
  } as unknown as DataTransfer
}

const print = () => new File([new Uint8Array([1, 2, 3])], 'image.png', { type: 'image/png' })

describe('de onde vêm os arquivos de um Ctrl+V (D-62)', () => {
  it('lê `files` quando ele vem preenchido', () => {
    const arquivos = arquivosDoColar(clipboard({ files: [print()] }))
    expect(arquivos.map((a) => a.name)).toEqual(['image.png'])
  })

  it('🚨 lê `items` quando `files` vem VAZIO — era o Ctrl+V que não fazia nada', () => {
    // Print da ferramenta de captura, "copiar imagem" de uma página: o Chrome expõe o
    // arquivo só em `items[]`. Ler apenas `files` devolvia zero, sem erro na tela.
    const arquivos = arquivosDoColar(clipboard({ items: [{ kind: 'file', arquivo: print() }] }))
    expect(arquivos.map((a) => a.name)).toEqual(['image.png'])
  })

  it('🚨 NÃO soma as duas fontes — seria o mesmo anexo em dobro, e não há desfazer', () => {
    const arquivos = arquivosDoColar(
      clipboard({ files: [print()], items: [{ kind: 'file', arquivo: print() }] }),
    )
    expect(arquivos).toHaveLength(1)
  })

  it('colar TEXTO continua sendo colar texto', () => {
    // `kind: 'string'` é o parágrafo que a pessoa copiou. Interceptar isso seria trocar um
    // defeito por outro pior: atingiria quem só quer escrever.
    expect(arquivosDoColar(clipboard({ items: [{ kind: 'string' }] }))).toEqual([])
    expect(arquivosDoColar(null)).toEqual([])
  })
})

describe('o segundo print não desaparece (D-62)', () => {
  it('🚨 nome repetido ganha sufixo — dois `image.png` são duas linhas', () => {
    expect(nomeUnicoDeAnexo('image.png', [])).toBe('image.png')
    expect(nomeUnicoDeAnexo('image.png', ['image.png'])).toBe('image (2).png')
    expect(nomeUnicoDeAnexo('image.png', ['image.png', 'image (2).png'])).toBe('image (3).png')
  })

  it('o sufixo vem antes da extensão, e nome sem extensão também funciona', () => {
    expect(nomeUnicoDeAnexo('log.tar.gz', ['log.tar.gz'])).toBe('log.tar (2).gz')
    expect(nomeUnicoDeAnexo('captura', ['captura'])).toBe('captura (2)')
  })
})

describe('o que o servidor afirma para cada tipo (D-62 sobre D-11)', () => {
  it('imagem e PDF continuam inline, com o tipo afirmado igual ao declarado', () => {
    expect(decidirEntrega('image/png')).toEqual({
      contentType: 'image/png',
      disposicao: 'inline',
    })
    expect(decidirEntrega('application/pdf').disposicao).toBe('inline')
  })

  it('🚨 a transcrição (`text/markdown`) sai como `text/plain` COM charset', () => {
    // `text/markdown` faz o navegador baixar; sem `charset` o acento quebra na única
    // superfície feita para ler (regra 4). O app afirma, nunca repassa.
    expect(decidirEntrega('text/markdown')).toEqual({
      contentType: 'text/plain; charset=utf-8',
      disposicao: 'inline',
    })
  })

  it('🚨 `text/html` e `image/svg+xml` continuam FORA — os dois executam no nosso domínio', () => {
    for (const tipo of ['text/html', 'image/svg+xml']) {
      expect(decidirEntrega(tipo), tipo).toEqual({
        contentType: TIPO_OPACO,
        disposicao: 'attachment',
      })
    }
  })

  it('tipo com quebra de linha não vira cabeçalho, mesmo parecendo um da lista', () => {
    expect(decidirEntrega('text/plain\r\nSet-Cookie: a=b').contentType).toBe(TIPO_OPACO)
  })
})
