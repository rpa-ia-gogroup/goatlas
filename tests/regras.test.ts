/**
 * RF-09 (Regra 1), RF-10/RF-11 (Regra 2), RF-12 (mensagem), RN-06/RNF-09
 * (exposição de Confluence), RF-14 (exemplos obrigatórios).
 *
 * Funções puras: nada aqui toca rede. É o que permite a suíte rodar em PR — e
 * essas são justamente as regras que mais precisam de teste, porque errar aqui
 * produz falso bloqueio (R-04), que manda a pessoa de volta para o Google Chat.
 *
 * _Requirements: RF-09, RF-10, RF-11, RF-12, RF-14, RN-06, RN-07, RNF-09, RNF-31_
 */

import { describe, expect, it } from 'vitest'
import type { PaginaConfluence, TicketHistorico } from '@/lib/atlassian/tipos'
import { ClienteAtlassianFake } from '@/lib/atlassian/fake'
import {
  avaliarRegra1,
  avaliarRegra2,
  montarMensagemBloqueio,
  regra2Disponivel,
  type TicketClassificado,
} from '@/lib/rules'

function pagina(over: Partial<PaginaConfluence> = {}): PaginaConfluence {
  return {
    id: 'p1',
    titulo: 'Como reprocessar o pipeline de vendas',
    espaco: 'TECH',
    url: 'https://goengenharia.atlassian.net/wiki/spaces/TECH/pages/1',
    score: 0.9,
    trecho: 'Para reprocessar, rode...',
    labels: [],
    ...over,
  }
}

function ticket(over: Partial<TicketHistorico> = {}): TicketHistorico {
  return {
    issueKey: 'TECH-1',
    titulo: 'Pipeline de vendas não rodou',
    criadoEm: '2026-06-01T00:00:00.000Z',
    resolvidoEm: '2026-06-01T04:00:00.000Z',
    chaveAgrupamento: 'pipeline-vendas',
    comentariosResolucao: ['Rodei o pipeline manualmente.'],
    ...over,
  }
}

const classificado = (t: TicketHistorico, classe: TicketClassificado['classe']) => ({
  ticket: t,
  classe,
})

describe('RF-09 — Regra 1 é por SCORE, não por "achou"', () => {
  it('score acima do threshold bloqueia', () => {
    const v = avaliarRegra1([pagina({ score: 0.9 })], 0.75)
    expect(v.bloquear).toBe(true)
    if (v.bloquear) expect(v.regra).toBe('regra1_confluence')
  })

  it('achou páginas, mas todas abaixo do threshold: NÃO bloqueia', () => {
    // Se "achou alguma coisa" bloqueasse, qualquer termo genérico bloquearia tudo
    // — e o falso bloqueio é o caminho mais curto de volta ao Google Chat (R-04).
    const v = avaliarRegra1([pagina({ score: 0.4 }), pagina({ score: 0.6 })], 0.75)
    expect(v.bloquear).toBe(false)
    expect(v.motivoTecnico).toContain('abaixo do threshold')
  })

  it('nenhuma página: não bloqueia', () => {
    expect(avaliarRegra1([], 0.75).bloquear).toBe(false)
  })

  it('score exatamente no threshold bloqueia (limite é inclusivo, e isso é explícito)', () => {
    expect(avaliarRegra1([pagina({ score: 0.75 })], 0.75).bloquear).toBe(true)
  })

  it('threshold configurável muda a decisão sem mudar código (RF-50)', () => {
    const paginas = [pagina({ score: 0.8 })]
    expect(avaliarRegra1(paginas, 0.75).bloquear).toBe(true)
    expect(avaliarRegra1(paginas, 0.95).bloquear).toBe(false)
  })

  it('a evidência sai ordenada por score — a página mais relevante primeiro', () => {
    const v = avaliarRegra1(
      [pagina({ id: 'a', score: 0.8 }), pagina({ id: 'b', score: 0.95 })],
      0.75,
    )
    expect(v.bloquear).toBe(true)
    if (v.bloquear && 'paginas' in v.evidencia) {
      expect(v.evidencia.paginas.map((p) => p.score)).toEqual([0.95, 0.8])
    }
  })
})

