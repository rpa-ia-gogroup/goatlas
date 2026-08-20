/**
 * **A rederivação que não regride** — spec 012, `FR-1`…`FR-7`.
 *
 * ## O caso medido, em uma frase
 *
 * 20/08/2026: a pessoa pediu acesso a um sistema, o cartão fechou no primeiro turno, ela
 * explicou **por que** precisava do acesso — e a extração daquele turno devolveu
 * `{"pronto": false, "titulo": "", "descricao": ""}`. O cartão congelou na versão anterior,
 * sem o motivo dela, e a tela não disse nada. Ela foi embora sem chamado, com
 * `podeConfirmar: true` na tela. Reproduzido na staging com modelo real na mesma tarde.
 *
 * ## O que estes casos travam
 *
 * Depois de o cartão existir, a extração deixa de reavaliar "está pronto?" — e **só isso**
 * muda. `RF-08`, `RN-07`, `RF-28` e `RF-17` continuam valendo, e há caso para cada um.
 *
 * ⚠️ **A prova de `FR-1` não pode vir do fake** (`D-47`, cinco ocorrências): `ClienteIAFake`
 * devolve o roteiro sem olhar `pronto`, então um teste sobre o que ele devolveu provaria
 * apenas que o dublê é consistente consigo mesmo. As duas asserções que valem são sobre o
 * que a camada de IA **recebeu** (`extracoesRecebidas`) e sobre o corpo entregue ao
 * `fetchImpl` do cliente **real**.
 *
 * _Requirements: FR-1, FR-2, FR-3, FR-4, FR-5, FR-6, FR-7, SC-1…SC-7_
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { SqliteLocal } from '@/lib/db/sqlite-local'
import { migrar } from '@/lib/db/schema'
import { Config } from '@/lib/config'
import { montarContexto, type Contexto } from '@/lib/contexto'
import { tratarRequisicao } from '@/lib/http/rotas'
import { HEADER_EMAIL } from '@/lib/auth'
import { ClienteAtlassianFake } from '@/lib/atlassian/fake'
import { ClienteIAFake } from '@/lib/ia/fake'
import { ClienteIAHttp, interpretarProposta } from '@/lib/ia/cliente'
import { INSTRUCAO_ATUALIZAR_CARTAO, INSTRUCAO_FECHAR_AGORA, montarPromptAgente } from '@/lib/ia/prompts'
import { linhasComoObjetos } from '@/lib/db/tipos'
import { ReciboConfirmacao } from '@/app/telas'
import type { Proposta } from '@/app/api'

const ANA = 'ana@gocase.com'
const CHEFE = 'chefe@gocase.com'
const AGORA = '2026-08-20T12:00:00.000Z'

/** A resposta medida no caso real: o modelo desiste e esvazia tudo. */
const NAO_PRONTO_VAZIO = JSON.stringify({
  pronto: false,
  titulo: '',
  descricao: '',
  prioridade: 'normal',
  motivoPrioridade: null,
  tipoChamadoId: 'rt-2',
  campos: [],
})

let db: SqliteLocal
let ctx: Contexto
let fake: ClienteAtlassianFake
let ia: ClienteIAFake
let n = 0

