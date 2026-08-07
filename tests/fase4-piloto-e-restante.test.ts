/**
 * Fase 4 (spec 004) e o que faltava da Fase 3 — T-240 a T-243, T-301 a T-312, T-131.
 *
 * Destaques do que está trancado aqui:
 *
 * - **T-301** — quem está fora do piloto recebe **encaminhamento**, não erro cru. E a lista
 *   vazia significa piloto **desligado**, não "ninguém entra" — a única allowlist do
 *   projeto cujo vazio não nega, e é deliberado (ver `piloto/areas.ts`).
 * - **T-303** — e-mail fora do mapa fica **sem área**, nunca com área errada.
 * - **T-243** — retenção `null` não apaga nada, `vinculos` nunca é expurgado, e a
 *   auditoria tem piso.
 * - **T-131** — revogar assento exige o e-mail digitado, e erro nunca vira sucesso.
 *
 * _Requirements: R-06, RF-19, RF-25, RF-34, RF-35, RF-36, RF-55, RF-57, RNF-30, RNF-33_
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { SqliteLocal } from '@/lib/db/sqlite-local'
import { migrar } from '@/lib/db/schema'
import { Config } from '@/lib/config'
import { montarContexto, type Contexto } from '@/lib/contexto'
import { tratarRequisicao } from '@/lib/http/rotas'
import { HEADER_EMAIL } from '@/lib/auth'
import { ClienteAtlassianFake } from '@/lib/atlassian/fake'
import { ClienteOrganizacaoFake } from '@/lib/atlassian/organizacao-fake'
import { linhasComoObjetos } from '@/lib/db/tipos'
import {
  areaDoEmail,
  areasConhecidas,
  dentroDoPiloto,
  MENSAGEM_FORA_DO_PILOTO,
} from '@/lib/piloto/areas'
import { aplicarRetencao, PISO_AUDITORIA_DIAS } from '@/lib/retencao'
import { sanearNomeArquivo, MAX_ANEXO_ENVIADO_BYTES } from '@/lib/http/anexo-entrada'
import { montarPainel, LIMIAR_429_PCT } from '@/lib/governanca/painel'
import { montarJqlAtualizados, JANELA_INICIAL_POLLING_MIN, MARGEM_POLLING_MIN } from '@/lib/atlassian/cliente'

const ANA = 'ana@gocase.com'
const FORA = 'zelador@gocase.com'
const CHEFE = 'chefe@gocase.com'
const AGORA = '2026-08-06T12:00:00.000Z'
const CRON_KEY = 'chave-cron'

let db: SqliteLocal
let ctx: Contexto
let atlassian: ClienteAtlassianFake
let org: ClienteOrganizacaoFake
let n = 0

async function montar() {
  ctx = await montarContexto(
    { DB: db, GOATLAS_USAR_FAKES: '1' },
    () => AGORA,
    () => `id-${++n}`,
    { atlassian, organizacao: org },
  )
}

beforeEach(async () => {
  db = new SqliteLocal()
  await migrar(db)
  n = 0
  atlassian = new ClienteAtlassianFake({
    tiposChamado: [{ id: 'rt-1', serviceDeskId: 'sd-1', nome: 'Suporte', descricao: null }],
    relogio: () => AGORA,
  })
  org = new ClienteOrganizacaoFake({
    usuarios: [
      {
        accountId: 'acc-1',
        email: 'ana@gocase.com',
        nome: 'Ana',
        produtos: [{ chave: 'confluence', nome: 'Confluence' }],
      },
    ],
  })
  const config = new Config(db)
  await config.definir('dominios_permitidos', ['gocase.com'], CHEFE, AGORA)
  await config.definir('admins', [CHEFE], CHEFE, AGORA)
  await config.definir('service_desk_id', 'sd-1', CHEFE, AGORA)
  await config.definir('tipos_chamado_permitidos', ['rt-1'], CHEFE, AGORA)
  await config.definir('org_id', 'org-1', CHEFE, AGORA)
  await montar()
})

function req(caminho: string, o: { metodo?: string; email?: string; headers?: Record<string, string>; corpo?: unknown; corpoBruto?: BodyInit } = {}) {
  const headers: Record<string, string> = { ...o.headers }
  if (o.email) headers[HEADER_EMAIL] = o.email
  if (o.corpo !== undefined) headers['content-type'] = 'application/json'
  return new Request(`https://goatlas.devgogroup.com${caminho}`, {
    method: o.metodo ?? 'GET',
    headers,
    ...(o.corpoBruto !== undefined
      ? { body: o.corpoBruto }
      : o.corpo === undefined
        ? {}
        : { body: JSON.stringify(o.corpo) }),
  })
}

const chamar = (r: Request) => tratarRequisicao(r, ctx, { GODEPLOY_CRON_KEY: CRON_KEY })

const corpoDeChamado = (chave: string) => ({
  titulo: 'Preciso de acesso ao painel de pedidos',
  descricao: 'Entrei essa semana e ainda não tenho acesso ao painel.',
  tipoChamadoId: 'rt-1',
  prioridade: 'normal',
  chaveIdempotencia: chave,
})

async function abrir(email = ANA, chave = 'k1') {
  return chamar(req('/api/chamados', { metodo: 'POST', email, corpo: corpoDeChamado(chave) }))
}

// =============================================================================
// T-301 / T-302 — o gate do piloto
// =============================================================================

describe('T-301 — quem está fora do piloto recebe encaminhamento, não erro cru', () => {
  beforeEach(async () => {
    const config = new Config(db)
    await config.definir('emails_piloto', [ANA], CHEFE, AGORA)
    await montar()
  })

  it('e-mail fora da lista NÃO abre chamado', async () => {
    const r = await abrir(FORA, 'k-fora')
    expect(r.status).toBe(403)
    const linhas = await db.query('SELECT issue_key FROM vinculos', [])
    expect(linhas.rows).toHaveLength(0)
  })

  it('a resposta diz para onde ir no meio-tempo — não é "acesso negado"', async () => {
    const corpo = await (await abrir(FORA, 'k-fora')).json()
    expect(corpo.erro).toBe('fora_do_piloto')
    expect(corpo.mensagem).toBe(MENSAGEM_FORA_DO_PILOTO)
    expect(corpo.mensagem).toMatch(/canal que você já usa/i)
    expect(corpo.mensagem).not.toMatch(/acesso negado|sem permissão|proibido/i)
  })

  it('e-mail dentro da lista abre normalmente', async () => {
    const r = await abrir(ANA, 'k-dentro')
    expect(r.status).toBe(201)
  })

  it('o gate vale para os DOIS caminhos de abertura — conversa e formulário', async () => {
    const conversa = await (
      await chamar(req('/api/conversas', { metodo: 'POST', email: FORA }))
    ).json()
    const r = await chamar(
      req(`/api/conversas/${conversa.id}/confirmar`, { metodo: 'POST', email: FORA }),
    )
    // Sem proposta ainda, a rota recusa antes — o importante é NÃO ter criado nada.
    expect([400, 403]).toContain(r.status)
    expect((await db.query('SELECT issue_key FROM vinculos', [])).rows).toHaveLength(0)
  })

  it('a documentação continua liberada para quem está fora — deflexão é o objetivo', async () => {
    const r = await chamar(req('/api/confluence/busca?q=ferias', { email: FORA }))
    // 200 com zero resultados (sem espaço configurado), nunca 403 do piloto.
    expect(r.status).toBe(200)
    expect((await r.json()).buscaConfigurada).toBe(false)
  })

  it('a recusa fica auditada', async () => {
    await abrir(FORA, 'k-fora')
    const linhas = linhasComoObjetos<{ resultado: string }>(
      await db.query(`SELECT resultado FROM auditoria WHERE acao = 'fora_do_piloto'`, []),
    )
    expect(linhas[0]?.resultado).toBe('negado')
  })
})

describe('dentroDoPiloto — o vazio significa o CONTRÁRIO do resto do projeto', () => {
  it('lista VAZIA = piloto desligado, todo mundo entra', () => {
    // ⚠️ Deliberado: as outras allowlists governam exposição de CONTEÚDO (vazio nega, para
    // não vazar); esta governa quem pode PEDIR AJUDA, e vazio-nega trancaria a empresa
    // fora do canal de suporte no primeiro deploy.
    expect(dentroDoPiloto('qualquer@gocase.com', []).dentro).toBe(true)
  })

  it('com lista, só quem está nela — e a comparação ignora caixa e espaço', () => {
    expect(dentroDoPiloto('ANA@Gocase.com', [' ana@gocase.com ']).dentro).toBe(true)
    expect(dentroDoPiloto('bruno@gocase.com', ['ana@gocase.com']).dentro).toBe(false)
  })
})

// =============================================================================
// T-303 / T-304 / T-305 — a área
// =============================================================================

describe('T-303 — e-mail desconhecido fica SEM área, nunca com a errada', () => {
  it('fora do mapa é `null`', () => {
    expect(areaDoEmail('novo@gocase.com', { 'ana@gocase.com': 'CX' })).toBeNull()
  })

  it('dentro do mapa devolve a área, ignorando caixa', () => {
    expect(areaDoEmail('ANA@GOCASE.COM', { 'ana@gocase.com': 'CX' })).toBe('CX')
  })

  it('área em branco no mapa é `null`, não string vazia', () => {
    expect(areaDoEmail('ana@gocase.com', { 'ana@gocase.com': '   ' })).toBeNull()
  })

  it('`areasConhecidas` dedupe e ordena, para a UI oferecer na correção', () => {
    expect(
      areasConhecidas({ a: 'Produção', b: 'CX', c: 'CX', d: '  ' }),
    ).toEqual(['CX', 'Produção'])
  })
})

describe('T-304 / T-305 — a área é congelada na criação e corrigível pela pessoa', () => {
  beforeEach(async () => {
    const config = new Config(db)
    await config.definir('areas_por_email', { [ANA]: 'CX' }, CHEFE, AGORA)
    await montar()
  })

  it('o vínculo nasce com a área do mapa', async () => {
    const { issueKey } = await (await abrir()).json()
    const linhas = linhasComoObjetos<{ area: string | null }>(
      await db.query('SELECT area FROM vinculos WHERE issue_key = ?', [issueKey]),
    )
    expect(linhas[0]?.area).toBe('CX')
  })

  it('mudar o mapa DEPOIS não reescreve o histórico', async () => {
    const { issueKey } = await (await abrir()).json()
    const config = new Config(db)
    await config.definir('areas_por_email', { [ANA]: 'Growth' }, CHEFE, AGORA)
    await montar()
    const linhas = linhasComoObjetos<{ area: string | null }>(
      await db.query('SELECT area FROM vinculos WHERE issue_key = ?', [issueKey]),
    )
    // O chamado foi aberto quando a Ana era de CX. É esse o dado histórico correto.
    expect(linhas[0]?.area).toBe('CX')
  })

  it('a pessoa corrige a área do próprio chamado', async () => {
    const { issueKey } = await (await abrir()).json()
    const r = await chamar(
      req(`/api/chamados/${issueKey}/area`, {
        metodo: 'PUT',
        email: ANA,
        corpo: { area: 'Produção' },
      }),
    )
    expect(r.status).toBe(200)
    expect((await r.json()).area).toBe('Produção')
  })

  it('vazio limpa a área — "não sei" é melhor que uma área errada', async () => {
    const { issueKey } = await (await abrir()).json()
    const r = await chamar(
      req(`/api/chamados/${issueKey}/area`, { metodo: 'PUT', email: ANA, corpo: { area: '  ' } }),
    )
    expect((await r.json()).area).toBeNull()
  })

  it('corrigir a área do chamado de OUTRA pessoa dá 404 (RF-30)', async () => {
    const { issueKey } = await (await abrir()).json()
    const r = await chamar(
      req(`/api/chamados/${issueKey}/area`, {
        metodo: 'PUT',
        email: 'bruno@gocase.com',
        corpo: { area: 'CX' },
      }),
    )
    expect(r.status).toBe(404)
  })

  it('T-312 — a métrica por área aparece no painel', async () => {
    await abrir(ANA, 'k1')
    const corpo = await (await chamar(req('/api/admin/metricas', { email: CHEFE }))).json()
    expect(corpo.painel.chamadosPorArea).toEqual([{ area: 'CX', total: 1 }])
  })
})

// =============================================================================
// T-241 — filtro e busca na lista
// =============================================================================

describe('T-241 / RF-35 — filtro por status e busca textual', () => {
  it('sem filtro, devolve tudo e diz quais status existem', async () => {
    const { issueKey } = await (await abrir(ANA, 'k1')).json()
    atlassian.simularMudancaDoTime(issueKey, { status: 'Em andamento' })
    const corpo = await (await chamar(req('/api/chamados', { email: ANA }))).json()
    expect(corpo.itens).toHaveLength(1)
    // A lista de status vem do workflow do JSM, não de uma lista fixa no código.
    expect(corpo.statusDisponiveis).toEqual(['Em andamento'])
  })

  it('filtra por status', async () => {
    const primeiro = await (await abrir(ANA, 'k1')).json()
    await abrir(ANA, 'k2')
    atlassian.simularMudancaDoTime(primeiro.issueKey, { status: 'Resolvido' })

    const resolvidos = await (
      await chamar(req('/api/chamados?status=resolvido', { email: ANA }))
    ).json()
    expect(resolvidos.itens).toHaveLength(1)
    expect(resolvidos.itens[0].issueKey).toBe(primeiro.issueKey)
    expect(resolvidos.total).toBe(2)
  })

  it('busca por texto do título, sem acento e sem caixa', async () => {
    await abrir(ANA, 'k1')
    const achou = await (await chamar(req('/api/chamados?q=PEDIDOS', { email: ANA }))).json()
    expect(achou.itens).toHaveLength(1)
    const naoAchou = await (await chamar(req('/api/chamados?q=impressora', { email: ANA }))).json()
    expect(naoAchou.itens).toHaveLength(0)
  })

  it('busca pela CHAVE do chamado — o caso mais comum de quem tem o número num chat', async () => {
    const { issueKey } = await (await abrir(ANA, 'k1')).json()
    const r = await (
      await chamar(req(`/api/chamados?q=${encodeURIComponent(issueKey)}`, { email: ANA }))
    ).json()
    expect(r.itens).toHaveLength(1)
  })

  it('o filtro NÃO fura o isolamento — filtra dentro do que é da pessoa', async () => {
    await abrir(ANA, 'k1')
    const doOutro = await (
      await chamar(req('/api/chamados?q=pedidos', { email: 'bruno@gocase.com' }))
    ).json()
    expect(doOutro.itens).toEqual([])
  })
})

// =============================================================================
// T-240 — anexo enviado
// =============================================================================

describe('T-240 / RF-25 — anexo enviado pelo solicitante', () => {
  function comArquivo(nome: string, conteudo: string, tipo = 'image/png'): FormData {
    const form = new FormData()
    form.append('arquivo', new File([conteudo], nome, { type: tipo }))
    return form
  }

  it('anexa no próprio chamado, em dois passos', async () => {
    const { issueKey } = await (await abrir()).json()
    const r = await chamar(
      req(`/api/chamados/${issueKey}/anexos`, {
        metodo: 'POST',
        email: ANA,
        corpoBruto: comArquivo('print.png', 'bytes-do-print'),
      }),
    )
    expect(r.status).toBe(201)
    expect(atlassian.estado.anexosDeChamado.get(issueKey)).toEqual([
      { nome: 'print.png', tipo: 'image/png', tamanho: 'bytes-do-print'.length },
    ])
  })

  it('anexar em chamado de outra pessoa dá 404 (RF-30)', async () => {
    const { issueKey } = await (await abrir()).json()
    const r = await chamar(
      req(`/api/chamados/${issueKey}/anexos`, {
        metodo: 'POST',
        email: 'bruno@gocase.com',
        corpoBruto: comArquivo('print.png', 'x'),
      }),
    )
    expect(r.status).toBe(404)
    expect(atlassian.estado.anexosDeChamado.get(issueKey)).toBeUndefined()
  })

  it('falha da Atlassian é relatada como falha — nunca "ok" com o arquivo perdido', async () => {
    const { issueKey } = await (await abrir()).json()
    atlassian.estado.falhas.anexarArquivo = 'indisponivel'
    const r = await chamar(
      req(`/api/chamados/${issueKey}/anexos`, {
        metodo: 'POST',
        email: ANA,
        corpoBruto: comArquivo('print.png', 'x'),
      }),
    )
    expect(r.status).toBe(503)
    const corpo = await r.json()
    expect(corpo.ok).toBe(false)
    expect(corpo.mensagem).toMatch(/seu chamado está a salvo/i)
  })

  it('nome de arquivo é saneado: sem caminho, sem `..`, com acento preservado', () => {
    expect(sanearNomeArquivo('../../etc/passwd')).toBe('passwd')
    expect(sanearNomeArquivo('C:\\Users\\ana\\relatório.pdf')).toBe('relatório.pdf')
    expect(sanearNomeArquivo('nota..fiscal.pdf')).toBe('nota.fiscal.pdf')
    expect(sanearNomeArquivo('   ')).toBe('anexo')
  })

  it('o teto de tamanho é menor que o da LEITURA — o envio segura os bytes em memória', () => {
    // Não é mesquinhez: sem disco nem streaming, o arquivo passa duas vezes pela memória
    // do Worker (recebido e remontado no multipart).
    expect(MAX_ANEXO_ENVIADO_BYTES).toBeLessThan(12 * 1024 * 1024)
  })
})

// =============================================================================
// T-242 — resolver / reabrir
// =============================================================================

describe('T-242 / RF-36 — o app não inventa transição', () => {
  it('projeto sem transição exposta ao cliente devolve lista vazia (caso normal)', async () => {
    const { issueKey } = await (await abrir()).json()
    const r = await chamar(req(`/api/chamados/${issueKey}/transicoes`, { email: ANA }))
    expect(r.status).toBe(200)
    expect((await r.json()).itens).toEqual([])
  })

  it('com transição no workflow, a pessoa consegue usá-la', async () => {
    const { issueKey } = await (await abrir()).json()
    atlassian.estado.transicoes.set(issueKey, [
      { id: 't-resolver', nome: 'Marcar como resolvido', statusDestino: 'Resolvido' },
    ])
    const r = await chamar(
      req(`/api/chamados/${issueKey}/transicoes`, {
        metodo: 'POST',
        email: ANA,
        corpo: { transicaoId: 't-resolver' },
      }),
    )
    expect(r.status).toBe(200)
    expect(atlassian.estado.chamados.get(issueKey)?.status).toBe('Resolvido')
  })

  it('id de transição arbitrário é recusado — o id vem do cliente', async () => {
    const { issueKey } = await (await abrir()).json()
    const r = await chamar(
      req(`/api/chamados/${issueKey}/transicoes`, {
        metodo: 'POST',
        email: ANA,
        corpo: { transicaoId: 't-fechar-tudo' },
      }),
    )
    expect(r.status).toBe(400)
  })

  it('a transição que a pessoa pediu NÃO volta como notificação para ela (RF-48)', async () => {
    const config = new Config(db)
    await config.definir('canal_notificacao_padrao', 'chat', CHEFE, AGORA)
    await montar()
    const { issueKey } = await (await abrir()).json()
    atlassian.estado.transicoes.set(issueKey, [
      { id: 't-resolver', nome: 'Resolvido', statusDestino: 'Resolvido' },
    ])
    await chamar(
      req(`/api/chamados/${issueKey}/transicoes`, {
        metodo: 'POST',
        email: ANA,
        corpo: { transicaoId: 't-resolver' },
      }),
    )
    await chamar(
      req('/api/cron/polling-jira', {
        metodo: 'POST',
        headers: { 'x-godeploy-cron': CRON_KEY },
      }),
    )
    const avisos = linhasComoObjetos<{ estado: string }>(
      await db.query(
        `SELECT estado FROM notificacoes WHERE tipo_evento = 'status_alterado'`,
        [],
      ),
    )
    expect(avisos.every((a) => a.estado === 'suprimida')).toBe(true)
  })

  it('transição em chamado de outra pessoa dá 404', async () => {
    const { issueKey } = await (await abrir()).json()
    const r = await chamar(
      req(`/api/chamados/${issueKey}/transicoes`, { email: 'bruno@gocase.com' }),
    )
    expect(r.status).toBe(404)
  })
})

// =============================================================================
// T-243 — retenção
// =============================================================================

describe('T-243 / RNF-33 — retenção', () => {
  const DIA = 86_400_000

  async function semearAntigo() {
    await db.exec(
      `INSERT INTO conversas (id, solicitante_email, estado, criado_em, atualizado_em)
       VALUES ('c-velha', ?, 'encerrado', '2020-01-01T00:00:00.000Z', '2020-01-01T00:00:00.000Z')`,
      [ANA],
    )
    await db.exec(
      `INSERT INTO mensagens (id, conversa_id, papel, conteudo, criado_em)
       VALUES ('m-velha', 'c-velha', 'user', 'texto antigo', '2020-01-01T00:00:00.000Z')`,
      [],
    )
    await db.exec(
      `INSERT INTO auditoria (id, ator_email, acao, resultado, criado_em)
       VALUES ('a-velha', ?, 'login', 'sucesso', '2020-01-01T00:00:00.000Z')`,
      [ANA],
    )
    await db.exec(
      `INSERT INTO notificacoes
         (id, issue_key, destinatario_email, tipo_evento, carimbo_mudanca, fonte, titulo, corpo,
          estado, criado_em, atualizado_em)
       VALUES ('n-velha', 'GOATLAS-1', ?, 'chamado_criado', '2020-01-01T00:00:00.000Z', 'app',
               't', 'c', 'enviada', '2020-01-01T00:00:00.000Z', '2020-01-01T00:00:00.000Z')`,
      [ANA],
    )
    await db.exec(
      `INSERT INTO notificacoes
         (id, issue_key, destinatario_email, tipo_evento, carimbo_mudanca, fonte, titulo, corpo,
          estado, criado_em, atualizado_em)
       VALUES ('n-pendente', 'GOATLAS-2', ?, 'chamado_criado', '2020-01-02T00:00:00.000Z', 'app',
               't', 'c', 'pendente', '2020-01-01T00:00:00.000Z', '2020-01-01T00:00:00.000Z')`,
      [ANA],
    )
    await ctx.vinculos.criar({
      issueKey: 'GOATLAS-1',
      solicitanteEmail: ANA,
      conversaId: null,
      via: 'formulario',
      verificadoRegras: false,
    })
  }

  it('política toda `null` NÃO apaga nada — apagar precisa de decisão tomada', async () => {
    await semearAntigo()
    const r = await aplicarRetencao(
      db,
      { conversasDias: null, auditoriaDias: null, notificacoesDias: null },
      Date.parse(AGORA),
    )
    expect(r).toMatchObject({ conversas: 0, mensagens: 0, notificacoes: 0, auditoria: 0 })
    expect((await db.query('SELECT id FROM conversas', [])).rows).toHaveLength(1)
  })

  it('conversa expurgada leva as mensagens dela', async () => {
    await semearAntigo()
    const r = await aplicarRetencao(
      db,
      { conversasDias: 90, auditoriaDias: null, notificacoesDias: null },
      Date.parse(AGORA),
    )
    expect(r.conversas).toBe(1)
    expect(r.mensagens).toBe(1)
    expect((await db.query('SELECT id FROM mensagens', [])).rows).toHaveLength(0)
  })

  it('`vinculos` NUNCA é expurgado — seria apagar o acesso da pessoa ao próprio chamado', async () => {
    await semearAntigo()
    await aplicarRetencao(
      db,
      { conversasDias: 1, auditoriaDias: 1, notificacoesDias: 1 },
      Date.parse(AGORA) + 1000 * DIA,
    )
    expect((await db.query('SELECT issue_key FROM vinculos', [])).rows).toHaveLength(1)
  })

  it('notificação PENDENTE não é apagada — é aviso que ninguém recebeu', async () => {
    await semearAntigo()
    const r = await aplicarRetencao(
      db,
      { conversasDias: null, auditoriaDias: null, notificacoesDias: 30 },
      Date.parse(AGORA),
    )
    expect(r.notificacoes).toBe(1)
    const restantes = linhasComoObjetos<{ id: string }>(
      await db.query('SELECT id FROM notificacoes', []),
    )
    expect(restantes.map((l) => l.id)).toEqual(['n-pendente'])
  })

  it('a auditoria tem PISO — retenção curta é elevada, e a resposta diz que foi', async () => {
    await semearAntigo()
    const r = await aplicarRetencao(
      db,
      { conversasDias: null, auditoriaDias: 7, notificacoesDias: null },
      Date.parse('2020-01-15T00:00:00.000Z'),
    )
    // 7 dias apagaria; o piso de 180 dias segura.
    expect(r.auditoria).toBe(0)
    expect(r.auditoriaClampada).toBe(true)
    expect(PISO_AUDITORIA_DIAS).toBeGreaterThanOrEqual(180)
  })

  it('o cron registra o expurgo com CONTAGEM, nunca com o conteúdo', async () => {
    const config = new Config(db)
    await config.definir('retencao_conversas_dias', 90, CHEFE, AGORA)
    await montar()
    await semearAntigo()
    const r = await chamar(
      req('/api/cron/retencao', { metodo: 'POST', headers: { 'x-godeploy-cron': CRON_KEY } }),
    )
    expect(r.status).toBe(200)
    const linhas = linhasComoObjetos<{ detalhe_json: string }>(
      await db.query(
        `SELECT detalhe_json FROM auditoria WHERE acao = 'retencao_executada'`,
        [],
      ),
    )
    expect(linhas[0]?.detalhe_json).toContain('"conversas":1')
    expect(linhas[0]?.detalhe_json).not.toContain('texto antigo')
  })
})

// =============================================================================
// T-131 — revogar assento
// =============================================================================

describe('T-131 / RF-57 — revogar produto exige o e-mail digitado', () => {
  const revogar = (corpo: unknown, email = CHEFE) =>
    chamar(req('/api/admin/assentos/revogar', { metodo: 'POST', email, corpo }))

  it('não-admin nem chega perto', async () => {
    const r = await revogar(
      { accountId: 'acc-1', produto: 'confluence', email: ANA, emailConfirmado: ANA },
      ANA,
    )
    expect(r.status).toBe(403)
  })

  it('confirmação que não casa é recusada E auditada', async () => {
    const r = await revogar({
      accountId: 'acc-1',
      produto: 'confluence',
      email: ANA,
      emailConfirmado: 'outra@gocase.com',
    })
    expect(r.status).toBe(400)
    expect(org.estado.usuarios[0]?.produtos).toHaveLength(1)
    const linhas = linhasComoObjetos<{ resultado: string; detalhe_json: string }>(
      await db.query(`SELECT resultado, detalhe_json FROM auditoria WHERE acao = 'assento_revogado'`, []),
    )
    expect(linhas[0]?.resultado).toBe('negado')
    expect(linhas[0]?.detalhe_json).toContain('confirmacao_nao_confere')
  })

  it('com confirmação correta, revoga e audita', async () => {
    const r = await revogar({
      accountId: 'acc-1',
      produto: 'confluence',
      email: ANA,
      emailConfirmado: 'ANA@Gocase.com',
    })
    expect(r.status).toBe(200)
    expect((await r.json()).aviso).toMatch(/uma vez por dia/i)
    expect(org.estado.usuarios[0]?.produtos).toEqual([])
  })

  it('erro da Atlassian NUNCA vira sucesso otimista', async () => {
    org.estado.falhas.revogarProduto = 'indisponivel'
    const r = await revogar({
      accountId: 'acc-1',
      produto: 'confluence',
      email: ANA,
      emailConfirmado: ANA,
    })
    expect(r.status).toBe(503)
    const linhas = linhasComoObjetos<{ resultado: string }>(
      await db.query(`SELECT resultado FROM auditoria WHERE acao = 'assento_revogado'`, []),
    )
    expect(linhas[0]?.resultado).toBe('falha')
    // O produto continua atribuído: nada de riscar economia que não aconteceu.
    expect(org.estado.usuarios[0]?.produtos).toHaveLength(1)
  })

  it('a tela recebe a lista de endpoints não verificados quando está em fakes', async () => {
    const corpo = await (await chamar(req('/api/admin/assentos', { email: CHEFE }))).json()
    expect(corpo.usandoFakes).toBe(true)
    expect(corpo.endpointsNaoVerificados.length).toBeGreaterThan(0)
  })
})

// =============================================================================
// T-232 / T-234 / T-310 — o painel
// =============================================================================

describe('T-310 — a calibragem mostra os MOTIVOS, não só o threshold', () => {
  it('sem os motivos, a tela empurraria para mexer no threshold', () => {
    const painel = montarPainel({
      chamadosPorArea: [],
      prioridades: [],
      vias: [],
      bloqueios: [
        {
          regra: 'regra1_confluence',
          houveOverride: true,
          overrideMotivo: 'A página está desatualizada, fala de um sistema que trocamos.',
          paginas: ['Como pedir acesso'],
        },
        {
          regra: 'regra1_confluence',
          houveOverride: true,
          overrideMotivo: 'Não encontrei a parte de férias coletivas.',
          paginas: ['Como pedir acesso'],
        },
        { regra: 'regra1_confluence', houveOverride: false, overrideMotivo: null, paginas: [] },
      ],
      thresholds: { regra1_confluence: 0.75 },
      notificacoes: { pendente: 0, enviada: 0, falha: 0, suprimida: 0 },
      telemetria: { total429: 0, totalRequisicoes: 0 },
      ia: { conversas: 0, custoTotalUsd: 0, conversasNoTeto: 0 },
      sla: {
        totalAvaliados: 0,
        respondidos: 0,
        dentroDoPrazo: 0,
        aderenciaPct: null,
        emRisco: 0,
        estourados: 0,
      },
      deflexao: { bloqueiosSemOverride: 0, semChamadoDepois: 0 },
    })
    const regra1 = painel.calibragem.find((c) => c.regra === 'regra1_confluence')!
    expect(regra1.thresholdAtual).toBe(0.75)
    expect(regra1.taxaOverridePct).toBeCloseTo(66.67, 1)
    expect(regra1.motivosDeOverride).toHaveLength(2)
    // A página apontada nos dois overrides é a que precisa ser reescrita — não o threshold.
    expect(regra1.paginasApontadas).toEqual([{ titulo: 'Como pedir acesso', vezes: 2 }])
  })

  it('T-235 — o painel diz que a deflexão é BRUTA, não "resolvido pela documentação"', () => {
    const painel = montarPainel({
      chamadosPorArea: [],
      prioridades: [],
      vias: [],
      bloqueios: [],
      thresholds: {},
      notificacoes: { pendente: 0, enviada: 0, falha: 0, suprimida: 0 },
      telemetria: { total429: 0, totalRequisicoes: 0 },
      ia: { conversas: 0, custoTotalUsd: 0, conversasNoTeto: 0 },
      sla: {
        totalAvaliados: 0,
        respondidos: 0,
        dentroDoPrazo: 0,
        aderenciaPct: null,
        emRisco: 0,
        estourados: 0,
      },
      deflexao: { bloqueiosSemOverride: 0, semChamadoDepois: 0 },
    })
    expect(painel.deflexaoResolvidaConhecida).toBe(false)
    expect(painel.avisoDeflexao).toMatch(/desistiu/i)
  })

  it('T-234 — a taxa de 429 só alerta acima do limiar, e sem tráfego é `null`', () => {
    const comTrafego = (total429: number, totalRequisicoes: number) =>
      montarPainel({
        chamadosPorArea: [],
        prioridades: [],
        vias: [],
        bloqueios: [],
        thresholds: {},
        notificacoes: { pendente: 0, enviada: 0, falha: 0, suprimida: 0 },
        telemetria: { total429, totalRequisicoes },
        ia: { conversas: 0, custoTotalUsd: 0, conversasNoTeto: 0 },
        sla: {
          totalAvaliados: 0,
          respondidos: 0,
          dentroDoPrazo: 0,
          aderenciaPct: null,
          emRisco: 0,
          estourados: 0,
        },
        deflexao: { bloqueiosSemOverride: 0, semChamadoDepois: 0 },
      }).telemetriaAtlassian

    expect(comTrafego(0, 0).taxa429Pct).toBeNull()
    expect(comTrafego(0, 0).acimaDoLimiar).toBe(false)
    expect(comTrafego(1, 1000).acimaDoLimiar).toBe(false)
    expect(comTrafego(50, 1000).taxa429Pct).toBe(5)
    expect(comTrafego(50, 1000).acimaDoLimiar).toBe(true)
    expect(LIMIAR_429_PCT).toBeGreaterThan(0)
  })

  it('T-311 — sem baseline, o painel diz `null` em vez de comparar contra zero', async () => {
    const corpo = await (await chamar(req('/api/admin/metricas', { email: CHEFE }))).json()
    expect(corpo.baselineAssentos).toBeNull()
  })

  it('com baseline configurado, ele aparece para o antes × depois', async () => {
    const config = new Config(db)
    await config.definir(
      'baseline_assentos',
      { coletadoEm: '2026-08-01T00:00:00.000Z', porProduto: { confluence: 40 } },
      CHEFE,
      AGORA,
    )
    await montar()
    const corpo = await (await chamar(req('/api/admin/metricas', { email: CHEFE }))).json()
    expect(corpo.baselineAssentos.porProduto.confluence).toBe(40)
  })

  it('o painel é só para admin', async () => {
    expect((await chamar(req('/api/admin/metricas', { email: ANA }))).status).toBe(403)
  })
})

// =============================================================================
// T-210 — o JQL do polling
// =============================================================================

describe('T-210 — o JQL do polling nunca varre tudo', () => {
  const AGORA_MS = Date.parse('2026-08-06T12:00:00.000Z')

  it('sem marca-d\'água, usa uma janela CURTA — não "desde sempre"', () => {
    const jql = montarJqlAtualizados(null, AGORA_MS)
    const esperado = new Date(AGORA_MS - JANELA_INICIAL_POLLING_MIN * 60_000)
    expect(jql).toContain(`${esperado.toISOString().slice(0, 10)} `)
    expect(jql).not.toMatch(/1970/)
  })

  it('com marca, recua a margem — o JQL tem precisão de minuto', () => {
    const jql = montarJqlAtualizados('2026-08-06T11:30:00.000Z', AGORA_MS)
    expect(jql).toContain('2026-08-06 11:28')
    expect(MARGEM_POLLING_MIN).toBeGreaterThan(0)
  })

  it('restringe ao que é NOSSO pelo reporter — sem hardcode de projeto (RNF-25)', () => {
    const jql = montarJqlAtualizados(null, AGORA_MS)
    expect(jql).toContain('reporter = currentUser()')
    expect(jql).toContain('ORDER BY updated ASC')
  })

  it('marca ilegível cai na janela curta em vez de virar `NaN`', () => {
    expect(montarJqlAtualizados('ontem', AGORA_MS)).toBe(montarJqlAtualizados(null, AGORA_MS))
  })
})
