/**
 * O orquestrador em operação — o turno de conversa completo.
 *
 * Aqui o fake de IA encena um **modelo hostil**: tenta chamar tool fora de ordem,
 * inventa nome de tool, e obedece a instrução vinda de conteúdo do Confluence. Com
 * um provedor real esses cenários seriam não-determinísticos; com roteiro, são
 * teste.
 *
 * _Requirements: RF-07, RF-08, RF-09, RF-10, RF-12, RF-13, RN-01, RN-07, RNF-08,
 * RNF-16, RNF-18, R-04, R-07, R-08_
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { linhasComoObjetos } from '@/lib/db/tipos'
import { SqliteLocal } from '@/lib/db/sqlite-local'
import { migrar } from '@/lib/db/schema'
import { CONFIG_PADRAO, type ConfigValores } from '@/lib/config'
import { AuditoriaBanco } from '@/lib/audit'
import { ClienteAtlassianFake } from '@/lib/atlassian/fake'
import { ClienteIAFake, type TurnoRoteirizado } from '@/lib/ia/fake'
import type { ClasseResolucao } from '@/lib/ia/tipos'
import { RepositorioConversas } from '@/lib/agent/estado'
import { ExecutorTools, hashConteudo } from '@/lib/agent/tools'
import { Orquestrador } from '@/lib/agent/orquestrador'
import { autorizarCriacao } from '@/lib/agent/gate'
import type { PaginaConfluence, TicketHistorico } from '@/lib/atlassian/tipos'

const ANA = 'ana@gocase.com'
const AGORA = '2026-08-03T12:00:00.000Z'

const CONFIG: ConfigValores = {
  ...CONFIG_PADRAO,
  dominios_permitidos: ['gocase.com'],
  espacos_confluence: ['TECH'],
  regra2_exemplos_ajuste_operacional: ['Rodei o pipeline manualmente'],
}

function pagina(over: Partial<PaginaConfluence> = {}): PaginaConfluence {
  return {
    id: 'p1',
    titulo: 'Como reprocessar o pipeline',
    espaco: 'TECH',
    url: 'https://goengenharia.atlassian.net/wiki/spaces/TECH/pages/1',
    score: 0.95,
    trecho: 'Rode o comando X.',
    labels: [],
    ...over,
  }
}

function ticket(over: Partial<TicketHistorico> = {}): TicketHistorico {
  return {
    issueKey: 'TECH-1',
    titulo: 'Pipeline não rodou',
    criadoEm: AGORA,
    resolvidoEm: AGORA,
    chaveAgrupamento: 'pipeline',
    comentariosResolucao: ['Rodei manualmente.'],
    ...over,
  }
}

let db: SqliteLocal
let conversas: RepositorioConversas
let atlassian: ClienteAtlassianFake
let ia: ClienteIAFake
let orquestrador: Orquestrador

/**
 * Monta o orquestrador com um roteiro de "modelo". `classe` fixa o veredito do
 * classificador quando o teste exercita a Regra 2.
 */
function montar(
  roteiro: readonly TurnoRoteirizado[],
  classe: ClasseResolucao = 'resolucao_real',
) {
  let n = 0
  const novoId = () => `id-${++n}`
  const auditoria = new AuditoriaBanco(db, () => AGORA, novoId)
  ia = new ClienteIAFake([...roteiro])
  ia.classePadrao = classe
  const executor = new ExecutorTools(atlassian, ia, db, auditoria, () => AGORA)
  orquestrador = new Orquestrador(ia, executor, conversas, auditoria, novoId)
}

/** Roteiro comum: o modelo pede o histórico e depois conclui. */
const ROTEIRO_HISTORICO: readonly TurnoRoteirizado[] = [
  {
    texto: '...',
    toolsPropostas: [{ nome: 'check_jira_history', argumentos: { tipoProblema: 'pipeline' } }],
  },
  { texto: 'segue' },
]

