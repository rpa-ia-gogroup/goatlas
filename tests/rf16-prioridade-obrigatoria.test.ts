/**
 * 🚨 **11 dos 15 tipos do `GN` exigem prioridade, e o app nunca a enviava** — `D-48`.
 *
 * Medido contra a Atlassian real em 12/08/2026 (staging `3936ca2d`), pela rota de
 * diagnóstico de `D-44`:
 *
 * | tipo | prioridade |
 * |---|---|
 * | 68, 108, 143, 144 | ausente |
 * | 71, 90, 93 | **OBRIGATÓRIA**, sem nenhum select |
 * | 70, 89, 91, 92, 94, 95, 96, 134 | **OBRIGATÓRIA**, mais "Recorrência" |
 *
 * As duas medições que fecham a causa: os quatro tipos **sem** prioridade são exatamente
 * os que abriram chamado (`GN-6897`, `GN-6898`, tipo 68), e o tipo **71** — que exige
 * prioridade e **não tem select nenhum** — respondeu `400`, `transitorio: false` já com o
 * `D-39` deployado. Ou seja: a prioridade obrigatória sozinha basta para matar a criação.
 *
 * E 400 é **definitivo** neste projeto: a submissão vira `falha` e **nunca** é
 * reprocessada (`RNF-17`).
 *
 * ## Por que ninguém via
 *
 * `camposAdicionais` descarta `summary`/`description`/`priority` — certo para desenhar o
 * formulário (`D-04` já os tem fixos), e **cego** para "este campo é obrigatório e não
 * estou mandando": `obrigatoriosFaltando` nunca via `priority`. E `montarCamposSolicitante`
 * só enviava prioridade com `opcoes.campoPrioridadeId` preenchido — chave que `contexto.ts`
 * nunca passou e que não existia em `ConfigValores`. O caminho estava morto desde sempre.
 *
 * ## Por que estes testes afirmam sobre o CORPO, e não sobre "abriu chamado"
 *
 * `ClienteAtlassianFake` não valida nada — foi ele que escondeu `D-38`, `D-39` e `D-43`.
 * Então o que se cobra aqui é o **valor que chega ao transporte** (`fetchImpl` no cliente
 * real), o **payload persistido no outbox**, e os `params` do fake nos dois caminhos de
 * criação.
 *
 * _Requirements: RF-16, RF-27, RF-29, RNF-17, RNF-18, RNF-30_
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { SqliteLocal } from '@/lib/db/sqlite-local'
import { migrar } from '@/lib/db/schema'
import { Config } from '@/lib/config'
import { montarContexto, type Contexto } from '@/lib/contexto'
import { tratarRequisicao } from '@/lib/http/rotas'
import { HEADER_EMAIL } from '@/lib/auth'
import { ClienteAtlassianFake } from '@/lib/atlassian/fake'
import { primeiraLinha } from '@/lib/db/tipos'
import { ClienteAtlassianHttp, campoDePrioridade, camposAdicionais } from '@/lib/atlassian/cliente'
import { slaDePrimeiraResposta } from '@/lib/atlassian/sla-do-jsm'
import {
  juntarCamposDaCriacao,
  opcaoDePrioridade,
  prioridadeDoRotulo,
  prioridadeParaOJira,
} from '@/lib/tickets/valores-de-campo'
import type { CampoRequestType } from '@/lib/atlassian/tipos'

const ANA = 'ana@gocase.com'
const CHEFE = 'chefe@gocase.com'
const AGORA = '2026-08-12T12:00:00.000Z'

/** O campo `priority` do tipo 70, com os ids que a staging devolveu em 12/08/2026. */
const PRIORIDADE_BRUTA = {
  fieldId: 'priority',
  name: 'Prioridade',
  required: true,
  jiraSchema: { type: 'priority', system: 'priority', custom: null, items: null },
  validValues: [
    { id: '1', label: 'Highest' },
    { id: '2', label: 'High' },
    { id: '3', label: 'Medium' },
    { id: '4', label: 'Low' },
    { id: '5', label: 'Lowest' },
  ],
}

