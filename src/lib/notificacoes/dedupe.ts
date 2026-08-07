/**
 * Dedupe de notificação — RF-47, T-204/T-205.
 *
 * ## O erro que este arquivo existe para não cometer
 *
 * Duas fontes detectam a mesma mudança **de propósito**: webhook (rápido, depende do
 * time de tech registrar) e polling (lento, sempre nosso). `RF-47` pede as duas
 * justamente para que a notificação não dependa de mecanismo único. O preço é que o
 * mesmo fato chega duas vezes, em instantes diferentes.
 *
 * A chave de dedupe é `(issueKey, tipoEvento, carimboMudanca)`, e **`carimboMudanca` é
 * o carimbo do Jira** — `updated` do chamado, `created` do comentário. Usar
 * `agora()` seria o bug silencioso da fase: o webhook chega às 10:00:01 e o polling
 * às 10:04:30, então cada um gravaria uma chave diferente para o mesmo fato e a
 * dedupe não deduparia nada. Ninguém notaria em teste — só a pessoa, recebendo tudo
 * duas vezes.
 *
 * ⚠️ E a garantia é a **constraint** `UNIQUE (issue_key, tipo_evento,
 * carimbo_mudanca)`, não um `SELECT` antes do `INSERT`: webhook e cron podem estar em
 * requisições simultâneas, e os dois passariam pelo `SELECT`. Mesmo desenho da
 * idempotência de chamado (`RF-24`).
 */

import type { Banco } from '../db/tipos'
import { linhasComoObjetos, primeiraLinha } from '../db/tipos'
import type { Mensagem, NomeCanal, TipoEvento } from './tipos'

export type EstadoNotificacao = 'pendente' | 'enviada' | 'falha' | 'suprimida'
export type FonteNotificacao = 'webhook' | 'polling' | 'app'

export interface Notificacao {
  readonly id: string
  readonly issueKey: string
  readonly destinatarioEmail: string
  readonly tipoEvento: TipoEvento
  readonly carimboMudanca: string
  readonly fonte: FonteNotificacao
  readonly canal: NomeCanal | null
  readonly destino: string | null
  readonly titulo: string
  readonly corpo: string
  readonly estado: EstadoNotificacao
  readonly tentativas: number
  readonly criadoEm: string
}

interface LinhaNotificacao {
  id: string
  issue_key: string
  destinatario_email: string
  tipo_evento: TipoEvento
  carimbo_mudanca: string
  fonte: FonteNotificacao
  canal: NomeCanal | null
  destino: string | null
  titulo: string
  corpo: string
  estado: EstadoNotificacao
  tentativas: number
  criado_em: string
}

const COLUNAS = `id, issue_key, destinatario_email, tipo_evento, carimbo_mudanca, fonte,
                 canal, destino, titulo, corpo, estado, tentativas, criado_em`

function daLinha(l: LinhaNotificacao): Notificacao {
  return {
    id: l.id,
    issueKey: l.issue_key,
    destinatarioEmail: l.destinatario_email,
    tipoEvento: l.tipo_evento,
    carimboMudanca: l.carimbo_mudanca,
    fonte: l.fonte,
    canal: l.canal,
    destino: l.destino,
    titulo: l.titulo,
    corpo: l.corpo,
    estado: l.estado,
    tentativas: l.tentativas,
    criadoEm: l.criado_em,
  }
}

/**
 * A chave, como texto legível.
 *
 * Existe como função (em vez de só a constraint) para dois usos: a auditoria registrar
 * **qual** fato foi deduplicado, e o teste de T-202 poder afirmar que webhook e polling
 * geram a MESMA chave — que é o ponto todo.
 */
export function chaveDedupe(
  issueKey: string,
  tipoEvento: TipoEvento,
  carimboMudanca: string,
): string {
  return `${issueKey}|${tipoEvento}|${normalizarCarimbo(carimboMudanca)}`
}

/**
 * Normaliza o carimbo antes de virar chave.
 *
 * O Jira devolve `2026-08-06T10:00:00.000-0300` no REST e
 * `2026-08-06T13:00:00.000Z` no webhook — **o mesmo instante**, em dois formatos.
 * Sem normalizar para ISO em UTC, a dedupe compararia strings diferentes e mandaria
 * a notificação duas vezes. Carimbo ilegível é devolvido como veio: perder a dedupe
 * é ruim, inventar um instante é pior.
 */
export function normalizarCarimbo(bruto: string): string {
  const ms = Date.parse(bruto)
  return Number.isFinite(ms) ? new Date(ms).toISOString() : bruto
}

export interface NovaNotificacao {
  readonly id: string
  readonly issueKey: string
  readonly destinatarioEmail: string
  readonly tipoEvento: TipoEvento
  readonly carimboMudanca: string
  readonly fonte: FonteNotificacao
  readonly canal: NomeCanal | null
  readonly destino: string | null
  readonly mensagem: Mensagem
  /** `suprimida` = o fato ocorreu, o aviso não vai (ação própria, canal sem resposta
   * de Q11). Registrar em vez de descartar é o que permite a métrica dizer "havia
   * aviso a dar e não havia canal" em vez de silêncio. */
  readonly estado: Extract<EstadoNotificacao, 'pendente' | 'suprimida'>
}

