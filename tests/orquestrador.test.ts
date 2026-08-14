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
import { MENSAGEM_BLOQUEIO_PENDENTE } from '@/lib/rules'
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
  orquestrador = new Orquestrador(ia, executor, conversas, auditoria, novoId, atlassian)
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
    expect(r.texto).toContain('/documentacao?pagina=p1')
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

    // RNF-16 — com bloqueio de pé o modelo nem é chamado: o texto dele seria
    // descartado, e pagar por resposta que ninguém vê, a cada mensagem, é gasto puro.
    expect(ia.chatsRecebidos).toHaveLength(1) // só o primeiro turno
    expect(segundo.custoUsd).toBe(0)

    // O modelo escreveu "Entendi, sigo com o chamado" e o servidor não vai montar
    // nada. Quem fala é o servidor: o texto do modelo é DESCARTADO, não recebe um
    // aviso colado embaixo — isso produzia uma resposta que se contradizia sozinha.
    expect(segundo.texto).toBe(MENSAGEM_BLOQUEIO_PENDENTE)
    expect(segundo.texto).toContain('Isso não resolve meu caso')
    expect(segundo.texto).not.toContain('sigo com o chamado')

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
    //
    // ⚠️ E `service_desk_id` entra junto (`D-70`): a extração só oferece ao modelo tipo
    // que EXISTE no desk configurado, porque tipo de outro desk falharia só na criação.
    const configComTipo: ConfigValores = {
      ...CONFIG,
      tipos_chamado_permitidos: ['rt-1'],
      service_desk_id: 'sd-1',
    }
    atlassian.estado.tiposChamado = [
      { id: 'rt-1', serviceDeskId: 'sd-1', nome: 'Suporte de tecnologia', descricao: null },
    ]
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


/**
 * **T-730 / FR-8, FR-11, RN-13** — o turno REDERIVA a proposta, em vez de congelá-la.
 *
 * ## O defeito que isto fecha
 *
 * A proposta nascia uma vez (`!atual.proposta` era condição para extrair) e não voltava a
 * ser tocada: argumentar depois do cartão montado não mudava nada, e a pessoa só tinha o
 * seletor de prioridade e os campos do formulário. *"Na verdade é no Protheus"* virava uma
 * frase simpática do agente e um chamado idêntico ao anterior.
 *
 * ⚠️ **A base do merge é a última proposta DA IA** (`proposta_ia_json`), nunca a vigente:
 * a vigente carrega a edição da pessoa (`PUT /proposta`), e diffar contra ela faria a IA
 * "mudar" a prioridade só por repetir a sugestão que a pessoa tinha rebaixado — atropelando
 * a escolha dela sem erro nenhum (`SC-7`).
 */
