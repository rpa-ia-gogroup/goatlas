/**
 * O que **este app** anexou ao chamado, a pedido de uma pessoa identificada — `RF-31`.
 *
 * ## Por que esta tabela existe, se `D-45` já resolvia a lista
 *
 * `D-45` resolveu o caso difícil e deixou o comum sem resposta. A lista de
 * `GET …/request/{key}/attachment` é filtrada pelo **papel de quem pergunta**, e sob
 * proxy total (`D-01`) quem pergunta é sempre a conta de serviço, que é **agente** — ou
 * seja, ela inclui anexo de comentário **interno**. Por isso a exibição cruza aquela
 * lista com os anexos dos comentários públicos e mostra a interseção.
 *
 * 🚨 **Medido na staging em 12/08/2026:** `GET /api/chamados/GN-6898` devolveu
 * `anexos: [], anexosIndisponiveis: true` — e aquele chamado **tem** um arquivo, enviado
 * pelo próprio app minutos antes. O cuidado correto para o anexo do time virou silêncio
 * sobre o anexo da própria pessoa.
 *
 * ## A distinção que faltava: existem dois tipos de anexo no chamado
 *
 * | Origem | O que se sabe |
 * |---|---|
 * | **enviado pelo app** | quem pediu, quando, em qual chamado — nós fizemos a chamada |
 * | **enviado pelo time no Jira** | nada além do que a Atlassian conta, e ela conta demais |
 *
 * Para o primeiro não há o que perguntar: o arquivo saiu de um upload autenticado desta
 * pessoa (`RF-01`), para um chamado cujo vínculo já é dela (`RF-30`), e **nenhum** deles
 * pode ser de comentário interno — comentário interno é escrito por quem tem assento, e
 * este caminho não existe para o solicitante. A prova de publicidade que `D-45` procura
 * na Atlassian, aqui, é a nossa própria linha.
 *
 * ## Por que não dá para reusar `anexos_pendentes`
 *
 * Aquela tabela guarda o **id temporário** e é expurgada em 12 h (T-415, e o comentário
 * dela explica: passadas algumas horas o id já não vale nada do lado da Atlassian). Uma
 * lista montada dela mostraria os anexos da pessoa **sumindo sozinhos** meio dia depois
 * — mediria o expurgo, como o indicador de evidência mediria se lesse de lá (T-422).
 * Aqui o dado é outro: não é um id que expira, é o registro de que o arquivo entrou.
 *
 * ## Retenção
 *
 * ⚠️ Segue a regra de `vinculos` (`D-17`), **não** a de `conversas`: expurgar isto
 * apagaria a evidência do chamado da pessoa enquanto o chamado continua aberto — o
 * mesmo raciocínio que impede o expurgo do vínculo, e pelo mesmo motivo (é o acesso
 * dela ao próprio caso, não histórico de conversa).
 *
 * ## Não existe leitura sem e-mail
 *
 * Como em `vinculos.ts` e `anexos-pendentes.ts`: toda consulta exige o e-mail e o filtro
 * está no `WHERE`, nunca num `.filter()` posterior. Um `listarDoChamado(issueKey)` sem
 * e-mail seria a porta de `RF-30` — por isso ele **não existe**.
 *
 * _Requirements: RF-30, RF-31, RF-34, RF-61, RF-63, RN-05, RNF-33_
 */

import type { Banco } from '../db/tipos'
import { linhasComoObjetos } from '../db/tipos'

/**
 * Por onde o arquivo entrou. Serve à leitura da tela, não a nenhuma regra.
 *
 * ⚠️ **`transcricao` não é "a pessoa enviou".** Ninguém a enviou: o app a gerou a partir
 * da conversa (`RF-23`, `transcricao.ts`). Ela mora nesta tabela porque a tabela é o
 * registro permanente do que **nós** pusemos no chamado — e é este valor que impede a
 * tela de afirmar uma autoria falsa, como `D-43` já ensinou uma vez.
 */
