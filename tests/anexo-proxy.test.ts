/**
 * **T-102** — burla do proxy de anexo: `RNF-02`, `RNF-06`, `RN-06`.
 *
 * O navegador não pode buscar imagem no Confluence (não tem credencial, e `RNF-02`
 * proíbe), então o app re-serve o anexo. Isso cria duas portas que não existiam:
 *
 * 1. **Anexo de página que a pessoa não poderia ler.** A rota repassa as três
 *    condições de `RN-06` — as mesmas da busca e da leitura. Uma rota de anexo sem
 *    essa checagem é o vazamento mais fácil de escrever nesta fase: o conteúdo
 *    sensível costuma estar justamente no PDF anexado.
 * 2. **`Content-Type` vindo da Atlassian.** Anexo `text/html` servido do **nosso**
 *    domínio é XSS armazenado com sessão do app — o mesmo vetor que a sanitização
 *    fecha no corpo da página, entrando por outra porta. O tipo declarado pela
 *    Atlassian nunca é repassado: ou está na allowlist de exibição, ou vira
 *    download opaco.
 *
 * E o nome do arquivo é escolhido por quem edita a página: ele entra num
 * **cabeçalho HTTP**, então CRLF no nome é tentativa de injeção de cabeçalho.
 *
 * _Requirements: RNF-02, RNF-06, RN-06, RF-40_
 */

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

/** Assinatura de PNG — o suficiente para o teste falar de bytes reais. */
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13])
const bytes = (u8: Uint8Array): ArrayBuffer =>
  u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer

/** Nome com CRLF: tentativa de escrever um segundo cabeçalho a partir do conteúdo. */
const NOME_COM_CRLF = 'nota".pdf\r\nSet-Cookie: sessao=roubada'

function semear(f: ClienteAtlassianFake): void {
  f.estado.conteudoPaginas.set('livre', {
    titulo: 'Procedimento com anexos',
    espaco: 'TECH',
    labels: [],
    storage: '<p>veja o anexo</p>',
  })
  f.estado.conteudoPaginas.set('restrita', {
    titulo: 'Somente diretoria',
    espaco: 'TECH',
    labels: [],
    storage: '<p>x</p>',
  })
  f.estado.conteudoPaginas.set('outro-espaco', {
    titulo: 'Salários 2026',
    espaco: 'RH',
    labels: [],
    storage: '<p>x</p>',
  })
  f.estado.idsRestritos = new Set(['restrita'])

  f.estado.anexos.set('livre', [
    { nomeArquivo: 'diagrama.png', tipoDeclarado: 'image/png', bytes: bytes(PNG) },
    { nomeArquivo: 'manual.pdf', tipoDeclarado: 'application/pdf', bytes: bytes(PNG) },
    // O caso central: a Atlassian devolve o tipo que estava no upload.
    { nomeArquivo: 'inocente.png', tipoDeclarado: 'text/html', bytes: bytes(PNG) },
    { nomeArquivo: 'icone.svg', tipoDeclarado: 'image/svg+xml', bytes: bytes(PNG) },
    { nomeArquivo: 'planilha.xlsx', tipoDeclarado: null, bytes: bytes(PNG) },
    { nomeArquivo: 'quebrado.png', tipoDeclarado: 'image/png\r\nSet-Cookie: a=b', bytes: bytes(PNG) },
    { nomeArquivo: NOME_COM_CRLF, tipoDeclarado: 'application/pdf', bytes: bytes(PNG) },
    { nomeArquivo: 'relatório de vendas.png', tipoDeclarado: 'image/png', bytes: bytes(PNG) },
    { nomeArquivo: 'enorme.png', tipoDeclarado: 'image/png', bytes: bytes(new Uint8Array(64)) },
  ])
  f.estado.anexos.set('restrita', [
    { nomeArquivo: 'demissoes.pdf', tipoDeclarado: 'application/pdf', bytes: bytes(PNG) },
  ])
  f.estado.anexos.set('outro-espaco', [
    { nomeArquivo: 'salarios.pdf', tipoDeclarado: 'application/pdf', bytes: bytes(PNG) },
  ])
}

