/**
 * **O cartão negociável, pela rota** — spec 008, `RF-68`…`RF-71`, `RN-13`.
 *
 * ## O que esta feature muda, em uma frase
 *
 * O chamado montado deixa de ser um formulário congelado: a pessoa **argumenta**, e o
 * cartão volta ajustado — com o motivo da prioridade, os campos que a IA mexeu e as
 * recusas do que não coube.
 *
 * ⚠️ **Nada aqui prova comportamento pelo eco do fake** (`D-47`, cinco ocorrências): o
 * motivo exibível é o que `tickets/motivo-da-prioridade.ts` julga, e o campo ajustado é o
 * que `tickets/ajuste-por-rotulo.ts` casa contra o **schema**. O fake é roteiro, e as
 * asserções falam do que a rota devolveu depois dessas duas camadas.
 *
 * _Requirements: FR-1, FR-2b, FR-5, FR-11, FR-13, FR-14, FR-17, FR-23, ScC-3, ScC-6, ScC-9_
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { SqliteLocal } from '@/lib/db/sqlite-local'
import { migrar } from '@/lib/db/schema'
import { Config } from '@/lib/config'
import { montarContexto, type Contexto } from '@/lib/contexto'
import { tratarRequisicao } from '@/lib/http/rotas'
import { HEADER_EMAIL } from '@/lib/auth'
import { ClienteAtlassianFake } from '@/lib/atlassian/fake'
import { ClienteIAFake } from '@/lib/ia/fake'
import { linhasComoObjetos } from '@/lib/db/tipos'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { ReciboConfirmacao } from '@/app/telas'
import { deveAvisarNegociacao, deveMostrarCartao } from '@/app/negociacao'
import type { Proposta } from '@/app/api'
import { SEM_MOTIVO_DE_PRIORIDADE } from '@/lib/tickets/motivo-da-prioridade'

const ANA = 'ana@gocase.com'
const CHEFE = 'chefe@gocase.com'
const AGORA = '2026-08-14T12:00:00.000Z'

const RECORRENCIA = {
  fieldId: 'customfield_2',
  rotulo: 'Recorrência',
  obrigatorio: false,
  tipo: 'selecao' as const,
  opcoes: [
    { id: '10127', rotulo: 'Sempre' },
    { id: '10128', rotulo: 'Às vezes' },
  ],
}

const SISTEMA = {
  fieldId: 'customfield_1',
  rotulo: 'Sistema afetado',
  obrigatorio: false,
  tipo: 'texto' as const,
  opcoes: [],
}

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
  await config.definir('regra1_threshold_score', 0.99, CHEFE, AGORA)
  ctx = await montarContexto({ DB: db, GOATLAS_USAR_FAKES: '1' }, () => AGORA, () => `id-${++n}`)
  fake = ctx.atlassian as ClienteAtlassianFake
  ia = ctx.ia as ClienteIAFake
  fake.estado.tiposChamado = [
    { id: 'rt-1', serviceDeskId: 'sd-1', nome: 'Relatar um problema', descricao: null },
    { id: 'rt-2', serviceDeskId: 'sd-1', nome: 'Pedido de acesso', descricao: null },
  ]
  fake.estado.camposPorTipo.set('rt-1', [SISTEMA, RECORRENCIA])
  /**
   * ⚠️ O roteiro do fake nasce **igual à base** que `conversaComProposta` grava. Sem isso,
   * todo turno começaria com a IA "mudando de opinião" sobre a prioridade e cada caso
   * mediria a diferença entre dublê e fixture em vez do que ele diz medir.
   */
  ia.propostaSugerida = {
    ...ia.propostaSugerida!,
    tipoChamadoId: 'rt-1',
    titulo: 'Pipeline de vendas não atualizou',
    descricao: 'O relatório diário não trouxe os dados de ontem.',
    prioridade: 'normal',
    motivoPrioridade: 'Existe contorno manual e nenhuma venda está parada.',
  }
})

function req(caminho: string, corpo?: unknown, metodo = 'POST', quem = ANA): Request {
  return new Request(`https://goatlas.devgogroup.com${caminho}`, {
    method: metodo,
    headers: { [HEADER_EMAIL]: quem },
    ...(corpo === undefined ? {} : { body: JSON.stringify(corpo) }),
  })
}

const chamar = (r: Request) => tratarRequisicao(r, ctx, {})

