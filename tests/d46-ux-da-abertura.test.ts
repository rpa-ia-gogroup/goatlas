/**
 * `D-46` — os quatro defeitos de tela da bateria de 12/08/2026, medidos dirigindo o app
 * publicado. Nenhum deles quebrava nada: os quatro conviveram com 1051 testes verdes
 * porque o app **respondia certo** — só dizia outra coisa.
 *
 * 1. **A legenda do botão afirmava exclusividade.** Com título, descrição e os
 *    obrigatórios do tipo 70 todos vazios, o botão travado dizia *"Responda acima se você
 *    tem algo para anexar. **É a única coisa que falta**"* — e faltavam quatro. Quem
 *    segurava o envio depois disso era o `required` do navegador.
 * 2. **O recibo era terminal.** Clicar a aba já ativa não devolve o formulário (é a mesma
 *    tela), e só recarregar a página abria o segundo chamado.
 * 3. **O `input[type=file]` cru** aparecia com o botão de sistema do navegador dentro de
 *    uma tela que o resto do app desenha.
 * 4. **O erro prometia reprocessamento que não existia.** `POST .../confirmar` → 500 com
 *    *"Sua solicitação não foi perdida — tente novamente em instantes"*, submissão
 *    `falha`, `transitorio: false`.
 *
 * ## O que estes testes afirmam
 *
 * Sempre o **predicado**, nunca a copy inteira: "a frase nomeia tudo o que falta", "a
 * frase não afirma exclusividade", "o recibo oferece caminho de volta". Teste que copia a
 * copy vira segunda cópia da copy — e passa a reprovar quem melhora o texto, que é o
 * oposto do que ele deveria proteger.
 *
 * _Requirements: RF-17, RF-24, RF-27, RF-61, RF-62, RN-11, RNF-17, RNF-18, RNF-28, RNF-30_
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { SqliteLocal } from '@/lib/db/sqlite-local'
import { migrar } from '@/lib/db/schema'
import { Config } from '@/lib/config'
import { montarContexto, type Contexto } from '@/lib/contexto'
import { tratarRequisicao } from '@/lib/http/rotas'
import { CODIGO_CRIACAO_NAO_CONCLUIDA, ERROS } from '@/lib/http/respostas'
import { HEADER_EMAIL } from '@/lib/auth'
import { ClienteAtlassianFake } from '@/lib/atlassian/fake'
import { ChamadoAberto, TelaFormulario } from '@/app/telas'
import { PerguntaDeAnexo } from '@/app/anexo'
import {
  faltaAlgumaCoisa,
  mensagemDePendencias,
  pendenciasParaAbrir,
} from '@/app/pendencias'
import type { ResultadoCriacao } from '@/app/api'

const ANA = 'ana@gocase.com'
const CHEFE = 'chefe@gocase.com'
const AGORA = '2026-08-12T12:00:00.000Z'

/* ====================================================================== */
/* 1 · A frase diz TUDO o que falta, e nunca afirma exclusividade         */
/* ====================================================================== */

const SISTEMA = {
  fieldId: 'customfield_10092',
  rotulo: 'Em que sistema o Bug está ocorrendo?',
  obrigatorio: true,
  tipo: 'texto' as const,
  multiplo: false,
  opcoes: [],
}

const RECORRENCIA = {
  fieldId: 'customfield_10071',
  rotulo: 'Recorrência',
  obrigatorio: true,
  tipo: 'selecao' as const,
  multiplo: false,
  opcoes: [{ id: '10127', rotulo: 'Sempre' }],
}

