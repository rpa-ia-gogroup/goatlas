/**
 * Cliente de IA para quando a chave NÃO está configurada — e o resto está.
 *
 * Existe por um fail-open real: `montarContexto` escolhia `ClienteIAFake` sempre
 * que `LLM_API_KEY` faltava, inclusive com `usandoFakes === false`. Isso produzia
 * a pior combinação possível do app — **Atlassian real com IA falsa**: o agente
 * responderia com o roteiro de demonstração (`demo.ts`) e o chamado nascido dessa
 * conversa iria para o JSM de verdade. Quem lê a tela não tem como distinguir um
 * roteiro fixo de uma resposta de modelo.
 *
 * O fake é dublê de teste e de demonstração. Fora desses dois contextos ele não
 * deve ser alcançável, e agora só é por `usandoFakes`.
 *
 * A ausência de chave é **definitiva** (`transitorio: false`): repetir não
 * resolve, alguém precisa configurar. Mas não é parede — `RNF-18` e `D-04`: o
 * formulário mínimo não passa por aqui e segue abrindo chamado. O que morre é o
 * caminho do agente, que é exatamente o que depende de um modelo existir.
 *
 * _Requirements: RNF-18, RNF-25, D-04, D-05_
 */

import {
  ErroIA,
  type ClienteIA,
  type ParametrosChat,
  type ParametrosClassificacao,
  type ParametrosExtracao,
  type RespostaIA,
  type ResultadoClassificacao,
  type ResultadoExtracao,
} from './tipos'

/** Mensagem única: o motivo é o mesmo em toda operação, e não vaza nada. */
const MOTIVO = 'IA não configurada: falta a chave do provedor (LLM_API_KEY)'

export class ClienteIAIndisponivel implements ClienteIA {
  private recusar(etapa: string): never {
    throw new ErroIA(MOTIVO, { transitorio: false, etapa })
  }

  async chat(_params: ParametrosChat): Promise<RespostaIA> {
    this.recusar('chat')
  }

  async classificarResolucao(
    _params: ParametrosClassificacao,
  ): Promise<ResultadoClassificacao> {
    // A Regra 2 fica sem classificação — o ticket é marcado como não verificado
    // pelo executor de tools, que é o comportamento que `RNF-18` pede.
    // Indisponibilidade informa e degrada; nunca vira bypass silencioso.
    this.recusar('classificacao')
  }

  async extrairProposta(_params: ParametrosExtracao): Promise<ResultadoExtracao> {
    // Sem proposta o agente continua perguntando — pior caso aceitável. Criar
    // chamado com conteúdo inventado não seria.
    this.recusar('extracao')
  }

  async verificarSaude(): Promise<{ ok: boolean; detalhe: string }> {
    // `RF-59` — o health é o sinal para quem operou o deploy. Sem isto, subir sem
    // a chave parecia saudável enquanto o agente respondia roteiro de demo.
    return { ok: false, detalhe: 'chave de IA não configurada' }
  }
}
