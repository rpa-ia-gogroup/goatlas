/**
 * Dublê da fonte organizacional — roteirizável, com falha injetável.
 *
 * Mesmo desenho dos outros dois fakes do projeto: o teste encena o cenário, não o
 * mecanismo. Aqui os cenários que importam são os **três estados** de `ResultadoArea`,
 * porque cada um leva a uma linha diferente de auditoria e a mesma tela.
 *
 * _Requirements: RF-19, RNF-18_
 */

import type { ClienteTeamGuide, ResultadoArea } from './contrato'

export class ClienteTeamGuideFake implements ClienteTeamGuide {
  /** e-mail (minúsculo) → área. Fora do mapa = `nao_encontrada`. */
  readonly areas = new Map<string, string>()
  /** Quando definido, TODA consulta devolve `indisponivel` com este motivo. */
  falha: string | null = null
  /** Toda consulta feita, para o teste afirmar sobre contagem de chamadas (`RNF-36`). */
  readonly chamadas: string[] = []

  constructor(inicial: Readonly<Record<string, string>> = {}) {
    for (const [email, area] of Object.entries(inicial)) {
      this.areas.set(email.trim().toLowerCase(), area)
    }
  }

  async areaDe(email: string): Promise<ResultadoArea> {
    this.chamadas.push(email)
    if (this.falha) return { estado: 'indisponivel', motivo: this.falha }
    const area = this.areas.get(email.trim().toLowerCase())
    return area ? { estado: 'encontrada', area } : { estado: 'nao_encontrada' }
  }
}
