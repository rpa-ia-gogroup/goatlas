/**
 * T-135 — o `PUT` de configuração recusa valor de tipo errado. Teste de burla:
 * escrito antes de `config/validar.ts` existir.
 *
 * Por que isto não é preciosismo. A rota checava só se a **chave** existe e gravava
 * `valor as never`. O `JSON.parse` de `Config.carregar` aceita de volta qualquer
 * JSON válido, então `regra1_threshold_score = "alto"` entra no banco, sai do banco
 * e chega às regras como string — e o default fail-closed **não** protege disso: o
 * valor corrompido não é ausência de valor, é o valor.
 *
 * O caminho não é hipotético: `/api/admin/config` é uma rota HTTP comum. Quem tem
 * sessão de admin pode chamá-la sem passar pela tela, e a tela é justamente a única
 * coisa que hoje garante o tipo. É o mesmo raciocínio das outras travas do projeto —
 * a camada de UI não oferece o valor errado, a camada do servidor recusa se ele vier.
 *
 * ⚠️ Recusar é diferente de corrigir. Um `PUT` com `"0.9"` **não** vira `0.9`
 * silenciosamente: coerção esconde de quem chamou que ele mandou a coisa errada, e
 * o dia em que `"0.9"` virar `"alto"` a coerção produz `NaN` sem ninguém avisar.
 *
 * _Requirements: RF-49, RF-50, RNF-07_
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { SqliteLocal } from '@/lib/db/sqlite-local'
import { migrar } from '@/lib/db/schema'
import { Config } from '@/lib/config'
import { montarContexto, type Contexto } from '@/lib/contexto'
import { tratarRequisicao } from '@/lib/http/rotas'
import { HEADER_EMAIL } from '@/lib/auth'

const CHEFE = 'chefe@gocase.com'
const AGORA = '2026-08-07T12:00:00.000Z'

let db: SqliteLocal
let ctx: Contexto
let n = 0

beforeEach(async () => {
  db = new SqliteLocal()
  await migrar(db)
  n = 0
  const config = new Config(db)
  await config.definir('dominios_permitidos', ['gocase.com'], CHEFE, AGORA)
  await config.definir('admins', [CHEFE], CHEFE, AGORA)
  ctx = await montarContexto(
    { DB: db, GOATLAS_USAR_FAKES: '1' },
    () => AGORA,
    () => `id-${++n}`,
  )
})

function salvar(chave: string, valor: unknown): Promise<Response> {
  return tratarRequisicao(
    new Request('https://goatlas.devgogroup.com/api/admin/config', {
      method: 'PUT',
      headers: { [HEADER_EMAIL]: CHEFE },
      body: JSON.stringify({ chave, valor }),
    }),
    ctx,
    {},
  )
}

/** O que está no BANCO — não o que a resposta disse. */
async function gravado<K extends Parameters<Config['obter']>[0]>(chave: K) {
  return new Config(db).obter(chave)
}

describe('número não aceita texto, lista nem objeto', () => {
  it.each([
    ['texto', 'alto'],
    ['número em texto', '0.9'],
    ['lista', [0.9]],
    ['objeto', { valor: 0.9 }],
    ['nulo', null],
    ['NaN travestido de número', Number.NaN],
    ['infinito', Number.POSITIVE_INFINITY],
  ])('recusa %s no threshold da Regra 1', async (_nome, valor) => {
    const r = await salvar('regra1_threshold_score', valor)
    expect(r.status).toBe(400)
    expect(await gravado('regra1_threshold_score')).toBe(0.75)
  })

  it('recusa fração fora de 0–1 no threshold, que é uma confiança', async () => {
    expect((await salvar('regra1_threshold_score', 75)).status).toBe(400)
    expect((await salvar('regra1_threshold_score', -0.1)).status).toBe(400)
    expect(await gravado('regra1_threshold_score')).toBe(0.75)
  })

  it('recusa contagem negativa e fracionária onde só cabe inteiro', async () => {
    expect((await salvar('regra2_janela_dias', -30)).status).toBe(400)
    expect((await salvar('regra2_threshold_recorrencia', 2.5)).status).toBe(400)
    expect(await gravado('regra2_janela_dias')).toBe(90)
  })

  it('aceita o valor certo, e ele chega ao banco', async () => {
    expect((await salvar('regra1_threshold_score', 0.9)).status).toBe(200)
    expect(await gravado('regra1_threshold_score')).toBe(0.9)
  })
})

describe('lista não aceita texto nem lista com buraco', () => {
  it('recusa string onde se espera lista — inclusive a separada por vírgula', async () => {
    const r = await salvar('espacos_confluence', 'TECH,RH')
    expect(r.status).toBe(400)
    expect(await gravado('espacos_confluence')).toEqual([])
  })

  it.each([
    ['número dentro', ['TECH', 7]],
    ['nulo dentro', ['TECH', null]],
    ['objeto dentro', [{ chave: 'TECH' }]],
    ['objeto no lugar da lista', { 0: 'TECH' }],
  ])('recusa lista com %s', async (_nome, valor) => {
    expect((await salvar('espacos_confluence', valor)).status).toBe(400)
    expect(await gravado('espacos_confluence')).toEqual([])
  })

  it('aceita lista vazia — vazia é uma decisão válida, e significa negar', async () => {
    expect((await salvar('admins', [])).status).toBe(200)
    expect(await gravado('admins')).toEqual([])
  })
})