beforeEach(async () => {
  db = new SqliteLocal()
  await migrar(db)
  n = 0
  const config = new Config(db)
  await config.definir('dominios_permitidos', ['gocase.com'], CHEFE, AGORA)
  await config.definir('tipos_chamado_permitidos', ['rt-1', 'rt-2'], CHEFE, AGORA)
  await config.definir('service_desk_id', 'sd-1', CHEFE, AGORA)
  // Threshold alto: nenhum bloqueio da Regra 1 atravessa os casos que falam de proposta.
  await config.definir('regra1_threshold_score', 0.99, CHEFE, AGORA)
  // ⚠️ `ATLAS_*`, não `GOATLAS_*`: o código conhece **só** o prefixo novo desde `D-77`, e a
  // ponte para o nome antigo vive num lugar só (`env-do-app.ts`), com teste próprio. Este
  // arquivo nasceu num branch anterior ao rename e o merge não tinha como ver — o typecheck
  // da `main` quebrou no encontro dos dois, que é a única coisa que reprova este par.
  ctx = await montarContexto({ DB: db, ATLAS_USAR_FAKES: '1' }, () => AGORA, () => `id-${++n}`)
  fake = ctx.atlassian as ClienteAtlassianFake
  ia = ctx.ia as ClienteIAFake
  fake.estado.tiposChamado = [
    { id: 'rt-1', serviceDeskId: 'sd-1', nome: 'Relatar um problema', descricao: null },
    { id: 'rt-2', serviceDeskId: 'sd-1', nome: 'Solicitar acesso a um sistema', descricao: null },
  ]
  ia.propostaSugerida = {
    ...ia.propostaSugerida!,
    tipoChamadoId: 'rt-2',
    titulo: 'Solicitação de acesso ao Nexus',
    descricao: 'A pessoa solicita acesso ao sistema Nexus.',
    prioridade: 'normal',
    motivoPrioridade: 'É um pedido de acesso, sem nada parado na operação.',
  }
})

const chamar = (r: Request) => tratarRequisicao(r, ctx, {})

function req(caminho: string, corpo?: unknown, metodo = 'POST', quem = ANA): Request {
  return new Request(`https://atlas.devgogroup.com${caminho}`, {
    method: metodo,
    headers: { [HEADER_EMAIL]: quem },
    ...(corpo === undefined ? {} : { body: JSON.stringify(corpo) }),
  })
}

/** Conversa com as duas verificações de `RF-08` já feitas — o estado de quem negocia. */
async function conversaVerificada(quem = ANA): Promise<string> {
  const c = await ctx.conversas.criar(ctx.novoId(), quem)
  await ctx.conversas.marcarConfluenceVerificado(c.id, false)
  await ctx.conversas.marcarHistoricoVerificado(c.id, false)
  return c.id
}

async function enviar(id: string, texto: string): Promise<Record<string, unknown>> {
  const r = await chamar(req(`/api/conversas/${id}/mensagens`, { texto }))
  expect(r.status).toBe(200)
  return (await r.json()) as Record<string, unknown>
}

const ultimaExtracao = () => ia.extracoesRecebidas[ia.extracoesRecebidas.length - 1]!

