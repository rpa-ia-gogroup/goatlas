/**
 * **`D-41`** — a frase inteira não casa nada, e o app afirmava que não havia
 * documentação. `RF-37`, `RF-09`, `RF-42`, `RN-06`.
 *
 * ## O defeito, medido na staging em 12/08/2026
 *
 * A pessoa perguntou *"Preciso saber como funciona o processo de deploy aqui na
 * Gocase"*, o modelo mandou `processo de deploy na Gocase` como tópico, e a
 * auditoria gravou `encontradas: 0` **mais** `lacunaDocumentacao: true`. O agente
 * respondeu "não encontrei nenhuma página relevante" — e a **mesma** instalação,
 * buscando `deploy`, devolvia 10 páginas, uma delas "Conventional Deploys | Como
 * entregar para produção".
 *
 * São dois danos, e o segundo é silencioso: a pessoa é mandada abrir chamado por
 * algo que está escrito (o cenário mais caro do projeto, `D-33`), e o mapa de
 * lacunas de `RF-42` passa a conter um termo que ninguém deixou de documentar.
 *
 * ## O que estes testes afirmam
 *
 * Sobre o **CQL montado** e sobre a **contagem de consultas** — nunca sobre "achou
 * página". O fake ignora o termo por padrão (`filtrarPorTermo = false`), então um
 * teste que afirmasse "achou" passaria sem a correção existir.
 *
 * 🚨 E a asserção mais importante daqui é de segurança, não de qualidade: o grupo
 * `OR` da segunda tentativa vai **entre parênteses**. Em CQL o `AND` liga mais
 * forte que o `OR`, então `space in (...) AND text ~ "a" OR text ~ "b"` significa
 * `(space AND a) OR b` — a segunda palavra buscaria o site inteiro, e a allowlist
 * de `RN-06` teria sido contornada pela própria consulta que a aplica.
 *
 * _Requirements: RF-09, RF-37, RF-42, RN-06, RNF-07, R-02_
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { montarCql } from '@/lib/atlassian/cliente'
import {
  MAX_CONSULTAS_BUSCA,
  MAX_PALAVRAS_AMPLIACAO,
  buscarComAmpliacao,
  palavrasSignificativas,
} from '@/lib/confluence/busca'
import { ClienteAtlassianFake } from '@/lib/atlassian/fake'
import type { BuscaConfluenceParams, PaginaConfluence } from '@/lib/atlassian/tipos'
import { SqliteLocal } from '@/lib/db/sqlite-local'
import { migrar } from '@/lib/db/schema'
import { Config } from '@/lib/config'
import { montarContexto, type Contexto } from '@/lib/contexto'
import { tratarRequisicao } from '@/lib/http/rotas'
import { HEADER_EMAIL } from '@/lib/auth'
import { linhasComoObjetos } from '@/lib/db/tipos'

const ANA = 'ana@gocase.com'
const AGORA = '2026-08-12T12:00:00.000Z'

function pagina(over: Partial<PaginaConfluence>): PaginaConfluence {
  return {
    id: 'p',
    titulo: 'Título',
    espaco: 'GT',
    url: 'https://goengenharia.atlassian.net/wiki/x',
    score: 0.5,
    trecho: 'trecho de contexto',
    labels: [],
    ...over,
  }
}

describe('palavrasSignificativas — o que sobra da frase depois das palavras vazias', () => {
  it('a frase medida na staging vira as três palavras que importam', () => {
    expect(palavrasSignificativas('processo de deploy na Gocase')).toEqual([
      'processo',
      'deploy',
      'Gocase',
    ])
  })

  it('mantém o acento — CQL casa o texto como ele foi escrito', () => {
    expect(palavrasSignificativas('política de férias')).toEqual(['política', 'férias'])
  })

  it('a caixa da palavra é preservada, mas a comparação com a lista de vazias não', () => {
    expect(palavrasSignificativas('De Onde Vejo O Relatório')).toEqual(['Relatório'])
  })

  it('sigla de duas letras sobrevive — "GN", "TI" e "RH" são assunto, não ruído', () => {
    expect(palavrasSignificativas('acesso ao GN')).toEqual(['acesso', 'GN'])
  })

  it('frase feita só de palavras vazias não tem o que pesquisar', () => {
    expect(palavrasSignificativas('como faço isso aqui?')).toEqual([])
    expect(palavrasSignificativas('   ')).toEqual([])
  })

  it('repetição não vira duas palavras, e o número de palavras tem teto (R-02)', () => {
    expect(palavrasSignificativas('deploy deploy deploy')).toEqual(['deploy'])
    const longa = 'alpha beta gama delta epsilon zeta eta teta iota'
    expect(palavrasSignificativas(longa)).toHaveLength(MAX_PALAVRAS_AMPLIACAO)
  })

  it('pontuação e aspas somem na tokenização — antes mesmo do escape', () => {
    const palavras = palavrasSignificativas('deploy" OR space in ("RH')
    expect(palavras).toContain('deploy')
    expect(palavras).toContain('RH')
    // Nenhuma palavra carrega aspas ou parêntese: a injeção morre na tokenização,
    // antes de `escaparCql` — que continua sendo a garantia, não a primeira linha.
    expect(palavras.some((p) => /["()]/.test(p))).toBe(false)
  })
})

describe('montarCql — a segunda tentativa casa QUALQUER palavra, sem soltar a allowlist', () => {
  it('sem palavras alternativas, nada muda: continua a frase inteira', () => {
    const cql = montarCql({
      termo: 'processo de deploy',
      espacosPermitidos: ['GT'],
      labelsBloqueadas: [],
      limite: 5,
    })
    expect(cql).toBe('type = page AND space in ("GT") AND text ~ "processo de deploy"')
  })

  it('com palavras alternativas, o texto vira um OR entre elas', () => {
    const cql = montarCql({
      termo: 'processo de deploy na Gocase',
      espacosPermitidos: ['GT', 'DTE'],
      labelsBloqueadas: [],
      limite: 5,
      palavrasAlternativas: ['processo', 'deploy', 'Gocase'],
    })
    expect(cql).toContain('(text ~ "processo" OR text ~ "deploy" OR text ~ "Gocase")')
    expect(cql).toContain('space in ("GT", "DTE")')
    expect(cql).toContain('type = page')
    // A frase que não casou nada NÃO fica na consulta ampliada.
    expect(cql).not.toContain('text ~ "processo de deploy na Gocase"')
  })

  it('🚨 BURLA — o grupo OR é parentizado; sem isso a allowlist valeria só para a 1ª palavra', () => {
    const cql = montarCql({
      termo: 'x y',
      espacosPermitidos: ['GT'],
      labelsBloqueadas: ['confidencial'],
      limite: 5,
      palavrasAlternativas: ['alpha', 'beta'],
    })
    // Em CQL, `AND` liga mais forte que `OR`. Um `OR` solto ao lado de
    // `space in (...)` transformaria a cláusula da allowlist em opcional.
    expect(cql).toContain('AND (text ~ "alpha" OR text ~ "beta") AND')
    expect(cql).not.toMatch(/AND text ~ "alpha" OR text ~ "beta"/)
    // E a exclusão por label continua depois do grupo, valendo para tudo.
    expect(cql).toContain('label != "confidencial"')
  })

  it('BURLA — palavra alternativa maliciosa é escapada como qualquer outra entrada', () => {
    const cql = montarCql({
      termo: 'x y',
      espacosPermitidos: ['GT'],
      labelsBloqueadas: [],
      limite: 5,
      palavrasAlternativas: ['a") OR space in ("RH'],
    })
    expect(cql).not.toMatch(/space in \("GT"\) AND \(text ~ "a"\) OR space in \("RH"\)/)
    expect(cql).toContain('\\"')
  })

  it('lista de palavras vazia não produz grupo vazio — volta à frase', () => {
    const cql = montarCql({
      termo: 'deploy',
      espacosPermitidos: ['GT'],
      labelsBloqueadas: [],
      limite: 5,
      palavrasAlternativas: [],
    })
    expect(cql).toContain('text ~ "deploy"')
    expect(cql).not.toContain('()')
  })
})

describe('buscarComAmpliacao — no máximo DUAS consultas por busca (R-02)', () => {
  /** Camada de busca de mentira: só registra o que recebeu e devolve o roteiro. */
  function camada(respostas: readonly (readonly PaginaConfluence[])[]) {
    const recebidos: BuscaConfluenceParams[] = []
    let i = 0
    return {
      recebidos,
      cliente: {
        buscarConfluence: async (params: BuscaConfluenceParams) => {
          recebidos.push(params)
          return respostas[i++] ?? []
        },
      } as never,
    }
  }

  const base = {
    espacosPermitidos: ['GT'],
    labelsBloqueadas: [],
    limite: 5,
  }

  it('a frase que casa alguma coisa custa UMA consulta — precisão primeiro', async () => {
    const { cliente, recebidos } = camada([[pagina({ id: 'a' })]])
    const r = await buscarComAmpliacao(cliente, { ...base, termo: 'processo de deploy' })
    expect(r.paginas.map((p) => p.id)).toEqual(['a'])
    expect(r.ampliou).toBe(false)
    expect(r.consultas).toBe(1)
    expect(recebidos).toHaveLength(1)
    expect(recebidos[0]!.palavrasAlternativas).toBeUndefined()
  })

  it('a frase que casa ZERO tenta de novo com as palavras — e para por aí', async () => {
    const { cliente, recebidos } = camada([[], [pagina({ id: 'deploys' })]])
    const r = await buscarComAmpliacao(cliente, { ...base, termo: 'processo de deploy na Gocase' })
    expect(r.paginas.map((p) => p.id)).toEqual(['deploys'])
    expect(r.ampliou).toBe(true)
    expect(r.consultas).toBe(2)
    expect(r.consultas).toBeLessThanOrEqual(MAX_CONSULTAS_BUSCA)
    expect(recebidos).toHaveLength(2)
    // A primeira é a frase inteira; a segunda, as palavras significativas.
    expect(recebidos[0]!.termo).toBe('processo de deploy na Gocase')
    expect(recebidos[0]!.palavrasAlternativas).toBeUndefined()
    expect(recebidos[1]!.palavrasAlternativas).toEqual(['processo', 'deploy', 'Gocase'])
    // ⚠️ A ampliação NUNCA mexe no escopo: allowlist e labels vão idênticas.
    expect(recebidos[1]!.espacosPermitidos).toEqual(['GT'])
    expect(recebidos[1]!.labelsBloqueadas).toEqual([])
    expect(recebidos[1]!.limite).toBe(5)
  })

  it('a segunda tentativa também pode voltar vazia — e aí zero é zero mesmo', async () => {
    const { cliente } = camada([[], []])
    const r = await buscarComAmpliacao(cliente, { ...base, termo: 'assunto que ninguém escreveu' })
    expect(r.paginas).toEqual([])
    expect(r.ampliou).toBe(true)
    expect(r.palavras.length).toBeGreaterThan(0)
  })

  it('termo de UMA palavra não amplia — a segunda consulta seria a mesma consulta', async () => {
    const { cliente, recebidos } = camada([[], [pagina({ id: 'nunca' })]])
    const r = await buscarComAmpliacao(cliente, { ...base, termo: 'deploy' })
    expect(r.paginas).toEqual([])
    expect(r.ampliou).toBe(false)
    expect(recebidos).toHaveLength(1)
  })

  it('termo sem palavra significativa não amplia e se declara não pesquisável', async () => {
    const { cliente, recebidos } = camada([[], [pagina({ id: 'nunca' })]])
    const r = await buscarComAmpliacao(cliente, { ...base, termo: 'como faço isso?' })
    expect(r.palavras).toEqual([])
    expect(r.ampliou).toBe(false)
    expect(recebidos).toHaveLength(1)
  })
})

