/**
 * `nomeDoTipo` — o rótulo do assunto, e o que fazer quando ele não existe (`D-53`).
 *
 * _Requirements: RF-18, RF-28, RNF-30_
 */

import { describe, expect, it } from 'vitest'
import { nomeDoTipo } from '../src/lib/tickets/nome-do-tipo'

const TIPOS = [
  { id: '68', nome: 'Outras questões / dúvidas' },
  { id: '70', nome: 'Relatar um bug' },
]

describe('D-53 · o nome do assunto', () => {
  it('acha o nome pelo id', () => {
    expect(nomeDoTipo('70', TIPOS)).toBe('Relatar um bug')
  })

  it('🚨 tipo fora da lista devolve null — nunca o id como rótulo', () => {
    // A lista que chega já é a filtrada por allowlist e service desk. Um id fora dela
    // significa que aquele assunto não é oferecido; nomear assim mesmo faria o cartão
    // anunciar uma fila que a criação recusa.
    expect(nomeDoTipo('999', TIPOS)).toBeNull()
  })

  it('nome vazio conta como ausente', () => {
    expect(nomeDoTipo('9', [{ id: '9', nome: '   ' }])).toBeNull()
  })

  it('lista vazia devolve null, sem explodir', () => {
    expect(nomeDoTipo('68', [])).toBeNull()
  })
})
