/**
 * A conversa como se lê — spec 014, `FR-34` e `FR-35`.
 *
 * ## Por que este arquivo existe
 *
 * A spec 013 pôs a conversa num `<details>` **fechado, no fim da página**, com o rótulo
 * *"A conversa como o modelo a leu"* e uma lista de `<pre>`. O raciocínio da época era
 * defensável — a linha do tempo já mostra o que a pessoa escreveu — e estava errado em duas
 * pontas:
 *
 * 1. A conversa **é** o objeto da investigação. Quem abre o Investigador quer saber o que
 *    aconteceu com uma pessoa, e isso se lê como diálogo, não como log de servidor.
 * 2. O que a pessoa fez **à mão** — editar o cartão, corrigir um campo, insistir num
 *    bloqueio, confirmar a abertura — sumia no meio de 32 eventos com o mesmo desenho.
 *    Depois do fato, ninguém sabia onde ela interveio.
 *
 * Aqui as duas fontes viram **uma sequência só**: as falas de `mensagens` (a tabela de
 * produção, a mesma que o modelo lê) e os **marcos** do registro, no instante em que
 * aconteceram.
 *
 * ## As decisões
 *
 * ⚠️ **Marco é allowlist, nunca "tudo o que não é fala".** Jogar os 21 tipos aqui devolveria
 * a parede que a spec 014 existe para desfazer — `ia_chat` sozinho carrega o histórico
 * inteiro a cada ciclo. Quem quer todos continua tendo a aba **Linha do tempo**, que não
 * perdeu nada.
 *
 * ⚠️ **A autoria vem do MARCO, não da origem do evento.** `origem: 'usuario'` é quase o
 * mesmo conjunto, e "quase" é o problema: `bloqueio` e `desfecho_criacao` têm origem
 * `servidor` e precisam aparecer (é o bloqueio que explica o silêncio do agente naquele
 * turno — `D-21` descarta o texto do modelo), enquanto `mensagem_usuario` tem origem
 * `usuario` e **não** é marco, porque a fala já está na conversa: entraria em dobro.
 *
 * ⚠️ **Puro de propósito.** Nenhum React: é o que permite à suíte afirmar sobre a ORDEM e
 * sobre quem é dono de cada item rodando em `environment: 'node'`.
 */

import type { EventoRegistrado } from '../api'
import type { TipoDeEvento } from '@/lib/investigador/tipos'

/** Uma fala do diálogo, ou um marco entre elas. */
export type ItemDaConversa =
  | {
      readonly tipo: 'fala'
      readonly id: string
      readonly quando: string
      readonly papel: 'pessoa' | 'agente'
      readonly texto: string
    }
  | {
      readonly tipo: 'ferramenta'
      readonly id: string
      readonly quando: string
      /** O nome cru (`search_confluence`) — identificador é a coisa investigada (`D-79`). */
      readonly nome: string | null
      readonly texto: string
    }
  | {
      readonly tipo: 'marco'
      readonly id: string
      readonly quando: string
      /** `pessoa` quando ela agiu; `app` quando o app decidiu ou relatou o desfecho. */
      readonly autoria: 'pessoa' | 'app'
      readonly evento: EventoRegistrado
    }

/**
 * O que a **pessoa** fez à mão, e que `FR-35` exige marcar como dela.
 *
 * ⚠️ `proposta_rederivada` fica de fora aqui e entra por condição: só é ação da pessoa
 * quando `forcado === true` (o botão "montar o chamado agora", `D-76`). A rederivação
 * normal acontece **em todo turno** e poria um cartão entre cada par de falas.
 */
const MARCOS_DA_PESSOA: readonly TipoDeEvento[] = [
  'proposta_editada',
  'formulario_alterado',
  'override',
  'declaracao_anexo',
  'anexo_recebido',
  'confirmacao',
]

