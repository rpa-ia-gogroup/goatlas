/**
 * **T-115** — navegação pela árvore do espaço e breadcrumbs (`RF-41`), com `RN-06`
 * valendo em cada nó.
 *
 * ## Por que a árvore é um teste de exposição, não de navegação
 *
 * Listar filhos de uma página expõe **títulos**. Título de página restrita é
 * exatamente o que já vazou uma vez neste projeto (na mensagem de bloqueio da Regra
 * 1), então a árvore repete as três condições — e o breadcrumb também: o caminho até
 * a página nomeia os ancestrais, e um ancestral restrito nomeado seria o mesmo furo
 * com outro rótulo.
 *
 * ## E por que ela custa caro se feita ingenuamente
 *
 * Uma consulta de restrição **por página** transformaria um clique na árvore em
 * dezenas de chamadas com a credencial única (`R-02`). Duas das três condições
 * (espaço e label) vão para dentro do **CQL**, como na busca; só a restrição sobra
 * por página, limitada pelo teto de itens do nível.
 *
 * _Requirements: RF-41, RF-40, RN-06, RNF-07, RNF-13_
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { SqliteLocal } from '@/lib/db/sqlite-local'
import { migrar } from '@/lib/db/schema'
import { Config } from '@/lib/config'
import { montarContexto, type Contexto } from '@/lib/contexto'
import { tratarRequisicao } from '@/lib/http/rotas'
import { HEADER_EMAIL } from '@/lib/auth'
import { ClienteAtlassianFake } from '@/lib/atlassian/fake'
import { montarCqlFilhos } from '@/lib/atlassian/cliente'

const ANA = 'ana@gocase.com'
const AGORA = '2026-08-04T12:00:00.000Z'

let db: SqliteLocal
let ctx: Contexto
let fake: ClienteAtlassianFake
let n = 0

/**
 * Um espaço com hierarquia:
 *
 * ```
 * home (homepage do espaço TECH)
 * ├── processos
 * │   ├── reprocessar
 * │   └── restrita-filha      ← restrita
 * ├── confidencial-filha      ← label bloqueada
 * └── secao-restrita          ← restrita, e MÃE de neta-visivel
 *     └── neta-visivel
 * ```
 */