async function montar(espacos: readonly string[] = ['TECH']): Promise<void> {
  db = new SqliteLocal()
  await migrar(db)
  const config = new Config(db)
  await config.definir('dominios_permitidos', ['gocase.com'], ANA, AGORA)
  await config.definir('espacos_confluence', [...espacos], ANA, AGORA)
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

function buscar(idPagina: string, nome: string, email: string | null = ANA): Promise<Response> {
  const headers: Record<string, string> = {}
  if (email) headers[HEADER_EMAIL] = email
  const caminho = `/api/confluence/anexo/${idPagina}/${encodeURIComponent(nome)}`
  return tratarRequisicao(
    new Request(`https://atlas.devgogroup.com${caminho}`, { headers }),
    ctx,
    {},
  )
}

const operacoes = () => fake.chamadas.map((c) => c.operacao)

describe('RN-06 — BURLA: o anexo repassa as três condições da página', () => {
  it('anexo de página RESTRITA: negado, e o arquivo nem é baixado', async () => {
    const r = await buscar('restrita', 'demissoes.pdf')
    expect(r.status).toBe(404)
    // Não é só o status: baixar e descartar já traria o conteúdo para a memória do
    // app, e o próximo caminho a esquecer o filtro o serve.
    expect(operacoes()).not.toContain('obterAnexo')
  })

  it('anexo de espaço FORA da allowlist: negado', async () => {
    const r = await buscar('outro-espaco', 'salarios.pdf')
    expect(r.status).toBe(404)
    expect(operacoes()).not.toContain('obterAnexo')
  })

  it('allowlist vazia nega todo anexo (fail-closed)', async () => {
    await montar([])
    expect((await buscar('livre', 'diagrama.png')).status).toBe(404)
    expect(operacoes()).toEqual([])
  })

  it('BURLA — anexo que não pertence à página: negado', async () => {
    // O nome vem da URL. Sem casar contra a lista de anexos DAQUELA página, o
    // parâmetro escolheria arquivo de outra — inclusive de página restrita.
    for (const nome of ['demissoes.pdf', '../restrita/demissoes.pdf', 'nao-existe.png']) {
      expect((await buscar('livre', nome)).status).toBe(404)
    }
  })

  it('sem identidade válida, a rota não responde', async () => {
    expect((await buscar('livre', 'diagrama.png', null)).status).toBe(403)
    expect((await buscar('livre', 'diagrama.png', 'x@gmail.com')).status).toBe(403)
  })
})

describe('RNF-06 — BURLA: o Content-Type da Atlassian nunca é repassado', () => {
  it('anexo declarado `text/html` NÃO sai como html', async () => {
    // Este é o vetor: HTML servido do nosso domínio roda com a sessão do app.
    const r = await buscar('livre', 'inocente.png')
    expect(r.status).toBe(200)
    expect(r.headers.get('Content-Type')).toBe('application/octet-stream')
    expect(r.headers.get('Content-Disposition')).toMatch(/^attachment;/)
    expect(r.headers.get('X-Content-Type-Options')).toBe('nosniff')
  })

  it('SVG não é exibido inline — SVG é documento com script', async () => {
    const r = await buscar('livre', 'icone.svg')
    expect(r.headers.get('Content-Type')).toBe('application/octet-stream')
    expect(r.headers.get('Content-Disposition')).toMatch(/^attachment;/)
  })

  it('tipo ausente vira download opaco, não palpite', async () => {
    const r = await buscar('livre', 'planilha.xlsx')
    expect(r.headers.get('Content-Type')).toBe('application/octet-stream')
    expect(r.headers.get('Content-Disposition')).toMatch(/^attachment;/)
  })

  it('BURLA — tipo com CRLF não injeta cabeçalho nem passa como imagem', async () => {
    const r = await buscar('livre', 'quebrado.png')
    expect(r.status).toBe(200)
    expect(r.headers.get('Content-Type')).toBe('application/octet-stream')
    expect(r.headers.get('Set-Cookie')).toBeNull()
  })

  it('imagem legítima é exibida inline, com nosniff', async () => {
    const r = await buscar('livre', 'diagrama.png')
    expect(r.status).toBe(200)
    expect(r.headers.get('Content-Type')).toBe('image/png')
    expect(r.headers.get('Content-Disposition')).toMatch(/^inline;/)
    expect(r.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(new Uint8Array(await r.arrayBuffer())).toEqual(PNG)
  })

  it('PDF é exibido inline — é o formato de anexo de procedimento', async () => {
    const r = await buscar('livre', 'manual.pdf')
    expect(r.headers.get('Content-Type')).toBe('application/pdf')
    expect(r.headers.get('Content-Disposition')).toMatch(/^inline;/)
  })

  it('o cache é PRIVADO — anexo é conteúdo com permissão', async () => {
    // `public` deixaria um cache compartilhado servir o anexo a quem a verificação
    // de RN-06 negaria.
    const r = await buscar('livre', 'diagrama.png')
    expect(r.headers.get('Cache-Control')).toMatch(/private/)
    expect(r.headers.get('Cache-Control')).not.toMatch(/public/)
  })
})

describe('RNF-06 — BURLA: o nome do arquivo entra num cabeçalho', () => {
  it('CRLF no nome não vira segundo cabeçalho', async () => {
    const r = await buscar('livre', NOME_COM_CRLF)
    expect(r.status).toBe(200)
    expect(r.headers.get('Set-Cookie')).toBeNull()
    expect(r.headers.get('Content-Disposition')).not.toMatch(/[\r\n]/)
  })

  it('nada no nome ESCAPA do `filename` — o cabeçalho inteiro tem a forma esperada', async () => {
    // A asserção é sobre a forma, não sobre palavras proibidas: um arquivo
    // legitimamente chamado `set-cookie: notas.pdf` é inofensivo dentro das aspas, e
    // proibir a palavra testaria a coisa errada. O que importa é que o valor não
    // tenha CRLF e que nenhum parâmetro novo tenha nascido do nome.
    const disposicao =
      (await buscar('livre', NOME_COM_CRLF)).headers.get('Content-Disposition') ?? ''
    expect(disposicao).toMatch(/^(?:inline|attachment); filename="[^"\\;\r\n]*"; filename\*=UTF-8''[^\s;"]*$/)
  })

  it('acento sobrevive via `filename*` (PT-BR não é caso de borda aqui)', async () => {
    const disposicao =
      (await buscar('livre', 'relatório de vendas.png')).headers.get('Content-Disposition') ?? ''
    expect(disposicao).toMatch(/filename\*=UTF-8''/)
    expect(decodeURIComponent(disposicao.split("UTF-8''")[1] ?? '')).toContain('relatório')
  })
})

