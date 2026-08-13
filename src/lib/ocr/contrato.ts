/**
 * Contrato da leitura de PDF — a camada isolada da **quinta credencial** do projeto.
 *
 * ## Por que existe uma camada, e não um `fetch` na rota
 *
 * `RNF-04`: cada credencial que atravessa a fronteira tem transporte próprio. São cinco
 * agora — API token do Jira/Confluence · chave de organização · chave de IA · token da
 * TeamGuide · **token do OCR Worker**. Reaproveitar o transporte de outra transformaria um
 * bug de roteamento comum em vazamento da credencial errada.
 *
 * ## O que este contrato promete, e o que ele não promete
 *
 * Promete **texto ou falha rotulada**, nunca exceção crua. Não promete que o PDF tenha texto:
 * PDF de uma página em branco devolve string vazia, e isso é `sem_conteudo` — não é erro, e a
 * distinção importa porque as duas frases na tela são opostas (`FR-7`).
 *
 * ⚠️ **Nada aqui carrega o conteúdo do arquivo para dentro de um rótulo** (`RNF-01`,
 * `RNF-30`): o que sai é `motivo` e, quando ele não se explica sozinho, `fase`/`classe` —
 * o mesmo desenho de `FalhaTeamGuide` (`D-40`).
 *
 * _Requirements: FR-6, FR-7, FR-8, RNF-01, RNF-04, RNF-30_
 */

/** Onde a falha aconteceu. Mesmo vocabulário de `FaseTeamGuide` (`D-40`), pela mesma razão. */
export type FaseOcr = 'conexao' | 'corpo'

export interface FalhaOcr {
  /**
   * `credencial_malformada` · `http_<status>` · `formato_inesperado` · `timeout` ·
   * `erro_de_rede`. Os dois primeiros se explicam sozinhos; os outros ganham `fase`/`classe`.
   */
  readonly motivo: string
  readonly fase?: FaseOcr
  /** **Nome** da classe do erro, saneado. Nunca a mensagem (`D-40`). */
  readonly classe?: string
}

export type ResultadoOcr =
  | { readonly estado: 'lido'; readonly texto: string }
  /** O worker respondeu, e não havia texto: PDF em branco, ou imagem sem nada legível. */
  | { readonly estado: 'sem_conteudo' }
  | ({ readonly estado: 'falhou' } & FalhaOcr)

/**
 * Lê o texto de um PDF. **Não lança** — falha vem no retorno.
 *
 * ⚠️ É função, não classe, porque não há estado a guardar: sem cache (cada arquivo é único,
 * cachear seria guardar conteúdo pessoal em memória) e sem sessão.
 */
export type LeitorPdf = (bytes: Uint8Array) => Promise<ResultadoOcr>

/** Rótulo curto para `/api/health` e para a auditoria. Nunca inclui conteúdo. */
export function rotuloDaFalhaOcr(f: FalhaOcr): string {
  return [f.motivo, f.fase, f.classe].filter((p) => !!p).join(' · ')
}
