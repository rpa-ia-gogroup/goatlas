/**
 * **T-1305 / T-1110** — a linha do tempo é agrupada em turnos, e o JSON não é a tela.
 *
 * ## As duas perguntas deste arquivo
 *
 * 1. **`agruparEmTurnos` acerta a conta?** — funções puras, sobre eventos e requisições como
 *    `detalharSessao` os devolve. O agrupamento vem de `requisicao_id`, que já era gravado em
 *    todo evento e que nenhuma tela lia.
 * 2. 🚨 **Nenhum `<pre>` de JSON é renderizado fora de um `<details>`.** É o defeito que a
 *    spec 013 existe para consertar: antes, o `dados_json` de **todo** evento saía num `<pre>`
 *    sempre aberto, e um turno tem por volta de catorze eventos — com o histórico inteiro da
 *    conversa dentro de cada `ia_chat`.
 *
 * ⚠️ Como em `painel-do-console.test.ts`, afirma-se que o **conteúdo chega**, nunca como ele é
 * desenhado: teste que copia layout reprova em toda melhoria de tela, vira peso morto e é
 * apagado — devolvendo o buraco que ele tapa (`D-49`).
 *
 * _Requirements: FR-21, FR-23, FR-24, SC-3, ScA-01, ScA-05, ScA-07 (spec 013)_
 */

import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { LinhaDoTempo } from '@/app/investigador'
import { agruparEmTurnos, resumirChamadas, FORA_DE_TURNO } from '@/app/investigador/turnos'
import type { DetalheDeSessao, EventoRegistrado, RequisicaoRegistrada } from '@/app/api'

let n = 0
function evento(p: Partial<EventoRegistrado>): EventoRegistrado {
  n += 1
  return {
    id: `e-${n}`,
    requisicao_id: 'r-1',
    conversa_id: 'c-1',
    ator_email: 'ana@gocase.com',
    tipo: 'mensagem_usuario',
    origem: 'usuario',
    resumo: null,
    dados_json: null,
    custo_usd: null,
    duracao_ms: null,
    ordem: n,
    criado_em: `2026-08-20T12:00:${String(n).padStart(2, '0')}.000Z`,
    ...p,
  }
}

function requisicao(p: Partial<RequisicaoRegistrada>): RequisicaoRegistrada {
  return {
    id: 'r-1',
    ator_email: 'ana@gocase.com',
    conversa_id: 'c-1',
    metodo: 'POST',
    caminho: '/api/conversas/c-1/mensagens',
    status: 200,
    duracao_ms: 24_300,
    req_bytes: null,
    resp_bytes: null,
    erro: null,
    criado_em: '2026-08-20T12:00:30.000Z',
    ...p,
  }
}