describe('limites e auditoria', () => {
  it('anexo grande demais é recusado com mensagem de negócio', async () => {
    // Sem teto, uma página hostil derruba o Worker sem precisar de script: basta
    // anexar um arquivo enorme e pedir o proxy.
    fake.estado.limiteAnexoBytes = 16
    const r = await buscar('livre', 'enorme.png')
    expect(r.status).toBe(413)
    const corpo = await r.json()
    expect(corpo.erro).toMatch(/grande/i)
    expect(JSON.stringify(corpo)).not.toMatch(/\bstack\b|Error:/)
  })

  it('o anexo servido é auditado, com a página como recurso', async () => {
    await buscar('livre', 'diagrama.png')
    const r = await db.query(
      `SELECT ator_email, recurso, resultado FROM auditoria WHERE acao = 'anexo_servido'`,
      [],
    )
    expect(r.rows).toHaveLength(1)
    expect(r.rows[0]).toContain(ANA)
  })

  it('a negativa também é auditada — tentativa de burla precisa aparecer', async () => {
    await buscar('restrita', 'demissoes.pdf')
    const r = await db.query(
      `SELECT resultado, detalhe_json FROM auditoria
        WHERE acao = 'anexo_servido' AND resultado = 'negado'`,
      [],
    )
    expect(r.rows).toHaveLength(1)
    expect(JSON.stringify(r.rows[0])).toContain('pagina_restrita')
  })

  it('indisponibilidade ao baixar não vira 404 mentiroso', async () => {
    fake.estado.falhas.obterAnexo = 'indisponivel'
    const r = await buscar('livre', 'diagrama.png')
    expect(r.status).toBe(503)
  })
})