/** O mesmo campo, já no vocabulário do app. */
const PRIORIDADE: CampoRequestType = {
  fieldId: 'priority',
  rotulo: 'Prioridade',
  obrigatorio: true,
  tipo: 'selecao',
  multiplo: false,
  opcoes: [
    { id: '1', rotulo: 'Highest' },
    { id: '2', rotulo: 'High' },
    { id: '3', rotulo: 'Medium' },
    { id: '4', rotulo: 'Low' },
    { id: '5', rotulo: 'Lowest' },
  ],
}

/* ---------------------------------------------------------------------- */
/* A escolha da opção — função pura                                        */
/* ---------------------------------------------------------------------- */

describe('opcaoDePrioridade — o rótulo acha a opção; o ID vem do schema', () => {
  it('as três prioridades casam com os rótulos medidos, e devolvem o id do site', () => {
    expect(opcaoDePrioridade(PRIORIDADE.opcoes, 'critica')?.id).toBe('1')
    expect(opcaoDePrioridade(PRIORIDADE.opcoes, 'alta')?.id).toBe('2')
    expect(opcaoDePrioridade(PRIORIDADE.opcoes, 'normal')?.id).toBe('3')
  })

  it('🚨 o id NÃO sai de uma tabela nossa — o mesmo rótulo com outro id devolve o outro id', () => {
    // É a diferença entre `D-48` e a `ROTULO_PRIORIDADE` que ele aposentou: aquela mandava
    // `{name: "High"}`, e um "renomear prioridade" no Jira virava 400 definitivo. Aqui o
    // que a instalação oferece é o que vai.
    const outroSite = [
      { id: '10200', rotulo: 'Highest' },
      { id: '10201', rotulo: 'High' },
    ]
    expect(opcaoDePrioridade(outroSite, 'alta')?.id).toBe('10201')
  })

  it('acento e caixa não separam: `Média` é a mesma coisa que `medium`', () => {
    const emPortugues = [
      { id: '9', rotulo: 'Crítica' },
      { id: '8', rotulo: 'Alta' },
      { id: '7', rotulo: 'Média' },
    ]
    expect(opcaoDePrioridade(emPortugues, 'critica')?.id).toBe('9')
    expect(opcaoDePrioridade(emPortugues, 'normal')?.id).toBe('7')
  })

  it('esquema de TRÊS níveis: crítica desce para o topo que existe (`High`)', () => {
    const tresNiveis = [
      { id: '2', rotulo: 'High' },
      { id: '3', rotulo: 'Medium' },
      { id: '4', rotulo: 'Low' },
    ]
    expect(opcaoDePrioridade(tresNiveis, 'critica')?.id).toBe('2')
  })

  it('🚨 nunca SOBE: normal não vira `High` nem quando falta `Medium`', () => {
    // Inflação de prioridade é justamente o que `RF-16` existe para evitar — se "normal"
    // pudesse virar "High", a fila inteira nasceria alta sem ninguém ter escolhido.
    const semMedio = [
      { id: '1', rotulo: 'Highest' },
      { id: '2', rotulo: 'High' },
      { id: '4', rotulo: 'Low' },
    ]
    expect(opcaoDePrioridade(semMedio, 'normal')).toBeNull()
  })

  it('🚨 `Low` é LIDA como normal e nunca ESCRITA como normal', () => {
    // A tabela é uma só, com a distinção declarada (`escrita: false`): sem ela, `Low`
    // apareceria antes de `Medium` numa lista e a escolha da pessoa seria rebaixada em
    // silêncio.
    expect(prioridadeDoRotulo('Low')).toBe('normal')
    expect(opcaoDePrioridade([{ id: '4', rotulo: 'Low' }], 'normal')).toBeNull()
  })

  it('rótulo que não reconhecemos não casa nada — palpite aqui é pior que ausência', () => {
    expect(opcaoDePrioridade([{ id: 'x', rotulo: 'P0' }], 'critica')).toBeNull()
  })
})

