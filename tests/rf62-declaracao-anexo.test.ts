/**
 * **T-402 a T-405** — a declaração de anexo é pré-condição da criação, no SERVIDOR.
 *
 * ## O que esta trava é, e o que ela não é
 *
 * `RF-62` pede que a pessoa **responda** se tem material para anexar antes de o
 * chamado nascer. Duas coisas que parecem a mesma e não são:
 *
 * - **responder** é obrigatório — é o que `RN-11` trava;
 * - **anexar** nunca é. Quem declara "tenho" e desiste abre o chamado igual
 *   (`SC-03`), e é o que o último teste daqui prova.
 *
 * ## A pré-condição faz parte do teste, não é cenário de apoio
 *
 * A regra exata (`plan.md` §6) exige declaração **só** quando o schema do request
 * type é conhecido **e** expõe campo de anexo. Um teste de burla que não montasse
 * esse schema estaria afirmando o contrário de `SC-05` — e passaria pelo motivo
 * errado, porque o gate simplesmente não se aplicaria. Daí `rt-1` (com anexo) e
 * `rt-2` (sem) existirem lado a lado aqui.
 *
 * ## Por que é fail-OPEN quando o schema não pôde ser lido
 *
 * Desvio consciente do padrão do projeto, declarado em `plan.md` §9. `RF-62` é
 * qualidade de produto, não trava de segurança: quem "burla" só consegue abrir o
 * **próprio** chamado sem responder uma pergunta — não há dado de terceiro, não há
 * exposição, o que se perde é a evidência dele mesmo. Fail-closed aqui significaria
 * não abrir chamado durante uma indisponibilidade de leitura de schema, que é
 * exatamente a parede que `RNF-18` proíbe. O evento vai para a auditoria para que
 * ninguém confunda "o tipo não aceita anexo" com "não deu para saber".
 *
 * _Requirements: RF-62, RN-11, RF-27, RNF-18, RN-10_
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { SqliteLocal } from '@/lib/db/sqlite-local'
import { migrar } from '@/lib/db/schema'
import { Config } from '@/lib/config'
import { montarContexto, type Contexto } from '@/lib/contexto'
import { tratarRequisicao } from '@/lib/http/rotas'
import { HEADER_EMAIL } from '@/lib/auth'
import { ClienteAtlassianFake } from '@/lib/atlassian/fake'
import { linhasComoObjetos, primeiraLinha } from '@/lib/db/tipos'
import {
  exigeDeclaracaoDeAnexo,
  tipoAceitaAnexo,
  validarDeclaracao,
} from '@/lib/tickets/declaracao-anexo'

const ANA = 'ana@gocase.com'
const CHEFE = 'chefe@gocase.com'
const AGORA = '2026-08-07T12:00:00.000Z'

let db: SqliteLocal
let ctx: Contexto
let fake: ClienteAtlassianFake
let n = 0

const CAMPO_ANEXO = {
  fieldId: 'attachment',
  rotulo: 'Anexo',
  obrigatorio: false,
  tipo: 'anexo' as const,
  opcoes: [],
}

const CAMPO_TEXTO = {
  fieldId: 'customfield_sistema',
  rotulo: 'Sistema afetado',
  obrigatorio: false,
  tipo: 'texto' as const,
  opcoes: [],
}

beforeEach(async () => {
  db = new SqliteLocal()
  await migrar(db)
  n = 0
  const config = new Config(db)
  await config.definir('dominios_permitidos', ['gocase.com'], CHEFE, AGORA)
  await config.definir('admins', [CHEFE], CHEFE, AGORA)
  await config.definir('tipos_chamado_permitidos', ['rt-1', 'rt-2'], CHEFE, AGORA)
  await config.definir('service_desk_id', 'sd-1', CHEFE, AGORA)
  ctx = await montarContexto(
    { DB: db, GOATLAS_USAR_FAKES: '1' },
    () => AGORA,
    () => `id-${++n}`,
  )
  fake = ctx.atlassian as ClienteAtlassianFake
  fake.estado.tiposChamado = [
    { id: 'rt-1', serviceDeskId: 'sd-1', nome: 'Com anexo', descricao: null },
    { id: 'rt-2', serviceDeskId: 'sd-1', nome: 'Sem anexo', descricao: null },
  ]
  // `rt-1` expõe anexo — é nele que a pergunta é obrigatória.
  fake.estado.camposPorTipo.set('rt-1', [CAMPO_TEXTO, CAMPO_ANEXO])
  // `rt-2` não expõe — nele a pergunta não existe (`SC-05`).
  fake.estado.camposPorTipo.set('rt-2', [CAMPO_TEXTO])
})

function req(caminho: string, corpo: unknown, metodo = 'POST'): Request {
  return new Request(`https://goatlas.devgogroup.com${caminho}`, {
    method: metodo,
    headers: { [HEADER_EMAIL]: ANA },
    ...(corpo === undefined ? {} : { body: JSON.stringify(corpo) }),
  })
}

const chamar = (r: Request) => tratarRequisicao(r, ctx, {})

const BASE = {
  titulo: 'O relatório de vendas veio errado',
  descricao: 'Os totais de ontem não fecham com o painel.',
  prioridade: 'alta',
}

/** Conversa no ponto exato em que `RF-17` permite confirmar. */
async function conversaPronta(tipoChamadoId: string): Promise<string> {
  const c = await ctx.conversas.criar(ctx.novoId(), ANA)
  await ctx.conversas.marcarConfluenceVerificado(c.id, false)
  await ctx.conversas.marcarHistoricoVerificado(c.id, false)
  await ctx.conversas.definirProposta(c.id, {
    titulo: BASE.titulo,
    descricao: BASE.descricao,
    tipoChamadoId,
    prioridade: 'alta',
    area: null,
    componente: null,
  })
  await ctx.conversas.definirEstado(c.id, 'aguardando_confirmacao')
  return c.id
}

