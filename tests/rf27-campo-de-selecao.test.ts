/**
 * 🚨 **Campo de SELEÇÃO ia como string, e o chamado se perdia** — `D-39`.
 *
 * Medido ao vivo na staging em 12/08/2026, com o request type **70**:
 *
 * ```
 * 12:04:10 chamado_criado falha submissao:96c986a0-…
 *          {"erro":"Atlassian respondeu 400","transitorio":false}
 * ```
 *
 * O corpo que a tela mandou era
 * `{"customfield_10092":"…","customfield_10071":"10127"}` — e `customfield_10071`
 * ("Recorrência") é campo de **seleção**. A API de criação espera, para opção, um
 * **objeto** (`{"id":"10127"}`); a string crua responde **400**, que este projeto
 * classifica como **definitivo** — a submissão vira `falha` e **nunca** é
 * reprocessada (`RNF-17`). O mesmo caminho com o tipo **68** (sem campo dinâmico)
 * devolveu 201.
 *
 * ## Por que estes testes afirmam sobre o CORPO, não sobre "abriu chamado"
 *
 * `ClienteAtlassianFake` não valida nada: ele aceitaria a string e devolveria
 * `issueKey`. Foi exatamente assim que `D-38` conviveu com quatro testes verdes
 * afirmando que o chamado abria. Então o que se cobra aqui é o **valor que chega
 * ao transporte** — `fetchImpl` no cliente real, e `params` no fake para os dois
 * caminhos de criação.
 *
 * ## E os dois caminhos, sempre
 *
 * Formulário (`POST /api/chamados`) e conversa (`POST /api/conversas/:id/confirmar`)
 * montam `camposDinamicos` em lugares diferentes. Divergência silenciosa entre eles
 * é o defeito que a spec 006 §8 nomeia — daí cada afirmação existir em dose dupla.
 *
 * _Requirements: RF-27, RNF-17, RNF-18, RNF-30_
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
import { ClienteAtlassianHttp, camposAdicionais } from '@/lib/atlassian/cliente'
import {
  opcoesDesconhecidas,
  paraValoresDoJira,
} from '@/lib/tickets/valores-de-campo'

const ANA = 'ana@gocase.com'
const CHEFE = 'chefe@gocase.com'
const AGORA = '2026-08-12T12:00:00.000Z'

/** O "Recorrência" do tipo 70, com os ids que a staging devolveu. */
const RECORRENCIA = {
  fieldId: 'customfield_10071',
  rotulo: 'Recorrência',
  obrigatorio: true,
  tipo: 'selecao' as const,
  multiplo: false,
  opcoes: [
    { id: '10127', rotulo: 'Sempre' },
    { id: '10128', rotulo: 'Só uma vez' },
  ],
}

const SISTEMA = {
  fieldId: 'customfield_10092',
  rotulo: 'Em que sistema o Bug está ocorrendo?',
  obrigatorio: true,
  tipo: 'texto' as const,
  multiplo: false,
  opcoes: [],
}

/* ---------------------------------------------------------------------- */
/* A regra, como função pura                                              */
/* ---------------------------------------------------------------------- */

describe('paraValoresDoJira — o tipo do campo decide a forma do valor', () => {
  const schema = { conhecido: true as const, campos: [SISTEMA, RECORRENCIA] }

  it('seleção vira OBJETO com o id da opção; texto continua string', () => {
    expect(
      paraValoresDoJira(schema, {
        customfield_10092: 'goatlas (staging)',
        customfield_10071: '10127',
      }),
    ).toEqual({
      customfield_10092: 'goatlas (staging)',
      customfield_10071: { id: '10127' },
    })
  })

  it('seleção MÚLTIPLA vira ARRAY de objeto — objeto solto ali é o mesmo 400', () => {
    const multi = { ...RECORRENCIA, multiplo: true }
    expect(paraValoresDoJira({ conhecido: true, campos: [multi] }, { customfield_10071: '10128' })).toEqual(
      { customfield_10071: [{ id: '10128' }] },
    )
  })

  it('opção cujo id é IGUAL ao rótulo vai como `value` — ali o id nunca foi um id', () => {
    // `validValues[].value` é o que o schema oferece como identificador da opção. Quando
    // ele volta idêntico ao rótulo, o que a Atlassian nos deu foi o texto exibido, e
    // `{"id":"Sim"}` seria uma busca por id que não existe — 400, chamado perdido.
    const porTexto = {
      ...RECORRENCIA,
      opcoes: [{ id: 'Sim', rotulo: 'Sim' }],
    }
    expect(
      paraValoresDoJira({ conhecido: true, campos: [porTexto] }, { customfield_10071: 'Sim' }),
    ).toEqual({ customfield_10071: { value: 'Sim' } })
  })

  it('schema desconhecido não traduz nada — fail-open, como `D-27`', () => {
    expect(paraValoresDoJira({ conhecido: false }, { customfield_10071: '10127' })).toEqual({
      customfield_10071: '10127',
    })
  })

  it('campo de seleção SEM opções conhecidas continua string — não se inventa forma', () => {
    const semOpcoes = { ...RECORRENCIA, opcoes: [] }
    expect(
      paraValoresDoJira({ conhecido: true, campos: [semOpcoes] }, { customfield_10071: 'x' }),
    ).toEqual({ customfield_10071: 'x' })
  })
})

