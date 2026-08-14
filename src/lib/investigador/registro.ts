/**
 * O que o resto do app enxerga do Investigador — spec 009, `FR-18`, `FR-20`.
 *
 * ⚠️ **Desligado é um OBJETO, nunca `null`.** Um `ctx.investigador?.registrar(…)` espalhado
 * por dez arquivos é dez lugares para alguém esquecer o `?.` e derrubar uma rota por causa
 * do registro — e o esquecimento só aparece em produção, no caminho que ninguém exercita.
 * Um no-op é um lugar só. É o mesmo raciocínio de `ClienteIAIndisponivel` (T-132) e de
 * `lerPdf` nunca ser `null` (`D-64`).
 *
 * ⚠️ **A interface não expõe `gravar`.** Quem grava é o envelope da rota, uma vez, no fim
 * (`http/rotas.ts`). Se `gravar` estivesse aqui, qualquer módulo poderia gravar no meio do
 * caminho — e a economia de idas ao banco de `FR-10c` viraria intenção em vez de estrutura.
 */

import type { EventoInvestigador, ObservadorDeChamadas } from './tipos'

export interface Investigador {
  /** Registra um evento na coleta desta requisição. Nunca lança. */
  registrar(evento: EventoInvestigador): void
  /** Amarra a requisição a uma conversa, para o detalhe do painel poder agrupá-la. */
  emConversa(id: string | null | undefined): void
  /** O observador que os transportes externos recebem — `FR-10b`. */
  observador(): ObservadorDeChamadas
}

/**
 * O registro desligado (`investigador_ligado: false`).
 *
 * Nenhuma linha é escrita e nenhum corpo é lido — o desligamento tem de ser real, não
 * cosmético: registrar e jogar fora pagaria o custo sem entregar o benefício, e alguém
 * concluiria que desligar não adianta.
 */
export class InvestigadorDesligado implements Investigador {
  registrar(): void {}
  emConversa(): void {}
  observador(): ObservadorDeChamadas {
    return () => {}
  }
}

/** Instância única — não há estado, e criar uma por requisição seria lixo à toa. */
export const INVESTIGADOR_DESLIGADO: Investigador = new InvestigadorDesligado()