describe('FR-1 — cartão que existe não volta a "não estou pronto"', () => {
  it('🚨 com proposta vigente, a extração é avisada de que já há cartão', async () => {
    const id = await conversaVerificada()
    await enviar(id, 'quero solicitar meu acesso ao nexus')
    // Primeiro turno: não havia cartão, então a pergunta "está pronto?" continua valendo.
    expect(ultimaExtracao().cartaoVigente).not.toBe(true)

    await enviar(
      id,
      'para corrigir problemas da integração nexus x factory preciso ver os dados nas duas plataformas',
    )
    expect(ultimaExtracao().cartaoVigente).toBe(true)
  })

  it('o pedido explícito do botão continua sendo pedido do botão, não do cartão', async () => {
    const id = await conversaVerificada()
    await enviar(id, 'o factory não salva o material')
    const r = await chamar(req(`/api/conversas/${id}/montar-chamado`))
    expect(r.status).toBe(200)
    expect(ultimaExtracao().forcarFechamento).toBe(true)
  })

  it('🚨 no cliente REAL, a instrução do cartão vai no fim da mensagem do USUÁRIO', async () => {
    let corpo: Record<string, unknown> = {}
    const cliente = new ClienteIAHttp({
      baseUrl: null,
      apiKey: 'k',
      modelo: 'm',
      apiKeyFallback: null,
      fetchImpl: async (_url, init) => {
        corpo = JSON.parse(String((init as RequestInit).body)) as Record<string, unknown>
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: NAO_PRONTO_VAZIO } }],
            usage: { prompt_tokens: 10, completion_tokens: 5 },
          }),
          { headers: { 'content-type': 'application/json' } },
        )
      },
    })

    const r = await cliente.extrairProposta({
      mensagens: [{ papel: 'user', conteudo: 'preciso de acesso ao nexus' }],
      tiposPermitidos: [{ id: 'rt-2', nome: 'Solicitar acesso a um sistema' }],
      cartaoVigente: true,
    })

    const mensagens = corpo.messages as { role: string; content: string }[]
    const system = mensagens.find((m) => m.role === 'system')!
    const usuario = mensagens.find((m) => m.role === 'user')!
    // `D-76`: no system ela perde para a regra mais antiga do próprio prompt.
    expect(system.content).not.toContain(INSTRUCAO_ATUALIZAR_CARTAO.trim())
    expect(usuario.content.trimEnd().endsWith(INSTRUCAO_ATUALIZAR_CARTAO.trim())).toBe(true)
    // E o efeito: `pronto: false` deixa de descartar a proposta inteira.
    expect(r.proposta).toBeNull() // título e descrição vazios continuam descartando (FR-6)
  })

  it('a mesma resposta com conteúdo, e com cartão vigente, vira proposta', async () => {
    const comConteudo = JSON.stringify({
      ...JSON.parse(NAO_PRONTO_VAZIO),
      titulo: 'Acesso ao Nexus para investigar a integração com o Factory',
      descricao:
        'A pessoa precisa de acesso ao Nexus para comparar os dados da integração Nexus x Factory.',
    })
    expect(interpretarProposta(comConteudo, ['rt-2'])).toBeNull()
    expect(
      interpretarProposta(comConteudo, ['rt-2'], { aceitarNaoPronto: true })?.titulo,
    ).toContain('Acesso ao Nexus')
  })

  it('🚨 os dois textos são DIFERENTES — o do botão afirma que alguém clicou', () => {
    expect(INSTRUCAO_FECHAR_AGORA).toContain('botão')
    expect(INSTRUCAO_ATUALIZAR_CARTAO).not.toContain('clicou')
    // `FR-5` — fechar com lacuna, sem inventar.
    expect(INSTRUCAO_ATUALIZAR_CARTAO).toContain('Em aberto:')
    expect(INSTRUCAO_ATUALIZAR_CARTAO).toContain('Não invente')
  })
})

