/**
 * **T-1302** — o evento chega à tela em português, e o tipo novo não escapa.
 *
 * ## O que este arquivo impede de voltar
 *
 * A spec 009 entregou o registro e a tela mostrava, para cada evento, `evento.tipo` **cru**:
 * `ia_extracao_recusada`, `proposta_rederivada`, `payload_final`. É a regra 4 quebrada na
 * única superfície feita para ler, e é a mesma família de `D-63` — identificador interno
 * vazando porque ninguém escreveu a tradução.
 *
 * Duas travas, e elas fazem perguntas diferentes:
 *
 * - **De compilação:** `Record<TipoDeEvento, Descritor>` em `eventos.ts` — tipo novo sem
 *   tradução não compila. Ela sozinha bastaria se ninguém pudesse escrever um descritor
 *   que devolve o slug como título.
 * - **Deste arquivo:** nenhum título e nenhum rótulo saem em `snake_case`, e a união está
 *   coberta. É a pergunta que a de compilação não faz.
 *
 * _Requirements: FR-22, FR-23, FR-24, SC-1, SC-2 (spec 013)_
 */

import { describe, expect, it } from 'vitest'
import { descreverEvento, TIPOS_TRADUZIDOS, tamanho, contagem } from '@/app/investigador/eventos'
import type { TipoDeEvento } from '@/lib/investigador/tipos'

/**
 * A união, escrita à mão.
 *
 * ⚠️ **De propósito não é derivada do mapa** — derivá-la faria o teste comparar o mapa
 * consigo mesmo e passar para sempre. Esta lista é a cópia independente que obriga quem
 * acrescentar um `TipoDeEvento` a passar por aqui.
 */
const TODOS: readonly TipoDeEvento[] = [
  'mensagem_usuario',
  'proposta_editada',
  'formulario_alterado',
  'override',
  'declaracao_anexo',
  'anexo_recebido',
  'confirmacao',
  'ia_chat',
  'ia_extracao',
  'ia_extracao_recusada',
  'ia_classificacao',
  'anexo_analisado',
  'resposta_agente',
  'tool_executada',
  'tool_recusada',
  'bloqueio',
  'proposta_rederivada',
  'payload_final',
  'desfecho_criacao',
  'erro_de_rota',
  'chamada_externa',
]

describe('a união está coberta', () => {
  it('todo tipo de evento tem tradução', () => {
    for (const t of TODOS) expect(TIPOS_TRADUZIDOS).toContain(t)
  })

  it('e o mapa não tem tradução para tipo que não existe', () => {
    for (const t of TIPOS_TRADUZIDOS) expect(TODOS).toContain(t)
  })
})

describe('nada em snake_case chega à tela', () => {
  // O `_` entre letras minúsculas é a assinatura do identificador interno.
  const SLUG = /[a-z]+_[a-z]+/

  it('nenhum título é o slug do tipo, nem com os dados vazios', () => {
    for (const t of TODOS) {
      const d = descreverEvento(t, null, null)
      expect(d.titulo, `título de ${t}`).not.toMatch(SLUG)
      expect(d.titulo.length, `título de ${t}`).toBeGreaterThan(0)
    }
  })

  it('nenhum rótulo de linha é slug', () => {
    for (const t of TODOS) {
      const d = descreverEvento(t, JSON.stringify(DADOS_COMPLETOS), null)
      for (const l of d.linhas) expect(l.rotulo, `${t} → ${l.rotulo}`).not.toMatch(SLUG)
      for (const b of d.blocos) expect(b.rotulo, `${t} → ${b.rotulo}`).not.toMatch(SLUG)
    }
  })
})

