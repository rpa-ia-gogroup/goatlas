/**
 * Estado da conversa — a base da trava de RF-08.
 *
 * ⚠️ O estado mora no BANCO, não na memória do Worker. Worker é stateless: estado
 * em memória significaria que basta abrir outra requisição (ou cair em outra
 * instância) para a conversa "esquecer" que as verificações não rodaram. A trava
 * precisa ser durável para ser trava.
 */

import type { Banco } from '../db/tipos'
import { primeiraLinha } from '../db/tipos'
import type { Prioridade } from '../atlassian/tipos'

export type EstadoConversa =
  | 'coletando'
  | 'bloqueado'
  | 'aguardando_confirmacao'
  | 'criado'
  | 'encerrado'

/** O que será criado, exibido ao usuário antes de confirmar (RF-18). */
export interface PropostaChamado {
  readonly titulo: string
  readonly descricao: string
  readonly tipoChamadoId: string
  readonly prioridade: Prioridade
  readonly area: string | null
  readonly componente: string | null
}

export interface Conversa {
  readonly id: string
  readonly solicitanteEmail: string
  readonly estado: EstadoConversa
  /** RF-08: as duas travas. `true` só depois da tool ter RODADO nesta conversa. */
  readonly confluenceVerificado: boolean
  readonly historicoVerificado: boolean
  /**
   * RNF-18: a tool FALHOU (≠ não rodou). Falha não libera a regra — permite
   * seguir, mas o chamado nasce marcado como não verificado. Indisponibilidade
   * nunca vira bypass silencioso.
   */
  readonly confluenceFalhou: boolean
  readonly historicoFalhou: boolean
  /** RF-17: só o usuário produz este carimbo, por rota própria. */
  readonly confirmadoEm: string | null
  readonly proposta: PropostaChamado | null
  readonly custoUsd: number
}

interface LinhaConversa {
  id: string
  solicitante_email: string
  estado: EstadoConversa
  confluence_verificado: number
  historico_verificado: number
  confluence_falhou: number
  historico_falhou: number
  confirmado_em: string | null
  proposta_json: string | null
  custo_usd: number
}

function daLinha(l: LinhaConversa): Conversa {
  let proposta: PropostaChamado | null = null
  if (l.proposta_json) {
    try {
      proposta = JSON.parse(l.proposta_json) as PropostaChamado
    } catch {
      proposta = null
    }
  }
  return {
    id: l.id,
    solicitanteEmail: l.solicitante_email,
    estado: l.estado,
    confluenceVerificado: l.confluence_verificado === 1,
    historicoVerificado: l.historico_verificado === 1,
    confluenceFalhou: l.confluence_falhou === 1,
    historicoFalhou: l.historico_falhou === 1,
    confirmadoEm: l.confirmado_em,
    proposta,
    custoUsd: l.custo_usd,
  }
}

export class RepositorioConversas {
  constructor(
    private readonly db: Banco,
    private readonly agora: () => string,
  ) {}

  async criar(id: string, solicitanteEmail: string): Promise<Conversa> {
    const t = this.agora()
    await this.db.exec(
      `INSERT INTO conversas (id, solicitante_email, estado, criado_em, atualizado_em)
       VALUES (?, ?, 'coletando', ?, ?)`,
      [id, solicitanteEmail, t, t],
    )
    const c = await this.obter(id)
    if (!c) throw new Error('conversa não persistiu')
    return c
  }

  async obter(id: string): Promise<Conversa | null> {
    const r = await this.db.query(
      `SELECT id, solicitante_email, estado, confluence_verificado, historico_verificado,
              confluence_falhou, historico_falhou, confirmado_em, proposta_json, custo_usd
         FROM conversas WHERE id = ?`,
      [id],
    )
    const linha = primeiraLinha<LinhaConversa>(r)
    return linha ? daLinha(linha) : null
  }

  /**
   * Obtém a conversa **exigindo** que ela pertença ao e-mail da sessão.
   *
   * Existe para que nenhum caminho de código possa operar numa conversa de outra
   * pessoa a partir de um id vindo do cliente (RF-30, RNF-05). Quem precisa de
   * conversa numa rota autenticada usa este método, não `obter`.
   */
  async obterDoSolicitante(id: string, solicitanteEmail: string): Promise<Conversa | null> {
    const c = await this.obter(id)
    if (!c) return null
    return c.solicitanteEmail === solicitanteEmail ? c : null
  }

  async marcarConfluenceVerificado(id: string, falhou: boolean): Promise<void> {
    await this.db.exec(
      `UPDATE conversas
          SET confluence_verificado = ?, confluence_falhou = ?, atualizado_em = ?
        WHERE id = ?`,
      [falhou ? 0 : 1, falhou ? 1 : 0, this.agora(), id],
    )
  }

  async marcarHistoricoVerificado(id: string, falhou: boolean): Promise<void> {
    await this.db.exec(
      `UPDATE conversas
          SET historico_verificado = ?, historico_falhou = ?, atualizado_em = ?
        WHERE id = ?`,
      [falhou ? 0 : 1, falhou ? 1 : 0, this.agora(), id],
    )
  }

  async definirEstado(id: string, estado: EstadoConversa): Promise<void> {
    await this.db.exec(`UPDATE conversas SET estado = ?, atualizado_em = ? WHERE id = ?`, [
      estado,
      this.agora(),
      id,
    ])
  }

  async definirProposta(id: string, proposta: PropostaChamado): Promise<void> {
    await this.db.exec(
      `UPDATE conversas SET proposta_json = ?, atualizado_em = ? WHERE id = ?`,
      [JSON.stringify(proposta), this.agora(), id],
    )
  }

  /** RF-17 — o carimbo de confirmação. Só a rota do usuário chega aqui. */
  async registrarConfirmacao(id: string): Promise<void> {
    const t = this.agora()
    await this.db.exec(
      `UPDATE conversas SET confirmado_em = ?, estado = 'aguardando_confirmacao', atualizado_em = ?
        WHERE id = ?`,
      [t, t, id],
    )
  }

  async somarCusto(id: string, usd: number): Promise<void> {
    await this.db.exec(
      `UPDATE conversas SET custo_usd = custo_usd + ?, atualizado_em = ? WHERE id = ?`,
      [usd, this.agora(), id],
    )
  }

  async adicionarMensagem(
    idMensagem: string,
    conversaId: string,
    papel: string,
    conteudo: string,
    toolNome: string | null,
  ): Promise<void> {
    await this.db.exec(
      `INSERT INTO mensagens (id, conversa_id, papel, conteudo, tool_nome, criado_em)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [idMensagem, conversaId, papel, conteudo, toolNome, this.agora()],
    )
  }
}
