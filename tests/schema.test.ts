/**
 * As invariantes críticas moram no SCHEMA, não na aplicação. Este teste prova
 * isso: ele viola as regras direto no banco, sem passar por código de negócio.
 *
 * _Requirements: RN-03, RF-24, RF-22, RF-58_
 */

import { describe, expect, it } from 'vitest'
import { SqliteLocal } from '@/lib/db/sqlite-local'
import { migrar } from '@/lib/db/schema'

async function bancoMigrado(): Promise<SqliteLocal> {
  const db = new SqliteLocal()
  await migrar(db)
  return db
}

const AGORA = '2026-08-03T12:00:00.000Z'

describe('schema', () => {
  it('migração é idempotente — roda a cada boot do Worker', async () => {
    const db = await bancoMigrado()
    await expect(migrar(db)).resolves.toBeUndefined()
    await expect(migrar(db)).resolves.toBeUndefined()
  })

  it('RN-03: um chamado pertence a exatamente um solicitante', async () => {
    const db = await bancoMigrado()
    const inserir = (email: string) =>
      db.exec(
        `INSERT INTO vinculos (issue_key, solicitante_email, via, criado_em)
         VALUES (?, ?, 'conversa', ?)`,
        ['ATLAS-1', email, AGORA],
      )

    await inserir('ana@gocase.com')
    // Segunda pessoa no MESMO chamado tem de ser impossível no banco.
    await expect(inserir('bruno@gocase.com')).rejects.toThrow()
  })

  it('RF-24: a mesma chave de idempotência não gera duas submissões', async () => {
    const db = await bancoMigrado()
    const inserir = (id: string) =>
      db.exec(
        `INSERT INTO submissoes
           (id, chave_idempotencia, solicitante_email, payload_json, criado_em, atualizado_em)
         VALUES (?, 'chave-unica', 'ana@gocase.com', '{}', ?, ?)`,
        [id, AGORA, AGORA],
      )

    await inserir('s1')
    await expect(inserir('s2')).rejects.toThrow()
  })

  it('estado de submissão e de conversa são restringidos pelo CHECK', async () => {
    const db = await bancoMigrado()
    await expect(
      db.exec(
        `INSERT INTO submissoes
           (id, chave_idempotencia, solicitante_email, payload_json, estado, criado_em, atualizado_em)
         VALUES ('s1', 'k1', 'ana@gocase.com', '{}', 'estado_inventado', ?, ?)`,
        [AGORA, AGORA],
      ),
    ).rejects.toThrow()

    await expect(
      db.exec(
        `INSERT INTO conversas (id, solicitante_email, estado, criado_em, atualizado_em)
         VALUES ('c1', 'ana@gocase.com', 'estado_inventado', ?, ?)`,
        [AGORA, AGORA],
      ),
    ).rejects.toThrow()
  })

  it('RF-58: auditoria só aceita resultado sucesso/falha/negado — inclusive falha', async () => {
    const db = await bancoMigrado()
    for (const resultado of ['sucesso', 'falha', 'negado']) {
      await expect(
        db.exec(
          `INSERT INTO auditoria (id, ator_email, acao, resultado, criado_em)
           VALUES (?, 'ana@gocase.com', 'teste', ?, ?)`,
          [`a-${resultado}`, resultado, AGORA],
        ),
      ).resolves.toBeDefined()
    }
    await expect(
      db.exec(
        `INSERT INTO auditoria (id, ator_email, acao, resultado, criado_em)
         VALUES ('a-x', 'ana@gocase.com', 'teste', 'talvez', ?)`,
        [AGORA],
      ),
    ).rejects.toThrow()
  })

  it('cache da Regra 2 tem chave composta issue_key + hash do comentário', async () => {
    const db = await bancoMigrado()
    const inserir = (hash: string) =>
      db.exec(
        `INSERT INTO classificacoes_ticket (issue_key, hash_comentario, classe, criado_em)
         VALUES ('TECH-1', ?, 'ajuste_operacional', ?)`,
        [hash, AGORA],
      )

    await inserir('h1')
    // Comentário diferente no mesmo ticket → nova entrada (a resolução mudou).
    await expect(inserir('h2')).resolves.toBeDefined()
    // Mesmo comentário no mesmo ticket → é cache, não pode duplicar.
    await expect(inserir('h1')).rejects.toThrow()
  })
})
