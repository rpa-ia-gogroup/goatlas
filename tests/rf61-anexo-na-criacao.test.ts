/**
 * **T-408 a T-411** — o upload que acontece ANTES de o chamado existir.
 *
 * ## O desenho que estes testes travam
 *
 * O arquivo sobe quando a pessoa o escolhe (feedback imediato), fica em
 * `anexos_pendentes`, e só vira anexo depois de o chamado nascer. A alternativa —
 * mandar os ids dentro da criação — foi recusada em `plan.md` §0 porque id vencido faz
 * a **criação** responder 400, que é classificado como definitivo: um arquivo velho
 * apagaria o chamado da pessoa.
 *
 * ## O que cada trava impede
 *
 * - **O id não trafega** (`SC-11`). O cliente manda o arquivo e recebe `{ ok, nome }`.
 *   Id no navegador seria `RF-30` aplicado a arquivo.
 * - **A chave é a mesma dos dois lados** (T-409b). Uma função só a escreve; se o upload
 *   gravasse a chave crua e a criação procurasse a prefixada, nenhuma linha casaria — o
 *   chamado nasceria sem anexo, sem erro nenhum.
 * - **O teto é mensagem, nunca truncamento** (T-409c, `SC-08`). O quarto arquivo é
 *   recusado com o limite escrito; `.slice()` fazia ele desaparecer.
 * - **Duplo clique não gera dois temporários** (T-411, `SC-09`), e a garantia é a
 *   constraint.
 * - **Somente leitura recusa** (`SC-10`), inclusive o upload — que é escrita mesmo sem
 *   `issueKey`.
 *
 * _Requirements: RF-24, RF-25, RF-30, RF-61, RF-63, RN-10, R-02, R-06, RNF-18_
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { SqliteLocal } from '@/lib/db/sqlite-local'
import { migrar } from '@/lib/db/schema'
import { Config } from '@/lib/config'
import { montarContexto, type Contexto } from '@/lib/contexto'
import { tratarRequisicao } from '@/lib/http/rotas'
import { HEADER_EMAIL } from '@/lib/auth'
import { ClienteAtlassianFake } from '@/lib/atlassian/fake'
import { ClienteAtlassianSomenteLeitura } from '@/lib/atlassian/somente-leitura'
import { linhasComoObjetos } from '@/lib/db/tipos'
import { MAX_ANEXOS_POR_CHAMADO } from '@/lib/tickets/anexos-pendentes'
import { normalizarChaveIdempotencia } from '@/lib/tickets/chave-idempotencia'
import { MAX_ANEXO_ENVIADO_BYTES } from '@/lib/http/anexo-entrada'

const ANA = 'ana@gocase.com'
const BRUNO = 'bruno@gocase.com'
const CHEFE = 'chefe@gocase.com'
const AGORA = '2026-08-07T12:00:00.000Z'

let db: SqliteLocal
let ctx: Contexto
let fake: ClienteAtlassianFake
let n = 0

const CAMPO_ANEXO = {
  fieldId: 'customfield_20031',
  rotulo: 'Anexo',
  obrigatorio: false,
  tipo: 'anexo' as const,
  opcoes: [],
}

beforeEach(async () => {
  db = new SqliteLocal()
  await migrar(db)
  n = 0
  const config = new Config(db)
  await config.definir('dominios_permitidos', ['gocase.com'], CHEFE, AGORA)
  await config.definir('admins', [CHEFE], CHEFE, AGORA)
  await config.definir('tipos_chamado_permitidos', ['rt-1'], CHEFE, AGORA)
  await config.definir('service_desk_id', 'sd-1', CHEFE, AGORA)
  ctx = await montarContexto(
    { DB: db, GOATLAS_USAR_FAKES: '1' },
    () => AGORA,
    () => `id-${++n}`,
  )
  fake = ctx.atlassian as ClienteAtlassianFake
  fake.estado.tiposChamado = [{ id: 'rt-1', serviceDeskId: 'sd-1', nome: 'Suporte', descricao: null }]
  fake.estado.camposPorTipo.set('rt-1', [CAMPO_ANEXO])
})

/**
 * Upload multipart, um arquivo por requisição (`plan.md` §10).
 *
 * `arquivo: null` é o único jeito de mandar requisição **sem** arquivo — o default manda
 * um, porque é o caso comum e omiti-lo por acidente daria 400 em todo teste de sucesso.
 */
