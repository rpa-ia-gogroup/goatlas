/**
 * A trava de RF-08 / RN-01 — constituição, Princípio X.
 *
 * `create_ticket` NUNCA executa sem `search_confluence` E `check_jira_history`
 * terem rodado antes, na mesma conversa. Validado no **servidor**, não instruído
 * no system prompt: um modelo pode ser induzido a ignorar instrução; código não.
 *
 * ## Por que duas camadas, e não uma
 *
 * 1. **Não oferecer** — `toolsPermitidas()` monta, a cada turno, o conjunto que o
 *    modelo pode chamar. Reduz a chance de ele tentar.
 * 2. **Recusar se vier** — `autorizarCriacao()` valida o estado persistido no
 *    momento da execução. É esta que sobrevive a prompt injection (RNF-08, R-07),
 *    a nome de tool inventado, e a uma requisição forjada direto na rota.
 *
 * A camada 1 sozinha é teatro: quem chama a rota HTTP direto não passa por ela. A
 * camada 2 sozinha basta para a segurança, mas deixa o modelo tropeçar à toa. As
 * duas juntas são o desenho.
 *
 * ⚠️ `create_ticket` **não é uma tool de modelo neste código**. Criar chamado é
 * transição disparada por rota do usuário (RF-17, RN-02) — o modelo não tem como
 * confirmar em nome de ninguém. Ele só *propõe* o conteúdo.
 */

import type { Conversa } from './estado'
import type { DefinicaoTool, NomeTool } from '../ia/tipos'

export const TOOLS: Readonly<Record<NomeTool, DefinicaoTool>> = Object.freeze({
  search_confluence: {
    nome: 'search_confluence',
    descricao:
      'Verifica se a resposta para a demanda já está documentada no Confluence. Use assim que tiver um tópico identificável, ANTES de propor abrir chamado.',
    parametros: {
      type: 'object',
      properties: {
        topico: {
          type: 'string',
          description: 'Tópico extraído da conversa, ex.: "tabela orders", "pipeline de vendas diário"',
        },
      },
      required: ['topico'],
    },
  },
  check_jira_history: {
    nome: 'check_jira_history',
    descricao:
      'Analisa chamados anteriores do mesmo tipo para detectar padrão de ajuste operacional recorrente. Use depois de identificar o tipo de problema.',
    parametros: {
      type: 'object',
      properties: {
        tipoProblema: {
          type: 'string',
          description: 'Tipo do problema identificado na conversa, usado para agrupar o histórico',
        },
      },
      required: ['tipoProblema'],
    },
  },
})

export type MotivoRecusa =
  | 'confluence_nao_verificado'
  | 'historico_nao_verificado'
  | 'sem_confirmacao_do_usuario'
  | 'conversa_ja_criou_chamado'
  | 'conversa_encerrada'
  | 'sem_proposta'

export type Autorizacao =
  | { readonly ok: true; readonly verificadoPelasRegras: boolean }
  | { readonly ok: false; readonly motivos: readonly MotivoRecusa[] }

/**
 * As tools que o servidor permite ao modelo NESTE turno.
 *
 * Uma tool que já rodou sai da lista: repetir a mesma verificação gasta orçamento
 * de IA (RNF-16) e chamada da Atlassian (RNF-15) sem mudar o estado.
 */
export function toolsPermitidas(conversa: Conversa): readonly DefinicaoTool[] {
  if (conversa.estado === 'encerrado' || conversa.estado === 'criado') return []

  const permitidas: DefinicaoTool[] = []
  if (!conversa.confluenceVerificado && !conversa.confluenceFalhou) {
    permitidas.push(TOOLS.search_confluence)
  }
  if (!conversa.historicoVerificado && !conversa.historicoFalhou) {
    permitidas.push(TOOLS.check_jira_history)
  }
  return permitidas
}

/** Nome proposto pelo modelo é uma tool real e permitida agora? */
export function toolAutorizada(conversa: Conversa, nomeProposto: string): boolean {
  return toolsPermitidas(conversa).some((t) => t.nome === nomeProposto)
}

/**
 * A trava. Chamada **imediatamente antes** de criar o chamado, sempre, por
 * qualquer caminho.
 *
 * Sobre "verificado": uma tool que **falhou** (RNF-18) satisfaz a exigência de
 * ordem — a conversa tentou — mas o chamado nasce com
 * `verificadoPelasRegras: false`. É a diferença entre *não deixar a
 * indisponibilidade virar bypass silencioso* e *transformar indisponibilidade em
 * parede*: o requisito pede o primeiro. O que **não** satisfaz é a tool nunca ter
 * sido chamada.
 */
export function autorizarCriacao(conversa: Conversa): Autorizacao {
  const motivos: MotivoRecusa[] = []

  if (conversa.estado === 'criado') motivos.push('conversa_ja_criou_chamado')
  if (conversa.estado === 'encerrado') motivos.push('conversa_encerrada')

  const confluenceTentado = conversa.confluenceVerificado || conversa.confluenceFalhou
  const historicoTentado = conversa.historicoVerificado || conversa.historicoFalhou
  if (!confluenceTentado) motivos.push('confluence_nao_verificado')
  if (!historicoTentado) motivos.push('historico_nao_verificado')

  // RF-17 / RN-02 — nenhum chamado nasce sem confirmação explícita do usuário.
  if (!conversa.confirmadoEm) motivos.push('sem_confirmacao_do_usuario')
  if (!conversa.proposta) motivos.push('sem_proposta')

  if (motivos.length > 0) return { ok: false, motivos }

  return {
    ok: true,
    verificadoPelasRegras: conversa.confluenceVerificado && conversa.historicoVerificado,
  }
}

/** Erro lançado quando a trava recusa. Nome próprio para o teste poder afirmar sobre ele. */
export class CriacaoRecusada extends Error {
  constructor(readonly motivos: readonly MotivoRecusa[]) {
    super(`criação de chamado recusada pelo servidor: ${motivos.join(', ')}`)
    this.name = 'CriacaoRecusada'
  }
}

export const MENSAGEM_RECUSA: Readonly<Record<MotivoRecusa, string>> = Object.freeze({
  confluence_nao_verificado:
    'Preciso verificar antes se isso já está documentado no Confluence.',
  historico_nao_verificado:
    'Preciso verificar antes se esse problema já apareceu em chamados anteriores.',
  sem_confirmacao_do_usuario:
    'Preciso da sua confirmação explícita antes de abrir o chamado.',
  conversa_ja_criou_chamado: 'Esta conversa já gerou um chamado.',
  conversa_encerrada: 'Esta conversa foi encerrada.',
  sem_proposta: 'Ainda não tenho o conteúdo do chamado montado.',
})