describe('a rota da busca (RF-37) amplia, e a auditoria mostra o que foi consultado', () => {
  let db: SqliteLocal
  let ctx: Contexto
  let fake: ClienteAtlassianFake
  let n = 0

  async function montar(): Promise<void> {
    db = new SqliteLocal()
    await migrar(db)
    const config = new Config(db)
    await config.definir('dominios_permitidos', ['gocase.com'], ANA, AGORA)
    await config.definir('espacos_confluence', ['GT'], ANA, AGORA)
    ctx = await montarContexto(
      { DB: db, GOATLAS_USAR_FAKES: '1' },
      () => AGORA,
      () => `id-${++n}`,
    )
    fake = ctx.atlassian as ClienteAtlassianFake
    // ⚠️ Ligado de propósito: é o único modo em que o fake distingue "a frase não
    // casou" de "casou". Com ele desligado (o padrão) a diferença some.
    fake.estado.filtrarPorTermo = true
    fake.estado.paginas = [
      pagina({ id: 'deploys', titulo: 'Conventional Deploys | Como entregar para produção', score: 0.8 }),
    ]
  }

  const buscar = (query: string): Promise<Response> =>
    tratarRequisicao(
      new Request(`https://goatlas.devgogroup.com/api/confluence/busca${query}`, {
        headers: { [HEADER_EMAIL]: ANA },
      }),
      ctx,
      {},
    )

  const auditoria = async () =>
    linhasComoObjetos<{ acao: string; recurso: string; resultado: string; detalhe_json: string }>(
      await db.query(
        `SELECT acao, recurso, resultado, detalhe_json FROM auditoria
          WHERE acao = 'busca_confluence' ORDER BY rowid`,
        [],
      ),
    )

  beforeEach(async () => {
    n = 0
    await montar()
  })

  it('a frase inteira acha a página que só a palavra achava antes', async () => {
    const r = await buscar('?q=processo%20de%20deploy%20na%20Gocase')
    expect(r.status).toBe(200)
    const corpo = await r.json()
    expect(corpo.itens.map((i: { id: string }) => i.id)).toEqual(['deploys'])
  })

  it('a auditoria registra o termo da PESSOA e, ao lado, o que foi consultado', async () => {
    await buscar('?q=processo%20de%20deploy%20na%20Gocase')
    const sucesso = (await auditoria()).find((l) => l.resultado === 'sucesso')!
    // O recurso continua sendo o que a pessoa escreveu — é ele que o mapa agrupa.
    expect(sucesso.recurso).toBe('processo de deploy na Gocase')
    const detalhe = JSON.parse(sucesso.detalhe_json)
    expect(detalhe.ampliou).toBe(true)
    expect(detalhe.consultado).toBe('processo deploy Gocase')
    expect(detalhe.encontradas).toBe(1)
  })

  it('sem ampliação a auditoria não inventa um "consultado" igual ao termo', async () => {
    await buscar('?q=Deploys')
    const sucesso = (await auditoria()).find((l) => l.resultado === 'sucesso')!
    const detalhe = JSON.parse(sucesso.detalhe_json)
    expect(detalhe.ampliou).toBe(false)
    expect(detalhe.consultado).toBeUndefined()
  })

  it('🚨 zero por TERMO sem palavra significativa não é lacuna de documentação (RF-42)', async () => {
    const r = await buscar('?q=como%20fa%C3%A7o%20isso')
    expect(r.status).toBe(200)
    const corpo = await r.json()
    expect(corpo.itens).toEqual([])

    const linhas = await auditoria()
    const falha = linhas.find((l) => l.resultado === 'falha')!
    const detalhe = JSON.parse(falha.detalhe_json)
    expect(detalhe.motivo).toBe('termo_sem_palavras_significativas')
    expect(detalhe.lacunaDocumentacao).toBe(false)

    // E o mapa de `RF-42` lê a tabela `buscas`, não a auditoria: se a linha entrasse
    // ali, alguém receberia "escreva uma página sobre 'como faço isso'".
    const buscas = await db.query(`SELECT termo FROM buscas`, [])
    expect(linhasComoObjetos(buscas)).toEqual([])
    expect(corpo.buscaId).toBeNull()
  })

  it('zero com termo pesquisável CONTINUA sendo lacuna — a distinção é o termo, não o zero', async () => {
    await buscar('?q=processo%20de%20f%C3%A9rias%20remuneradas')
    const falha = (await auditoria()).find((l) => l.resultado === 'falha')!
    const detalhe = JSON.parse(falha.detalhe_json)
    expect(detalhe.motivo).toBe('sem_resultado_util')
    expect(detalhe.lacunaDocumentacao).toBe(true)
    expect(linhasComoObjetos(await db.query(`SELECT termo FROM buscas`, []))).toHaveLength(1)
  })
})
