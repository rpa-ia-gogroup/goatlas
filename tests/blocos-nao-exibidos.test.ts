/**
 * Os blocos que o goatlas não desenha — `RF-43`, `RNF-30`, regra 4 (PT-BR).
 *
 * ## O que estava errado, visto no app real em 10/08/2026
 *
 * A página inicial de um espaço apareceu assim:
 *
 * ```
 * Bloco não exibido
 * Esta página tem um bloco livesearch que o goatlas ainda não sabe mostrar.
 * O resto do conteúdo está completo.          ← três vezes, em inglês técnico
 * ```
 *
 * Dois defeitos, e o segundo é o grave:
 *
 * 1. **`livesearch` não é português nem significa nada** para quem quer resolver um
 *    problema. Regra 4 vale para todo texto visível.
 * 2. 🚨 **"O resto do conteúdo está completo" era FALSO ali.** A página inicial padrão de
 *    espaço é feita *só* desses blocos — não há "resto". A frase afirmava o contrário da
 *    verdade e insinuava que havia texto sendo escondido por nós.
 *
 * Não havia. Estes blocos são **gerados no momento da exibição**: o storage guarda "aqui vai
 * uma busca", nunca o resultado. Por isso não existe conserto do tipo "renderizar melhor" —
 * o que existe é dizer a verdade, e ela é diferente para bloco dinâmico, bloco que puxa
 * texto de outra página, e bloco desconhecido.
 *
 * ## Por que isso não é cosmético
 *
 * Quem abre a documentação e conclui que o app está quebrado **abre chamado** — o oposto
 * exato do que a tela existe para fazer (`RF-39`, deflexão). Uma página que parece vazia é
 * uma deflexão perdida.
 *
 * _Requirements: RF-39, RF-43, RNF-30_
 */

import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { sanitizarStorage } from '@/lib/confluence/sanitizar'
import { ConteudoConfluence, type OpcoesRender } from '@/lib/confluence/renderizar'

const OPCOES: OpcoesRender = {
  urlDeAnexo: (nome) => `/api/confluence/anexo/1/${encodeURIComponent(nome)}`,
  urlDePagina: (titulo) => `?q=${encodeURIComponent(titulo)}`,
}

/** O storage da página inicial padrão de espaço, como o Confluence a cria. */
const HOME_DE_ESPACO = [
  '<p>Descri&ccedil;&atilde;o</p>',
  '<ac:structured-macro ac:name="livesearch"><ac:parameter ac:name="spaceKey">GT</ac:parameter></ac:structured-macro>',
  '<ac:structured-macro ac:name="listlabels"><ac:parameter ac:name="spaceKey">GT</ac:parameter></ac:structured-macro>',
  '<ac:structured-macro ac:name="recently-updated"><ac:parameter ac:name="max">5</ac:parameter></ac:structured-macro>',
].join('')

function render(storage: string): string {
  const r = sanitizarStorage(storage)
  return renderToStaticMarkup(createElement(ConteudoConfluence, { nos: r.nos, opcoes: OPCOES }))
}

describe('a frase falsa saiu de vez', () => {
  it('nenhum bloco afirma mais que "o resto do conteúdo está completo"', () => {
    const saida = render(HOME_DE_ESPACO)
    // A frase antiga era dita POR BLOCO, então numa página só de blocos ela aparecia três
    // vezes negando o que a própria tela mostrava.
    expect(saida).not.toContain('O resto do conteúdo está completo')
  })

  it('e o nome técnico da macro não aparece mais para bloco conhecido', () => {
    const saida = render(HOME_DE_ESPACO)
    for (const tecnico of ['livesearch', 'listlabels', 'recently-updated']) {
      expect(saida).not.toContain(tecnico)
    }
  })

  it('no lugar dele, o que o bloco É, em português', () => {
    const saida = render(HOME_DE_ESPACO)
    expect(saida).toContain('Busca dentro deste espaço')
    expect(saida).toContain('Etiquetas usadas neste espaço')
    expect(saida).toContain('Páginas alteradas recentemente')
  })

  it('a explicação diz que o bloco é montado na hora — não que falhamos', () => {
    const saida = render(HOME_DE_ESPACO)
    expect(saida).toContain('montado pelo Confluence no momento em que a página abre')
    expect(saida).toContain('não guarda texto dele')
    // "não sabe mostrar" sugere defeito nosso; para bloco dinâmico não há o que mostrar.
    expect(saida).not.toContain('ainda não sabe mostrar este bloco')
  })
})