export class RepositorioNotificacoes {
  constructor(
    private readonly db: Banco,
    private readonly agora: () => string,
  ) {}

  /**
   * Grava, ou reconhece que o fato já era conhecido.
   *
   * `nova: false` **não** é erro — é o caso normal quando webhook e polling veem a
   * mesma coisa. Quem chama trata como "já cuidei disso".
   */
  async registrar(dados: NovaNotificacao): Promise<{ nova: boolean; existente: Notificacao | null }> {
    const carimbo = normalizarCarimbo(dados.carimboMudanca)
    const agora = this.agora()
    const corpo = dados.mensagem.link
      ? `${dados.mensagem.corpo}\n\n${dados.mensagem.link}`
      : dados.mensagem.corpo

    const r = await this.db.exec(
      `INSERT INTO notificacoes
         (id, issue_key, destinatario_email, tipo_evento, carimbo_mudanca, fonte, canal,
          destino, titulo, corpo, estado, tentativas, criado_em, atualizado_em)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
       ON CONFLICT (issue_key, tipo_evento, carimbo_mudanca) DO NOTHING`,
      [
        dados.id,
        dados.issueKey,
        dados.destinatarioEmail,
        dados.tipoEvento,
        carimbo,
        dados.fonte,
        dados.canal,
        dados.destino,
        dados.mensagem.titulo,
        corpo,
        dados.estado,
        agora,
        agora,
      ],
    )

    if (r.rowsWritten > 0) return { nova: true, existente: null }
    return { nova: false, existente: await this.obterPorChave(dados.issueKey, dados.tipoEvento, carimbo) }
  }

  async obterPorChave(
    issueKey: string,
    tipoEvento: TipoEvento,
    carimboMudanca: string,
  ): Promise<Notificacao | null> {
    const r = await this.db.query(
      `SELECT ${COLUNAS} FROM notificacoes
        WHERE issue_key = ? AND tipo_evento = ? AND carimbo_mudanca = ?`,
      [issueKey, tipoEvento, normalizarCarimbo(carimboMudanca)],
    )
    const linha = primeiraLinha<LinhaNotificacao>(r)
    return linha ? daLinha(linha) : null
  }

  /** Fila de envio (T-225). Ordem de criação: aviso antigo primeiro. */
  async listarPendentes(limite: number): Promise<readonly Notificacao[]> {
    const r = await this.db.query(
      `SELECT ${COLUNAS} FROM notificacoes WHERE estado = 'pendente'
        ORDER BY criado_em LIMIT ?`,
      [limite],
    )
    return linhasComoObjetos<LinhaNotificacao>(r).map(daLinha)
  }

  /** Notificações DE UMA PESSOA — o e-mail vai no `WHERE`, como em `vinculos.ts`. */
  async listarDoDestinatario(email: string, limite: number): Promise<readonly Notificacao[]> {
    const r = await this.db.query(
      `SELECT ${COLUNAS} FROM notificacoes WHERE destinatario_email = ?
        ORDER BY criado_em DESC LIMIT ?`,
      [email, limite],
    )
    return linhasComoObjetos<LinhaNotificacao>(r).map(daLinha)
  }

  async marcarEnviada(id: string): Promise<void> {
    await this.db.exec(
      `UPDATE notificacoes SET estado = 'enviada', atualizado_em = ? WHERE id = ?`,
      [this.agora(), id],
    )
  }

  /**
   * Falha de envio.
   *
   * ⚠️ Mesma classificação do outbox (`RNF-17`): transitório **continua pendente** e
   * volta no próximo cron; só definitivo vira `falha`. Marcar indisponibilidade como
   * definitiva é jogar o aviso no lixo porque o canal piscou.
   */
  async registrarTentativaFalha(
    id: string,
    erro: string,
    transitorio: boolean,
    maxTentativas: number,
  ): Promise<void> {
    await this.db.exec(
      `UPDATE notificacoes
          SET tentativas = tentativas + 1,
              ultimo_erro = ?,
              estado = CASE
                WHEN ? = 0 THEN 'falha'
                WHEN tentativas + 1 >= ? THEN 'falha'
                ELSE 'pendente' END,
              atualizado_em = ?
        WHERE id = ?`,
      [erro.slice(0, 500), transitorio ? 1 : 0, maxTentativas, this.agora(), id],
    )
  }

  /** Contagem por estado — insumo de RF-55 e da tela de admin. */
  async contarPorEstado(): Promise<Record<EstadoNotificacao, number>> {
    const r = await this.db.query(
      `SELECT estado, COUNT(*) AS total FROM notificacoes GROUP BY estado`,
      [],
    )
    const saida: Record<EstadoNotificacao, number> = {
      pendente: 0,
      enviada: 0,
      falha: 0,
      suprimida: 0,
    }
    for (const linha of linhasComoObjetos<{ estado: EstadoNotificacao; total: number }>(r)) {
      saida[linha.estado] = Number(linha.total)
    }
    return saida
  }
}

