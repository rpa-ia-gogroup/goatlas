/**
 * **T-118** — a deflexão aponta para **dentro** do app.
 *
 * O furo que este arquivo fecha: a mensagem da Regra 1 linkava para
 * `goengenharia.atlassian.net`. Quem usa o goatlas **não tem assento Atlassian** —
 * esse é o ponto do produto inteiro — então o link caía numa tela de login no momento
 * exato em que a pessoa havia sido convencida a ler antes de abrir chamado. A
 * deflexão funcionava até o clique.
 *
 * Agora o link é a rota de leitura do próprio app, que já respeita as três condições
 * de `RN-06`. Duas coisas que o teste cobra:
 *
 * 1. **O formato do link é contrato entre duas camadas.** `rules/` monta a URL e
 *    `app/confluence.tsx` a interpreta. Em vez de um comentário pedindo que
 *    concordem, o teste gera o link e o faz voltar por `entradaDaUrl` — se alguém
 *    mudar um lado, isto quebra.
 * 2. **Link interno é ALLOWLIST, não "começa com barra".** O texto renderizado por
 *    `TextoDoAgente` também carrega saída do modelo, e o modelo pode repetir conteúdo
 *    de página do Confluence (`R-07`). Só a forma exata da rota de leitura vira
 *    link; `/api/...` e caminhos inventados continuam texto.
 *
 * _Requirements: RF-09, RF-12, RF-13, RF-39, RNF-06, R-07_
 */

import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { avaliarRegra1, montarMensagemBloqueio, urlDeLeituraNoApp } from '@/lib/rules'
import { entradaDaUrl } from '@/app/confluence'
import { TextoDoAgente } from '@/app/componentes'
import type { PaginaConfluence } from '@/lib/atlassian/tipos'

function pagina(over: Partial<PaginaConfluence> = {}): PaginaConfluence {
  return {
    id: 'p1',
    titulo: 'Como reprocessar o relatório',
    espaco: 'TECH',
    url: 'https://goengenharia.atlassian.net/wiki/spaces/TECH/pages/1',
    score: 0.95,
    trecho: 'Rode a tarefa manual no painel.',
    labels: [],
    ...over,
  }
}

function mensagemDaRegra1(paginas: readonly PaginaConfluence[]): string {
  const v = avaliarRegra1(paginas, 0.75)
  if (!v.bloquear) throw new Error('cenário deveria bloquear')
  return montarMensagemBloqueio(v)
}

const markup = (texto: string) => renderToStaticMarkup(createElement(TextoDoAgente, { texto }))

describe('RF-09 / RF-39 — o link da deflexão fica DENTRO do app', () => {
  it('a mensagem linka a rota de leitura, não o Confluence', async () => {
    const msg = mensagemDaRegra1([pagina({ id: '77' })])
    expect(msg).toContain('/?pagina=77')
    // O link para a Atlassian é uma parede para quem não tem assento.
    expect(msg).not.toContain('atlassian.net')
    // RF-12 continua inteiro: título, motivo legível e caminho de override.
    expect(msg).toContain('Como reprocessar o relatório')
    expect(msg).toMatch(/não resolvem o \*\*seu\*\* caso/)
    expect(msg).not.toMatch(/negad|recus|proibid/i)
  })

  it('o formato do link é CONTRATO: a tela o interpreta de volta', async () => {
    // Se `rules/` e `app/confluence.tsx` discordarem, o link vira 404 silencioso —
    // e ninguém percebe, porque a mensagem continua bonita.
    const id = 'abc-123_XY'
    const url = urlDeLeituraNoApp(id)
    const query = url.slice(url.indexOf('?'))
    expect(entradaDaUrl(query)).toEqual({ pagina: id })
  })

  it('id com caractere especial é codificado', async () => {
    expect(urlDeLeituraNoApp('a b&c')).toBe('/?pagina=a%20b%26c')
    const query = urlDeLeituraNoApp('a b&c')
    expect(entradaDaUrl(query.slice(query.indexOf('?')))).toEqual({ pagina: 'a b&c' })
  })

  it('página SEM id cai no link externo — informação vale mais que estética', async () => {
    // Não deveria acontecer (a busca sempre traz id), mas ficar sem link nenhum seria
    // pior: a pessoa vê o título de algo que ela não tem como abrir.
    const msg = mensagemDaRegra1([pagina({ id: '' })])
    expect(msg).toContain('https://goengenharia.atlassian.net/wiki')
  })
})

describe('R-07 — link interno é allowlist, não "começa com barra"', () => {
  it('a rota de leitura vira link clicável, em OUTRA aba', async () => {
    const html = markup('Veja [Reprocessar](/?pagina=77) antes de abrir.')
    expect(html).toContain('href="/?pagina=77"')
    expect(html).toContain('Reprocessar')
    // A conversa vive em estado de React: navegar na mesma aba a destrói, e a pessoa
    // perderia o botão de override (RF-13) exatamente por ter aceitado ler primeiro.
    expect(html).toContain('target="_blank"')
  })

  it('BURLA — caminho interno inventado pelo modelo NÃO vira link', async () => {
    // O texto do agente pode repetir conteúdo de página do Confluence, que qualquer
    // pessoa da empresa edita. Só a forma exata da rota de leitura é aceita.
    for (const alvo of [
      '/api/admin/config',
      '/?pagina=77&admin=1',
      '/../etc/passwd',
      '//exfiltra.exemplo/x',
      '/?pagina=',
      '/?q=qualquer',
      '/',
    ]) {
      const html = markup(`Clique [aqui](${alvo}) agora.`)
      expect(html, alvo).not.toContain('href=')
      // O rótulo continua legível — recusar o link não apaga o texto.
      expect(html, alvo).toContain('aqui')
    }
  })

  it('esquema perigoso continua fora, e link externo continua com rel', async () => {
    expect(markup('[x](javascript:alert(1))')).not.toContain('href=')
    const externo = markup('[doc](https://exemplo.com/a)')
    expect(externo).toContain('href="https://exemplo.com/a"')
    expect(externo).toContain('rel="noopener noreferrer"')
  })
})