function envio(
  campos: { chaveIdempotencia?: string; conversaId?: string },
  arquivo: { nome?: string; conteudo?: string | Uint8Array } | null = {},
  email = ANA,
): Request {
  const form = new FormData()
  if (campos.chaveIdempotencia !== undefined) {
    form.append('chaveIdempotencia', campos.chaveIdempotencia)
  }
  if (campos.conversaId !== undefined) form.append('conversaId', campos.conversaId)
  if (arquivo !== null) {
    const corpo = arquivo.conteudo ?? 'print do erro'
    form.append(
      'arquivo',
      new File([corpo as BlobPart], arquivo.nome ?? 'print.png', { type: 'image/png' }),
    )
  }
  return new Request('https://goatlas.devgogroup.com/api/anexos-pendentes', {
    method: 'POST',
    headers: { [HEADER_EMAIL]: email },
    body: form,
  })
}

const chamar = (r: Request) => tratarRequisicao(r, ctx, {})

async function pendentes() {
  const r = await db.query(
    `SELECT id, solicitante_email, chave_idempotencia, temporary_attachment_id, nome_arquivo,
            materializado_em
       FROM anexos_pendentes ORDER BY criado_em, rowid`,
    [],
  )
  return linhasComoObjetos<{
    id: string
    solicitante_email: string
    chave_idempotencia: string
    temporary_attachment_id: string
    nome_arquivo: string
    materializado_em: string | null
  }>(r)
}

describe('T-409 — o upload devolve o NOME, nunca um identificador', () => {
  it('sucesso: 201, o nome de volta, e a linha no banco', async () => {
    const r = await chamar(envio({ chaveIdempotencia: 'k1' }))
    expect(r.status).toBe(201)
    const corpo = (await r.json()) as { ok: boolean; nome: string }
    expect(corpo.ok).toBe(true)
    expect(corpo.nome).toBe('print.png')

    const linhas = await pendentes()
    expect(linhas).toHaveLength(1)
    expect(linhas[0]?.solicitante_email).toBe(ANA)
    expect(linhas[0]?.temporary_attachment_id).toBeTruthy()
  })

  it('BURLA — o `temporaryAttachmentId` NÃO aparece na resposta', async () => {
    const r = await chamar(envio({ chaveIdempotencia: 'k2' }))
    const texto = await r.text()
    const idGravado = (await pendentes())[0]!.temporary_attachment_id
    // Se ele chegasse ao navegador, colá-lo no chamado de outra pessoa seria trivial.
    expect(texto).not.toContain(idGravado)
    expect(texto).not.toContain('temporary')
  })

  it('a chave gravada é a NORMALIZADA, a mesma que a criação procura (T-409b)', async () => {
    await chamar(envio({ chaveIdempotencia: 'k3' }))
    const esperada = normalizarChaveIdempotencia({
      via: 'formulario',
      solicitanteEmail: ANA,
      chaveDoCliente: 'k3',
    })
    // Gerada de um lado, lida do outro: divergir aqui é silencioso — o chamado nasce
    // sem anexo e nada dá erro.
    expect((await pendentes())[0]?.chave_idempotencia).toBe(esperada)
    expect((await pendentes())[0]?.chave_idempotencia).not.toBe('k3')
  })

  it('sem chave nenhuma o upload é recusado — não se inventa chave para o anexo', async () => {
    const r = await chamar(envio({}))
    expect(r.status).toBe(400)
    expect(await pendentes()).toHaveLength(0)
    // Chave gerada aqui não casaria com a da criação, e o arquivo ficaria órfão para
    // sempre — a pessoa veria "enviado" e o time de tech não veria nada.
    expect(fake.chamadas.filter((c) => c.operacao === 'subirAnexoTemporario')).toHaveLength(0)
  })

  it('sem arquivo é recusado antes de qualquer chamada à Atlassian', async () => {
    const r = await chamar(envio({ chaveIdempotencia: 'k4' }, null))
    expect(r.status).toBe(400)
    expect(fake.chamadas.filter((c) => c.operacao === 'subirAnexoTemporario')).toHaveLength(0)
  })
})

