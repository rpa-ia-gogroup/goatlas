/**
 * `RF-43` — os dois defeitos de fidelidade que a aba Documentação mostrava no app real
 * (medidos em 10/08/2026, na página inicial do espaço de documentação da Gocase).
 *
 * Nenhum dos dois dava erro, quebrava teste ou aparecia em log. Os dois produziam **tela
 * errada**, que é o único lugar onde `RF-43` pode falhar:
 *
 * 1. **Painel do editor novo saía DUAS VEZES** — uma do nó ADF, outra do fallback em HTML
 *    que a Atlassian grava junto. Como o fallback estava em inglês, a página mostrava o
 *    mesmo painel com o título em português e logo abaixo em inglês. Quem vê conteúdo
 *    repetido conclui que o app quebrou, e quem conclui isso abre chamado — o oposto do
 *    que a aba existe para fazer.
 * 2. **A macro `status` virava "o atlas ainda não sabe mostrar este bloco"** — acusando
 *    limitação nossa sobre um texto que estava no storage, num parâmetro, a uma linha de
 *    distância. É a macro que marca "Concluído"/"Em andamento" em página de processo.
 *
 * As asserções são sobre o HTML que chegaria ao navegador, como em
 * `rnf06-sanitizacao.test.ts`: árvore certa que o renderizador desenha errado não conserta
 * nada. E a nº 1 afirma **contagem**, não presença — presença passava antes do conserto.
 *
 * _Requirements: RF-43, RF-39, RNF-06, RNF-30_
 */

import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { sanitizarStorage, textoDe } from '@/lib/confluence/sanitizar'
import { renderizarNos } from '@/lib/confluence/renderizar'

const OPCOES_RENDER = {
  urlDeAnexo: (nome: string) => `/api/confluence/anexo/p1/${encodeURIComponent(nome)}`,
  urlDePagina: (titulo: string) => `/confluence/pagina?titulo=${encodeURIComponent(titulo)}`,
}

function markup(storage: string): string {
  const { nos } = sanitizarStorage(storage)
  return renderToStaticMarkup(renderizarNos(nos, OPCOES_RENDER))
}

function vezes(texto: string, agulha: string): number {
  return texto.split(agulha).length - 1
}

/**
 * A forma real do painel do editor novo: o nó com o conteúdo **e** o fallback com uma cópia
 * em HTML. Os dois lados existem em toda página escrita no editor atual do Confluence.
 */
const PAINEL_ADF = `
<ac:adf-extension>
  <ac:adf-node type="panel">
    <ac:adf-attribute key="panel-icon-id">1f5d1</ac:adf-attribute>
    <ac:adf-attribute key="panel-color">#c9372c</ac:adf-attribute>
    <ac:adf-attribute key="panel-type">info</ac:adf-attribute>
    <ac:adf-content>
      <p>Bem-vindo ao espaço de documentação!</p>
      <ul><li><p>Explique como este espaço deve ser usado</p></li></ul>
    </ac:adf-content>
  </ac:adf-node>
  <ac:adf-fallback>
    <div class="panel"><div class="panelContent">
      <p>Welcome to your documentation space!</p>
      <ul><li><p>Explique como este espaço deve ser usado</p></li></ul>
    </div></div>
  </ac:adf-fallback>
</ac:adf-extension>`

