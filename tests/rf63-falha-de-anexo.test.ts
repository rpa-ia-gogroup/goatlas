/**
 * **T-412 a T-416** — o anexo pode falhar; o chamado, não.
 *
 * ## O teste mais importante da spec 005, e por quê
 *
 * `ScC-6`: **nenhum chamado é perdido por causa de anexo.** A v1 do plano punha os ids
 * temporários dentro da chamada de criação, e a cadeia era esta:
 *
 * 1. id expirado → a **criação** responde 400;
 * 2. `atlassian/http.ts` classifica 4xx como **definitivo**;
 * 3. `tickets/servico.ts` marca a submissão como `falha`;
 * 4. submissão `falha` **nunca** é reprocessada.
 *
 * Ou seja: um arquivo velho apagaria o chamado da pessoa, e o pior é que passaria por
 * uma suíte verde — porque nenhum teste montava "id vencido". É o mesmo erro que
 * `rf24-outbox-degradacao` já pegou uma vez, na versão com arquivo.
 *
 * Daí os dois testes que abrem este arquivo afirmarem sobre o **estado da submissão**, e
 * não só sobre o status HTTP: 201 na tela com `estado = 'falha'` no banco seria o bug
 * silencioso completo.
 *
 * ## O outro lado: `SC-07b`
 *
 * Quando a criação vai para o outbox, não há `issueKey` para materializar e o id terá
 * expirado quando o cron rodar. O anexo **não** é carregado para o reprocessamento, e a
 * tela diz isso. Prometer que o arquivo vai junto seria mentira — e mentira que só
 * aparece dias depois, quando alguém procura o print no chamado.
 *
 * _Requirements: RF-61, RF-63, RF-24, RF-44, RN-10, RNF-17, RNF-18, RNF-33_
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { SqliteLocal } from '@/lib/db/sqlite-local'
import { migrar } from '@/lib/db/schema'
import { Config } from '@/lib/config'
import { montarContexto, type Contexto } from '@/lib/contexto'
import { tratarRequisicao } from '@/lib/http/rotas'
import { HEADER_EMAIL } from '@/lib/auth'
import { ClienteAtlassianFake } from '@/lib/atlassian/fake'
import { linhasComoObjetos, primeiraLinha } from '@/lib/db/tipos'
import { TTL_ANEXO_PENDENTE_HORAS } from '@/lib/tickets/anexos-pendentes'

const ANA = 'ana@gocase.com'
const CHEFE = 'chefe@gocase.com'
const AGORA = '2026-08-07T12:00:00.000Z'

let db: SqliteLocal
let ctx: Contexto
let fake: ClienteAtlassianFake
let n = 0

const CAMPO_ANEXO = {
  fieldId: 'attachment',
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

const chamar = (r: Request) => tratarRequisicao(r, ctx, {})

/** Sobe um arquivo pendente para a chave do formulário. */
async function subir(chave: string, nome = 'print.png'): Promise<void> {
  const form = new FormData()
  form.append('chaveIdempotencia', chave)
  form.append('arquivo', new File(['print do erro'], nome, { type: 'image/png' }))
  const r = await chamar(
    new Request('https://goatlas.devgogroup.com/api/anexos-pendentes', {
      method: 'POST',
      headers: { [HEADER_EMAIL]: ANA },
      body: form,
    }),
  )
  if (r.status !== 201) throw new Error(`upload falhou no cenário: ${r.status}`)
}

const BASE = {
  titulo: 'O relatório de vendas veio errado',
  descricao: 'Os totais de ontem não fecham com o painel.',
  tipoChamadoId: 'rt-1',
  prioridade: 'alta',
}

async function criar(chave: string) {
  return chamar(
    new Request('https://goatlas.devgogroup.com/api/chamados', {
      method: 'POST',
      headers: { [HEADER_EMAIL]: ANA },
      body: JSON.stringify({ ...BASE, chaveIdempotencia: chave, declarouAnexo: true }),
    }),
  )
}