export type ViaDoAnexo = 'criacao' | 'chamado' | 'transcricao'

export interface AnexoEnviado {
  readonly issueKey: string
  readonly nomeArquivo: string
  readonly tamanhoBytes: number | null
  readonly tipo: string | null
  readonly via: ViaDoAnexo
  readonly criadoEm: string
}

interface LinhaAnexoEnviado {
  issue_key: string
  nome_arquivo: string
  tamanho_bytes: number | null
  tipo: string | null
  via: string
  criado_em: string
}

export class AnexosEnviados {
  // `agora` devolve ISO, como em `anexos-pendentes.ts` e no resto do projeto — assinatura
  // diferente para a mesma coisa é o tipo de divergência que só aparece no `tsc`.
  constructor(
    private readonly db: Banco,
    private readonly agora: () => string = () => new Date().toISOString(),
  ) {}

  /**
   * Registra o arquivo que acabou de entrar no chamado.
   *
   * ⚠️ **Idempotência vem da constraint, não de um `SELECT` antes do `INSERT`** — é o
   * padrão do projeto, e aqui o caso de corrida é real: a materialização de `RF-63` e o
   * envio de `RF-34` podem gravar o mesmo arquivo se a pessoa reenviar. `ON CONFLICT DO
   * NOTHING` trata a colisão como "já registrei", que é a verdade.
   *
   * 🚨 **Nunca lança.** Este registro é para a pessoa ver o próprio arquivo; um erro
   * aqui não pode derrubar o envio que **já aconteceu** do lado da Atlassian — seria a
   * mesma inversão que `anexo-na-criacao.ts` evita ao viver fora do `try/catch` que
   * classifica falha de submissão. O pior caso é a tela não listar um arquivo que está
   * lá, que é exatamente o estado de hoje.
   */
  async registrar(dados: {
    issueKey: string
    solicitanteEmail: string
    nomeArquivo: string
    tamanhoBytes?: number | null
    tipo?: string | null
    via: ViaDoAnexo
  }): Promise<void> {
    try {
      await this.db.exec(
        `INSERT INTO anexos_enviados
           (issue_key, solicitante_email, nome_arquivo, tamanho_bytes, tipo, via, criado_em)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (issue_key, solicitante_email, nome_arquivo) DO NOTHING`,
        [
          dados.issueKey,
          dados.solicitanteEmail.trim().toLowerCase(),
          dados.nomeArquivo,
          dados.tamanhoBytes ?? null,
          dados.tipo ?? null,
          dados.via,
          this.agora(),
        ],
      )
    } catch {
      // Silêncio deliberado — ver o bloco acima. O arquivo está na Atlassian de qualquer
      // forma, e `D-45` continua sendo a segunda fonte capaz de encontrá-lo.
    }
  }

  /** O que **esta pessoa** mandou para **este** chamado. O e-mail está no `WHERE`. */
  async listarDoSolicitante(
    issueKey: string,
    solicitanteEmail: string,
  ): Promise<readonly AnexoEnviado[]> {
    const linhas = linhasComoObjetos<LinhaAnexoEnviado>(
      await this.db.query(
        `SELECT issue_key, nome_arquivo, tamanho_bytes, tipo, via, criado_em
           FROM anexos_enviados
          WHERE issue_key = ? AND solicitante_email = ?
          ORDER BY criado_em ASC`,
        [issueKey, solicitanteEmail.trim().toLowerCase()],
      ),
    )
    return linhas.map((l) => ({
      issueKey: l.issue_key,
      nomeArquivo: l.nome_arquivo,
      tamanhoBytes: l.tamanho_bytes === null ? null : Number(l.tamanho_bytes),
      tipo: l.tipo,
      via: l.via === 'criacao' || l.via === 'transcricao' ? l.via : 'chamado',
      criadoEm: l.criado_em,
    }))
  }
}