describe('RF-43 — painel do editor novo (ADF) aparece uma vez só', () => {
  it('renderiza o conteúdo do nó UMA vez, e não também o fallback', () => {
    const html = markup(PAINEL_ADF)

    // A asserção que pega o bug: antes do conserto era 2.
    expect(vezes(html, 'Explique como este espaço deve ser usado')).toBe(1)
    expect(vezes(html, 'Bem-vindo ao espaço de documentação!')).toBe(1)
  })

  it('prefere o nó ao fallback — é o nó que está no idioma da página', () => {
    const html = markup(PAINEL_ADF)

    expect(html).toContain('Bem-vindo ao espaço de documentação!')
    // O fallback que a Atlassian grava vinha em inglês. Preferi-lo funcionaria e entregaria
    // a tradução errada — em violação da regra 4 na única superfície feita para ler.
    expect(html).not.toContain('Welcome to your documentation space!')
  })

  it('traduz `panel-type` para a variante de painel que a macro antiga já tinha', () => {
    const html = markup(PAINEL_ADF.replace('>info<', '>warning<'))

    // `aviso` — o mesmo painel que `<ac:structured-macro ac:name="warning">` produz.
    expect(html).toContain('data-variante="aviso"')
    expect(html).toContain('Atenção')
  })

  it('`panel-type` desconhecido continua desenhando o painel, nunca sumindo com o texto', () => {
    const html = markup(PAINEL_ADF.replace('>info<', '>custom<'))

    expect(html).toContain('data-variante="nota"')
    expect(html).toContain('Bem-vindo ao espaço de documentação!')
  })

  it('valor de `ac:adf-attribute` NUNCA vira texto visível', () => {
    const html = markup(PAINEL_ADF)

    // Desembrulhados como tag desconhecida, os atributos imprimiriam `1f5d1 #c9372c info`
    // solto antes do painel. Além de ruído, é parâmetro na tela — `RNF-30`.
    expect(html).not.toContain('1f5d1')
    expect(html).not.toContain('c9372c')
  })

  it('nó ADF sem conteúdo próprio CAI no fallback — é o caminho dos blocos inline', () => {
    // `status`, `date` e afins guardam o texto nos atributos e trazem a macro equivalente
    // dentro do fallback. Regra "só o nó" faria toda etiqueta do editor novo desaparecer.
    const html = markup(`
      <p>Situação:
      <ac:adf-extension>
        <ac:adf-node type="status">
          <ac:adf-attribute key="text">Concluído</ac:adf-attribute>
          <ac:adf-attribute key="color">green</ac:adf-attribute>
        </ac:adf-node>
        <ac:adf-fallback>
          <ac:structured-macro ac:name="status">
            <ac:parameter ac:name="colour">Green</ac:parameter>
            <ac:parameter ac:name="title">Concluído</ac:parameter>
          </ac:structured-macro>
        </ac:adf-fallback>
      </ac:adf-extension></p>`)

    expect(html).toContain('doc-etiqueta')
    expect(vezes(html, 'Concluído')).toBe(1)
    expect(html).not.toContain('não sabe mostrar')
  })

  it('sem conteúdo e sem fallback, o placeholder de RF-43 diz que veio do editor novo', () => {
    const { nos, descartes } = sanitizarStorage(
      '<ac:adf-extension><ac:adf-node type="inlineCard"/></ac:adf-extension>',
    )

    expect(nos).toEqual([{ tipo: 'macroNaoSuportada', nome: 'adf:inlineCard' }])
    // O sinal continua indo para a auditoria: é dela que sai o que vale implementar.
    expect(descartes).toContainEqual({ motivo: 'macro_nao_suportada', detalhe: 'adf:inlineCard' })
  })

  it('o fallback passa pela MESMA allowlist — não é atalho para dentro', () => {
    const html = markup(`
      <ac:adf-extension>
        <ac:adf-node type="panel"/>
        <ac:adf-fallback><div><script>alert(1)</script><p onclick="x()">texto</p></div></ac:adf-fallback>
      </ac:adf-extension>`)

    expect(html).not.toMatch(/<script/i)
    expect(html).not.toMatch(/\son[a-z]+\s*=/i)
    expect(html).toContain('texto')
  })
})

describe('RF-43 — a macro `status` é uma etiqueta, não um bloco não exibido', () => {
  const status = (parametros: string) =>
    `<p><ac:structured-macro ac:name="status">${parametros}</ac:structured-macro></p>`

  it('mostra o título da etiqueta em vez do placeholder', () => {
    const html = markup(status('<ac:parameter ac:name="title">Em andamento</ac:parameter>'))

    expect(html).toContain('Em andamento')
    expect(html).toContain('doc-etiqueta')
    // A frase que aparecia no app real, acusando limitação nossa sobre texto que existia.
    expect(html).not.toContain('não sabe mostrar')
  })

  it('decodifica entidade no título — regra 4 vale aqui como em todo texto visível', () => {
    const html = markup(status('<ac:parameter ac:name="title">Conclu&iacute;do</ac:parameter>'))

    expect(html).toContain('Concluído')
    expect(html).not.toContain('&amp;iacute;')
  })

  it('NÃO leva a cor para a tela', () => {
    const html = markup(
      status(
        '<ac:parameter ac:name="colour">Red</ac:parameter>' +
          '<ac:parameter ac:name="title">Bloqueado</ac:parameter>',
      ),
    )

    // A identidade não tem vermelho nem verde (§1.3) e estado nunca é comunicado só por
    // cor: quem diz o estado é a palavra. Uma classe/atributo por cor reabriria as duas
    // coisas de uma vez.
    expect(html).toContain('Bloqueado')
    expect(html.toLowerCase()).not.toContain('red')
  })

  it('sem título não desenha nada — e não finge que há conteúdo escondido', () => {
    const { nos } = sanitizarStorage(status('<ac:parameter ac:name="colour">Grey</ac:parameter>'))

    // Etiqueta vazia não carrega informação. O placeholder ali seria o erro oposto:
    // anunciar conteúdo que não existe.
    expect(nos).toEqual([])
  })

  it('entra no texto puro, porque é conteúdo da página', () => {
    const { nos } = sanitizarStorage(
      `<p>Situação: ${status('<ac:parameter ac:name="title">Concluído</ac:parameter>')}</p>`,
    )

    // O trecho de busca precisa dessa palavra: é ela que diz se vale abrir a página.
    expect(textoDe(nos)).toContain('Concluído')
  })
})
