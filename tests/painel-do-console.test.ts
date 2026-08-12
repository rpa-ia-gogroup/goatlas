/**
 * **T-233 / T-310 / T-312** — o que o servidor calcula CHEGA à tela.
 *
 * ## Por que este arquivo existe
 *
 * A calibragem foi entregue em `T-310`, sobreviveu a duas fases e **sumiu** no rewrite do
 * console (`D-25`) sem uma asserção vermelha: `governanca/painel.ts` continuou montando
 * `calibragem`, `sla`, `chamadosPorArea` e `chamadosPorPrioridade`, e `admin/paineis.tsx`
 * passou a consumir só `painel.evidencia`. O rastro que sobrou foi um CSS órfão. Nada em
 * `tests/tela-admin.test.ts` reprovava, porque aquele arquivo afirma sobre **descritores de
 * campo, rótulos e estados** — nunca sobre *quais painéis são renderizados*.
 *
 * ## O que se afirma aqui, e o que deliberadamente NÃO se afirma
 *
 * Afirma-se que **cada número calculado tem uma casa e aparece nela**. Não se afirma nada
 * sobre layout, classe de CSS, ordem ou texto de apoio: um teste que copiasse o desenho
 * reprovaria em toda melhoria de tela, e é assim que testes de UI viram peso morto e são
 * apagados — que devolveria o buraco que este arquivo existe para tapar.
 *
 * O `Record<keyof ResumoPainel, …>` é a segunda camada, e é de compilação: campo novo no
 * painel **sem destino declarado** não compila. Mesmo desenho do mapa `FAMILIA` em
 * `config/validar.ts`.
 *
 * _Requirements: RF-50, RF-55, R-04_
 */

import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import type { ResumoMetricas, ResumoPainel } from '@/app/api'
import { SECOES } from '@/app/admin/campos'
import { PAINEIS_DO_CONSOLE } from '@/app/admin/paineis'
import { DadosDaSecao } from '@/app/admin'
import { montarPainel } from '@/lib/governanca/painel'
import type { SecaoDoConsole } from '@/lib/config/diagnostico'

/**
 * Números distintos e improváveis, um por painel: o que a asserção procura no HTML é o
 * **valor**, não a moldura. Se o painel deixar de ser renderizado, o número some.
 */
const PAINEL: ResumoPainel = {
  chamadosPorArea: [{ area: 'Logística', total: 4102 }],
  chamadosPorPrioridade: { alta: 4103 },
  canal: { porVia: { conversa: 4104, formulario: 7 }, totalPeloApp: 4111 },
  calibragem: [
    {
      regra: 'regra1_confluence',
      thresholdAtual: 0.75,
      totalBloqueios: 4108,
      overrides: 2054,
      taxaOverridePct: 50,
      motivosDeOverride: ['a página não fala do meu caso'],
      paginasApontadas: [{ titulo: 'Como pedir acesso ao Metabase', vezes: 3 }],
    },
  ],
  notificacoes: { pendente: 1, enviada: 2, falha: 3, suprimida: 4105 },
  telemetriaAtlassian: {
    total429: 4106,
    totalRequisicoes: 90000,
    taxa429Pct: 4.5,
    acimaDoLimiar: true,
  },
  ia: { conversas: 4107, custoTotalUsd: 12.5, custoMedioUsd: 0.003, conversasNoTeto: 0 },
  sla: {
    totalAvaliados: 4101,
    respondidos: 10,
    dentroDoPrazo: 9,
    aderenciaPct: 90,
    emRisco: 1,
    estourados: 2,
  },
  evidencia: {
    chamadosCriados: 20,
    perguntados: 4110,
    comEvidencia: 8,
    declarouTerEFalhou: 1,
    declarouNaoTer: 3,
    semPergunta: 2,
    taxaPct: 40,
  },
  deflexaoResolvidaConhecida: false,
  avisoDeflexao: 'A taxa de deflexão conta quem foi bloqueado e não abriu chamado.',
  deflexaoAparente: {
    bloqueiosSemOverride: 4109,
    semChamadoDepois: 3000,
    taxaPct: 73,
    janelaDias: 7,
    viesConhecido: 'Quem foi pedir pelo canal antigo conta aqui como "resolveu".',
  },
}

const METRICAS: ResumoMetricas = {
  deflexaoPorRegra: [
    { regra: 'regra1_confluence', totalBloqueios: 4108, overrides: 2054, taxaDeflexaoPct: 50 },
  ],
  totalBloqueios: 4108,
  totalOverrides: 2054,
  taxaOverrideGlobalPct: 50,
  chamadosPorVia: { conversa: 4104 },
  buscas: { total: 12, semResultado: 4, taxaSemResultadoPct: 33.3 },
  area: { comArea: 5, semArea: 2, naoEncontrada: 1, indisponivel: 1 },
  painel: PAINEL,
  baselineAssentos: { coletadoEm: '2026-07-01T00:00:00.000Z', porProduto: { jira: 4112 } },
  canalNotificacaoDefinido: false,
  piloto: { ligado: false, pessoas: 0 },
}