/* ---------------------------------------------------------------------- */
/* A decisão: enviar, omitir ou recusar                                    */
/* ---------------------------------------------------------------------- */

describe('prioridadeParaOJira — as quatro saídas', () => {
  it('tipo que não publica prioridade não recebe campo nenhum (tipos 68/108/143/144)', () => {
    expect(prioridadeParaOJira(null, 'alta')).toEqual({ ok: true, campos: {} })
  })

  it('casou: vai `{id}` no fieldId QUE VEIO DO SCHEMA', () => {
    expect(prioridadeParaOJira(PRIORIDADE, 'alta')).toEqual({
      ok: true,
      campos: { priority: { id: '2' } },
    })
  })

  it('opção cujo id é IGUAL ao rótulo vai como `value` — a exceção de `D-39`', () => {
    const porTexto: CampoRequestType = {
      ...PRIORIDADE,
      opcoes: [{ id: 'High', rotulo: 'High' }],
    }
    expect(prioridadeParaOJira(porTexto, 'alta')).toEqual({
      ok: true,
      campos: { priority: { value: 'High' } },
    })
  })

  it('não casou e o campo é OPCIONAL: omite e abre o chamado (`RNF-18`)', () => {
    const opcional: CampoRequestType = {
      ...PRIORIDADE,
      obrigatorio: false,
      opcoes: [{ id: 'x', rotulo: 'P0' }],
    }
    expect(prioridadeParaOJira(opcional, 'critica')).toEqual({ ok: true, campos: {} })
  })

  it('🚨 não casou e o campo é OBRIGATÓRIO: recusa, com o RÓTULO e nunca o fieldId', () => {
    const semCorrespondencia: CampoRequestType = {
      ...PRIORIDADE,
      opcoes: [{ id: 'x', rotulo: 'P0' }],
    }
    const r = prioridadeParaOJira(semCorrespondencia, 'critica')
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.mensagem).toContain('Prioridade')
    expect(r.mensagem).not.toContain('priority')
    expect(r.mensagem).not.toContain('customfield')
  })

  it('obrigatório SEM opção nenhuma também recusa — não há id para inventar', () => {
    const semOpcoes: CampoRequestType = { ...PRIORIDADE, opcoes: [] }
    expect(prioridadeParaOJira(semOpcoes, 'normal').ok).toBe(false)
  })
})

describe('juntarCamposDaCriacao — a prioridade entra por último', () => {
  it('nada de nada continua `null`, não `{}` — o outbox guarda o mesmo corpo de antes', () => {
    expect(juntarCamposDaCriacao(null, {})).toBeNull()
  })

  it('a prioridade do servidor vence um campo de mesmo nome vindo de baixo', () => {
    expect(
      juntarCamposDaCriacao({ priority: 'lixo do cliente' }, { priority: { id: '3' } }),
    ).toEqual({ priority: { id: '3' } })
  })
})

/* ---------------------------------------------------------------------- */
/* A leitura de volta                                                      */
/* ---------------------------------------------------------------------- */

describe('prioridadeDoRotulo — o MESMO vocabulário da escrita', () => {
  it('traduz os rótulos do site, com e sem acento', () => {
    expect(prioridadeDoRotulo('Highest')).toBe('critica')
    expect(prioridadeDoRotulo('High')).toBe('alta')
    expect(prioridadeDoRotulo('Medium')).toBe('normal')
    expect(prioridadeDoRotulo('Média')).toBe('normal')
    expect(prioridadeDoRotulo('Crítica')).toBe('critica')
  })

  it('rótulo desconhecido e vazio devolvem `null`, nunca um palpite', () => {
    expect(prioridadeDoRotulo('P0')).toBeNull()
    expect(prioridadeDoRotulo('')).toBeNull()
  })
})

