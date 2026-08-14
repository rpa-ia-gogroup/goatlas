/**
 * Todo `var(--token)` da folha aponta para um token que EXISTE — `D-64`, `RNF-28`.
 *
 * ## Por que uma varredura, e não revisão
 *
 * 🚨 **Token inventado não falha em nada.** `var(--go-surface)` sem valor simplesmente **não
 * pinta**: `npm run build`, `npm run test` e `npm run typecheck` passam os três, e o defeito
 * só aparece no navegador — foi assim em `D-64`, com o fundo do visualizador caindo em
 * transparente e o texto da página **atravessando** a caixa.
 *
 * E o modo de falha silencioso é o mais comum: `--go-text-body` (duas ocorrências, achadas em
 * 14/08/2026) resolvia em `inherit`, que por acaso já era a cor certa. Funcionava. Continuaria
 * funcionando até alguém mudar a cor da raiz, e aí o texto de um `<dialog>` mudaria de cor
 * sozinho, sem ninguém conseguir explicar por quê.
 *
 * ⚠️ **`var(--x, fallback)` é legítimo** e fica de fora: ali a ausência foi prevista por quem
 * escreveu. O que este teste proíbe é a ausência **não** prevista.
 *
 * ⚠️ Ele afirma que o token **existe**, nunca qual é o valor dele: teste que copia paleta
 * reprova em toda troca de identidade visual, vira peso morto e acaba apagado — devolvendo o
 * buraco que ele tapa (`D-49`).
 *
 * _Requirements: RNF-28_
 */

import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const PASTA = join(process.cwd(), 'src/app')

function folhas(): { nome: string; texto: string }[] {
  return readdirSync(PASTA)
    .filter((n) => n.endsWith('.css'))
    .map((nome) => ({ nome, texto: readFileSync(join(PASTA, nome), 'utf8') }))
}

/** Remove comentários: token citado numa explicação não é uso. */
function semComentarios(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

describe('nenhum `var(--token)` aponta para token que não existe', () => {
  it('todo token usado sem fallback está declarado em alguma folha', () => {
    const arquivos = folhas()
    expect(arquivos.length).toBeGreaterThan(0)

    const declarados = new Set<string>()
    for (const { texto } of arquivos) {
      for (const m of semComentarios(texto).matchAll(/(--[\w-]+)\s*:/g)) {
        declarados.add(m[1]!)
      }
    }

    const orfaos: string[] = []
    for (const { nome, texto } of arquivos) {
      // `var(--x)` **sem** vírgula: com fallback, a ausência foi prevista de propósito.
      for (const m of semComentarios(texto).matchAll(/var\(\s*(--[\w-]+)\s*\)/g)) {
        const token = m[1]!
        if (!declarados.has(token)) orfaos.push(`${nome}: ${token}`)
      }
    }

    expect(orfaos).toEqual([])
  })
})
