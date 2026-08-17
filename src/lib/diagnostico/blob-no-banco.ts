/**
 * Diagnóstico: o `env.DB` do GoDeploy aguenta guardar um ARQUIVO?
 *
 * ## Por que isto existe
 *
 * Hoje o anexo não fica com a gente: ele sobe para a Atlassian no momento em que a pessoa
 * o escolhe, e o que guardamos é só o `temporaryAttachmentId` (`D-26`). Esse id tem prazo,
 * e é por causa dele que o anexo **não** viaja dentro da chamada de criação. A consequência
 * só apareceu em 17/08/2026: os request types que exigem anexo (`90`, `91`, `92`, `94`,
 * `96`, `134` no `GN`) respondem **400** — definitivo, chamado perdido.
 *
 * A saída limpa é guardar os BYTES aqui e mandá-los à Atlassian só na confirmação. Antes de
 * desenhar isso, uma pergunta precisa de resposta medida: **o banco da plataforma aceita um
 * valor de 8 MB?** (8 MB é o teto de envio de `http/anexo-entrada.ts`.)
 *
 * ## Por que não dá para responder isto com teste
 *
 * Mesma família de `linhasComoObjetos` e do `INSERT` multi-tupla de `D-73`: o shim
 * (`node:sqlite`) é SQLite de verdade e aceita valor grande sem pestanejar; a plataforma é
 * outra coisa, com transporte próprio. Verde aqui não diz nada sobre lá. Por isso este
 * módulo roda **no app publicado**, por uma rota de admin.
 *
 * ## O desenho da medição
 *
 * - Os bytes são **aleatórios**, nunca zeros: um valor compressível passaria por qualquer
 *   transporte que comprima, e diria "cabe 8 MB" sobre um caso que não existe.
 * - A prova de integridade é **SHA-256 do que voltou**, comparado com o que foi gravado —
 *   tamanho igual com conteúdo truncado no meio é exatamente o defeito silencioso que se
 *   está procurando.
 * - Cada tamanho é gravado, lido, conferido e **apagado**; a tabela é derrubada no fim.
 * - `chunk` mede o plano B (fatiar em linhas de 512 kB) **na mesma requisição**, para o
 *   resultado ser comparável.
 */

import { linhasComoObjetos, type Banco } from '../db/tipos'

const SCHEMA_DIAG = `CREATE TABLE IF NOT EXISTS diag_blob (
   id TEXT NOT NULL,
   ordem INTEGER NOT NULL,
   sha TEXT NOT NULL,
   dados TEXT NOT NULL,
   PRIMARY KEY (id, ordem)
 )`

export interface ResultadoDeTamanho {
  readonly rotulo: string
  readonly bytes: number
  readonly bytesNaColuna: number
  readonly estrategia: 'linha_unica' | 'fatiado'
  /** Quantas linhas o arquivo ocupou — 1 na linha única. */
  readonly fatias?: number
  readonly gravou: boolean
  readonly leu: boolean
  readonly integro: boolean
  readonly msGravacao: number | null
  readonly msLeitura: number | null
  readonly bytesQueVoltaram: number | null
  readonly erro: string | null
}

const TAMANHOS_PADRAO_MB = [0.0625, 0.25, 1, 2, 4, 6, 8] as const

/**
 * Fatia padrão. Medido na plataforma em 17/08/2026: **um valor de até ~2.200.000 bytes
 * passa; acima disso o banco responde `SQLITE_TOOBIG`** (2.199.912 gravou, 2.202.012 não).
 * Como o conteúdo viaja em base64, 512 kB de arquivo viram ~700 kB na coluna — a folga é de
 * 3×, e é ela que faz a escolha não depender de o teto ser exatamente esse número.
 */
const FATIA_BYTES_PADRAO = 512 * 1024

/** `crypto.getRandomValues` recusa mais de 65536 bytes por chamada. */
function bytesAleatorios(total: number): Uint8Array {
  const buf = new Uint8Array(total)
  for (let i = 0; i < total; i += 65536) {
    crypto.getRandomValues(buf.subarray(i, Math.min(i + 65536, total)))
  }
  return buf
}