/* ---------------------------------------------------------------------- */
/* O leitor do schema — decide por TIPO, nunca por id (`ScC-4`)            */
/* ---------------------------------------------------------------------- */

describe('campoDePrioridade — o terceiro leitor do mesmo `/field`', () => {
  it('acha o campo pelo `jiraSchema.system`, com o `required` e as opções do site', () => {
    const campo = campoDePrioridade([PRIORIDADE_BRUTA])
    expect(campo?.fieldId).toBe('priority')
    expect(campo?.rotulo).toBe('Prioridade')
    expect(campo?.obrigatorio).toBe(true)
    expect(campo?.opcoes).toHaveLength(5)
  })

  it('🚨 um `fieldId` diferente NÃO muda nada: quem responde é o `system`', () => {
    const campo = campoDePrioridade([
      { ...PRIORIDADE_BRUTA, fieldId: 'customfield_99999' },
    ])
    expect(campo?.fieldId).toBe('customfield_99999')
  })

  it('e um campo CHAMADO `priority` que não é de prioridade não conta', () => {
    expect(
      campoDePrioridade([
        {
          fieldId: 'priority',
          name: 'Prioridade do cliente',
          jiraSchema: { type: 'string', system: null, custom: 'textfield', items: null },
        },
      ]),
    ).toBeNull()
  })

  it('tipo sem prioridade devolve `null` — é o caso dos tipos 68/108/143/144', () => {
    expect(campoDePrioridade([{ fieldId: 'summary', jiraSchema: { system: 'summary' } }])).toBeNull()
  })

  it('⚠️ e `camposAdicionais` continua CEGO para prioridade — o descarte de `D-44` fica', () => {
    // As duas afirmações no mesmo teste de propósito: é o par que documenta por que o
    // terceiro leitor precisou existir em vez de "só parar de filtrar".
    expect(camposAdicionais([PRIORIDADE_BRUTA])).toEqual([])
  })
})

/* ---------------------------------------------------------------------- */
/* O corpo que sai pelo transporte                                         */
/* ---------------------------------------------------------------------- */

function clienteComFetch(fetchImpl: unknown): ClienteAtlassianHttp {
  return new ClienteAtlassianHttp({
    baseUrl: 'https://gocase.atlassian.net',
    email: 'servico@gocase.com',
    apiToken: 'token',
    ttlMetadadosSeg: 60,
    ttlConteudoSeg: 60,
    maxTentativas: 1,
    fetchImpl: fetchImpl as typeof fetch,
  })
}