async function declaracaoPersistida(chave: string): Promise<number | null> {
  const r = await db.query(`SELECT declarou_anexo FROM submissoes WHERE chave_idempotencia = ?`, [
    chave,
  ])
  const linha = primeiraLinha<{ declarou_anexo: number | null }>(r)
  return linha ? linha.declarou_anexo : null
}

async function auditoria(acao: string) {
  const r = await db.query(
    `SELECT resultado, detalhe_json FROM auditoria WHERE acao = ? ORDER BY criado_em`,
    [acao],
  )
  return linhasComoObjetos<{ resultado: string; detalhe_json: string | null }>(r)
}

describe('T-404 — a regra: exige declaração SÓ quando o schema é conhecido e expõe anexo', () => {
  it('tipo com campo de anexo exige; tipo sem campo não', () => {
    expect(tipoAceitaAnexo([CAMPO_TEXTO, CAMPO_ANEXO])).toBe(true)
    expect(tipoAceitaAnexo([CAMPO_TEXTO])).toBe(false)
    expect(exigeDeclaracaoDeAnexo({ conhecido: true, campos: [CAMPO_ANEXO] })).toBe(true)
    expect(exigeDeclaracaoDeAnexo({ conhecido: true, campos: [CAMPO_TEXTO] })).toBe(false)
  })

  it('schema NÃO conhecido não exige — é o fail-open declarado no plano', () => {
    expect(exigeDeclaracaoDeAnexo({ conhecido: false })).toBe(false)
  })

  it('resposta ausente é `null`, nunca um default silencioso', () => {
    expect(validarDeclaracao(undefined, false)).toEqual({ ok: true, declarouAnexo: null })
    // Valor que não é booleano é "não respondeu" — não "respondeu que não".
    expect(validarDeclaracao('sim', false)).toEqual({ ok: true, declarouAnexo: null })
    expect(validarDeclaracao(false, true)).toEqual({ ok: true, declarouAnexo: false })
    expect(validarDeclaracao(true, true)).toEqual({ ok: true, declarouAnexo: true })
  })

  it('a mensagem de recusa oferece a saída, e não diz "pular"', () => {
    const r = validarDeclaracao(undefined, true)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.mensagem).toMatch(/anexar/i)
    expect(r.mensagem).not.toMatch(/pular/i)
  })
})