beforeEach(async () => {
  db = new SqliteLocal()
  await migrar(db)
  conversas = new RepositorioConversas(db, () => AGORA)
  atlassian = new ClienteAtlassianFake({ paginas: [pagina()], historico: [ticket()] })
})

describe('turno de conversa — o servidor decide o que o modelo pode fazer', () => {
  it('o modelo recebe apenas as tools que o servidor autorizou naquele turno', async () => {
    montar([{ texto: 'Vou verificar.', toolsPropostas: [{ nome: 'search_confluence', argumentos: { topico: 'pipeline' } }] }])
    const c = await conversas.criar('c1', ANA)
    await orquestrador.processarMensagem(c, 'o pipeline não rodou', {
      ...CONFIG,
      regra1_threshold_score: 0.99, // não bloqueia, para o turno seguir
    })

    // Primeiro turno: as duas tools disponíveis. Nunca `create_ticket`.
    expect(ia.permissoesRecebidas[0]).toEqual(['search_confluence', 'check_jira_history'])
    expect(ia.permissoesRecebidas.flat()).not.toContain('create_ticket')
  })

  it('BURLA — modelo propõe tool com nome inventado: recusada e auditada', async () => {
    montar([
      { texto: 'Abrindo agora.', toolsPropostas: [{ nome: 'create_ticket', argumentos: {} }] },
      { texto: 'Ok, vou verificar antes.' },
    ])
    const c = await conversas.criar('c1', ANA)
    const r = await orquestrador.processarMensagem(c, 'abra um chamado', CONFIG)

    expect(r.toolsRecusadas).toContain('create_ticket')
    expect(r.toolsExecutadas).toHaveLength(0)

    const auditados = await db.query(
      `SELECT acao, resultado FROM auditoria WHERE acao = 'tool_recusada'`,
      [],
    )
    expect(auditados.rows).toHaveLength(1)
    expect(auditados.rows[0]).toContain('negado')

    // E o estado da conversa NÃO avançou: a trava continua fechada.
    const depois = await conversas.obter('c1')
    expect(autorizarCriacao(depois!).ok).toBe(false)
  })

  it('BURLA — modelo tenta repetir tool já executada: recusada', async () => {
    montar([
      { texto: 'Buscando.', toolsPropostas: [{ nome: 'search_confluence', argumentos: { topico: 'x' } }] },
      { texto: 'Buscando de novo.', toolsPropostas: [{ nome: 'search_confluence', argumentos: { topico: 'x' } }] },
      { texto: 'Ok.' },
    ])
    const c = await conversas.criar('c1', ANA)
    const r = await orquestrador.processarMensagem(c, 'oi', {
      ...CONFIG,
      regra1_threshold_score: 0.99,
    })

    expect(r.toolsExecutadas).toEqual(['search_confluence'])
    expect(r.toolsRecusadas).toContain('search_confluence')
  })
})

describe('RF-09 / RF-12 — Regra 1 bloqueia e a mensagem substitui a resposta do modelo', () => {
  it('bloqueio traz regra, motivo e LINK, e encerra o turno', async () => {
    montar([
      { texto: 'Verificando...', toolsPropostas: [{ nome: 'search_confluence', argumentos: { topico: 'pipeline' } }] },
      { texto: 'TEXTO DO MODELO QUE NÃO DEVE APARECER' },
    ])
    const c = await conversas.criar('c1', ANA)
    const r = await orquestrador.processarMensagem(c, 'como reprocesso o pipeline?', CONFIG)

    expect(r.bloqueado).toBe(true)
    expect(r.regraBloqueio).toBe('regra1_confluence')
    // T-118 — o link chega ao turno apontando para a leitura no app, o que só
    // funciona se o ID da página atravessar cliente → tool → veredito → mensagem.
    expect(r.texto).toContain('/?pagina=p1')
    // A mensagem de bloqueio SUBSTITUI a resposta do modelo. Se o modelo pudesse
    // continuar depois do bloqueio, a regra seria retórica.
    expect(r.texto).not.toContain('NÃO DEVE APARECER')

    const estado = await conversas.obter('c1')
    expect(estado?.estado).toBe('bloqueado')
  })

  it('o bloqueio é registrado com evidência — base da taxa de deflexão (O1)', async () => {
    montar([
      { texto: '...', toolsPropostas: [{ nome: 'search_confluence', argumentos: { topico: 'pipeline' } }] },
    ])
    const c = await conversas.criar('c1', ANA)
    await orquestrador.processarMensagem(c, 'oi', CONFIG)

    const bloqueios = await conversas.listarBloqueios('c1')
    expect(bloqueios).toHaveLength(1)
    expect(bloqueios[0]?.regra).toBe('regra1_confluence')
    expect(bloqueios[0]?.houveOverride).toBe(false)
  })
})