/** Um saco com todas as chaves que os emissores usam — nenhum evento real tem todas. */
const DADOS_COMPLETOS = {
  texto: 'o Protheus caiu',
  estadoDaConversa: 'coletando',
  antes: { titulo: 'a', prioridade: 'normal', tipoChamadoId: '70' },
  depois: { titulo: 'b', prioridade: 'alta', tipoChamadoId: '70' },
  campo: 'prioridade',
  tela: 'formulario',
  de: 'normal',
  para: 'alta',
  motivo: 'a página não resolve',
  bloqueiosSobrepostos: 1,
  declarouAnexo: true,
  anexosPendentes: 2,
  nome: 'print.png',
  tipo: 'image/png',
  bytes: 40_960,
  duplicado: false,
  proposta: { titulo: 't', descricao: 'd', tipoChamadoId: '134', prioridade: 'alta', area: null },
  camposDaConversa: { components: '10074' },
  prioridadeParaOJira: { priority: { id: '3' } },
  ciclo: 2,
  toolsPermitidas: ['search_confluence'],
  toolsPropostas: [{ nome: 'search_confluence', argumentos: { topico: 'protheus' } }],
  textoDoModelo: 'vou verificar',
  historicoEnviado: [{ papel: 'user', conteudo: 'oi', toolNome: null }],
  respostaBrutaDoModelo: '{"pronto": false}',
  resultado: 'nao_resolve',
  issueKey: 'GN-6916',
  tipoDeclarado: 'application/pdf',
  estado: 'pronta',
  descricao: 'a tela mostra um erro 500',
  textoExibido: 'entendi',
  textoDoModeloDescartado: true,
  bloqueioPendente: true,
  toolsExecutadas: ['search_confluence'],
  toolsRecusadas: ['create_ticket'],
  temProposta: false,
  tool: 'search_confluence',
  falhou: false,
  bloqueou: true,
  paraModelo: 'achei 3 páginas',
  argumentos: { topico: 'protheus' },
  toolProposta: 'create_ticket',
  permitidas: ['search_confluence'],
  regra: 'Regra 1',
  evidencia: { paginas: ['DTE:1'] },
  alterados: ['titulo', 'prioridade'],
  assuntoMudou: false,
  camposSugeridos: { components: '10074' },
  recusasDeAjuste: [],
  via: 'conversa',
  chaveIdempotencia: 'conversa:c-1',
  verificadoRegras: true,
  area: 'RPA',
  payload: { tipoChamadoId: '134', prioridade: 'alta' },
  transitorio: false,
  erro: 'HTTP 400',
  classe: 'TypeError',
  mensagem: 'x is not a function',
  pilha: 'at foo()\nat bar()',
  alvo: 'atlassian',
  metodo: 'POST',
  caminho: '/rest/servicedeskapi/request',
  status: 400,
  falha: null,
} as const

describe('as traduções que carregam o caso', () => {
  it('“sem cartão” diz o que fazer, não o rótulo técnico', () => {
    const d = descreverEvento(
      'ia_extracao_recusada',
      JSON.stringify({ motivo: 'extracao_sem_proposta', respostaBrutaDoModelo: '{"pronto":false}' }),
      null,
    )
    expect(d.titulo).toBe('Não houve cartão')
    expect(d.linhas[0]?.valor).toContain('recusada na leitura')
    // A resposta crua é bloco, nunca linha: é o que respondeu a pergunta de `D-73`.
    expect(d.blocos.map((b) => b.rotulo)).toContain('Resposta crua do modelo')
  })

  // 🚨 Achado no NAVEGADOR em 20/08, com a suíte verde: o título saía "Bloqueio pela
  // regra1_confluence". A varredura de `snake_case` olha os RÓTULOS; o slug veio pelo VALOR.
  it('o bloqueio nomeia a regra em português, nunca o identificador dela', () => {
    const d = descreverEvento(
      'bloqueio',
      JSON.stringify({ regra: 'regra1_confluence', motivo: '1 página com score alto' }),
      null,
    )
    expect(d.titulo).not.toContain('regra1_confluence')
    expect(d.titulo).toContain('Regra 1')
    const r2 = descreverEvento('bloqueio', JSON.stringify({ regra: 'regra2_ajuste_operacional' }), null)
    expect(r2.titulo).toContain('Regra 2')
  })

  it('regra desconhecida volta crua — feio, e melhor que uma tela sem a regra', () => {
    const d = descreverEvento('bloqueio', JSON.stringify({ regra: 'regra3_nova' }), null)
    expect(d.titulo).toContain('regra3_nova')
  })

  // ⚠️ O contra-exemplo, escrito de propósito: nome de FERRAMENTA continua cru. Ali o
  // identificador é a coisa investigada — é ele que se casa com `toolsPermitidas`.
  it('nome de ferramenta NÃO é traduzido', () => {
    const d = descreverEvento('tool_executada', JSON.stringify({ tool: 'search_confluence' }), null)
    expect(d.titulo).toContain('search_confluence')
  })

  it('motivo desconhecido volta cru em vez de sumir', () => {
    const d = descreverEvento('ia_extracao_recusada', JSON.stringify({ motivo: 'algo_novo' }), null)
    expect(d.linhas[0]?.valor).toBe('algo_novo')
  })

  it('texto do modelo descartado mostra os DOIS textos — `D-21`', () => {
    const d = descreverEvento(
      'resposta_agente',
      JSON.stringify({
        textoExibido: 'a regra bloqueou',
        textoDoModelo: 'montei o chamado abaixo',
        textoDoModeloDescartado: true,
      }),
      null,
    )
    expect(d.titulo).toContain('DESCARTADO')
    const rotulos = d.blocos.map((b) => b.rotulo)
    expect(rotulos).toContain('O que a pessoa leu')
    expect(rotulos.some((r) => r.includes('jogado fora'))).toBe(true)
  })

  it('sem descarte, o texto do modelo não é oferecido duas vezes', () => {
    const d = descreverEvento(
      'resposta_agente',
      JSON.stringify({ textoExibido: 'entendi', textoDoModelo: 'entendi' }),
      null,
    )
    expect(d.blocos).toHaveLength(1)
  })

  it('o histórico enviado ao modelo vira TEXTO, não JSON escapado', () => {
    const d = descreverEvento(
      'ia_chat',
      JSON.stringify({
        ciclo: 1,
        historicoEnviado: [
          { papel: 'user', conteudo: 'o Protheus caiu', toolNome: null },
          { papel: 'tool', conteudo: 'achei 3 páginas', toolNome: 'search_confluence' },
        ],
      }),
      null,
    )
    const hist = d.blocos.find((b) => b.rotulo.includes('histórico'))
    expect(hist?.texto).toContain('[pessoa]')
    expect(hist?.texto).toContain('[ferramenta · search_confluence]')
    expect(hist?.texto).toContain('o Protheus caiu')
    // Escapado é o defeito: a conversa some dentro das aspas.
    expect(hist?.texto).not.toContain('\\"')
  })

  it('a rederivação forçada pelo botão NÃO se lê como a IA mudando de opinião', () => {
    const forcada = descreverEvento(
      'proposta_rederivada',
      JSON.stringify({ forcado: true, montou: true, proposta: { titulo: 't' } }),
      null,
    )
    expect(forcada.titulo).toContain('pediu para montar')
    const normal = descreverEvento(
      'proposta_rederivada',
      JSON.stringify({ alterados: ['titulo'] }),
      null,
    )
    expect(normal.titulo).toBe('Cartão rederivado')
  })

  it('rederivação sem mudança diz isso — não fica muda', () => {
    const d = descreverEvento('proposta_rederivada', JSON.stringify({ alterados: [] }), null)
    expect(d.titulo).toContain('não mudou nada')
  })

  it('a criação que falhou distingue TRANSITÓRIA de DEFINITIVA — `RNF-17`', () => {
    const def = descreverEvento(
      'desfecho_criacao',
      JSON.stringify({ transitorio: false, erro: 'HTTP 400' }),
      null,
    )
    expect(def.titulo).toContain('DEFINITIVA')
    const tra = descreverEvento('desfecho_criacao', JSON.stringify({ transitorio: true }), null)
    expect(tra.titulo).toContain('TRANSITÓRIA')
    const ok = descreverEvento('desfecho_criacao', JSON.stringify({ issueKey: 'GN-6916' }), null)
    expect(ok.titulo).toBe('Chamado criado: GN-6916')
  })

  it('o payload entregue ao Jira é bloco — é ele que responde “faltou campo?” (`D-74`)', () => {
    const d = descreverEvento(
      'payload_final',
      JSON.stringify({ via: 'conversa', payload: { tipoChamadoId: '134', prioridade: 'alta' } }),
      null,
    )
    expect(d.linhas.find((l) => l.rotulo.includes('assunto'))?.valor).toBe('134')
    expect(d.blocos[0]?.texto).toContain('"tipoChamadoId"')
  })

  it('`falhou: false` é dito — booleano falso é informação, não ausência', () => {
    const d = descreverEvento('tool_executada', JSON.stringify({ tool: 'x', falhou: false }), null)
    expect(d.linhas.find((l) => l.rotulo === 'falhou')?.valor).toBe('não')
  })
})