describe('FR-2/FR-3 — "não mudou nada" ≠ "não consegui atualizar"', () => {
  it('🚨 extração sem proposta COM cartão vigente devolve `nao_conseguiu`', async () => {
    const id = await conversaVerificada()
    const primeiro = await enviar(id, 'quero solicitar meu acesso ao nexus')
    expect((primeiro.proposta as Record<string, unknown>).titulo).toBe(
      'Solicitação de acesso ao Nexus',
    )

    // O turno seguinte não produz proposta — o caso medido.
    ia.propostaSugerida = null
    const segundo = await enviar(id, 'é para investigar a integração nexus x factory')

    expect(segundo.atualizacaoDoCartao).toBe('nao_conseguiu')
    // A vigente PERMANECE: o cartão não desaparece da tela da pessoa.
    expect((segundo.proposta as Record<string, unknown>).titulo).toBe(
      'Solicitação de acesso ao Nexus',
    )
  })

  it('rederivação que não muda nada devolve `sem_mudanca` — e a tela fica calada', async () => {
    const id = await conversaVerificada()
    await enviar(id, 'quero solicitar meu acesso ao nexus')
    const segundo = await enviar(id, 'obrigado, é isso mesmo')
    expect(segundo.atualizacaoDoCartao).toBe('sem_mudanca')
    expect(segundo.alterados).toEqual([])
  })

  it('rederivação que muda devolve `atualizado`', async () => {
    const id = await conversaVerificada()
    await enviar(id, 'quero solicitar meu acesso ao nexus')
    ia.propostaSugerida = {
      ...ia.propostaSugerida!,
      titulo: 'Acesso ao Nexus para investigar a integração com o Factory',
    }
    const segundo = await enviar(id, 'é para investigar a integração nexus x factory')
    expect(segundo.atualizacaoDoCartao).toBe('atualizado')
    expect(segundo.alterados).toContain('titulo')
  })

  it('🚨 queda do provedor COM cartão na tela também é `nao_conseguiu`', async () => {
    /**
     * Medido na staging em 20/08/2026: a extração do turno estourou o timeout de 25 s, o
     * `catch` devolvia `nao_havia` e a tela ficava calada com o resumo velho — o defeito
     * original de volta por outra porta. Indisponibilidade informa e segue (`RNF-18`).
     */
    const id = await conversaVerificada()
    await enviar(id, 'quero solicitar meu acesso ao nexus')
    ia.falharExtracao = true
    const segundo = await enviar(id, 'é para investigar a integração nexus x factory')
    expect(segundo.atualizacaoDoCartao).toBe('nao_conseguiu')
    // O cartão continua na tela e continua confirmável — nada virou parede.
    expect((segundo.proposta as Record<string, unknown>).titulo).toBe(
      'Solicitação de acesso ao Nexus',
    )
    expect(segundo.podeConfirmar).toBe(true)
  })

  it('o PRIMEIRO cartão é `atualizado`, nunca `sem_mudanca`', async () => {
    // Base nula chega com `alterados: []` (`diffDeProposta`); chamar isso de "não mudou
    // nada" descreveria o cartão que acabou de nascer como se já estivesse lá.
    const id = await conversaVerificada()
    const primeiro = await enviar(id, 'quero solicitar meu acesso ao nexus')
    expect(primeiro.alterados).toEqual([])
    expect(primeiro.atualizacaoDoCartao).toBe('atualizado')
  })

  it('sem cartão e sem proposta é `nao_havia` — nada a avisar', async () => {
    const id = await conversaVerificada()
    ia.propostaSugerida = null
    const turno = await enviar(id, 'oi')
    expect(turno.atualizacaoDoCartao).toBe('nao_havia')
    expect(turno.proposta).toBeNull()
  })
})

describe('FR-2 na tela — o aviso aparece só no estado que o pede', () => {
  const proposta: Proposta = {
    titulo: 'Solicitação de acesso ao Nexus',
    descricao: 'A pessoa solicita acesso ao sistema Nexus.',
    tipoChamadoId: 'rt-2',
    prioridade: 'normal',
    area: null,
    componente: null,
  }

  const base = {
    motivoPrioridade: null,
    motivoIndisponivel: null,
    prioridadeSugerida: 'normal' as const,
    recusasDeAjuste: [],
    assuntoMudou: false,
  }

  function desenhar(atualizacaoDoCartao: 'nao_conseguiu' | 'sem_mudanca' | 'nao_havia'): string {
    return renderToStaticMarkup(
      createElement(ReciboConfirmacao, {
        negociacao: { ...base, atualizacaoDoCartao },
        eu: { email: ANA, nome: 'Ana', isAdmin: false, modoDemo: false, somenteLeitura: false },
        conversaId: 'c1',
        propostaInicial: proposta,
        tipoNome: 'Solicitar acesso a um sistema',
        aoCriar: () => {},
        aoRecomecar: () => {},
      }),
    )
  }

  it('🚨 `nao_conseguiu` diz que a última mensagem não entrou', () => {
    expect(desenhar('nao_conseguiu')).toContain('Não consegui atualizar o resumo')
  })

  it('`sem_mudanca` e `nao_havia` não avisam nada — aviso em todo turno ninguém lê', () => {
    expect(desenhar('sem_mudanca')).not.toContain('Não consegui atualizar')
    expect(desenhar('nao_havia')).not.toContain('Não consegui atualizar')
  })
})

describe('FR-4 — o agente não pede o que o app já sabe', () => {
  const prompt = () =>
    montarPromptAgente({ buscaDocumentacaoDisponivel: true, historicoDisponivel: true })

  it('🚨 a proibição está escrita, e nomeia os quatro dados', () => {
    const p = prompt()
    expect(p).toContain('Nunca peça o e-mail, o login, o nome ou a área')
    expect(p).toContain('login corporativo')
  })

  it('não vaza nome interno de campo do Jira ao explicar de onde vem a identidade', () => {
    expect(prompt()).not.toContain('customfield')
  })
})

