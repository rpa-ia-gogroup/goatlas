/**
 * Anexos subidos antes de o chamado existir — `RF-61`, `RF-63`, T-408 a T-411.
 *
 * ## Não existe leitura sem e-mail
 *
 * Mesmo desenho de `tickets/vinculos.ts`: **toda** consulta exige o e-mail do
 * solicitante, e o filtro está no `WHERE`, não num `.filter()` depois. Um método
 * `listarDaChave(chave)` sem e-mail seria a porta de `SC-11` — arquivo de outra pessoa
 * entrando no próprio chamado — e por isso ele **não existe**.
 *
 * A chave do formulário já embute o e-mail (`chave-idempotencia.ts`), o que torna o
 * `WHERE` redundante naquele caminho. O da conversa (`conversa:<id>`) **não** embute, e
 * é justamente por isso que o filtro é incondicional: uma trava que vale em um dos dois
 * caminhos é uma trava que alguém vai contornar pelo outro.
 *
 * ## O expurgo tem TTL próprio, e curto
 *
 * ⚠️ Não se apoia em `aplicarRetencao`: a política de retenção pessoal tem default
 * `null` (`D-20`, e apagar dado pessoal é irreversível), então ela **não apaga nada** —
 * apoiar-se nela deixaria esta tabela crescer para sempre. E o dado aqui não é
 * histórico de ninguém: passadas algumas horas o id já expirou do lado da Atlassian e a
 * linha não vale nada.
 *
 * _Requirements: RF-24, RF-30, RF-61, RF-63, RNF-25, RNF-33_
 */

import type { Banco } from '../db/tipos'
import { linhasComoObjetos, primeiraLinha } from '../db/tipos'

/**
 * Quantos arquivos por **chamado** — `plan.md` §11, T-409c.
 *
 * ⚠️ Antes o teto era `MAX_ANEXOS_POR_ENVIO` (3 por requisição), aplicado com um
 * `.slice()` que **truncava em silêncio**. Com upload um a um, "3 por requisição" deixa
 * de significar qualquer coisa — a pessoa sobe um de cada vez e nunca bate no limite. O
 * teto passa a ser contado nas linhas da mesma chave, e a recusa é uma **mensagem**:
 * `SC-08` exige dizer o limite, e um arquivo que desaparece sem nada na tela é a versão
 * silenciosa do problema que esta feature veio resolver.
 */
export const MAX_ANEXOS_POR_CHAMADO = 3

/**
 * Teto de envios por pessoa na janela — `R-02`, T-410.
 *
 * Upload que nunca vira chamado consome a credencial única e armazenamento na
 * Atlassian, e não passa por nenhuma outra trava: quem abre chamado é limitado por
 * `RNF-11`, quem só sobe arquivo não seria. Generoso de propósito — a pessoa legítima
 * que troca o print três vezes em dois chamados não pode bater nisto.
 */
export const MAX_ENVIOS_PENDENTES_POR_JANELA = 30
export const JANELA_ENVIOS_PENDENTES_MS = 60 * 60 * 1000

/** Horas até a linha deixar de valer. O id já expirou na Atlassian bem antes. */
export const TTL_ANEXO_PENDENTE_HORAS = 12

export interface AnexoPendente {
  readonly id: string
  readonly solicitanteEmail: string
  readonly conversaId: string | null
  readonly chaveIdempotencia: string
  readonly temporaryAttachmentId: string
  readonly nomeArquivo: string
  readonly criadoEm: string
  readonly materializadoEm: string | null
}

interface LinhaAnexoPendente {
  id: string
  solicitante_email: string
  conversa_id: string | null
  chave_idempotencia: string
  temporary_attachment_id: string
  nome_arquivo: string
  criado_em: string
  materializado_em: string | null
}

const COLUNAS = `id, solicitante_email, conversa_id, chave_idempotencia,
                 temporary_attachment_id, nome_arquivo, criado_em, materializado_em`

function daLinha(l: LinhaAnexoPendente): AnexoPendente {
  return {
    id: l.id,
    solicitanteEmail: l.solicitante_email,
    conversaId: l.conversa_id,
    chaveIdempotencia: l.chave_idempotencia,
    temporaryAttachmentId: l.temporary_attachment_id,
    nomeArquivo: l.nome_arquivo,
    criadoEm: l.criado_em,
    materializadoEm: l.materializado_em ?? null,
  }
}

export class RepositorioAnexosPendentes {
  constructor(
    private readonly db: Banco,
    private readonly agora: () => string,
  ) {}

