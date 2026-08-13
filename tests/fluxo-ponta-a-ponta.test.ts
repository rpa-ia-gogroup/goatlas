/**
 * O fluxo da Definição de Pronto da Fase 1, ponta a ponta, pelas ROTAS.
 *
 * *"Um colaborador sem nenhum assento Atlassian conversa com o agente e abre um
 * chamado ponta a ponta; o chamado chega ao time de tech com o solicitante correto
 * identificado."*
 *
 * _Requirements: RF-06, RF-07, RF-08, RF-09, RF-13, RF-15, RF-16, RF-17, RF-18,
 * RF-21, RF-22, RF-26, RF-28, RF-29, RN-01, RN-02, RN-07, RN-08_
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { linhasComoObjetos } from '@/lib/db/tipos'
import { SqliteLocal } from '@/lib/db/sqlite-local'
import { migrar } from '@/lib/db/schema'
import { Config } from '@/lib/config'
import { montarContexto, type Contexto } from '@/lib/contexto'
import { tratarRequisicao } from '@/lib/http/rotas'
import { HEADER_EMAIL } from '@/lib/auth'
import { ClienteAtlassianFake } from '@/lib/atlassian/fake'
import { ClienteIAFake } from '@/lib/ia/fake'
import { interpretarProposta } from '@/lib/ia/cliente'

const ANA = 'ana@gocase.com'
const AGORA = '2026-08-03T12:00:00.000Z'

let db: SqliteLocal
let ctx: Contexto
let atlassian: ClienteAtlassianFake
let ia: ClienteIAFake

/** Roteiro do "modelo": pede as duas verificações, uma por turno, e conclui. */
const ROTEIRO = [
  {
    texto: 'Deixa eu verificar se isso já está documentado.',
    toolsPropostas: [{ nome: 'search_confluence', argumentos: { topico: 'relatório de vendas' } }],
  },
  {
    texto: 'Agora vou ver se já aconteceu antes.',
    toolsPropostas: [{ nome: 'check_jira_history', argumentos: { tipoProblema: 'relatorio' } }],
  },
  { texto: 'Montei o chamado. Confira e confirme.' },
]

beforeEach(async () => {
  db = new SqliteLocal()
  await migrar(db)
  const config = new Config(db)
  await config.definir('dominios_permitidos', ['gocase.com'], ANA, AGORA)
  await config.definir('tipos_chamado_permitidos', ['rt-1'], ANA, AGORA)
  await config.definir('service_desk_id', 'sd-1', ANA, AGORA)
  await config.definir('espacos_confluence', ['TECH'], ANA, AGORA)
  await config.definir('regra2_exemplos_ajuste_operacional', ['Rodei manualmente'], ANA, AGORA)

  // ⚠️ O tipo tem de EXISTIR na Atlassian, não só na allowlist (`D-68`). A extração da
  // proposta escolhe pelo **nome**, e nome vem de `listarTiposChamado` — um `rt-1`
  // configurado que o site não conhece é um assunto que não dá para abrir.
  atlassian = new ClienteAtlassianFake({
    tiposChamado: [
      { id: 'rt-1', serviceDeskId: 'sd-1', nome: 'Suporte de tecnologia', descricao: null },
    ],
  })
  ia = new ClienteIAFake(ROTEIRO)

  let n = 0
  ctx = await montarContexto({ DB: db, GOATLAS_USAR_FAKES: '1' }, () => AGORA, () => `id-${++n}`, {
    atlassian,
    ia,
  })
})

function req(caminho: string, opcoes: { metodo?: string; corpo?: unknown } = {}): Request {
  return new Request(`https://goatlas.devgogroup.com${caminho}`, {
    method: opcoes.metodo ?? 'GET',
    headers: { [HEADER_EMAIL]: ANA },
    ...(opcoes.corpo === undefined ? {} : { body: JSON.stringify(opcoes.corpo) }),
  })
}
const chamar = (r: Request) => tratarRequisicao(r, ctx, { GODEPLOY_CRON_KEY: 'k' })

