/**
 * **T-422 / ScC-7** — o efeito da pergunta obrigatória é medido, não presumido.
 *
 * ## Por que este número existe
 *
 * A spec 005 parte de uma intuição forte e não medida: "o chamado chega sem print, e a
 * primeira resposta vira *consegue mandar um print?*". A pergunta obrigatória cobra uma
 * decisão de **toda** pessoa que abre chamado. Sem este indicador, depois do piloto
 * ninguém conseguiria dizer se ela valeu — e "achamos que melhorou" é o que faz uma
 * fricção dessas ficar para sempre sem revisão.
 *
 * ## As duas armadilhas que os testes daqui travam
 *
 * 1. **O denominador são os PERGUNTADOS.** Contar sobre todos os chamados faria a taxa
 *    cair quando o time criasse um request type sem campo de anexo — mediria a composição
 *    da fila em vez do efeito da pergunta.
 * 2. **`declarouTerEFalhou` é um estado próprio.** É o único caso que exige ação nossa, e
 *    o único que uma taxa sozinha esconderia: derruba a evidência sem ninguém ter deixado
 *    de colaborar.
 *
 * E o sinal é **durável**: vem de `submissoes`, não de `anexos_pendentes` — aquela tabela é
 * expurgada em horas (T-415), e um indicador lido dela mostraria a evidência caindo para
 * zero sem nada ter mudado.
 *
 * _Requirements: RF-55, RF-61, RF-62, RF-63_
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { SqliteLocal } from '@/lib/db/sqlite-local'
import { migrar } from '@/lib/db/schema'
import { Config } from '@/lib/config'
import { montarContexto, type Contexto } from '@/lib/contexto'
import { tratarRequisicao } from '@/lib/http/rotas'
import { HEADER_EMAIL } from '@/lib/auth'
import { ClienteAtlassianFake } from '@/lib/atlassian/fake'
import { lerEntradaDoPainel, resumirEvidencia } from '@/lib/governanca/painel'
import { primeiraLinha } from '@/lib/db/tipos'

const ANA = 'ana@gocase.com'
const CHEFE = 'chefe@gocase.com'
const AGORA = '2026-08-07T12:00:00.000Z'

describe('resumirEvidencia — função pura, e as duas armadilhas', () => {
  it('o denominador são os perguntados, não os chamados', () => {
    const r = resumirEvidencia([
      { declarouAnexo: true, anexosAnexados: 1 },
      { declarouAnexo: false, anexosAnexados: null },
      // Tipo que não aceita anexo: fora do denominador.
      { declarouAnexo: null, anexosAnexados: null },
      { declarouAnexo: null, anexosAnexados: null },
    ])
    expect(r.chamadosCriados).toBe(4)
    expect(r.perguntados).toBe(2)
    expect(r.semPergunta).toBe(2)
    // 1 de 2, não 1 de 4 — senão criar um request type sem anexo derrubaria a taxa.
    expect(r.taxaPct).toBe(50)
  })

  it('"disse que tinha e não subiu" é um estado próprio, não um zero qualquer', () => {
    const r = resumirEvidencia([
      { declarouAnexo: true, anexosAnexados: 0 },
      { declarouAnexo: true, anexosAnexados: null },
      { declarouAnexo: false, anexosAnexados: null },
    ])
    expect(r.declarouTerEFalhou).toBe(2)
    expect(r.declarouNaoTer).toBe(1)
    expect(r.comEvidencia).toBe(0)
    expect(r.taxaPct).toBe(0)
  })

  it('sem ninguém perguntado a taxa é `null`, nunca `0%`', () => {
    // Mesmo raciocínio de T-095: "0% chegam com anexo" leria como "a pergunta não
    // funciona", quando na verdade ninguém foi perguntado ainda.
    expect(resumirEvidencia([]).taxaPct).toBeNull()
    expect(resumirEvidencia([{ declarouAnexo: null, anexosAnexados: null }]).taxaPct).toBeNull()
  })

  it('vários arquivos no mesmo chamado contam UM chamado com evidência', () => {
    const r = resumirEvidencia([{ declarouAnexo: true, anexosAnexados: 3 }])
    expect(r.comEvidencia).toBe(1)
    expect(r.taxaPct).toBe(100)
  })
})

describe('o número é DURÁVEL — sobrevive ao expurgo dos pendentes', () => {
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
    await config.definir('tipos_chamado_permitidos', ['rt-1'], CHEFE, AGORA)
    await config.definir('service_desk_id', 'sd-1', CHEFE, AGORA)
    ctx = await montarContexto(
      { DB: db, GOATLAS_USAR_FAKES: '1' },
      () => AGORA,
      () => `id-${++n}`,
    )
    fake = ctx.atlassian as ClienteAtlassianFake
    fake.estado.tiposChamado = [
      { id: 'rt-1', serviceDeskId: 'sd-1', nome: 'Suporte', descricao: null },
    ]
    fake.estado.camposPorTipo.set('rt-1', [
      { fieldId: 'customfield_20031', rotulo: 'Anexo', obrigatorio: false, tipo: 'anexo', opcoes: [] },
    ])
  })

  const chamar = (r: Request) => tratarRequisicao(r, ctx, {})

  async function subirEcriar(chave: string, declarouAnexo: boolean) {
    if (declarouAnexo) {
      const form = new FormData()
      form.append('chaveIdempotencia', chave)
      form.append('arquivo', new File(['print'], 'print.png', { type: 'image/png' }))
      await chamar(
        new Request('https://goatlas.devgogroup.com/api/anexos-pendentes', {
          method: 'POST',
          headers: { [HEADER_EMAIL]: ANA },
          body: form,
        }),
      )
    }
    return chamar(
      new Request('https://goatlas.devgogroup.com/api/chamados', {
        method: 'POST',
        headers: { [HEADER_EMAIL]: ANA },
        body: JSON.stringify({
          titulo: 'O relatório de vendas veio errado',
          descricao: 'Os totais de ontem não fecham com o painel.',
          tipoChamadoId: 'rt-1',
          prioridade: 'alta',
          chaveIdempotencia: chave,
          declarouAnexo,
        }),
      }),
    )
  }

  it('a contagem vem de `submissoes` e sobrevive ao expurgo de `anexos_pendentes`', async () => {
    await subirEcriar('k1', true)
    await subirEcriar('k2', false)

    const antes = resumirEvidencia((await lerEntradaDoPainel(db, DADOS)).anexosPorChamado)
    expect(antes.comEvidencia).toBe(1)
    expect(antes.perguntados).toBe(2)

    // O expurgo de T-415 apaga a tabela inteira; o indicador não pode se mexer.
    await ctx.anexosPendentes.expurgarAnterioresA('2099-01-01T00:00:00.000Z')
    expect(
      primeiraLinha<{ n: number }>(
        await db.query(`SELECT COUNT(*) AS n FROM anexos_pendentes`, []),
      )?.n,
    ).toBe(0)

    const depois = resumirEvidencia((await lerEntradaDoPainel(db, DADOS)).anexosPorChamado)
    expect(depois).toEqual(antes)
  })

  it('anexo que falhou grava `0`, e o painel o mostra como "disse que tinha e não subiu"', async () => {
    const form = new FormData()
    form.append('chaveIdempotencia', 'k3')
    form.append('arquivo', new File(['print'], 'print.png', { type: 'image/png' }))
    await chamar(
      new Request('https://goatlas.devgogroup.com/api/anexos-pendentes', {
        method: 'POST',
        headers: { [HEADER_EMAIL]: ANA },
        body: form,
      }),
    )
    fake.estado.falhas.materializarAnexos = 'indisponivel'
    await chamar(
      new Request('https://goatlas.devgogroup.com/api/chamados', {
        method: 'POST',
        headers: { [HEADER_EMAIL]: ANA },
        body: JSON.stringify({
          titulo: 'O relatório de vendas veio errado',
          descricao: 'Os totais de ontem não fecham com o painel.',
          tipoChamadoId: 'rt-1',
          prioridade: 'alta',
          chaveIdempotencia: 'k3',
          declarouAnexo: true,
        }),
      }),
    )
    const e = resumirEvidencia((await lerEntradaDoPainel(db, DADOS)).anexosPorChamado)
    expect(e.declarouTerEFalhou).toBe(1)
    expect(e.comEvidencia).toBe(0)
  })

  it('submissão PENDENTE fica fora: culpar a feature por uma queda do Jira seria errado', async () => {
    fake.estado.falhas.criarChamado = 'indisponivel'
    await subirEcriar('k4', true)
    const e = resumirEvidencia((await lerEntradaDoPainel(db, DADOS)).anexosPorChamado)
    expect(e.chamadosCriados).toBe(0)
    expect(e.taxaPct).toBeNull()
  })
})

const DADOS = {
  thresholds: {},
  notificacoes: { pendente: 0, enviada: 0, falha: 0, suprimida: 0 } as const,
  telemetria: { total429: 0, totalRequisicoes: 0 },
  sla: {
    totalAvaliados: 0,
    respondidos: 0,
    dentroDoPrazo: 0,
    aderenciaPct: null,
    emRisco: 0,
    estourados: 0,
  },
}