describe('SC-11 / RF-30 — envio de outra pessoa não entra no meu chamado', () => {
  it('a chave do formulário embute o e-mail, então a de outra pessoa é inalcançável', async () => {
    await chamar(envio({ chaveIdempotencia: 'mesma' }, { nome: 'do-bruno.png' }, BRUNO))
    await chamar(envio({ chaveIdempotencia: 'mesma' }, { nome: 'da-ana.png' }, ANA))

    const linhas = await pendentes()
    expect(linhas).toHaveLength(2)
    // Mesma chave crua, chaves normalizadas diferentes: ninguém alcança a linha do outro.
    expect(new Set(linhas.map((l) => l.chave_idempotencia)).size).toBe(2)

    const daAna = await ctx.anexosPendentes.listarNaoMaterializados(
      normalizarChaveIdempotencia({
        via: 'formulario',
        solicitanteEmail: ANA,
        chaveDoCliente: 'mesma',
      }),
      ANA,
    )
    expect(daAna.map((a) => a.nomeArquivo)).toEqual(['da-ana.png'])
  })

  it('conversa de outra pessoa: 404, e nada sobe', async () => {
    const conversa = await ctx.conversas.criar(ctx.novoId(), BRUNO)
    const r = await chamar(envio({ conversaId: conversa.id }, null, ANA))
    expect(r.status).toBe(404)
    expect(fake.chamadas.filter((c) => c.operacao === 'subirAnexoTemporario')).toHaveLength(0)
  })

  it('o repositório NÃO tem leitura sem e-mail: a de outra pessoa volta vazia', async () => {
    await chamar(envio({ chaveIdempotencia: 'k5' }))
    const chaveDaAna = normalizarChaveIdempotencia({
      via: 'formulario',
      solicitanteEmail: ANA,
      chaveDoCliente: 'k5',
    })
    // O filtro está no `WHERE`, não num `.filter()` depois — mesmo desenho de `vinculos`.
    expect(await ctx.anexosPendentes.listarNaoMaterializados(chaveDaAna, BRUNO)).toHaveLength(0)
  })
})

describe('T-411 / SC-09 — duplo clique no seletor não gera dois temporários', () => {
  it('o mesmo arquivo duas vezes vira uma linha, e é tratado como sucesso', async () => {
    const primeira = await chamar(envio({ chaveIdempotencia: 'k6' }, { nome: 'print.png' }))
    const segunda = await chamar(envio({ chaveIdempotencia: 'k6' }, { nome: 'print.png' }))
    expect(primeira.status).toBe(201)
    // Duplo clique não é erro da pessoa: a resposta diz que está tudo certo.
    expect(segunda.status).toBe(201)
    expect(await pendentes()).toHaveLength(1)
  })

  it('arquivos com nomes diferentes são dois envios, como esperado', async () => {
    await chamar(envio({ chaveIdempotencia: 'k7' }, { nome: 'antes.png' }))
    await chamar(envio({ chaveIdempotencia: 'k7' }, { nome: 'depois.png' }))
    expect(await pendentes()).toHaveLength(2)
  })
})

describe('T-409c / SC-08 — o teto é por chamado, e a recusa é uma MENSAGEM', () => {
  it(`o arquivo ${MAX_ANEXOS_POR_CHAMADO + 1} é recusado dizendo o limite, nunca truncado`, async () => {
    for (let i = 0; i < MAX_ANEXOS_POR_CHAMADO; i += 1) {
      const r = await chamar(envio({ chaveIdempotencia: 'k8' }, { nome: `p${i}.png` }))
      expect(r.status).toBe(201)
    }
    const excedente = await chamar(envio({ chaveIdempotencia: 'k8' }, { nome: 'sobrando.png' }))
    expect(excedente.status).toBe(400)
    const corpo = (await excedente.json()) as { erro: string }
    // `SC-08` exige dizer o limite: um arquivo que some sem nada na tela é a versão
    // silenciosa do problema que esta feature veio resolver.
    expect(corpo.erro).toContain(String(MAX_ANEXOS_POR_CHAMADO))
    expect(await pendentes()).toHaveLength(MAX_ANEXOS_POR_CHAMADO)
  })

  it('o teto é por CHAMADO, então outra chave começa do zero', async () => {
    for (let i = 0; i < MAX_ANEXOS_POR_CHAMADO; i += 1) {
      await chamar(envio({ chaveIdempotencia: 'cheia' }, { nome: `p${i}.png` }))
    }
    const outra = await chamar(envio({ chaveIdempotencia: 'vazia' }, { nome: 'p0.png' }))
    expect(outra.status).toBe(201)
  })

  it('arquivo grande demais é recusado ANTES de tocar a Atlassian', async () => {
    const grande = new Uint8Array(MAX_ANEXO_ENVIADO_BYTES + 1)
    const r = await chamar(envio({ chaveIdempotencia: 'k9' }, { conteudo: grande }))
    expect(r.status).toBe(400)
    expect((await r.json()).erro).toMatch(/MB/)
    expect(fake.chamadas.filter((c) => c.operacao === 'subirAnexoTemporario')).toHaveLength(0)
  })
})