async function submissao(chave: string) {
  const r = await db.query(
    `SELECT estado, issue_key, tentativas FROM submissoes WHERE chave_idempotencia = ?`,
    [`form:${ANA}:${chave}`],
  )
  return primeiraLinha<{ estado: string; issue_key: string | null; tentativas: number }>(r)
}

async function auditoria(acao: string) {
  const r = await db.query(
    `SELECT resultado, detalhe_json FROM auditoria WHERE acao = ? ORDER BY criado_em, rowid`,
    [acao],
  )
  return linhasComoObjetos<{ resultado: string; detalhe_json: string | null }>(r)
}

describe('T-412 / ScC-6 — falha de anexo NÃO perde o chamado', () => {
  it('id de anexo VENCIDO (4xx definitivo): chamado criado, submissão `criado`', async () => {
    await subir('k1')
    // O modo de falha que a v1 do plano transformaria em chamado perdido.
    const pendente = await ctx.anexosPendentes.listarNaoMaterializados(`form:${ANA}:k1`, ANA)
    fake.estado.temporariosInvalidos.add(pendente[0]!.temporaryAttachmentId)

    const r = await criar('k1')
    expect(r.status).toBe(201)
    const corpo = (await r.json()) as {
      issueKey: string
      anexo: { estado: string; falharam: string[] }
    }
    expect(corpo.issueKey).toBeTruthy()

    // ⚠️ O coração do teste: o 201 não basta. A submissão precisa estar `criado`, porque
    // `falha` nunca é reprocessada — e seria assim que o chamado se perderia.
    const s = await submissao('k1')
    expect(s?.estado).toBe('criado')
    expect(s?.issue_key).toBe(corpo.issueKey)

    // E a pessoa é informada, com o caminho de `RF-34` à mão.
    expect(corpo.anexo.estado).toBe('falhou')
    expect(corpo.anexo.falharam).toEqual(['print.png'])
  })

  it('envio indisponível (transitório) também não segura o chamado', async () => {
    await subir('k2')
    fake.estado.falhas.materializarAnexos = 'indisponivel'
    const r = await criar('k2')
    expect(r.status).toBe(201)
    expect((await submissao('k2'))?.estado).toBe('criado')
    expect((await r.json()).anexo.estado).toBe('falhou')
  })

  it('a mensagem do anexo que falhou manda anexar depois, sem sugerir que o chamado se perdeu', async () => {
    await subir('k3')
    fake.estado.falhas.materializarAnexos = 'indisponivel'
    const corpo = (await (await criar('k3')).json()) as { anexo: { mensagem: string } }
    expect(corpo.anexo.mensagem).toMatch(/anexar/i)
    expect(corpo.anexo.mensagem).not.toMatch(/perdid|erro interno/i)
  })

  it('T-416 — a falha do envio é AUDITADA, não só relatada na tela', async () => {
    await subir('k4')
    fake.estado.falhas.materializarAnexos = 'indisponivel'
    await criar('k4')
    const linhas = await auditoria('anexo_enviado')
    const materializacao = linhas.filter(
      (l) => JSON.parse(l.detalhe_json ?? '{}').etapa === 'materializacao',
    )
    expect(materializacao).toHaveLength(1)
    expect(materializacao[0]?.resultado).toBe('falha')
  })
})

