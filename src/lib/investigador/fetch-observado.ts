/**
 * O ponto de ruptura, medido onde ele acontece — spec 009, `FR-10b`.
 *
 * ## Por que embrulhar o `fetch`, e não cada transporte
 *
 * Os cinco transportes externos (Jira/Confluence, Organizations, IA, TeamGuide, OCR) já
 * aceitam `fetchImpl` — é como os testes os controlam desde a Fase 1. Instrumentar por aí
 * significa **zero linha** dentro deles: nenhuma chance de um ganhar o registro e outro
 * não, nenhuma chamada nova para alguém esquecer de instrumentar, e o transporte que
 * nascer amanhã só precisa receber este `fetch` para já estar coberto.
 *
 * ⚠️ **A retentativa aparece como duas linhas, e isso é o desejado.** O backoff dos
 * transportes chama o `fetch` de novo; ver `429 → espera → 200` é precisamente o que
 * responde "por que aquele turno levou 40 s?" (`RNF-15`, `R-02`). Colapsar em uma linha
 * esconderia o sintoma mais caro do app.
 *
 * ## O que NÃO entra
 *
 * Cabeçalho e corpo. É por ali que andam as cinco credenciais (`RNF-01`), e o corpo de uma
 * chamada à Atlassian carrega CQL/JQL e conteúdo de chamado de terceiros (`RNF-30`). O que
 * se guarda é **caminho**, status e tempo — o suficiente para localizar a ruptura, e nada
 * além disso.
 */

import type { ChamadaExterna, ObservadorDeChamadas } from './tipos'

/** Só o caminho. Query fica de fora — ver o cabeçalho. */
function caminhoDe(entrada: RequestInfo | URL): string {
  try {
    const bruto =
      typeof entrada === 'string'
        ? entrada
        : entrada instanceof URL
          ? entrada.toString()
          : entrada.url
    return new URL(bruto).pathname
  } catch {
    // URL relativa ou objeto inesperado: melhor um rótulo honesto que uma exceção dentro
    // do instrumento de investigação.
    return '(caminho não reconhecido)'
  }
}

/**
 * Classifica a falha em **rótulo**, nunca em mensagem.
 *
 * ⚠️ Mesmo critério de `teamguide/http.ts` (`D-40`): a mensagem de um erro de terceiro pode
 * carregar host, corpo e — no pior caso — credencial. O nome do erro é um rótulo por
 * construção; a mensagem não é.
 */
function rotuloDaFalha(e: unknown): string {
  const alvo = e as { name?: unknown; constructor?: { name?: unknown } }
  const nome =
    (typeof alvo?.name === 'string' && alvo.name) ||
    (typeof alvo?.constructor?.name === 'string' && alvo.constructor.name) ||
    'erro'
  return String(nome).toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 24)
}

/**
 * Devolve um `fetch` que registra cada chamada antes de devolver o que o `fetch` real
 * devolveria.
 *
 * ⚠️ **Repassa o erro.** O embrulho observa e sai do caminho: engolir a exceção aqui
 * mudaria o comportamento de cinco transportes por causa de um registro, que é exatamente o
 * que `FR-20` proíbe na direção oposta.
 */
export function fetchObservado(
  alvo: ChamadaExterna['alvo'],
  observar: ObservadorDeChamadas,
  base: typeof fetch = fetch.bind(globalThis),
  agoraMs: () => number = () => Date.now(),
): typeof fetch {
  return async (entrada: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const comeco = agoraMs()
    const metodo = String(
      init?.method ?? (typeof entrada === 'object' && 'method' in entrada ? entrada.method : 'GET'),
    ).toUpperCase()
    const caminho = caminhoDe(entrada)
    try {
      const r = await base(entrada, init)
      observar({ alvo, metodo, caminho, status: r.status, duracaoMs: agoraMs() - comeco })
      return r
    } catch (e) {
      // ⚠️ Sem `Response` não há status, e `0` seria um status inventado — a distinção entre
      // "o servidor recusou" e "não houve resposta" é a que separa dois plantões diferentes.
      observar({
        alvo,
        metodo,
        caminho,
        status: null,
        duracaoMs: agoraMs() - comeco,
        falha: rotuloDaFalha(e),
      })
      throw e
    }
  }
}