  /**
   * Registra o envio. **Idempotente pela constraint** (T-411).
   *
   * ⚠️ Colisão de `UNIQUE (chave, nome)` é caso previsto, não erro: significa que este
   * arquivo já foi subido para este chamado — duplo clique no seletor. Devolve
   * `duplicado: true`, e quem chamou trata como sucesso. Um `SELECT` antes do `INSERT`
   * teria a janela de corrida que dois cliques simultâneos atravessam.
   */
  async registrar(dados: {
    id: string
    solicitanteEmail: string
    conversaId: string | null
    chaveIdempotencia: string
    temporaryAttachmentId: string
    nomeArquivo: string
  }): Promise<{ readonly duplicado: boolean }> {
    try {
      await this.db.exec(
        `INSERT INTO anexos_pendentes
           (id, solicitante_email, conversa_id, chave_idempotencia,
            temporary_attachment_id, nome_arquivo, criado_em)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          dados.id,
          dados.solicitanteEmail,
          dados.conversaId,
          dados.chaveIdempotencia,
          dados.temporaryAttachmentId,
          dados.nomeArquivo,
          this.agora(),
        ],
      )
      return { duplicado: false }
    } catch (erro) {
      const existente = await this.obterDaChavePorNome(
        dados.chaveIdempotencia,
        dados.solicitanteEmail,
        dados.nomeArquivo,
      )
      if (existente) return { duplicado: true }
      // Qualquer outra falha de escrita é bug de schema e precisa subir: engolir tudo
      // aqui transformaria "a tabela não existe" em "arquivo enviado com sucesso".
      throw erro
    }
  }

  private async obterDaChavePorNome(
    chaveIdempotencia: string,
    solicitanteEmail: string,
    nomeArquivo: string,
  ): Promise<AnexoPendente | null> {
    const r = await this.db.query(
      `SELECT ${COLUNAS} FROM anexos_pendentes
        WHERE chave_idempotencia = ? AND solicitante_email = ? AND nome_arquivo = ?`,
      [chaveIdempotencia, solicitanteEmail, nomeArquivo],
    )
    const linha = primeiraLinha<LinhaAnexoPendente>(r)
    return linha ? daLinha(linha) : null
  }

  /** Quantos arquivos já esperam por este chamado — o teto de T-409c. */
  async contarDaChave(chaveIdempotencia: string, solicitanteEmail: string): Promise<number> {
    const r = await this.db.query(
      `SELECT COUNT(*) AS n FROM anexos_pendentes
        WHERE chave_idempotencia = ? AND solicitante_email = ?`,
      [chaveIdempotencia, solicitanteEmail],
    )
    return Number(primeiraLinha<{ n: number }>(r)?.n ?? 0)
  }

  /** Envios da pessoa na janela — o teto contra envio órfão de T-410. */
  async contarDaPessoaDesde(solicitanteEmail: string, desde: string): Promise<number> {
    const r = await this.db.query(
      `SELECT COUNT(*) AS n FROM anexos_pendentes
        WHERE solicitante_email = ? AND criado_em >= ?`,
      [solicitanteEmail, desde],
    )
    return Number(primeiraLinha<{ n: number }>(r)?.n ?? 0)
  }

  /**
   * O que ainda espera materialização, para esta chave e esta pessoa.
   *
   * `materializado_em IS NULL` no `WHERE` junto do e-mail: a lista é consumida logo
   * depois da criação, e trazer o já materializado faria a reconfirmação de `RF-24`
   * tentar anexar de novo — a colisão seria pega em `reivindicar`, mas gastaria uma
   * chamada à Atlassian por arquivo para descobrir isso.
   */
  async listarNaoMaterializados(
    chaveIdempotencia: string,
    solicitanteEmail: string,
  ): Promise<readonly AnexoPendente[]> {
    const r = await this.db.query(
      `SELECT ${COLUNAS} FROM anexos_pendentes
        WHERE chave_idempotencia = ? AND solicitante_email = ? AND materializado_em IS NULL
        ORDER BY criado_em ASC`,
      [chaveIdempotencia, solicitanteEmail],
    )
    return linhasComoObjetos<LinhaAnexoPendente>(r).map(daLinha)
  }

  /**
   * Reivindica a linha para materializar — T-413b.
   *
   * ⚠️ **Reivindicar ANTES de chamar a Atlassian, e o custo disso é consciente.** O
   * `UPDATE ... WHERE materializado_em IS NULL` é atômico: dois cliques simultâneos
   * disputam, um escreve e o outro vê `false`. Chamar primeiro e marcar depois inverteria
   * o risco — os dois cliques passariam e o arquivo apareceria duas vezes no chamado.
   *
   * O custo: se a chamada seguinte falhar, a linha fica marcada e o arquivo **não** sobe
   * naquela tentativa. É aceitável porque é exatamente o estado que `RF-63` prevê e
   * descreve — a tela diz que o anexo não subiu e manda anexar por `RF-34`, com a chave
   * do chamado à mão. Anexo em dobro, ao contrário, não tem caminho de volta.
   */
  async reivindicar(id: string, solicitanteEmail: string): Promise<boolean> {
    const r = await this.db.exec(
      `UPDATE anexos_pendentes SET materializado_em = ?
        WHERE id = ? AND solicitante_email = ? AND materializado_em IS NULL`,
      [this.agora(), id, solicitanteEmail],
    )
    return r.rowsWritten > 0
  }

  /**
   * Expurgo das órfãs — T-415, `RNF-33`.
   *
   * Apaga **inclusive as materializadas**: cumprida a função, a linha só guarda nome de
   * arquivo e id vencido. Devolve quantas saíram, para a auditoria contar sem nomear.
   */
  async expurgarAnterioresA(limite: string): Promise<number> {
    const r = await this.db.exec(`DELETE FROM anexos_pendentes WHERE criado_em < ?`, [limite])
    return r.rowsWritten
  }

  /** Quantos chamados nasceram com evidência — T-422, `ScC-7`. */
  async contarChavesComAnexoMaterializado(): Promise<number> {
    const r = await this.db.query(
      `SELECT COUNT(DISTINCT chave_idempotencia) AS n FROM anexos_pendentes
        WHERE materializado_em IS NOT NULL`,
      [],
    )
    return Number(primeiraLinha<{ n: number }>(r)?.n ?? 0)
  }
}
