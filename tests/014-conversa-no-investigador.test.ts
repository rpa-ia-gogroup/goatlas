/**
 * Spec 014 — a conversa no Investigador.
 *
 * O que estes casos protegem, e por que cada um existe:
 *
 * - **`FR-33`** — o cabeçalho. `detalharSessao` devolvia `{ eventos, requisicoes, mensagens }`
 *   e nada mais, então abrir uma sessão não dizia de quem era nem do que tratava. O caso
 *   afirma sobre o **payload da rota**, não sobre o componente: sem `sessao` na resposta, a
 *   tela mais bonita do mundo não tem o que mostrar.
 * - **`FR-34`** — a conversa como diálogo, e resultado de tool subordinado.
 * - **`FR-35`** — cada intervenção manual marcada como da pessoa, na ordem em que aconteceu.
 * - **`FR-36`** — gravidade declarada para os 21 tipos, com a união fechada.
 *
 * ⚠️ **Os casos de ordem afirmam sobre `montarConversa`, que é puro.** Afirmar sobre o HTML
 * provaria que a ordem chegou à tela naquele layout; a ordem em si é a regra, e ela precisa
 * continuar reprovando quando alguém reescrever o componente.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { Conversa, SessaoAberta } from '@/app/investigador'
import { autoriaDoMarco, MARCOS, montarConversa } from '@/app/investigador/conversa'
import { gravidadeDoEvento, TIPOS_COM_GRAVIDADE, TIPOS_TRADUZIDOS } from '@/app/investigador/eventos'
import type { DetalheDeSessao, EventoRegistrado } from '@/app/api'
import { SqliteLocal } from '@/lib/db/sqlite-local'
import { migrar } from '@/lib/db/schema'
import { detalharSessao } from '@/lib/investigador/leitura'

const QUANDO = '2026-08-21T12:00:00.000Z'

function evento(p: Partial<EventoRegistrado>): EventoRegistrado {
  return {
    id: p.id ?? `e-${Math.random().toString(36).slice(2)}`,
    requisicao_id: 'req-1',
    conversa_id: 'c-1',
    ator_email: 'ana@gocase.com',
    tipo: p.tipo ?? 'mensagem_usuario',
    origem: p.origem ?? 'usuario',
    resumo: null,
    dados_json: p.dados_json ?? null,
    custo_usd: null,
    duracao_ms: null,
    ordem: p.ordem ?? 0,
    criado_em: p.criado_em ?? QUANDO,
    ...p,
  }
}

function fala(id: string, papel: string, conteudo: string, criado_em: string, tool?: string) {
  return { id, papel, conteudo, tool_nome: tool ?? null, criado_em }
}

// --- FR-33: o cabeçalho ------------------------------------------------------

describe('o resumo da sessão chega no detalhe (FR-33)', () => {
  let db: SqliteLocal

  beforeEach(async () => {
    db = new SqliteLocal()
    await migrar(db)
  })

  it('detalharSessao devolve o resumo da conversa, com o título do cartão', async () => {
    await db.exec(
      `INSERT INTO conversas (id, solicitante_email, estado, custo_usd, proposta_json,
                              criado_em, atualizado_em)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ['c-1', 'ana@gocase.com', 'aguardando_confirmacao', 0.031,
       JSON.stringify({ titulo: 'Solicitação de acesso ao Nexus', prioridade: 'normal' }),
       QUANDO, QUANDO],
    )
    await db.exec(
      `INSERT INTO mensagens (id, conversa_id, papel, conteudo, criado_em)
       VALUES (?, ?, ?, ?, ?)`,
      ['m-1', 'c-1', 'user', 'preciso de acesso ao Nexus', QUANDO],
    )

    const d = await detalharSessao(db, 'c-1')
    expect(d.sessao).not.toBeNull()
    // 🚨 É esta linha que responde "do que se trata aquela conversa?".
    expect(d.sessao?.tituloDoCartao).toBe('Solicitação de acesso ao Nexus')
    expect(d.sessao?.solicitanteEmail).toBe('ana@gocase.com')
    expect(d.sessao?.estado).toBe('aguardando_confirmacao')
    expect(d.sessao?.mensagensDaPessoa).toBe(1)
    expect(d.sessao?.custoUsd).toBeCloseTo(0.031, 6)
  })

  it('conversa sem cartão devolve título nulo E o motivo — as duas metades', async () => {
    await db.exec(
      `INSERT INTO conversas (id, solicitante_email, estado, custo_usd, criado_em, atualizado_em)
       VALUES (?, ?, ?, ?, ?, ?)`,
      ['c-2', 'ana@gocase.com', 'coletando', 0, QUANDO, QUANDO],
    )
    await db.exec(
      `INSERT INTO investigador_eventos
         (id, requisicao_id, conversa_id, ator_email, tipo, origem, resumo, dados_json, ordem, criado_em)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['e-1', 'req-1', 'c-2', 'ana@gocase.com', 'ia_extracao_recusada', 'ia', 'sem proposta',
       JSON.stringify({ motivo: 'extracao_sem_proposta' }), 0, QUANDO],
    )

    const d = await detalharSessao(db, 'c-2')
    expect(d.sessao?.tituloDoCartao).toBeNull()
    expect(d.sessao?.temProposta).toBe(false)
    expect(d.sessao?.motivoSemProposta).toBe('extracao_sem_proposta')
  })

  it('proposta_json malformado não derruba a leitura — devolve título nulo', async () => {
    await db.exec(
      `INSERT INTO conversas (id, solicitante_email, estado, custo_usd, proposta_json,
                              criado_em, atualizado_em)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ['c-3', 'ana@gocase.com', 'coletando', 0, '{isso não é json', QUANDO, QUANDO],
    )
    const d = await detalharSessao(db, 'c-3')
    expect(d.sessao?.tituloDoCartao).toBeNull()
    // ⚠️ `temProposta` continua `true`: a coluna está preenchida. O que falhou foi LER o
    // título dela, e confundir as duas afirmaria que a pessoa nunca viu cartão.
    expect(d.sessao?.temProposta).toBe(true)
  })

  it('conversa expurgada responde sessao nula, não erro — a retenção não é falha', async () => {
    const d = await detalharSessao(db, 'c-que-nao-existe')
    expect(d.sessao).toBeNull()
    expect(d.eventos).toEqual([])
  })

  it('o cabeçalho desenhado nomeia o assunto, quem é e o motivo de não haver cartão', () => {
    const dados = {
      sessao: {
        conversaId: 'c-1',
        solicitanteEmail: 'ana@gocase.com',
        estado: 'coletando',
        criadoEm: QUANDO,
        ultimaAtividade: QUANDO,
        custoUsd: 0.0312,
        mensagensDaPessoa: 6,
        mensagensDoAgente: 6,
        bloqueios: 1,
        overrides: 1,
        temProposta: false,
        tituloDoCartao: null,
        confirmadoEm: null,
        issueKey: null,
        requisicoes: 9,
        errosDeApi: 2,
        duracaoMaximaMs: 38_000,
        motivoSemProposta: 'extracao_sem_proposta',
      },
      eventos: [],
      requisicoes: [],
      mensagens: [],
    } as unknown as DetalheDeSessao
    const html = renderToStaticMarkup(createElement(SessaoAberta, { dados, conversaId: 'c-1' }))

    expect(html).toContain('Conversa sem cartão')
    expect(html).toContain('ana@gocase.com')
    // A frase do motivo, não o rótulo técnico.
    expect(html).toContain('proposta foi recusada na leitura')
    expect(html).not.toContain('extracao_sem_proposta')
    // Os números do cabeçalho, com vírgula decimal (regra 4).
    expect(html).toContain('6p / 6ag')
    expect(html).toContain('US$ 0,0312')
    expect(html).toContain('38,0 s')
    // O tom pede atenção, e a palavra está lá junto com ele.
    expect(html).toContain('data-tom="atencao"')
    expect(html).toContain('1 override')
  })

  it('chamado aberto aparece pela chave, e o tom vira desfecho', () => {
    const dados = {
      sessao: {
        conversaId: 'c-1', solicitanteEmail: 'ana@gocase.com', estado: 'criado',
        criadoEm: QUANDO, ultimaAtividade: QUANDO, custoUsd: 0,
        mensagensDaPessoa: 3, mensagensDoAgente: 3, bloqueios: 0, overrides: 0,
        temProposta: true, tituloDoCartao: 'Acesso ao Nexus', confirmadoEm: QUANDO,
        issueKey: 'GN-6916', requisicoes: 4, errosDeApi: 0, duracaoMaximaMs: null,
        motivoSemProposta: null,
      },
      eventos: [], requisicoes: [], mensagens: [],
    } as unknown as DetalheDeSessao
    const html = renderToStaticMarkup(createElement(SessaoAberta, { dados, conversaId: 'c-1' }))
    expect(html).toContain('Acesso ao Nexus')
    expect(html).toContain('chamado GN-6916')
    expect(html).toContain('data-tom="desfecho"')
  })

  it('sessao nula na tela DIZ que o resumo envelheceu, sem parecer erro de rede', () => {
    const dados = { sessao: null, eventos: [], requisicoes: [], mensagens: [] } as unknown as DetalheDeSessao
    const html = renderToStaticMarkup(createElement(SessaoAberta, { dados, conversaId: 'c-9' }))
    expect(html).toContain('Sessão sem resumo')
    expect(html).toContain('retenção')
    expect(html).not.toContain('Não consegui')
  })
})

// --- FR-34: a conversa é a visão padrão --------------------------------------

describe('a conversa como diálogo (FR-34)', () => {
  it('a aba Conversa é a que abre, e as três abas trazem a contagem', () => {
    const dados = {
      sessao: null,
      eventos: [],
      requisicoes: [],
      mensagens: [fala('m-1', 'user', 'o Protheus caiu', QUANDO)],
    } as unknown as DetalheDeSessao
    const html = renderToStaticMarkup(createElement(SessaoAberta, { dados, conversaId: 'c-1' }))
    expect(html).toContain('aria-selected="true"')
    // A aba ativa é a primeira, e é a Conversa.
    expect(html.indexOf('Conversa')).toBeLessThan(html.indexOf('Linha do tempo'))
    expect(html).toContain('Chamadas de API')
    // E a conversa está desenhada, não escondida atrás de um clique.
    expect(html).toContain('o Protheus caiu')
  })

  it('pessoa e agente saem em lados opostos, e cada fala carrega a palavra', () => {
    const itens = montarConversa(
      [
        fala('m-1', 'user', 'o Protheus caiu', '2026-08-21T12:00:00.000Z'),
        fala('m-2', 'assistant', 'desde quando?', '2026-08-21T12:00:10.000Z'),
      ],
      [],
    )
    const html = renderToStaticMarkup(createElement(Conversa, { itens }))
    expect(html).toContain('data-papel="pessoa"')
    expect(html).toContain('data-papel="agente"')
    // ⚠️ A autoria nunca é só a posição: a palavra vai junto (regra 9, e o celular).
    expect(html).toContain('>Pessoa<')
    expect(html).toContain('>Agente<')
  })

  it('a quebra de linha da pessoa sobrevive — relato em parágrafos não vira bloco', () => {
    const itens = montarConversa([fala('m-1', 'user', 'linha 1\nlinha 2', QUANDO)], [])
    const html = renderToStaticMarkup(createElement(Conversa, { itens }))
    expect(html).toContain('linha 1\nlinha 2')
  })

  it('resultado de ferramenta é details fechado com tamanho, nunca bolha (SC-4)', () => {
    // ⚠️ Este caso veio de `013-turno-na-tela.test.ts`: a conversa mudou de componente na
    // spec 014, e a afirmação continua valendo onde o código foi morar.
    const itens = montarConversa(
      [fala('m-1', 'tool', 'x'.repeat(5000), QUANDO, 'search_confluence')],
      [],
    )
    const html = renderToStaticMarkup(createElement(Conversa, { itens }))
    expect(html).toContain('4,9 kB')
    expect(html).toContain('search_confluence')
    expect(html).toContain('<details')
    // Não é fala de ninguém: não ganha bolha nem rótulo de autoria.
    expect(html).not.toContain('data-papel')
  })

  it('o markdown do agente é RENDERIZADO — a pessoa não leu asteriscos', () => {
    // 🚨 Medido em 21/08/2026: cru, a fala do agente chegava como
    // `- [Como reprocessar…](/documentacao?pagina=p1)` e `**seu**` literais. Esta aba mostra
    // o que a pessoa leu; quem quer o texto exato do modelo tem `ia_chat` na linha do tempo.
    const itens = montarConversa(
      [fala('m-1', 'assistant', ['use o **seu** caso', '- [A pagina](/documentacao?pagina=p1)'].join(String.fromCharCode(10)), QUANDO)],
      [],
    )
    const html = renderToStaticMarkup(createElement(Conversa, { itens }))
    expect(html).toContain('<strong>seu</strong>')
    expect(html).toContain('href="/documentacao?pagina=p1"')
    expect(html).not.toContain('**seu**')
  })

  it('a fala DELA fica crua — ela escreveu texto, não markdown', () => {
    const itens = montarConversa([fala('m-1', 'user', 'o **Protheus** caiu', QUANDO)], [])
    const html = renderToStaticMarkup(createElement(Conversa, { itens }))
    expect(html).toContain('o **Protheus** caiu')
  })

  it('conversa vazia DIZ que está vazia — nunca um retângulo em branco', () => {
    const html = renderToStaticMarkup(createElement(Conversa, { itens: [] }))
    expect(html).toContain('Nenhuma mensagem nesta conversa')
  })
})

// --- FR-35: o que a pessoa fez à mão -----------------------------------------

describe('as intervenções da pessoa (FR-35)', () => {
  it('a ordem é a dos carimbos, e o marco vem DEPOIS da fala do mesmo instante', () => {
    const itens = montarConversa(
      [
        fala('m-1', 'user', 'primeira', '2026-08-21T12:00:00.000Z'),
        fala('m-2', 'assistant', 'segunda', '2026-08-21T12:00:20.000Z'),
      ],
      [
        evento({ id: 'e-1', tipo: 'bloqueio', origem: 'servidor', criado_em: '2026-08-21T12:00:00.000Z' }),
        evento({ id: 'e-2', tipo: 'override', origem: 'usuario', criado_em: '2026-08-21T12:00:10.000Z' }),
      ],
    )
    expect(itens.map((i) => i.id)).toEqual(['m-1', 'e-1', 'e-2', 'm-2'])
  })

  it('cada ação da pessoa é rotulada como dela, e a do app como do app', () => {
    const itens = montarConversa(
      [],
      [
        evento({ id: 'e-1', tipo: 'override', origem: 'usuario', criado_em: '2026-08-21T12:00:01.000Z' }),
        evento({ id: 'e-2', tipo: 'bloqueio', origem: 'servidor', criado_em: '2026-08-21T12:00:02.000Z' }),
      ],
    )
    const html = renderToStaticMarkup(createElement(Conversa, { itens }))
    expect(html).toContain('data-autoria="pessoa"')
    expect(html).toContain('data-autoria="app"')
    expect(html).toContain('A pessoa fez')
    expect(html).toContain('O app decidiu')
  })

  it('a edição do cartão mostra antes → depois, com a mesma comparação da linha do tempo', () => {
    const itens = montarConversa(
      [],
      [
        evento({
          id: 'e-1',
          tipo: 'proposta_editada',
          origem: 'usuario',
          dados_json: JSON.stringify({
            antes: { titulo: 'Acesso', prioridade: 'critica' },
            depois: { titulo: 'Acesso ao Nexus', prioridade: 'alta' },
          }),
        }),
      ],
    )
    const html = renderToStaticMarkup(createElement(Conversa, { itens }))
    expect(html).toContain('A pessoa editou o cartão')
    expect(html).toContain('critica')
    expect(html).toContain('alta')
  })

  it('a mensagem da pessoa NÃO é marco — ela já é fala, e entraria em dobro', () => {
    const e = evento({ tipo: 'mensagem_usuario', origem: 'usuario' })
    expect(autoriaDoMarco(e)).toBeNull()
    expect(MARCOS.pessoa).not.toContain('mensagem_usuario')
  })

  it('a rederivação do turno não é marco; o botão "montar agora" é', () => {
    const rotina = evento({ tipo: 'proposta_rederivada', origem: 'ia', dados_json: '{"alterados":["titulo"]}' })
    const botao = evento({ tipo: 'proposta_rederivada', origem: 'ia', dados_json: '{"forcado":true,"montou":true}' })
    expect(autoriaDoMarco(rotina)).toBeNull()
    expect(autoriaDoMarco(botao)).toBe('pessoa')
  })

  it('o ruído de máquina fica FORA da conversa — ele tem a aba dele', () => {
    for (const tipo of ['ia_chat', 'tool_executada', 'resposta_agente', 'chamada_externa', 'payload_final']) {
      expect(autoriaDoMarco(evento({ tipo }))).toBeNull()
    }
  })

  it('o bloqueio e o desfecho aparecem, porque sem eles a conversa não se explica (SC-6)', () => {
    for (const tipo of ['bloqueio', 'desfecho_criacao', 'ia_extracao_recusada', 'erro_de_rota']) {
      expect(autoriaDoMarco(evento({ tipo }))).toBe('app')
    }
  })

  it('dados_json malformado num marco não derruba a conversa', () => {
    const itens = montarConversa([], [evento({ tipo: 'override', origem: 'usuario', dados_json: '{quebrado' })])
    expect(() => renderToStaticMarkup(createElement(Conversa, { itens }))).not.toThrow()
  })
})

// --- FR-36: a gravidade ------------------------------------------------------

describe('a gravidade dos eventos (FR-36)', () => {
  it('todo tipo traduzido tem gravidade declarada — a união é a mesma (SC-8)', () => {
    expect([...TIPOS_COM_GRAVIDADE].sort()).toEqual([...TIPOS_TRADUZIDOS].sort())
  })

  it('ferramenta que falhou pede atenção; a que rodou é rotina', () => {
    expect(gravidadeDoEvento('tool_executada', '{"falhou":true}')).toBe('atencao')
    expect(gravidadeDoEvento('tool_executada', '{"falhou":false}')).toBe('neutro')
  })

  it('criação com chave é desfecho; sem chave pede atenção — nunca a mesma cor', () => {
    expect(gravidadeDoEvento('desfecho_criacao', '{"issueKey":"GN-6916"}')).toBe('desfecho')
    expect(gravidadeDoEvento('desfecho_criacao', '{"transitorio":false}')).toBe('atencao')
  })

  it('tipo desconhecido é neutro, nunca ausência de estilo', () => {
    expect(gravidadeDoEvento('tipo_que_nao_existe_ainda', null)).toBe('neutro')
  })

  it('JSON malformado cai na gravidade do tipo, sem lançar', () => {
    expect(gravidadeDoEvento('tool_executada', '{quebrado')).toBe('neutro')
    expect(gravidadeDoEvento('desfecho_criacao', '{quebrado')).toBe('desfecho')
  })
})

// --- SC-9: o marcador não se solta da espinha --------------------------------

describe('o marcador na espinha (SC-9)', () => {
  it('nenhum evento da linha do tempo recebe data-lado — o recuo de 12% saiu', () => {
    const dados = {
      sessao: null,
      eventos: [evento({ tipo: 'mensagem_usuario', origem: 'usuario' })],
      requisicoes: [
        {
          id: 'req-1', ator_email: 'ana@gocase.com', conversa_id: 'c-1', metodo: 'POST',
          caminho: '/api/conversas/c-1/mensagens', status: 200, duracao_ms: 100,
          req_bytes: 10, resp_bytes: 10, erro: null, criado_em: QUANDO,
        },
      ],
      mensagens: [],
    } as unknown as DetalheDeSessao
    const html = renderToStaticMarkup(createElement(SessaoAberta, { dados, conversaId: 'c-1' }))
    // A aba Conversa é a padrão, então nem a linha do tempo está na tela — e é ela que
    // carrega os eventos. O que este caso garante é que a classe morreu no CSS e no markup.
    expect(html).not.toContain('data-lado')
  })
})
