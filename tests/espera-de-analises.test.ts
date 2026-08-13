/**
 * **`T-640`** — a espera do turno pelas análises.
 *
 * ⚠️ **Nada aqui mede tempo de parede** (`D-57`): relógio e `dormir` são injetados, e o que se
 * afirma é **contagem de leituras** e conclusão. Teste que afirma milissegundos falha sozinho
 * em máquina carregada e treina o time a ignorar a suíte.
 *
 * O que se trava:
 *
 * - análise já concluída custa **uma** leitura (`ScC-8`);
 * - o teto é do **turno**, não por arquivo — três anexos não viram 24 s;
 * - linha `analisando` **velha** (upload que morreu) não é esperada, senão a conversa
 *   esperaria 8 s em todo turno, para sempre;
 * - `irrelevante` **não** entra no contexto do modelo (`FR-5b`), e o que ficou lendo é dito.
 *
 * _Requirements: FR-1b, FR-4, FR-5b, FR-7, ScC-8_
 */

import { describe, expect, it } from 'vitest'
import {
  esperarAnalises,
  montarContextoDeAnalises,
  TETO_ESPERA_ANALISES_MS,
  type FonteDeAnalises,
} from '@/lib/agent/espera-de-analises'
import type { AnaliseDeAnexo, EstadoAnalise } from '@/lib/tickets/analises-anexo'

const T0 = Date.parse('2026-08-13T10:00:00.000Z')

function analise(
  nome: string,
  estado: EstadoAnalise,
  extra: { descricao?: string; criadoEmMs?: number } = {},
): AnaliseDeAnexo {
  return {
    id: nome,
    nomeArquivo: nome,
    estado,
    descricao: extra.descricao ?? null,
    criadoEm: new Date(extra.criadoEmMs ?? T0).toISOString(),
    concluidoEm: estado === 'analisando' ? null : new Date(T0).toISOString(),
  }
}

/** Fonte que devolve uma lista diferente a cada leitura — o roteiro da espera. */
function fonte(roteiro: readonly (readonly AnaliseDeAnexo[])[]): FonteDeAnalises & {
  chamadas: number
} {
  let i = 0
  return {
    chamadas: 0,
    async listarDaConversa() {
      const atual = roteiro[Math.min(i, roteiro.length - 1)]!
      i += 1
      this.chamadas = i
      return atual
    },
  }
}

/** Relógio que só anda quando a espera dorme — determinístico. */
function relogio() {
  let agora = T0
  return {
    agoraMs: () => agora,
    dormir: async (ms: number) => {
      agora += ms
    },
    get valor() {
      return agora
    },
  }
}

describe('a espera do turno (T-640)', () => {
  it('análise já concluída custa UMA leitura e zero espera (ScC-8)', async () => {
    const t = relogio()
    const f = fonte([[analise('print.png', 'pronta', { descricao: 'erro X' })]])

    const r = await esperarAnalises({
      analises: f,
      conversaId: 'c1',
      solicitanteEmail: 'ana@gocase.com',
      agoraMs: t.agoraMs,
      dormir: t.dormir,
    })

    expect(r.leituras).toBe(1)
    expect(t.valor, 'o relógio não andou: ninguém dormiu').toBe(T0)
    expect(r.aindaLendo).toEqual([])
  })

  it('espera enquanto está `analisando`, e devolve quando termina', async () => {
    const t = relogio()
    const f = fonte([
      [analise('a.png', 'analisando')],
      [analise('a.png', 'analisando')],
      [analise('a.png', 'pronta', { descricao: 'erro' })],
    ])

    const r = await esperarAnalises({
      analises: f,
      conversaId: 'c1',
      solicitanteEmail: 'ana@gocase.com',
      agoraMs: t.agoraMs,
      dormir: t.dormir,
    })

    expect(r.leituras).toBe(3)
    expect(r.aindaLendo).toEqual([])
    expect(r.analises[0]!.estado).toBe('pronta')
  })

  it('🚨 o teto é do TURNO: três anexos pendentes não viram três esperas', async () => {
    const t = relogio()
    // Nunca termina — é o pior caso.
    const f = fonte([
      [analise('a.png', 'analisando'), analise('b.png', 'analisando'), analise('c.pdf', 'analisando')],
    ])

    const r = await esperarAnalises({
      analises: f,
      conversaId: 'c1',
      solicitanteEmail: 'ana@gocase.com',
      agoraMs: t.agoraMs,
      dormir: t.dormir,
    })

    // O relógio andou no máximo um teto, apesar de haver três arquivos.
    expect(t.valor - T0).toBeLessThanOrEqual(TETO_ESPERA_ANALISES_MS + 250)
    expect(r.aindaLendo).toEqual(['a.png', 'b.png', 'c.pdf'])
  })

  it('🚨 linha `analisando` VELHA não é esperada — senão a conversa espera para sempre', async () => {
    const t = relogio()
    // Aberta um minuto atrás: o upload morreu no meio (isolate reciclado, deploy).
    const f = fonte([[analise('orfa.png', 'analisando', { criadoEmMs: T0 - 60_000 })]])

    const r = await esperarAnalises({
      analises: f,
      conversaId: 'c1',
      solicitanteEmail: 'ana@gocase.com',
      agoraMs: t.agoraMs,
      dormir: t.dormir,
    })

    expect(r.leituras, 'devolveu na primeira leitura').toBe(1)
    expect(t.valor, 'não dormiu').toBe(T0)
    // Continua sendo dito à pessoa: "ainda lendo" e "o upload morreu" pedem a mesma ação.
    expect(r.aindaLendo).toEqual(['orfa.png'])
  })
})

describe('o que o agente principal recebe (FR-4, FR-5b)', () => {
  const espera = (analises: readonly AnaliseDeAnexo[], aindaLendo: readonly string[] = []) => ({
    analises,
    aindaLendo,
    leituras: 1,
  })

  it('descrição de `pronta` vai DELIMITADA, com o nome do arquivo', () => {
    const texto = montarContextoDeAnalises(
      espera([analise('print.png', 'pronta', { descricao: 'erro PIPELINE_TIMEOUT' })]),
    )
    expect(texto).toContain('<dados_nao_confiaveis')
    expect(texto).toContain('arquivo:print.png')
    expect(texto).toContain('PIPELINE_TIMEOUT')
  })

  it('🚨 `irrelevante` NÃO entra no contexto do modelo', () => {
    const texto = montarContextoDeAnalises(
      espera([analise('cracha.jpg', 'irrelevante', { descricao: 'foto de crachá' })]),
    )
    // Nada a acrescentar ao turno: o modelo não deve falar sobre a foto dela.
    expect(texto).toBeNull()
  })

  it('arquivo ainda sendo lido é DITO como fato, com instrução de não afirmar conteúdo', () => {
    const texto = montarContextoDeAnalises(espera([], ['relatorio.pdf']))
    expect(texto).toContain('relatorio.pdf')
    expect(texto).toMatch(/não afirme/i)
  })

  it('conversa sem anexo nenhum não acrescenta nada ao turno', () => {
    expect(montarContextoDeAnalises(espera([]))).toBeNull()
  })

  it('os dois juntos: uma pronta e uma em leitura', () => {
    const texto = montarContextoDeAnalises(
      espera([analise('a.png', 'pronta', { descricao: 'tela de erro' })], ['b.pdf']),
    )
    expect(texto).toContain('tela de erro')
    expect(texto).toContain('b.pdf')
  })
})