describe('RF-10 / RF-11 — Regra 2 é padrão de ajuste operacional', () => {
  const tres = [
    classificado(ticket({ issueKey: 'TECH-1' }), 'ajuste_operacional'),
    classificado(ticket({ issueKey: 'TECH-2' }), 'ajuste_operacional'),
    classificado(ticket({ issueKey: 'TECH-3' }), 'ajuste_operacional'),
  ]

  it('recorrência acima do threshold bloqueia', () => {
    const v = avaliarRegra2(tres, 3)
    expect(v.bloquear).toBe(true)
    if (v.bloquear) expect(v.regra).toBe('regra2_ajuste_operacional')
  })

  it('abaixo do threshold não bloqueia', () => {
    expect(avaliarRegra2(tres.slice(0, 2), 3).bloquear).toBe(false)
  })

  it('recorrência de RESOLUÇÃO REAL não bloqueia — causa raiz corrigida não é ticket evitável', () => {
    const reais = tres.map((c) => classificado(c.ticket, 'resolucao_real'))
    expect(avaliarRegra2(reais, 3).bloquear).toBe(false)
  })

  it('INDETERMINADO não conta como ajuste operacional — na dúvida, o ticket passa', () => {
    // Contar o incerto a favor do bloqueio é o desenho que produz falso bloqueio.
    const incertos = tres.map((c) => classificado(c.ticket, 'indeterminado'))
    expect(avaliarRegra2(incertos, 3).bloquear).toBe(false)

    const misto = [
      classificado(ticket({ issueKey: 'A' }), 'ajuste_operacional'),
      classificado(ticket({ issueKey: 'B' }), 'ajuste_operacional'),
      classificado(ticket({ issueKey: 'C' }), 'indeterminado'),
    ]
    expect(avaliarRegra2(misto, 3).bloquear).toBe(false)
  })

  it('a evidência lista só os tickets de ajuste operacional, e diz quantos foram analisados', () => {
    const misto = [...tres, classificado(ticket({ issueKey: 'TECH-9' }), 'resolucao_real')]
    const v = avaliarRegra2(misto, 3)
    expect(v.bloquear).toBe(true)
    if (v.bloquear && 'ticketsAjusteOperacional' in v.evidencia) {
      expect(v.evidencia.ticketsAjusteOperacional.map((t) => t.issueKey)).toEqual([
        'TECH-1',
        'TECH-2',
        'TECH-3',
      ])
      expect(v.evidencia.totalAnalisado).toBe(4)
    }
  })
})

describe('RF-14 — a Regra 2 não roda sem os exemplos reais da Gocase (Q3)', () => {
  it('sem exemplos, a regra se declara indisponível', () => {
    expect(regra2Disponivel([])).toBe(false)
    expect(regra2Disponivel(['Rodei o pipeline manualmente'])).toBe(true)
  })
})

