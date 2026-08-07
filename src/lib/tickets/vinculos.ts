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
  /**
   * Área do solicitante **no momento da criação** (RF-19, T-304).
   *
   * É o dado histórico correto: a pessoa pode mudar de área depois, e a métrica por
   * área do chamado antigo deve continuar contando para a área de quando ele foi
   * aberto. `null` = e-mail sem área no mapa — **nunca** uma área chutada (T-303).
   */
  readonly area: string | null
  /** Última mudança já sincronizada para notificação (T-210). */
  readonly notificadoAte: string | null
  /** Último status já avisado — ver o comentário da coluna em `db/schema.ts`. */
  readonly ultimoStatusNotificado: string | null
  readonly criadoEm: string
}

interface LinhaVinculo {
  issue_key: string
  solicitante_email: string
  conversa_id: string | null
  via: ViaAbertura
  verificado_regras: number
  area: string | null
  notificado_ate: string | null
  ultimo_status_notificado: string | null
  criado_em: string
}

function daLinha(l: LinhaVinculo): Vinculo {
  return {
    issueKey: l.issue_key,
    solicitanteEmail: l.solicitante_email,
    conversaId: l.conversa_id,
    via: l.via,
    verificadoRegras: l.verificado_regras === 1,
    area: l.area ?? null,
    notificadoAte: l.notificado_ate ?? null,
    ultimoStatusNotificado: l.ultimo_status_notificado ?? null,
    criadoEm: l.criado_em,
  }
}

const COLUNAS = `issue_key, solicitante_email, conversa_id, via, verificado_regras,
                 area, notificado_ate, ultimo_status_notificado, criado_em`

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
    /** RF-19, T-304 — congelada na criação. `null` quando o mapa não conhece o e-mail. */
    area?: string | null
  }): Promise<void> {
    await this.db.exec(
      `INSERT INTO vinculos
         (issue_key, solicitante_email, conversa_id, via, verificado_regras, area, criado_em)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        dados.issueKey,
        dados.solicitanteEmail,
        dados.conversaId,
        dados.via,
        dados.verificadoRegras ? 1 : 0,
        dados.area ?? null,
        this.agora(),
      ],
    )
  }

  /**
   * Correção manual da área pelo próprio solicitante (RF-19, T-305).
   *
   * Mesmo padrão de `RF-16` com a prioridade: o mapa de áreas envelhece, e pessoa que
   * muda de área é a regra, não a exceção. O e-mail está no `WHERE` — corrigir a área
   * do chamado de outra pessoa não é caso de uso.
   */
  async corrigirArea(issueKey: string, solicitanteEmail: string, area: string | null): Promise<boolean> {
    const r = await this.db.exec(
      `UPDATE vinculos SET area = ? WHERE issue_key = ? AND solicitante_email = ?`,
      [area, issueKey, solicitanteEmail],
    )
    return r.rowsWritten > 0
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

  /**
   * Caminho de SISTEMA para descobrir a quem avisar (webhook e cron de polling, RF-47).
   *
   * Ignora o isolamento por construção — não há usuário na requisição para isolar
   * contra. O nome carrega isso, como `obterSemIsolamento_apenasReconciliacao`: usar
   * isto numa rota de colaborador é um bug de `RF-30` visível na revisão.
   *
   * ⚠️ O `issueKey` do webhook é **entrada não confiável**: qualquer um pode postar
   * `{"issue":{"key":"TECH-1"}}`. O que impede o abuso é que a chave só serve para
   * **achar o vínculo local** — sem vínculo, não há a quem notificar e nada acontece —
   * e que a resposta do webhook é a mesma nos dois casos (`202`), para não virar
   * oráculo de "este chamado está no goatlas?".
   */
  async obterParaNotificacao_semIsolamento(issueKey: string): Promise<Vinculo | null> {
    return this.obterSemIsolamento_apenasReconciliacao(issueKey)
  }

  /** Marcadores de sincronização (T-210). Sistema, não usuário. */
  async marcarSincronizado(
    issueKey: string,
    dados: { notificadoAte?: string | null; ultimoStatusNotificado?: string | null },
  ): Promise<void> {
    const partes: string[] = []
    const params: unknown[] = []
    if (dados.notificadoAte !== undefined) {
      partes.push('notificado_ate = ?')
      params.push(dados.notificadoAte)
    }
    if (dados.ultimoStatusNotificado !== undefined) {
      partes.push('ultimo_status_notificado = ?')
      params.push(dados.ultimoStatusNotificado)
    }
    if (partes.length === 0) return
    params.push(issueKey)
    await this.db.exec(`UPDATE vinculos SET ${partes.join(', ')} WHERE issue_key = ?`, params)
  }

  /**
   * Chamados a sincronizar no polling — os que mudaram desde a marca-d'água.
   *
   * Recebe a lista de chaves que a Atlassian disse ter mudado e devolve **só** as que
   * têm vínculo local. É o mesmo raciocínio do webhook: chamado do time de tech que
   * nunca passou pelo goatlas não gera notificação para ninguém.
   */
  async filtrarComVinculo(issueKeys: readonly string[]): Promise<readonly Vinculo[]> {
    if (issueKeys.length === 0) return []
    const marcadores = issueKeys.map(() => '?').join(', ')
    const r = await this.db.query(
      `SELECT ${COLUNAS} FROM vinculos WHERE issue_key IN (${marcadores})`,
      issueKeys,
    )
    return linhasComoObjetos<LinhaVinculo>(r).map(daLinha)
  }

  /**
   * Candidatos ao alerta de SLA (RF-46, T-231).
   *
   * ⚠️ Filtra pelos chamados **recentes**, e o corte é generoso de propósito: o prazo
   * máximo é 24h (`normal`), então tudo que passou de poucos dias já teve o alerta de
   * `estourado` emitido — e a tabela `alertas_sla` impede a repetição de qualquer forma.
   * Varrer todos os vínculos a cada rodada custaria duas chamadas à Atlassian por
   * chamado histórico, para sempre (`R-02`).
   *
   * Não filtra por status: "resolvido" no JSM não quer dizer "alguém respondeu", e é a
   * primeira resposta que este SLA cobra (`RN-08`). Quem decide é `avaliarSla`.
   */
  async listarParaAvaliacaoSla(limite: number): Promise<readonly Vinculo[]> {
    const r = await this.db.query(
      `SELECT ${COLUNAS} FROM vinculos ORDER BY criado_em DESC LIMIT ?`,
      [limite],
    )
    return linhasComoObjetos<LinhaVinculo>(r).map(daLinha)
  }

  /** Distribuição por área (RF-55, T-312). Área ausente conta como "sem área". */
  async contarPorArea(): Promise<readonly { area: string | null; total: number }[]> {
    const r = await this.db.query(
      `SELECT area, COUNT(*) AS total FROM vinculos GROUP BY area ORDER BY total DESC`,
      [],
    )
    return linhasComoObjetos<{ area: string | null; total: number }>(r).map((l) => ({
      area: l.area ?? null,
      total: Number(l.total),
    }))
  }
}