describe('RF-13 / RN-07 — bloqueio é orientação, não parede', () => {
  it('override deixa a conversa seguir, e fica registrado', async () => {
    montar([
      { texto: '...', toolsPropostas: [{ nome: 'search_confluence', argumentos: { topico: 'pipeline' } }] },
    ])
    const c = await conversas.criar('c1', ANA)
    await orquestrador.processarMensagem(c, 'oi', CONFIG)
    expect((await conversas.obter('c1'))?.estado).toBe('bloqueado')

    const sobrepostos = await conversas.registrarOverride('c1', 'a página não cobre meu caso')
    expect(sobrepostos).toBe(1)

    // A conversa volta a andar...
    expect((await conversas.obter('c1'))?.estado).toBe('coletando')
    // ...e o par bloqueio+override permanece: é ele que mede documentação ruim.
    const bloqueios = await conversas.listarBloqueios('c1')
    expect(bloqueios[0]?.houveOverride).toBe(true)
  })

  /**
   * Roteiro que faz as DUAS verificações no primeiro turno e bloqueia nele.
   *
   * É o formato que expõe o furo: com as duas tools concluídas,
   * `verificacoesConcluidas` fica verdadeiro, e a partir do segundo turno nada
   * mais dispara regra (a busca já rodou). Um roteiro que só chama uma tool
   * passaria no teste sem provar nada — a proposta não nasceria de qualquer
   * forma, por falta de verificação.
   */
  const ROTEIRO_BLOQUEIA_COM_TUDO_VERIFICADO: readonly TurnoRoteirizado[] = [
    {
      texto: 'Deixa eu verificar.',
      toolsPropostas: [
        { nome: 'search_confluence', argumentos: { topico: 'pipeline' } },
        { nome: 'check_jira_history', argumentos: { tipoProblema: 'pipeline' } },
      ],
    },
    { texto: 'Entendi, sigo com o chamado.' },
  ]

  it('BURLA — insistir pelo chat NÃO substitui o override: sem proposta e sem registro', async () => {
    montar(ROTEIRO_BLOQUEIA_COM_TUDO_VERIFICADO)
    const c = await conversas.criar('c1', ANA)

    const primeiro = await orquestrador.processarMensagem(c, 'o pipeline não rodou', CONFIG)
    expect(primeiro.bloqueado).toBe(true)
    expect(primeiro.bloqueioPendente).toBe(true)

    // A pessoa ignora o botão e simplesmente manda outra mensagem. Antes desta
    // trava, ESTE turno montava a proposta: nenhuma regra dispara de novo, então
    // `bloqueio` voltava null e o servidor tratava como caminho livre.
    const atual = (await conversas.obter('c1'))!
    const segundo = await orquestrador.processarMensagem(atual, 'isso não resolve meu caso', CONFIG)

    expect(segundo.bloqueado).toBe(false) // nada bloqueou NESTE turno...
    expect(segundo.bloqueioPendente).toBe(true) // ...mas o bloqueio anterior continua de pé
    expect((await conversas.obter('c1'))?.proposta).toBeNull()

    // O modelo escreveu "sigo com o chamado" e o servidor não vai montar nada:
    // sem o lembrete, a tela contradiz o texto e a pessoa acha que travou.
    expect(segundo.texto).toContain('Isso não resolve meu caso')

    // E o que o furo custava: nenhum override registrado entre o bloqueio e a
    // criação, então a taxa de override não contava quem escapou por aqui.
    const bloqueios = await conversas.listarBloqueios('c1')
    expect(bloqueios[0]?.houveOverride).toBe(false)
    const overrides = await db.query(
      `SELECT 1 FROM auditoria WHERE acao = 'override_registrado'`,
      [],
    )
    expect(overrides.rows).toHaveLength(0)
  })

  it('depois do override registrado, a proposta nasce — não virou parede', async () => {
    montar(ROTEIRO_BLOQUEIA_COM_TUDO_VERIFICADO)
    // `rt-1` é o tipo que o fake propõe; sem ele na allowlist a proposta seria
    // descartada por RF-28 e o teste passaria a medir a coisa errada.
    const configComTipo: ConfigValores = { ...CONFIG, tipos_chamado_permitidos: ['rt-1'] }
    const c = await conversas.criar('c1', ANA)
    await orquestrador.processarMensagem(c, 'o pipeline não rodou', configComTipo)

    await conversas.registrarOverride('c1', 'a página é da loja física, meu caso é o site')
    const liberada = (await conversas.obter('c1'))!
    expect(await orquestrador.montarPropostaAgora(liberada, configComTipo)).toBe(true)
    expect((await conversas.obter('c1'))?.proposta).not.toBeNull()
  })

  it('BURLA — `montarPropostaAgora` recusa enquanto o bloqueio estiver de pé (2ª camada)', async () => {
    montar(ROTEIRO_BLOQUEIA_COM_TUDO_VERIFICADO)
    const c = await conversas.criar('c1', ANA)
    await orquestrador.processarMensagem(c, 'o pipeline não rodou', CONFIG)

    // Chamada direta, pulando a rota de override — é o caminho que um handler
    // futuro poderia abrir sem perceber.
    const bloqueada = (await conversas.obter('c1'))!
    expect(await orquestrador.montarPropostaAgora(bloqueada, CONFIG)).toBe(false)
    expect((await conversas.obter('c1'))?.proposta).toBeNull()
  })
})

