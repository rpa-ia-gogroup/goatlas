/**
 * **`T-621`/`T-634`/`T-636`** — a persistência da análise, e o mapa que a auditoria lê.
 *
 * O que se trava aqui:
 *
 * - **`FR-2` vem da CONSTRAINT** (`UNIQUE (conversa_id, nome_arquivo)`), não de um `SELECT`
 *   antes do `INSERT`: dois uploads simultâneos do mesmo nome disputam e um perde.
 * - **Não existe leitura sem e-mail** (`RF-30`): e-mail de outra pessoa devolve lista vazia.
 * - **O mapa 6 estados → 3 ações de auditoria** existe num lugar só (achado `F3`).
 *
 * _Requirements: FR-2, FR-5b, FR-10, RF-30_
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { SqliteLocal } from '@/lib/db/sqlite-local'
import { migrar } from '@/lib/db/schema'
import {
  AnalisesDeAnexo,
  acaoDeAuditoriaDaAnalise,
  analiseConcluida,
  analiseVaiParaConversa,
  type EstadoAnalise,
} from '@/lib/tickets/analises-anexo'

const EU = 'ana@gocase.com'
const CONVERSA = 'conv-1'

describe('uma análise por arquivo, pela constraint (T-621)', () => {
  let analises: AnalisesDeAnexo

  beforeEach(async () => {
    const db = new SqliteLocal()
    await migrar(db)
    analises = new AnalisesDeAnexo(db)
  })

  it('abre a linha como `analisando` — antes de qualquer chamada de rede', async () => {
    expect(
      await analises.abrir({
        id: 'a1',
        conversaId: CONVERSA,
        solicitanteEmail: EU,
        nomeArquivo: 'image.png',
      }),
    ).toBe(true)

    const [linha] = await analises.listarDaConversa(CONVERSA, EU)
    expect(linha).toMatchObject({ nomeArquivo: 'image.png', estado: 'analisando' })
    expect(analiseConcluida(linha!.estado)).toBe(false)
  })

  it('🚨 o segundo `abrir` do mesmo arquivo devolve false — e não há duas linhas', async () => {
    await analises.abrir({ id: 'a1', conversaId: CONVERSA, solicitanteEmail: EU, nomeArquivo: 'x.png' })
    const segundo = await analises.abrir({
      id: 'a2',
      conversaId: CONVERSA,
      solicitanteEmail: EU,
      nomeArquivo: 'x.png',
    })
    expect(segundo, 'quem recebe false NÃO analisa').toBe(false)
    expect(await analises.contarDaConversa(CONVERSA)).toBe(1)
  })

  it('🚨 duas aberturas CONCORRENTES: uma só ganha (a corrida que o SELECT não cobre)', async () => {
    // O `SELECT` antes do `INSERT` evita a chamada no caso comum; o que fecha a janela é a
    // constraint. Aqui as duas partem juntas, então as duas passam pelo SELECT.
    const [a, b] = await Promise.all([
      analises.abrir({ id: 'a1', conversaId: CONVERSA, solicitanteEmail: EU, nomeArquivo: 'p.png' }),
      analises.abrir({ id: 'a2', conversaId: CONVERSA, solicitanteEmail: EU, nomeArquivo: 'p.png' }),
    ])
    expect([a, b].filter(Boolean)).toHaveLength(1)
    expect(await analises.contarDaConversa(CONVERSA)).toBe(1)
  })

  it('mesmo nome em conversa DIFERENTE é outra análise — `image.png` é o nome de todo print', async () => {
    await analises.abrir({ id: 'a1', conversaId: 'conv-1', solicitanteEmail: EU, nomeArquivo: 'image.png' })
    expect(
      await analises.abrir({
        id: 'a2',
        conversaId: 'conv-2',
        solicitanteEmail: EU,
        nomeArquivo: 'image.png',
      }),
    ).toBe(true)
  })

  it('concluir grava estado e descrição, e não lança nunca', async () => {
    await analises.abrir({ id: 'a1', conversaId: CONVERSA, solicitanteEmail: EU, nomeArquivo: 'x.png' })
    await analises.concluir({
      conversaId: CONVERSA,
      nomeArquivo: 'x.png',
      estado: 'pronta',
      descricao: 'erro PIPELINE_TIMEOUT na tela',
      custoUsd: 0.001,
    })
    const [linha] = await analises.listarDaConversa(CONVERSA, EU)
    expect(linha).toMatchObject({ estado: 'pronta', descricao: 'erro PIPELINE_TIMEOUT na tela' })
    expect(linha!.concluidoEm).not.toBeNull()

    // Conversa que não existe: sem linha para atualizar, e sem exceção.
    await expect(
      analises.concluir({ conversaId: 'nao-existe', nomeArquivo: 'y.png', estado: 'falhou' }),
    ).resolves.toBeUndefined()
  })

  it('🚨 e-mail de outra pessoa não lê nada (RF-30, filtro no WHERE)', async () => {
    await analises.abrir({ id: 'a1', conversaId: CONVERSA, solicitanteEmail: EU, nomeArquivo: 'x.png' })
    expect(await analises.listarDaConversa(CONVERSA, 'outra@gocase.com')).toEqual([])
  })
})

describe('o que vai para a conversa, e o que fica só no chamado (FR-5b)', () => {
  const base = { id: 'a', nomeArquivo: 'x.png', criadoEm: 'agora', concluidoEm: 'agora' }

  it('`pronta` com descrição vai; `irrelevante` NÃO vai', () => {
    expect(analiseVaiParaConversa({ ...base, estado: 'pronta', descricao: 'erro X' })).toBe(true)
    // A descrição existe (vai ao chamado no fim), mas a tela não diz nada sobre ela.
    expect(analiseVaiParaConversa({ ...base, estado: 'irrelevante', descricao: 'crachá' })).toBe(
      false,
    )
  })

  it('`pronta` sem descrição não vai — linha vazia na conversa é pior que silêncio', () => {
    expect(analiseVaiParaConversa({ ...base, estado: 'pronta', descricao: null })).toBe(false)
  })
})

describe('o mapa dos seis estados para as três ações de auditoria (T-634)', () => {
  it('cada estado tem uma ação, e as três ações são distintas', () => {
    const esperado: Record<EstadoAnalise, string> = {
      pronta: 'anexo_analisado',
      irrelevante: 'anexo_analisado',
      tipo_nao_suportado: 'anexo_nao_lido',
      falhou: 'anexo_nao_lido',
      sem_conteudo: 'anexo_leitura_indefinida',
      analisando: 'anexo_leitura_indefinida',
    }
    for (const [estado, acao] of Object.entries(esperado)) {
      expect(acaoDeAuditoriaDaAnalise(estado as EstadoAnalise), estado).toBe(acao)
    }
    expect(new Set(Object.values(esperado)).size).toBe(3)
  })
})
