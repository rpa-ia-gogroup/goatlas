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

export type ResultadoArea =
  | { readonly estado: 'encontrada'; readonly area: string }
  | { readonly estado: 'nao_encontrada' }
  | { readonly estado: 'indisponivel'; readonly motivo: string }

export interface ClienteTeamGuide {
  /** A área organizacional de um e-mail. **Nunca lança.** */
  areaDe(email: string): Promise<ResultadoArea>
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
}