describe('o agrupamento em turnos', () => {
  it('uma requisição é um turno, e os turnos são numerados na ordem', () => {
    const turnos = agruparEmTurnos(
      [
        evento({ requisicao_id: 'r-1' }),
        evento({ requisicao_id: 'r-1', tipo: 'resposta_agente', origem: 'servidor' }),
        evento({ requisicao_id: 'r-2' }),
      ],
      [requisicao({ id: 'r-1' }), requisicao({ id: 'r-2' })],
    )
    expect(turnos).toHaveLength(2)
    expect(turnos.map((t) => t.numero)).toEqual([1, 2])
    expect(turnos[0]?.eventos).toHaveLength(2)
  })

  it('soma o custo dos eventos, não o da requisição — quem paga é a ida ao modelo', () => {
    const [t] = agruparEmTurnos(
      [
        evento({ tipo: 'ia_chat', origem: 'ia', custo_usd: 0.012 }),
        evento({ tipo: 'ia_chat', origem: 'ia', custo_usd: 0.008 }),
        evento({ tipo: 'resposta_agente', origem: 'servidor', custo_usd: null }),
      ],
      [requisicao({})],
    )
    expect(t?.custoUsd).toBeCloseTo(0.02, 6)
    expect(t?.duracaoMs).toBe(24_300)
  })

  it('as chamadas externas saem da narrativa e viram agregado do turno', () => {
    const [t] = agruparEmTurnos(
      [
        evento({ tipo: 'mensagem_usuario' }),
        ...Array.from({ length: 6 }, () =>
          evento({ tipo: 'chamada_externa', origem: 'atlassian', duracao_ms: 430 }),
        ),
      ],
      [requisicao({})],
    )
    // A narrativa fica com a mensagem; as seis idas ficam no agregado.
    expect(t?.eventos).toHaveLength(1)
    expect(t?.chamadasExternas).toHaveLength(6)
    expect(t?.tempoExternoMs).toBe(2580)
  })

  it('o resumo das chamadas é por DESTINO — é o que responde "esperou por quem?"', () => {
    const chamadas = [
      evento({ tipo: 'chamada_externa', origem: 'atlassian', duracao_ms: 400 }),
      evento({ tipo: 'chamada_externa', origem: 'atlassian', duracao_ms: 600 }),
      evento({ tipo: 'chamada_externa', origem: 'ia', duracao_ms: 12_000 }),
    ]
    const resumo = resumirChamadas(chamadas)
    // Ordenado pelo tempo: o que segurou o turno vem primeiro.
    expect(resumo[0]).toEqual({ alvo: 'ia', total: 1, ms: 12_000 })
    expect(resumo[1]).toEqual({ alvo: 'atlassian', total: 2, ms: 1000 })
  })

  it('ferramentas executadas e recusadas são lidas do próprio evento', () => {
    const [t] = agruparEmTurnos(
      [
        evento({ tipo: 'tool_executada', origem: 'servidor', dados_json: '{"tool":"search_confluence"}' }),
        evento({ tipo: 'tool_recusada', origem: 'servidor', dados_json: '{"toolProposta":"create_ticket"}' }),
      ],
      [requisicao({})],
    )
    expect(t?.toolsExecutadas).toEqual(['search_confluence'])
    expect(t?.toolsRecusadas).toEqual(['create_ticket'])
  })

  it('evento sem requisição casada NÃO some — vai para "fora de turno"', () => {
    const turnos = agruparEmTurnos(
      [evento({ requisicao_id: null }), evento({ requisicao_id: 'r-1' })],
      [requisicao({ id: 'r-1' })],
    )
    const orfao = turnos.find((t) => t.chave === FORA_DE_TURNO)
    expect(orfao).toBeDefined()
    expect(orfao?.numero).toBeNull()
    expect(orfao?.requisicao).toBeNull()
    // O turno de verdade continua sendo o Turno 1: o órfão não consome numeração.
    expect(turnos.find((t) => t.chave === 'r-1')?.numero).toBe(1)
  })

  it('requisição fora do teto da consulta deixa o turno sem rota, e não sem eventos', () => {
    const [t] = agruparEmTurnos([evento({ requisicao_id: 'r-99' })], [])
    expect(t?.requisicao).toBeNull()
    expect(t?.eventos).toHaveLength(1)
  })

  it('o desfecho é o fato mais importante do turno, não o último', () => {
    // Bloqueou E rederivou: para quem investiga, o turno bloqueou.
    const [t] = agruparEmTurnos(
      [
        evento({ tipo: 'bloqueio', origem: 'servidor' }),
        evento({ tipo: 'proposta_rederivada', origem: 'ia' }),
      ],
      [requisicao({})],
    )
    expect(t?.desfecho).toBe('bloqueou')
  })

  it('criação com chave é "chamado criado"; sem chave é falha', () => {
    const [ok] = agruparEmTurnos(
      [evento({ tipo: 'desfecho_criacao', origem: 'atlassian', dados_json: '{"issueKey":"GN-6916"}' })],
      [requisicao({})],
    )
    expect(ok?.desfecho).toBe('chamado criado')
    const [mal] = agruparEmTurnos(
      [evento({ tipo: 'desfecho_criacao', origem: 'atlassian', dados_json: '{"transitorio":false}' })],
      [requisicao({})],
    )
    expect(mal?.desfecho).toBe('a criação falhou')
  })
})

