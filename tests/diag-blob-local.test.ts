/**
 * Prova que o instrumento de `blob-no-banco.ts` funciona — e SÓ isso.
 *
 * ⚠️ **Verde aqui não responde a pergunta.** O `node:sqlite` é SQLite de verdade e engole
 * 8 MB sem reclamar; quem tem de responder é a plataforma (`D-73`, `linhasComoObjetos`).
 * Este caso existe para o resultado medido na staging significar "a plataforma recusou",
 * nunca "o medidor está quebrado".
 */
import { describe, expect, it } from 'vitest'

import {
  conferirArquivoPersistido,
  gravarArquivoPersistido,
  medirBlobNoBanco,
} from '../src/lib/diagnostico/blob-no-banco'
import { SqliteLocal } from '../src/lib/db/sqlite-local'

describe('medidor de blob', () => {
  it('grava, lê e confere a integridade em 1 MB, nas duas estratégias', async () => {
    const db = new SqliteLocal()
    const r = await medirBlobNoBanco(db, { tamanhosMb: [1] })

    expect(r.itens).toHaveLength(2)
    for (const item of r.itens) {
      expect(item.erro).toBeNull()
      expect(item.integro).toBe(true)
      expect(item.bytesQueVoltaram).toBe(1024 * 1024)
    }
    expect(r.maiorLinhaUnicaOkMb).toBe(1)
    expect(r.maiorFatiadoOkMb).toBe(1)
  })

  it('o par persistente devolve o mesmo arquivo, e some depois de conferido', async () => {
    const db = new SqliteLocal()
    const gravou = await gravarArquivoPersistido(db, { id: 'p1', tamanhoMb: 1, fatiaKb: 512 })
    expect(gravou.fatias).toBe(2)

    const primeira = await conferirArquivoPersistido(db, 'p1')
    expect(primeira).toMatchObject({ achou: true, integro: true, bytes: 1024 * 1024 })

    // Conferir apaga: a segunda leitura não acha, e "não achou" nunca vira "íntegro".
    const segunda = await conferirArquivoPersistido(db, 'p1')
    expect(segunda.achou).toBe(false)
    expect(segunda.integro).toBe(false)
  })

  it('acusa corrupção em vez de dizer que deu certo', async () => {
    const db = new SqliteLocal()
    // Um banco que devolve o conteúdo trocado é o cenário silencioso que o SHA existe para
    // pegar: tamanho plausível, valor errado.
    const adulterado = {
      query: async (sql: string, params: readonly unknown[]) => {
        const r = await db.query(sql, params)
        if (!sql.includes('dados')) return r
        return {
          ...r,
          rows: r.rows.map(() => ({ ordem: 0, dados: btoa('outra coisa') })),
        }
      },
      exec: db.exec.bind(db),
    }

    const r = await medirBlobNoBanco(adulterado, { tamanhosMb: [0.0625], fatiar: false })
    expect(r.itens[0]?.integro).toBe(false)
    expect(r.itens[0]?.erro).toContain('não confere')
    expect(r.maiorLinhaUnicaOkMb).toBeNull()
  })
})