describe('RF-12 / RNF-31 — a mensagem de bloqueio tem os três elementos e soa como ajuda', () => {
  it('Regra 1: diz a regra, o motivo em linguagem natural e traz o LINK', () => {
    const v = avaliarRegra1([pagina({ titulo: 'Reprocessar pipeline' })], 0.75)
    expect(v.bloquear).toBe(true)
    if (!v.bloquear) return
    const msg = montarMensagemBloqueio(v)

    expect(msg).toContain('Reprocessar pipeline')
    // T-118 — o link é a leitura DENTRO do app. Quem usa o goatlas não tem assento
    // Atlassian: `atlassian.net` seria uma parede no momento do clique.
    expect(msg).toContain('/?pagina=')
    expect(msg).not.toContain('atlassian.net')
    // RF-13 / RN-07: o caminho de override tem de estar VISÍVEL na mensagem.
    expect(msg).toMatch(/não resolvem o \*\*seu\*\* caso/)
    // RNF-31: soa como ajuda, não como recusa.
    expect(msg).not.toMatch(/negad|recus|proibid|não permitid/i)
  })

  it('Regra 2: explica o padrão, mostra o histórico e oferece o caminho de causa raiz', () => {
    const v = avaliarRegra2(
      [
        classificado(ticket({ issueKey: 'TECH-1' }), 'ajuste_operacional'),
        classificado(ticket({ issueKey: 'TECH-2' }), 'ajuste_operacional'),
        classificado(ticket({ issueKey: 'TECH-3' }), 'ajuste_operacional'),
      ],
      3,
    )
    expect(v.bloquear).toBe(true)
    if (!v.bloquear) return
    const msg = montarMensagemBloqueio(v)

    expect(msg).toContain('TECH-1')
    expect(msg).toContain('causa')
    expect(msg).toMatch(/seu caso é diferente/i)
    expect(msg).not.toMatch(/negad|recus|proibid/i)
  })
})

describe('RN-06 / RNF-09 — as três condições de exposição, simultâneas', () => {
  it('espaço fora da allowlist, página com label bloqueada: nada disso sai da camada', async () => {
    const atlassian = new ClienteAtlassianFake({
      paginas: [
        pagina({ id: 'ok', espaco: 'TECH', labels: [] }),
        pagina({ id: 'espaco-proibido', espaco: 'RH', labels: [] }),
        pagina({ id: 'label-bloqueada', espaco: 'TECH', labels: ['confidencial'] }),
      ],
    })

    const resultado = await atlassian.buscarConfluence({
      termo: 'pipeline',
      espacosPermitidos: ['TECH'],
      labelsBloqueadas: ['confidencial'],
      limite: 10,
    })

    expect(resultado.map((p) => p.id)).toEqual(['ok'])
  })

  it('allowlist VAZIA não expõe nada — negação por padrão (RNF-07)', async () => {
    const atlassian = new ClienteAtlassianFake({ paginas: [pagina()] })
    const resultado = await atlassian.buscarConfluence({
      termo: 'pipeline',
      espacosPermitidos: [],
      labelsBloqueadas: [],
      limite: 10,
    })
    expect(resultado).toEqual([])
  })

  it('a restrição de espaço vai na QUERY, não em filtro depois (RNF-07)', async () => {
    const atlassian = new ClienteAtlassianFake({ paginas: [pagina()] })
    await atlassian.buscarConfluence({
      termo: 'x',
      espacosPermitidos: ['TECH'],
      labelsBloqueadas: ['confidencial'],
      limite: 5,
    })
    const chamada = atlassian.chamadas.find((c) => c.operacao === 'buscarConfluence')
    // O contrato obriga a allowlist a ser PARÂMETRO DE BUSCA. Se ela fosse um
    // filtro aplicado acima da camada, o conteúdo restrito já teria saído da
    // Atlassian — e bastaria um caminho esquecer o filtro para vazar.
    expect(chamada?.params).toMatchObject({ espacosPermitidos: ['TECH'] })
  })

  it('o LLM só recebe o que sobrou do filtro — não é caminho lateral (RNF-09)', async () => {
    const atlassian = new ClienteAtlassianFake({
      paginas: [
        pagina({ id: 'publica', espaco: 'TECH', trecho: 'conteúdo liberado' }),
        pagina({ id: 'secreta', espaco: 'RH', trecho: 'SALÁRIOS CONFIDENCIAIS' }),
      ],
    })
    const paginas = await atlassian.buscarConfluence({
      termo: 'x',
      espacosPermitidos: ['TECH'],
      labelsBloqueadas: [],
      limite: 10,
    })
    const contextoDoModelo = paginas.map((p) => p.trecho).join('\n')
    expect(contextoDoModelo).not.toContain('SALÁRIOS')
  })
})