describe('Definição de Pronto — o fluxo completo pela conversa', () => {
  it('do primeiro acesso ao chamado aberto, sem assento Atlassian', async () => {
    // RF-06: primeiro acesso sem cadastro. A identidade já vem do edge.
    const eu = await (await chamar(req('/api/auth/me'))).json()
    expect(eu.email).toBe(ANA)

    const { id } = await (await chamar(req('/api/conversas', { metodo: 'POST' }))).json()

    // UMA mensagem da pessoa, e o agente roda AS DUAS verificações no mesmo turno
    // — é o que RNF-12 pede (as duas antes de ele poder concluir), e é melhor UX
    // que obrigar a pessoa a mandar duas mensagens para o processo andar.
    const t2 = await (
      await chamar(
        req(`/api/conversas/${id}/mensagens`, {
          metodo: 'POST',
          corpo: { texto: 'o relatório de vendas de ontem não atualizou, desde as 8h' },
        }),
      )
    ).json()
    expect(t2.verificacoes.confluence).toBe('ok')
    expect(t2.verificacoes.historico).toBe('ok')
    expect(t2.bloqueado).toBe(false)
    expect(t2.podeConfirmar).toBe(true)
    expect(t2.proposta.titulo).toBeTruthy()
    // RF-15/RF-16: prioridade SUGERIDA, para ser exibida e editada.
    expect(t2.proposta.prioridade).toBe('alta')

    // RF-16 — a pessoa muda a prioridade antes de confirmar.
    const salva = await (
      await chamar(
        req(`/api/conversas/${id}/proposta`, {
          metodo: 'PUT',
          corpo: { ...t2.proposta, prioridade: 'normal' },
        }),
      )
    ).json()
    // RN-08 — o prazo acompanha, e é de PRIMEIRA RESPOSTA.
    expect(salva.slaPrimeiraRespostaHoras).toBe(24)

    // RF-17 — confirmação explícita cria o chamado.
    const criado = await (await chamar(req(`/api/conversas/${id}/confirmar`, { metodo: 'POST' }))).json()
    expect(criado.issueKey).toMatch(/^GOATLAS-/)
    expect(criado.estado).toBe('criado')
    expect(criado.verificadoRegras).toBe(true)
    expect(criado.slaPrimeiraRespostaHoras).toBe(24)

    // RF-21 — o time de tech precisa saber QUEM pediu.
    const criacao = atlassian.chamadas.find((c) => c.operacao === 'criarChamado')
    expect((criacao?.params as { solicitanteEmail: string }).solicitanteEmail).toBe(ANA)

    // RF-22 / RF-29 — o vínculo existe e o chamado aparece em "Meus chamados".
    const meus = await (await chamar(req('/api/chamados'))).json()
    expect(meus.itens).toHaveLength(1)
    expect(meus.itens[0].issueKey).toBe(criado.issueKey)
    expect(meus.itens[0].verificadoRegras).toBe(true)

    // RF-58 — a auditoria conta a história inteira.
    const auditoria = await db.query(`SELECT DISTINCT acao FROM auditoria ORDER BY acao`, [])
    // ⚠️ Nunca indexar `rows` direto: a forma varia entre o shim de teste e o
    // `env.DB` da plataforma — foi assim que toda leitura virou `{}` em produção.
    const acoes = linhasComoObjetos<{ acao: string }>(auditoria).map((l) => l.acao)
    for (const esperada of [
      'conversa_iniciada',
      'mensagem_enviada',
      'busca_confluence',
      'consulta_historico',
      'confirmacao_registrada',
      'chamado_criado',
      'chamado_lido',
    ]) {
      expect(acoes, `auditoria sem ${esperada}`).toContain(esperada)
    }
  })

  it('caminho da deflexão: bloqueia, e o override deixa seguir', async () => {
    atlassian.estado.paginas = [
      {
        id: 'p1',
        titulo: 'Como reprocessar o relatório de vendas',
        espaco: 'TECH',
        url: 'https://goengenharia.atlassian.net/wiki/spaces/TECH/pages/1',
        score: 0.95,
        trecho: 'Rode a tarefa manual no painel.',
        labels: [],
      },
    ]

    const { id } = await (await chamar(req('/api/conversas', { metodo: 'POST' }))).json()
    const t1 = await (
      await chamar(
        req(`/api/conversas/${id}/mensagens`, {
          metodo: 'POST',
          corpo: { texto: 'como reprocesso o relatório de vendas?' },
        }),
      )
    ).json()

    // RF-12 — os três elementos: regra, motivo legível, link.
    expect(t1.bloqueado).toBe(true)
    expect(t1.regraBloqueio).toBe('regra1_confluence')
    // T-118 — e o link leva à leitura DENTRO do app, que é o que quem não tem assento
    // consegue abrir. Ponta a ponta: o id sai do cliente e chega na mensagem.
    expect(t1.texto).toContain('/documentacao?pagina=p1')
    expect(t1.texto).not.toContain('atlassian.net')
    expect(t1.texto).toContain('Como reprocessar')
    // RNF-31 — soa como ajuda, não recusa.
    expect(t1.texto).not.toMatch(/negad|recus|proibid/i)
    // Bloqueado, não há proposta a confirmar.
    expect(t1.podeConfirmar).toBe(false)

    // RF-13 / RN-07 — o override deixa seguir, e fica registrado.
    const r = await chamar(
      req(`/api/conversas/${id}/override`, {
        metodo: 'POST',
        corpo: { motivo: 'a página é da loja física, meu caso é o e-commerce' },
      }),
    )
    expect(r.status).toBe(200)
    const bloqueios = await ctx.conversas.listarBloqueios(id)
    expect(bloqueios[0]?.houveOverride).toBe(true)
  })

  it('sem contexto suficiente, o agente NÃO propõe — e não inventa campos', async () => {
    ia.propostaSugerida = null
    const { id } = await (await chamar(req('/api/conversas', { metodo: 'POST' }))).json()
    const t2 = await (
      await chamar(req(`/api/conversas/${id}/mensagens`, { metodo: 'POST', corpo: { texto: 'ajuda' } }))
    ).json()

    expect(t2.podeConfirmar).toBe(false)
    expect(t2.proposta).toBeNull()
    // E confirmar continua recusando: sem proposta, não há o que criar.
    expect((await chamar(req(`/api/conversas/${id}/confirmar`, { metodo: 'POST' }))).status).toBe(400)
  })
})

