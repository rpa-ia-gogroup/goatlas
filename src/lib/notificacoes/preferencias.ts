/**
 * Preferência de canal — RF-45, T-224.
 *
 * ## Q11 sem hardcode
 *
 * **Q11 (qual canal, e qual o default) está em aberto.** O padrão do projeto para
 * pergunta aberta é sempre o mesmo (`RNF-25`): o valor que falta vira campo de
 * `ConfigValores` com default fail-closed, e o código já fica pronto para o dia em que
 * a resposta chegar — um campo no console de admin, sem deploy (`RF-49`).
 *
 * Aqui o fail-closed é `canal_notificacao_padrao: null`, que significa **"ninguém
 * decidiu ainda"** — e nesse estado a notificação é **registrada e suprimida**, não
 * descartada. A diferença importa: com registro, o console mostra "houve 40 avisos a
 * dar e nenhum canal definido"; sem registro, a tela mostra silêncio e ninguém
 * descobre que Q11 estava travando a fase inteira.
 *
 * ⚠️ O default **não** é "manda e-mail para o e-mail corporativo". Parece inofensivo e
 * é uma decisão de produto disfarçada de conveniência: notificação não pedida em canal
 * não combinado é o começo do treinamento para ignorar as notificações do app.
 */

import type { Banco } from '../db/tipos'
import { primeiraLinha } from '../db/tipos'
import { ehNomeCanal, type NomeCanal } from './tipos'

export interface Preferencia {
  readonly canal: NomeCanal
  /** `null` = usar o e-mail corporativo da pessoa (o destino que o app já conhece). */
  readonly destino: string | null
  /** `false` = a pessoa nunca escolheu; isto é o default vindo da config. */
  readonly escolhidaPelaPessoa: boolean
}

export class RepositorioPreferencias {
  constructor(
    private readonly db: Banco,
    private readonly agora: () => string,
  ) {}

  /**
   * A preferência efetiva.
   *
   * Ordem: escolha da pessoa → default da config (Q11) → `nenhum`. O último degrau é
   * o fail-closed: sem resposta de Q11 e sem escolha, não se manda nada para lugar
   * nenhum.
   */
  async obterEfetiva(email: string, padraoDaConfig: NomeCanal | null): Promise<Preferencia> {
    const r = await this.db.query(
      `SELECT canal, destino FROM preferencias_notificacao WHERE email = ?`,
      [email],
    )
    const linha = primeiraLinha<{ canal: NomeCanal; destino: string | null }>(r)
    if (linha) {
      return { canal: linha.canal, destino: linha.destino, escolhidaPelaPessoa: true }
    }
    return {
      canal: padraoDaConfig ?? 'nenhum',
      destino: null,
      escolhidaPelaPessoa: false,
    }
  }

  async definir(email: string, canal: NomeCanal, destino: string | null): Promise<void> {
    await this.db.exec(
      `INSERT INTO preferencias_notificacao (email, canal, destino, atualizado_em)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (email) DO UPDATE SET
         canal = excluded.canal,
         destino = excluded.destino,
         atualizado_em = excluded.atualizado_em`,
      [email, canal, destino, this.agora()],
    )
  }
}

/**
 * Valida o que veio do cliente.
 *
 * O destino é **opcional e limitado a e-mail**: um destino livre viraria o app num
 * relay — "notifique o chamado da Ana no webhook `https://…` que eu escolhi" é
 * exfiltração de conteúdo de chamado com a nossa credencial. Destino de canal de chat
 * é configuração de admin (`ConfigValores`), nunca escolha do usuário final.
 */
export function validarPreferencia(
  corpo: Record<string, unknown> | null,
): { canal: NomeCanal; destino: string | null } | { erro: string } {
  const canal = corpo?.canal
  if (!ehNomeCanal(canal)) {
    return { erro: 'Escolha um canal: chat, e-mail ou nenhum.' }
  }
  const bruto = typeof corpo?.destino === 'string' ? corpo.destino.trim() : ''
  if (bruto.length === 0) return { canal, destino: null }
  if (canal !== 'email') {
    return { erro: 'Endereço alternativo só vale para o canal de e-mail.' }
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(bruto)) {
    return { erro: 'Informe um endereço de e-mail válido.' }
  }
  return { canal, destino: bruto.toLowerCase() }
}