describe('tolerância a dado velho e a dado quebrado', () => {
  it('tipo desconhecido usa o resumo gravado, que já estava em português', () => {
    const d = descreverEvento('tipo_que_nao_existe', null, 'Alguma coisa aconteceu')
    expect(d.titulo).toBe('Alguma coisa aconteceu')
  })

  it('tipo desconhecido SEM resumo mostra o rótulo cru — feio, e melhor que sumir', () => {
    const d = descreverEvento('tipo_que_nao_existe', null, null)
    expect(d.titulo).toBe('tipo_que_nao_existe')
  })

  it('JSON truncado (`FR-3`) não lança e não inventa campo', () => {
    const d = descreverEvento('mensagem_usuario', '{"texto":"oi…[truncado, 900', null)
    expect(d.titulo).toBe('Mensagem da pessoa')
    expect(d.blocos).toHaveLength(0)
  })

  it('dados nulos não lançam em nenhum tipo', () => {
    for (const t of TODOS) expect(() => descreverEvento(t, null, null)).not.toThrow()
  })
})

describe('as duas formatações que a tela reaproveita', () => {
  it('tamanho em bytes e em kB, com vírgula decimal', () => {
    expect(tamanho(900)).toBe('900 bytes')
    expect(tamanho(40_960)).toBe('40,0 kB')
    expect(tamanho(null)).toBeNull()
  })

  it('a contagem concorda — regra 4', () => {
    expect(contagem(1, 'ferramenta', 'ferramentas')).toBe('1 ferramenta')
    expect(contagem(2, 'ferramenta', 'ferramentas')).toBe('2 ferramentas')
    expect(contagem(0, 'ferramenta', 'ferramentas')).toBe('0 ferramentas')
  })
})