/** O que precisa aparecer na tela, por campo do painel. `null` = não é um número. */
const MARCA: Readonly<Record<keyof ResumoPainel, string | null>> = {
  chamadosPorArea: '4102',
  chamadosPorPrioridade: '4103',
  canal: '4104',
  calibragem: '4108',
  notificacoes: '4105',
  telemetriaAtlassian: '4106',
  ia: '4107',
  sla: '4101',
  evidencia: '4110',
  deflexaoAparente: '4109',
  // O viés de T-235 é texto, não número — mas some da tela do mesmo jeito (`D-20`).
  avisoDeflexao: 'defle',
  // Flag: o que ela governa é o aviso acima. Não tem número próprio.
  deflexaoResolvidaConhecida: null,
}

function renderizarSecao(secao: SecaoDoConsole): string {
  const descritor = SECOES.find((s) => s.id === secao)!
  return renderToStaticMarkup(
    createElement(DadosDaSecao, {
      secao: descritor,
      metricas: { estado: 'pronto', dado: METRICAS },
      lacunas: { estado: 'carregando' },
      assentos: { estado: 'carregando' },
      recomendacoes: { estado: 'carregando' },
      auditoria: { estado: 'carregando' },
      precos: {},
      precosSalvos: {},
      salvando: null,
      filtroAuditoria: '',
      aoMudarFiltro: () => {},
      aoFiltrarAuditoria: () => {},
      aoMudarPreco: () => {},
      aoSalvarPrecos: () => {},
    }),
  )
}

describe('nenhum número calculado fica sem casa', () => {
  it('todo campo que `montarPainel` produz tem destino declarado no console', () => {
    // A fonte é o servidor, não a lista da tela: campo novo em `ResumoPainel` aparece
    // aqui antes de alguém lembrar de renderizá-lo.
    const doServidor = montarPainel({
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
      anexosPorChamado: [],
    })

    for (const campo of Object.keys(doServidor)) {
      expect(
        Object.prototype.hasOwnProperty.call(PAINEIS_DO_CONSOLE, campo),
        `${campo} é calculado e não tem seção declarada em PAINEIS_DO_CONSOLE`,
      ).toBe(true)
    }
  })

  it('a seção declarada existe de verdade no console', () => {
    const ids = new Set(SECOES.map((s) => s.id))
    for (const [campo, secao] of Object.entries(PAINEIS_DO_CONSOLE)) {
      if (secao === null) continue
      expect(ids.has(secao), `${campo} aponta para a seção ${secao}`).toBe(true)
    }
  })
})

describe('o painel calculado APARECE na seção em que ele mora', () => {
  const comCasa = (Object.keys(MARCA) as (keyof ResumoPainel)[]).filter(
    (c) => PAINEIS_DO_CONSOLE[c] !== null && MARCA[c] !== null,
  )

  it.each(comCasa)('%s chega ao HTML', (campo) => {
    const html = renderizarSecao(PAINEIS_DO_CONSOLE[campo]!)
    expect(html, `${campo} sumiu da tela — o servidor calcula e ninguém desenha`).toContain(
      MARCA[campo]!,
    )
  })
})

describe('taxa sem dado é "sem dados", nunca 0% (T-095)', () => {
  const zerado: ResumoMetricas = {
    ...METRICAS,
    painel: {
      ...PAINEL,
      sla: { ...PAINEL.sla, totalAvaliados: 0, respondidos: 0, aderenciaPct: null },
      calibragem: [
        {
          ...PAINEL.calibragem[0]!,
          totalBloqueios: 0,
          overrides: 0,
          taxaOverridePct: null,
          motivosDeOverride: [],
          paginasApontadas: [],
        },
      ],
    },
  }

  function renderZerado(secao: SecaoDoConsole): string {
    const descritor = SECOES.find((s) => s.id === secao)!
    return renderToStaticMarkup(
      createElement(DadosDaSecao, {
        secao: descritor,
        metricas: { estado: 'pronto', dado: zerado },
        lacunas: { estado: 'carregando' },
        assentos: { estado: 'carregando' },
        recomendacoes: { estado: 'carregando' },
        auditoria: { estado: 'carregando' },
        precos: {},
        precosSalvos: {},
        salvando: null,
        filtroAuditoria: '',
        aoMudarFiltro: () => {},
        aoFiltrarAuditoria: () => {},
        aoMudarPreco: () => {},
        aoSalvarPrecos: () => {},
      }),
    )
  }

  it('aderência ao SLA sem ninguém avaliado não vira 0%', () => {
    const html = renderZerado('chamados')
    expect(html).toMatch(/sem dados/i)
    expect(html).not.toContain('0.0%')
  })

  it('calibragem sem bloqueio nenhum diz que nada foi medido — e a barra também', () => {
    const html = renderZerado('interrupcao')
    expect(html).toMatch(/sem dados/i)
    // A barra vazia leria como "0% insistiram". O trilho listrado é o estado "nada
    // medido", e ele é anunciado por texto: estado nunca só por cor (regra 9).
    expect(html).toContain('data-sem-dados="true"')
    expect(html).toMatch(/aria-label="[^"]*bloqueio[^"]*"/i)
  })
})

describe('a calibragem não mostra a barra sozinha (T-310, R-04)', () => {
  it('threshold, taxa, motivos e páginas apontadas moram na mesma caixa', () => {
    const html = renderizarSecao('interrupcao')
    // A ordem não importa; a coexistência é o requisito. Mostrar "50% insistiram" ao
    // lado de um input de threshold, sem os motivos, empurra para mexer no número
    // quando a resposta certa é escrever a página que as pessoas apontaram.
    expect(html).toContain('a página não fala do meu caso')
    expect(html).toContain('Como pedir acesso ao Metabase')
    expect(html).toContain('75')
  })
})
