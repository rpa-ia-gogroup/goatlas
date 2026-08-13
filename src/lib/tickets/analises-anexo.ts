/**
 * O que a IA entendeu de cada anexo da conversa — spec 007 (`FR-1`, `FR-2`, `FR-5b`, `FR-10`).
 *
 * ## Seis estados, e por que não são três
 *
 * | estado | o que significa | o que a tela faz |
 * |---|---|---|
 * | `analisando` | a leitura está em curso (ou o upload morreu no meio) | diz que está lendo |
 * | `pronta` | leu e há conteúdo útil | mostra a descrição |
 * | `irrelevante` | leu e **não** há | **não diz nada** (`FR-5b`) |
 * | `tipo_nao_suportado` | `.zip`, planilha, `svg` | diz que não sabe ler este tipo |
 * | `sem_conteudo` | PDF em branco, imagem ilegível, bytes que não chegaram | diz que não leu |
 * | `falhou` | provedor ou worker fora | diz que não conseguiu ler agora |
 *
 * As três últimas são a mesma frase para quem só olha "deu certo?", e frases **opostas** para
 * a pessoa: "não sei ler isto" pede outro arquivo, "não consegui agora" pede tentar de novo.
 * Mesma família de `area_indisponivel` × `area_nao_encontrada`.
 *
 * ## Não existe leitura sem e-mail
 *
 * Como em `vinculos.ts`, `anexos-pendentes.ts` e `anexos-enviados.ts`: o filtro está no
 * `WHERE`, nunca num `.filter()` depois. Um `listarDaConversa(conversaId)` sem e-mail seria a
 * porta de `RF-30` — por isso ele **não existe**.
 *
 * ## `FR-2` vem da constraint
 *
 * `UNIQUE (conversa_id, nome_arquivo)` + tratar a colisão como "já registrei" é o desenho do
 * projeto inteiro. Um `SELECT` antes do `INSERT` tem janela: dois arquivos soltos juntos
 * passam os dois pela checagem e a segunda análise **paga uma chamada** para sobrescrever a
 * primeira.
 *
 * _Requirements: FR-1, FR-2, FR-5b, FR-7, FR-10, RF-30_
 */

import type { Banco } from '../db/tipos'
import { linhasComoObjetos } from '../db/tipos'

export type EstadoAnalise =
  | 'analisando'
  | 'pronta'
  | 'irrelevante'
  | 'tipo_nao_suportado'
  | 'sem_conteudo'
  | 'falhou'

export interface AnaliseDeAnexo {
  readonly id: string
  readonly nomeArquivo: string
  readonly estado: EstadoAnalise
  readonly descricao: string | null
  readonly criadoEm: string
  readonly concluidoEm: string | null
}

interface LinhaAnalise {
  id: string
  nome_arquivo: string
  estado: string
  descricao: string | null
  criado_em: string
  concluido_em: string | null
}

/** Terminou de rodar? (não é o mesmo que "deu certo") */
export function analiseConcluida(estado: EstadoAnalise): boolean {
  return estado !== 'analisando'
}

/**
 * Vai ao contexto do modelo e à tela? — `FR-4`, `FR-5`, `FR-5b`.
 *
 * ⚠️ Só `pronta`. `irrelevante` fica de fora das duas: mandar "o arquivo não tem nada útil"
 * ao modelo produz exatamente a frase que a pessoa não deve ler sobre a foto dela.
 */
export function analiseVaiParaConversa(a: AnaliseDeAnexo): boolean {
  return a.estado === 'pronta' && !!a.descricao
}

/**
 * As três ações de auditoria de `FR-10`, derivadas dos seis estados — achado `F3` do
 * `/analyze`.
 *
 * ⚠️ **O mapa vive aqui, num lugar só.** Sem ele, tela e auditoria contam histórias
 * diferentes sobre o mesmo arquivo, e a segunda é a que alguém lê meses depois tentando
 * entender por que um chamado chegou sem evidência.
 */
export function acaoDeAuditoriaDaAnalise(estado: EstadoAnalise): string {
  switch (estado) {
    case 'pronta':
    case 'irrelevante':
      return 'anexo_analisado'
    case 'tipo_nao_suportado':
    case 'falhou':
      return 'anexo_nao_lido'
    case 'sem_conteudo':
    case 'analisando':
      return 'anexo_leitura_indefinida'
  }
}