/** `String.fromCharCode(...buf)` estoura a pilha com buffer grande — daí o laço. */
function paraBase64(bytes: Uint8Array): string {
  let bruto = ''
  for (let i = 0; i < bytes.length; i += 32768) {
    bruto += String.fromCharCode(...bytes.subarray(i, Math.min(i + 32768, bytes.length)))
  }
  return btoa(bruto)
}

function deBase64(texto: string): Uint8Array {
  const bruto = atob(texto)
  const bytes = new Uint8Array(bruto.length)
  for (let i = 0; i < bruto.length; i += 1) bytes[i] = bruto.charCodeAt(i)
  return bytes
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as unknown as ArrayBuffer)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function mensagemDeErro(e: unknown): string {
  // ⚠️ Sem corpo de resposta e sem stack: isto vira JSON numa rota de admin (`RNF-30`).
  const nome = e instanceof Error ? e.name : typeof e
  const msg = e instanceof Error ? e.message : String(e)
  return `${nome}: ${msg}`.slice(0, 300)
}

async function medirLinhaUnica(
  db: Banco,
  rotulo: string,
  bytes: Uint8Array,
  esperado: string,
): Promise<ResultadoDeTamanho> {
  const b64 = paraBase64(bytes)
  const id = `linha-${rotulo}`
  const base = {
    rotulo,
    bytes: bytes.length,
    bytesNaColuna: b64.length,
    estrategia: 'linha_unica' as const,
  }

  let msGravacao: number | null = null
  const t0 = Date.now()
  try {
    await db.exec('DELETE FROM diag_blob WHERE id = ?', [id])
    await db.exec('INSERT INTO diag_blob (id, ordem, sha, dados) VALUES (?, ?, ?, ?)', [
      id,
      0,
      esperado,
      b64,
    ])
    msGravacao = Date.now() - t0
  } catch (e) {
    return {
      ...base,
      gravou: false,
      leu: false,
      integro: false,
      msGravacao: Date.now() - t0,
      msLeitura: null,
      bytesQueVoltaram: null,
      erro: mensagemDeErro(e),
    }
  }

  const t1 = Date.now()
  try {
    const r = await db.query('SELECT dados FROM diag_blob WHERE id = ?', [id])
    const msLeitura = Date.now() - t1
    const linha = r.rows[0]
    const devolvido =
      linha !== null && typeof linha === 'object' && !Array.isArray(linha)
        ? (linha as { dados?: unknown }).dados
        : (linha as readonly unknown[] | undefined)?.[0]

    if (typeof devolvido !== 'string') {
      return {
        ...base,
        gravou: true,
        leu: false,
        integro: false,
        msGravacao,
        msLeitura,
        bytesQueVoltaram: null,
        erro: `a coluna voltou como ${devolvido === undefined ? 'ausente' : typeof devolvido}`,
      }
    }

    const volta = deBase64(devolvido)
    const integro = (await sha256(volta)) === esperado
    return {
      ...base,
      gravou: true,
      leu: true,
      integro,
      msGravacao,
      msLeitura,
      bytesQueVoltaram: volta.length,
      erro: integro ? null : 'o conteúdo que voltou não confere com o que foi gravado',
    }
  } catch (e) {
    return {
      ...base,
      gravou: true,
      leu: false,
      integro: false,
      msGravacao,
      msLeitura: Date.now() - t1,
      bytesQueVoltaram: null,
      erro: mensagemDeErro(e),
    }
  } finally {
    await db.exec('DELETE FROM diag_blob WHERE id = ?', [id]).catch(() => undefined)
  }
}

