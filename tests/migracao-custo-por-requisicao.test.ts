/**
 * O custo de `migrar` por requisição — RNF-36 (custo fixo orçado), T-135.
 *
 * `montarContexto` chama `migrar` a CADA requisição `/api/*`, e cada `db.exec` do
 * GoDeploy é uma ida e volta assíncrona. Aplicar os 32 statements de DDL (17 tabelas
 * + 15 índices) mais os 3 `ALTER` toda vez custava **35 idas ao banco** antes de a
 * rota começar a trabalhar — 36 com o `config.carregar()` que vem em seguida. Piso
 * medido de **442 ms** no cron mais barato do app publicado (10/08/2026), e o console
 * de admin dispara **seis** requisições paralelas no boot.
 *
 * ⚠️ Estes testes contam IDAS AO BANCO, não milissegundos. Tempo de parede num
 * SQLite em memória não mede nada do que dói em produção (lá o custo é de rede), e
 * um teste de duração seria instável na máquina de qualquer pessoa. O número de
 * round-trips é o que a plataforma cobra, então é ele que se afirma aqui.
 *
 * _Requirements: RNF-36_
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { SqliteLocal } from '@/lib/db/sqlite-local'
import { migrar, TABELAS, VERSAO_SCHEMA } from '@/lib/db/schema'
import { primeiraLinha, type Banco, type ResultadoExec, type ResultadoQuery } from '@/lib/db/tipos'

/** Banco real, com contador de idas. Espião, não dublê: o SQLite por baixo é o mesmo. */
class BancoContado implements Banco {
  execs = 0
  queries = 0
  constructor(private readonly interno: Banco) {}
  async query(sql: string, params: readonly unknown[]): Promise<ResultadoQuery> {
    this.queries++
    return this.interno.query(sql, params)
  }
  async exec(sql: string, params: readonly unknown[]): Promise<ResultadoExec> {
    this.execs++
    return this.interno.exec(sql, params)
  }
  get idas() {
    return this.execs + this.queries
  }
}

let db: BancoContado

beforeEach(() => {
  db = new BancoContado(new SqliteLocal())
})

describe('T-135 — migrar não cobra o schema inteiro por requisição', () => {
  it('a PRIMEIRA migração aplica tudo', async () => {
    await migrar(db)
    // Banco novo: paga os CREATE, os ALTER e a gravação da marca.
    expect(db.execs).toBeGreaterThanOrEqual(TABELAS.length)
    const linha = await db.query(`SELECT versao FROM meta_schema WHERE id = 1`, [])
    expect(linha.rows).toHaveLength(1)
  })

  it('🚨 a segunda chamada no MESMO banco não vai ao banco nenhuma vez', async () => {
    await migrar(db)
    const depoisDaPrimeira = db.idas

    await migrar(db)

    // Memoizado por instância de banco: zero idas. Era este número que valia 35.
    expect(db.idas - depoisDaPrimeira).toBe(0)
  })

  it('🚨 isolate NOVO sobre banco já migrado custa UMA query, não 35 execs', async () => {
    // O isolate do Worker recicla: a memória em memória não sobrevive, o banco sim.
    // Simular isso é envolver o MESMO SQLite numa instância nova de `Banco`, que é
    // uma chave nova no `WeakMap`.
    const interno = new SqliteLocal()
    await migrar(new BancoContado(interno))

    const novoIsolate = new BancoContado(interno)
    await migrar(novoIsolate)

    expect(novoIsolate.queries).toBe(1) // a sonda
    expect(novoIsolate.execs).toBe(0) // e nenhum DDL
  })

  it('requisições CONCORRENTES no mesmo isolate migram uma vez só', async () => {
    // Duas requisições chegam juntas no boot do isolate. Um booleano marcado só no
    // fim deixaria as duas migrarem em paralelo — o mesmo check-then-insert que o
    // outbox evita com constraint, na versão em memória.
    await Promise.all([migrar(db), migrar(db), migrar(db)])

    const umaVez = new BancoContado(new SqliteLocal())
    await migrar(umaVez)
    expect(db.execs).toBe(umaVez.execs)
  })
})

describe('T-135 — a sonda erra para o lado seguro', () => {
  it('marca de OUTRA versão reaplica o schema', async () => {
    await migrar(db)
    // Simula deploy com schema novo: o código conhece uma versão, o banco tem outra.
    await db.exec(`UPDATE meta_schema SET versao = ? WHERE id = 1`, ['versao-antiga'])

    const isolateNovo = new BancoContado(db)
    await migrar(isolateNovo)

    expect(isolateNovo.execs).toBeGreaterThanOrEqual(TABELAS.length)
    const r = await db.query(`SELECT versao FROM meta_schema WHERE id = 1`, [])
    // `primeiraLinha`, nunca `rows[0]`: as duas formas de `rows` acontecem (ver `tipos.ts`).
    expect(primeiraLinha<{ versao: string }>(r)?.versao).toBe(VERSAO_SCHEMA)
  })

  it('⚠️ sonda que EXPLODE reaplica, nunca declara pronto', async () => {
    // Fail-closed: o custo de aplicar DDL idempotente à toa é tempo; o custo de não
    // aplicar é tabela faltando em produção.
    const explode: Banco = {
      query: async () => {
        throw new Error('banco fora do ar na leitura')
      },
      exec: (sql, params) => db.exec(sql, params),
    }
    await migrar(explode)
    expect(db.execs).toBeGreaterThanOrEqual(TABELAS.length)
  })

  it('⚠️ migração que FALHA não fica memoizada como concluída', async () => {
    let permitir = false
    const instavel: Banco = {
      query: (sql, params) => db.query(sql, params),
      exec: async (sql, params) => {
        if (!permitir) throw new Error('banco fora do ar')
        return db.exec(sql, params)
      },
    }

    await expect(migrar(instavel)).rejects.toThrow('banco fora do ar')

    // A requisição seguinte tem de tentar de novo — memoizar a falha deixaria o app
    // sem schema até alguém reiniciar o isolate.
    permitir = true
    await migrar(instavel)
    const r = await db.query(`SELECT versao FROM meta_schema WHERE id = 1`, [])
    expect(r.rows).toHaveLength(1)
  })

  it('a versão é DERIVADA do schema, não escrita à mão', () => {
    // Se alguém acrescentar uma tabela e a marca não mudar, o app nunca aplica a
    // tabela nova e o sintoma aparece longe daqui. Derivar remove o passo esquecível.
    // O comprimento do texto entra na marca, então nenhuma edição de statement passa
    // sem mudá-la — inclusive edição que um hash sozinho pudesse colidir.
    expect(VERSAO_SCHEMA).toMatch(/^[0-9a-f]{16}-\d+$/)
    const comprimentoNaMarca = Number(VERSAO_SCHEMA.split('-')[1])
    expect(comprimentoNaMarca).toBeGreaterThan([...TABELAS].join('\n').length)
  })
})