describe('T-402 — BURLA: criação sem declaração é recusada pelo servidor, nos DOIS caminhos', () => {
  it('formulário direto (D-04): sem declaração, 400 e nenhum chamado', async () => {
    const r = await chamar(
      req('/api/chamados', { ...BASE, tipoChamadoId: 'rt-1', chaveIdempotencia: 'k1' }),
    )
    expect(r.status).toBe(400)
    // Nada criado: nem submissão, nem chamado no JSM.
    expect(await declaracaoPersistida('form:' + ANA + ':k1')).toBeNull()
    expect(fake.chamadas.filter((c) => c.operacao === 'criarChamado')).toHaveLength(0)
  })

  it('conversa: sem declaração, 400 — e a confirmação de RF-17 NÃO é registrada', async () => {
    const id = await conversaPronta('rt-1')
    const r = await chamar(req(`/api/conversas/${id}/confirmar`, undefined))
    expect(r.status).toBe(400)
    expect(fake.chamadas.filter((c) => c.operacao === 'criarChamado')).toHaveLength(0)
    // Registrar a confirmação e depois recusar deixaria a conversa marcada como
    // confirmada sem chamado, e `confirmacao_registrada` apareceria duas vezes na
    // auditoria de RF-17 para uma única abertura.
    const conversa = await ctx.conversas.obter(id)
    expect(conversa?.confirmadoEm).toBeNull()
    expect(await auditoria('confirmacao_registrada')).toHaveLength(0)
  })

  it('BURLA — mandar declaração inválida no lugar do booleano não conta como resposta', async () => {
    const r = await chamar(
      req('/api/chamados', {
        ...BASE,
        tipoChamadoId: 'rt-1',
        chaveIdempotencia: 'k2',
        declarouAnexo: 'claro que tenho',
      }),
    )
    expect(r.status).toBe(400)
    expect(fake.chamadas.filter((c) => c.operacao === 'criarChamado')).toHaveLength(0)
  })

  it('a recusa é AUDITADA — o volume dela é sinal de tela confusa, não de gente teimosa', async () => {
    await chamar(req('/api/chamados', { ...BASE, tipoChamadoId: 'rt-1', chaveIdempotencia: 'k3' }))
    const linhas = await auditoria('declaracao_anexo_ausente')
    expect(linhas).toHaveLength(1)
    expect(linhas[0]?.resultado).toBe('negado')
  })
})

describe('T-403 — a declaração fica no banco, com `null` significando "não respondeu"', () => {
  it('"não tenho" é registrado como resposta, não como ausência (SC-02)', async () => {
    const r = await chamar(
      req('/api/chamados', {
        ...BASE,
        tipoChamadoId: 'rt-1',
        chaveIdempotencia: 'k4',
        declarouAnexo: false,
      }),
    )
    expect(r.status).toBe(201)
    expect(await declaracaoPersistida(`form:${ANA}:k4`)).toBe(0)
  })

  it('"tenho" é registrado', async () => {
    await chamar(
      req('/api/chamados', {
        ...BASE,
        tipoChamadoId: 'rt-1',
        chaveIdempotencia: 'k5',
        declarouAnexo: true,
      }),
    )
    expect(await declaracaoPersistida(`form:${ANA}:k5`)).toBe(1)
  })

  it('tipo que não pede anexo grava `null` — ninguém respondeu, e ninguém devia', async () => {
    const r = await chamar(
      req('/api/chamados', { ...BASE, tipoChamadoId: 'rt-2', chaveIdempotencia: 'k6' }),
    )
    expect(r.status).toBe(201)
    expect(await declaracaoPersistida(`form:${ANA}:k6`)).toBeNull()
  })

  it('a declaração vai para a auditoria junto com o chamado (SC-12)', async () => {
    await chamar(
      req('/api/chamados', {
        ...BASE,
        tipoChamadoId: 'rt-1',
        chaveIdempotencia: 'k7',
        declarouAnexo: true,
      }),
    )
    const linhas = await auditoria('chamado_criado')
    const sucesso = linhas.filter((l) => l.resultado === 'sucesso')
    expect(sucesso).toHaveLength(1)
    expect(JSON.parse(sucesso[0]!.detalhe_json ?? '{}').declarouAnexo).toBe(true)
  })
})

