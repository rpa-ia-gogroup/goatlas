/**
 * **T-116 + T-117** — o mapa das lacunas de documentação (`RF-42`).
 *
 * ## A ideia, e por que ela é maior que "buscas sem resultado"
 *
 * `RF-42` fala em buscas **sem resultado útil**. Duas coisas diferentes caem aí:
 *
 * 1. **Zero resultados** — não existe documentação para aquele termo.
 * 2. **Resultados que ninguém abriu** — existe documentação, e ela não convence. Esse
 *    caso é invisível em qualquer contagem de "buscas vazias", e é o mais interessante:
 *    a página existe, aparece na busca, e a pessoa olhou o título e seguiu para o
 *    chamado.
 *
 * Some-se a isso o **override** de bloqueio da Fase 1, que já traz a frase da pessoa
 * dizendo o que a documentação não resolveu. Os três juntos são o backlog.
 *
 * ## O que este arquivo cobra
 *
 * - O clique é atribuído à busca **da própria pessoa** — o `?de=` vem do cliente.
 * - O mapa é **agregado**: ele conta pessoas, não as nomeia. O mapa é sobre
 *   documentação; transformá-lo em lista de quem insistiu convida a cobrar gente em vez
 *   de escrever página.
 * - Só admin alcança o mapa.
 *
 * _Requirements: RF-42, RF-58, RN-09, RNF-04_
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { SqliteLocal } from '@/lib/db/sqlite-local'
import { migrar } from '@/lib/db/schema'
import { Config } from '@/lib/config'
import { montarContexto, type Contexto } from '@/lib/contexto'
import { tratarRequisicao } from '@/lib/http/rotas'
import { HEADER_EMAIL } from '@/lib/auth'
import { ClienteAtlassianFake } from '@/lib/atlassian/fake'
import { linhasComoObjetos } from '@/lib/db/tipos'

const ANA = 'ana@gocase.com'
const BRUNO = 'bruno@gocase.com'
const CHEFE = 'chefe@gocase.com'
const AGORA = '2026-08-04T12:00:00.000Z'

let db: SqliteLocal
let ctx: Contexto
let fake: ClienteAtlassianFake
let n = 0

async function montar(espacos: readonly string[] = ['TECH']): Promise<void> {
  db = new SqliteLocal()
  await migrar(db)
  const config = new Config(db)
  await config.definir('dominios_permitidos', ['gocase.com'], CHEFE, AGORA)
  await config.definir('admins', [CHEFE], CHEFE, AGORA)
  await config.definir('espacos_confluence', [...espacos], CHEFE, AGORA)
  ctx = await montarContexto(
    { DB: db, GOATLAS_USAR_FAKES: '1' },
    () => AGORA,
    () => `id-${++n}`,
  )
  fake = ctx.atlassian as ClienteAtlassianFake
  fake.estado.paginas = [
    {
      id: 'p1',
      titulo: 'Como reprocessar o relatório',
      espaco: 'TECH',
      url: 'https://exemplo.invalid/wiki/p1',
      score: 0.9,
      trecho: 'rode a rotina manual',
      labels: [],
    },
  ]
  fake.estado.conteudoPaginas.set('p1', {
    titulo: 'Como reprocessar o relatório',
    espaco: 'TECH',
    labels: [],
    storage: '<p>rode a rotina</p>',
  })
}

beforeEach(async () => {
  n = 0
  await montar()
})

function pedir(caminho: string, email: string | null): Promise<Response> {
  const headers: Record<string, string> = {}
  if (email) headers[HEADER_EMAIL] = email
  return tratarRequisicao(
    new Request(`https://goatlas.devgogroup.com${caminho}`, { headers }),
    ctx,
    {},
  )
}

const buscar = (termo: string, email = ANA) =>
  pedir(`/api/confluence/busca?q=${encodeURIComponent(termo)}`, email)
const ler = (id: string, de?: string, email = ANA) =>
  pedir(`/api/confluence/pagina/${id}${de ? `?de=${encodeURIComponent(de)}` : ''}`, email)
const mapa = (email: string | null = CHEFE) => pedir('/api/admin/lacunas', email)

const linhasDe = async (sql: string) =>
  linhasComoObjetos<Record<string, unknown>>(await db.query(sql, []))

describe('T-116 — a busca e a leitura ficam registradas em tabela própria', () => {
  it('a busca grava termo, nº de resultados e "ninguém clicou" ainda', async () => {
    const corpo = await (await buscar('reprocessar')).json()
    // O id volta para a tela: é ele que amarra o clique à busca que o originou.
    expect(typeof corpo.buscaId).toBe('string')

    const [linha] = await linhasDe('SELECT * FROM buscas')
    expect(linha?.termo).toBe('reprocessar')
    expect(linha?.resultados).toBe(1)
    expect(linha?.houve_clique).toBe(0)
    expect(linha?.solicitante_email).toBe(ANA)
  })

  it('a leitura grava a página lida, com título e espaço', async () => {
    await ler('p1')
    const [linha] = await linhasDe('SELECT * FROM paginas_lidas')
    expect(linha?.pagina_id).toBe('p1')
    expect(linha?.espaco).toBe('TECH')
    expect(linha?.via).toBe('direto')
  })

  it('abrir a página vinda da busca marca o clique', async () => {
    const { buscaId } = await (await buscar('reprocessar')).json()
    await ler('p1', buscaId)

    const [busca] = await linhasDe('SELECT houve_clique FROM buscas')
    expect(busca?.houve_clique).toBe(1)
    const [leitura] = await linhasDe('SELECT via FROM paginas_lidas')
    expect(leitura?.via).toBe('busca')
  })

  it('BURLA — `?de=` de busca de OUTRA pessoa não marca clique', async () => {
    // O `?de=` vem do cliente. O isolamento está no `WHERE` (id **e** e-mail), então o
    // pior caso de um id chutado é não acontecer nada — nunca marcar o de outro.
    const { buscaId } = await (await buscar('reprocessar', ANA)).json()
    await ler('p1', buscaId, BRUNO)

    const [busca] = await linhasDe('SELECT houve_clique FROM buscas')
    expect(busca?.houve_clique).toBe(0)
    // E a leitura do Bruno não vira "veio da busca" por causa disso.
    const leituras = await linhasDe(`SELECT via FROM paginas_lidas`)
    expect(leituras.map((l) => l.via)).toEqual(['direto'])
  })

  it('`?de=` inventado não derruba a leitura', async () => {
    const r = await ler('p1', 'nao-existe')
    expect(r.status).toBe(200)
  })

  it('sem espaço configurado, a busca NÃO é registrada', async () => {
    // Ela não chegou a procurar em lugar nenhum: registrar encheria o mapa de termos
    // que ninguém deixou de documentar (é o mesmo motivo de não registrar a lacuna).
    await montar([])
    await buscar('politica de home office')
    expect(await linhasDe('SELECT * FROM buscas')).toEqual([])
  })
})

describe('T-117 / RF-42 — o mapa junta os três sinais', () => {
  it('termo sem resultado aparece, agrupado e contado', async () => {
    fake.estado.filtrarPorTermo = true
    await buscar('politica de home office', ANA)
    await buscar('POLÍTICA DE HOME OFFICE', BRUNO)
    await buscar('politica de home office', ANA)

    const corpo = await (await mapa()).json()
    expect(corpo.semResultado).toHaveLength(1)
    const item = corpo.semResultado[0]
    // Agrupa sem diferenciar acento e caixa: são a mesma pergunta.
    expect(item.ocorrencias).toBe(3)
    expect(item.pessoas).toBe(2)
    expect(item.termo).toContain('home office')
  })

  it('resultado que NINGUÉM abriu é lacuna também', async () => {
    // A documentação existe, apareceu na busca, e não convenceu. Contagem de "buscas
    // vazias" nunca mostraria isso.
    await buscar('reprocessar', ANA)
    const corpo = await (await mapa()).json()
    expect(corpo.semResultado).toEqual([])
    expect(corpo.semClique).toHaveLength(1)
    expect(corpo.semClique[0].termo).toBe('reprocessar')
  })

  it('busca que virou leitura sai do mapa', async () => {
    const { buscaId } = await (await buscar('reprocessar')).json()
    await ler('p1', buscaId)
    const corpo = await (await mapa()).json()
    expect(corpo.semClique).toEqual([])
  })

  it('o override de bloqueio entra com o motivo escrito pela pessoa', async () => {
    // É o sinal mais rico do backlog: a frase de quem leu e disse que não resolveu.
    const conversa = await ctx.conversas.criar('c1', ANA)
    await ctx.conversas.registrarBloqueio(
      'b1',
      conversa.id,
      'regra1_confluence',
      'score alto',
      { paginas: [] },
    )
    await ctx.conversas.registrarOverride(conversa.id, 'a página fala de outro sistema')

    const corpo = await (await mapa()).json()
    expect(corpo.overrides).toHaveLength(1)
    expect(corpo.overrides[0].motivo).toBe('a página fala de outro sistema')
    expect(corpo.overrides[0].regra).toBe('regra1_confluence')
  })

  it('o mapa CONTA pessoas, não as nomeia', async () => {
    // Ele é sobre documentação. Nomear quem procurou transforma um backlog de escrita
    // numa lista de quem "não achou sozinho" — e o histórico por pessoa já existe na
    // auditoria, para investigação, que é outro propósito.
    fake.estado.filtrarPorTermo = true
    await buscar('politica de home office', ANA)
    await buscar('reprocessar', BRUNO)
    const bruto = await (await mapa()).text()
    expect(bruto).not.toContain(ANA)
    expect(bruto).not.toContain(BRUNO)
  })

  it('BURLA — colaborador não alcança o mapa', async () => {
    expect((await mapa(ANA)).status).toBe(403)
    expect((await mapa(null)).status).toBe(403)
  })

  it('sem dado nenhum, o mapa responde vazio — não erro', async () => {
    const r = await mapa()
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ semResultado: [], semClique: [], overrides: [] })
  })
})
