/**
 * Diagnóstico — o schema do request type COMO A ATLASSIAN O ENTREGA.
 *
 * ## O bug que este arquivo previne
 *
 * `GET /api/tipos-chamado/:id/campos` serve o formulário de `RF-27`, e por isso
 * `camposAdicionais` **descarta** `summary`, `description` e `priority` antes de qualquer
 * um poder olhar. Descarte certo para o produto e ponto cego para diagnóstico: aquela
 * rota nunca mostra `priority`, **exista ele ou não**, então "consultei e não tem
 * prioridade" é uma conclusão inválida por construção — foi tirada uma vez, em
 * 12/08/2026, e é o que motivou a rota nova.
 *
 * O teste que carrega o peso é o primeiro: ele coloca os dois leitores lado a lado sobre
 * o **mesmo** corpo bruto e afirma que um perde `priority` e o outro não. Sem essa
 * asserção, alguém "unifica os dois para não duplicar código" e o instrumento de medida
 * volta a ter o mesmo cego do objeto medido.
 *
 * ## E os limites, que são os de sempre
 *
 * Admin · só a allowlist de `RF-28` · só o service desk configurado. A rota não é uma
 * janela para varrer o site, e o teste de burla está aqui pelo mesmo motivo que
 * `admin-gate.test.ts` existe: a lista de limites que só vive no comentário é a que
 * envelhece.
 *
 * _Requirements: RF-16, RF-27, RF-28, RN-09, RNF-01, RNF-18, RNF-30_
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { SqliteLocal } from '@/lib/db/sqlite-local'
import { migrar } from '@/lib/db/schema'
import { Config } from '@/lib/config'
import { montarContexto, type Contexto } from '@/lib/contexto'
import { tratarRequisicao } from '@/lib/http/rotas'
import { HEADER_EMAIL } from '@/lib/auth'
import { ClienteAtlassianFake } from '@/lib/atlassian/fake'
import { ClienteAtlassianSomenteLeitura } from '@/lib/atlassian/somente-leitura'
import { camposAdicionais } from '@/lib/atlassian/cliente'
import {
  MAX_OPCOES_LISTADAS,
  normalizarSchema,
  temCampoDePrioridade,
  type CampoDoSchema,
} from '@/lib/atlassian/schema-diagnostico'

const ANA = 'ana@gocase.com'
const CHEFE = 'chefe@gocase.com'
const AGORA = '2026-08-12T12:00:00.000Z'

/** Um corpo `requestTypeFields` como o JSM o devolve, com prioridade dentro. */
const BRUTO_COM_PRIORIDADE = [
  {
    fieldId: 'summary',
    name: 'Resumo',
    required: true,
    jiraSchema: { type: 'string', system: 'summary' },
  },
  {
    fieldId: 'priority',
    name: 'Prioridade',
    required: false,
    jiraSchema: { type: 'priority', system: 'priority' },
    validValues: [
      { id: '1', label: 'Highest' },
      { id: '3', label: 'Medium' },
    ],
  },
  {
    fieldId: 'customfield_10071',
    name: 'Recorrência',
    required: true,
    jiraSchema: { type: 'option', custom: 'com.atlassian.jira.plugin.system.customfieldtypes:select' },
    validValues: [{ id: '10127', label: 'Primeira vez' }],
  },
]

describe('o ponto cego — os dois leitores sobre o MESMO corpo', () => {
  it('`camposAdicionais` perde `priority`; `normalizarSchema` o preserva', () => {
    const paraOFormulario = camposAdicionais(BRUTO_COM_PRIORIDADE)
    const paraODiagnostico = normalizarSchema(BRUTO_COM_PRIORIDADE)

    // O leitor do formulário está CERTO em descartar — `D-04` já tem o input fixo.
    expect(paraOFormulario.map((c) => c.fieldId)).toEqual(['customfield_10071'])

    // E é justamente por isso que ele não pode ser a fonte do diagnóstico.
    expect(paraODiagnostico.map((c) => c.fieldId)).toEqual([
      'summary',
      'priority',
      'customfield_10071',
    ])
    expect(temCampoDePrioridade(paraODiagnostico)).toBe(true)
    expect(temCampoDePrioridade(camposAdicionaisComoSchema())).toBe(false)
  })

  /**
   * A prova de que o cego é do CAMINHO, não do dado: passar o resultado do leitor do
   * formulário pelo detector de prioridade devolve `false` sobre um corpo que **tem**
   * prioridade. É a resposta errada que a rota antiga daria, encenada.
   */
  function camposAdicionaisComoSchema(): readonly CampoDoSchema[] {
    const restantes = new Set(camposAdicionais(BRUTO_COM_PRIORIDADE).map((c) => c.fieldId))
    return normalizarSchema(BRUTO_COM_PRIORIDADE.filter((b) => restantes.has(b.fieldId)))
  }
})

