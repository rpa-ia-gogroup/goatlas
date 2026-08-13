/**
 * Cada tela tem URL, e o ← do navegador volta um passo — `D-64`.
 *
 * Relato do mantenedor usando o app publicado: *"não dá pra voltar pra lista de categorias
 * apenas dando ← no navegador"*. Tudo morava em `/`, e o único registro de estado na URL era
 * escrito com **`replaceState`** — que **substitui** a entrada atual. Abrir cinco páginas do
 * Confluence deixava o histórico com **uma** entrada, e o ← saía do app.
 *
 * ⚠️ A suíte roda em `environment: 'node'`: não há `window`, `history` nem clique. O que se
 * afirma aqui é a **decisão** — caminho ↔ tela, e o contrato de três pontas do link de
 * deflexão. É o mesmo desenho de `ROTULOS_ENVIO` e `LinhaDePessoa`: extrair a regra para
 * função pura é o que a torna testável sem DOM.
 *
 * _Requirements: RF-12, RF-13, RF-40, R-07_
 */

import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { caminhoDaTela, telaDoCaminho, type Tela } from '@/app/rotas'
import { entradaDaUrl } from '@/app/confluence'
import { urlDeLeituraNoApp } from '@/lib/rules'
import { TextoDoAgente } from '@/app/componentes'

const TELAS: readonly Tela[] = [
  { nome: 'conversa' },
  { nome: 'documentacao' },
  { nome: 'chamados' },
  { nome: 'formulario' },
  { nome: 'avisos' },
  { nome: 'admin' },
  { nome: 'detalhe', issueKey: 'GN-6903' },
]

describe('D-64 — caminho ↔ tela', () => {
  it('toda tela tem caminho, e o caminho volta para a MESMA tela', () => {
    // Ida e volta é o que impede o par de divergir: um caminho novo sem leitura
    // correspondente abriria a conversa em vez da tela, sem erro nenhum.
    for (const tela of TELAS) {
      expect(telaDoCaminho(caminhoDaTela(tela)), caminhoDaTela(tela)).toEqual(tela)
    }
  })

  it('os caminhos são distintos, em português e fora de `/api`', () => {
    const caminhos = TELAS.map(caminhoDaTela)
    expect(new Set(caminhos).size).toBe(caminhos.length)
    for (const c of caminhos) {
      expect(c.startsWith('/')).toBe(true)
      // `/api` é do Worker: um caminho de tela ali seria servido pelo servidor, nunca
      // pela SPA — e o sintoma apareceria só no deploy.
      expect(c.startsWith('/api')).toBe(false)
    }
  })

  it('a raiz é a conversa — link para o app sem caminho tem de chegar em algum lugar', () => {
    expect(telaDoCaminho('/')).toEqual({ nome: 'conversa' })
    expect(telaDoCaminho('')).toEqual({ nome: 'conversa' })
  })

  it('caminho desconhecido cai na conversa, nunca em erro', () => {
    // URL digitada errada, link velho e caminho de uma versão futura são a mesma coisa
    // para quem lê: chegar em algum lugar útil é melhor que uma tela de "rota não
    // encontrada" num app de sete telas.
    expect(telaDoCaminho('/nao-existe')).toEqual({ nome: 'conversa' })
    expect(telaDoCaminho('/documentacao/algo/mais')).toEqual({ nome: 'documentacao' })
  })

  it('🚨 a leitura é EXATA por segmento, não `startsWith`', () => {
    // `/documentacao-antiga` não é `/documentacao`; tratá-lo como se fosse abriria a aba
    // errada sem nada na tela dizendo.
    expect(telaDoCaminho('/documentacao-antiga')).toEqual({ nome: 'conversa' })
    expect(telaDoCaminho('/meus-chamados-de-teste')).toEqual({ nome: 'conversa' })
  })

  it('o detalhe vive DENTRO de meus-chamados, e sem chave é a lista', () => {
    // O botão "voltar" do detalhe já levava à lista; agora o ← do navegador faz o mesmo.
    expect(caminhoDaTela({ nome: 'detalhe', issueKey: 'GN-1' })).toBe('/meus-chamados/GN-1')
    expect(telaDoCaminho('/meus-chamados')).toEqual({ nome: 'chamados' })
  })

  it('chave com caractere especial sobrevive à ida e volta', () => {
    const tela: Tela = { nome: 'detalhe', issueKey: 'GN 1/2&3' }
    expect(telaDoCaminho(caminhoDaTela(tela))).toEqual(tela)
  })
})

describe('D-64 — o contrato do link de deflexão tem TRÊS pontas', () => {
  it('`urlDeLeituraNoApp` escreve o caminho da aba, não a raiz', () => {
    // Em `/` o app abre a conversa: a leitura só aparecia porque `?pagina=` a desviava, e
    // por isso o ← saía do app em vez de devolver a lista de categorias.
    expect(urlDeLeituraNoApp('77')).toBe('/documentacao?pagina=77')
    expect(telaDoCaminho('/documentacao')).toEqual({ nome: 'documentacao' })
  })

  it('o que `rules/` escreve, `entradaDaUrl` lê de volta', () => {
    const url = urlDeLeituraNoApp('abc-123_XY')
    expect(entradaDaUrl(url.slice(url.indexOf('?')))).toEqual({ pagina: 'abc-123_XY' })
  })

  it('🚨 e a TERCEIRA ponta é a allowlist de forma do texto do agente', () => {
    // Esquecer esta faria o link continuar APARECENDO na conversa e deixar de ser
    // clicável: a mensagem de `RF-12` intacta, e o clique morrendo em silêncio.
    const html = renderToStaticMarkup(
      createElement(TextoDoAgente, { texto: `Veja [aqui](${urlDeLeituraNoApp('77')}).` }),
    )
    expect(html).toContain(`href="${urlDeLeituraNoApp('77')}"`)
    expect(html).toContain('target="_blank"')
  })

  it('BURLA — o caminho ANTIGO deixou de ser aceito', () => {
    // Padrão é um só. Link velho colado pelo modelo não pode virar clique para uma forma
    // que já não existe, nem abrir exceção na allowlist de `R-07`.
    const html = renderToStaticMarkup(
      createElement(TextoDoAgente, { texto: 'Clique [aqui](/?pagina=77) agora.' }),
    )
    expect(html).not.toContain('href=')
    expect(html).toContain('aqui')
  })
})