describe('texto opcional aceita nulo, mas não qualquer coisa', () => {
  it('aceita nulo em service desk — é "ainda não sabemos" (Q1)', async () => {
    expect((await salvar('service_desk_id', null)).status).toBe(200)
    expect(await gravado('service_desk_id')).toBeNull()
  })

  it('recusa número e lista onde se espera texto', async () => {
    expect((await salvar('service_desk_id', 12)).status).toBe(400)
    expect((await salvar('campo_solicitante_id', ['customfield_1'])).status).toBe(400)
  })
})

describe('o mapa de preço por produto (Q8) é o tipo mais fácil de corromper', () => {
  it('aceita produto com preço', async () => {
    expect((await salvar('custo_mensal_por_produto', { jira: 7.5 })).status).toBe(200)
    expect(await gravado('custo_mensal_por_produto')).toEqual({ jira: 7.5 })
  })

  it.each([
    ['preço em texto', { jira: '7.5' }],
    ['preço negativo', { jira: -7.5 }],
    ['preço nulo', { jira: null }],
    ['lista no lugar do mapa', [['jira', 7.5]]],
    ['mapa aninhado', { jira: { mensal: 7.5 } }],
  ])('recusa %s', async (_nome, valor) => {
    expect((await salvar('custo_mensal_por_produto', valor)).status).toBe(400)
    expect(await gravado('custo_mensal_por_produto')).toEqual({})
  })

  it('aceita zero — produto incluído no plano é diferente de produto sem preço', async () => {
    expect((await salvar('custo_mensal_por_produto', { jira: 0 })).status).toBe(200)
  })
})

describe('a recusa não é silenciosa nem coercitiva', () => {
  it('diz o que era esperado, sem repetir o valor recusado de volta', async () => {
    const r = await salvar('regra1_threshold_score', 'alto')
    const corpo = (await r.json()) as { erro?: string }
    expect(corpo.erro ?? '').toMatch(/n[úu]mero/i)
    expect(corpo.erro ?? '').not.toContain('alto')
  })

  it('valor recusado não entra na auditoria como alteração', async () => {
    await salvar('regra1_threshold_score', 'alto')
    const r = await db.query(`SELECT id FROM auditoria WHERE acao = 'config_alterada'`, [])
    expect(r.rows).toHaveLength(0)
  })

  it('chave desconhecida continua sendo 400 (comportamento antigo, preservado)', async () => {
    expect((await salvar('apagar_tudo', true)).status).toBe(400)
  })
})

/**
 * As cinco famílias que entraram no merge de PR #20 + PR #21.
 *
 * 🚨 **Elas não existiam, e o efeito era concreto:** o `Record<ChaveConfig, Familia>` só
 * cobria as chaves anteriores, então as 13 chaves das Fases 3 e 4 chegavam a
 * `PUT /api/admin/config` **sem validação de tipo**. Foi o próprio mapa que denunciou —
 * não compilou ao juntar as duas branches, que é exactamente o que ele foi desenhado para
 * fazer (`D-25`).
 *
 * _Requirements: RF-49, RNF-25_
 */
describe('RF-49 — as famílias das chaves das Fases 3 e 4', () => {
  it('canal aceita a lista fechada e `null`, e recusa canal inventado', async () => {
    expect((await salvar('canal_notificacao_padrao', 'chat')).status).toBe(200)
    expect((await salvar('canal_notificacao_padrao', null)).status).toBe(200)
    // Canal inventado não vira `CanalIndisponivel` — vira `undefined` no `canalPor` e
    // desaparece sem erro, com o aviso marcado como enviado.
    expect((await salvar('canal_notificacao_padrao', 'telegrama')).status).toBe(400)
  })

  it('retenção aceita `null` (a política do MVP) e recusa zero', async () => {
    expect((await salvar('retencao_conversas_dias', null)).status).toBe(200)
    expect((await salvar('retencao_conversas_dias', 90)).status).toBe(200)
    // ⚠️ `0` significaria "apagar tudo agora", e apagar dado pessoal é irreversível.
    expect((await salvar('retencao_conversas_dias', 0)).status).toBe(400)
  })

  it('`areas_por_email` normaliza o e-mail para minúscula', async () => {
    expect((await salvar('areas_por_email', { 'Ana@Gocase.com': ' CX ' })).status).toBe(200)
    // Duas grafias do mesmo e-mail fariam a área depender de como alguém digitou.
    expect(await gravado('areas_por_email')).toEqual({ 'ana@gocase.com': 'CX' })
  })

  it('a curva de preço exige faixa válida, e `ate: null` é a última', async () => {
    const boa = { 'jira-servicedesk': [{ ate: 10, precoUnitarioUsd: 9.05 }, { ate: null, precoUnitarioUsd: 6.7 }] }
    expect((await salvar('curva_preco_por_produto', boa)).status).toBe(200)
    // Produto sem faixa nenhuma faria `precoNaFaixa` devolver `null` para tudo.
    expect((await salvar('curva_preco_por_produto', { confluence: [] })).status).toBe(400)
    expect(
      (await salvar('curva_preco_por_produto', { confluence: [{ ate: 'muitos', precoUnitarioUsd: 5 }] })).status,
    ).toBe(400)
  })

  it('o baseline exige data E contagem inteira por produto', async () => {
    const bom = { coletadoEm: '2026-08-01T00:00:00.000Z', porProduto: { confluence: 30 } }
    expect((await salvar('baseline_assentos', bom)).status).toBe(200)
    expect((await salvar('baseline_assentos', { porProduto: { confluence: 30 } })).status).toBe(400)
    expect(
      (await salvar('baseline_assentos', { coletadoEm: '2026-08-01', porProduto: { confluence: 1.5 } })).status,
    ).toBe(400)
  })
})
