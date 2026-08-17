/**
 * Os BYTES do anexo, guardados até o chamado nascer — `RF-78` (spec 010).
 *
 * ## Por que o app passou a guardar arquivo
 *
 * Porque **6 dos 15 assuntos do `GN` exigem anexo** (`90`, `91`, `92`, `94`, `96`, `134`) e
 * o Jira recusa a criação sem ele. Medido em 17/08/2026, com todos os outros campos
 * preenchidos, a resposta foi só uma frase: *"Por favor, adicione pelo menos um arquivo"*.
 *
 * Mandar o `temporaryAttachmentId` do upload dentro da criação resolveria — e é o que
 * `D-26` proíbe, com razão: aquele id envelhece durante a conversa, e id vencido faz a
 * **criação** responder 400, que é definitivo (`RNF-17`). O chamado da pessoa se perderia
 * por causa de um arquivo.
 *
 * Com os bytes aqui, o id passa a nascer **segundos** antes de ser usado, na confirmação.
 * O motivo de `D-26` deixa de existir para esse caminho — e só para ele.
 *
 * ## Por que FATIADO
 *
 * 🚨 `D-74`, medido na plataforma: um valor acima de **~2,2 MB** é recusado com
 * `SQLITE_TOOBIG` (2.199.912 bytes gravaram, 2.202.012 não). Fatiado, **8 MB entram e
 * voltam íntegros**, inclusive entre requisições diferentes. Como base64 infla 4/3, uma
 * fatia de 512 kB de arquivo ocupa ~700 kB na coluna: folga de 3×, deliberada, porque o
 * teto é medição de hoje numa plataforma que já mudou de comportamento antes (`D-73`).
 *
 * ⚠️ **Uma linha por `INSERT`** — multi-tupla é recusada pelo `env.DB` (`D-73`).
 *
 * ⚠️ **Nenhuma leitura sem e-mail** (`RF-30`): o `WHERE` sempre junta com
 * `anexos_pendentes`, que é quem sabe de quem é o arquivo. Um `lerPorId(anexoId)` sem
 * e-mail seria a porta para baixar o arquivo de outra pessoa — por isso ele não existe.
 */

import { linhasComoObjetos, type Banco } from '../db/tipos'

/** ~700 kB de base64 por linha, contra um teto medido de ~2,2 MB (`D-74`). */
export const FATIA_ANEXO_BYTES = 512 * 1024

export interface ArquivoGuardado {
  readonly anexoId: string
  readonly nomeArquivo: string
  readonly tipoArquivo: string
  readonly bytes: ArrayBuffer
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

export class RepositorioAnexosConteudo {
  constructor(private readonly db: Banco) {}

  /**
   * Guarda os bytes de um anexo já registrado em `anexos_pendentes`.
   *
   * ⚠️ Apaga antes de gravar: reenviar o mesmo arquivo (o `UNIQUE` de `anexos_pendentes`
   * trata como duplicado e devolve a mesma linha) não pode deixar fatias da tentativa
   * anterior no meio das novas — o arquivo remontado sairia corrompido, e o `SHA` que
   * `D-74` usa para provar integridade não roda em produção.
   */
  async guardar(anexoId: string, bytes: ArrayBuffer): Promise<{ fatias: number }> {
    await this.db.exec('DELETE FROM anexos_conteudo WHERE anexo_id = ?', [anexoId])
    const todos = new Uint8Array(bytes)
    let ordem = 0
    for (let i = 0; i < todos.length; i += FATIA_ANEXO_BYTES) {
      await this.db.exec('INSERT INTO anexos_conteudo (anexo_id, ordem, dados) VALUES (?, ?, ?)', [
        anexoId,
        ordem,
        paraBase64(todos.subarray(i, Math.min(i + FATIA_ANEXO_BYTES, todos.length))),
      ])
      ordem += 1
    }
    return { fatias: ordem }
  }