/** Conversa verificada, com proposta e com base de merge — o estado de quem negocia. */
async function conversaComProposta(quem = ANA): Promise<string> {
  const c = await ctx.conversas.criar(ctx.novoId(), quem)
  await ctx.conversas.marcarConfluenceVerificado(c.id, false)
  await ctx.conversas.marcarHistoricoVerificado(c.id, false)
  await ctx.conversas.definirPropostaDaIa(c.id, {
    titulo: 'Pipeline de vendas não atualizou',
    descricao: 'O relatório diário não trouxe os dados de ontem.',
    tipoChamadoId: 'rt-1',
    prioridade: 'normal',
    area: null,
    componente: null,
    motivoPrioridade: 'Existe contorno manual e nenhuma venda está parada.',
    campos: {},
  })
  return c.id
}

async function enviar(id: string, texto: string): Promise<Record<string, unknown>> {
  const r = await chamar(req(`/api/conversas/${id}/mensagens`, { texto }))
  expect(r.status).toBe(200)
  return (await r.json()) as Record<string, unknown>
}

describe('FR-1/FR-5 — o motivo da prioridade chega à tela já validado', () => {
  it('motivo bom sai como veio, com a prioridade de quem o escreveu (FR-2b)', async () => {
    const id = await conversaComProposta()
    ia.propostaSugerida = {
      ...ia.propostaSugerida!,
      prioridade: 'alta',
      motivoPrioridade: 'O relatório do dia não fecha e o time comercial trabalha sem ele.',
    }
    const corpo = await enviar(id, 'o time inteiro depende desse relatório')

    expect(corpo.motivoPrioridade).toBe(
      'O relatório do dia não fecha e o time comercial trabalha sem ele.',
    )
    // ⚠️ Sem `prioridadeSugerida` o cliente não sabe de **quem** é o motivo, e mostraria a
    // justificativa da IA ao lado do nível que a pessoa escolheu (`SC-2b`).
    expect(corpo.prioridadeSugerida).toBe('alta')
  })

  it('motivo em inglês vira a declaração de FR-5, e o botão continua vivo', async () => {
    const id = await conversaComProposta()
    ia.propostaSugerida = {
      ...ia.propostaSugerida!,
      motivoPrioridade: 'The report is not available and the team cannot work with it.',
    }
    const corpo = await enviar(id, 'segue')

    expect(corpo.motivoPrioridade).toBeNull()
    expect(corpo.motivoIndisponivel).toBe(SEM_MOTIVO_DE_PRIORIDADE)
    expect(corpo.podeConfirmar).toBe(true)
  })

  it('motivo com identificador interno não chega à tela (RNF-30)', async () => {
    const id = await conversaComProposta()
    ia.propostaSugerida = {
      ...ia.propostaSugerida!,
      motivoPrioridade: 'O customfield_10071 está vazio, então a prioridade caiu.',
    }
    const corpo = await enviar(id, 'segue')

    expect(corpo.motivoPrioridade).toBeNull()
    expect(JSON.stringify(corpo)).not.toContain('customfield_10071')
  })

  it('o motivo NÃO vive na proposta persistida — o PUT da pessoa o apagaria', async () => {
    const id = await conversaComProposta()
    await enviar(id, 'segue')

    // 🚨 `validarProposta` é allowlist por construção e o `PUT /proposta` sobrescreve o
    // `proposta_json` inteiro. Com o motivo ali, editar a prioridade — o gesto que `RF-16`
    // existe para permitir — apagaria a justificativa em silêncio.
    const r = await chamar(
      req(
        `/api/conversas/${id}/proposta`,
        {
          titulo: 'Pipeline de vendas não atualizou',
          descricao: 'O relatório diário não trouxe os dados de ontem.',
          tipoChamadoId: 'rt-1',
          prioridade: 'critica',
        },
        'PUT',
      ),
    )
    expect(r.status).toBe(200)
    const depois = await ctx.conversas.obter(id)
    expect(depois?.propostaDaIa?.motivoPrioridade).toBeTruthy()
  })
})