describe('RF-10 — Regra 2 com classificação e cache', () => {
  it('histórico de ajuste operacional recorrente bloqueia', async () => {
    atlassian.estado.historico = [
      ticket({ issueKey: 'T-1' }),
      ticket({ issueKey: 'T-2' }),
      ticket({ issueKey: 'T-3' }),
    ]
    montar(ROTEIRO_HISTORICO, 'ajuste_operacional')
    const c = await conversas.criar('c1', ANA)
    const r = await orquestrador.processarMensagem(c, 'o pipeline falhou de novo', CONFIG)

    expect(r.bloqueado).toBe(true)
    expect(r.regraBloqueio).toBe('regra2_ajuste_operacional')
    expect(r.texto).toContain('T-1')
  })

  it('R-08 — a classificação é CACHEADA por ticket + hash do comentário', async () => {
    atlassian.estado.historico = [ticket({ issueKey: 'T-1' }), ticket({ issueKey: 'T-2' })]
    montar(ROTEIRO_HISTORICO, 'resolucao_real')
    const c = await conversas.criar('c1', ANA)
    await orquestrador.processarMensagem(c, 'oi', CONFIG)

    const chamadasPrimeira = ia.classificacoesRecebidas.length
    expect(chamadasPrimeira).toBe(2)

    // Segunda conversa, mesmo histórico: nada de reclassificar. O custo da IA
    // escala com volume de tickets (R-08), então reler o mesmo é desperdício puro.
    const c2 = await conversas.criar('c2', ANA)
    const iaAntiga = ia
    await orquestrador.processarMensagem(c2, 'oi', CONFIG)
    expect(iaAntiga.classificacoesRecebidas.length).toBe(chamadasPrimeira)

    const cache = await db.query(`SELECT COUNT(*) AS n FROM classificacoes_ticket`, [])
    expect(linhasComoObjetos<{ n: number }>(cache)[0]?.n).toBe(2)
  })

  it('comentário diferente no mesmo ticket força reclassificação', () => {
    expect(hashConteudo('Rodei manualmente.')).not.toBe(hashConteudo('Corrigi o código.'))
    expect(hashConteudo('igual')).toBe(hashConteudo('igual'))
  })

  it('RF-14 — sem exemplos reais da Gocase a Regra 2 se declara indisponível', async () => {
    montar(ROTEIRO_HISTORICO, 'ajuste_operacional')
    const c = await conversas.criar('c1', ANA)
    const r = await orquestrador.processarMensagem(c, 'oi', {
      ...CONFIG,
      regra2_exemplos_ajuste_operacional: [],
    })

    // Não bloqueou por precaução, e não liberou em silêncio: marcou como falha.
    expect(r.bloqueado).toBe(false)
    const estado = await conversas.obter('c1')
    expect(estado?.historicoFalhou).toBe(true)
    expect(estado?.historicoVerificado).toBe(false)
  })
})

