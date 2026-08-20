/**
 * **T-103** — RF-40 / RN-06 / RNF-09: a leitura **direta** de página, atacada pela
 * rota, como um atacante faria: sem passar pela busca, sem passar pela UI, com o
 * ID na URL.
 *
 * A busca já respeita as três condições (`tests/rf40-restricao-pagina.test.ts`),
 * mas a busca não é o único caminho: `GET /api/confluence/pagina/:id` aceita um ID
 * qualquer. Se ela não repetir a **mesma** verificação, a allowlist deixa de valer
 * para quem digita a URL — e o ID de página do Confluence é sequencial e curto, ou
 * chega por link colado num chat.
 *
 * Três coisas que este arquivo cobra, e que são fáceis de esquecer:
 *
 * 1. **Toda negativa devolve a MESMA resposta.** Distinguir "espaço fora da
 *    allowlist" de "página restrita" já é informação sobre a página: confirma que
 *    ela existe e insinua por que está fechada.
 * 2. **O corpo da página não é buscado quando a exposição é negada.** Verificar
 *    depois de trazer o conteúdo funciona hoje e vaza no dia em que um caminho
 *    esquecer o filtro.
 * 3. **Indisponibilidade não vira "não encontramos".** Um 404 mentiroso manda a
 *    pessoa abrir chamado por uma página que existe.
 *
 * _Requirements: RF-40, RN-06, RNF-07, RNF-09, RNF-06, RNF-18_
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { SqliteLocal } from '@/lib/db/sqlite-local'
import { migrar } from '@/lib/db/schema'
import { Config } from '@/lib/config'
import { montarContexto, type Contexto } from '@/lib/contexto'
import { tratarRequisicao } from '@/lib/http/rotas'
import { HEADER_EMAIL } from '@/lib/auth'
import { ClienteAtlassianFake } from '@/lib/atlassian/fake'

const ANA = 'ana@gocase.com'
const AGORA = '2026-08-04T12:00:00.000Z'

let db: SqliteLocal
let ctx: Contexto
let fake: ClienteAtlassianFake
let n = 0

/** Conteúdo legítimo: tem de atravessar a sanitização inteiro. */
const STORAGE_LIMPA = '<h2>Reprocessar</h2><p>Abra o painel e rode a rotina.</p>'

/**
 * Conteúdo hostil. Qualquer pessoa da empresa edita uma página do Confluence — a
 * rota tem de devolver árvore inerte, não HTML.
 */
const STORAGE_HOSTIL = [
  '<p>antes</p>',
  '<script>alert(1)</script>',
  '<img src="x" onerror="alert(1)">',
  '<a href="javascript:alert(1)">clique</a>',
  '<iframe src="https://mau.exemplo"></iframe>',
  '<p>depois</p>',
].join('')

function semear(f: ClienteAtlassianFake): void {
  f.estado.conteudoPaginas.set('livre', {
    titulo: 'Como reprocessar o relatório',
    espaco: 'TECH',
    labels: [],
    storage: STORAGE_LIMPA,
  })
  f.estado.conteudoPaginas.set('hostil', {
    titulo: 'Página que qualquer um edita',
    espaco: 'TECH',
    labels: [],
    storage: STORAGE_HOSTIL,
  })
  f.estado.conteudoPaginas.set('outro-espaco', {
    titulo: 'Salários 2026',
    espaco: 'RH',
    labels: [],
    storage: '<p>faixa salarial por cargo</p>',
  })
  f.estado.conteudoPaginas.set('com-label', {
    titulo: 'Plano de reestruturação',
    espaco: 'TECH',
    labels: ['Confidencial'],
    storage: '<p>lista de nomes</p>',
  })
  f.estado.conteudoPaginas.set('restrita', {
    titulo: 'Somente diretoria',
    espaco: 'TECH',
    labels: [],
    storage: '<p>conteúdo restrito</p>',
  })
  f.estado.conteudoPaginas.set('na-lixeira', {
    titulo: 'Processo antigo revogado',
    espaco: 'TECH',
    labels: [],
    storage: '<p>orientação obsoleta</p>',
    atual: false,
  })
  f.estado.idsRestritos = new Set(['restrita'])
}

