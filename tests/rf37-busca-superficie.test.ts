/**
 * **T-113** — a busca como superfície própria: `RF-37`, `RF-38`, `RN-06`, `RF-42`.
 *
 * A mesma camada que a Regra 1 usa, agora exposta numa rota. O que muda ao expor:
 * o **termo** e os **parâmetros** passam a vir do cliente, e é aí que mora a burla.
 *
 * A allowlist de espaços é a trava de `RN-06`. Ela vem da **config**, e nenhum
 * parâmetro de query pode **ampliá-la** — nem `?espacos=`, nem `?espacosPermitidos=`,
 * nem `?labelsBloqueadas=`. É o mesmo raciocínio de `RF-04`/`RNF-05` para a
 * identidade: o cliente não escolhe o próprio escopo. Um `?espacos=RH` respeitado
 * transformaria a busca no caminho mais curto para o espaço do RH.
 *
 * ⚠️ **Exceção controlada, registrada em `D-30`: `?espaco=` ESTREITA.** O bloco de busca
 * do Confluence (`livesearch`) precisa de "só neste espaço", e a única forma segura de
 * aceitar escopo do cliente é **interseção** com a config: o resultado é sempre um
 * **subconjunto** dela, e o pior caso é lista vazia. É por isso que a asserção abaixo
 * mudou de "recebe exatamente a config" para "**nunca recebe nada fora da config**" — a
 * primeira testava o mecanismo, a segunda testa a propriedade, e é a propriedade que
 * impede o vazamento. Detalhe em `tests/rf37-busca-no-espaco.test.ts`.
 *
 * E busca sem resultado **não é erro**: é o mapa das lacunas de documentação
 * (`RF-42`). Ela é registrada com a mesma forma que a Regra 1 usa, para que
 * `/api/admin/lacunas` (T-117) leia uma coisa só, não duas.
 *
 * _Requirements: RF-37, RF-38, RF-42, RN-06, RNF-07, RNF-11, RNF-18_
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { SqliteLocal } from '@/lib/db/sqlite-local'
import { migrar } from '@/lib/db/schema'
import { Config } from '@/lib/config'
import { montarContexto, type Contexto } from '@/lib/contexto'
import { tratarRequisicao } from '@/lib/http/rotas'
import { HEADER_EMAIL } from '@/lib/auth'
import { ClienteAtlassianFake } from '@/lib/atlassian/fake'
import type { BuscaConfluenceParams, PaginaConfluence } from '@/lib/atlassian/tipos'

const ANA = 'ana@gocase.com'
const AGORA = '2026-08-04T12:00:00.000Z'

let db: SqliteLocal
let ctx: Contexto
let fake: ClienteAtlassianFake
let n = 0

function pagina(over: Partial<PaginaConfluence>): PaginaConfluence {
  return {
    id: 'p',
    titulo: 'Título',
    espaco: 'TECH',
    url: 'https://goengenharia.atlassian.net/wiki/x',
    score: 0.5,
    trecho: 'trecho de contexto',
    labels: [],
    ...over,
  }
}

async function montar(espacos: readonly string[] = ['TECH']): Promise<void> {
  db = new SqliteLocal()
  await migrar(db)
  const config = new Config(db)
  await config.definir('dominios_permitidos', ['gocase.com'], ANA, AGORA)
  await config.definir('espacos_confluence', [...espacos], ANA, AGORA)
  await config.definir('labels_bloqueadas', ['confidencial'], ANA, AGORA)
  ctx = await montarContexto(
    { DB: db, GOATLAS_USAR_FAKES: '1' },
    () => AGORA,
    () => `id-${++n}`,
  )
  fake = ctx.atlassian as ClienteAtlassianFake
  fake.estado.paginas = [
    pagina({ id: 'reprocessar', titulo: 'Como reprocessar o relatório', score: 0.91 }),
    pagina({ id: 'nomes', titulo: 'Padrão de nomes das lojas', score: 0.4 }),
    pagina({ id: 'salarios', titulo: 'Faixas salariais 2026', espaco: 'RH', score: 0.99 }),
    pagina({ id: 'demissoes', titulo: 'Plano de reestruturação', labels: ['confidencial'], score: 0.98 }),
    pagina({ id: 'diretoria', titulo: 'Somente diretoria', score: 0.97 }),
  ]
  fake.estado.idsRestritos = new Set(['diretoria'])
}

beforeEach(async () => {
  n = 0
  await montar()
})

function buscar(query: string, email: string | null = ANA): Promise<Response> {
  const headers: Record<string, string> = {}
  if (email) headers[HEADER_EMAIL] = email
  return tratarRequisicao(
    new Request(`https://goatlas.devgogroup.com/api/confluence/busca${query}`, { headers }),
    ctx,
    {},
  )
}

/** Os parâmetros com que a camada isolada foi chamada — é ali que a allowlist vale. */
const paramsDaBusca = (): BuscaConfluenceParams[] =>
  fake.chamadas
    .filter((c) => c.operacao === 'buscarConfluence')
    .map((c) => c.params as BuscaConfluenceParams)