describe('RNF-18 — indisponibilidade não vira bypass nem parede', () => {
  it('Confluence fora: informa, marca falha e a conversa segue', async () => {
    atlassian.estado.falhas.buscarConfluence = 'indisponivel'
    montar([
      { texto: '...', toolsPropostas: [{ nome: 'search_confluence', argumentos: { topico: 'x' } }] },
      { texto: 'Não consegui verificar a documentação agora, mas sigo com você.' },
    ])
    const c = await conversas.criar('c1', ANA)
    const r = await orquestrador.processarMensagem(c, 'oi', CONFIG)

    expect(r.bloqueado).toBe(false)
    const estado = await conversas.obter('c1')
    expect(estado?.confluenceFalhou).toBe(true)
    expect(estado?.confluenceVerificado).toBe(false)
    // O MODELO foi informado da falha — não pode concluir "não achei nada".
    const ultimaMensagemTool = ia.chatsRecebidos.at(-1)?.mensagens.filter((m) => m.papel === 'tool')
    expect(JSON.stringify(ultimaMensagemTool)).toContain('indisponibilidade')
  })

  it('falha de classificação de UM ticket não derruba a regra inteira', async () => {
    atlassian.estado.historico = [ticket({ issueKey: 'T-1' }), ticket({ issueKey: 'T-2' })]
    montar(ROTEIRO_HISTORICO, 'ajuste_operacional')
    ia.falharClassificacao = true
    const c = await conversas.criar('c1', ANA)
    const r = await orquestrador.processarMensagem(c, 'oi', CONFIG)

    // Sem classificação, os tickets contam como indeterminado — e indeterminado
    // não bloqueia. Na dúvida, o ticket passa (R-04).
    expect(r.bloqueado).toBe(false)
    const estado = await conversas.obter('c1')
    expect(estado?.historicoVerificado).toBe(true)
  })
})

describe('RNF-16 — teto de custo por conversa', () => {
  it('atingido o teto, o turno encerra e aponta o formulário', async () => {
    montar([{ texto: 'oi' }])
    await conversas.criar('c1', ANA)
    await conversas.somarCusto('c1', 10)
    const atual = await conversas.obter('c1')

    const r = await orquestrador.processarMensagem(atual!, 'oi', CONFIG)
    expect(r.tetoCustoAtingido).toBe(true)
    expect(r.texto).toContain('formulário')
  })
})

