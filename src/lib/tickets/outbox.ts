/**
 * Outbox de submissões — RNF-17, RF-24.
 *
 * "Falha da API Atlassian não pode perder um chamado em submissão." Isso não se
 * resolve com try/catch: o Worker não tem processo longo, então uma retentativa em
 * memória morre com a requisição. A submissão confirmada é **persistida primeiro**
 * e só então a criação no JSM é tentada; falha deixa a linha `pendente`, e o cron
 * da plataforma reprocessa.
 *
 * O usuário vê o estado real ("recebemos e estamos abrindo"). "Não consegui abrir
 * seu chamado" é resposta proibida (RNF-18).
 *
 * A idempotência (RF-24) é do BANCO: `chave_idempotencia UNIQUE`. Duplo clique,
 * reenvio ou retry de rede colidem na constraint, e a colisão é tratada como
 * "já registrei", não como erro.
 */

import type { Banco } from '../db/tipos'
import { linhasComoObjetos, primeiraLinha } from '../db/tipos'
import type { Prioridade } from '../atlassian/tipos'
import type { ViaAbertura } from './vinculos'

export type EstadoSubmissao = 'pendente' | 'criado' | 'falha'

/** O que será enviado ao JSM. Persistido como JSON para sobreviver ao reprocessamento. */
export interface PayloadSubmissao {
  readonly titulo: string
  readonly descricao: string
  readonly tipoChamadoId: string
  readonly serviceDeskId: string
  readonly prioridade: Prioridade
  /** RF-27 (T-130) — campos adicionais do request type, só no formulário sem IA. */
  readonly camposDinamicos?: Readonly<Record<string, string>>
}

export interface Submissao {
  readonly id: string
  readonly chaveIdempotencia: string
  readonly solicitanteEmail: string
  readonly conversaId: string | null
  readonly via: ViaAbertura
  readonly verificadoRegras: boolean
  readonly payload: PayloadSubmissao
  readonly estado: EstadoSubmissao
  readonly tentativas: number
  readonly ultimoErro: string | null
  readonly issueKey: string | null
}

interface LinhaSubmissao {
  id: string
  chave_idempotencia: string
  solicitante_email: string
  conversa_id: string | null
  via: ViaAbertura
  verificado_regras: number
  payload_json: string
  estado: EstadoSubmissao
  tentativas: number
  ultimo_erro: string | null
  issue_key: string | null
}

function daLinha(l: LinhaSubmissao): Submissao {
  return {
    id: l.id,
    chaveIdempotencia: l.chave_idempotencia,
    solicitanteEmail: l.solicitante_email,
    conversaId: l.conversa_id,
    via: l.via,
    verificadoRegras: l.verificado_regras === 1,
    payload: JSON.parse(l.payload_json) as PayloadSubmissao,
    estado: l.estado,
    tentativas: l.tentativas,
    ultimoErro: l.ultimo_erro,
    issueKey: l.issue_key,
  }
}

const COLUNAS = `id, chave_idempotencia, solicitante_email, conversa_id, via,
                 verificado_regras, payload_json, estado, tentativas, ultimo_erro, issue_key`

export interface ResultadoRegistro {
  readonly submissao: Submissao
  /** `false` quando a chave já existia — duplo clique (RF-24), não erro. */
  readonly nova: boolean
}

export class Outbox {
  constructor(
    private readonly db: Banco,
    private readonly agora: () => string,
  ) {}