/**
 * O que o **app** decidiu, e sem o que a conversa não se explica — `FR-35`, `SC-6`.
 *
 * `bloqueio` responde "por que o agente não respondeu o que eu esperava?" (com bloqueio de
 * pé o texto do modelo é descartado, `D-21`) · `desfecho_criacao` fecha a leitura ·
 * `ia_extracao_recusada` é o silêncio de 14/08/2026, a razão de o Investigador existir ·
 * `erro_de_rota` é o "algo deu errado" que a pessoa leu no lugar de uma resposta.
 */
const MARCOS_DO_APP: readonly TipoDeEvento[] = [
  'bloqueio',
  'ia_extracao_recusada',
  'desfecho_criacao',
  'erro_de_rota',
]

/** A fala, como vem da tabela de produção. */
export interface MensagemDaConversa {
  readonly id: string
  readonly papel: string
  readonly conteudo: string
  readonly tool_nome: string | null
  readonly criado_em: string
}

/** `true` quando `dados_json` traz `forcado: true` — sem lançar em JSON malformado. */
function foiForcado(evento: EventoRegistrado): boolean {
  if (evento.dados_json === null) return false
  try {
    const d = JSON.parse(evento.dados_json) as unknown
    return typeof d === 'object' && d !== null && (d as { forcado?: unknown }).forcado === true
  } catch {
    return false
  }
}

/** A autoria de um evento como marco, ou `null` quando ele não é marco. */
export function autoriaDoMarco(evento: EventoRegistrado): 'pessoa' | 'app' | null {
  const tipo = evento.tipo as TipoDeEvento
  if (MARCOS_DA_PESSOA.includes(tipo)) return 'pessoa'
  // O botão de `D-76` é gesto da pessoa; a rederivação do turno é rotina do app.
  if (tipo === 'proposta_rederivada') return foiForcado(evento) ? 'pessoa' : null
  if (MARCOS_DO_APP.includes(tipo)) return 'app'
  return null
}

/**
 * As duas fontes numa sequência só, na ordem em que aconteceram.
 *
 * ⚠️ **Empate de carimbo põe a FALA antes do marco.** Os dois acontecem no mesmo segundo
 * porque o marco é reação à fala (a pessoa manda a mensagem, o bloqueio nasce); invertido, a
 * tela mostraria a consequência antes da causa. `sort` do JS é estável, então a ordem de
 * inserção resolve o resto — e o `ordem` do evento continua desempatando dois marcos no
 * mesmo milissegundo, que é o caso comum (`D-73`).
 */
export function montarConversa(
  mensagens: readonly MensagemDaConversa[],
  eventos: readonly EventoRegistrado[],
): readonly ItemDaConversa[] {
  const falas: ItemDaConversa[] = mensagens.map((m) =>
    m.papel === 'user' || m.papel === 'assistant'
      ? {
          tipo: 'fala',
          id: m.id,
          quando: m.criado_em,
          papel: m.papel === 'user' ? 'pessoa' : 'agente',
          texto: m.conteudo,
        }
      : {
          // Resultado de tool e prompt de sistema: evidência de máquina, nunca bolha de
          // diálogo (`SC-4`). O `papel` cru fica fora da tela; o nome da ferramenta não.
          tipo: 'ferramenta',
          id: m.id,
          quando: m.criado_em,
          nome: m.tool_nome,
          texto: m.conteudo,
        },
  )

  const marcos: ItemDaConversa[] = []
  for (const e of eventos) {
    const autoria = autoriaDoMarco(e)
    if (autoria === null) continue
    marcos.push({ tipo: 'marco', id: e.id, quando: e.criado_em, autoria, evento: e })
  }

  return [...falas, ...marcos].sort((a, b) => {
    if (a.quando !== b.quando) return a.quando < b.quando ? -1 : 1
    const oa = a.tipo === 'marco' ? a.evento.ordem : -1
    const ob = b.tipo === 'marco' ? b.evento.ordem : -1
    return oa - ob
  })
}

/** Exportados para a suíte afirmar sobre a allowlist sem repeti-la (`SC-5`). */
export const MARCOS = {
  pessoa: MARCOS_DA_PESSOA,
  app: MARCOS_DO_APP,
} as const