describe('FR-8/RN-13 — a proposta é rederivada a cada turno', () => {
  const ROTEIRO_VERIFICA_E_SEGUE: readonly TurnoRoteirizado[] = [
    {
      texto: 'Deixa eu verificar.',
      toolsPropostas: [
        { nome: 'search_confluence', argumentos: { topico: 'pipeline' } },
        { nome: 'check_jira_history', argumentos: { tipoProblema: 'pipeline' } },
      ],
    },
    { texto: 'Montei o chamado abaixo.' },
    { texto: 'Ajustei como você pediu.' },
    { texto: 'Ajustei de novo.' },
  ]

  /** Config que de fato oferece o tipo `rt-1` (allowlist + service desk — `D-70`). */
  const CONFIG_COM_TIPO: ConfigValores = {
    ...CONFIG,
    tipos_chamado_permitidos: ['rt-1', 'rt-2'],
    service_desk_id: 'sd-1',
    // Threshold alto: a Regra 1 não bloqueia, e o turno chega à proposta.
    regra1_threshold_score: 0.99,
  }

  function prepararTipos() {
    atlassian.estado.tiposChamado = [
      { id: 'rt-1', serviceDeskId: 'sd-1', nome: 'Suporte de tecnologia', descricao: null },
      { id: 'rt-2', serviceDeskId: 'sd-1', nome: 'Acesso a sistema', descricao: null },
    ]
    atlassian.estado.camposPorTipo.set('rt-1', [
      { fieldId: 'customfield_1', rotulo: 'Sistema afetado', obrigatorio: false, tipo: 'texto', opcoes: [] },
      {
        fieldId: 'customfield_2',
        rotulo: 'Recorrência',
        obrigatorio: false,
        tipo: 'selecao',
        opcoes: [
          { id: '10127', rotulo: 'Sempre' },
          { id: '10128', rotulo: 'Às vezes' },
        ],
      },
    ])
  }

  /** Leva a conversa até ter proposta, e devolve o estado dela. */
  async function ateAPrimeiraProposta() {
    prepararTipos()
    const c = await conversas.criar('c1', ANA)
    await orquestrador.processarMensagem(c, 'o pipeline não rodou', CONFIG_COM_TIPO)
    return (await conversas.obter('c1'))!
  }

  it('turno COM proposta existente chama `extrairProposta` de novo', async () => {
    montar(ROTEIRO_VERIFICA_E_SEGUE)
    const comProposta = await ateAPrimeiraProposta()
    expect(comProposta.proposta).not.toBeNull()
    const extracoesAteAqui = ia.extracoesRecebidas.length

    await orquestrador.processarMensagem(comProposta, 'na verdade é no Protheus', CONFIG_COM_TIPO)
    expect(ia.extracoesRecebidas.length).toBe(extracoesAteAqui + 1)
  })

  it('a proposta MUDA quando a IA muda de opinião', async () => {
    montar(ROTEIRO_VERIFICA_E_SEGUE)
    const comProposta = await ateAPrimeiraProposta()
    expect(comProposta.proposta?.titulo).toBe('Pipeline de vendas não atualizou')

    ia.propostaSugerida = {
      ...ia.propostaSugerida!,
      titulo: 'Protheus não atualizou o pipeline de vendas',
      prioridade: 'critica',
    }
    const r = await orquestrador.processarMensagem(
      comProposta,
      'é no Protheus, e parou tudo',
      CONFIG_COM_TIPO,
    )

    const depois = await conversas.obter('c1')
    expect(depois?.proposta?.titulo).toBe('Protheus não atualizou o pipeline de vendas')
    expect(depois?.proposta?.prioridade).toBe('critica')
    // `alterados` é produzido pelo SERVIDOR, num lugar só — a tela mescla com ele e a
    // auditoria de `FR-23` conta com ele. Dois produtores divergiriam em silêncio.
    expect(r.alterados).toContain('titulo')
    expect(r.alterados).toContain('prioridade')
  })

  it('a BASE (`proposta_ia_json`) é gravada junto, com o motivo', async () => {
    montar(ROTEIRO_VERIFICA_E_SEGUE)
    const comProposta = await ateAPrimeiraProposta()

    expect(comProposta.propostaDaIa).not.toBeNull()
    expect(comProposta.propostaDaIa?.motivoPrioridade).toBeTruthy()
    // 🚨 O motivo mora na BASE, nunca na vigente: `validarProposta` é allowlist por
    // construção e o `PUT /proposta` sobrescreve o `proposta_json` inteiro — com o motivo
    // ali, editar a prioridade (o gesto que `RF-16` existe para permitir) o apagaria.
    expect(comProposta.proposta as unknown as Record<string, unknown>).not.toHaveProperty(
      'motivoPrioridade',
    )
  })

  it('a primeira proposta da conversa NÃO conta como ajuste — base nula, `alterados` vazio', async () => {
    montar(ROTEIRO_VERIFICA_E_SEGUE)
    prepararTipos()
    const c = await conversas.criar('c1', ANA)
    const r = await orquestrador.processarMensagem(c, 'o pipeline não rodou', CONFIG_COM_TIPO)
    expect(r.alterados).toEqual([])
  })

  it('RN-07 — com bloqueio pendente não se rederiva, por mais mensagens que venham', async () => {
    montar([
      {
        texto: 'Deixa eu ver.',
        toolsPropostas: [
          { nome: 'search_confluence', argumentos: { topico: 'pipeline' } },
          { nome: 'check_jira_history', argumentos: { tipoProblema: 'pipeline' } },
        ],
      },
      { texto: 'segue' },
      { texto: 'segue de novo' },
    ])
    prepararTipos()
    const c = await conversas.criar('c1', ANA)
    // Threshold baixo: a Regra 1 bloqueia com a página do fake.
    const primeiro = await orquestrador.processarMensagem(c, 'o pipeline não rodou', {
      ...CONFIG_COM_TIPO,
      regra1_threshold_score: 0.5,
    })
    expect(primeiro.bloqueioPendente).toBe(true)
    const extracoesAteAqui = ia.extracoesRecebidas.length

    const atual = (await conversas.obter('c1'))!
    await orquestrador.processarMensagem(atual, 'isso não resolve, abre logo', CONFIG_COM_TIPO)

    expect(ia.extracoesRecebidas.length).toBe(extracoesAteAqui)
    expect((await conversas.obter('c1'))?.proposta).toBeNull()
  })

  it('RNF-16 — com o teto de custo atingido não se rederiva', async () => {
    montar(ROTEIRO_VERIFICA_E_SEGUE)
    await ateAPrimeiraProposta()
    await conversas.somarCusto('c1', 10)
    const caro = (await conversas.obter('c1'))!
    const extracoesAteAqui = ia.extracoesRecebidas.length

    const r = await orquestrador.processarMensagem(caro, 'muda pra crítica', CONFIG_COM_TIPO)
    expect(r.tetoCustoAtingido).toBe(true)
    expect(ia.extracoesRecebidas.length).toBe(extracoesAteAqui)
  })
})