describe('normalizarSchema — preserva, não interpreta', () => {
  it('cada parte de `jiraSchema` sai nomeada, e o ausente é `null` (nunca `""`)', () => {
    const [, prioridade, selecao] = normalizarSchema(BRUTO_COM_PRIORIDADE)
    expect(prioridade!.jiraSchema).toEqual({
      type: 'priority',
      system: 'priority',
      custom: null,
      items: null,
    })
    expect(selecao!.jiraSchema.custom).toContain('customfieldtypes:select')
    expect(selecao!.jiraSchema.system).toBeNull()
    expect(selecao!.required).toBe(true)
    expect(selecao!.name).toBe('Recorrência')
  })

  it('`validValues` sai como CONTAGEM, com a lista quando são poucas', () => {
    const [, prioridade] = normalizarSchema(BRUTO_COM_PRIORIDADE)
    expect(prioridade!.validValues.total).toBe(2)
    expect(prioridade!.validValues.omitidas).toBe(0)
    expect(prioridade!.validValues.opcoes).toEqual([
      { id: '1', rotulo: 'Highest' },
      { id: '3', rotulo: 'Medium' },
    ])
  })

  it('lista longa vira contagem + omitidas — total NUNCA é o tamanho da amostra', () => {
    const muitas = Array.from({ length: MAX_OPCOES_LISTADAS + 7 }, (_, i) => ({
      id: String(i),
      label: `Sistema ${i}`,
    }))
    const [campo] = normalizarSchema([
      { fieldId: 'customfield_9', name: 'Sistema', jiraSchema: { type: 'option' }, validValues: muitas },
    ])
    expect(campo!.validValues.total).toBe(MAX_OPCOES_LISTADAS + 7)
    expect(campo!.validValues.opcoes).toHaveLength(MAX_OPCOES_LISTADAS)
    expect(campo!.validValues.omitidas).toBe(7)
  })

  it('campo sem `fieldId` sai fora; corpo que não é lista devolve lista vazia', () => {
    expect(normalizarSchema([{ name: 'órfão' }])).toEqual([])
    expect(normalizarSchema(null)).toEqual([])
    expect(normalizarSchema({ requestTypeFields: [] })).toEqual([])
  })

  it('campo sem `validValues` tem total 0 — que NÃO é o mesmo que "muitas, não listei"', () => {
    const [campo] = normalizarSchema([{ fieldId: 'customfield_1', name: 'Texto' }])
    expect(campo!.validValues).toEqual({ total: 0, opcoes: [], omitidas: 0 })
  })
})

describe('temCampoDePrioridade — responde `jiraSchema.system`, nunca o `fieldId`', () => {
  it('`fieldId: "priority"` sem `system` NÃO conta', () => {
    const campos = normalizarSchema([
      { fieldId: 'priority', name: 'Qual sua prioridade?', jiraSchema: { type: 'string' } },
    ])
    expect(temCampoDePrioridade(campos)).toBe(false)
  })

  it('`system: "priority"` num `fieldId` qualquer CONTA', () => {
    const campos = normalizarSchema([
      { fieldId: 'customfield_10000', name: 'Prioridade', jiraSchema: { system: 'priority' } },
    ])
    expect(temCampoDePrioridade(campos)).toBe(true)
  })
})

// --- a rota --------------------------------------------------------------

const ROTA = '/api/admin/tipos-chamado/schema'

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
  await config.definir('tipos_chamado_permitidos', ['rt-com', 'rt-sem', 'rt-quebrado'], CHEFE, AGORA)
  await config.definir('service_desk_id', 'sd-1', CHEFE, AGORA)
  ctx = await montarContexto(
    { DB: db, ATLAS_USAR_FAKES: '1' },
    () => AGORA,
    () => `id-${++n}`,
  )
  fake = ctx.atlassian as ClienteAtlassianFake
  fake.estado.schemaPorTipo.set('rt-com', [...normalizarSchema(BRUTO_COM_PRIORIDADE)])
  fake.estado.schemaPorTipo.set('rt-sem', [
    ...normalizarSchema([
      { fieldId: 'summary', name: 'Resumo', required: true, jiraSchema: { system: 'summary' } },
    ]),
  ])
})

function req(caminho: string, email: string | null): Request {
  const headers: Record<string, string> = {}
  if (email) headers[HEADER_EMAIL] = email
  return new Request(`https://atlas.devgogroup.com${caminho}`, { headers })
}

const chamar = (caminho: string, email: string | null) =>
  tratarRequisicao(req(caminho, email), ctx, {})