describe('opcoesDesconhecidas — valor fora da lista é recusa, nunca 400 depois', () => {
  const schema = { conhecido: true as const, campos: [SISTEMA, RECORRENCIA] }

  it('nomeia o RÓTULO do campo, nunca o fieldId (`RNF-30`)', () => {
    expect(opcoesDesconhecidas(schema, { customfield_10071: 'Sempre' })).toEqual(['Recorrência'])
  })

  it('opção válida não acusa nada, e campo não preenchido é assunto de `obrigatoriosFaltando`', () => {
    expect(opcoesDesconhecidas(schema, { customfield_10071: '10127' })).toEqual([])
    expect(opcoesDesconhecidas(schema, { customfield_10092: 'algo' })).toEqual([])
  })

  it('schema desconhecido não acusa — não dá para saber a lista', () => {
    expect(opcoesDesconhecidas({ conhecido: false }, { customfield_10071: 'Sempre' })).toEqual([])
  })
})

describe('camposAdicionais — `multiplo` vem do schema, não de palpite', () => {
  it('`type: array` de opções é múltiplo; `type: option` não é', () => {
    const [multi] = camposAdicionais([
      {
        fieldId: 'customfield_10',
        name: 'Setores',
        jiraSchema: { type: 'array', items: 'option' },
        validValues: [{ value: '1', label: 'RPA' }],
      },
    ])
    const [unico] = camposAdicionais([
      {
        fieldId: 'customfield_11',
        name: 'Recorrência',
        jiraSchema: { type: 'option' },
        validValues: [{ value: '10127', label: 'Sempre' }],
      },
    ])
    expect(multi?.tipo).toBe('selecao')
    expect(multi?.multiplo).toBe(true)
    expect(unico?.multiplo).toBe(false)
  })
})

/* ---------------------------------------------------------------------- */
/* O corpo que sai pelo transporte                                        */
/* ---------------------------------------------------------------------- */

describe('criarChamado — o objeto atravessa o cliente sem virar string', () => {
  it('o valor de seleção chega a `requestFieldValues` como objeto', async () => {
    let corpoEnviado: { requestFieldValues: Record<string, unknown> } | null = null
    const cliente = new ClienteAtlassianHttp({
      baseUrl: 'https://gocase.atlassian.net',
      email: 'servico@gocase.com',
      apiToken: 'token',
      ttlMetadadosSeg: 60,
      ttlConteudoSeg: 60,
      maxTentativas: 1,
      fetchImpl: (async (_url: string, init: { body?: string }) => {
        corpoEnviado = JSON.parse(init.body ?? '{}')
        return new Response(JSON.stringify({ issueKey: 'GN-1', issueId: '1' }), { status: 200 })
      }) as unknown as typeof fetch,
    })
    await cliente.criarChamado({
      serviceDeskId: '4',
      tipoChamadoId: '70',
      titulo: 'Título',
      descricao: 'Descrição',
      prioridade: 'normal',
      solicitanteEmail: ANA,
      chaveIdempotencia: 'chave-1',
      camposDinamicos: { customfield_10092: 'Painel', customfield_10071: { id: '10127' } },
    })
    const enviado = corpoEnviado as unknown as { requestFieldValues: Record<string, unknown> }
    expect(enviado.requestFieldValues.customfield_10071).toEqual({ id: '10127' })
    expect(enviado.requestFieldValues.customfield_10092).toBe('Painel')
  })
})