function semear(f: ClienteAtlassianFake): void {
  f.estado.espacos.set('TECH', { nome: 'Tecnologia', homepageId: 'home' })
  f.estado.espacos.set('RH', { nome: 'Pessoas', homepageId: 'rh-home' })

  const pagina = (
    id: string,
    titulo: string,
    idPai: string | null,
    over: { labels?: string[]; espaco?: string } = {},
  ) => {
    f.estado.conteudoPaginas.set(id, {
      titulo,
      espaco: over.espaco ?? 'TECH',
      labels: over.labels ?? [],
      storage: `<p>conteúdo de ${titulo}</p>`,
      idPai,
    })
  }

  pagina('home', 'Documentação de tecnologia', null)
  pagina('processos', 'Processos operacionais', 'home')
  pagina('reprocessar', 'Como reprocessar o relatório', 'processos')
  pagina('restrita-filha', 'Salários da equipe', 'processos')
  pagina('confidencial-filha', 'Plano de reestruturação', 'home', { labels: ['confidencial'] })
  pagina('secao-restrita', 'Somente diretoria', 'home')
  pagina('neta-visivel', 'Ata de reunião', 'secao-restrita')
  pagina('rh-home', 'Pessoas', null, { espaco: 'RH' })
  pagina('faixas', 'Faixas salariais', 'rh-home', { espaco: 'RH' })

  f.estado.idsRestritos = new Set(['restrita-filha', 'secao-restrita'])
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

function pedir(caminho: string, email: string | null = ANA): Promise<Response> {
  const headers: Record<string, string> = {}
  if (email) headers[HEADER_EMAIL] = email
  return tratarRequisicao(
    new Request(`https://atlas.devgogroup.com${caminho}`, { headers }),
    ctx,
    {},
  )
}

const arvore = (query: string, email: string | null = ANA) =>
  pedir(`/api/confluence/arvore${query}`, email)
const ler = (id: string) => pedir(`/api/confluence/pagina/${id}`)
const titulos = (itens: { titulo: string }[]) => itens.map((i) => i.titulo)

describe('RF-41 — a árvore desce um nível por vez, a partir da homepage', () => {
  it('sem `pai`, a raiz é a homepage do espaço', async () => {
    const r = await arvore('?espaco=TECH')
    expect(r.status).toBe(200)
    const corpo = await r.json()
    expect(corpo.espaco).toEqual({ chave: 'TECH', nome: 'Tecnologia' })
    expect(corpo.pai).toEqual({ id: 'home', titulo: 'Documentação de tecnologia' })
    // Filhos de `home`: só o que passa pelas três condições.
    expect(titulos(corpo.itens)).toEqual(['Processos operacionais'])
  })

  it('com `pai`, lista os filhos daquele nó', async () => {
    const corpo = await (await arvore('?espaco=TECH&pai=processos')).json()
    expect(titulos(corpo.itens)).toEqual(['Como reprocessar o relatório'])
  })

  it('nível sem filhos expostos devolve lista vazia, não erro', async () => {
    const r = await arvore('?espaco=TECH&pai=reprocessar')
    expect(r.status).toBe(200)
    expect((await r.json()).itens).toEqual([])
  })

  it('a navegação é auditada — ela toca a Atlassian', async () => {
    await arvore('?espaco=TECH')
    const r = await db.query(
      `SELECT ator_email, resultado FROM auditoria WHERE acao = 'arvore_navegada'`,
      [],
    )
    expect(r.rows).toHaveLength(1)
    expect(r.rows[0]).toContain(ANA)
  })
})

describe('RN-06 — BURLA: a árvore não é um caminho lateral para título restrito', () => {
  it('filho RESTRITO não aparece, nem o título', async () => {
    const corpo = await (await arvore('?espaco=TECH&pai=processos')).json()
    expect(titulos(corpo.itens)).not.toContain('Salários da equipe')
    expect(JSON.stringify(corpo)).not.toContain('Salários')
  })

  it('filho com LABEL bloqueada não aparece', async () => {
    const corpo = await (await arvore('?espaco=TECH')).json()
    expect(JSON.stringify(corpo)).not.toContain('reestruturação')
  })

  it('BURLA — espaço fora da allowlist: 404, e nada é consultado', async () => {
    const r = await arvore('?espaco=RH')
    expect(r.status).toBe(404)
    expect(JSON.stringify(await r.json())).not.toContain('Pessoas')
    expect(fake.chamadas.map((c) => c.operacao)).not.toContain('listarFilhosDaPagina')
  })

  it('BURLA — descer por um `pai` de OUTRO espaço é negado', async () => {
    // O `pai` vem do cliente: passar o id de uma página de espaço não liberado é a
    // tentativa óbvia. Ele passa pela mesma verificação de exposição, então a resposta
    // é a mesma 404 de sempre (`D-12`) — nem "lista vazia", que confirmaria o id.
    const r = await arvore('?espaco=TECH&pai=rh-home')
    expect(r.status).toBe(404)
    expect(JSON.stringify(await r.json())).not.toContain('Faixas')
  })

  it('BURLA — descer por um `pai` RESTRITO é negado', async () => {
    // `neta-visivel` não é restrita, mas a mãe é: listar os filhos de uma seção
    // restrita entregaria a estrutura de dentro dela.
    const r = await arvore('?espaco=TECH&pai=secao-restrita')
    expect(r.status).toBe(404)
    expect(JSON.stringify(await r.json())).not.toContain('Ata')
  })

  it('allowlist VAZIA nega e não consulta (fail-closed)', async () => {
    await montar([])
    expect((await arvore('?espaco=TECH')).status).toBe(404)
    expect(fake.chamadas).toEqual([])
  })

  it('sem identidade válida, a rota não responde', async () => {
    expect((await arvore('?espaco=TECH', null)).status).toBe(403)
  })
})

describe('RF-41 — a porta de entrada da árvore só oferece o que a allowlist libera', () => {
  it('lista os espaços liberados, com a homepage por onde começar', async () => {
    const corpo = await (await pedir('/api/confluence/espacos')).json()
    expect(corpo.itens).toEqual([
      { chave: 'TECH', nome: 'Tecnologia', homepageId: 'home' },
    ])
    // O espaço do RH existe no fake e NÃO está na allowlist: nem o nome sai.
    expect(JSON.stringify(corpo)).not.toContain('Pessoas')
  })

  it('allowlist vazia não oferece espaço nenhum', async () => {
    await montar([])
    expect((await (await pedir('/api/confluence/espacos')).json()).itens).toEqual([])
  })

  it('espaço configurado que não resolve é omitido, não derruba a lista', async () => {
    // Chave errada na config é erro de configuração; os outros espaços continuam
    // navegáveis, e a tela não vira uma mensagem de erro por causa de um item.
    await montar(['TECH', 'NAO-EXISTE'])
    const corpo = await (await pedir('/api/confluence/espacos')).json()
    expect(corpo.itens.map((e: { chave: string }) => e.chave)).toEqual(['TECH'])
  })
})

describe('RF-41 — breadcrumbs param no primeiro ancestral não exposto', () => {
  it('o caminho traz os ancestrais expostos, da raiz até a mãe', async () => {
    const corpo = await (await ler('reprocessar')).json()
    expect(corpo.ancestrais.map((a: { titulo: string }) => a.titulo)).toEqual([
      'Documentação de tecnologia',
      'Processos operacionais',
    ])
  })

  it('BURLA — ancestral RESTRITO interrompe a subida e não é nomeado', async () => {
    // `neta-visivel` é legítima, mas a mãe é restrita. Mostrar "Somente diretoria" no
    // caminho seria vazar o título por outro lugar; e continuar subindo por cima dela
    // entregaria a posição da página dentro de uma seção fechada.
    const corpo = await (await ler('neta-visivel')).json()
    expect(corpo.ancestrais).toEqual([])
    expect(JSON.stringify(corpo)).not.toContain('Somente diretoria')
  })

  it('página na raiz não tem ancestral', async () => {
    expect((await (await ler('home')).json()).ancestrais).toEqual([])
  })
})

describe('RNF-07 — o CQL do nível carrega a allowlist, não um filtro posterior', () => {
  it('espaço e label entram na query; o `pai` é escapado', async () => {
    const cql = montarCqlFilhos({
      idPai: 'x" OR space = "RH',
      espacosPermitidos: ['TECH'],
      labelsBloqueadas: ['confidencial'],
      limite: 50,
    })
    expect(cql).toContain('space in ("TECH")')
    expect(cql).toContain('label != "confidencial"')
    // Injeção pelo `pai` não reescreve a cláusula de espaço — o mesmo cuidado da busca.
    expect(cql).not.toMatch(/space = "RH"/)
    expect(cql).toContain('\\"')
  })
})