describe('FR-11/FR-13/FR-14 — o ajuste por texto, e as recusas em português', () => {
  it('campo e opção que casam voltam por `fieldId`, e entram em `alterados`', async () => {
    const id = await conversaComProposta()
    ia.propostaSugerida = {
      ...ia.propostaSugerida!,
      campos: [{ rotulo: 'Recorrência', valor: 'Sempre' }],
    }
    const corpo = await enviar(id, 'acontece sempre, todo dia')

    expect(corpo.camposSugeridos).toEqual({ customfield_2: '10127' })
    expect(corpo.alterados).toContain('campo:customfield_2')
    expect(corpo.recusasDeAjuste).toEqual([])
  })

  it('FR-14 — campo que o assunto não tem volta como recusa, com o rótulo', async () => {
    const id = await conversaComProposta()
    ia.propostaSugerida = {
      ...ia.propostaSugerida!,
      campos: [{ rotulo: 'Número da nota fiscal', valor: '884213' }],
    }
    const corpo = await enviar(id, 'a nota é a 884213')

    expect(corpo.recusasDeAjuste).toEqual([
      { rotulo: 'Número da nota fiscal', motivo: 'campo_inexistente' },
    ])
  })

  it('FR-13 — opção inexistente volta com os RÓTULOS válidos, nunca com os ids', async () => {
    const id = await conversaComProposta()
    ia.propostaSugerida = {
      ...ia.propostaSugerida!,
      campos: [{ rotulo: 'Recorrência', valor: 'De vez em quando' }],
    }
    const corpo = await enviar(id, 'acontece de vez em quando')

    const recusas = corpo.recusasDeAjuste as { motivo: string; opcoes?: string[] }[]
    expect(recusas[0]?.motivo).toBe('opcao_inexistente')
    expect(recusas[0]?.opcoes).toEqual(['Sempre', 'Às vezes'])
    expect(JSON.stringify(recusas)).not.toContain('10127')
  })

  it('SC-11 — pedido que corrige título e descrição volta no cartão, e nada mais muda', async () => {
    const id = await conversaComProposta()
    ia.propostaSugerida = {
      ...ia.propostaSugerida!,
      titulo: 'Relatório de vendas do Protheus não fecha o dia',
      descricao: 'O fechamento diário do Protheus não trouxe os pedidos de ontem.',
    }
    const corpo = await enviar(id, 'o nome certo é fechamento diário, e é no Protheus')

    const proposta = corpo.proposta as { titulo: string; descricao: string; prioridade: string }
    expect(proposta.titulo).toBe('Relatório de vendas do Protheus não fecha o dia')
    expect(proposta.descricao).toContain('Protheus')
    // ⚠️ `FR-11` nomeia cinco alvos, e estes dois ficaram sem caso até o `/analyze`.
    expect(corpo.alterados).toEqual(expect.arrayContaining(['titulo', 'descricao']))
    expect(corpo.alterados).not.toContain('prioridade')
    expect(proposta.prioridade).toBe('normal')
  })

  it('FR-17 — urgência pedida sem impacto novo não sobe o nível', async () => {
    const id = await conversaComProposta()
    // O roteiro do fake é o modelo **obedecendo à regra**: nada muda porque nada de
    // impacto novo foi descrito. A trava de verdade é o prompt (`FR-17`) mais o seletor
    // editável (`RF-16`) — e é isso que este caso documenta.
    const corpo = await enviar(id, 'é urgentíssimo, sobe pra crítica')

    expect((corpo.proposta as { prioridade: string }).prioridade).toBe('normal')
    expect(corpo.alterados).not.toContain('prioridade')
  })
})

describe('ScC-3 — o valor que a criação usaria é o que está na tela', () => {
  it('depois de um turno que muda a prioridade, a proposta persistida é a nova', async () => {
    const id = await conversaComProposta()
    ia.propostaSugerida = { ...ia.propostaSugerida!, prioridade: 'critica' }
    const corpo = await enviar(id, 'a loja inteira parou de faturar agora')

    expect((corpo.proposta as { prioridade: string }).prioridade).toBe('critica')
    // O que a criação leria é a proposta persistida, não a resposta HTTP.
    expect((await ctx.conversas.obter(id))?.proposta?.prioridade).toBe('critica')
  })
})

