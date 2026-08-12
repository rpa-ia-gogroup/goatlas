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

  /**
   * ⚠️ O dublê **não** encena `fase`/`classe` (`D-40`), e isso é de propósito: elas nascem
   * de como o runtime quebra, e um roteiro que as inventasse afirmaria sobre um mecanismo
   * que só existe em `http.ts`. Quem encena classe de falha é a injeção de `fetchImpl` —
   * era um dublê complacente que escondeu o `D-38`.
   */
  async verificarSaude(): Promise<{ ok: boolean; detalhe: string }> {
    return this.falha ? { ok: false, detalhe: this.falha } : { ok: true, detalhe: 'ok' }
  }
}
