/**
 * **T-114** — a tela de busca e leitura, nas partes que dá para checar sem navegador.
 *
 * O foco não é aparência: é **o que a tela afirma**. Três coisas que só o teste
 * garante, porque as três são silenciosas quando quebram:
 *
 * 1. **Os três vazios continuam três.** O servidor distingue "sem espaço configurado"
 *    de "nada documentado" (`buscaConfigurada`), e essa distinção só serve se chegar à
 *    tela. Se a interface disser "nada encontrado" nos dois casos, o trabalho do
 *    servidor foi jogado fora e a pessoa reescreve o termo para sempre.
 * 2. **Imagem sai pelo proxy do app** (`RNF-02`). Um `src` apontando para
 *    `atlassian.net` faria o navegador falar com a Atlassian — sem credencial, e contra
 *    o requisito.
 * 3. **A árvore continua inerte depois de passar pela TELA.** `renderizarNos` já tem
 *    teste próprio; aqui o caminho é o componente de página inteiro, que é o que o
 *    navegador realmente monta.
 *
 * _Requirements: RF-37, RF-39, RF-42, RNF-02, RNF-06, RNF-28_
 */

import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import {
  entradaDaUrl,
  LeituraDaPagina,
  opcoesDeRender,
  ResultadosDaBusca,
} from '@/app/confluence'
import type { PaginaLida, RespostaBusca } from '@/app/api'
import type { No } from '@/lib/confluence/sanitizar'

const semAcao = () => {}

function resultados(resposta: RespostaBusca): string {
  return renderToStaticMarkup(
    createElement(ResultadosDaBusca, { resposta, aoAbrir: semAcao, aoConversar: semAcao }),
  )
}

function leitura(pagina: PaginaLida): string {
  return renderToStaticMarkup(createElement(LeituraDaPagina, { pagina, aoVoltar: semAcao }))
}

const PAGINA_BASE: PaginaLida = {
  id: '77',
  titulo: 'Como reprocessar o relatório',
  espaco: 'TECH',
  atualizadoEm: '2026-08-01T10:00:00.000Z',
  urlOriginal: 'https://goengenharia.atlassian.net/wiki/spaces/TECH/pages/77',
  nos: [],
  truncado: false,
}

describe('RF-42 — os três vazios são três telas diferentes', () => {
  it('sem espaço configurado: diz que é configuração, e NÃO diz "nada encontrado"', async () => {
    const html = resultados({ termo: 'home office', buscaConfigurada: false, itens: [] })
    expect(html).toMatch(/não foi liberada para nenhum espaço/i)
    expect(html).toMatch(/time de tech/i)
    // O erro de sempre: tratar os dois zeros como o mesmo zero.
    expect(html).not.toMatch(/nada encontrado/i)
  })

  it('zero resultados com espaço configurado: nomeia o termo e oferece o agente', async () => {
    const html = resultados({ termo: 'home office', buscaConfigurada: true, itens: [] })
    expect(html).toMatch(/nada encontrado/i)
    expect(html).toContain('home office')
    // Vazio é convite para agir, não beco: a lacuna vira conversa (RF-42 → RF-09).
    expect(html).toMatch(/falar com o agente/i)
  })

  it('com resultados: título, espaço e trecho — e o score NÃO aparece', async () => {
    const html = resultados({
      termo: 'relatório',
      buscaConfigurada: true,
      itens: [
        {
          id: '77',
          titulo: 'Como reprocessar o relatório',
          espaco: 'TECH',
          trecho: 'Abra o painel de tarefas e rode a rotina.',
          score: 0.91,
          urlOriginal: 'https://goengenharia.atlassian.net/wiki/x',
        },
      ],
    })
    expect(html).toContain('Como reprocessar o relatório')
    expect(html).toContain('TECH')
    expect(html).toContain('Abra o painel de tarefas')
    // 0,91 na tela é número decorativo: a pessoa não pode fazer nada com ele.
    expect(html).not.toContain('0.91')
    expect(html).toMatch(/1 página para/)
  })

  it('a contagem concorda em número — plural não é detalhe em PT-BR', async () => {
    const item = {
      id: 'a',
      titulo: 'A',
      espaco: 'TECH',
      trecho: '',
      score: 0.5,
      urlOriginal: '',
    }
    const html = resultados({
      termo: 'x',
      buscaConfigurada: true,
      itens: [item, { ...item, id: 'b', titulo: 'B' }],
    })
    expect(html).toMatch(/2 páginas para/)
  })
})