describe('o cliente real — uma leitura, três respostas, e o corpo da criação', () => {
  it('🚨 os três leitores do schema custam UMA requisição (`R-02`)', async () => {
    let idas = 0
    const cliente = clienteComFetch(async () => {
      idas += 1
      return new Response(JSON.stringify({ requestTypeFields: [PRIORIDADE_BRUTA] }), {
        status: 200,
      })
    })
    await cliente.obterCamposDoTipo('4', '70')
    await cliente.obterCampoDePrioridade('4', '70')
    await cliente.obterSchemaDoTipo('4', '70')
    expect(idas).toBe(1)
  })

  it('cada leitor devolve a SUA forma — cache compartilhada é do corpo cru, não do resultado', async () => {
    // A advertência de `D-44`: chave de cache compartilhada faria o segundo a chamar
    // receber a forma do primeiro. Aqui o que se compartilha é o corpo da Atlassian.
    const cliente = clienteComFetch(
      async () =>
        new Response(JSON.stringify({ requestTypeFields: [PRIORIDADE_BRUTA] }), { status: 200 }),
    )
    expect(await cliente.obterCamposDoTipo('4', '70')).toEqual([])
    expect((await cliente.obterCampoDePrioridade('4', '70'))?.fieldId).toBe('priority')
    expect((await cliente.obterSchemaDoTipo('4', '70'))[0]?.jiraSchema.system).toBe('priority')
  })

  it('🚨 `criarChamado` leva a prioridade como objeto em `requestFieldValues`', async () => {
    let corpoEnviado: { requestFieldValues: Record<string, unknown> } | null = null
    const cliente = clienteComFetch(async (_url: string, init: { body?: string }) => {
      corpoEnviado = JSON.parse(init.body ?? '{}')
      return new Response(JSON.stringify({ issueKey: 'GN-1', issueId: '1' }), { status: 200 })
    })
    await cliente.criarChamado({
      serviceDeskId: '4',
      tipoChamadoId: '71',
      titulo: 'Título',
      descricao: 'Descrição',
      prioridade: 'alta',
      solicitanteEmail: ANA,
      chaveIdempotencia: 'chave-1',
      camposDinamicos: { priority: { id: '2' } },
    })
    const enviado = corpoEnviado as unknown as { requestFieldValues: Record<string, unknown> }
    expect(enviado.requestFieldValues.priority).toEqual({ id: '2' })
  })

  it('a leitura de volta traduz o rótulo do Jira pelo mesmo vocabulário', async () => {
    const cliente = clienteComFetch(
      async () =>
        new Response(
          JSON.stringify({
            issueKey: 'GN-1',
            requestFieldValues: [{ fieldId: 'priority', value: { name: 'High', id: '2' } }],
            currentStatus: { status: 'Aberto', statusDate: { iso8601: AGORA } },
            createdDate: { iso8601: AGORA },
          }),
          { status: 200 },
        ),
    )
    expect((await cliente.obterChamado('GN-1')).prioridade).toBe('alta')
  })
})

/* ---------------------------------------------------------------------- */
/* O SLA que já vinha e era descartado                                     */
/* ---------------------------------------------------------------------- */

describe('slaDePrimeiraResposta — o dado existia e a última linha o jogava fora', () => {
  const emCurso = {
    values: [
      {
        name: 'Time to first response',
        ongoingCycle: { breachTime: { iso8601: '2026-08-13T12:00:00.000Z' }, breached: false },
      },
    ],
  }

  it('identifica pelo nome e traz o prazo; ciclo correndo NÃO é "cumprido"', () => {
    expect(slaDePrimeiraResposta(emCurso)).toEqual({
      prazo: '2026-08-13T12:00:00.000Z',
      cumprido: null,
    })
  })

  it('em português também — o nome é configurado por instalação', () => {
    expect(
      slaDePrimeiraResposta({
        values: [{ name: 'Tempo até a primeira resposta', ongoingCycle: { breached: true } }],
      }),
    ).toEqual({ prazo: null, cumprido: false })
  })

  it('ciclo CONCLUÍDO decide: não estourou = cumprido', () => {
    expect(
      slaDePrimeiraResposta({
        values: [
          {
            name: 'Time to first response',
            completedCycles: [
              { breachTime: { iso8601: '2026-08-13T12:00:00.000Z' }, breached: false },
            ],
          },
        ],
      }),
    ).toEqual({ prazo: '2026-08-13T12:00:00.000Z', cumprido: true })
  })

  it('🚨 SLA que não reconhecemos devolve `null` — nunca "o primeiro da lista"', () => {
    // Um chamado com um SLA só, que por acaso seja o de RESOLUÇÃO, mostraria um prazo de
    // dias onde a pessoa lê "alguém te responde até".
    expect(slaDePrimeiraResposta({ values: [{ name: 'Time to resolution' }] })).toBeNull()
  })

  it('sem `sla`, sem `values` e com lixo: `null`, nunca uma data inventada', () => {
    expect(slaDePrimeiraResposta(undefined)).toBeNull()
    expect(slaDePrimeiraResposta({})).toBeNull()
    expect(slaDePrimeiraResposta({ values: 'nada disso' })).toBeNull()
  })
})

