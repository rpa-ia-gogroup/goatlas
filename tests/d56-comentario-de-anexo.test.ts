/**
 * **`D-56`** — o comentário que o JSM cria sozinho não é resposta do time.
 *
 * ## O defeito, medido na staging em 12/08/2026
 *
 * Ao materializar um anexo, o JSM cria um comentário **público** cujo corpo é só o
 * marcador do arquivo: `[^conversa-GN-6903.md] _(4 kB)_`. Ele não passa por
 * `prefixarAutoria`, logo não tem o prefixo de `D-13`, logo `primeiraRespostaDoTime` o
 * contava como **resposta do time** — e todo chamado com anexo nascia com o SLA de
 * primeira resposta já satisfeito. A aderência de `RF-55` ia a ~100% e o alerta de
 * `RF-46` nunca disparava.
 *
 * O contraste que isolou a causa, nos dois chamados abertos na medição: `GN-6906` (com
 * anexo) nasceu com **1** comentário; `GN-6904` (sem anexo) com **0**.
 *
 * ⚠️ O bug é mais velho que `D-54` — chega por `RF-61` desde que aquilo existe. O `D-54`
 * só o tornou universal, porque agora toda conversa gera um arquivo.
 *
 * _Requirements: RF-31, RF-46, RF-48, RF-55, RN-08_
 */

import { describe, expect, it } from 'vitest'
import {
  arquivosReferenciados,
  conjuntoDeArquivosNossos,
  ehComentarioSoDeAnexoNosso,
} from '@/lib/tickets/comentario-de-anexo'
import { primeiraRespostaDoTime } from '@/lib/notificacoes/sla'
import { ehComentarioDoSolicitante, prefixarAutoria } from '@/lib/atlassian/comentarios'

const NOSSOS = conjuntoDeArquivosNossos([
  { nomeArquivo: 'conversa-GN-6903.md' },
  { nomeArquivo: 'print.png' },
])

describe('ehComentarioSoDeAnexoNosso', () => {
  it('🚨 o corpo real medido na staging é reconhecido como ruído', () => {
    expect(ehComentarioSoDeAnexoNosso('[^conversa-GN-6903.md] _(4 kB)_', NOSSOS)).toBe(true)
    expect(ehComentarioSoDeAnexoNosso('[^print.png] _(0.0 kB)_', NOSSOS)).toBe(true)
  })

  it('🚨 anexo do TIME continua sendo resposta — tratá-lo como ruído cobraria quem agiu', () => {
    expect(ehComentarioSoDeAnexoNosso('[^analise-do-time.pdf] _(12 kB)_', NOSSOS)).toBe(false)
  })

  it('qualquer palavra fora do marcador faz o comentário voltar a ser resposta', () => {
    expect(ehComentarioSoDeAnexoNosso('Segue o log: [^print.png] _(0.0 kB)_', NOSSOS)).toBe(false)
    expect(ehComentarioSoDeAnexoNosso('[^print.png] resolvido', NOSSOS)).toBe(false)
  })

  it('comentário sem marcador nenhum nunca é ruído', () => {
    expect(ehComentarioSoDeAnexoNosso('Já estamos olhando, retorno hoje.', NOSSOS)).toBe(false)
    expect(ehComentarioSoDeAnexoNosso('', NOSSOS)).toBe(false)
  })

  it('um arquivo nosso e um do time juntos: é do time', () => {
    expect(ehComentarioSoDeAnexoNosso('[^print.png] [^do-time.pdf]', NOSSOS)).toBe(false)
  })

  it('sem nenhum arquivo nosso registrado, nada é ruído (o comportamento de antes)', () => {
    expect(ehComentarioSoDeAnexoNosso('[^print.png] _(0.0 kB)_', new Set())).toBe(false)
  })

  it('extrai os nomes referenciados', () => {
    expect(arquivosReferenciados('[^a.png] texto [^b.pdf]')).toEqual(['a.png', 'b.pdf'])
    expect(arquivosReferenciados('sem marcador')).toEqual([])
  })
})

describe('primeiraRespostaDoTime — o SLA deixa de se satisfazer sozinho', () => {
  const ruido = (corpo: string) => ehComentarioSoDeAnexoNosso(corpo, NOSSOS)

  it('🚨 chamado só com o comentário do anexo NÃO está respondido', () => {
    const comentarios = [{ corpo: '[^conversa-GN-6903.md] _(4 kB)_', criadoEm: '2026-08-12T12:00:00.000Z' }]
    // O comportamento antigo — e o bug — em uma linha:
    expect(primeiraRespostaDoTime(comentarios, ehComentarioDoSolicitante)).not.toBeNull()
    // E o conserto:
    expect(primeiraRespostaDoTime(comentarios, ehComentarioDoSolicitante, ruido)).toBeNull()
  })

  it('a resposta de verdade que vem DEPOIS do anexo continua sendo a primeira resposta', () => {
    const comentarios = [
      { corpo: '[^print.png] _(0.0 kB)_', criadoEm: '2026-08-12T12:00:00.000Z' },
      { corpo: 'Estamos olhando, retorno até amanhã.', criadoEm: '2026-08-12T15:00:00.000Z' },
    ]
    expect(primeiraRespostaDoTime(comentarios, ehComentarioDoSolicitante, ruido)).toBe(
      '2026-08-12T15:00:00.000Z',
    )
  })

  it('o comentário do SOLICITANTE continua não contando — o predicado de D-13 não mudou', () => {
    const meu = prefixarAutoria('Alguma novidade?', 'Ana Souza', 'ana@gocase.com')
    const comentarios = [{ corpo: meu, criadoEm: '2026-08-12T13:00:00.000Z' }]
    expect(primeiraRespostaDoTime(comentarios, ehComentarioDoSolicitante, ruido)).toBeNull()
  })

  it('anexo do time SEM texto conta como resposta — ele agiu', () => {
    const comentarios = [{ corpo: '[^do-time.pdf] _(9 kB)_', criadoEm: '2026-08-12T14:00:00.000Z' }]
    expect(primeiraRespostaDoTime(comentarios, ehComentarioDoSolicitante, ruido)).toBe(
      '2026-08-12T14:00:00.000Z',
    )
  })
})