/**
 * **T-742 / FR-11, FR-12, FR-13, FR-14, FR-16** — o ajuste por texto, do rótulo ao `fieldId`.
 */
describe('FR-11 — a IA ajusta os campos do assunto vigente, por rótulo', () => {
  const ROTEIRO: readonly TurnoRoteirizado[] = [
    {
      texto: 'Deixa eu verificar.',
      toolsPropostas: [
        { nome: 'search_confluence', argumentos: { topico: 'pipeline' } },
        { nome: 'check_jira_history', argumentos: { tipoProblema: 'pipeline' } },
      ],
    },
    { texto: 'Montei o chamado.' },
    { texto: 'Ajustei.' },
  ]

  const CONFIG_COM_TIPO: ConfigValores = {
    ...CONFIG,
    tipos_chamado_permitidos: ['rt-1', 'rt-2'],
    service_desk_id: 'sd-1',
    regra1_threshold_score: 0.99,
  }

  async function comProposta() {
    atlassian.estado.tiposChamado = [
      { id: 'rt-1', serviceDeskId: 'sd-1', nome: 'Suporte de tecnologia', descricao: null },
      { id: 'rt-2', serviceDeskId: 'sd-1', nome: 'Acesso a sistema', descricao: null },
    ]
    atlassian.estado.camposPorTipo.set('rt-1', [
      { fieldId: 'customfield_1', rotulo: 'Sistema afetado', obrigatorio: false, tipo: 'texto', opcoes: [] },
      {
        fieldId: 'customfield_2',
        rotulo: 'Recorrência',
        obrigatorio: false,
        tipo: 'selecao',
        opcoes: [
          { id: '10127', rotulo: 'Sempre' },
          { id: '10128', rotulo: 'Às vezes' },
        ],
      },
    ])
    const c = await conversas.criar('c1', ANA)
    await orquestrador.processarMensagem(c, 'o pipeline não rodou', CONFIG_COM_TIPO)
    return (await conversas.obter('c1'))!
  }

  it('o modelo recebe os campos do assunto vigente — por RÓTULO, nunca por fieldId', async () => {
    montar(ROTEIRO)
    const atual = await comProposta()
    await orquestrador.processarMensagem(atual, 'é sempre que acontece', CONFIG_COM_TIPO)

    const ultima = ia.extracoesRecebidas.at(-1)!
    const rotulos = (ultima.camposDoAssunto ?? []).map((c) => c.rotulo)
    expect(rotulos).toContain('Recorrência')
    expect(JSON.stringify(ultima.camposDoAssunto)).not.toContain('customfield')
  })

  it('rótulo e opção que casam viram `fieldId` + valor sugerido', async () => {
    montar(ROTEIRO)
    const atual = await comProposta()
    ia.propostaSugerida = {
      ...ia.propostaSugerida!,
      campos: [{ rotulo: 'Recorrência', valor: 'Sempre' }],
    }
    const r = await orquestrador.processarMensagem(atual, 'acontece sempre', CONFIG_COM_TIPO)

    expect(r.camposSugeridos).toEqual({ customfield_2: '10127' })
    expect(r.alterados).toContain('campo:customfield_2')
    expect(r.recusasDeAjuste).toEqual([])
  })

  it('FR-14 — campo que o assunto não tem é recusado, com o rótulo em português', async () => {
    montar(ROTEIRO)
    const atual = await comProposta()
    ia.propostaSugerida = {
      ...ia.propostaSugerida!,
      campos: [{ rotulo: 'Número da nota fiscal', valor: '123' }],
    }
    const r = await orquestrador.processarMensagem(atual, 'a nota é a 123', CONFIG_COM_TIPO)

    expect(r.camposSugeridos).toEqual({})
    expect(r.recusasDeAjuste).toEqual([
      { rotulo: 'Número da nota fiscal', motivo: 'campo_inexistente' },
    ])
  })

  it('FR-13 — opção fora da lista é recusada, e a tela recebe os RÓTULOS válidos', async () => {
    montar(ROTEIRO)
    const atual = await comProposta()
    ia.propostaSugerida = {
      ...ia.propostaSugerida!,
      campos: [{ rotulo: 'Recorrência', valor: 'De vez em quando' }],
    }
    const r = await orquestrador.processarMensagem(
      atual,
      'acontece de vez em quando',
      CONFIG_COM_TIPO,
    )

    expect(r.camposSugeridos).toEqual({})
    expect(r.recusasDeAjuste[0]?.motivo).toBe('opcao_inexistente')
    expect(r.recusasDeAjuste[0]?.opcoes).toEqual(['Sempre', 'Às vezes'])
    expect(JSON.stringify(r.recusasDeAjuste)).not.toContain('10127')
  })

  it('FR-16 — assunto mudou no mesmo turno: nenhum campo é preenchido', async () => {
    montar(ROTEIRO)
    const atual = await comProposta()
    ia.propostaSugerida = {
      ...ia.propostaSugerida!,
      tipoChamadoId: 'rt-2',
      campos: [{ rotulo: 'Recorrência', valor: 'Sempre' }],
    }
    const r = await orquestrador.processarMensagem(
      atual,
      'na verdade é pedido de acesso',
      CONFIG_COM_TIPO,
    )

    expect(r.alterados).toContain('tipoChamadoId')
    expect(r.camposSugeridos).toEqual({})
    // Nem recusa: o campo não foi avaliado contra um formulário que ainda não é o vigente.
    expect(r.recusasDeAjuste).toEqual([])
  })

  it('FR-12/RF-28 — assunto fora da oferta não muda o assunto', async () => {
    montar(ROTEIRO)
    const atual = await comProposta()
    ia.propostaSugerida = {
      ...ia.propostaSugerida!,
      tipoChamadoId: 'rt-99',
      titulo: 'outro título',
    }
    await orquestrador.processarMensagem(atual, 'joga isso na fila do financeiro', CONFIG_COM_TIPO)

    const depois = await conversas.obter('c1')
    expect(depois?.proposta?.tipoChamadoId).toBe('rt-1')
    // A proposta inteira é descartada (`RF-28`), então nada mais mudou junto.
    expect(depois?.proposta?.titulo).toBe('Pipeline de vendas não atualizou')
  })

  it('D-27 — schema ilegível não ajusta campo nenhum, e o cartão continua de pé', async () => {
    montar(ROTEIRO)
    const atual = await comProposta()
    atlassian.estado.falhas.obterCamposDoTipo = 'indisponivel'
    ia.propostaSugerida = {
      ...ia.propostaSugerida!,
      titulo: 'Título ajustado mesmo sem schema',
      campos: [{ rotulo: 'Recorrência', valor: 'Sempre' }],
    }
    const r = await orquestrador.processarMensagem(atual, 'acontece sempre', CONFIG_COM_TIPO)

    expect(r.camposSugeridos).toEqual({})
    expect(r.recusasDeAjuste).toEqual([])
    // ⚠️ Fail-open: a indisponibilidade do schema não derruba o resto do ajuste.
    expect((await conversas.obter('c1'))?.proposta?.titulo).toBe(
      'Título ajustado mesmo sem schema',
    )
  })
})