describe('a página inicial de espaço: o que dá e o que NÃO dá para melhorar', () => {
  it('o texto próprio da página continua aparecendo junto dos blocos', () => {
    const saida = render(HOME_DE_ESPACO)
    // ⚠️ Registro de um caminho tentado e descartado: um aviso no topo do tipo "esta página
    // é só um índice" NÃO cabe. A home padrão de espaço tem texto — o placeholder do
    // próprio Confluence — então o predicado honesto ("todos os nós são blocos?") é `false`
    // ali e o aviso nunca apareceria no caso real. Fazê-lo aparecer exigiria adivinhar que
    // aquele parágrafo é placeholder: heurística sobre conteúdo de terceiro.
    expect(saida).toContain('Descrição')
  })

  it('página inicial vazia é lacuna de DOCUMENTAÇÃO, e quem mede isso é RF-42', () => {
    // Não é a tela de leitura que resolve espaço sem conteúdo. O mapa de lacunas conta
    // busca sem resultado e resultado que ninguém abriu — é lá que "a home do GT está
    // vazia" aparece como trabalho de escrita, em vez de virar frase adivinhada na leitura.
    const saida = render(HOME_DE_ESPACO)
    expect(saida).not.toContain('índice do espaço')
  })
})

describe('as três naturezas levam a três frases, porque pedem três ações', () => {
  it('bloco que puxa texto de OUTRA página manda abrir a origem', () => {
    const saida = render('<ac:structured-macro ac:name="include"></ac:structured-macro>')
    expect(saida).toContain('Trecho de outra página')
    expect(saida).toContain('Abra a página de origem')
    // Não é dinâmico: aqui o texto existe, só não está aqui.
    expect(saida).not.toContain('montado pelo Confluence no momento')
  })

  it('bloco DESCONHECIDO continua honesto — e aí sim mostra o nome, que é a única pista', () => {
    const saida = render('<ac:structured-macro ac:name="widget-exotico"></ac:structured-macro>')
    expect(saida).toContain('ainda não sabe mostrar este bloco')
    expect(saida).toContain('widget-exotico')
    // E este é o único caso em que "o texto ao redor está completo" é verdade.
    expect(saida).toContain('O texto ao redor está completo')
  })

  it('macro de layout continua sem sinalizar nada — o conteúdo é que importa', () => {
    const saida = render(
      '<ac:structured-macro ac:name="section"><ac:rich-text-body><p>dentro</p></ac:rich-text-body></ac:structured-macro>',
    )
    expect(saida).toContain('dentro')
    expect(saida).not.toContain('Bloco não exibido')
  })
})

describe('o parâmetro da macro continua fora da tela (RNF-30)', () => {
  it('`spaceKey`, JQL e id de filtro não aparecem — nem para bloco conhecido', () => {
    const saida = render(
      '<ac:structured-macro ac:name="jira"><ac:parameter ac:name="jql">project = SEGREDO</ac:parameter></ac:structured-macro>',
    )
    expect(saida).toContain('Lista de chamados do Jira')
    // Parâmetro descreve estrutura interna e pode citar projeto que quem lê não deveria
    // conhecer. A invariante não mudou com a copy nova.
    expect(saida).not.toContain('SEGREDO')
    expect(saida).not.toContain('jql')
  })
})

describe('o bloco de busca vira busca DE VERDADE quando a tela oferece o caminho', () => {
  it('com `aoBuscarNoEspaco`, sai um campo de busca — não o placeholder', () => {
    const r = sanitizarStorage('<ac:structured-macro ac:name="livesearch"></ac:structured-macro>')
    const saida = renderToStaticMarkup(
      createElement(ConteudoConfluence, {
        nos: r.nos,
        opcoes: { ...OPCOES, aoBuscarNoEspaco: () => {} },
      }),
    )
    expect(saida).toContain('Buscar neste espaço')
    expect(saida).toContain('type="search"')
    // A explicação de "não há o que trazer" sai de cena: agora há o que fazer.
    expect(saida).not.toContain('não guarda texto dele')
  })

  it('SEM o callback continua o placeholder honesto — trecho de busca e SSR', () => {
    // ⚠️ Caixa de busca que não busca é pior que a explicação. É por isso que o campo é
    // opcional em vez de sempre presente.
    const saida = render('<ac:structured-macro ac:name="livesearch"></ac:structured-macro>')
    expect(saida).toContain('Busca dentro deste espaço')
    expect(saida).not.toContain('type="search"')
  })

  it('e o botão nasce desabilitado: dois caracteres é o mínimo da rota', () => {
    const r = sanitizarStorage('<ac:structured-macro ac:name="livesearch"></ac:structured-macro>')
    const saida = renderToStaticMarkup(
      createElement(ConteudoConfluence, {
        nos: r.nos,
        opcoes: { ...OPCOES, aoBuscarNoEspaco: () => {} },
      }),
    )
    // Sem isto o clique viraria 400 do servidor — erro para quem não errou nada.
    expect(saida).toContain('disabled')
  })
})
