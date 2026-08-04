/**
 * RF-24 (idempotência), RNF-17 (nunca perder chamado), RNF-18 (degradação) e
 * RNF-21 (reconciliação do pior caso).
 *
 * A Definição de Pronto exige: *"falha da API de IA não impede abrir chamado;
 * falha de uma tool não vira bypass silencioso da regra"*.
 *
 * _Requirements: RF-24, RNF-17, RNF-18, RNF-21, D-04_
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { SqliteLocal } from '@/lib/db/sqlite-local'
import { migrar } from '@/lib/db/schema'
import { Outbox } from '@/lib/tickets/outbox'
import { RepositorioVinculos } from '@/lib/tickets/vinculos'
import { ServicoChamados } from '@/lib/tickets/servico'
import { AuditoriaBanco } from '@/lib/audit'
import { ClienteAtlassianFake } from '@/lib/atlassian/fake'
import { RepositorioConversas } from '@/lib/agent/estado'
import { CriacaoRecusada } from '@/lib/agent/gate'

const ANA = 'ana@gocase.com'
const AGORA = '2026-08-03T12:00:00.000Z'
const PAYLOAD = {
  titulo: 'Pipeline falhou',
  descricao: 'detalhe',
  tipoChamadoId: 'rt-1',
  serviceDeskId: 'sd-1',
  prioridade: 'alta' as const,
}

let db: SqliteLocal
let outbox: Outbox
let vinculos: RepositorioVinculos
let servico: ServicoChamados
let atlassian: ClienteAtlassianFake

beforeEach(async () => {
  db = new SqliteLocal()
  await migrar(db)
  let n = 0
  const novoId = () => `id-${++n}`
  outbox = new Outbox(db, () => AGORA)
  vinculos = new RepositorioVinculos(db, () => AGORA)
  atlassian = new ClienteAtlassianFake()
  servico = new ServicoChamados(
    atlassian,
    outbox,
    vinculos,
    new AuditoriaBanco(db, () => AGORA, novoId),
    novoId,
  )
})

describe('RF-24 — idempotência', () => {
  it('duplo clique com a mesma chave não gera dois chamados', async () => {
    const a = await servico.abrirPorFormulario({
      solicitanteEmail: ANA,
      chaveIdempotencia: 'clique-unico',
      payload: PAYLOAD,
    })
    const b = await servico.abrirPorFormulario({
      solicitanteEmail: ANA,
      chaveIdempotencia: 'clique-unico',
      payload: PAYLOAD,
    })

    expect(a.duplicada).toBe(false)
    expect(b.duplicada).toBe(true)
    expect(b.issueKey).toBe(a.issueKey)
    const criacoes = atlassian.chamadas.filter((c) => c.operacao === 'criarChamado')
    expect(criacoes).toHaveLength(1)
  })

  it('submissões CONCORRENTES com a mesma chave: uma cria, a outra reaproveita', async () => {
    // A corrida é o cenário real do duplo clique. Um check-then-insert passaria
    // as duas pelo SELECT e criaria dois chamados; a garantia vem do UNIQUE.
    const [a, b] = await Promise.all([
      servico.abrirPorFormulario({
        solicitanteEmail: ANA,
        chaveIdempotencia: 'corrida',
        payload: PAYLOAD,
      }),
      servico.abrirPorFormulario({
        solicitanteEmail: ANA,
        chaveIdempotencia: 'corrida',
        payload: PAYLOAD,
      }),
    ])
    const chaves = new Set([a.issueKey, b.issueKey].filter(Boolean))
    expect(chaves.size).toBe(1)
    expect([a.duplicada, b.duplicada]).toContain(true)
    const r = await db.query(`SELECT COUNT(*) AS n FROM submissoes`, [])
    expect(r.rows[0]?.[0]).toBe(1)
  })
})

describe('RNF-17 — falha da Atlassian não perde o chamado', () => {
  it('a submissão é persistida ANTES da chamada, e sobrevive à falha', async () => {
    atlassian.estado.falhas.criarChamado = 'indisponivel'

    const r = await servico.abrirPorFormulario({
      solicitanteEmail: ANA,
      chaveIdempotencia: 'k1',
      payload: PAYLOAD,
    })

    // Estado real informado ao usuário — nunca "não consegui abrir seu chamado".
    expect(r.estado).toBe('pendente')
    expect(r.issueKey).toBeNull()

    const pendentes = await outbox.listarPendentes(10)
    expect(pendentes).toHaveLength(1)
    expect(pendentes[0]?.payload.titulo).toBe('Pipeline falhou')
    expect(pendentes[0]?.tentativas).toBe(1)
  })

  it('o cron reprocessa e o chamado nasce quando a Atlassian volta', async () => {
    atlassian.estado.falhas.criarChamado = 'indisponivel'
    await servico.abrirPorFormulario({
      solicitanteEmail: ANA,
      chaveIdempotencia: 'k1',
      payload: PAYLOAD,
    })

    atlassian.estado.falhas.criarChamado = 'nenhum'
    const resultado = await servico.reprocessarPendentes(10)

    expect(resultado.criados).toBe(1)
    expect(await outbox.listarPendentes(10)).toHaveLength(0)
    // E o vínculo existe — sem ele o chamado seria invisível ao próprio autor.
    const meus = await vinculos.listarDoSolicitante(ANA, 10)
    expect(meus).toHaveLength(1)
  })

  it('erro DEFINITIVO vira falha; TODOS os transitórios continuam pendentes', async () => {
    // Erro definitivo (400/403 — payload inválido, permissão negada): reprocessar
    // não resolve, e insistir para sempre esconderia o problema real.
    atlassian.estado.falhas.criarChamado = 'rejeitado'
    await expect(
      servico.abrirPorFormulario({
        solicitanteEmail: ANA,
        chaveIdempotencia: 'kd',
        payload: PAYLOAD,
      }),
    ).rejects.toThrow()
    expect((await outbox.obterPorChave('kd'))?.estado).toBe('falha')

    // Indisponibilidade, rate limit e timeout são TRANSITÓRIOS. Classificar
    // qualquer um deles como definitivo perderia o chamado numa queda de 30s —
    // é o que RNF-17 proíbe, e foi um bug real pego por este teste.
    for (const [i, modo] of (['indisponivel', 'rate_limit', 'timeout'] as const).entries()) {
      atlassian.estado.falhas.criarChamado = modo
      const chave = `kt-${i}`
      const r = await servico.abrirPorFormulario({
        solicitanteEmail: ANA,
        chaveIdempotencia: chave,
        payload: PAYLOAD,
      })
      expect(r.estado, `modo ${modo} deveria manter pendente`).toBe('pendente')
      expect((await outbox.obterPorChave(chave))?.estado, `modo ${modo}`).toBe('pendente')
    }
  })
})

describe('RNF-21 — o pior caso: criado no JSM, vínculo perdido', () => {
  it('reconciliação recupera o vínculo órfão', async () => {
    // Encena o pior caso: o chamado existe no JSM, a submissão está 'criado', e o
    // vínculo não existe. Sem reconciliação, o autor nunca veria o chamado —
    // RF-30 esconde o que não tem vínculo.
    const criado = await atlassian.criarChamado({
      serviceDeskId: 'sd-1',
      tipoChamadoId: 'rt-1',
      titulo: 'órfão',
      descricao: 'x',
      prioridade: 'normal',
      solicitanteEmail: ANA,
      chaveIdempotencia: 'orfa',
    })
    const { submissao } = await outbox.registrar({
      id: 's-orfa',
      chaveIdempotencia: 'orfa',
      solicitanteEmail: ANA,
      conversaId: null,
      via: 'conversa',
      verificadoRegras: true,
      payload: PAYLOAD,
    })
    await outbox.marcarCriado(submissao.id, criado.issueKey)

    expect(await vinculos.listarDoSolicitante(ANA, 10)).toHaveLength(0)
    expect(await servico.reconciliarVinculos(10)).toBe(1)
    expect(await vinculos.listarDoSolicitante(ANA, 10)).toHaveLength(1)
    // Idempotente: rodar de novo não duplica nem estoura.
    expect(await servico.reconciliarVinculos(10)).toBe(0)
  })
})

describe('RNF-18 / D-04 — degradação sem virar bypass', () => {
  it('o formulário mínimo abre chamado com a IA fora do ar', async () => {
    // Nenhuma chamada de IA acontece neste caminho: é o ponto do D-04. Uma queda
    // do provedor não pode derrubar a porta de entrada de chamados da empresa.
    const r = await servico.abrirPorFormulario({
      solicitanteEmail: ANA,
      chaveIdempotencia: 'sem-ia',
      payload: PAYLOAD,
    })
    expect(r.estado).toBe('criado')
    expect(r.issueKey).not.toBeNull()
  })

  it('chamado do formulário nasce marcado como NÃO verificado pelas regras', async () => {
    const r = await servico.abrirPorFormulario({
      solicitanteEmail: ANA,
      chaveIdempotencia: 'sem-ia',
      payload: PAYLOAD,
    })
    expect(r.verificadoRegras).toBe(false)
    const v = await vinculos.obterDoSolicitante(r.issueKey!, ANA)
    expect(v?.verificadoRegras).toBe(false)
    expect(v?.via).toBe('formulario')
  })

  it('o volume que entra pelo formulário é MENSURÁVEL — senão é fuga invisível', async () => {
    await servico.abrirPorFormulario({
      solicitanteEmail: ANA,
      chaveIdempotencia: 'f1',
      payload: PAYLOAD,
    })
    const r = await db.query(
      `SELECT via, COUNT(*) AS n FROM vinculos GROUP BY via ORDER BY via`,
      [],
    )
    expect(r.rows).toEqual([['formulario', 1]])
  })

  it('tool que FALHOU permite seguir, mas marca não verificado (não é bypass silencioso)', async () => {
    const repo = new RepositorioConversas(db, () => AGORA)
    await repo.criar('c1', ANA)
    // Confluence respondeu; histórico FALHOU.
    await repo.marcarConfluenceVerificado('c1', false)
    await repo.marcarHistoricoVerificado('c1', true)
    await repo.definirProposta('c1', {
      titulo: 'x',
      descricao: 'y',
      tipoChamadoId: 'rt-1',
      prioridade: 'normal',
      area: null,
      componente: null,
    })
    await repo.registrarConfirmacao('c1')

    const conversa = await repo.obter('c1')
    const r = await servico.abrirPorConversa(conversa!, 'sd-1', 'k-falha-tool')

    expect(r.estado).toBe('criado')
    // Abriu — indisponibilidade não é parede. Mas não se declara verificado.
    expect(r.verificadoRegras).toBe(false)
  })

  it('tool que NUNCA rodou continua recusando — falha ≠ não ter tentado', async () => {
    const repo = new RepositorioConversas(db, () => AGORA)
    await repo.criar('c2', ANA)
    await repo.marcarConfluenceVerificado('c2', false)
    await repo.definirProposta('c2', {
      titulo: 'x',
      descricao: 'y',
      tipoChamadoId: 'rt-1',
      prioridade: 'normal',
      area: null,
      componente: null,
    })
    await repo.registrarConfirmacao('c2')

    const conversa = await repo.obter('c2')
    await expect(servico.abrirPorConversa(conversa!, 'sd-1', 'k2')).rejects.toThrow(
      CriacaoRecusada,
    )
    // E nada foi criado na Atlassian.
    expect(atlassian.chamadas.filter((c) => c.operacao === 'criarChamado')).toHaveLength(0)
  })
})