describe('ScC-6 — nenhum ajuste por texto produz criação recusada', () => {
  it('obrigatório do tipo não é preenchido por texto com valor inválido (D-38/D-39)', async () => {
    const id = await conversaComProposta()
    fake.estado.camposPorTipo.set('rt-1', [
      { ...RECORRENCIA, obrigatorio: true },
    ])
    ia.propostaSugerida = {
      ...ia.propostaSugerida!,
      campos: [{ rotulo: 'Recorrência', valor: 'Quase sempre' }],
    }
    const corpo = await enviar(id, 'acontece quase sempre')

    // 🚨 O caminho que `D-39` fechou: valor fora das opções viraria `400 = definitivo =
    // chamado perdido`. Aqui ele nem chega à criação — é recusado antes, com o rótulo.
    expect(corpo.camposSugeridos).toEqual({})
    expect((corpo.recusasDeAjuste as unknown[]).length).toBe(1)
  })
})

describe('FR-23 — o desfecho do aviso é registrado, e só isso', () => {
  it('`aviso_negociacao` guarda o desfecho', async () => {
    const id = await conversaComProposta()
    const r = await chamar(req(`/api/conversas/${id}/aviso-negociacao`, { desfecho: 'seguiu' }))
    expect(r.status).toBe(200)

    const linhas = linhasComoObjetos<{ detalhe_json: string }>(
      await db.query(`SELECT detalhe_json FROM auditoria WHERE acao = 'aviso_negociacao'`, []),
    )
    expect(linhas).toHaveLength(1)
    expect(linhas[0]!.detalhe_json).toContain('seguiu')
  })

  it('desfecho inventado é recusado — a união é fechada dos dois lados', async () => {
    const id = await conversaComProposta()
    const r = await chamar(
      req(`/api/conversas/${id}/aviso-negociacao`, { desfecho: 'talvez' }),
    )
    expect(r.status).toBe(400)
  })

  it('a rota só audita: não toca a proposta nem a conversa', async () => {
    const id = await conversaComProposta()
    const antes = await ctx.conversas.obter(id)
    await chamar(req(`/api/conversas/${id}/aviso-negociacao`, { desfecho: 'voltou' }))
    const depois = await ctx.conversas.obter(id)

    expect(depois?.proposta).toEqual(antes?.proposta)
    expect(depois?.estado).toBe(antes?.estado)
  })
})

/**
 * **T-751/T-757/T-762 — a tela do cartão negociável.**
 *
 * ⚠️ Afirma sobre **estado e conteúdo**, nunca sobre layout. Teste que copia marcação
 * reprova em toda melhoria de tela, vira peso morto e acaba apagado — devolvendo o buraco
 * que ele tapa (`D-47`/`D-49`). Por isso os dois estados derivados são **predicados
 * exportados**, no estilo de `deveMostrarAtalhoDoFim` (`D-69`): a suíte roda em
 * `environment: 'node'` e não clica em nada.
 */
describe('FR-7 — o cartão sai da tela enquanto o turno corre', () => {
  it('com proposta e turno parado, ele aparece', () => {
    expect(deveMostrarCartao({ temProposta: true, enviando: false, bloqueado: false })).toBe(true)
  })

  it('durante o turno, some — o que está ali é o chamado de antes', () => {
    expect(deveMostrarCartao({ temProposta: true, enviando: true, bloqueado: false })).toBe(false)
  })

  it('com bloqueio pendente não existe — o caminho ali é o override (RN-07)', () => {
    expect(deveMostrarCartao({ temProposta: true, enviando: false, bloqueado: true })).toBe(false)
  })

  it('sem proposta, nada a mostrar', () => {
    expect(deveMostrarCartao({ temProposta: false, enviando: false, bloqueado: false })).toBe(false)
  })
})

describe('FR-18/FR-19/FR-21 — o aviso, nas três condições', () => {
  it('com proposta e nunca exibido, aparece uma vez', () => {
    expect(
      deveAvisarNegociacao({ temProposta: true, bloqueioPendente: false, jaExibido: false }),
    ).toBe(true)
  })

  it('já exibido não volta — nem para quem fechou no Esc (SC-20)', () => {
    expect(
      deveAvisarNegociacao({ temProposta: true, bloqueioPendente: false, jaExibido: true }),
    ).toBe(false)
  })

  it('sem proposta não existe: não há cartão para reescrever', () => {
    expect(
      deveAvisarNegociacao({ temProposta: false, bloqueioPendente: false, jaExibido: false }),
    ).toBe(false)
  })

  it('SC-19 — com bloqueio pendente não existe: seria a parede que RF-13 proíbe', () => {
    expect(
      deveAvisarNegociacao({ temProposta: true, bloqueioPendente: true, jaExibido: false }),
    ).toBe(false)
  })
})

