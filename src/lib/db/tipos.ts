/**
 * Contrato do banco. `env.DB` do GoDeploy é assíncrono: sempre `await`, sempre
 * passar params (mesmo `[]`) — constituição, Princípio VIII.
 */

export interface ResultadoQuery {
  readonly columns: readonly string[]
  readonly rows: readonly unknown[][]
  readonly rowsRead?: number
}

export interface ResultadoExec {
  readonly rowsWritten: number
}

export interface Banco {
  query(sql: string, params: readonly unknown[]): Promise<ResultadoQuery>
  exec(sql: string, params: readonly unknown[]): Promise<ResultadoExec>
}

/** Converte o formato colunas+linhas do GoDeploy em objetos. */
export function linhasComoObjetos<T = Record<string, unknown>>(r: ResultadoQuery): T[] {
  return r.rows.map((linha) => {
    const obj: Record<string, unknown> = {}
    r.columns.forEach((coluna, i) => {
      obj[coluna] = linha[i]
    })
    return obj as T
  })
}

export function primeiraLinha<T = Record<string, unknown>>(r: ResultadoQuery): T | null {
  const [primeira] = linhasComoObjetos<T>(r)
  return primeira ?? null
}