describe('FR-6 — modo fechamento não afrouxa trava nenhuma', () => {
  it('🚨 `RF-08`: sem as duas verificações não há rederivação, mesmo com cartão', async () => {
    const c = await ctx.conversas.criar(ctx.novoId(), ANA)
    await ctx.conversas.marcarConfluenceVerificado(c.id, false)
    const turno = await enviar(c.id, 'preciso de acesso ao nexus')
    expect(turno.proposta).toBeNull()
    expect(turno.atualizacaoDoCartao).toBe('nao_havia')
  })

  it('🚨 `RF-28`: assunto fora da allowlist descarta a proposta inteira', async () => {
    const id = await conversaVerificada()
    await enviar(id, 'quero solicitar meu acesso ao nexus')
    ia.propostaSugerida = { ...ia.propostaSugerida!, tipoChamadoId: 'rt-99' }
    const segundo = await enviar(id, 'na verdade é outra coisa')
    // Recusa, não fila errada — e a tela sabe que não atualizou.
    expect(segundo.atualizacaoDoCartao).toBe('nao_conseguiu')
    expect((segundo.proposta as Record<string, unknown>).tipoChamadoId).toBe('rt-2')
  })

  it('🚨 `RN-07`: bloqueio pendente não deixa o cartão ser rederivado', async () => {
    const id = await conversaVerificada()
    await enviar(id, 'quero solicitar meu acesso ao nexus')
    await ctx.conversas.registrarBloqueio(
      ctx.novoId(),
      id,
      'regra1_confluence',
      'documentação encontrada',
      null,
    )

    const segundo = await enviar(id, 'é para investigar a integração nexus x factory')
    expect(segundo.bloqueioPendente).toBe(true)
    expect(segundo.atualizacaoDoCartao).toBe('nao_havia')
  })

  it('🚨 `RF-17`: rederivar não cria chamado — quem cria é a confirmação', async () => {
    const id = await conversaVerificada()
    await enviar(id, 'quero solicitar meu acesso ao nexus')
    await enviar(id, 'é para investigar a integração nexus x factory')
    const criados = linhasComoObjetos<{ t: number }>(
      await db.query(`SELECT COUNT(*) AS t FROM submissoes`, []),
    )[0]!
    expect(Number(criados.t)).toBe(0)
  })
})

describe('FR-7 — o registro distingue os três modos', () => {
  it('`proposta_rederivada` diz que fechou porque já havia cartão', async () => {
    const id = await conversaVerificada()
    await enviar(id, 'quero solicitar meu acesso ao nexus')
    await enviar(id, 'é para investigar a integração nexus x factory')

    const linhas = linhasComoObjetos<{ tipo: string; dados_json: string }>(
      await db.query(
        `SELECT tipo, dados_json FROM investigador_eventos WHERE tipo = 'proposta_rederivada' ORDER BY criado_em, ordem`,
        [],
      ),
    )
    const modos = linhas.map((l) => (JSON.parse(l.dados_json) as { modo?: string }).modo)
    expect(modos[0]).toBe('primeiro_cartao')
    expect(modos[1]).toBe('cartao_vigente')
  })

  it('recusa continua sendo `ia_extracao_recusada`, com a resposta crua', async () => {
    const id = await conversaVerificada()
    await enviar(id, 'quero solicitar meu acesso ao nexus')
    ia.propostaSugerida = null
    await enviar(id, 'é para investigar a integração nexus x factory')

    const linhas = linhasComoObjetos<{ dados_json: string }>(
      await db.query(
        `SELECT dados_json FROM investigador_eventos WHERE tipo = 'ia_extracao_recusada'`,
        [],
      ),
    )
    expect(linhas).toHaveLength(1)
    expect(JSON.parse(linhas[0]!.dados_json).respostaBrutaDoModelo).toBeTruthy()
  })
})
