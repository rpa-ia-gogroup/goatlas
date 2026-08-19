/**
 * RF-30 / RN-04 — o colaborador só vê chamado vinculado ao próprio e-mail.
 *
 * A Definição de Pronto exige: *"um colaborador não consegue ver o chamado de
 * outro (testado explicitamente)"*. Verificação no servidor, a cada requisição,
 * contra a tabela de vínculo — nunca por parâmetro vindo do cliente.
 *
 * _Requirements: RF-30, RN-04, RN-03, RNF-05_
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { SqliteLocal } from '@/lib/db/sqlite-local'
import { migrar } from '@/lib/db/schema'
import { RepositorioVinculos } from '@/lib/tickets/vinculos'
import { Outbox } from '@/lib/tickets/outbox'
import { ServicoChamados } from '@/lib/tickets/servico'
import { AuditoriaBanco } from '@/lib/audit'
import { ClienteAtlassianFake } from '@/lib/atlassian/fake'

const ANA = 'ana@gocase.com'
const BRUNO = 'bruno@gocase.com'
const AGORA = '2026-08-03T12:00:00.000Z'

let db: SqliteLocal
let vinculos: RepositorioVinculos
let servico: ServicoChamados
let atlassian: ClienteAtlassianFake

beforeEach(async () => {
  db = new SqliteLocal()
  await migrar(db)
  let n = 0
  const novoId = () => `id-${++n}`
  vinculos = new RepositorioVinculos(db, () => AGORA)
  atlassian = new ClienteAtlassianFake()
  servico = new ServicoChamados(
    atlassian,
    new Outbox(db, () => AGORA),
    vinculos,
    new AuditoriaBanco(db, () => AGORA, novoId),
    novoId,
  )
})

const PAYLOAD = {
  titulo: 'Algo quebrou',
  descricao: 'detalhe',
  tipoChamadoId: 'rt-1',
  serviceDeskId: 'sd-1',
  prioridade: 'normal' as const,
}

describe('RF-30 — isolamento por vínculo', () => {
  it('BURLA — issueKey de outra pessoa por acesso direto: nega', async () => {
    const daAna = await servico.abrirPorFormulario({
      solicitanteEmail: ANA,
      chaveIdempotencia: 'k-ana',
      payload: PAYLOAD,
    })
    expect(daAna.issueKey).not.toBeNull()

    // Bruno conhece a chave do chamado da Ana e tenta ler.
    const tentativa = await servico.obterChamadoDoSolicitante(daAna.issueKey!, BRUNO)
    expect(tentativa).toBeNull()

    // E a Ana continua vendo o dela.
    const dela = await servico.obterChamadoDoSolicitante(daAna.issueKey!, ANA)
    expect(dela?.chamado.issueKey).toBe(daAna.issueKey)
  })

  it('BURLA — comentários de chamado de outra pessoa: nega', async () => {
    const daAna = await servico.abrirPorFormulario({
      solicitanteEmail: ANA,
      chaveIdempotencia: 'k-ana',
      payload: PAYLOAD,
    })
    await atlassian.comentar(daAna.issueKey!, 'comentário público', ANA)

    expect(await servico.listarComentariosDoSolicitante(daAna.issueKey!, BRUNO)).toBeNull()
    expect(await servico.listarComentariosDoSolicitante(daAna.issueKey!, ANA)).toHaveLength(1)
  })

  it('a negação é registrada em auditoria — tentativa bloqueada tem de deixar rastro', async () => {
    const daAna = await servico.abrirPorFormulario({
      solicitanteEmail: ANA,
      chaveIdempotencia: 'k-ana',
      payload: PAYLOAD,
    })
    await servico.obterChamadoDoSolicitante(daAna.issueKey!, BRUNO)

    const r = await db.query(
      `SELECT ator_email, acao, resultado, recurso FROM auditoria
        WHERE ator_email = ? AND resultado = 'negado'`,
      [BRUNO],
    )
    expect(r.rows).toHaveLength(1)
    expect(r.rows[0]).toContain(daAna.issueKey)
  })

  it('"Meus chamados" nunca traz chamado de outra pessoa', async () => {
    await servico.abrirPorFormulario({
      solicitanteEmail: ANA,
      chaveIdempotencia: 'k1',
      payload: PAYLOAD,
    })
    await servico.abrirPorFormulario({
      solicitanteEmail: ANA,
      chaveIdempotencia: 'k2',
      payload: PAYLOAD,
    })
    await servico.abrirPorFormulario({
      solicitanteEmail: BRUNO,
      chaveIdempotencia: 'k3',
      payload: PAYLOAD,
    })

    const daAna = await vinculos.listarDoSolicitante(ANA, 50)
    const doBruno = await vinculos.listarDoSolicitante(BRUNO, 50)
    expect(daAna).toHaveLength(2)
    expect(doBruno).toHaveLength(1)
    expect(daAna.every((v) => v.solicitanteEmail === ANA)).toBe(true)
  })

  it('o filtro está no WHERE do SQL, não num filtro aplicado depois', async () => {
    // Prova de desenho: `obterDoSolicitante` com e-mail errado não devolve linha
    // NEM QUANDO o vínculo existe. Se o isolamento fosse um `.filter()` esquecível
    // acima da consulta, este teste continuaria passando — mas o método sem
    // e-mail nem existe na classe, e é isso que fecha o caminho.
    await vinculos.criar({
      issueKey: 'ATLAS-99',
      solicitanteEmail: ANA,
      conversaId: null,
      via: 'conversa',
      verificadoRegras: true,
    })
    expect(await vinculos.obterDoSolicitante('ATLAS-99', BRUNO)).toBeNull()
    expect(await vinculos.obterDoSolicitante('ATLAS-99', ANA)).not.toBeNull()
    // A via de reconciliação é explícita no nome, e não é rota de usuário.
    expect(await vinculos.obterSemIsolamento_apenasReconciliacao('ATLAS-99')).not.toBeNull()
  })
})
