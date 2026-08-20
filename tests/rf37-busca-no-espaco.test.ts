/**
 * Busca escopada num espaço — `RF-37`, `RF-39`, `RN-06`, `RF-42`.
 *
 * ## Por que este parâmetro existe
 *
 * O bloco `livesearch` do Confluence é uma **caixa de busca do espaço**. Diferente dos
 * outros blocos dinâmicos, ele não é um *resultado* a reproduzir: é um caminho, e busca é o
 * que o atlas já faz melhor que o Confluence para este público (sem assento, com allowlist
 * no servidor, registrando lacuna de documentação). Para o bloco funcionar, a busca precisa
 * aceitar "só neste espaço".
 *
 * ## 🚨 E é justamente aí que ele pode virar furo
 *
 * A regra do projeto é **"a allowlist nunca vem do cliente"** — `?espacos=` sempre foi
 * ignorado na busca, porque quem consulta não escolhe o próprio escopo: um `?espacos=RH`
 * respeitado seria o caminho mais curto para o espaço do RH.
 *
 * `?espaco=` só é seguro porque **estreita**: é interseção com `ctx.valores`, nunca
 * substituição. Os testes de burla aqui provam as duas metades — que ele filtra de verdade
 * (senão não serve para nada) e que **não amplia** (senão é `RN-06` furado).
 *
 * ## A armadilha silenciosa, que não é de segurança
 *
 * Escopo que sobra vazio devolve zero resultados. Sem cuidado, esse zero entraria no mapa de
 * lacunas de `RF-42` como "procuraram e não existe" — envenenando o backlog de escrita com
 * termos que **nunca foram procuráveis**, e mandando alguém escrever página para um espaço
 * que o app não expõe. É a mesma distinção que `buscaConfigurada` já fazia: zero por escopo
 * ≠ zero por documentação.
 *
 * _Requirements: RF-37, RF-39, RF-42, RN-06, RNF-07_
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
const CHEFE = 'chefe@gocase.com'
const AGORA = '2026-08-10T12:00:00.000Z'

let db: SqliteLocal
let ctx: Contexto
let fake: ClienteAtlassianFake
let n = 0

beforeEach(async () => {
  db = new SqliteLocal()
  await migrar(db)
  n = 0
  const config = new Config(db)
  await config.definir('dominios_permitidos', ['gocase.com'], CHEFE, AGORA)
  await config.definir('admins', [CHEFE], CHEFE, AGORA)
  await config.definir('espacos_confluence', ['GT', 'DTE'], CHEFE, AGORA)
  ctx = await montarContexto(
    { DB: db, ATLAS_USAR_FAKES: '1' },
    () => AGORA,
    () => `id-${++n}`,
  )
  fake = ctx.atlassian as ClienteAtlassianFake
  // ⚠️ O fake ignora o TERMO por padrão e devolve as páginas dos espaços permitidos — é o
  // que faz este teste afirmar sobre a REGRA de escopo, não sobre casamento de texto.
  fake.estado.paginas = [
    { id: 'p-gt', titulo: 'Reprocessar relatório', espaco: 'GT', url: 'https://x/1', score: 0.9, trecho: 'a', labels: [] },
    { id: 'p-dte', titulo: 'Padrão de nomes', espaco: 'DTE', url: 'https://x/2', score: 0.8, trecho: 'b', labels: [] },
    { id: 'p-rh', titulo: 'Tabela de salários', espaco: 'RH', url: 'https://x/3', score: 0.7, trecho: 'c', labels: [] },
  ]
})

async function buscar(query: string) {
  const r = await tratarRequisicao(
    new Request(`https://atlas.devgogroup.com/api/confluence/busca?${query}`, {
      headers: { [HEADER_EMAIL]: ANA },
    }),
    ctx,
    {},
  )
  return { status: r.status, corpo: (await r.json()) as { itens: { id: string; espaco: string }[] } }
}

async function lacunasRegistradas() {
  const r = await db.query(
    `SELECT detalhe_json FROM auditoria
      WHERE acao = 'busca_confluence' AND resultado = 'falha'`,
    [],
  )
  return linhasComoObjetos<{ detalhe_json: string }>(r).filter(
    (l) => JSON.parse(l.detalhe_json ?? '{}').lacunaDocumentacao === true,
  )
}

describe('o escopo ESTREITA de verdade', () => {
  it('sem `espaco`, busca nos dois espaços permitidos', async () => {
    const { corpo } = await buscar('q=relatorio')
    expect(corpo.itens.map((i) => i.espaco).sort()).toEqual(['DTE', 'GT'])
  })

  it('com `espaco=GT`, só GT — é isto que faz o bloco de busca servir', async () => {
    const { corpo } = await buscar('q=relatorio&espaco=GT')
    expect(corpo.itens.map((i) => i.id)).toEqual(['p-gt'])
  })

  it('a chamada à camada isolada recebe SÓ o espaço pedido', async () => {
    await buscar('q=relatorio&espaco=DTE')
    const busca = fake.chamadas.find((c) => c.operacao === 'buscarConfluence')
    expect((busca?.params as { espacosPermitidos: string[] }).espacosPermitidos).toEqual(['DTE'])
  })
})

describe('🚨 BURLA — o escopo do cliente não AMPLIA nada', () => {
  it('`espaco=RH` (fora da allowlist) devolve vazio, nunca o espaço do RH', async () => {
    const { status, corpo } = await buscar('q=salario&espaco=RH')
    expect(status).toBe(200)
    expect(corpo.itens).toEqual([])
    // A prova do lado de baixo: a camada isolada recebeu lista VAZIA, então nem teve como
    // montar query no espaço do RH. Se `?espaco=` substituísse a allowlist, aqui viria
    // `['RH']` e a página de salários sairia na tela.
    const busca = fake.chamadas.find((c) => c.operacao === 'buscarConfluence')
    expect((busca?.params as { espacosPermitidos: string[] }).espacosPermitidos).toEqual([])
  })

  it('espaço inexistente também não vira "busca em tudo"', async () => {
    // ⚠️ Ignorar o filtro quando ele não casa seria transformar "buscar só aqui" em
    // "buscar em tudo" — o oposto do que quem clicou pediu, e um jeito de descobrir
    // conteúdo de outro espaço por acidente.
    const { corpo } = await buscar('q=relatorio&espaco=NAOEXISTE')
    expect(corpo.itens).toEqual([])
  })

  it('`espaco` vazio é o mesmo que não pedir escopo', async () => {
    const { corpo } = await buscar('q=relatorio&espaco=')
    expect(corpo.itens.map((i) => i.espaco).sort()).toEqual(['DTE', 'GT'])
  })
})

describe('RF-42 — zero por ESCOPO não envenena o mapa de lacunas', () => {
  it('escopo inválido não registra lacuna de documentação', async () => {
    await buscar('q=termo-que-ninguem-documentou&espaco=RH')
    // Registrar aqui mandaria alguém escrever página para um espaço que o app não expõe.
    expect(await lacunasRegistradas()).toHaveLength(0)
  })

  it('mas zero num escopo VÁLIDO continua sendo lacuna', async () => {
    fake.estado.paginas = []
    await buscar('q=termo-sem-resposta&espaco=GT')
    // Aqui havia onde procurar e não achou: é backlog de escrita de verdade.
    expect(await lacunasRegistradas()).toHaveLength(1)
  })

  it('e a busca com escopo inválido não gera `buscaId` — não houve busca a atribuir', async () => {
    const r = await tratarRequisicao(
      new Request('https://atlas.devgogroup.com/api/confluence/busca?q=abc&espaco=RH', {
        headers: { [HEADER_EMAIL]: ANA },
      }),
      ctx,
      {},
    )
    const corpo = (await r.json()) as { buscaId: string | null }
    // `buscaId` é o que marca "resultado que ninguém abriu" (RF-42). Sem busca real, ele
    // criaria uma linha que nunca poderia ser clicada.
    expect(corpo.buscaId).toBeNull()
  })
})