async function medirFatiado(
  db: Banco,
  rotulo: string,
  bytes: Uint8Array,
  esperado: string,
  fatiaBytes: number,
): Promise<ResultadoDeTamanho> {
  const id = `fatia-${rotulo}`
  const fatias: string[] = []
  for (let i = 0; i < bytes.length; i += fatiaBytes) {
    fatias.push(paraBase64(bytes.subarray(i, Math.min(i + fatiaBytes, bytes.length))))
  }
  const base = {
    rotulo,
    bytes: bytes.length,
    bytesNaColuna: fatias.reduce((s, f) => s + f.length, 0),
    estrategia: 'fatiado' as const,
    fatias: fatias.length,
  }

  let msGravacao: number | null = null
  const t0 = Date.now()
  try {
    await db.exec('DELETE FROM diag_blob WHERE id = ?', [id])
    // ⚠️ Uma linha por `INSERT`: multi-tupla é recusada pelo `env.DB` (`D-73`).
    for (const [ordem, fatia] of fatias.entries()) {
      await db.exec('INSERT INTO diag_blob (id, ordem, sha, dados) VALUES (?, ?, ?, ?)', [
        id,
        ordem,
        esperado,
        fatia,
      ])
    }
    msGravacao = Date.now() - t0
  } catch (e) {
    return {
      ...base,
      gravou: false,
      leu: false,
      integro: false,
      msGravacao: Date.now() - t0,
      msLeitura: null,
      bytesQueVoltaram: null,
      erro: mensagemDeErro(e),
    }
  }

  const t1 = Date.now()
  try {
    const r = await db.query('SELECT ordem, dados FROM diag_blob WHERE id = ? ORDER BY ordem', [
      id,
    ])
    const msLeitura = Date.now() - t1
    const pedacos = r.rows.map((linha) =>
      linha !== null && typeof linha === 'object' && !Array.isArray(linha)
        ? (linha as { dados?: unknown }).dados
        : (linha as readonly unknown[])?.[1],
    )
    if (pedacos.length !== fatias.length || pedacos.some((p) => typeof p !== 'string')) {
      return {
        ...base,
        gravou: true,
        leu: false,
        integro: false,
        msGravacao,
        msLeitura,
        bytesQueVoltaram: null,
        erro: `voltaram ${pedacos.length} fatias de ${fatias.length}`,
      }
    }
    const partes = (pedacos as string[]).map(deBase64)
    const volta = new Uint8Array(partes.reduce((s, p) => s + p.length, 0))
    let off = 0
    for (const p of partes) {
      volta.set(p, off)
      off += p.length
    }
    const integro = (await sha256(volta)) === esperado
    return {
      ...base,
      gravou: true,
      leu: true,
      integro,
      msGravacao,
      msLeitura,
      bytesQueVoltaram: volta.length,
      erro: integro ? null : 'o conteúdo remontado não confere com o que foi gravado',
    }
  } catch (e) {
    return {
      ...base,
      gravou: true,
      leu: false,
      integro: false,
      msGravacao,
      msLeitura: Date.now() - t1,
      bytesQueVoltaram: null,
      erro: mensagemDeErro(e),
    }
  } finally {
    await db.exec('DELETE FROM diag_blob WHERE id = ?', [id]).catch(() => undefined)
  }
}

/**
 * Grava um arquivo e **deixa lá** — o par de `conferirArquivoPersistido`.
 *
 * ⚠️ Isto é o que a bateria acima **não** mede: lá gravação e leitura acontecem na mesma
 * requisição, e o uso real é outro — quem escreve é o upload, quem lê é a confirmação,
 * minutos depois e em outro isolate. Escrita que só funciona dentro da própria requisição
 * seria inútil para o anexo, e passaria despercebida.
 */
export async function gravarArquivoPersistido(
  db: Banco,
  opcoes: { readonly id: string; readonly tamanhoMb: number; readonly fatiaKb?: number },
): Promise<{ id: string; bytes: number; fatias: number; sha: string; ms: number }> {
  await db.exec(SCHEMA_DIAG, [])
  const fatiaBytes = opcoes.fatiaKb ? Math.round(opcoes.fatiaKb * 1024) : FATIA_BYTES_PADRAO
  const bytes = bytesAleatorios(Math.round(opcoes.tamanhoMb * 1024 * 1024))
  const sha = await sha256(bytes)
  const t0 = Date.now()
  await db.exec('DELETE FROM diag_blob WHERE id = ?', [opcoes.id])
  let ordem = 0
  for (let i = 0; i < bytes.length; i += fatiaBytes) {
    await db.exec('INSERT INTO diag_blob (id, ordem, sha, dados) VALUES (?, ?, ?, ?)', [
      opcoes.id,
      ordem,
      sha,
      paraBase64(bytes.subarray(i, Math.min(i + fatiaBytes, bytes.length))),
    ])
    ordem += 1
  }
  return { id: opcoes.id, bytes: bytes.length, fatias: ordem, sha, ms: Date.now() - t0 }
}