export class AnalisesDeAnexo {
  constructor(
    private readonly db: Banco,
    private readonly agora: () => string = () => new Date().toISOString(),
  ) {}

  /**
   * Abre a linha como `analisando`, **antes** da chamada de rede.
   *
   * 🚨 A ordem é a trava: uma linha que só aparecesse *depois* da análise faria a rota da
   * mensagem concluir "não há nada pendente" e responder sem o arquivo — o defeito exato que a
   * feature existe para consertar, na versão silenciosa.
   *
   * Devolve `false` quando a linha já existia (`FR-2`): quem recebe `false` **não analisa**.
   */
  async abrir(dados: {
    id: string
    conversaId: string
    solicitanteEmail: string
    nomeArquivo: string
  }): Promise<boolean> {
    const antes = await this.db.query(
      `SELECT COUNT(*) AS n FROM analises_anexo WHERE conversa_id = ? AND nome_arquivo = ?`,
      [dados.conversaId, dados.nomeArquivo],
    )
    const jaExistia = (linhasComoObjetos<{ n: number }>(antes)[0]?.n ?? 0) > 0
    if (jaExistia) return false

    try {
      await this.db.exec(
        `INSERT INTO analises_anexo
           (id, conversa_id, solicitante_email, nome_arquivo, estado, criado_em)
         VALUES (?, ?, ?, ?, 'analisando', ?)`,
        [
          dados.id,
          dados.conversaId,
          dados.solicitanteEmail.trim().toLowerCase(),
          dados.nomeArquivo,
          this.agora(),
        ],
      )
      return true
    } catch {
      // ⚠️ A colisão de `UNIQUE` é o caso PREVISTO, não erro: dois uploads simultâneos do
      // mesmo nome. Quem perdeu a corrida não analisa — e é isto que faz `FR-2` valer sem
      // janela, ao contrário do `SELECT` acima, que só evita a chamada no caso comum.
      return false
    }
  }

  /** Fecha a linha com o resultado. **Nunca lança** (`FR-8`). */
  async concluir(dados: {
    conversaId: string
    nomeArquivo: string
    estado: EstadoAnalise
    descricao?: string | null
    custoUsd?: number | null
  }): Promise<void> {
    try {
      await this.db.exec(
        `UPDATE analises_anexo
            SET estado = ?, descricao = ?, custo_usd = ?, concluido_em = ?
          WHERE conversa_id = ? AND nome_arquivo = ?`,
        [
          dados.estado,
          dados.descricao ?? null,
          dados.custoUsd ?? null,
          this.agora(),
          dados.conversaId,
          dados.nomeArquivo,
        ],
      )
    } catch {
      // Pior caso: a linha fica `analisando` e a espera do turno a trata como velha
      // (`FR-7`). Derrubar o upload por causa disto seria a inversão que `RNF-18` proíbe.
    }
  }

  /** Todas as análises da conversa, na ordem em que os arquivos entraram. */
  async listarDaConversa(
    conversaId: string,
    solicitanteEmail: string,
  ): Promise<readonly AnaliseDeAnexo[]> {
    const r = await this.db.query(
      `SELECT id, nome_arquivo, estado, descricao, criado_em, concluido_em
         FROM analises_anexo
        WHERE conversa_id = ? AND solicitante_email = ?
        ORDER BY criado_em ASC`,
      [conversaId, solicitanteEmail.trim().toLowerCase()],
    )
    return linhasComoObjetos<LinhaAnalise>(r).map((l) => ({
      id: l.id,
      nomeArquivo: l.nome_arquivo,
      estado: (l.estado as EstadoAnalise) ?? 'falhou',
      descricao: l.descricao,
      criadoEm: l.criado_em,
      concluidoEm: l.concluido_em,
    }))
  }

  /**
   * Quantas análises esta conversa já tem — o teto de `FR-5c`.
   *
   * ⚠️ Quem compara com o teto usa `MAX_ANEXOS_POR_CHAMADO`, importado (achado `F5`): um `3`
   * escrito aqui divergiria no dia em que o teto mudasse, e em silêncio.
   */
  async contarDaConversa(conversaId: string): Promise<number> {
    const r = await this.db.query(
      `SELECT COUNT(*) AS n FROM analises_anexo WHERE conversa_id = ?`,
      [conversaId],
    )
    return linhasComoObjetos<{ n: number }>(r)[0]?.n ?? 0
  }
}