describe('pendenciasParaAbrir — o que falta é contado, não presumido', () => {
  it('🚨 com tudo vazio, a frase nomeia os fixos E os do schema E o anexo', () => {
    const p = pendenciasParaAbrir({
      fixos: [
        { rotulo: 'Título', valor: '' },
        { rotulo: 'O que está acontecendo', valor: '   ' },
      ],
      campos: [SISTEMA, RECORRENCIA],
      valores: {},
      faltaDeclararAnexo: true,
    })
    const frase = mensagemDePendencias(p)
    for (const rotulo of [
      'Título',
      'O que está acontecendo',
      SISTEMA.rotulo,
      RECORRENCIA.rotulo,
    ]) {
      expect(frase, `a frase precisa nomear "${rotulo}"`).toContain(rotulo)
    }
    expect(frase).toMatch(/anexar/)
  })

  it('🚨 a frase NUNCA afirma que a pendência é a única — era o defeito medido', () => {
    // A propriedade, não a string: qualquer redação que volte a prometer exclusividade
    // com mais de uma pendência aberta reprova aqui.
    const frase = mensagemDePendencias(
      pendenciasParaAbrir({
        fixos: [{ rotulo: 'Título', valor: '' }],
        campos: [SISTEMA],
        valores: {},
        faltaDeclararAnexo: true,
      }),
    )
    expect(frase.toLowerCase()).not.toMatch(/única|unica|só falta|apenas/)
  })

  it('a ordem é a da tela: fixos primeiro, schema depois', () => {
    const frase = mensagemDePendencias(
      pendenciasParaAbrir({
        fixos: [{ rotulo: 'Título', valor: '' }],
        campos: [SISTEMA],
        valores: {},
        faltaDeclararAnexo: false,
      }),
    )
    expect(frase.indexOf('Título')).toBeLessThan(frase.indexOf(SISTEMA.rotulo))
  })

  it('campo de ANEXO fica fora dos obrigatórios — senão `RN-11` vira "anexe um arquivo"', () => {
    const anexo = { ...SISTEMA, fieldId: 'attachment', rotulo: 'Anexo', tipo: 'anexo' as const }
    const p = pendenciasParaAbrir({
      campos: [anexo],
      valores: {},
      faltaDeclararAnexo: false,
    })
    expect(p.campos).toEqual([])
    expect(faltaAlgumaCoisa(p)).toBe(false)
  })

  it('campo OPCIONAL vazio não trava nada', () => {
    const p = pendenciasParaAbrir({
      campos: [{ ...SISTEMA, obrigatorio: false }],
      valores: {},
      faltaDeclararAnexo: false,
    })
    expect(faltaAlgumaCoisa(p)).toBe(false)
  })

  it('nada faltando devolve string VAZIA — nunca um parágrafo de dica em branco', () => {
    const p = pendenciasParaAbrir({
      fixos: [{ rotulo: 'Título', valor: 'algo' }],
      campos: [SISTEMA],
      valores: { [SISTEMA.fieldId]: 'Painel' },
      faltaDeclararAnexo: false,
    })
    expect(faltaAlgumaCoisa(p)).toBe(false)
    expect(mensagemDePendencias(p)).toBe('')
  })

  it('a enumeração usa "e" antes do último — lista com vírgula solta lê como truncada', () => {
    const frase = mensagemDePendencias(
      pendenciasParaAbrir({
        fixos: [
          { rotulo: 'A', valor: '' },
          { rotulo: 'B', valor: '' },
          { rotulo: 'C', valor: '' },
        ],
        campos: [],
        valores: {},
        faltaDeclararAnexo: false,
      }),
    )
    expect(frase).toContain('A, B e C')
  })
})

describe('TelaFormulario — o botão travado explica os campos fixos, não só o anexo', () => {
  it('🚨 recém-aberto, o botão está desabilitado e a dica nomeia título e descrição', () => {
    const saida = renderToStaticMarkup(
      createElement(TelaFormulario, {
        eu: {
          email: ANA,
          nome: 'Ana',
          isAdmin: false,
          modoDemo: false,
          somenteLeitura: false,
        },
        aoAbrirChamado: () => {},
      }),
    )
    // O botão de abrir está travado E aponta para a dica: sem `aria-describedby` o leitor
    // de tela anuncia um botão desabilitado e mais nada.
    const botao = saida.match(/<button[^>]*>Abrir chamado</)?.[0] ?? ''
    expect(botao).toContain('disabled')
    expect(botao).toContain('aria-describedby="falta-abrir-form"')

    // E a dica nomeia os DOIS campos fixos vazios. É esta asserção que reprova a frase
    // antiga: ela falava só do anexo, e o anexo nem está em jogo neste tipo.
    const dica = saida.match(/id="falta-abrir-form">([^<]*)</)?.[1] ?? ''
    expect(dica).toContain('Título')
    expect(dica).toContain('O que está acontecendo')
  })
})

/* ====================================================================== */
/* 2 · Depois do recibo existe caminho de volta                            */
/* ====================================================================== */

const CRIADO: ResultadoCriacao = {
  issueKey: 'GN-6898',
  estado: 'criado',
  duplicada: false,
  verificadoRegras: false,
  anexo: { estado: 'sem_anexo', anexados: [], falharam: [], mensagem: '' },
  prioridade: 'normal',
  slaPrimeiraRespostaHoras: 24,
  mensagem: 'Chamado aberto. Você acompanha tudo por aqui.',
}