/* ---------------------------------------------------------------------- */
/* Os dois caminhos de criação                                             */
/* ---------------------------------------------------------------------- */

let db: SqliteLocal
let ctx: Contexto
let fake: ClienteAtlassianFake
let n = 0

beforeEach(async () => {
  db = new SqliteLocal()
  await migrar(db)
  n = 0
  const config = new Config(db)
  await config.definir('dominios_permitidos', ['gocase.com'], CHEFE, AGORA)
  await config.definir('admins', [CHEFE], CHEFE, AGORA)
  await config.definir('tipos_chamado_permitidos', ['70', '71', '68'], CHEFE, AGORA)
  await config.definir('service_desk_id', '4', CHEFE, AGORA)
  ctx = await montarContexto(
    { DB: db, GOATLAS_USAR_FAKES: '1' },
    () => AGORA,
    () => `id-${++n}`,
  )
  fake = ctx.atlassian as ClienteAtlassianFake
  fake.estado.tiposChamado = [
    { id: '71', serviceDeskId: '4', nome: 'Solicitar acesso', descricao: null },
    { id: '68', serviceDeskId: '4', nome: 'Outros', descricao: null },
  ]
  // O tipo 71: prioridade obrigatória e NENHUM select. Foi ele que respondeu 400 na
  // staging já com o `D-39` deployado — a prova de que a prioridade sozinha matava.
  fake.estado.prioridadePorTipo.set('71', PRIORIDADE)
})

function req(caminho: string, corpo: unknown): Request {
  return new Request(`https://goatlas.devgogroup.com${caminho}`, {
    method: 'POST',
    headers: { [HEADER_EMAIL]: ANA },
    ...(corpo === undefined ? {} : { body: JSON.stringify(corpo) }),
  })
}

const chamar = (r: Request) => tratarRequisicao(r, ctx, {})

function ultimaCriacao(): { camposDinamicos?: Record<string, unknown> } {
  const criacoes = fake.chamadas.filter((c) => c.operacao === 'criarChamado')
  return (criacoes[criacoes.length - 1]?.params ?? {}) as {
    camposDinamicos?: Record<string, unknown>
  }
}

async function conversaPronta(tipoChamadoId: string): Promise<string> {
  const c = await ctx.conversas.criar(ctx.novoId(), ANA)
  await ctx.conversas.marcarConfluenceVerificado(c.id, false)
  await ctx.conversas.marcarHistoricoVerificado(c.id, false)
  await ctx.conversas.definirProposta(c.id, {
    titulo: 'Preciso de acesso ao painel',
    descricao: 'Entrei no time novo e não consigo abrir o relatório.',
    tipoChamadoId,
    prioridade: 'alta',
    area: null,
    componente: null,
  })
  await ctx.conversas.definirEstado(c.id, 'aguardando_confirmacao')
  return c.id
}

const CORPO_FORM = {
  titulo: 'Preciso de acesso ao painel',
  descricao: 'Entrei no time novo e não consigo abrir o relatório.',
  tipoChamadoId: '71',
  prioridade: 'alta',
  chaveIdempotencia: 'k1',
}