async function montar(espacos: readonly string[] = ['TECH']): Promise<void> {
  db = new SqliteLocal()
  await migrar(db)
  const config = new Config(db)
  await config.definir('dominios_permitidos', ['gocase.com'], ANA, AGORA)
  await config.definir('espacos_confluence', [...espacos], ANA, AGORA)
  await config.definir('labels_bloqueadas', ['confidencial'], ANA, AGORA)
  ctx = await montarContexto(
    { DB: db, ATLAS_USAR_FAKES: '1' },
    () => AGORA,
    () => `id-${++n}`,
  )
  fake = ctx.atlassian as ClienteAtlassianFake
  semear(fake)
}

beforeEach(async () => {
  n = 0
  await montar()
})

function req(caminho: string, email: string | null = ANA): Request {
  const headers: Record<string, string> = {}
  if (email) headers[HEADER_EMAIL] = email
  return new Request(`https://atlas.devgogroup.com${caminho}`, { headers })
}

const ler = (id: string, email: string | null = ANA) =>
  tratarRequisicao(req(`/api/confluence/pagina/${id}`, email), ctx, {})

const operacoes = () => fake.chamadas.map((c) => c.operacao)

describe('RF-39 — página liberada é lida, e chega como ÁRVORE', () => {
  it('conteúdo legítimo atravessa, com título e espaço', async () => {
    const r = await ler('livre')
    expect(r.status).toBe(200)
    const corpo = await r.json()
    expect(corpo.titulo).toBe('Como reprocessar o relatório')
    expect(corpo.espaco).toBe('TECH')
    expect(Array.isArray(corpo.nos)).toBe(true)
    expect(JSON.stringify(corpo.nos)).toContain('Abra o painel')
  })

  it('a resposta é árvore tipada — não existe campo com HTML cru', async () => {
    // Se um dia a rota devolver `html` ou o storage bruto, o navegador ganha um
    // caminho para renderizar string. A árvore existe para que não exista.
    const corpo = await (await ler('livre')).json()
    const serializado = JSON.stringify(corpo)
    expect(corpo).not.toHaveProperty('html')
    expect(corpo).not.toHaveProperty('storage')
    expect(corpo).not.toHaveProperty('storageNaoSanitizado')
    expect(serializado).not.toContain('<h2>')
    expect(serializado).not.toContain('<p>')
  })

  it('BURLA — página hostil sai inerte pela ROTA, não só na função pura', async () => {
    const corpo = await (await ler('hostil')).json()
    const serializado = JSON.stringify(corpo)
    // O texto de antes e depois continua lá: sanitizar não é apagar a página.
    expect(serializado).toContain('antes')
    expect(serializado).toContain('depois')
    for (const vetor of [/<script/i, /onerror/i, /javascript:/i, /<iframe/i, /<img/i]) {
      expect(serializado, `vetor ${vetor} vazou na resposta da rota`).not.toMatch(vetor)
    }
  })

  it('a leitura é auditada — ela toca a Atlassian (RF-58, RN-10)', async () => {
    await ler('livre')
    const r = await db.query(
      `SELECT ator_email, recurso, resultado FROM auditoria
        WHERE acao = 'pagina_confluence_lida' AND resultado = 'sucesso'`,
      [],
    )
    expect(r.rows).toHaveLength(1)
    expect(r.rows[0]).toContain(ANA)
    expect(r.rows[0]).toContain('livre')
  })
})