describe('T-410 — a rota herda os gates das rotas de criação', () => {
  it('quem está fora do piloto não sobe arquivo (R-06)', async () => {
    const config = new Config(db)
    await config.definir('emails_piloto', [BRUNO], CHEFE, AGORA)
    ctx = await montarContexto({ DB: db, GOATLAS_USAR_FAKES: '1' }, () => AGORA, () => `id-${++n}`)
    fake = ctx.atlassian as ClienteAtlassianFake

    const r = await chamar(envio({ chaveIdempotencia: 'k10' }, null, ANA))
    expect(r.status).toBe(403)
    expect(fake.chamadas.filter((c) => c.operacao === 'subirAnexoTemporario')).toHaveLength(0)
  })

  it('o envio é AUDITADO — toca a Atlassian, então RN-10 se aplica', async () => {
    await chamar(envio({ chaveIdempotencia: 'k11' }))
    const r = await db.query(
      `SELECT resultado, detalhe_json FROM auditoria WHERE acao = 'anexo_enviado'`,
      [],
    )
    const linhas = linhasComoObjetos<{ resultado: string; detalhe_json: string }>(r)
    expect(linhas).toHaveLength(1)
    expect(linhas[0]?.resultado).toBe('sucesso')
    expect(JSON.parse(linhas[0]!.detalhe_json).etapa).toBe('temporario')
  })

  it('a falha do envio também é auditada, e a resposta é honesta (503)', async () => {
    fake.estado.falhas.subirAnexoTemporario = 'indisponivel'
    const r = await chamar(envio({ chaveIdempotencia: 'k12' }))
    expect(r.status).toBe(503)
    expect(await pendentes()).toHaveLength(0)
    const linhas = linhasComoObjetos<{ resultado: string }>(
      await db.query(`SELECT resultado FROM auditoria WHERE acao = 'anexo_enviado'`, []),
    )
    expect(linhas[0]?.resultado).toBe('falha')
  })
})

describe('SC-10 — somente leitura recusa o upload, sem sucesso simulado', () => {
  it('o decorador barra o upload temporário, que é escrita mesmo sem issueKey', async () => {
    ctx = {
      ...ctx,
      atlassian: new ClienteAtlassianSomenteLeitura(fake),
    } as Contexto
    const r = await chamar(envio({ chaveIdempotencia: 'k13' }))
    expect([400, 503]).toContain(r.status)
    const corpo = (await r.json()) as { erro?: string; mensagem?: string }
    expect(`${corpo.erro ?? ''}${corpo.mensagem ?? ''}`).toMatch(/somente leitura/i)
    // Nada gravado: prometer "enviado" e recusar a criação depois seria o pior resultado.
    expect(await pendentes()).toHaveLength(0)
  })
})

describe('T-406c — o campo de anexo SAI da lista que RF-27 renderiza', () => {
  it('o schema informa que o tipo aceita anexo, mas o campo não vem como input', async () => {
    fake.estado.camposPorTipo.set('rt-1', [
      { fieldId: 'customfield_sistema', rotulo: 'Sistema', obrigatorio: false, tipo: 'texto', opcoes: [] },
      CAMPO_ANEXO,
    ])
    const r = await chamar(
      new Request('https://goatlas.devgogroup.com/api/tipos-chamado/rt-1/campos', {
        headers: { [HEADER_EMAIL]: ANA },
      }),
    )
    expect(r.status).toBe(200)
    const corpo = (await r.json()) as {
      itens: { fieldId: string; tipo: string }[]
      aceitaAnexo: boolean
    }
    // Sem isto a tela mostraria os dois: uma caixa de texto chamada "Anexo" ao lado do
    // seletor de arquivo de verdade.
    expect(corpo.itens.map((i) => i.fieldId)).toEqual(['customfield_sistema'])
    expect(corpo.aceitaAnexo).toBe(true)
  })

  it('tipo sem anexo diz `aceitaAnexo: false` — é o que apaga a pergunta na tela', async () => {
    fake.estado.camposPorTipo.set('rt-1', [])
    const r = await chamar(
      new Request('https://goatlas.devgogroup.com/api/tipos-chamado/rt-1/campos', {
        headers: { [HEADER_EMAIL]: ANA },
      }),
    )
    expect((await r.json()).aceitaAnexo).toBe(false)
  })
})