describe('T-413 — o anexo é materializado DEPOIS da criação, na mesma confirmação', () => {
  it('caminho feliz: uma confirmação, chamado aberto e arquivo já anexado (SC-04)', async () => {
    await subir('k5')
    const r = await criar('k5')
    const corpo = (await r.json()) as {
      issueKey: string
      anexo: { estado: string; anexados: string[] }
    }
    expect(corpo.anexo.estado).toBe('anexado')
    expect(corpo.anexo.anexados).toEqual(['print.png'])
    // No fake, o arquivo está no chamado — uma ação só, sem passo posterior.
    expect(fake.estado.anexosDeChamado.get(corpo.issueKey)?.map((a) => a.nome)).toEqual([
      'print.png',
    ])
  })

  it('a ORDEM importa: criar primeiro, materializar depois', async () => {
    await subir('k6')
    await criar('k6')
    const ops = fake.chamadas.map((c) => c.operacao)
    expect(ops.indexOf('criarChamado')).toBeLessThan(
      ops.indexOf('materializarAnexosTemporarios'),
    )
  })

  it('sem anexo pendente, a resposta diz `sem_anexo` e nada é chamado', async () => {
    const corpo = (await (await criar('k7')).json()) as { anexo: { estado: string } }
    expect(corpo.anexo.estado).toBe('sem_anexo')
    expect(fake.chamadas.filter((c) => c.operacao === 'materializarAnexosTemporarios')).toHaveLength(
      0,
    )
  })

  it('parcial é relatado como parcial, nunca como sucesso', async () => {
    await subir('k8', 'sobe.png')
    await subir('k8', 'nao-sobe.png')
    const pendentes = await ctx.anexosPendentes.listarNaoMaterializados(`form:${ANA}:k8`, ANA)
    const segundo = pendentes.find((p) => p.nomeArquivo === 'nao-sobe.png')!
    fake.estado.temporariosInvalidos.add(segundo.temporaryAttachmentId)

    const corpo = (await (await criar('k8')).json()) as {
      anexo: { estado: string; anexados: string[]; falharam: string[] }
    }
    // Dizer "ok" com um de dois faz a pessoa achar que o time de tech tem o print que
    // faltou — mesmo raciocínio da rota de `RF-34`.
    expect(corpo.anexo.estado).toBe('parcial')
    expect(corpo.anexo.anexados).toEqual(['sobe.png'])
    expect(corpo.anexo.falharam).toEqual(['nao-sobe.png'])
  })
})

describe('T-413b / SC-09 — materialização UMA vez, garantida por constraint', () => {
  it('reconfirmar devolve o mesmo chamado e NÃO anexa de novo', async () => {
    await subir('k9')
    const primeira = (await (await criar('k9')).json()) as { issueKey: string }
    const segunda = (await (await criar('k9')).json()) as {
      issueKey: string
      duplicada: boolean
      anexo: { estado: string }
    }

    expect(segunda.duplicada).toBe(true)
    expect(segunda.issueKey).toBe(primeira.issueKey)
    // Sem a reivindicação por `materializado_em`, o segundo clique anexaria o arquivo de
    // novo — e o chamado do time de tech teria dois prints idênticos.
    expect(
      fake.chamadas.filter((c) => c.operacao === 'materializarAnexosTemporarios'),
    ).toHaveLength(1)
    expect(fake.estado.anexosDeChamado.get(primeira.issueKey)).toHaveLength(1)
    expect(segunda.anexo.estado).toBe('sem_anexo')
  })

  it('a linha fica marcada como materializada', async () => {
    await subir('k10')
    await criar('k10')
    const r = await db.query(`SELECT materializado_em FROM anexos_pendentes`, [])
    expect(primeiraLinha<{ materializado_em: string | null }>(r)?.materializado_em).toBe(AGORA)
  })
})