describe('RNF-02 — o navegador não fala com a Atlassian', () => {
  it('imagem de anexo aponta para o PROXY do app, com o id da página', async () => {
    const nos: No[] = [
      { tipo: 'imagem', origem: { tipo: 'anexo', nomeArquivo: 'diagrama de fluxo.png' }, alt: 'Fluxo' },
    ]
    const html = leitura({ ...PAGINA_BASE, nos })
    expect(html).toContain('src="/api/confluence/anexo/77/diagrama%20de%20fluxo.png"')
    // Nenhum `src` para a Atlassian: o navegador não tem credencial e não deve ter.
    expect(html).not.toMatch(/src="https:\/\/[^"]*atlassian\.net/)
  })

  it('a rota de anexo leva o id da página — é ele que amarra anexo à página verificada', async () => {
    expect(opcoesDeRender('99').urlDeAnexo('a b.png')).toBe(
      '/api/confluence/anexo/99/a%20b.png',
    )
    // Link para outra página do Confluence cai na busca pelo título: o storage dá
    // título, não id, e a rota de leitura pede id (T-115 traz a navegação de verdade).
    expect(opcoesDeRender('99').urlDePagina('Padrão de nomes')).toBe(
      '/?q=Padr%C3%A3o%20de%20nomes',
    )
  })

  it('o link para o Confluence DIZ que precisa de conta', async () => {
    // Quem lê aqui normalmente não tem assento. Rótulo que esconde isso transforma o
    // link numa pequena traição — a pessoa clica e cai num login.
    const html = leitura(PAGINA_BASE)
    expect(html).toMatch(/precisa de conta atlassian/i)
  })
})

describe('RNF-06 — a árvore continua inerte depois de passar pela tela', () => {
  it('nós hostis montados à mão não produzem marcação executável', async () => {
    // Nó construído à mão não é nó confiável (cache, importação, bug). A tela é a
    // última camada antes do navegador.
    const nos: No[] = [
      { tipo: 'paragrafo', filhos: [{ tipo: 'texto', texto: '<script>alert(1)</script>' }] },
      {
        tipo: 'link',
        destino: { tipo: 'externo', url: 'javascript:alert(1)' },
        filhos: [{ tipo: 'texto', texto: 'clique' }],
      },
      {
        tipo: 'imagem',
        origem: { tipo: 'externa', url: 'data:text/html,<script>' },
        alt: 'x',
      },
    ]
    const html = leitura({ ...PAGINA_BASE, nos })
    for (const vetor of [/<script/i, /javascript:/i, /data:/i, /\son[a-z]+\s*=/i]) {
      expect(html, `vetor ${vetor} vazou na tela`).not.toMatch(vetor)
    }
    // O texto continua legível — sanitizar não é apagar a página.
    expect(html).toContain('alert(1)')
    expect(html).toContain('clique')
  })

  it('página truncada avisa na tela', async () => {
    const html = leitura({ ...PAGINA_BASE, truncado: true, nos: [{ tipo: 'texto', texto: 'oi' }] })
    expect(html).toMatch(/foi cortada|é longa/i)
  })

  it('data inválida não vira "01/01/1970" na cara de quem lê', async () => {
    // Metadado quebrado faz a pessoa duvidar do conteúdo inteiro.
    for (const iso of ['', 'não é data', new Date(0).toISOString()]) {
      const html = leitura({ ...PAGINA_BASE, atualizadoEm: iso })
      expect(html, iso).not.toContain('1970')
      expect(html, iso).toMatch(/página do confluence/i)
    }
  })
})

describe('deep link — como um colega compartilha uma página', () => {
  it('`?pagina=` e `?q=` são lidos, e `pagina` tem precedência', async () => {
    expect(entradaDaUrl('?pagina=77')).toEqual({ pagina: '77' })
    expect(entradaDaUrl('?q=reprocessar')).toEqual({ termo: 'reprocessar' })
    expect(entradaDaUrl('?pagina=77&q=x')).toEqual({ pagina: '77', termo: 'x' })
  })

  it('URL sem nada, ou com valor vazio, não abre a documentação por engano', async () => {
    expect(entradaDaUrl('')).toEqual({})
    expect(entradaDaUrl('?q=%20%20')).toEqual({})
    expect(entradaDaUrl('?outra=coisa')).toEqual({})
  })
})