describe('SC-05 / SC-05b — o tipo sem anexo abre sem perguntar, e o schema ilegível também', () => {
  it('SC-05 — schema sem campo de anexo: abre sem declaração nenhuma', async () => {
    const r = await chamar(
      req('/api/chamados', { ...BASE, tipoChamadoId: 'rt-2', chaveIdempotencia: 'k8' }),
    )
    expect(r.status).toBe(201)
  })

  it('SC-05 — pela conversa também', async () => {
    const id = await conversaPronta('rt-2')
    const r = await chamar(req(`/api/conversas/${id}/confirmar`, undefined))
    expect(r.status).toBe(201)
  })

  it('SC-05b — schema INDISPONÍVEL abre o chamado sem perguntar, e AUDITA', async () => {
    fake.estado.falhas.obterCamposDoTipo = 'indisponivel'
    const r = await chamar(
      req('/api/chamados', { ...BASE, tipoChamadoId: 'rt-1', chaveIdempotencia: 'k9' }),
    )
    // Indisponibilidade de leitura de schema não vira "não consigo abrir seu chamado".
    expect(r.status).toBe(201)
    const linhas = await auditoria('schema_tipo_indisponivel')
    expect(linhas).toHaveLength(1)
    // "O tipo não aceita anexo" e "não deu para saber" têm a mesma cara na tela; na
    // auditoria não podem ter.
    expect(JSON.parse(linhas[0]?.detalhe_json ?? '{}').tipoChamadoId).toBe('rt-1')
  })

  it('SC-05b — e a declaração fica `null`, não `false`: ninguém disse que não tinha', async () => {
    fake.estado.falhas.obterCamposDoTipo = 'indisponivel'
    await chamar(req('/api/chamados', { ...BASE, tipoChamadoId: 'rt-1', chaveIdempotencia: 'k10' }))
    expect(await declaracaoPersistida(`form:${ANA}:k10`)).toBeNull()
  })
})

describe('T-405 / SC-03 — a trava é RESPONDER, nunca anexar', () => {
  it('declarar "tenho" e não anexar arquivo nenhum continua abrindo o chamado', async () => {
    const r = await chamar(
      req('/api/chamados', {
        ...BASE,
        tipoChamadoId: 'rt-1',
        chaveIdempotencia: 'k11',
        declarouAnexo: true,
      }),
    )
    expect(r.status).toBe(201)
    const corpo = (await r.json()) as { issueKey: string | null }
    expect(corpo.issueKey).toBeTruthy()
  })

  it('pela conversa: "tenho" sem arquivo abre igual', async () => {
    const id = await conversaPronta('rt-1')
    const r = await chamar(req(`/api/conversas/${id}/confirmar`, { declarouAnexo: true }))
    expect(r.status).toBe(201)
  })

  it('voltar para "não tenho" depois de dizer "tenho" abre o chamado (SC-03)', async () => {
    const id = await conversaPronta('rt-1')
    // A primeira tentativa foi sem responder — recusada, e a conversa segue viva.
    expect((await chamar(req(`/api/conversas/${id}/confirmar`, undefined))).status).toBe(400)
    const r = await chamar(req(`/api/conversas/${id}/confirmar`, { declarouAnexo: false }))
    expect(r.status).toBe(201)
  })
})

describe('a pergunta não custa uma consulta a mais de schema (R-02)', () => {
  it('o schema do tipo é lido UMA vez por criação, e serve às duas decisões', async () => {
    await chamar(
      req('/api/chamados', {
        ...BASE,
        tipoChamadoId: 'rt-1',
        chaveIdempotencia: 'k12',
        declarouAnexo: false,
        camposDinamicos: { customfield_sistema: 'Painel de vendas' },
      }),
    )
    // Uma leitura serve ao gate de RF-62 e ao filtro de T-401. Duas seriam duas
    // chamadas com a credencial única para responder à mesma pergunta.
    expect(fake.chamadas.filter((c) => c.operacao === 'obterCamposDoTipo')).toHaveLength(1)
  })
})
