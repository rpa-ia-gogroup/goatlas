/**
 * Registro de uso da documentação — **T-116**, e o mapa de lacunas de **T-117**.
 * `RF-42`, `RF-58`, objetivo `O6`.
 *
 * ## O que este módulo existe para responder
 *
 * "Que documentação falta?" — e a resposta honesta tem **três** partes, não uma:
 *
 * 1. **Termo sem resultado.** Não existe página.
 * 2. **Resultado que ninguém abriu.** Existe página, aparece na busca, e não convence.
 *    Este caso é invisível para qualquer contagem de "buscas vazias", e é o mais
 *    acionável: a pessoa viu o título e mesmo assim foi abrir chamado.
 * 3. **Override de bloqueio** (`RF-13`). A frase de quem leu e disse o que ficou de
 *    fora — o sinal mais rico dos três, e o único já escrito em linguagem humana.
 *
 * ## Duas decisões de desenho
 *
 * **O clique é atribuído por id, com o e-mail no `WHERE`.** O `?de=` vem do cliente,
 * e isso está bem porque não é autorização: é telemetria sobre uma linha que só é
 * atualizada se pertencer a quem pediu. Um id chutado não faz nada — nunca marca o
 * clique de outra pessoa.
 *
 * **O mapa CONTA pessoas, não as nomeia.** Ele é sobre documentação. Nomear quem
 * procurou transformaria um backlog de escrita numa lista de quem "não achou sozinho",
 * e o histórico por pessoa já existe na auditoria — para investigação, que é outro
 * propósito (`RF-58`). Por isso o agregado devolve contagem de pessoas distintas.
 *
 * _Requirements: RF-42, RF-58, RN-09_
 */

import type { Banco } from '../db/tipos'
import { linhasComoObjetos } from '../db/tipos'

export interface TermoComLacuna {
  /** Como a pessoa escreveu — a versão mais recente do termo agrupado. */
  readonly termo: string
  readonly ocorrencias: number
  /** Pessoas **distintas**, nunca os e-mails delas. */
  readonly pessoas: number
  readonly ultimaEm: string
}

export interface OverrideRegistrado {
  readonly regra: string
  readonly motivo: string
  readonly criadoEm: string
}

export interface MapaDeLacunas {
  /** Ninguém documentou. */
  readonly semResultado: readonly TermoComLacuna[]
  /** Documentado, mas ninguém abriu — "sem resultado ÚTIL" de `RF-42`. */
  readonly semClique: readonly TermoComLacuna[]
  readonly overrides: readonly OverrideRegistrado[]
}

/**
 * Normaliza o termo para agrupar — sem acento, sem caixa, espaço colapsado.
 *
 * Fica gravado em coluna própria porque normalizar no `SELECT` (com `lower()` e
 * `replace()` encadeados) impediria o índice e faria o mapa piorar com o uso.
 */
export function normalizarTermo(termo: string): string {
  return termo
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

export class RegistroConhecimento {
  constructor(
    private readonly db: Banco,
    private readonly agora: () => string,
    private readonly novoId: () => string,
  ) {}

  /** Registra a busca e devolve o id — é ele que a tela manda de volta no clique. */
  async registrarBusca(dados: {
    solicitanteEmail: string
    termo: string
    resultados: number
  }): Promise<string> {
    const id = this.novoId()
    await this.db.exec(
      `INSERT INTO buscas
         (id, solicitante_email, termo, termo_normalizado, resultados, houve_clique, criado_em)
       VALUES (?, ?, ?, ?, ?, 0, ?)`,
      [
        id,
        dados.solicitanteEmail,
        dados.termo,
        normalizarTermo(dados.termo),
        dados.resultados,
        this.agora(),
      ],
    )
    return id
  }

  /**
   * Marca que a busca levou a uma leitura.
   *
   * ⚠️ O e-mail está no `WHERE`, não numa checagem antes: é o mesmo desenho de
   * `vinculos.ts`. Assim o pior caso de um `?de=` chutado é zero linhas afetadas.
   * Devolve se marcou, porque quem chama usa isso para decidir o `via` da leitura.
   */
  async marcarClique(buscaId: string, solicitanteEmail: string): Promise<boolean> {
    if (!buscaId) return false
    const r = await this.db.exec(
      `UPDATE buscas SET houve_clique = 1
        WHERE id = ? AND solicitante_email = ?`,
      [buscaId, solicitanteEmail],
    )
    return r.rowsWritten > 0
  }

  async registrarLeitura(dados: {
    solicitanteEmail: string
    paginaId: string
    titulo: string
    espaco: string
    via: 'busca' | 'direto'
  }): Promise<void> {
    await this.db.exec(
      `INSERT INTO paginas_lidas
         (id, solicitante_email, pagina_id, titulo, espaco, via, criado_em)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        this.novoId(),
        dados.solicitanteEmail,
        dados.paginaId,
        dados.titulo,
        dados.espaco,
        dados.via,
        this.agora(),
      ],
    )
  }

  /**
   * O mapa de lacunas — **agregado e entre usuários**.
   *
   * O nome carrega o `_apenasAdmin` de propósito, como
   * `obterSemIsolamento_apenasReconciliacao` em `vinculos.ts`: este é o único método
   * daqui que atravessa o isolamento por e-mail, então usá-lo numa rota de colaborador
   * precisa ser um bug **visível na revisão**, não um detalhe.
   */
  async agregarLacunas_apenasAdmin(limite = 50): Promise<MapaDeLacunas> {
    const porTermo = async (condicao: string): Promise<TermoComLacuna[]> => {
      const r = await this.db.query(
        `SELECT termo_normalizado,
                COUNT(*)                          AS ocorrencias,
                COUNT(DISTINCT solicitante_email) AS pessoas,
                MAX(criado_em)                    AS ultima_em
           FROM buscas
          WHERE ${condicao}
          GROUP BY termo_normalizado
          ORDER BY ocorrencias DESC, ultima_em DESC
          LIMIT ?`,
        [limite],
      )
      return linhasComoObjetos<{
        termo_normalizado: string
        ocorrencias: number
        pessoas: number
        ultima_em: string
      }>(r).map((l) => ({
        termo: l.termo_normalizado,
        ocorrencias: Number(l.ocorrencias),
        pessoas: Number(l.pessoas),
        ultimaEm: l.ultima_em,
      }))
    }

    const overridesBrutos = await this.db.query(
      `SELECT regra, override_motivo, override_em
         FROM bloqueios
        WHERE houve_override = 1 AND override_motivo IS NOT NULL
        ORDER BY override_em DESC
        LIMIT ?`,
      [limite],
    )

    return {
      semResultado: await porTermo('resultados = 0'),
      semClique: await porTermo('resultados > 0 AND houve_clique = 0'),
      overrides: linhasComoObjetos<{
        regra: string
        override_motivo: string
        override_em: string
      }>(overridesBrutos).map((l) => ({
        regra: l.regra,
        motivo: l.override_motivo,
        criadoEm: l.override_em,
      })),
    }
  }
}
