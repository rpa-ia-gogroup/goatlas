/**
 * A fonte organizacional — de onde vem a área do solicitante (`RF-19`).
 *
 * ## Camada isolada, transporte próprio
 *
 * Mesmo raciocínio de `atlassian/organizacao.ts` (`RNF-04`): é outro host, outra
 * credencial e outro formato. Reaproveitar `atlassian/http.ts` "porque ele já resolve
 * backoff" transformaria um bug de roteamento comum em vazamento de credencial.
 *
 * ## Três estados, e a distinção é o requisito
 *
 * `nao_encontrada` e `indisponivel` levam ao mesmo resultado para quem abre o chamado —
 * área ausente, chamado aberto (`RNF-18`) — e a **ações opostas** para quem administra:
 * uma diz "esta pessoa não está no cadastro", a outra diz "a fonte caiu". Um `null` para
 * os dois apagaria a distinção no único lugar onde ela é recuperável, que é a auditoria.
 * É o mesmo desenho de `SchemaDoTipo` (`RF-62`): a incerteza mora no tipo.
 *
 * ## Nada aqui lança
 *
 * Fail-open é o requisito, não uma cortesia: a área é informação de apoio, e uma queda
 * da fonte organizacional não pode virar chamado não aberto. Quem chama não precisa de
 * `try/catch` — se precisasse, um caminho esqueceria.
 *
 * _Requirements: RF-19, RNF-04, RNF-18, RF-58_
 */

/**
 * **Onde** a leitura da base quebrou — `D-40`.
 *
 * 🚨 Existe porque `erro_de_rede` era o fim da linha: um único rótulo cobria "o Worker não
 * alcança o host", "a resposta veio pela metade" e "a promessa da cache não era desta
 * requisição", que pedem consertos opostos e são indistinguíveis na auditoria.
 *
 * - `conexao` — o `fetch` não chegou a devolver uma `Response`. Ninguém do outro lado.
 * - `corpo` — a `Response` veio e a leitura/desserialização dela é que falhou. É o sintoma
 *   de resposta grande demais ou lenta demais para a janela: **os cabeçalhos chegam rápido
 *   e o corpo é que não termina**, e abortar no meio dele não se parece com um timeout.
 * - `promessa` — a falha **não veio da nossa chamada**. A cache do módulo guarda a
 *   *promessa* (não o valor, ao contrário de `cachesAtlassianDoIsolate`), então uma
 *   requisição pode acabar esperando a leitura iniciada por **outra** — e a plataforma
 *   proíbe I/O entre contextos de requisição. Esta fase é o que torna essa hipótese
 *   visível em vez de suposta.
 */
export type FaseTeamGuide = 'conexao' | 'corpo' | 'promessa'

/**
 * Uma falha de leitura da base, já reduzida a **rótulos**.
 *
 * 🚨 Nada aqui carrega a mensagem do erro nem o corpo da resposta (`RNF-01`, `RNF-30`):
 * os dois podem conter nome e e-mail de gente da empresa, e este texto sobe até a
 * auditoria. `classe` é o **nome** do erro, saneado e com teto de tamanho — ver
 * `classeDe` em `http.ts`.
 *
 * ⚠️ `fase` e `classe` só aparecem quando `motivo` **não se explica sozinho**. `http_401`
 * e `formato_inesperado` já dizem tudo; `erro_de_rede` e `timeout` não dizem nada sem elas.
 */
export interface FalhaTeamGuide {
  /** `http_<status>` · `formato_inesperado` · `timeout` · `erro_de_rede` · `credencial_ausente`. */
  readonly motivo: string
  readonly fase?: FaseTeamGuide
  /** Nome/classe do erro em `snake_case` — nunca a mensagem. */
  readonly classe?: string
}

export type ResultadoArea =
  | { readonly estado: 'encontrada'; readonly area: string }
  | { readonly estado: 'nao_encontrada' }
  | ({ readonly estado: 'indisponivel' } & FalhaTeamGuide)

export interface ClienteTeamGuide {
  /** A área organizacional de um e-mail. **Nunca lança.** */
  areaDe(email: string): Promise<ResultadoArea>
  /**
   * Sonda para `RF-59`. **Nunca lança**, pelo mesmo motivo de `areaDe`.
   *
   * ⚠️ Existe para que medir esta camada não custe **abrir um chamado numa fila real**:
   * até `D-40` a única evidência de que a leitura falhava era uma linha de auditoria
   * produzida por alguém abrindo um chamado de verdade.
   */
  verificarSaude(): Promise<{ readonly ok: boolean; readonly detalhe: string }>
}

/** A falha em uma linha, para o health check. Só rótulos — ver `FalhaTeamGuide`. */
export function rotuloDaFalha(f: FalhaTeamGuide): string {
  return [f.motivo, f.fase, f.classe].filter((p) => !!p).join(' · ')
}

/**
 * O estado "não há credencial configurada".
 *
 * ⚠️ Não é um fake, e a distinção é a de `contexto.ts`/T-132: ausência de configuração
 * **nega e denuncia**, nunca simula. Um dublê alcançável fora dos testes produziria área
 * inventada num chamado real, e nada na tela distinguiria.
 */
export class TeamGuideIndisponivel implements ClienteTeamGuide {
  constructor(private readonly motivo: string = 'credencial_ausente') {}

  async areaDe(): Promise<ResultadoArea> {
    return { estado: 'indisponivel', motivo: this.motivo }
  }

  async verificarSaude(): Promise<{ ok: boolean; detalhe: string }> {
    return { ok: false, detalhe: this.motivo }
  }
}