describe('T-414 / SC-07b — criação diferida NÃO leva o anexo, e a tela diz isso', () => {
  beforeEach(() => {
    // Atlassian fora do ar na criação: a submissão fica `pendente` (RNF-17).
    fake.estado.falhas.criarChamado = 'indisponivel'
  })

  it('sem `issueKey` não há o que materializar, e a resposta avisa', async () => {
    await subir('k11')
    const r = await criar('k11')
    expect(r.status).toBe(201)
    const corpo = (await r.json()) as {
      estado: string
      issueKey: string | null
      anexo: { estado: string; mensagem: string }
    }
    expect(corpo.estado).toBe('pendente')
    expect(corpo.issueKey).toBeNull()
    expect(corpo.anexo.estado).toBe('adiado')
    // Prometer que o arquivo vai junto seria mentira: o envio anterior não sobrevive à
    // espera do cron.
    expect(corpo.anexo.mensagem).toMatch(/anexar/i)
  })

  it('a linha NÃO é reivindicada: o reprocessamento não carrega o anexo', async () => {
    await subir('k12')
    await criar('k12')
    const r = await db.query(`SELECT materializado_em FROM anexos_pendentes`, [])
    // Marcar aqui esconderia o adiamento: a linha pareceria resolvida e o expurgo a
    // levaria sem que ninguém soubesse que o arquivo nunca subiu.
    expect(primeiraLinha<{ materializado_em: string | null }>(r)?.materializado_em).toBeNull()
    expect(
      fake.chamadas.filter((c) => c.operacao === 'materializarAnexosTemporarios'),
    ).toHaveLength(0)
  })
})

describe('T-415 — expurgo com TTL próprio, e curto', () => {
  it('linha mais velha que o TTL sai; a de agora fica', async () => {
    await subir('k13')
    const velha = new Date(
      Date.parse(AGORA) - (TTL_ANEXO_PENDENTE_HORAS + 1) * 3600 * 1000,
    ).toISOString()
    await db.exec(`INSERT INTO anexos_pendentes
        (id, solicitante_email, conversa_id, chave_idempotencia, temporary_attachment_id,
         nome_arquivo, criado_em)
      VALUES ('velha', ?, NULL, 'form:x:antiga', 'tmp-velho', 'antigo.png', ?)`, [ANA, velha])

    const limite = new Date(
      Date.parse(AGORA) - TTL_ANEXO_PENDENTE_HORAS * 3600 * 1000,
    ).toISOString()
    expect(await ctx.anexosPendentes.expurgarAnterioresA(limite)).toBe(1)
    const restantes = linhasComoObjetos<{ id: string }>(
      await db.query(`SELECT id FROM anexos_pendentes`, []),
    )
    expect(restantes).toHaveLength(1)
    expect(restantes[0]?.id).not.toBe('velha')
  })

  it('o expurgo roda no cron do OUTBOX, não no da retenção', async () => {
    const velha = new Date(
      Date.parse(AGORA) - (TTL_ANEXO_PENDENTE_HORAS + 1) * 3600 * 1000,
    ).toISOString()
    await db.exec(`INSERT INTO anexos_pendentes
        (id, solicitante_email, conversa_id, chave_idempotencia, temporary_attachment_id,
         nome_arquivo, criado_em)
      VALUES ('velha', ?, NULL, 'form:x:antiga', 'tmp-velho', 'antigo.png', ?)`, [ANA, velha])

    const r = await tratarRequisicao(
      new Request('https://goatlas.devgogroup.com/api/cron/reprocessar-submissoes', {
        method: 'POST',
        // Rota idempotente sem identidade de usuário: aceita por presença do header, que
        // é o que distingue o gateway da plataforma de um funcionário logado forjando o
        // cabeçalho (`CLAUDE.md`, medido em 07/08/2026).
        headers: { 'x-godeploy-cron': 'chave-cron' },
      }),
      ctx,
      { GODEPLOY_CRON_KEY: 'chave-cron' },
    )
    expect(r.status).toBe(200)
    // ⚠️ A retenção pessoal tem default `null` (`D-20`) e **não apaga nada**, e a rota
    // dela exige HMAC (403 hoje). Pendurar o expurgo lá deixaria a tabela crescer para
    // sempre — a razão de o TTL ser próprio.
    expect((await r.json()).anexosPendentesExpurgados).toBe(1)
    expect(
      linhasComoObjetos(await db.query(`SELECT id FROM anexos_pendentes`, [])),
    ).toHaveLength(0)
  })
})