describe('POST /api/chamados — formulário', () => {
  it('🚨 a prioridade escolhida chega ao Jira, no fieldId e com o id do schema', async () => {
    const r = await chamar(req('/api/chamados', CORPO_FORM))
    expect(r.status).toBe(201)
    expect(ultimaCriacao().camposDinamicos).toEqual({ priority: { id: '2' } })
  })

  it('o outbox guarda o valor JÁ traduzido — o retry de `RNF-17` não relê schema', async () => {
    await chamar(req('/api/chamados', CORPO_FORM))
    const r = await db.query(`SELECT payload_json FROM submissoes WHERE chave_idempotencia = ?`, [
      `form:${ANA}:k1`,
    ])
    const linha = primeiraLinha<{ payload_json: string }>(r)
    const payload = JSON.parse(linha?.payload_json ?? '{}') as {
      camposDinamicos?: Record<string, unknown>
    }
    expect(payload.camposDinamicos?.priority).toEqual({ id: '2' })
  })

  it('tipo SEM campo de prioridade não recebe nada, e abre igual (68 abriu na staging)', async () => {
    const r = await chamar(req('/api/chamados', { ...CORPO_FORM, tipoChamadoId: '68' }))
    expect(r.status).toBe(201)
    expect(ultimaCriacao().camposDinamicos).toBeUndefined()
  })

  it('🚨 o cliente NÃO escolhe a própria prioridade no Jira', async () => {
    // Duas camadas: `filtrarPeloSchema` não conhece `priority` (ele nunca está em
    // `camposAdicionais`), e a ordem do merge põe o valor do servidor por último.
    const r = await chamar(
      req('/api/chamados', {
        ...CORPO_FORM,
        prioridade: 'normal',
        camposDinamicos: { priority: { id: '1' } },
      }),
    )
    expect(r.status).toBe(201)
    expect(ultimaCriacao().camposDinamicos).toEqual({ priority: { id: '3' } })
  })

  it('nenhuma opção casa e o campo é obrigatório: 400 ANTES de qualquer efeito', async () => {
    fake.estado.prioridadePorTipo.set('71', { ...PRIORIDADE, opcoes: [{ id: 'x', rotulo: 'P0' }] })
    const r = await chamar(req('/api/chamados', CORPO_FORM))
    expect(r.status).toBe(400)
    const corpo = (await r.json()) as { erro: string }
    expect(corpo.erro).toContain('Prioridade')
    expect(corpo.erro).not.toContain('priority')
    expect(fake.chamadas.some((c) => c.operacao === 'criarChamado')).toBe(false)
  })

  it('schema fora do ar: abre sem prioridade — degradar, nunca virar parede (`RNF-18`)', async () => {
    fake.estado.falhas.obterCamposDoTipo = 'indisponivel'
    const r = await chamar(req('/api/chamados', CORPO_FORM))
    expect(r.status).toBe(201)
    expect(ultimaCriacao().camposDinamicos).toBeUndefined()
    const auditoria = await db.query(
      `SELECT detalhe_json FROM auditoria WHERE acao = 'schema_tipo_indisponivel'`,
      [],
    )
    const linha = primeiraLinha<{ detalhe_json: string }>(auditoria)
    expect(String(linha?.detalhe_json)).toContain('prioridade_nao_enviada')
  })
})

describe('POST /api/conversas/:id/confirmar — conversa', () => {
  it('🚨 manda a MESMA coisa que o formulário — a divergência silenciosa é o defeito', async () => {
    const id = await conversaPronta('71')
    const r = await chamar(req(`/api/conversas/${id}/confirmar`, {}))
    expect(r.status).toBe(201)
    expect(ultimaCriacao().camposDinamicos).toEqual({ priority: { id: '2' } })
  })

  it('a recusa vem antes de `registrarConfirmacao` — a conversa não fica marcada', async () => {
    fake.estado.prioridadePorTipo.set('71', { ...PRIORIDADE, opcoes: [{ id: 'x', rotulo: 'P0' }] })
    const id = await conversaPronta('71')
    const r = await chamar(req(`/api/conversas/${id}/confirmar`, {}))
    expect(r.status).toBe(400)
    expect(fake.chamadas.some((c) => c.operacao === 'criarChamado')).toBe(false)
    const depois = await ctx.conversas.obterDoSolicitante(id, ANA)
    expect(depois?.confirmadoEm ?? null).toBeNull()
  })

  it('tipo sem prioridade abre igual pela conversa', async () => {
    const id = await conversaPronta('68')
    const r = await chamar(req(`/api/conversas/${id}/confirmar`, {}))
    expect(r.status).toBe(201)
    expect(ultimaCriacao().camposDinamicos).toBeUndefined()
  })
})
