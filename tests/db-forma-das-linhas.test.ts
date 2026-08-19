/**
 * 🚨 O bug que 610 testes verdes não pegaram — e o teste que faltava.
 *
 * ## O que aconteceu
 *
 * Medido em produção em 07/08/2026: o `env.DB` do GoDeploy devolve `rows` como **array de
 * objetos** (`{ id: 'x', acao: 'login' }`). O shim de teste (`sqlite-local.ts`) devolve a
 * forma **documentada**: `columns` + array de valores por linha.
 *
 * `linhasComoObjetos` só entendia a segunda. Contra a primeira ela fazia `linha[i]` com `i`
 * numérico sobre um objeto — `undefined` em todos os campos, para todas as linhas, em
 * **toda leitura do banco do app**.
 *
 * ## Por que passou
 *
 * O sintoma não era erro, era `{}`. A auditoria devolvia 58 registros sem campo nenhum, a
 * lista de chamados vinha vazia, a config caía nos defaults — e como os defaults vêm do
 * bootstrap por env, o app **parecia funcionar**. Nenhum teste falhava porque todos rodam
 * contra o shim, que implementa a forma que a plataforma não usa.
 *
 * ## O que este arquivo tranca
 *
 * `linhasComoObjetos` e `primeiraLinha` funcionando nas **duas** formas, com o mesmo
 * resultado. Um dublê que só imita uma delas testa a intenção, não a garantia — é a mesma
 * lição de `sqlite-local.ts` usar SQLite real em vez de um `Map`.
 *
 * _Requirements: RNF-19 (leitura degrada sem derrubar), Princípio VIII_
 */

import { describe, expect, it } from 'vitest'
import { linhasComoObjetos, primeiraLinha, type ResultadoQuery } from '@/lib/db/tipos'

/** Como o shim de teste (e a documentação da plataforma) devolve. */
const FORMA_DOCUMENTADA: ResultadoQuery = {
  columns: ['issue_key', 'solicitante_email', 'verificado_regras'],
  rows: [
    ['ATLAS-1', 'ana@gocase.com', 1],
    ['ATLAS-2', 'bruno@gocase.com', 0],
  ],
  rowsRead: 2,
}

/** Como o `env.DB` do GoDeploy devolve DE VERDADE. */
const FORMA_DA_PLATAFORMA: ResultadoQuery = {
  columns: ['issue_key', 'solicitante_email', 'verificado_regras'],
  rows: [
    { issue_key: 'ATLAS-1', solicitante_email: 'ana@gocase.com', verificado_regras: 1 },
    { issue_key: 'ATLAS-2', solicitante_email: 'bruno@gocase.com', verificado_regras: 0 },
  ],
  rowsRead: 2,
}

const ESPERADO = [
  { issue_key: 'ATLAS-1', solicitante_email: 'ana@gocase.com', verificado_regras: 1 },
  { issue_key: 'ATLAS-2', solicitante_email: 'bruno@gocase.com', verificado_regras: 0 },
]

describe('linhasComoObjetos entende as DUAS formas de `rows`', () => {
  it('forma documentada: colunas + array de valores', () => {
    expect(linhasComoObjetos(FORMA_DOCUMENTADA)).toEqual(ESPERADO)
  })

  it('forma da plataforma: array de objetos', () => {
    // ⚠️ É este caso que estava quebrado. Antes da correção, o resultado era
    // `[{issue_key: undefined, ...}, ...]` — que serializa como `{}` e não levanta erro.
    expect(linhasComoObjetos(FORMA_DA_PLATAFORMA)).toEqual(ESPERADO)
  })

  it('as duas formas produzem o MESMO resultado — é isso que quem chama assume', () => {
    expect(linhasComoObjetos(FORMA_DA_PLATAFORMA)).toEqual(
      linhasComoObjetos(FORMA_DOCUMENTADA),
    )
  })

  it('nenhum campo vira `undefined` em silêncio', () => {
    // O teste que teria pegado o bug: a falha não era exceção, era campo ausente.
    for (const forma of [FORMA_DOCUMENTADA, FORMA_DA_PLATAFORMA]) {
      for (const linha of linhasComoObjetos<Record<string, unknown>>(forma)) {
        expect(Object.keys(linha).length).toBeGreaterThan(0)
        for (const valor of Object.values(linha)) {
          expect(valor).not.toBeUndefined()
        }
      }
    }
  })

  it('resultado vazio devolve lista vazia nas duas formas, sem explodir', () => {
    expect(linhasComoObjetos({ columns: [], rows: [] })).toEqual([])
    expect(linhasComoObjetos({ columns: ['a'], rows: [] })).toEqual([])
  })

  it('`COUNT(*)` funciona nas duas — é o formato mais usado no app', () => {
    expect(linhasComoObjetos<{ n: number }>({ columns: ['n'], rows: [[7]] })[0]?.n).toBe(7)
    expect(linhasComoObjetos<{ n: number }>({ columns: ['n'], rows: [{ n: 7 }] })[0]?.n).toBe(7)
  })

  it('`null` de coluna anulável continua `null`, não vira `undefined`', () => {
    // Importa porque o app distingue os dois: `area: null` é "sem área" (T-303) e
    // `undefined` seria "campo não veio".
    expect(
      linhasComoObjetos<{ area: string | null }>({ columns: ['area'], rows: [[null]] })[0]?.area,
    ).toBeNull()
    expect(
      linhasComoObjetos<{ area: string | null }>({ columns: ['area'], rows: [{ area: null }] })[0]
        ?.area,
    ).toBeNull()
  })
})

describe('primeiraLinha herda a tolerância', () => {
  it('devolve a primeira linha nas duas formas', () => {
    expect(primeiraLinha(FORMA_DOCUMENTADA)).toEqual(ESPERADO[0])
    expect(primeiraLinha(FORMA_DA_PLATAFORMA)).toEqual(ESPERADO[0])
  })

  it('sem linhas, `null` — e é disso que dependem os gates de isolamento', () => {
    // `obterDoSolicitante` devolve `null` quando não há vínculo, e é `null` que vira 404
    // em `RF-30`. Um `{}` aqui viraria "achei um vínculo vazio" e passaria o gate.
    expect(primeiraLinha({ columns: ['a'], rows: [] })).toBeNull()
  })
})