/* ---------------------------------------------------------------------- */
/* Os dois caminhos de criação                                            */
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
  await config.definir('tipos_chamado_permitidos', ['70'], CHEFE, AGORA)
  await config.definir('service_desk_id', '4', CHEFE, AGORA)
  ctx = await montarContexto(
    { DB: db, GOATLAS_USAR_FAKES: '1' },
    () => AGORA,
    () => `id-${++n}`,
  )
  fake = ctx.atlassian as ClienteAtlassianFake
  fake.estado.tiposChamado = [
    { id: '70', serviceDeskId: '4', nome: 'Relatar um bug', descricao: null },
  ]
  fake.estado.camposPorTipo.set('70', [SISTEMA, RECORRENCIA])
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

/** Conversa no ponto exato em que `RF-17` permite confirmar. */
async function conversaPronta(): Promise<string> {
  const c = await ctx.conversas.criar(ctx.novoId(), ANA)
  await ctx.conversas.marcarConfluenceVerificado(c.id, false)
  await ctx.conversas.marcarHistoricoVerificado(c.id, false)
  await ctx.conversas.definirProposta(c.id, {
    titulo: 'O relatório veio errado',
    descricao: 'Os totais de ontem não fecham.',
    tipoChamadoId: '70',
    prioridade: 'alta',
    area: null,
    componente: null,
  })
  await ctx.conversas.definirEstado(c.id, 'aguardando_confirmacao')
  return c.id
}

const CORPO_FORM = {
  titulo: 'O relatório veio errado',
  descricao: 'Os totais de ontem não fecham.',
  tipoChamadoId: '70',
  prioridade: 'alta',
  chaveIdempotencia: 'k1',
}

describe('POST /api/chamados — formulário', () => {
  it('🚨 o campo de seleção sai traduzido; o de texto, cru', async () => {
    const r = await chamar(
      req('/api/chamados', {
        ...CORPO_FORM,
        camposDinamicos: { customfield_10092: 'Painel', customfield_10071: '10127' },
      }),
    )
    expect(r.status).toBe(201)
    expect(ultimaCriacao().camposDinamicos).toEqual({
      customfield_10092: 'Painel',
      customfield_10071: { id: '10127' },
    })
  })

  it('valor fora das opções é recusado ANTES de qualquer efeito, com o rótulo', async () => {
    const r = await chamar(
      req('/api/chamados', {
        ...CORPO_FORM,
        camposDinamicos: { customfield_10092: 'Painel', customfield_10071: 'Sempre' },
      }),
    )
    expect(r.status).toBe(400)
    const corpo = (await r.json()) as { erro: string }
    expect(corpo.erro).toContain('Recorrência')
    expect(corpo.erro).not.toContain('customfield_')
    expect(fake.chamadas.some((c) => c.operacao === 'criarChamado')).toBe(false)
  })

  it('o outbox guarda o valor JÁ traduzido — reprocessar não reabre o 400', async () => {
    await chamar(
      req('/api/chamados', {
        ...CORPO_FORM,
        camposDinamicos: { customfield_10092: 'Painel', customfield_10071: '10127' },
      }),
    )
    const r = await db.query(`SELECT payload_json FROM submissoes WHERE chave_idempotencia = ?`, [
      `form:${ANA}:k1`,
    ])
    const linha = primeiraLinha<{ payload_json: string }>(r)
    const payload = JSON.parse(linha?.payload_json ?? '{}') as {
      camposDinamicos?: Record<string, unknown>
    }
    expect(payload.camposDinamicos?.customfield_10071).toEqual({ id: '10127' })
  })
})

describe('POST /api/conversas/:id/confirmar — conversa', () => {
  it('🚨 traduz igual ao formulário — a divergência silenciosa é o defeito da spec 006 §8', async () => {
    const id = await conversaPronta()
    const r = await chamar(
      req(`/api/conversas/${id}/confirmar`, {
        camposDinamicos: { customfield_10092: 'Painel', customfield_10071: '10127' },
      }),
    )
    expect(r.status).toBe(201)
    expect(ultimaCriacao().camposDinamicos).toEqual({
      customfield_10092: 'Painel',
      customfield_10071: { id: '10127' },
    })
  })

  it('valor fora das opções é recusado, e a conversa NÃO fica marcada como confirmada', async () => {
    const id = await conversaPronta()
    const r = await chamar(
      req(`/api/conversas/${id}/confirmar`, {
        camposDinamicos: { customfield_10092: 'Painel', customfield_10071: 'Sempre' },
      }),
    )
    expect(r.status).toBe(400)
    expect(fake.chamadas.some((c) => c.operacao === 'criarChamado')).toBe(false)
    const depois = await ctx.conversas.obterDoSolicitante(id, ANA)
    expect(depois?.confirmadoEm ?? null).toBeNull()
  })
})