  /**
   * Os arquivos de uma chave, com bytes — **sempre** com o e-mail no `WHERE` (`RF-30`).
   *
   * Só devolve o que ainda não foi materializado: arquivo que já entrou no chamado não
   * pode ser reenviado numa retentativa, senão apareceria duas vezes lá dentro.
   */
  async lerDaChave(
    chaveIdempotencia: string,
    solicitanteEmail: string,
  ): Promise<readonly ArquivoGuardado[]> {
    const linhas = linhasComoObjetos<{
      id?: unknown
      nome_arquivo?: unknown
      tipo_arquivo?: unknown
    }>(
      await this.db.query(
        `SELECT id, nome_arquivo, tipo_arquivo FROM anexos_pendentes
          WHERE chave_idempotencia = ? AND solicitante_email = ? AND materializado_em IS NULL
          ORDER BY criado_em`,
        [chaveIdempotencia, solicitanteEmail],
      ),
    )

    const arquivos: ArquivoGuardado[] = []
    for (const linha of linhas) {
      const anexoId = String(linha.id ?? '')
      if (anexoId === '') continue
      const fatias = linhasComoObjetos<{ dados?: unknown }>(
        await this.db.query(
          'SELECT dados FROM anexos_conteudo WHERE anexo_id = ? ORDER BY ordem',
          [anexoId],
        ),
      )
      // ⚠️ Sem fatia nenhuma o arquivo **não** entra na lista como vazio: quem chama
      // precisa distinguir "não tenho os bytes" de "tenho um arquivo de zero byte", e o
      // segundo não existe (o upload recusa arquivo vazio).
      if (fatias.length === 0) continue
      const partes = fatias.map((f) => deBase64(String(f.dados ?? '')))
      const total = partes.reduce((s, p) => s + p.length, 0)
      const inteiro = new Uint8Array(total)
      let off = 0
      for (const p of partes) {
        inteiro.set(p, off)
        off += p.length
      }
      arquivos.push({
        anexoId,
        nomeArquivo: String(linha.nome_arquivo ?? ''),
        tipoArquivo: String(linha.tipo_arquivo ?? '') || 'application/octet-stream',
        bytes: inteiro.buffer as ArrayBuffer,
      })
    }
    return arquivos
  }

  /** Depois que o arquivo entrou no chamado, guardar os bytes é custo puro (`D-17`). */
  async apagar(anexoId: string): Promise<void> {
    await this.db.exec('DELETE FROM anexos_conteudo WHERE anexo_id = ?', [anexoId])
  }

  /**
   * Expurgo: pega carona no mesmo cron do outbox que limpa `anexos_pendentes` (T-415).
   *
   * ⚠️ Apaga o que **não tem mais dono** — fatia cujo `anexo_id` sumiu de
   * `anexos_pendentes`. Assim a ordem entre os dois expurgos não importa, e uma falha no
   * meio nunca deixa bytes órfãos para sempre.
   */
  async expurgarOrfaos(): Promise<number> {
    // ⚠️ **Conta com um `SELECT`, não com `rowsWritten`.** O shim de teste devolve
    // `rowsWritten: 0` para todo `exec` **sem parâmetros** (`sqlite-local.ts`), e a
    // plataforma nunca foi medida nesse ponto — família de `linhasComoObjetos`. Um número
    // que sai zero por acidente vira "o expurgo não apagou nada" no registro do cron, e
    // ninguém desconfia de zero. Uma ida a mais ao banco, num cron, é barata (`RNF-36`).
    const quantos = Number(
      linhasComoObjetos<{ n?: unknown }>(
        await this.db.query(
          `SELECT COUNT(*) AS n FROM anexos_conteudo
            WHERE anexo_id NOT IN (SELECT id FROM anexos_pendentes)`,
          [],
        ),
      )[0]?.n ?? 0,
    )
    if (quantos === 0) return 0
    await this.db.exec(
      `DELETE FROM anexos_conteudo
        WHERE anexo_id NOT IN (SELECT id FROM anexos_pendentes)`,
      [],
    )
    return quantos
  }
}
