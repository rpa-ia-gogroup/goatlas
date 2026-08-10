/**
 * A aba Documentação: **qual visão aparece**, e o que a tela diz enquanto carrega.
 *
 * ## Os dois defeitos, vistos no app real em 10/08/2026
 *
 * **1. Apagar o campo de busca não voltava para as categorias.** A tela decidia por
 * `busca !== null`, e o `onChange` mexia só em `termo`: a pessoa buscava, limpava o campo
 * esperando começar de novo, e a lista antiga continuava travada — sem caminho de volta para
 * navegar por espaço. Ficava presa num resultado ("Arquitetura de Pipelines") sem conseguir
 * entrar em outro espaço.
 *
 * O conserto **não** foi um `setBusca(null)` no `onChange`. Isso funcionaria hoje e voltaria
 * a quebrar no próximo lugar que mexer em `termo` sem lembrar de limpar o resto. A visão
 * passou a ser **derivada** (`visaoDaDocumentacao`) — estado derivado não desincroniza. É o
 * mesmo raciocínio de `bloqueio` × `temBloqueioPendente` (`D-21`).
 *
 * **2. Carregar os espaços era indistinguível de tela vazia.** `espacos` nascia `[]`, o
 * componente devolvia `null` para lista vazia, e durante o carregamento **não havia nada na
 * tela** — nem título, nem sinal. Agora são três estados, e o título aparece sempre.
 *
 * ⚠️ O terceiro estado (`falhou`) existe pelo motivo que `admin/paineis.tsx` já registra:
 * guardar `[]` numa queda de rede transforma falha em "não tem documentação", e manda a
 * pessoa abrir chamado por algo que está escrito.
 *
 * _Requirements: RF-37, RF-39, RF-41, RNF-18, RNF-19, RNF-30_
 */

import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import {
  EspacosNavegaveis,
  visaoDaDocumentacao,
  type CargaEspacos,
} from '@/app/confluence'

const PAGINA = { id: 'p1' }
const BUSCA = { itens: [] }

describe('apagar o campo volta para as categorias (o bug relatado)', () => {
  it('termo vazio com resultados velhos na memória → CATEGORIAS', () => {
    // O caso exato: buscou, veio resultado, apagou o texto. Antes ficava em `resultados`
    // para sempre, porque `busca` continuava preenchida.
    expect(visaoDaDocumentacao({ termo: '', busca: BUSCA, pagina: null })).toBe('categorias')
    expect(visaoDaDocumentacao({ termo: '   ', busca: BUSCA, pagina: null })).toBe('categorias')
  })

  it('com termo e resposta, resultados', () => {
    expect(visaoDaDocumentacao({ termo: 'pipeline', busca: BUSCA, pagina: null })).toBe(
      'resultados',
    )
  })

  it('termo digitado mas busca ainda não rodou → categorias, não resultados vazios', () => {
    // Digitar sem apertar Buscar não deve limpar a tela nem inventar "nenhum resultado".
    expect(visaoDaDocumentacao({ termo: 'pipe', busca: null, pagina: null })).toBe('categorias')
  })

  it('página aberta GANHA de tudo — inclusive de termo vazio', () => {
    // Quem chegou lendo (link, categoria ou resultado) continua lendo: a leitura tem o
    // próprio botão de voltar. Sem esta precedência, abrir página por `?pagina=` (sem termo)
    // cairia direto nas categorias e o deep link não funcionaria.
    expect(visaoDaDocumentacao({ termo: '', busca: null, pagina: PAGINA })).toBe('leitura')
    expect(visaoDaDocumentacao({ termo: 'x', busca: BUSCA, pagina: PAGINA })).toBe('leitura')
  })

  it('estado inicial, sem nada: categorias', () => {
    expect(visaoDaDocumentacao({ termo: '', busca: null, pagina: null })).toBe('categorias')
  })
})

function render(carga: CargaEspacos): string {
  return renderToStaticMarkup(
    createElement(EspacosNavegaveis, { carga, aoAbrir: () => {} }),
  )
}

describe('os três estados da lista de espaços', () => {
  it('CARREGANDO: título e aviso de carregamento — nunca tela em branco', () => {
    const saida = render({ estado: 'carregando' })
    expect(saida).toContain('Ou navegue pela documentação')
    expect(saida).toContain('Carregando os espaços da documentação')
    // `aria-live` para quem usa leitor de tela saber que algo mudou sozinho.
    expect(saida).toContain('aria-live="polite"')
  })

  it('PRONTO com itens: os espaços clicáveis', () => {
    const saida = render({
      estado: 'pronto',
      itens: [
        { chave: 'GT', nome: 'GO Tecnologia', homepageId: 'h1' },
        { chave: 'DTE', nome: 'Documentação Técnica Engenharia', homepageId: 'h2' },
      ],
    })
    expect(saida).toContain('GO Tecnologia')
    expect(saida).toContain('DTE')
    expect(saida).not.toContain('Carregando')
  })

  it('PRONTO e vazio: diz que é falta de CONFIGURAÇÃO, não de documentação', () => {
    const saida = render({ estado: 'pronto', itens: [] })
    // Antes isto era `null` — indistinguível de carregando. E a frase importa: "não há
    // documentação" mandaria a pessoa abrir chamado; "não foi liberado" diz o que é.
    expect(saida).toContain('Nenhum espaço foi liberado')
    expect(saida).toContain('Ou navegue pela documentação')
  })

  it('FALHOU: diz que a busca continua funcionando, em vez de sumir', () => {
    const saida = render({ estado: 'falhou' })
    expect(saida).toContain('Não conseguimos carregar os espaços')
    expect(saida).toContain('busca continua funcionando')
    // ⚠️ Nunca "não tem documentação": queda de rede não é ausência de conteúdo (`RNF-19`).
    expect(saida).not.toContain('Nenhum espaço foi liberado')
  })

  it('o título aparece nos TRÊS estados — é ele que diz que existe lista a caminho', () => {
    for (const carga of [
      { estado: 'carregando' } as const,
      { estado: 'falhou' } as const,
      { estado: 'pronto', itens: [] } as const,
    ]) {
      expect(render(carga)).toContain('Ou navegue pela documentação')
    }
  })
})