/**
 * **T-753/T-755/T-760** — o conteúdo que o cartão passou a carregar.
 */
describe('o cartão: motivo, recusas e a linha fixa', () => {
  const PROPOSTA: Proposta = {
    titulo: 'Relatório de vendas não atualizou',
    descricao: 'O relatório diário não trouxe os dados do dia anterior.',
    tipoChamadoId: 'rt-1',
    prioridade: 'alta',
    area: 'Growth',
    componente: null,
  }

  function render(negociacao?: Parameters<typeof ReciboConfirmacao>[0]['negociacao']): string {
    return renderToStaticMarkup(
      createElement(ReciboConfirmacao, {
        ...(negociacao ? { negociacao } : {}),
        eu: {
          email: 'ana@gocase.com',
          nome: 'Ana',
          isAdmin: false,
          modoDemo: false,
          somenteLeitura: false,
        },
        conversaId: 'c1',
        propostaInicial: PROPOSTA,
        tipoNome: 'Relatar um problema (Sistema)',
        aoCriar: () => {},
        aoRecomecar: () => {},
      }),
    )
  }

  const BASE = {
    motivoPrioridade: null,
    motivoIndisponivel: null,
    prioridadeSugerida: 'alta' as const,
    recusasDeAjuste: [],
    assuntoMudou: false,
  }

  it('FR-2b — com a pessoa em outro nível, o motivo é ATRIBUÍDO à sugestão', () => {
    // 🚨 Mostrar o motivo cru ao lado de `normal` seria a tela justificando um nível que
    // ninguém escolheu — e afirmando um porquê que a própria pessoa acabou de contrariar.
    const saida = renderToStaticMarkup(
      createElement(ReciboConfirmacao, {
        negociacao: {
          ...BASE,
          motivoPrioridade: 'O relatório do dia não fecha e o comercial trabalha sem ele.',
          prioridadeSugerida: 'alta',
        },
        estado: {
          prioridade: 'normal',
          aoMudarPrioridade: () => {},
          valoresCampos: {},
          aoMudarValoresCampos: () => {},
          declarou: null,
          aoDeclarar: () => {},
        },
        eu: {
          email: 'ana@gocase.com',
          nome: 'Ana',
          isAdmin: false,
          modoDemo: false,
          somenteLeitura: false,
        },
        conversaId: 'c1',
        propostaInicial: PROPOSTA,
        tipoNome: 'Relatar um problema (Sistema)',
        aoCriar: () => {},
        aoRecomecar: () => {},
      }),
    )
    expect(saida).toContain('A sugestão era alta')
    expect(saida).toContain('O relatório do dia não fecha')
  })

  it('FR-13 — a recusa de opção lista os RÓTULOS válidos, nunca os ids', () => {
    const saida = render({
      ...BASE,
      recusasDeAjuste: [
        { rotulo: 'Recorrência', motivo: 'opcao_inexistente', opcoes: ['Sempre', 'Às vezes'] },
      ],
    })
    expect(saida).toContain('Recorrência')
    expect(saida).toContain('Sempre')
    expect(saida).toContain('Às vezes')
    expect(saida).not.toContain('10127')
  })

  it('FR-14 — campo inexistente diz o que fazer, sem culpar quem pediu', () => {
    const saida = render({
      ...BASE,
      recusasDeAjuste: [{ rotulo: 'Número da nota fiscal', motivo: 'campo_inexistente' }],
    })
    expect(saida).toContain('Número da nota fiscal')
    expect(saida).toContain('Este assunto não tem o campo')
  })

  it('FR-10 — assunto mudou: a tela DIZ, campo não some em silêncio', () => {
    const saida = render({ ...BASE, assuntoMudou: true })
    expect(saida).toContain('O assunto do chamado mudou')
  })

  it('FR-22 — a linha fixa não depende de a pessoa ter visto o aviso', () => {
    const saida = render(BASE)
    expect(saida).toContain('pode ser reescrito')
  })

  it('sem negociação (formulário e override), o cartão continua inteiro', () => {
    const saida = render()
    // Nem linha fixa, nem recusa, nem declaração de motivo — e o botão de abrir de pé.
    expect(saida).toContain('Abrir chamado')
    expect(saida).not.toContain('pode ser reescrito')
    expect(saida).not.toContain('Não deu para ajustar')
  })
})