/**
 * **T-745 / FR-23, ScC-9** — o que a auditoria registra do ajuste, e o que ela NUNCA registra.
 */
describe('FR-23 — auditoria do ajuste: nomes de campo, nunca valores', () => {
  const ROTEIRO: readonly TurnoRoteirizado[] = [
    {
      texto: 'Verificando.',
      toolsPropostas: [
        { nome: 'search_confluence', argumentos: { topico: 'pipeline' } },
        { nome: 'check_jira_history', argumentos: { tipoProblema: 'pipeline' } },
      ],
    },
    { texto: 'Montei.' },
    { texto: 'Ajustei.' },
  ]
  const CONFIG_COM_TIPO: ConfigValores = {
    ...CONFIG,
    tipos_chamado_permitidos: ['rt-1'],
    service_desk_id: 'sd-1',
    regra1_threshold_score: 0.99,
  }

  function prepararTipo() {
    atlassian.estado.tiposChamado = [
      { id: 'rt-1', serviceDeskId: 'sd-1', nome: 'Suporte de tecnologia', descricao: null },
    ]
  }

  it('`proposta_ajustada` guarda os NOMES dos campos, e nenhum valor digitado', async () => {
    montar(ROTEIRO)
    prepararTipo()
    const c = await conversas.criar('c1', ANA)
    await orquestrador.processarMensagem(c, 'o pipeline não rodou', CONFIG_COM_TIPO)
    const atual = (await conversas.obter('c1'))!

    ia.propostaSugerida = {
      ...ia.propostaSugerida!,
      titulo: 'O Protheus não fecha o pedido 884213',
    }
    await orquestrador.processarMensagem(atual, 'é no Protheus, pedido 884213', CONFIG_COM_TIPO)

    const r = await db.query(
      `SELECT detalhe_json FROM auditoria WHERE acao = 'proposta_ajustada'`,
      [],
    )
    const linhas = linhasComoObjetos<{ detalhe_json: string }>(r)
    expect(linhas).toHaveLength(1)
    expect(linhas[0]!.detalhe_json).toContain('titulo')
    // 🚨 `RN-10`/`RNF-30` — o conteúdo do chamado não vai para a auditoria. Guardar o
    // título gravaria o relato da pessoa numa tabela com piso de retenção de 180 dias.
    expect(linhas[0]!.detalhe_json).not.toContain('Protheus')
    expect(linhas[0]!.detalhe_json).not.toContain('884213')
  })

  it('ScC-9 — motivo reescrito sozinho NÃO conta como proposta ajustada', async () => {
    montar(ROTEIRO)
    prepararTipo()
    const c = await conversas.criar('c1', ANA)
    await orquestrador.processarMensagem(c, 'o pipeline não rodou', CONFIG_COM_TIPO)
    const atual = (await conversas.obter('c1'))!

    ia.propostaSugerida = {
      ...ia.propostaSugerida!,
      motivoPrioridade: 'Outra redação para o mesmo motivo, sem mudar nada do chamado.',
    }
    const r = await orquestrador.processarMensagem(atual, 'entendi', CONFIG_COM_TIPO)

    expect(r.alterados).toEqual(['motivoPrioridade'])
    const linhas = await db.query(
      `SELECT id FROM auditoria WHERE acao = 'proposta_ajustada'`,
      [],
    )
    expect(linhas.rows).toHaveLength(0)
  })
})