describe('ChamadoAberto — o recibo não é beco sem saída', () => {
  it('🚨 oferece abrir OUTRO chamado, além de ver os chamados', () => {
    let recomecou = 0
    const saida = renderToStaticMarkup(
      createElement(ChamadoAberto, {
        resultado: CRIADO,
        via: 'formulario' as const,
        aoVerChamados: () => {},
        aoRecomecar: () => {
          recomecou += 1
        },
      }),
    )
    expect(saida).toContain('GN-6898')
    expect(saida).toContain('Ver meus chamados')
    expect(saida).toContain('Abrir outro chamado')
    expect(recomecou).toBe(0)
  })

  it('vale também para quem abriu pela conversa — o beco era o mesmo lá', () => {
    const saida = renderToStaticMarkup(
      createElement(ChamadoAberto, {
        resultado: CRIADO,
        via: 'conversa' as const,
        aoVerChamados: () => {},
        aoRecomecar: () => {},
      }),
    )
    expect(saida).toContain('Abrir outro chamado')
  })
})

/* ====================================================================== */
/* 3 · O seletor de arquivo é do app, e continua alcançável pelo teclado   */
/* ====================================================================== */

describe('PerguntaDeAnexo — o controle de arquivo veste a identidade', () => {
  const comSeletor = () =>
    renderToStaticMarkup(
      createElement(PerguntaDeAnexo, {
        alvo: { via: 'formulario' as const, chaveIdempotencia: 'k1' },
        declarou: true,
        aoDeclarar: () => {},
      }),
    )

  it('🚨 o `input` continua sendo `input` — escondê-lo com `hidden` o tira do teclado', () => {
    const saida = comSeletor()
    expect(saida).toContain('type="file"')
    // `hidden`/`display:none` removeria o campo da ordem de tabulação, e a pergunta
    // ficaria inalcançável para quem não usa mouse.
    expect(saida).not.toContain('hidden')
    expect(saida).not.toContain('display:none')
  })

  it('quem aparece é um rótulo vestido de botão, e ele APONTA para o campo', () => {
    const saida = comSeletor()
    expect(saida).toContain('entrada-arquivo')
    expect(saida).toMatch(/<label[^>]*for="anexo-na-criacao"/)
    expect(saida).toMatch(/<label[^>]*class="[^"]*botao[^"]*"/)
    expect(saida).toContain('Escolher arquivo')
  })
})

/* ====================================================================== */
/* 4 · "Não se perdeu" só quando de fato não se perdeu                     */
/* ====================================================================== */

describe('ERROS — a frase genérica não promete o que só o outbox cumpre', () => {
  it('🚨 `interno()` não afirma que a solicitação sobreviveu', async () => {
    const corpo = (await ERROS.interno().json()) as { erro: string }
    expect(corpo.erro.toLowerCase()).not.toMatch(/não foi perdida|nada se perdeu|não se perdeu/)
  })

  it('`criacaoNaoConcluida()` diz que NÃO ficou na fila, e traz o código próprio', async () => {
    for (const via of ['conversa', 'formulario'] as const) {
      const r = ERROS.criacaoNaoConcluida(via)
      const corpo = (await r.json()) as { erro: string; codigo: string }
      expect(corpo.codigo).toBe(CODIGO_CRIACAO_NAO_CONCLUIDA)
      expect(corpo.erro).toMatch(/não ficou na fila/i)
      expect(corpo.erro.toLowerCase()).not.toMatch(/não foi perdida|nada se perdeu/)
      // `RNF-30` — nenhum detalhe técnico chega à tela.
      expect(corpo.erro).not.toMatch(/customfield_|HTTP|400|Atlassian/)
    }
  })

  it('as duas superfícies recebem saídas diferentes — a chave de idempotência delas é outra', async () => {
    const form = ((await ERROS.criacaoNaoConcluida('formulario').json()) as { erro: string }).erro
    const conversa = ((await ERROS.criacaoNaoConcluida('conversa').json()) as { erro: string }).erro
    expect(form).not.toBe(conversa)
    expect(conversa).toMatch(/conversa nova/i)
  })
})

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
  await config.definir('tipos_chamado_permitidos', ['70'], CHEFE, AGORA)
  await config.definir('service_desk_id', '4', CHEFE, AGORA)
  ctx = await montarContexto({ DB: db, GOATLAS_USAR_FAKES: '1' }, () => AGORA, () => `id-${++n}`)
  fake = ctx.atlassian as ClienteAtlassianFake
  fake.estado.tiposChamado = [
    { id: '70', serviceDeskId: '4', nome: 'Relatar um bug', descricao: null },
  ]
})

function req(caminho: string, corpo: unknown): Request {
  return new Request(`https://goatlas.devgogroup.com${caminho}`, {
    method: 'POST',
    headers: { [HEADER_EMAIL]: ANA },
    body: JSON.stringify(corpo),
  })
}