describe('RF-37 — a busca devolve trecho, score e o id para ler no app', () => {
  it('resultados dos espaços liberados, com o score que a Regra 1 usa', async () => {
    const r = await buscar('?q=relat%C3%B3rio')
    expect(r.status).toBe(200)
    const corpo = await r.json()
    expect(corpo.itens.map((i: { id: string }) => i.id)).toEqual(['reprocessar', 'nomes'])
    // O score não é enfeite de ordenação: é o mesmo insumo do bloqueio (RF-09).
    expect(corpo.itens[0].score).toBe(0.91)
    expect(corpo.itens[0].trecho).toBe('trecho de contexto')
    // O `id` é o que permite ler DENTRO do app — quem busca não tem assento, então
    // mandar para o Confluence seria mandar para uma parede.
    expect(corpo.itens[0].id).toBe('reprocessar')
  })

  it('a resposta ecoa o termo, para a tela não depender do estado do cliente', async () => {
    expect((await (await buscar('?q=  reprocessar  ')).json()).termo).toBe('reprocessar')
  })
})

describe('RN-06 / RF-38 — BURLA: o cliente não escolhe o próprio escopo', () => {
  it('BURLA — nenhum parâmetro de query coloca `RH` no escopo', async () => {
    const r = await buscar('?q=salario&espacos=RH&espacosPermitidos=RH&espaco=RH')
    const corpo = await r.json()
    expect(corpo.itens.map((i: { id: string }) => i.id)).not.toContain('salarios')
    expect(JSON.stringify(corpo)).not.toContain('salariais')

    // ⚠️ A propriedade que importa: o que a camada isolada recebe é sempre **subconjunto
    // da config**. `D-30` permite estreitar (`?espaco=`), então aqui o resultado é `[]` —
    // nunca `['RH']`. Testar "igual à config" testaria o mecanismo; testar "subconjunto"
    // testa o que impede o vazamento, e continua reprovando se alguém trocar a interseção
    // por substituição.
    const recebido = paramsDaBusca()[0]?.espacosPermitidos ?? []
    expect(recebido.every((e) => ['TECH'].includes(e))).toBe(true)
    expect(recebido).not.toContain('RH')
  })

  it('BURLA — estreitar não é ampliar: espaço VÁLIDO reduz, inválido zera', async () => {
    // As duas metades de `D-30` numa asserção só. Se alguém trocar a interseção por
    // substituição, a segunda linha passa a receber `['RH']` e este teste reprova.
    await buscar('?q=reprocessar&espaco=TECH')
    expect(paramsDaBusca()[0]?.espacosPermitidos).toEqual(['TECH'])

    await montar(['TECH'])
    await buscar('?q=salario&espaco=RH')
    expect(paramsDaBusca()[0]?.espacosPermitidos).toEqual([])
  })

  it('BURLA — `?labelsBloqueadas=` vazio não desliga a exclusão por label', async () => {
    const corpo = await (await buscar('?q=plano&labelsBloqueadas=&labels=')).json()
    expect(corpo.itens.map((i: { id: string }) => i.id)).not.toContain('demissoes')
    expect(paramsDaBusca()[0]?.labelsBloqueadas).toEqual(['confidencial'])
  })

  it('página RESTRITA não aparece — a terceira condição vale aqui também', async () => {
    // Ela tem score 0.97: seria o primeiro resultado da tela.
    const corpo = await (await buscar('?q=diretoria')).json()
    expect(corpo.itens.map((i: { id: string }) => i.id)).not.toContain('diretoria')
    expect(JSON.stringify(corpo)).not.toContain('Somente diretoria')
  })

  it('allowlist VAZIA devolve zero, e a rota não inventa uma allowlist', async () => {
    await montar([])
    const corpo = await (await buscar('?q=qualquer coisa')).json()
    expect(corpo.itens).toEqual([])
    // A rota repassa a config como está; é a camada isolada que se recusa a montar
    // query aberta (e tem teste próprio para "nem sai requisição"). Uma decisão, um
    // lugar.
    expect(paramsDaBusca()[0]?.espacosPermitidos ?? []).toEqual([])
  })

  it('sem espaço configurado, a resposta DIZ isso — não finge "nada encontrado"', async () => {
    // Zero resultados por falta de configuração e zero por falta de documentação são
    // problemas de pessoas diferentes. A tela precisa distinguir, senão o
    // colaborador procura de novo com outras palavras para sempre.
    await montar([])
    const corpo = await (await buscar('?q=qualquer coisa')).json()
    expect(corpo.buscaConfigurada).toBe(false)
  })

  it('BURLA — `?limite=9999` não vira uma varredura do site', async () => {
    await buscar('?q=xy&limite=9999')
    expect(paramsDaBusca()[0]!.limite).toBeLessThanOrEqual(25)
  })

  it('limite inválido cai no padrão, não em `NaN`', async () => {
    for (const bruto of ['abc', '0', '-5', '']) {
      await montar()
      await buscar(`?q=xy&limite=${bruto}`)
      const limite = paramsDaBusca()[0]!.limite
      expect(Number.isInteger(limite), bruto).toBe(true)
      expect(limite, bruto).toBeGreaterThan(0)
    }
  })

  it('sem identidade válida, a rota não responde', async () => {
    expect((await buscar('?q=x', null)).status).toBe(403)
    expect((await buscar('?q=x', 'x@gmail.com')).status).toBe(403)
  })
})