/** Lê o que `gravarArquivoPersistido` deixou e confere o SHA gravado junto. */
export async function conferirArquivoPersistido(
  db: Banco,
  id: string,
  apagar = true,
): Promise<{
  achou: boolean
  fatias: number
  bytes: number | null
  integro: boolean
  ms: number
}> {
  const t0 = Date.now()
  const r = await db.query('SELECT ordem, sha, dados FROM diag_blob WHERE id = ? ORDER BY ordem', [
    id,
  ])
  const linhas = linhasComoObjetos<{ sha?: unknown; dados?: unknown }>(r)
  if (linhas.length === 0) {
    return { achou: false, fatias: 0, bytes: null, integro: false, ms: Date.now() - t0 }
  }
  const partes = linhas.map((l) => (typeof l.dados === 'string' ? deBase64(l.dados) : null))
  if (partes.some((p) => p === null)) {
    return {
      achou: true,
      fatias: linhas.length,
      bytes: null,
      integro: false,
      ms: Date.now() - t0,
    }
  }
  const volta = new Uint8Array((partes as Uint8Array[]).reduce((s, p) => s + p.length, 0))
  let off = 0
  for (const p of partes as Uint8Array[]) {
    volta.set(p, off)
    off += p.length
  }
  const esperado = typeof linhas[0]?.sha === 'string' ? (linhas[0].sha as string) : ''
  const integro = (await sha256(volta)) === esperado
  const ms = Date.now() - t0
  if (apagar) await db.exec('DELETE FROM diag_blob WHERE id = ?', [id]).catch(() => undefined)
  return { achou: true, fatias: linhas.length, bytes: volta.length, integro, ms }
}

export interface RelatorioDeBlob {
  readonly fatiaBytes: number
  readonly itens: readonly ResultadoDeTamanho[]
  readonly maiorLinhaUnicaOkMb: number | null
  readonly maiorFatiadoOkMb: number | null
}

/**
 * Roda a bateria. `tamanhosMb` existe para repetir um tamanho isolado quando a bateria
 * inteira estourar a memória do isolate — o que é, ele próprio, um resultado.
 */
export async function medirBlobNoBanco(
  db: Banco,
  opcoes: {
    readonly tamanhosMb?: readonly number[]
    readonly fatiar?: boolean
    readonly fatiaKb?: number
  } = {},
): Promise<RelatorioDeBlob> {
  const tamanhos = opcoes.tamanhosMb?.length ? opcoes.tamanhosMb : TAMANHOS_PADRAO_MB
  const fatiar = opcoes.fatiar !== false
  const fatiaBytes = opcoes.fatiaKb ? Math.round(opcoes.fatiaKb * 1024) : FATIA_BYTES_PADRAO

  await db.exec(SCHEMA_DIAG, [])

  const itens: ResultadoDeTamanho[] = []
  try {
    for (const mb of tamanhos) {
      const total = Math.round(mb * 1024 * 1024)
      const rotulo = mb < 1 ? `${Math.round(mb * 1024)}kb` : `${mb}mb`
      const bytes = bytesAleatorios(total)
      const esperado = await sha256(bytes)
      itens.push(await medirLinhaUnica(db, rotulo, bytes, esperado))
      if (fatiar) itens.push(await medirFatiado(db, rotulo, bytes, esperado, fatiaBytes))
    }
  } finally {
    // ⚠️ Só derruba a tabela se ela ficou vazia: um `DROP` incondicional apagaria o arquivo
    // que `gravarArquivoPersistido` deixou de propósito para a requisição seguinte conferir.
    const sobrou = await db
      .query('SELECT COUNT(*) AS n FROM diag_blob', [])
      .then((r) => Number(linhasComoObjetos<{ n?: unknown }>(r)[0]?.n ?? 0))
      .catch(() => 1)
    if (sobrou === 0) await db.exec('DROP TABLE IF EXISTS diag_blob', []).catch(() => undefined)
  }

  const maiorOk = (estrategia: ResultadoDeTamanho['estrategia']) => {
    const ok = itens.filter((i) => i.estrategia === estrategia && i.integro)
    return ok.length ? Math.max(...ok.map((i) => i.bytes)) / (1024 * 1024) : null
  }

  return {
    fatiaBytes,
    itens,
    maiorLinhaUnicaOkMb: maiorOk('linha_unica'),
    maiorFatiadoOkMb: maiorOk('fatiado'),
  }
}
