/**
 * Contrato do banco. `env.DB` do GoDeploy é assíncrono: sempre `await`, sempre
 * passar params (mesmo `[]`) — constituição, Princípio VIII.
 */

/**
 * Resultado de `query`.
 *
 * ⚠️ `rows` é `unknown[]`, não `unknown[][]`, porque **as duas formas acontecem**: o shim
 * de teste devolve array de valores por linha, e o `env.DB` do GoDeploy devolve um objeto
 * por linha. O tipo mentia antes, e é por isso que o compilador não avisou nada quando a
 * produção começou a devolver `{}` em toda leitura — ver `linhasComoObjetos`.
 *
 * Ninguém deve indexar `rows` diretamente: use `linhasComoObjetos` ou `primeiraLinha`.
 */
export interface ResultadoQuery {
  readonly columns: readonly string[]
  readonly rows: readonly unknown[]
  readonly rowsRead?: number
}

export interface ResultadoExec {
  readonly rowsWritten: number
}

export interface Banco {
  query(sql: string, params: readonly unknown[]): Promise<ResultadoQuery>
  exec(sql: string, params: readonly unknown[]): Promise<ResultadoExec>
}

/**
 * Converte o resultado de `query` em objetos — e tolera **as duas formas**.
 *
 * ## O bug que esta função existe para não repetir
 *
 * 🚨 **Medido em produção em 07/08/2026:** o `env.DB` do GoDeploy devolve `rows` como
 * **array de objetos** (`{ id: 'x', acao: 'login' }`), não como array de arrays. A versão
 * anterior desta função assumia só colunas+linhas: ela fazia `linha[i]` com `i` numérico
 * sobre um objeto, o que dá `undefined` em **todos** os campos.
 *
 * O sintoma era o pior possível — **não** um erro, e sim `{}`. Toda leitura do banco
 * devolvia objetos vazios: a auditoria mostrava 58 registros sem nenhum campo, a lista de
 * chamados vinha vazia, a config caía nos defaults. E nada disso aparecia nos testes,
 * porque o shim de teste (`sqlite-local.ts`) implementa a forma **documentada**
 * (colunas+linhas) e a plataforma entrega outra. Testes verdes, produção cega.
 *
 * A correção é aceitar as duas formas em vez de escolher uma: quem chama não deveria
 * precisar saber qual runtime está por baixo, e adivinhar errado de novo custaria outra
 * rodada de "por que a tela está vazia?".
 */
export function linhasComoObjetos<T = Record<string, unknown>>(r: ResultadoQuery): T[] {
  return r.rows.map((linha) => {
    // Forma da plataforma: a linha JÁ é um objeto com os nomes das colunas.
    if (linha !== null && typeof linha === 'object' && !Array.isArray(linha)) {
      return linha as T
    }
    // Forma documentada (e do shim de teste): colunas + array de valores.
    const valores = linha as readonly unknown[]
    const obj: Record<string, unknown> = {}
    r.columns.forEach((coluna, i) => {
      obj[coluna] = valores[i]
    })
    return obj as T
  })
}

export function primeiraLinha<T = Record<string, unknown>>(r: ResultadoQuery): T | null {
  const [primeira] = linhasComoObjetos<T>(r)
  return primeira ?? null
}