describe('RF-28 — a extração não amplia a allowlist', () => {
  it('BURLA — o modelo devolve tipoChamadoId inventado: proposta descartada', async () => {
    // Aceitar id inventado colocaria o chamado numa fila que o admin não liberou.
    expect(
      interpretarProposta(
        JSON.stringify({
          pronto: true,
          titulo: 'Preciso de acesso ao financeiro',
          descricao: 'Quero entrar na fila do time financeiro.',
          prioridade: 'alta',
          tipoChamadoId: 'rt-financeiro-secreto',
        }),
        ['rt-1'],
      ),
    ).toBeNull()
  })

  it('`pronto: false` nunca vira proposta, mesmo com campos preenchidos', async () => {
    expect(
      interpretarProposta(
        JSON.stringify({
          pronto: false,
          titulo: 'Título completo',
          descricao: 'Descrição completa e longa.',
          prioridade: 'alta',
          tipoChamadoId: 'rt-1',
        }),
        ['rt-1'],
      ),
    ).toBeNull()
  })

  it('prioridade inválida ou campos curtos descartam a proposta', async () => {
    const base = {
      pronto: true,
      titulo: 'Título ok',
      descricao: 'Descrição suficientemente longa.',
      prioridade: 'alta',
      tipoChamadoId: 'rt-1',
    }
    expect(interpretarProposta(JSON.stringify({ ...base, prioridade: 'urgentissima' }), ['rt-1'])).toBeNull()
    expect(interpretarProposta(JSON.stringify({ ...base, titulo: 'oi' }), ['rt-1'])).toBeNull()
    expect(interpretarProposta(JSON.stringify({ ...base, descricao: 'curta' }), ['rt-1'])).toBeNull()
    expect(interpretarProposta(JSON.stringify(base), ['rt-1'])).not.toBeNull()
  })

  it('JSON inválido não derruba nada — só não propõe', async () => {
    for (const bruto of ['', 'não é json', '[]', 'null', undefined, 42]) {
      expect(interpretarProposta(bruto, ['rt-1']), String(bruto)).toBeNull()
    }
  })
})