// --- a tela ------------------------------------------------------------------

function desenhar(dados: Partial<DetalheDeSessao>): string {
  return renderToStaticMarkup(
    createElement(LinhaDoTempo, {
      dados: { eventos: [], requisicoes: [], mensagens: [], ...dados } as DetalheDeSessao,
    }),
  )
}

describe('a linha do tempo desenhada', () => {
  const CASO: Partial<DetalheDeSessao> = {
    eventos: [
      evento({
        tipo: 'mensagem_usuario',
        origem: 'usuario',
        dados_json: JSON.stringify({ texto: 'o Protheus caiu', estadoDaConversa: 'coletando' }),
      }),
      evento({
        tipo: 'tool_executada',
        origem: 'servidor',
        dados_json: JSON.stringify({ tool: 'search_confluence', falhou: false, paraModelo: 'x' }),
      }),
      evento({ tipo: 'chamada_externa', origem: 'atlassian', duracao_ms: 430 }),
      evento({
        tipo: 'ia_extracao_recusada',
        origem: 'ia',
        dados_json: JSON.stringify({ motivo: 'extracao_sem_proposta' }),
      }),
    ],
    requisicoes: [requisicao({})],
    mensagens: [],
  }

  it('o turno aparece com número, duração e a rota', () => {
    const html = desenhar(CASO)
    expect(html).toContain('Turno 1')
    expect(html).toContain('24,3 s')
    expect(html).toContain('/api/conversas/c-1/mensagens')
  })

  it('🚨 nenhum `<pre>` de JSON fora de um `<details>` — o defeito principal', () => {
    const html = desenhar(CASO)
    // Todo `<pre>` desta tela nasce dentro de um `<details>`. A prova mais barata e mais
    // difícil de burlar: não existe `<pre>` antes do primeiro `<details>`.
    const primeiroDetails = html.indexOf('<details')
    const primeiroPre = html.indexOf('<pre')
    expect(primeiroPre === -1 || primeiroPre > primeiroDetails).toBe(true)
    // E o rótulo do registro cru está lá: ele não sumiu, mudou de lugar.
    expect(html).toContain('Ver o registro cru')
  })

  it('o tipo do evento NÃO chega à tela em snake_case', () => {
    const html = desenhar(CASO)
    expect(html).not.toContain('>ia_extracao_recusada<')
    expect(html).not.toContain('>tool_executada<')
    expect(html).toContain('Não houve cartão')
    expect(html).toContain('Ferramenta executada: search_confluence')
  })

  it('as idas para fora aparecem agrupadas, com o destino e o tempo', () => {
    const html = desenhar(CASO)
    expect(html).toContain('1 chamada para fora')
    expect(html).toContain('atlassian 1×')
  })

  it('sessão sem evento nenhum diz por quê — vazio não é silêncio', () => {
    const html = desenhar({})
    expect(html).toContain('Nenhum evento registrado')
  })

  it('o grupo "fora de turno" explica o que ele é', () => {
    const html = desenhar({
      eventos: [evento({ requisicao_id: null, tipo: 'mensagem_usuario' })],
      requisicoes: [],
    })
    expect(html).toContain('Fora de turno')
    expect(html).toContain('não puderam ser casados')
  })

  it('mensagem longa da conversa vira bloco com tamanho, não parede de texto', () => {
    const html = desenhar({
      mensagens: [
        { id: 'm-1', papel: 'tool', conteudo: 'x'.repeat(5000), tool_nome: 'search_confluence', criado_em: '2026-08-20T12:00:00.000Z' },
      ],
    })
    expect(html).toContain('4,9 kB')
  })
})