/**
 * Alertas de SLA já emitidos — RF-46, T-231.
 *
 * Mora aqui, ao lado da dedupe de notificação, porque é o **mesmo desenho**: a garantia
 * de não repetir é a chave primária composta, não um `SELECT` antes do `INSERT`. O cron
 * de SLA e o de polling podem estar rodando na mesma janela.
 *
 * `risco` e `estourado` são limiares separados de propósito: o chamado que passou perto
 * do prazo e depois estourou merece os dois avisos — o segundo não é repetição do
 * primeiro.
 */
export class RepositorioAlertasSla {
  constructor(
    private readonly db: Banco,
    private readonly agora: () => string,
  ) {}

  /** `true` = é a primeira vez que este limiar dispara neste chamado. */
  async registrarSePrimeiraVez(issueKey: string, limiar: 'risco' | 'estourado'): Promise<boolean> {
    const r = await this.db.exec(
      `INSERT INTO alertas_sla (issue_key, limiar, criado_em) VALUES (?, ?, ?)
       ON CONFLICT (issue_key, limiar) DO NOTHING`,
      [issueKey, limiar, this.agora()],
    )
    return r.rowsWritten > 0
  }
}

/**
 * Retrato da última avaliação de SLA por chamado — RF-55, T-232.
 *
 * Ver o comentário da tabela em `db/schema.ts`: existe para o painel de admin não ter de
 * ler comentários de todos os chamados a cada abertura de página.
 */
export class RepositorioAvaliacoesSla {
  constructor(
    private readonly db: Banco,
    private readonly agora: () => string,
  ) {}

  async registrar(dados: {
    issueKey: string
    estado: 'respondido' | 'ok' | 'risco' | 'estourado'
    prazoEm: string
    respondidaEm: string | null
    dentroDoPrazo: boolean | null
  }): Promise<void> {
    await this.db.exec(
      `INSERT INTO avaliacoes_sla
         (issue_key, estado, prazo_em, respondida_em, dentro_do_prazo, avaliado_em)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (issue_key) DO UPDATE SET
         estado = excluded.estado,
         prazo_em = excluded.prazo_em,
         respondida_em = excluded.respondida_em,
         dentro_do_prazo = excluded.dentro_do_prazo,
         avaliado_em = excluded.avaliado_em`,
      [
        dados.issueKey,
        dados.estado,
        dados.prazoEm,
        dados.respondidaEm,
        dados.dentroDoPrazo === null ? null : dados.dentroDoPrazo ? 1 : 0,
        this.agora(),
      ],
    )
  }

  /** Agregado para o painel. Taxa sem nenhum respondido é `null`, nunca `0`. */
  async resumir(): Promise<{
    totalAvaliados: number
    respondidos: number
    dentroDoPrazo: number
    aderenciaPct: number | null
    emRisco: number
    estourados: number
  }> {
    const r = await this.db.query(
      `SELECT estado, dentro_do_prazo, COUNT(*) AS total
         FROM avaliacoes_sla GROUP BY estado, dentro_do_prazo`,
      [],
    )
    let totalAvaliados = 0
    let respondidos = 0
    let dentroDoPrazo = 0
    let emRisco = 0
    let estourados = 0
    for (const l of linhasComoObjetos<{
      estado: string
      dentro_do_prazo: number | null
      total: number
    }>(r)) {
      const total = Number(l.total)
      totalAvaliados += total
      if (l.estado === 'respondido') {
        respondidos += total
        if (l.dentro_do_prazo === 1) dentroDoPrazo += total
      }
      if (l.estado === 'risco') emRisco += total
      if (l.estado === 'estourado') estourados += total
    }
    return {
      totalAvaliados,
      respondidos,
      dentroDoPrazo,
      aderenciaPct: respondidos === 0 ? null : (dentroDoPrazo / respondidos) * 100,
      emRisco,
      estourados,
    }
  }
}

/**
 * Marca-d'água do polling — RF-47, RNF-15, T-210.
 *
 * ⚠️ **Ela só avança no que deu certo.** Avançar a marca antes de processar (ou apesar
 * de uma falha) é perder a janela inteira: o chamado que a Atlassian não devolveu
 * naquele momento fica atrás da marca e **nunca** é olhado de novo. É o mesmo erro que
 * `RNF-17` proíbe no outbox, na versão silenciosa.
 */
export class MarcaAguaPolling {
  constructor(
    private readonly db: Banco,
    private readonly agora: () => string,
  ) {}

  async obter(chave = 'jira'): Promise<string | null> {
    const r = await this.db.query(`SELECT carimbo FROM marca_agua_polling WHERE chave = ?`, [
      chave,
    ])
    return primeiraLinha<{ carimbo: string }>(r)?.carimbo ?? null
  }

  async definir(carimbo: string, chave = 'jira'): Promise<void> {
    await this.db.exec(
      `INSERT INTO marca_agua_polling (chave, carimbo, atualizado_em) VALUES (?, ?, ?)
       ON CONFLICT (chave) DO UPDATE SET
         carimbo = excluded.carimbo, atualizado_em = excluded.atualizado_em`,
      [chave, carimbo, this.agora()],
    )
  }
}