describe('RF-40 / RN-06 — BURLA: as três condições valem para a URL direta', () => {
  it('espaço FORA da allowlist: negado, ainda que a página exista', async () => {
    const r = await ler('outro-espaco')
    expect(r.status).toBe(404)
    expect(JSON.stringify(await r.json())).not.toContain('Salários')
  })

  it('label bloqueada em espaço LIBERADO: negado', async () => {
    // A comparação é sem diferenciar maiúsculas: a página traz `Confidencial` e a
    // config traz `confidencial`. Casar só exato faria a label de bloqueio depender
    // de como quem escreveu a página digitou.
    const r = await ler('com-label')
    expect(r.status).toBe(404)
    expect(JSON.stringify(await r.json())).not.toContain('reestruturação')
  })

  it('página RESTRITA em espaço liberado: negado', async () => {
    const r = await ler('restrita')
    expect(r.status).toBe(404)
    expect(JSON.stringify(await r.json())).not.toContain('restrito')
  })

  it('página na lixeira/rascunho: negada — não é conteúdo publicado', async () => {
    const r = await ler('na-lixeira')
    expect(r.status).toBe(404)
    expect(JSON.stringify(await r.json())).not.toContain('obsoleta')
  })

  it('BURLA — as negativas são INDISTINGUÍVEIS entre si', async () => {
    // Um corpo diferente por motivo é oráculo: diz que a página existe e insinua
    // por que está fechada. Quem não pode ler não precisa saber a diferença.
    const respostas = await Promise.all(
      ['outro-espaco', 'com-label', 'restrita', 'na-lixeira', 'id-que-nao-existe'].map(
        async (id) => {
          const r = await ler(id)
          return `${r.status}|${await r.text()}`
        },
      ),
    )
    expect(new Set(respostas).size).toBe(1)
  })

  it('BURLA — o CORPO da página negada nunca é buscado', async () => {
    // Verificar depois de trazer o conteúdo funciona hoje e vaza no dia em que um
    // caminho esquecer o filtro: o conteúdo restrito já estaria na memória do app.
    await ler('restrita')
    await ler('outro-espaco')
    await ler('com-label')
    expect(operacoes()).not.toContain('obterCorpoStorage')
  })

  it('allowlist VAZIA nega tudo, e nem consulta a Atlassian (fail-closed)', async () => {
    await montar([])
    const r = await ler('livre')
    expect(r.status).toBe(404)
    expect(operacoes()).toEqual([])
  })

  it('BURLA — id com travessia de caminho não vira consulta', async () => {
    for (const id of ['..%2F..%2Fadmin', 'livre%20', '..', '%2e%2e']) {
      expect((await ler(id)).status).toBe(404)
    }
    expect(operacoes()).not.toContain('obterCorpoStorage')
  })

  it('sem identidade válida, a rota não responde (RF-01, RF-05)', async () => {
    expect((await ler('livre', null)).status).toBe(403)
    expect((await ler('livre', 'x@gmail.com')).status).toBe(403)
  })
})

describe('RN-06 — falha na verificação nega, indisponibilidade não mente', () => {
  it('FALHA ao consultar a restrição: nega (fail-closed)', async () => {
    fake.estado.falhas.paginaRestrita = 'indisponivel'
    const r = await ler('livre')
    expect(r.status).toBe(404)
    expect(operacoes()).not.toContain('obterCorpoStorage')
  })

  it('Atlassian indisponível: 503 com mensagem de negócio, NÃO 404', async () => {
    // 404 aqui seria mentira — a página existe. A pessoa abriria chamado por uma
    // documentação que estava lá (RNF-18, RNF-19).
    fake.estado.falhas.obterPagina = 'indisponivel'
    const r = await ler('livre')
    expect(r.status).toBe(503)
    const corpo = await r.json()
    expect(corpo.erro).toMatch(/instantes|agora/i)
    expect(JSON.stringify(corpo)).not.toMatch(/\bstack\b|Error:|503/)
  })

  it('a negativa é auditada com o motivo — a resposta não o revela', async () => {
    await ler('restrita')
    const r = await db.query(
      `SELECT resultado, detalhe_json FROM auditoria WHERE acao = 'pagina_confluence_lida'`,
      [],
    )
    expect(r.rows).toHaveLength(1)
    expect(JSON.stringify(r.rows[0])).toContain('pagina_restrita')
  })
})

describe('estrutura — o storage cru só sai da camada por um caminho', () => {
  it('só `confluence/acesso.ts` chama `obterCorpoStorage`', async () => {
    // Estrutural de propósito, como o teste de `dangerouslySetInnerHTML`: o gate de
    // exposição é obrigatório porque é o ÚNICO caminho até o corpo da página. Uma
    // rota que chame o cliente direto pula as três condições de RN-06 sem que nada
    // no diff pareça errado.
    const raiz = fileURLToPath(new URL('../src', import.meta.url))
    const arquivos: string[] = []
    const varrer = (dir: string) => {
      for (const item of readdirSync(dir)) {
        const caminho = join(dir, item)
        if (statSync(caminho).isDirectory()) varrer(caminho)
        else if (/\.(ts|tsx)$/.test(item)) arquivos.push(caminho)
      }
    }
    varrer(raiz)

    const chamadores = arquivos.filter((a) => {
      // A própria camada isolada declara e implementa o método — o que importa é
      // quem o CONSOME acima dela.
      if (a.includes(join('lib', 'atlassian'))) return false
      return /\bobterCorpoStorage\s*\(/.test(readFileSync(a, 'utf8'))
    })
    expect(chamadores.map((a) => a.replace(raiz, '').replace(/\\/g, '/'))).toEqual([
      '/lib/confluence/acesso.ts',
    ])
  })
})
