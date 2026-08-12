/**
 * `RF-19` — a área que a pessoa VÊ é a que é GRAVADA. Uma fonte só (`D-52`).
 *
 * ## O defeito
 *
 * Existiam duas: `proposta.area`, **extraída pela IA** e mostrada no cartão de
 * confirmação (`RF-18`), e `vinculo.area`, vinda de `resolverArea` e efetivamente
 * gravada. Corrigir a do cartão era aceito com 200 e descartado na criação, sem erro.
 *
 * ## O que estes casos travam
 *
 * O teste **gera de um lado e lê do outro** — o padrão que o projeto usa em
 * `urlDeLeituraNoApp`/`entradaDaUrl` e na chave de idempotência, justamente porque a
 * divergência entre duas pontas é silenciosa: cada lado funciona sozinho.
 *
 * _Requirements: RF-18, RF-19, RNF-18_
 */

import { describe, expect, it } from 'vitest'
import { garantirAreaNaProposta } from '../src/lib/tickets/area-da-proposta'
import type { Conversa, PropostaChamado } from '../src/lib/agent/estado'

const proposta = (area: string | null): PropostaChamado => ({
  titulo: 'Título',
  descricao: 'Descrição',
  tipoChamadoId: '68',
  prioridade: 'normal',
  area,
  componente: null,
})

const conversaCom = (p: PropostaChamado | null): Conversa =>
  ({ id: 'c1', solicitanteEmail: 'maria@gocase.com', proposta: p }) as unknown as Conversa

function repositorioFalso() {
  const gravadas: PropostaChamado[] = []
  return {
    gravadas,
    definirProposta: async (_id: string, p: PropostaChamado) => {
      gravadas.push(p)
    },
  }
}

describe('D-52 · a área da proposta é resolvida uma vez e persistida', () => {
  it('preenche a área quando a proposta nasce sem ela', async () => {
    const repo = repositorioFalso()
    const r = await garantirAreaNaProposta(conversaCom(proposta(null)), repo, async () => 'RPA')
    expect(r?.area).toBe('RPA')
    // Persistida: é o valor que a criação vai usar, não um enfeite de tela.
    expect(repo.gravadas.map((p) => p.area)).toEqual(['RPA'])
  })

  it('🚨 não resolve de novo quando a proposta já tem área', async () => {
    const repo = repositorioFalso()
    let chamadas = 0
    const r = await garantirAreaNaProposta(conversaCom(proposta('Tecnologia')), repo, async () => {
      chamadas += 1
      return 'Outra'
    })
    // Uma ida de rede (e uma linha de auditoria) por mensagem trocada seria o custo de
    // resolver sempre — e a conversa continua depois de a proposta existir.
    expect(chamadas).toBe(0)
    expect(r?.area).toBe('Tecnologia')
    expect(repo.gravadas).toEqual([])
  })

  it('fonte indisponível deixa a área nula, e não grava nada (`RNF-18`)', async () => {
    const repo = repositorioFalso()
    const r = await garantirAreaNaProposta(conversaCom(proposta(null)), repo, async () => null)
    expect(r?.area).toBeNull()
    expect(repo.gravadas).toEqual([])
  })

  it('sem proposta não há o que resolver', async () => {
    const repo = repositorioFalso()
    let chamadas = 0
    const r = await garantirAreaNaProposta(conversaCom(null), repo, async () => {
      chamadas += 1
      return 'RPA'
    })
    expect(r).toBeNull()
    expect(chamadas).toBe(0)
  })

  it('área vazia conta como ausente — string vazia não é uma área', async () => {
    const repo = repositorioFalso()
    const r = await garantirAreaNaProposta(conversaCom(proposta('')), repo, async () => 'RPA')
    expect(r?.area).toBe('RPA')
  })
})