const CORPO = {
  titulo: 'O relatório veio errado',
  descricao: 'Os totais de ontem não fecham.',
  tipoChamadoId: '70',
  prioridade: 'alta',
  chaveIdempotencia: 'k1',
}

async function conversaPronta(): Promise<string> {
  const c = await ctx.conversas.criar(ctx.novoId(), ANA)
  await ctx.conversas.marcarConfluenceVerificado(c.id, false)
  await ctx.conversas.marcarHistoricoVerificado(c.id, false)
  await ctx.conversas.definirProposta(c.id, {
    titulo: 'O relatório veio errado',
    descricao: 'Os totais de ontem não fecham.',
    tipoChamadoId: '70',
    prioridade: 'alta',
    area: null,
    componente: null,
  })
  await ctx.conversas.definirEstado(c.id, 'aguardando_confirmacao')
  return c.id
}

describe('POST de criação — o que a pessoa lê quando a criação falha de verdade', () => {
  it('🚨 falha DEFINITIVA responde com o código próprio, não com o 500 que prometia retry', async () => {
    fake.estado.falhas.criarChamado = 'rejeitado'
    const r = await tratarRequisicao(req('/api/chamados', CORPO), ctx, {})
    const corpo = (await r.json()) as { erro: string; codigo: string }
    expect(corpo.codigo).toBe(CODIGO_CRIACAO_NAO_CONCLUIDA)
    expect(corpo.erro.toLowerCase()).not.toMatch(/não foi perdida/)
    // E a submissão está mesmo fora do reprocessamento — é o que a frase agora afirma.
    expect((await ctx.outbox.obterPorChave(`form:${ANA}:k1`))?.estado).toBe('falha')
    expect(await ctx.outbox.listarPendentes(10)).toHaveLength(0)
  })

  it('🚨 REENVIAR depois da falha definitiva não devolve recibo falso', async () => {
    // Era a versão mais cara da mentira: a segunda tentativa caía na submissão morta,
    // `issueKey` era `null`, e a rota respondia **201** com "estamos abrindo o chamado.
    // Nada se perdeu" — para um chamado que ninguém abriria.
    fake.estado.falhas.criarChamado = 'rejeitado'
    await tratarRequisicao(req('/api/chamados', CORPO), ctx, {})

    const segunda = await tratarRequisicao(req('/api/chamados', CORPO), ctx, {})
    expect(segunda.status).not.toBe(201)
    const corpo = (await segunda.json()) as { erro: string; codigo: string }
    expect(corpo.codigo).toBe(CODIGO_CRIACAO_NAO_CONCLUIDA)
    expect(corpo.erro).not.toMatch(/Nada se perdeu/)
  })

  it('a conversa se comporta igual — divergência entre os dois caminhos é o defeito da spec 006 §8', async () => {
    fake.estado.falhas.criarChamado = 'rejeitado'
    const id = await conversaPronta()
    const r = await tratarRequisicao(req(`/api/conversas/${id}/confirmar`, {}), ctx, {})
    const corpo = (await r.json()) as { codigo: string }
    expect(corpo.codigo).toBe(CODIGO_CRIACAO_NAO_CONCLUIDA)
  })

  it('⚠️ falha TRANSITÓRIA continua sendo 201 com a frase verdadeira — nada mudou aqui', async () => {
    // A distinção é o ponto inteiro do `D-46`: aqui a submissão ficou mesmo na fila, e
    // "nada se perdeu" é verdade. Trocar isto por erro seria a parede que `RNF-18` proíbe.
    fake.estado.falhas.criarChamado = 'indisponivel'
    const r = await tratarRequisicao(req('/api/chamados', CORPO), ctx, {})
    expect(r.status).toBe(201)
    const corpo = (await r.json()) as { estado: string; mensagem: string }
    expect(corpo.estado).toBe('pendente')
    expect(corpo.mensagem).toMatch(/nada se perdeu/i)
    expect(await ctx.outbox.listarPendentes(10)).toHaveLength(1)
  })

  it('duplo clique com sucesso continua idempotente — `RF-24` não foi enfraquecido', async () => {
    const a = await tratarRequisicao(req('/api/chamados', CORPO), ctx, {})
    const b = await tratarRequisicao(req('/api/chamados', CORPO), ctx, {})
    expect(a.status).toBe(201)
    expect(b.status).toBe(201)
    const corpoB = (await b.json()) as { duplicada: boolean; issueKey: string }
    expect(corpoB.duplicada).toBe(true)
    expect(fake.chamadas.filter((c) => c.operacao === 'criarChamado')).toHaveLength(1)
  })
})
