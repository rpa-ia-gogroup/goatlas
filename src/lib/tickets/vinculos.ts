/**
 * A tabela de vínculo — o artefato mais crítico do sistema (RF-22, RNF-17).
 *
 * É o que permite acompanhar chamado **sem conta Atlassian**, e é a base do
 * isolamento: visibilidade é por vínculo LOCAL, não por permissão do Jira
 * (RN-04). Sem vínculo, sem acesso.
 *
 * ⚠️ Regra de desenho deste módulo: **não existe leitura sem e-mail**. Toda função
 * de consulta exige o e-mail do solicitante como parâmetro obrigatório, e o filtro
 * está no `WHERE` do SQL — não num `.filter()` aplicado depois, nem numa checagem
 * que o chamador possa esquecer. Um método `obterPorIssueKey(issueKey)` sem e-mail
 * seria a porta para RF-30 vazar, então ele simplesmente não existe.
 */

import type { Banco } from '../db/tipos'
import { linhasComoObjetos, primeiraLinha } from '../db/tipos'

export type ViaAbertura = 'conversa' | 'formulario'

export interface Vinculo {
  readonly issueKey: string
  readonly solicitanteEmail: string
  readonly conversaId: string | null
  readonly via: ViaAbertura
  /**
   * `false` quando o chamado nasceu sem as regras terem verificado de fato:
   * tool indisponível (RNF-18) ou abertura pelo formulário mínimo (D-04). É o que
   * impede o caminho sem-IA de ser rota de fuga silenciosa da deflexão.
   */
  readonly verificadoRegras: boolean
  readonly criadoEm: string
}

interface LinhaVinculo {
  issue_key: string
  solicitante_email: string
  conversa_id: string | null
  via: ViaAbertura
  verificado_regras: number
  criado_em: string
}

function daLinha(l: LinhaVinculo): Vinculo {
  return {
    issueKey: l.issue_key,
    solicitanteEmail: l.solicitante_email,
    conversaId: l.conversa_id,
    via: l.via,
    verificadoRegras: l.verificado_regras === 1,
    criadoEm: l.criado_em,
  }
}

const COLUNAS = `issue_key, solicitante_email, conversa_id, via, verificado_regras, criado_em`

export class RepositorioVinculos {
  constructor(
    private readonly db: Banco,
    private readonly agora: () => string,
  ) {}

  async criar(dados: {
    issueKey: string
    solicitanteEmail: string
    conversaId: string | null
    via: ViaAbertura
    verificadoRegras: boolean
  }): Promise<void> {
    await this.db.exec(
      `INSERT INTO vinculos (issue_key, solicitante_email, conversa_id, via, verificado_regras, criado_em)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        dados.issueKey,
        dados.solicitanteEmail,
        dados.conversaId,
        dados.via,
        dados.verificadoRegras ? 1 : 0,
        this.agora(),
      ],
    )
  }

  /**
   * O gate de RF-30 / RN-04.
   *
   * Devolve o vínculo **somente** se ele pertencer a este e-mail. Não existe
   * versão sem e-mail: é assim que se garante que nenhum caminho de código possa
   * ler o chamado de outra pessoa a partir de um `issueKey` vindo do cliente.
   */
  async obterDoSolicitante(issueKey: string, solicitanteEmail: string): Promise<Vinculo | null> {
    const r = await this.db.query(
      `SELECT ${COLUNAS} FROM vinculos WHERE issue_key = ? AND solicitante_email = ?`,
      [issueKey, solicitanteEmail],
    )
    const linha = primeiraLinha<LinhaVinculo>(r)
    return linha ? daLinha(linha) : null
  }

  async listarDoSolicitante(solicitanteEmail: string, limite: number): Promise<readonly Vinculo[]> {
    const r = await this.db.query(
      `SELECT ${COLUNAS} FROM vinculos WHERE solicitante_email = ? ORDER BY criado_em DESC LIMIT ?`,
      [solicitanteEmail, limite],
    )
    return linhasComoObjetos<LinhaVinculo>(r).map(daLinha)
  }

  /**
   * Uso administrativo/reconciliação (RNF-21), não rota de usuário. Separado de
   * propósito, com nome que deixa claro que ignora o isolamento — quem chamar isto
   * numa rota de colaborador está escrevendo um bug de RF-30 visível na revisão.
   */
  async obterSemIsolamento_apenasReconciliacao(issueKey: string): Promise<Vinculo | null> {
    const r = await this.db.query(`SELECT ${COLUNAS} FROM vinculos WHERE issue_key = ?`, [
      issueKey,
    ])
    const linha = primeiraLinha<LinhaVinculo>(r)
    return linha ? daLinha(linha) : null
  }
}
