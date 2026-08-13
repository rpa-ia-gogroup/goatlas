/**
 * Coluna de etiquetas é centralizada; coluna de texto, nunca — `D-66`.
 *
 * Relato do mantenedor sobre a tabela "Versões" (`DTE:11632894`): *"centralize Status entre
 * Escopo e Data de finalização, ele ficou todo pra esquerda"*. A coluna `Status` tem **451px**
 * porque as cinco pílulas de estado a exigem — não é sobra mal distribuída (medido no
 * navegador: `width: max-content` dá exatamente o mesmo tamanho). Sobra um rótulo de seis
 * letras encostado à esquerda de meio metro de coluna.
 *
 * ⚠️ **`th { text-align: center }` global foi MEDIDO e recusado.** No "Glossário de Sistemas"
 * (26 linhas, coluna de 372px de link) os cabeçalhos **coincidem** com o começo dos dados —
 * `Cloud` exatamente sobre `k8s`. Centralizar todos consertaria uma tabela e estragaria as
 * outras. Por isso a condição é **estrutural**, e é ela que estes casos afirmam.
 *
 * _Requirements: RF-39, RF-43_
 */

import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { sanitizarStorage } from '@/lib/confluence/sanitizar'
import { renderizarNos } from '@/lib/confluence/renderizar'

const OPCOES = {
  urlDeAnexo: (n: string) => `/api/confluence/anexo/p1/${encodeURIComponent(n)}`,
  urlDePagina: (t: string) => `/documentacao?q=${encodeURIComponent(t)}`,
}

const markup = (storage: string) =>
  renderToStaticMarkup(renderizarNos(sanitizarStorage(storage).nos, OPCOES))

const etiqueta = (texto: string) =>
  `<ac:structured-macro ac:name="status"><ac:parameter ac:name="title">${texto}</ac:parameter></ac:structured-macro>`

/** A forma medida em "Versões": cabeçalho, e uma linha só com pílulas na 4ª coluna. */
const VERSOES =
  '<table><thead><tr>' +
  '<th>Nome da versão</th><th>Valor que agrega</th><th>Escopo</th><th>Status</th><th>Data de finalização</th>' +
  '</tr></thead><tbody><tr>' +
  '<td></td><td></td><td></td>' +
  `<td>${etiqueta('Para fazer')} / ${etiqueta('Em andamento')} / ${etiqueta('Concluído')}</td>` +
  '<td></td>' +
  '</tr></tbody></table>'

/** "Glossário de Sistemas": só texto e links — nenhuma coluna pode ser centralizada. */
const GLOSSARIO =
  '<table><thead><tr><th>Nome</th><th>Descrição</th><th>Cloud</th></tr></thead><tbody>' +
  '<tr><td>Gocase on Rails</td><td>Spree (backend do site)</td><td>K8s</td></tr>' +
  '<tr><td>v4</td><td>Frontend do site</td><td>k8s</td></tr>' +
  '</tbody></table>'

describe('D-66 — a coluna de etiquetas é centralizada', () => {
  it('centraliza o CABEÇALHO da coluna de status', () => {
    const html = markup(VERSOES)

    // O `th` de `Status` é o quarto: é ele que ficava encostado à esquerda de 451px.
    expect(html).toContain('<th scope="col" data-centrada="sim">Status</th>')
  })

  it('centraliza também os DADOS — rótulo e conteúdo não se separam', () => {
    const html = markup(VERSOES)

    // Centralizar só o rótulo o desalinharia do que ele nomeia: o vão mudaria de lugar
    // em vez de sumir.
    const celulasCentradas = html.split('data-centrada="sim"').length - 1
    expect(celulasCentradas).toBe(2) // o `th` e o `td` da mesma coluna
  })

  it('🚨 NÃO toca nas outras colunas da mesma tabela', () => {
    const html = markup(VERSOES)

    for (const rotulo of ['Nome da versão', 'Valor que agrega', 'Escopo', 'Data de finalização']) {
      expect(html).toContain(`<th scope="col">${rotulo}</th>`)
    }
  })

  it('🚨 tabela só de texto NÃO ganha centralização nenhuma', () => {
    const html = markup(GLOSSARIO)

    // O caso que reprova o `th { text-align: center }` global: aqui os cabeçalhos já
    // coincidem com o começo dos dados, e mexer neles é regressão.
    expect(html).not.toContain('data-centrada')
  })

  it('coluna com etiqueta em UMA linha e texto na outra fica à esquerda', () => {
    // A condição é "toda célula não vazia da coluna tem etiqueta". Uma linha de texto
    // desqualifica a coluna: alinhar pelo caso minoritário é o que faz tabela de verdade
    // ficar torta.
    const html = markup(
      '<table><tbody>' +
        `<tr><td>${etiqueta('Concluído')}</td></tr>` +
        '<tr><td>ainda não começou</td></tr>' +
        '</tbody></table>',
    )

    expect(html).not.toContain('data-centrada')
  })

  it('célula VAZIA não desqualifica a coluna', () => {
    // Em "Versões" três das cinco células do corpo são vazias — se vazio contasse como
    // "não é etiqueta", a coluna de status nunca seria detectada.
    const html = markup(
      '<table><tbody>' +
        `<tr><td>${etiqueta('Concluído')}</td></tr>` +
        '<tr><td></td></tr>' +
        '</tbody></table>',
    )

    expect(html).toContain('data-centrada="sim"')
  })

  it('🚨 `colspan` desliga a análise INTEIRA', () => {
    // Com célula mesclada, a posição no array deixa de ser o índice da coluna: centralizar
    // por índice acertaria a coluna errada, em silêncio.
    const html = markup(
      '<table><tbody>' +
        `<tr><td colspan="2">${etiqueta('Concluído')}</td><td>x</td></tr>` +
        '</tbody></table>',
    )

    expect(html).not.toContain('data-centrada')
  })

  it('etiqueta ANINHADA (dentro de parágrafo) continua contando', () => {
    // O storage embrulha a macro em `<p>` com frequência; procurar só no primeiro nível
    // faria a detecção falhar justamente na forma mais comum.
    const html = markup(`<table><tbody><tr><td><p>${etiqueta('Em andamento')}</p></td></tr></tbody></table>`)

    expect(html).toContain('data-centrada="sim"')
  })
})
