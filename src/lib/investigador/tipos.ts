/**
 * O vocabulário do Investigador — spec 009.
 *
 * ⚠️ **Uniões fechadas, como `AcaoAuditada`.** Tipo novo de evento exige passar por aqui, o
 * que força a pergunta "isto pertence ao registro?" na revisão — e é o que impede a tabela
 * de virar um saco de strings livres que nenhuma tela consegue agrupar.
 */

/**
 * Quem produziu o evento. É o que a tela colore **e nomeia** — a origem aparece em palavra,
 * nunca só em cor (piso de a11y do projeto).
 */
export type OrigemDeEvento =
  /** A pessoa: mensagem, edição do cartão, campo do formulário, override. */
  | 'usuario'
  /** O provedor de IA: o que foi enviado e o que voltou. */
  | 'ia'
  /** Decisão do servidor: tool permitida/recusada, bloqueio, proposta montada. */
  | 'servidor'
  /** Chamada que saiu daqui para a Atlassian (Jira, Confluence, Organizations). */
  | 'atlassian'
  /** Chamada à fonte organizacional (`RF-19`, `D-37`). */
  | 'teamguide'
  /** Chamada ao OCR Worker (spec 007). */
  | 'ocr'

/**
 * O que aconteceu.
 *
 * ⚠️ **`ia_extracao_recusada` é separado de `ia_extracao`** pela mesma razão que
 * `area_indisponivel` é separado de `area_nao_encontrada`: os dois deixam a pessoa sem
 * cartão e pedem trabalho oposto de quem investiga. Um `motivo` dentro de um tipo só faria
 * a contagem que importa — *quantas conversas morreram sem proposta, e por quê?* — exigir
 * ler o detalhe linha por linha.
 */
export type TipoDeEvento =
  // --- a pessoa ---
  | 'mensagem_usuario'
  | 'proposta_editada'
  | 'formulario_alterado'
  | 'override'
  | 'declaracao_anexo'
  | 'anexo_recebido'
  | 'confirmacao'
  // --- a IA ---
  | 'ia_chat'
  | 'ia_extracao'
  | 'ia_extracao_recusada'
  | 'ia_classificacao'
  | 'anexo_analisado'
  // --- o servidor ---
  | 'resposta_agente'
  | 'tool_executada'
  | 'tool_recusada'
  | 'bloqueio'
  | 'proposta_rederivada'
  | 'payload_final'
  | 'desfecho_criacao'
  | 'erro_de_rota'
  // --- o que sai daqui ---
  | 'chamada_externa'

/** Um evento pronto para a fila da requisição. `dados` ainda não foi truncado nem redigido. */
export interface EventoInvestigador {
  readonly tipo: TipoDeEvento
  readonly origem: OrigemDeEvento
  /** Uma linha em português, que é o que a tela mostra fechada. */
  readonly resumo: string
  readonly conversaId?: string | null
  readonly dados?: Readonly<Record<string, unknown>>
  readonly custoUsd?: number | null
  readonly duracaoMs?: number | null
}

/** Uma chamada que saiu do app — `FR-10b`, o registro do ponto de ruptura. */
export interface ChamadaExterna {
  readonly alvo: 'atlassian' | 'organizacao' | 'ia' | 'teamguide' | 'ocr'
  readonly metodo: string
  /**
   * ⚠️ **Caminho, nunca a URL inteira.** A query carrega CQL e JQL, e JQL pode nomear
   * projeto que quem lê o console não deveria conhecer (`RNF-30`) — o mesmo motivo pelo
   * qual o parâmetro de macro fica fora da tela em `confluence/renderizar.tsx`.
   */
  readonly caminho: string
  readonly status: number | null
  readonly duracaoMs: number
  /** Motivo já classificado (`indisponivel`, `rate_limit`, `timeout`…), nunca a mensagem crua. */
  readonly falha?: string | null
}

/**
 * O observador que os transportes recebem — `FR-10b`.
 *
 * Injetado a partir de `contexto.ts`, nunca lido de variável de módulo: `montarContexto`
 * roda **por requisição**, e é isso que garante que a chamada de uma pessoa não seja
 * atribuída à requisição de outra num isolate com duas em voo.
 */
export type ObservadorDeChamadas = (chamada: ChamadaExterna) => void
