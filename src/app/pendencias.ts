/**
 * O que ainda falta para o botão "Abrir chamado" funcionar — `D-46`.
 *
 * ## Por que isto é um módulo, e não duas condições nas telas
 *
 * As duas superfícies que abrem chamado travam o botão pelos **mesmos** motivos: campo
 * obrigatório do request type vazio (`D-38`) e declaração de anexo não respondida
 * (`RN-11`). O formulário tem ainda os campos fixos que ele mesmo desenha (título e
 * descrição), que a conversa não tem porque ali eles vêm da proposta.
 *
 * Enquanto a frase morava numa constante, ela afirmava *"É a única coisa que falta"* — e
 * essa frase é **verdadeira ou falsa dependendo do resto da tela**, que a constante não
 * podia ver. Medido no app publicado em 12/08/2026 com o tipo 70: título, descrição e os
 * campos obrigatórios todos vazios, e a tela dizendo que faltava só responder sobre o
 * anexo. Quem segurava o envio depois disso era o `required` do navegador — que funciona,
 * mas só depois de a frase já ter mentido.
 *
 * A saída não foi consertar a frase nos dois lugares: seria a mesma regra escrita duas
 * vezes, divergindo em silêncio no primeiro campo novo. É a mesma razão de
 * `config/diagnostico.ts` (`D-25`) e de `comentario-exibicao.ts` (`D-43`) — quem decide é
 * um módulo só, e as telas **relatam**.
 *
 * ## A frase é composta, nunca fixa
 *
 * `Falta preencher: Título e Descrição.` · `Falta responder se você tem algo para anexar.`
 * · `Falta responder se você tem algo para anexar e preencher: Título e Descrição.`
 *
 * ⚠️ **"Falta", nunca "Faltam".** O verbo rege o infinitivo (`preencher`), então a frase
 * não muda com a quantidade — e a concordância deixa de ser uma armadilha que ninguém
 * testa com três campos.
 *
 * ⚠️ **Campo de anexo fica fora da lista de obrigatórios**, como no servidor
 * (`obrigatoriosFaltando`): incluí-lo faria `RN-11` virar "anexe um arquivo", que é
 * exatamente a leitura que a declaração existe para não produzir.
 *
 * _Requirements: RF-17, RF-27, RF-61, RF-62, RN-11, RNF-28, RNF-30_
 */

/** O mínimo de um campo do request type para decidir se ele está pendente. */
export interface CampoPendente {
  readonly fieldId: string
  readonly rotulo: string
  readonly obrigatorio: boolean
  readonly tipo: string
}

/** Um campo que a própria tela desenha (título, descrição) — não vem do schema. */
export interface CampoFixo {
  readonly rotulo: string
  readonly valor: string
}

export interface Pendencias {
  /** Rótulos vazios, **na ordem em que a pessoa os vê**: fixos primeiro, schema depois. */
  readonly campos: readonly string[]
  /** `RN-11` — o tipo aceita anexo e ninguém respondeu ainda. */
  readonly declaracaoDeAnexo: boolean
  /**
   * `RF-79` (spec 010) — o assunto **exige** arquivo e nenhum foi enviado.
   *
   * ⚠️ **Não é a mesma coisa que `declaracaoDeAnexo`, e a diferença é o que a pessoa
   * pode fazer.** Lá, responder "não tenho" abre o chamado; aqui, não abre — o Jira
   * recusa. Misturar as duas produziria a frase errada num dos dois casos, e a errada
   * aqui é a que faz alguém responder "não tenho" e bater numa parede sem explicação.
   */
  readonly evidenciaObrigatoria: boolean
}

export function pendenciasParaAbrir(entrada: {
  readonly fixos?: readonly CampoFixo[]
  readonly campos: readonly CampoPendente[]
  readonly valores: Readonly<Record<string, string>>
  readonly faltaDeclararAnexo: boolean
  /**
   * `RF-79` — o schema marca o campo de anexo como **obrigatório** neste assunto.
   *
   * ⚠️ **É "o assunto exige", não "falta arquivo".** A distinção custou uma medição na
   * tela (17/08/2026): com a condição escrita como *falta*, anexar o arquivo desligava a
   * absorção e a pergunta de `RN-11` voltava — *"Falta responder se você tem algo para
   * anexar"* logo abaixo do arquivo já enviado. Onde o Jira exige, a pergunta não existe
   * em nenhum momento.
   */
  readonly anexoExigido?: boolean
  /** Quantos arquivos já existem para este chamado. */
  readonly anexosEnviados?: number
}): Pendencias {
  const fixosVazios = (entrada.fixos ?? [])
    .filter((f) => f.valor.trim() === '')
    .map((f) => f.rotulo)

  const doSchemaVazios = entrada.campos
    .filter(
      (c) =>
        c.obrigatorio &&
        c.tipo !== 'anexo' &&
        (entrada.valores[c.fieldId] ?? '').trim() === '',
    )
    .map((c) => c.rotulo)

  /**
   * ⚠️ **A exigência ABSORVE a pergunta** (`RF-79`, medido na tela em 17/08/2026).
   *
   * Sem isto a frase saía *"Falta anexar pelo menos um arquivo (este assunto exige) e
   * responder se você tem algo para anexar…"* — duas pendências para a mesma coisa, e a
   * segunda oferecendo uma saída ("não tenho") que ali **não abre chamado nenhum**. Onde o
   * Jira exige o arquivo, `RN-11` não tem o que perguntar.
   */
  const exigido = entrada.anexoExigido === true
  return {
    campos: [...fixosVazios, ...doSchemaVazios],
    declaracaoDeAnexo: entrada.faltaDeclararAnexo && !exigido,
    evidenciaObrigatoria: exigido && (entrada.anexosEnviados ?? 0) === 0,
  }
}

export function faltaAlgumaCoisa(p: Pendencias): boolean {
  return p.campos.length > 0 || p.declaracaoDeAnexo || p.evidenciaObrigatoria
}

/**
 * A frase, ou `''` quando não falta nada.
 *
 * ⚠️ Devolve string vazia em vez de `null` para que a tela nunca renderize um parágrafo
 * de dica em branco ao lado de um botão habilitado — o rastro que sobra quando a última
 * pendência é resolvida.
 */
export function mensagemDePendencias(p: Pendencias): string {
  const partes: string[] = []
  // Vem primeiro porque é a única pendência que a pessoa pode não conseguir resolver
  // sozinha — e porque saber disso cedo evita preencher o resto para bater na parede.
  if (p.evidenciaObrigatoria) partes.push('anexar pelo menos um arquivo (este assunto exige)')
  if (p.declaracaoDeAnexo) partes.push('responder se você tem algo para anexar')
  if (p.campos.length > 0) partes.push(`preencher: ${listar(p.campos)}`)
  if (partes.length === 0) return ''
  return `Falta ${partes.join(' e ')}.`
}

/** `A` · `A e B` · `A, B e C` — a enumeração que o português usa, sem vírgula de Oxford. */
function listar(itens: readonly string[]): string {
  if (itens.length <= 1) return itens[0] ?? ''
  return `${itens.slice(0, -1).join(', ')} e ${itens[itens.length - 1]}`
}