describe('termo — o que não dá para buscar é recusado com mensagem de negócio', () => {
  it('termo ausente ou curto: 400, e nada é consultado', async () => {
    for (const query of ['', '?q=', '?q=%20%20', '?q=a']) {
      const r = await buscar(query)
      expect(r.status, query).toBe(400)
      expect((await r.json()).erro).toMatch(/procura|termo|caracter/i)
    }
    expect(paramsDaBusca()).toHaveLength(0)
  })

  it('termo enorme é cortado antes de virar CQL', async () => {
    await buscar(`?q=${'a'.repeat(5000)}`)
    expect(paramsDaBusca()[0]!.termo.length).toBeLessThanOrEqual(200)
  })
})

describe('RF-42 / RNF-18 — o que a busca REGISTRA', () => {
  it('busca com resultado é auditada, com termo e quantidade', async () => {
    await buscar('?q=reprocessar')
    const r = await db.query(
      `SELECT recurso, resultado, detalhe_json FROM auditoria
        WHERE acao = 'busca_confluence' AND resultado = 'sucesso'`,
      [],
    )
    expect(r.rows).toHaveLength(1)
    expect(JSON.stringify(r.rows[0])).toContain('reprocessar')
    expect(JSON.stringify(r.rows[0])).toContain('2')
  })

  it('busca SEM resultado é registrada como lacuna de documentação', async () => {
    // Não é erro: é o insumo de RF-42. E a forma é a MESMA que a Regra 1 grava, para
    // `/api/admin/lacunas` (T-117) ler uma coisa só.
    fake.estado.paginas = []
    await buscar('?q=politica de home office')
    const r = await db.query(
      `SELECT recurso, detalhe_json FROM auditoria WHERE acao = 'busca_confluence'
        AND detalhe_json LIKE '%lacunaDocumentacao%'`,
      [],
    )
    expect(r.rows).toHaveLength(1)
    // O termo vai em `recurso`, como na Regra 1 — é por ele que T-117 agrupa.
    expect(JSON.stringify(r.rows[0])).toContain('home office')
  })

  it('com o fake reagindo ao termo, um termo sem resposta vira lacuna de verdade', async () => {
    // Aqui a lacuna vem do TERMO não casar, não de esvaziar o acervo à mão — é o
    // caminho que a pessoa percorre. O fake só filtra por texto quando pedido; ver
    // `filtrarPorTermo` (desligado por padrão para não contaminar os testes de RN-06).
    fake.estado.filtrarPorTermo = true
    const corpo = await (await buscar('?q=politica de home office')).json()
    expect(corpo.itens).toEqual([])
    expect(corpo.buscaConfigurada).toBe(true)

    const r = await db.query(
      `SELECT recurso FROM auditoria WHERE detalhe_json LIKE '%lacunaDocumentacao%'`,
      [],
    )
    expect(r.rows).toHaveLength(1)

    // E o termo que EXISTE continua achando.
    const achou = await (await buscar('?q=reprocessar')).json()
    expect(achou.itens.map((i: { id: string }) => i.id)).toEqual(['reprocessar'])
  })

  it('sem espaço configurado NÃO registra lacuna — a lacuna é de configuração', async () => {
    // Registrar aqui envenenaria o mapa de RF-42 com termos que ninguém deixou de
    // documentar: eles simplesmente não tinham onde ser procurados.
    await montar([])
    await buscar('?q=politica de home office')
    const r = await db.query(
      `SELECT id FROM auditoria WHERE detalhe_json LIKE '%lacunaDocumentacao%'`,
      [],
    )
    expect(r.rows).toHaveLength(0)
  })

  it('indisponibilidade responde 503 — não "nenhum resultado"', async () => {
    // "Não achei nada" numa queda empurra a pessoa para abrir chamado por algo que
    // está documentado (RNF-18). E registraria uma lacuna que não existe.
    fake.estado.falhas.buscarConfluence = 'indisponivel'
    const r = await buscar('?q=reprocessar')
    expect(r.status).toBe(503)
    expect((await r.json()).erro).toMatch(/instantes|agora/i)
    const lacunas = await db.query(
      `SELECT id FROM auditoria WHERE detalhe_json LIKE '%lacunaDocumentacao%'`,
      [],
    )
    expect(lacunas.rows).toHaveLength(0)
  })

  it('RNF-11 — a busca conta no limite por usuário', async () => {
    // Ela toca a Atlassian: um laço de buscas consome o orçamento da credencial
    // única (R-02) sem criar nada, o que faz parecer inofensivo.
    const config = new Config(db)
    await config.definir('limite_requisicoes_por_minuto', 2, ANA, AGORA)
    ctx = await montarContexto({ DB: db, GOATLAS_USAR_FAKES: '1' }, () => AGORA, () => `id-${++n}`)
    fake = ctx.atlassian as ClienteAtlassianFake
    fake.estado.paginas = [pagina({ id: 'reprocessar' })]

    await buscar('?q=um')
    await buscar('?q=dois')
    const r = await buscar('?q=tres')
    expect(r.status).toBe(429)
  })
})