describe('BURLA — a rota é de admin e só olha o que a allowlist permite', () => {
  it('sem identidade: 403', async () => {
    expect((await chamar(ROTA, null)).status).toBe(403)
  })

  it('colaborador fora da lista de admins: 403, e a Atlassian nem é consultada', async () => {
    const r = await chamar(ROTA, ANA)
    expect(r.status).toBe(403)
    expect(fake.chamadas.filter((c) => c.operacao === 'obterSchemaDoTipo')).toHaveLength(0)
  })

  it('`?tipo=` fora da allowlist: 404, sem consultar a Atlassian', async () => {
    const r = await chamar(`${ROTA}?tipo=rt-de-outro-desk`, CHEFE)
    expect(r.status).toBe(404)
    expect(fake.chamadas.filter((c) => c.operacao === 'obterSchemaDoTipo')).toHaveLength(0)
  })

  it('`?tipo=` só sabe ESTREITAR: com ele, um tipo; sem ele, a allowlist inteira', async () => {
    const um = await (await chamar(`${ROTA}?tipo=rt-com`, CHEFE)).json()
    expect(um.itens.map((i: { requestTypeId: string }) => i.requestTypeId)).toEqual(['rt-com'])

    const todos = await (await chamar(ROTA, CHEFE)).json()
    expect(todos.itens.map((i: { requestTypeId: string }) => i.requestTypeId)).toEqual([
      'rt-com',
      'rt-sem',
      'rt-quebrado',
    ])
  })

  it('o `serviceDeskId` vem da config, nunca da query', async () => {
    await chamar(`${ROTA}?tipo=rt-com&serviceDeskId=sd-999`, CHEFE)
    const chamadas = fake.chamadas.filter((c) => c.operacao === 'obterSchemaDoTipo')
    expect(chamadas).toHaveLength(1)
    expect((chamadas[0]!.params as { serviceDeskId: string }).serviceDeskId).toBe('sd-1')
  })
})

describe('a resposta — a pergunta destilada, sem afirmar sobre o que não foi lido', () => {
  it('separa os tipos em COM, SEM e NÃO LIDO', async () => {
    fake.estado.falhas.obterSchemaDoTipo = 'nenhum'
    const corpo = await (await chamar(ROTA, CHEFE)).json()

    expect(corpo.serviceDeskId).toBe('sd-1')
    expect(corpo.tiposComPrioridade).toEqual(['rt-com'])
    // `rt-quebrado` não tem schema no fake, mas responde — schema vazio é "sem", não
    // "não deu para saber".
    expect(corpo.tiposSemPrioridade).toEqual(['rt-sem', 'rt-quebrado'])
    expect(corpo.tiposNaoLidos).toEqual([])
  })

  it('o campo de prioridade aparece INTEIRO no item, com opções e contagem', async () => {
    const corpo = await (await chamar(`${ROTA}?tipo=rt-com`, CHEFE)).json()
    const item = corpo.itens[0]
    expect(item.estado).toBe('lido')
    expect(item.temCampoDePrioridade).toBe(true)
    expect(item.totalCampos).toBe(3)

    const prioridade = item.campos.find(
      (c: { jiraSchema: { system: string | null } }) => c.jiraSchema.system === 'priority',
    )
    expect(prioridade.fieldId).toBe('priority')
    expect(prioridade.name).toBe('Prioridade')
    expect(prioridade.validValues.total).toBe(2)
    expect(prioridade.validValues.opcoes[0].rotulo).toBe('Highest')
  })

  it('falha de leitura NÃO derruba a resposta, e o tipo fica fora das duas conclusões', async () => {
    fake.estado.falhas.obterSchemaDoTipo = 'indisponivel'
    const r = await chamar(ROTA, CHEFE)
    const corpo = await r.json()

    expect(r.status).toBe(200)
    expect(corpo.tiposNaoLidos).toEqual(['rt-com', 'rt-sem', 'rt-quebrado'])
    // 🚨 A asserção que importa: "não deu para saber" nunca vira "não tem".
    expect(corpo.tiposSemPrioridade).toEqual([])
    expect(corpo.tiposComPrioridade).toEqual([])
    expect(corpo.itens.every((i: { estado: string }) => i.estado === 'nao_lido')).toBe(true)
  })

  it('RNF-01/RNF-30 — nem credencial nem corpo de erro da Atlassian na resposta', async () => {
    fake.estado.falhas.obterSchemaDoTipo = 'rejeitado'
    const texto = await (await chamar(ROTA, CHEFE)).text()
    expect(texto).not.toMatch(/ATATT|ATCTT|Basic |Bearer |atlassian\.net/i)
    expect(texto).not.toMatch(/\bfake: rejeitado\b|\bstack\b|Error:/)
  })

  it('sem service desk configurado, recusa em linguagem de negócio (não 500)', async () => {
    await new Config(db).definir('service_desk_id', null, CHEFE, AGORA)
    const ctx2 = await montarContexto(
      { DB: db, ATLAS_USAR_FAKES: '1' },
      () => AGORA,
      () => `id-${++n}`,
    )
    const r = await tratarRequisicao(req(ROTA, CHEFE), ctx2, {})
    expect(r.status).toBe(400)
    expect((await r.json()).erro).toMatch(/configurad/i)
  })
})

describe('somente leitura — o diagnóstico PASSA', () => {
  it('a trava de escrita não recusa `obterSchemaDoTipo`', async () => {
    const travado = new ClienteAtlassianSomenteLeitura(fake)
    // Se ele recusasse, a única pergunta que só a Atlassian real responde seria
    // impossível de fazer no único app que tem credencial (`D-24`).
    await expect(travado.obterSchemaDoTipo('sd-1', 'rt-com')).resolves.toHaveLength(3)
  })
})
