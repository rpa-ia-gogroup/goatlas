/**
 * **T-142** — link para anexo que não é imagem (`RF-39`, `RF-43`).
 *
 * ## O defeito
 *
 * `RF-39` pede fidelidade em "títulos, listas, tabelas, código, imagens **e anexos
 * servidos pelo proxy**". Os cinco primeiros estavam cobertos; o sexto valia só para
 * **imagem**: `ri:attachment` era reconhecido dentro de `ac:image`, mas `converterAcLink`
 * tratava apenas `ri:page` e `ri:url`. Um link para PDF ou planilha anexada à página caía
 * no `return corpo` e virava **texto puro** — sem link e sem nada na tela dizendo que
 * havia um arquivo ali.
 *
 * É a degradação silenciosa que `RF-43` proíbe para macro, na mesma tela e pelo mesmo
 * motivo: quem lê decide com informação faltando **sem saber que falta**, e conclui que a
 * documentação não serve — que é o caminho mais caro do projeto (abre chamado por algo que
 * está escrito).
 *
 * ## A armadilha que veio junto
 *
 * 🚨 `ri:attachment` aceita um `ri:page`/`ri:space` aninhado: é assim que uma página
 * referencia arquivo **de outra**. O proxy serve anexo da página que está sendo lida, então
 * usar o nome mesmo assim entregaria um arquivo homônimo desta página — conteúdo errado com
 * cara de certo, pior que conteúdo ausente. Mesma família de `D-42` (nome onde se espera
 * chave). O mesmo furo existia em `ac:image` e foi fechado junto.
 *
 * _Requirements: RF-39, RF-43, RN-06, RNF-02, RNF-06_
 */

import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { sanitizarStorage } from '@/lib/confluence/sanitizar'
import { renderizarNos } from '@/lib/confluence/renderizar'

const OPCOES = {
  urlDeAnexo: (nome: string) => `/api/confluence/anexo/p1/${encodeURIComponent(nome)}`,
  urlDePagina: (titulo: string) => `/?q=${encodeURIComponent(titulo)}`,
}

const desenhar = (storage: string) =>
  renderToStaticMarkup(renderizarNos(sanitizarStorage(storage).nos, OPCOES) as never)

describe('link para anexo da própria página', () => {
  it('🚨 vira link pelo proxy — antes virava texto puro, sem nada dizendo que havia arquivo', () => {
    const html = desenhar(
      '<p><ac:link><ri:attachment ri:filename="procedimento.pdf" /><ac:plain-text-link-body>o procedimento</ac:plain-text-link-body></ac:link></p>',
    )
    expect(html).toContain('href="/api/confluence/anexo/p1/procedimento.pdf"')
    expect(html).toContain('o procedimento')
  })

  it('sem corpo, o NOME do arquivo vira o texto visível', () => {
    // Um `<a>` sem texto é um link que ninguém vê nem alcança pelo teclado.
    const html = desenhar('<p><ac:link><ri:attachment ri:filename="planilha.xlsx" /></ac:link></p>')
    expect(html).toContain('planilha.xlsx')
    expect(html).toContain('href="/api/confluence/anexo/p1/planilha.xlsx"')
  })

  it('o navegador nunca recebe URL da Atlassian (RNF-02)', () => {
    const html = desenhar('<p><ac:link><ri:attachment ri:filename="a.pdf" /></ac:link></p>')
    expect(html).not.toContain('atlassian.net')
    expect(html).not.toContain('/wiki/')
  })

  it('nome com acento e espaço é escapado na URL, não quebrado', () => {
    const html = desenhar(
      '<p><ac:link><ri:attachment ri:filename="relatório final.pdf" /></ac:link></p>',
    )
    expect(html).toContain(encodeURIComponent('relatório final.pdf'))
  })
})

describe('🚨 anexo de OUTRA página não pode virar link para o arquivo desta', () => {
  it('🚨 com `ri:page`, vira link PARA A PÁGINA — nunca para o arquivo homônimo daqui', () => {
    const html = desenhar(
      '<p><ac:link><ri:attachment ri:filename="contrato.pdf"><ri:page ri:content-title="Outra Página" /></ri:attachment></ac:link></p>',
    )
    // O que NÃO pode acontecer: servir `contrato.pdf` **desta** página como se fosse o de lá.
    expect(html).not.toContain('/api/confluence/anexo/p1/contrato.pdf')
    // ⚠️ O ramo de `ri:page` de `converterAcLink` já resolvia isto, e resolve melhor que
    // qualquer texto: manda a pessoa para a página que tem o arquivo.
    expect(html).toContain('Outra')
  })

  it('com `ri:space` e corpo, o texto do autor fica na tela sem virar link errado', () => {
    const html = desenhar(
      '<p><ac:link><ri:attachment ri:filename="c.pdf"><ri:space ri:space-key="RH" /></ri:attachment><ac:plain-text-link-body>ver o contrato</ac:plain-text-link-body></ac:link></p>',
    )
    expect(html).toContain('ver o contrato')
    expect(html).not.toContain('/api/confluence/anexo/p1/c.pdf')
  })

  it('o descarte é registrado — é o volume dele que diria se vale resolver um dia', () => {
    const r = sanitizarStorage(
      '<p><ac:image ac:alt="x"><ri:attachment ri:filename="x.png"><ri:page ri:content-title="Outra" /></ri:attachment></ac:image></p>',
    )
    expect(r.descartes.some((d) => d.motivo === 'anexo_de_outra_pagina')).toBe(true)
  })

  it('a MESMA trava vale para imagem — o furo era igual em `ac:image`', () => {
    const html = desenhar(
      '<p><ac:image ac:alt="diagrama"><ri:attachment ri:filename="d.png"><ri:page ri:content-title="Outra" /></ri:attachment></ac:image></p>',
    )
    expect(html).not.toContain('src="/api/confluence/anexo/p1/d.png"')
    // O alt vira legenda, para a informação não desaparecer calada.
    expect(html).toContain('diagrama')
  })

  it('imagem da própria página continua funcionando', () => {
    const html = desenhar('<p><ac:image ac:alt="tela"><ri:attachment ri:filename="t.png" /></ac:image></p>')
    expect(html).toContain('src="/api/confluence/anexo/p1/t.png"')
  })
})
