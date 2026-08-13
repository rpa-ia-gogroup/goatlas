/**
 * A espera do turno pelas análises em curso — spec 007, `FR-1b`.
 *
 * ## Por que a rota da mensagem espera, se a análise começa no upload
 *
 * Porque quem cola o print e manda a mensagem em dois segundos chega **antes** de o upload
 * terminar. No caso comum a análise já acabou e esta função devolve na primeira leitura, sem
 * espera nenhuma (`ScC-8`).
 *
 * ## O que ela NÃO faz (achado `F2` do `/analyze`)
 *
 * Não analisa nada por conta própria. A primeira versão do plano punha aqui uma
 * "reivindicação" para o caso de o `waitUntil` do upload ter sido cortado — e isso é
 * **impossível**: os bytes só existem na requisição de upload (`plan.md` §3.4). Uma função que
 * tentasse ler o arquivo aqui não teria o arquivo.
 *
 * ## Duas coisas que o teto protege
 *
 * ⚠️ **O teto é do TURNO, não por arquivo**: três anexos não viram 24 s.
 *
 * ⚠️ **Linha `analisando` VELHA não é esperada.** Se o upload morreu no meio (isolate
 * reciclado, deploy no instante errado), a linha fica `analisando` para sempre — e sem este
 * corte a conversa da pessoa esperaria 8 s **em todo turno, para sempre**. Velha é tratada
 * como pendente-que-não-vem: o turno segue e a tela diz que aquele arquivo não foi lido
 * (`FR-7`).
 *
 * ⚠️ **Nada aqui mede tempo de parede em teste** (`D-57`): o relógio e o `dormir` são
 * injetados, e o que a suíte afirma é **contagem de leituras** e conclusão.
 *
 * _Requirements: FR-1b, FR-4, FR-7, RNF-12_
 */

import {
  analiseConcluida,
  analiseVaiParaConversa,
  type AnaliseDeAnexo,
} from '../tickets/analises-anexo'
import { delimitarConteudoNaoConfiavel } from '../ia/tipos'

/** Teto de espera por turno. `RNF-12` pede a primeira resposta em < 5 s; ver `SC-7b`. */
export const TETO_ESPERA_ANALISES_MS = 8000
/** Intervalo entre releituras. Curto o bastante para não somar espera perceptível. */
export const INTERVALO_RELEITURA_MS = 250

export interface EsperaDeAnalises {
  /** As análises como estão no fim da espera. */
  readonly analises: readonly AnaliseDeAnexo[]
  /** Nomes que continuaram `analisando` — a tela diz que estão sendo lidos. */
  readonly aindaLendo: readonly string[]
  /** Quantas leituras do banco a espera custou. É sobre isto que o teste afirma. */
  readonly leituras: number
}

export interface FonteDeAnalises {
  listarDaConversa(
    conversaId: string,
    solicitanteEmail: string,
  ): Promise<readonly AnaliseDeAnexo[]>
}

export async function esperarAnalises(params: {
  readonly analises: FonteDeAnalises
  readonly conversaId: string
  readonly solicitanteEmail: string
  readonly agoraMs: () => number
  readonly dormir: (ms: number) => Promise<void>
  readonly tetoMs?: number
}): Promise<EsperaDeAnalises> {
  const teto = params.tetoMs ?? TETO_ESPERA_ANALISES_MS
  const comeco = params.agoraMs()
  let leituras = 0

  for (;;) {
    const analises = await params.analises.listarDaConversa(
      params.conversaId,
      params.solicitanteEmail,
    )
    leituras += 1

    const pendentes = analises.filter(
      (a) => !analiseConcluida(a.estado) && !ficouParaTras(a, params.agoraMs(), teto),
    )
    const estourou = params.agoraMs() - comeco >= teto
    if (pendentes.length === 0 || estourou) {
      return {
        analises,
        // ⚠️ Inclui a linha velha: para a pessoa, "ainda sendo lido" e "o upload morreu"
        // produzem a mesma ação (esperar ou reenviar), e afirmar a segunda exigiria saber
        // algo que não sabemos.
        aindaLendo: analises.filter((a) => !analiseConcluida(a.estado)).map((a) => a.nomeArquivo),
        leituras,
      }
    }

    await params.dormir(INTERVALO_RELEITURA_MS)
  }
}

/** A análise foi aberta há mais que um turno inteiro? Então ninguém está do outro lado. */
function ficouParaTras(a: AnaliseDeAnexo, agoraMs: number, tetoMs: number): boolean {
  const abertaEm = Date.parse(a.criadoEm)
  if (Number.isNaN(abertaEm)) return false
  return agoraMs - abertaEm > tetoMs
}

/**
 * O que o agente principal recebe — `FR-4`, `FR-5b`, `FR-9`.
 *
 * 🚨 **Delimitado**, com a mesma função do Confluence: é texto derivado de um arquivo que
 * ninguém revisou, e o vetor de `R-07` neste canal é um print com instrução dentro.
 *
 * ⚠️ **Análise `irrelevante` não entra** (`FR-5b`): mandar "o arquivo não tem nada útil" ao
 * modelo produz exatamente a frase que a pessoa não deve ler sobre a foto dela.
 *
 * ⚠️ **Arquivo ainda sendo lido é DITO, como fato.** Sem isso o modelo responde como se não
 * houvesse anexo — e foi justamente esse silêncio que `D-59` corrigiu do outro lado.
 *
 * `null` = não há nada a acrescentar ao turno.
 */
export function montarContextoDeAnalises(espera: EsperaDeAnalises): string | null {
  const prontas = espera.analises.filter(analiseVaiParaConversa)
  if (prontas.length === 0 && espera.aindaLendo.length === 0) return null

  const partes: string[] = []
  if (prontas.length > 0) {
    partes.push(
      'A pessoa enviou estes arquivos, e o que foi lido de cada um está abaixo:',
      ...prontas.map((a) =>
        delimitarConteudoNaoConfiavel(`arquivo:${a.nomeArquivo}`, a.descricao ?? ''),
      ),
    )
  }
  if (espera.aindaLendo.length > 0) {
    partes.push(
      `Ainda estou lendo ${espera.aindaLendo.length === 1 ? 'um arquivo' : 'estes arquivos'} que a pessoa enviou: ${espera.aindaLendo.join(', ')}. Não afirme o que eles contêm.`,
    )
  }
  return partes.join('\n')
}