  /**
   * Registra a submissão. Idempotente: a mesma `chaveIdempotencia` devolve a
   * submissão já existente com `nova: false`.
   *
   * ⚠️ Detecta a duplicata pela **constraint**, não por um `SELECT` antes do
   * `INSERT`. Um check-then-insert tem janela de corrida: dois cliques
   * simultâneos passam os dois pelo `SELECT` e criam dois chamados. É exatamente
   * o cenário de RF-24, e é por isso que a garantia tem de vir do banco.
   */
  async registrar(dados: {
    id: string
    chaveIdempotencia: string
    solicitanteEmail: string
    conversaId: string | null
    via: ViaAbertura
    verificadoRegras: boolean
    payload: PayloadSubmissao
  }): Promise<ResultadoRegistro> {
    const t = this.agora()
    try {
      await this.db.exec(
        `INSERT INTO submissoes
           (id, chave_idempotencia, solicitante_email, conversa_id, via, verificado_regras,
            payload_json, estado, tentativas, criado_em, atualizado_em)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'pendente', 0, ?, ?)`,
        [
          dados.id,
          dados.chaveIdempotencia,
          dados.solicitanteEmail,
          dados.conversaId,
          dados.via,
          dados.verificadoRegras ? 1 : 0,
          JSON.stringify(dados.payload),
          t,
          t,
        ],
      )
    } catch (erro) {
      const existente = await this.obterPorChave(dados.chaveIdempotencia)
      if (existente) return { submissao: existente, nova: false }
      throw erro
    }
    const criada = await this.obterPorChave(dados.chaveIdempotencia)
    if (!criada) throw new Error('submissão não persistiu')
    return { submissao: criada, nova: true }
  }

  async obterPorChave(chave: string): Promise<Submissao | null> {
    const r = await this.db.query(
      `SELECT ${COLUNAS} FROM submissoes WHERE chave_idempotencia = ?`,
      [chave],
    )
    const linha = primeiraLinha<LinhaSubmissao>(r)
    return linha ? daLinha(linha) : null
  }

  /**
   * Submissão pelo `issueKey`.
   *
   * É o que permite mostrar título e prioridade **do nosso próprio registro**
   * quando a Atlassian não responde (`RNF-19`): a pessoa vê seus chamados com
   * conteúdo em vez de "título indisponível". O dado já estava aqui; faltava usá-lo.
   */
  async obterPorIssueKey(issueKey: string): Promise<Submissao | null> {
    const r = await this.db.query(
      `SELECT ${COLUNAS} FROM submissoes WHERE issue_key = ? LIMIT 1`,
      [issueKey],
    )
    const linha = primeiraLinha<LinhaSubmissao>(r)
    return linha ? daLinha(linha) : null
  }

  async marcarCriado(id: string, issueKey: string): Promise<void> {
    await this.db.exec(
      `UPDATE submissoes SET estado = 'criado', issue_key = ?, ultimo_erro = NULL, atualizado_em = ?
        WHERE id = ?`,
      [issueKey, this.agora(), id],
    )
  }

  /**
   * Registra a falha. Erro **transitório** mantém `pendente` (o cron tenta de
   * novo); erro definitivo vira `falha`. A distinção importa: marcar tudo como
   * `falha` transformaria uma indisponibilidade momentânea em chamado perdido, que
   * é justamente o que RNF-17 proíbe.
   */
  async registrarTentativaFalha(id: string, erro: string, transitorio: boolean): Promise<void> {
    await this.db.exec(
      `UPDATE submissoes
          SET tentativas = tentativas + 1,
              ultimo_erro = ?,
              estado = ?,
              atualizado_em = ?
        WHERE id = ?`,
      [erro, transitorio ? 'pendente' : 'falha', this.agora(), id],
    )
  }

  async listarPendentes(limite: number): Promise<readonly Submissao[]> {
    const r = await this.db.query(
      `SELECT ${COLUNAS} FROM submissoes WHERE estado = 'pendente' ORDER BY criado_em ASC LIMIT ?`,
      [limite],
    )
    return linhasComoObjetos<LinhaSubmissao>(r).map(daLinha)
  }

  /** Submissões criadas no JSM que ficaram sem vínculo local — o pior caso (RNF-21). */
  async listarCriadasSemVinculo(limite: number): Promise<readonly Submissao[]> {
    const r = await this.db.query(
      `SELECT ${COLUNAS}
         FROM submissoes s
        WHERE s.estado = 'criado'
          AND s.issue_key IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM vinculos v WHERE v.issue_key = s.issue_key)
        ORDER BY s.criado_em ASC LIMIT ?`,
      [limite],
    )
    return linhasComoObjetos<LinhaSubmissao>(r).map(daLinha)
  }
}
