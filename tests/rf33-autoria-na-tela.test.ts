/**
 * T-083 — de quem é este comentário, na tela do chamado (`D-43`).
 *
 * O defeito medido na staging em 12/08/2026 (`GN-6897`): o comentário que a pessoa
 * acabou de escrever aparecia com o nome da **conta de serviço** como autor — hoje a
 * conta pessoal de um colega — e, logo abaixo, o prefixo de `D-13` dizendo outro nome.
 * Duas afirmações de autoria contraditórias no mesmo bloco.
 *
 * O que estes testes trancam:
 *
 * - A classificação vem do **mesmo predicado** do SLA (`ehComentarioDoSolicitante`). O
 *   teste **gera com `prefixarAutoria`** e lê pelo caminho de exibição — divergir
 *   quebra a suíte em vez de trocar o rótulo em silêncio, exatamente como em `RF-46`.
 * - O prefixo de `D-13` **não** aparece duas vezes: sai do corpo exibido.
 * - Comentário do time continua nomeando a conta que registrou — apagar o autor de
 *   todos resolveria o caso da conta de serviço e estragaria o caso comum.
 * - A tela **não** tem uma segunda regra própria (varredura estrutural de `src/app/`).
 * - `RF-32`/`RN-05` não afrouxam por causa disto: comentário interno continua fora.
 *
 * _Requirements: RF-31, RF-32, RF-33, RN-05, RNF-30_
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { SqliteLocal } from '@/lib/db/sqlite-local'
import { migrar } from '@/lib/db/schema'
import { Config } from '@/lib/config'
import { montarContexto, type Contexto } from '@/lib/contexto'
import { tratarRequisicao } from '@/lib/http/rotas'
import { HEADER_EMAIL } from '@/lib/auth'
import { ClienteAtlassianFake, NOME_CONTA_DE_SERVICO_FAKE } from '@/lib/atlassian/fake'
import {
  ehComentarioDoSolicitante,
  prefixarAutoria,
} from '@/lib/atlassian/comentarios'
import { paraExibicao } from '@/lib/tickets/comentario-exibicao'

const ANA = 'ana@gocase.com'
const CHEFE = 'chefe@gocase.com'
const AGORA = '2026-08-12T12:00:00.000Z'

let db: SqliteLocal
let ctx: Contexto
let n = 0

beforeEach(async () => {
  db = new SqliteLocal()
  await migrar(db)
  n = 0
  const config = new Config(db)
  await config.definir('dominios_permitidos', ['gocase.com'], CHEFE, AGORA)
  await config.definir('tipos_chamado_permitidos', ['rt-1'], CHEFE, AGORA)
  await config.definir('service_desk_id', 'sd-1', CHEFE, AGORA)
  ctx = await montarContexto({ DB: db, GOATLAS_USAR_FAKES: '1' }, () => AGORA, () => `id-${++n}`)
})

function req(
  caminho: string,
  opcoes: { metodo?: string; email?: string; corpo?: unknown } = {},
): Request {
  const headers: Record<string, string> = {}
  if (opcoes.email) headers[HEADER_EMAIL] = opcoes.email
  return new Request(`https://goatlas.devgogroup.com${caminho}`, {
    method: opcoes.metodo ?? 'GET',
    headers,
    ...(opcoes.corpo === undefined ? {} : { body: JSON.stringify(opcoes.corpo) }),
  })
}

const chamar = (r: Request) => tratarRequisicao(r, ctx, {})

async function abrirChamado(): Promise<string> {
  const r = await chamar(
    req('/api/chamados', {
      metodo: 'POST',
      email: ANA,
      corpo: {
        titulo: 'A impressora do time parou',
        descricao: 'Some da lista de impressoras desde ontem.',
        tipoChamadoId: 'rt-1',
        prioridade: 'normal',
        chaveIdempotencia: 'k-ana',
        temAnexo: false,
      },
    }),
  )
  const corpo = (await r.json()) as { issueKey?: string }
  return corpo.issueKey!
}

interface ComentarioNaTela {
  readonly corpo: string
  readonly autorNome: string
  readonly doSolicitante: boolean
}

async function comentariosDaTela(issueKey: string): Promise<readonly ComentarioNaTela[]> {
  const r = await chamar(req(`/api/chamados/${issueKey}`, { email: ANA }))
  expect(r.status).toBe(200)
  const corpo = (await r.json()) as { comentarios: readonly ComentarioNaTela[] }
  return corpo.comentarios
}

describe('T-083 — o comentário do solicitante é identificado como dele', () => {
  it('⚠️ gerado por `prefixarAutoria`, lido pelo predicado: `doSolicitante` é true', () => {
    // Este é o par que não pode divergir. Se alguém mudar o formato do prefixo em
    // `prefixarAutoria` sem mudar o predicado, é aqui que a suíte cai — e não na
    // staging, com o nome de um colega em cima do texto de outra pessoa.
    const corpo = prefixarAutoria('Segue o print.', 'Ana Souza', ANA)
    expect(ehComentarioDoSolicitante(corpo)).toBe(true)

    const [exibido] = paraExibicao([
      { id: 'c1', corpo, autorNome: NOME_CONTA_DE_SERVICO_FAKE, criadoEm: AGORA, anexos: [] },
    ])
    expect(exibido!.doSolicitante).toBe(true)
    expect(exibido!.corpo).toBe('Segue o print.')
  })

  it('o prefixo de `D-13` NÃO aparece no corpo exibido — a linha de autor já diz de quem é', () => {
    const [exibido] = paraExibicao([
      {
        id: 'c1',
        corpo: prefixarAutoria('Texto da pessoa.', 'Ana Souza', ANA),
        autorNome: NOME_CONTA_DE_SERVICO_FAKE,
        criadoEm: AGORA,
        anexos: [],
      },
    ])
    expect(exibido!.corpo).not.toMatch(/via goatlas/)
    expect(exibido!.corpo).not.toMatch(/ana@gocase\.com/)
  })

  it('comentário do TIME passa inteiro e não vira "seu"', () => {
    const [exibido] = paraExibicao([
      { id: 't1', corpo: 'Já estamos olhando, Ana.', autorNome: 'Maria Lima', criadoEm: AGORA, anexos: [] },
    ])
    expect(exibido!.doSolicitante).toBe(false)
    // Corpo sem prefixo volta inalterado — não há o que remover.
    expect(exibido!.corpo).toBe('Já estamos olhando, Ana.')
    // ⚠️ O nome continua saindo: apagá-lo resolveria o caso da conta de serviço e
    // estragaria o do agente que respondeu de verdade.
    expect(exibido!.autorNome).toBe('Maria Lima')
  })
})

describe('T-083 — de ponta a ponta pela rota de detalhe', () => {
  it('o comentário que a pessoa acabou de escrever volta marcado como dela', async () => {
    const issueKey = await abrirChamado()
    await chamar(
      req(`/api/chamados/${issueKey}/comentarios`, {
        metodo: 'POST',
        email: ANA,
        corpo: { texto: 'Comentário de teste da bateria E2E.' },
      }),
    )

    const [meu] = await comentariosDaTela(issueKey)
    expect(meu!.doSolicitante).toBe(true)
    expect(meu!.corpo).toBe('Comentário de teste da bateria E2E.')
    // ⚠️ O nome da conta de serviço continua vindo no payload — a tela é que decide
    // não afirmar autoria com ele. O que não pode é ele ser a única coisa na tela.
    expect(meu!.autorNome).toBe(NOME_CONTA_DE_SERVICO_FAKE)
  })

  it('resposta do time vem com `doSolicitante: false`, mesmo saindo da conta de serviço', async () => {
    const issueKey = await abrirChamado()
    const fake = ctx.atlassian as ClienteAtlassianFake
    // O pior caso do `D-43`: alguém do time responde pelo portal com a MESMA conta.
    // Sem prefixo, o app não tem como afirmar quem escreveu — e não afirma.
    fake.simularMudancaDoTime(issueKey, {
      comentarioPublico: {
        corpo: 'Reinstalamos a fila de impressão.',
        autorNome: NOME_CONTA_DE_SERVICO_FAKE,
        criadoEm: AGORA,
      },
    })

    const [doTime] = await comentariosDaTela(issueKey)
    expect(doTime!.doSolicitante).toBe(false)
    expect(doTime!.corpo).toBe('Reinstalamos a fila de impressão.')
  })

  it('os dois lados convivem na mesma conversa, na ordem em que aconteceram', async () => {
    const issueKey = await abrirChamado()
    await chamar(
      req(`/api/chamados/${issueKey}/comentarios`, {
        metodo: 'POST',
        email: ANA,
        corpo: { texto: 'A impressora sumiu de novo.' },
      }),
    )
    ;(ctx.atlassian as ClienteAtlassianFake).simularMudancaDoTime(issueKey, {
      comentarioPublico: { corpo: 'Vamos verificar.', autorNome: 'Maria Lima', criadoEm: AGORA },
    })

    const conversa = await comentariosDaTela(issueKey)
    expect(conversa.map((c) => c.doSolicitante)).toEqual([true, false])
  })

  it('RF-32 / RN-05 — comentário interno continua fora, autoria ou não', async () => {
    const issueKey = await abrirChamado()
    await chamar(
      req(`/api/chamados/${issueKey}/comentarios`, {
        metodo: 'POST',
        email: ANA,
        corpo: { texto: 'Texto público.' },
      }),
    )
    const fake = ctx.atlassian as ClienteAtlassianFake
    // Um interno com o prefixo colado à mão — encena a camada 1 de `RF-32` falhando.
    // Nem com o prefixo (que diria "é seu") ele chega à tela: quem barra é o filtro
    // por `public`, e a classificação de autoria roda **depois** dele.
    fake.simularMudancaDoTime(issueKey, {
      comentarioPublico: {
        corpo: prefixarAutoria('Segredo.', 'Ana Souza', ANA),
        autorNome: 'Maria Lima',
        criadoEm: AGORA,
        publico: false,
      },
    })

    const conversa = await comentariosDaTela(issueKey)
    expect(conversa).toHaveLength(1)
    expect(JSON.stringify(conversa)).not.toMatch(/Segredo/)
  })
})

describe('T-083 — estrutural: a tela não escreve uma segunda regra', () => {
  it('⚠️ nada em `src/app/` reconhece o prefixo de `D-13` por conta própria', () => {
    // Uma condição escrita só na tela diverge em silêncio do predicado do SLA: a tela
    // diria "Você" sobre o que o `RF-46` conta como resposta do time. Mesmo raciocínio
    // de `config/diagnostico.ts` — o console relata, não recalcula.
    const raiz = join(process.cwd(), 'src', 'app')
    const suspeitos: string[] = []
    const varrer = (dir: string): void => {
      for (const entrada of readdirSync(dir)) {
        const caminho = join(dir, entrada)
        if (statSync(caminho).isDirectory()) {
          varrer(caminho)
          continue
        }
        if (!/\.(ts|tsx)$/.test(entrada)) continue
        const texto = readFileSync(caminho, 'utf8')
        // O que se procura é a *regra* remontada na tela: o literal do prefixo ou o
        // nome do par de funções que só o servidor deve usar.
        if (/via goatlas|prefixarAutoria|removerPrefixoAutoria|ehComentarioDoSolicitante/.test(texto)) {
          suspeitos.push(caminho)
        }
      }
    }
    varrer(raiz)
    expect(suspeitos).toEqual([])
  })
})
