/**
 * Implementação de `Banco` sobre `node:sqlite` — para TESTES e dev local.
 *
 * Em produção quem implementa `Banco` é `env.DB` do GoDeploy. Usar o SQLite real
 * do Node (e não um dublê em memória com Map) é decisão consciente: as
 * invariantes que importam são constraints do schema (`UNIQUE` de
 * `vinculos.issue_key` e de `submissoes.chave_idempotencia`). Um dublê que não
 * as aplica testaria a intenção, não a garantia — e RF-24/RN-03 passariam verdes
 * enquanto produção duplicaria chamado.
 *
 * Sem dependência nova: `node:sqlite` é do runtime.
 */

import { DatabaseSync } from 'node:sqlite'
import type { Banco, ResultadoExec, ResultadoQuery } from './tipos'

export class SqliteLocal implements Banco {
  private readonly db: DatabaseSync

  constructor(caminho = ':memory:') {
    this.db = new DatabaseSync(caminho)
    this.db.exec('PRAGMA foreign_keys = ON')
  }

  async query(sql: string, params: readonly unknown[]): Promise<ResultadoQuery> {
    const linhas = this.db.prepare(sql).all(...(params as never[])) as Record<
      string,
      unknown
    >[]
    const columns = linhas.length > 0 ? Object.keys(linhas[0]!) : []
    return {
      columns,
      rows: linhas.map((linha) => columns.map((c) => linha[c] ?? null)),
      rowsRead: linhas.length,
    }
  }

  async exec(sql: string, params: readonly unknown[]): Promise<ResultadoExec> {
    if (params.length === 0) {
      this.db.exec(sql)
      return { rowsWritten: 0 }
    }
    const r = this.db.prepare(sql).run(...(params as never[]))
    return { rowsWritten: Number(r.changes) }
  }

  fechar(): void {
    this.db.close()
  }
}
