/**
 * Quais anexos do chamado a pessoa pode ver — `RF-31`, `RN-05`, `D-45`. Funções puras.
 *
 * ## O problema que este arquivo existe para resolver
 *
 * A pessoa mandava o print e nunca mais o via: `GET /api/chamados/{key}` devolvia
 * comentários, status e área, e **nenhum campo de anexo** (medido em 12/08/2026 no
 * `GN-6898`, que nasceu com um arquivo anexado). Trazer a lista parece uma chamada a
 * mais e é — mas *qual* lista é a pergunta inteira.
 *
 * 🚨 **A lista da Atlassian não serve como está.** A documentação do endpoint
 * `GET /rest/servicedeskapi/request/{key}/attachment` diz: *"Customers will only get a
 * list of public attachments"*. O filtro é pelo **papel de quem pergunta** — e sob proxy
 * total (`D-01`) quem pergunta nunca é o cliente: é a conta de serviço, que é agente. O
 * anexo que o time pôs num comentário **interno** voltaria com HTTP 200, iria para a tela
 * da pessoa e nada indicaria o erro. É a pegadinha do `internal` (`RN-05`,
 * `atlassian/comentarios.ts`) na versão arquivo, e com o mesmo desfecho: comunicação
 * interna sobre a pessoa, entregue à própria pessoa.
 *
 * ## As duas fontes, e por que são duas
 *
 * | Fonte | O que ela prova |
 * |---|---|
 * | `listarAnexosDoChamado` | que o anexo **existe** |
 * | anexos dos comentários **públicos** (`RF-32`, já filtrados em duas camadas) | que o anexo é **público** |
 *
 * Mostra-se a interseção. Existir sem prova de publicidade não vira item na lista — e
 * também **não vira silêncio**: vira `indisponivel`, que na tela é *"não conseguimos
 * confirmar os anexos"*. As três saídas são frases diferentes de propósito, como em
 * `degradado`/`comentariosIndisponiveis`: "não há anexos", "estes são os anexos" e "não
 * deu para saber" são afirmações distintas, e trocar a terceira pela primeira é o app
 * mentindo sobre o arquivo da pessoa.
 */

import type { AnexoDoChamado, ComentarioPublico } from '../atlassian/tipos'
import type { ViaDoAnexo } from './anexos-enviados'

/** O anexo como a tela o recebe: descrição + o link **do app** para baixá-lo. */
export interface AnexoExibivel extends AnexoDoChamado {
  /** Sempre uma rota deste app (`RNF-02`) — o navegador nunca fala com a Atlassian. */
  readonly url: string
  /**
   * De onde veio a certeza de que este arquivo pode ser mostrado.
   *
   * `voce` — o app o enviou a pedido desta pessoa; a prova é a nossa própria linha.
   * `time` — veio da Atlassian e passou pela interseção de `D-45`.
   * `goatlas` — o app o **gerou** (hoje só a transcrição de `RF-23`). Ninguém o enviou.
   *
   * ⚠️ O terceiro valor existe porque os dois primeiros mentiriam sobre a transcrição:
   * "você enviou" é falso (a pessoa não mandou arquivo nenhum) e "do time" é falso do
   * jeito pior (sugere que um agente do time anexou algo ao chamado dela). Afirmar
   * autoria errada na tela é exatamente o defeito que `D-43` corrigiu no comentário.
   */
  readonly origem: 'voce' | 'time' | 'goatlas'
}

export interface AnexosParaExibir {
  readonly itens: readonly AnexoExibivel[]
  /**
   * `true` = **pode haver anexo do time que não consegui confirmar** — nunca "não tem".
   * A tela precisa dos dois estados separados pelo mesmo motivo de
   * `comentariosIndisponiveis`.
   *
   * ⚠️ Isto vale só para o que veio da **Atlassian**. O que o app enviou nunca depende
   * de confirmação, então ele aparece mesmo com esta bandeira de pé — e é por isso que
   * a bandeira deixou de significar "a lista está vazia porque não sei".
   */
  readonly indisponivel: boolean
}

/**
 * Link de download **dentro do app** — `RNF-02`.
 *
 * ⚠️ É contrato entre duas camadas, como `urlDeLeituraNoApp`/`entradaDaUrl`: esta função
 * escreve a URL e o roteador a interpreta com uma expressão regular. Divergir aqui é
 * silencioso — o link continua bonito e leva a 404 —, por isso há teste que gera de um
 * lado e casa do outro.
 */
export function urlDoAnexoNoApp(issueKey: string, nomeArquivo: string): string {
  return `/api/chamados/${encodeURIComponent(issueKey)}/anexos/${encodeURIComponent(nomeArquivo)}`
}

/**
 * A prova de publicidade extraída dos comentários públicos.
 *
 * `disponivel: false` quando **algum** comentário voltou sem a expansão (`anexos === null`):
 * na ausência de informação, não afirmar. Zero comentário público é prova vazia, não prova
 * ausente — é um chamado sem conversa, e nesse estado a ausência de anexo público é
 * verdade.
 */
export interface ProvaDePublicidade {
  readonly disponivel: boolean
  readonly anexos: readonly AnexoDoChamado[]
}

export function provaDePublicidade(
  comentarios: readonly ComentarioPublico[],
): ProvaDePublicidade {
  const anexos: AnexoDoChamado[] = []
  let disponivel = true
  for (const c of comentarios) {
    if (c.anexos === null) {
      disponivel = false
      continue
    }
    anexos.push(...c.anexos)
  }
  return { disponivel, anexos }
}

/**
 * Mesmo arquivo?
 *
 * Nome **e** tamanho quando os dois lados sabem o tamanho; só o nome quando um deles não
 * sabe. Casar só por nome sempre deixaria um anexo interno chamado `print.png` herdar a
 * publicidade de um público de mesmo nome; exigir o tamanho quando ele é desconhecido
 * esconderia o anexo legítimo. O resíduo — dois arquivos de mesmo nome **e** mesmo
 * tamanho, um público e um interno — está declarado no `D-45`.
 */
function mesmoArquivo(a: AnexoDoChamado, b: AnexoDoChamado): boolean {
  if (a.nomeArquivo !== b.nomeArquivo) return false
  if (a.tamanhoBytes === null || b.tamanhoBytes === null) return true
  return a.tamanhoBytes === b.tamanhoBytes
}

/**
 * A interseção — o que a pessoa vê.
 *
 * ⚠️ **A ordem dos argumentos é a ordem do raciocínio:** primeiro o que existe, depois o
 * que se pode provar. Inverter (montar a lista a partir dos comentários) traria o anexo
 * sem a descrição canônica e, pior, faria a lista depender de um único lado — que é
 * exatamente o desenho de uma fonte só que este arquivo recusa.
 */
export function anexosParaExibir(
  issueKey: string,
  doChamado: readonly AnexoDoChamado[] | null,
  prova: ProvaDePublicidade,
  enviadosPeloApp: readonly (AnexoDoChamado & { readonly via?: ViaDoAnexo })[] = [],
): AnexosParaExibir {
  // ⚠️ **Os nossos vêm primeiro, e não passam por prova nenhuma.** Cada um saiu de um
  // upload autenticado desta pessoa para um chamado com vínculo dela; nenhum pode ser de
  // comentário interno, porque comentário interno é escrito por quem tem assento e este
  // caminho não existe para o solicitante. Perguntar à Atlassian se o arquivo que **nós**
  // enviamos é público é o que produzia o silêncio medido no `GN-6898`.
  const meus: AnexoExibivel[] = enviadosPeloApp.map(({ via, ...a }) => ({
    ...a,
    url: urlDoAnexoNoApp(issueKey, a.nomeArquivo),
    // `via` ausente = os caminhos antigos, que só gravavam envio da pessoa.
    origem: via === 'transcricao' ? ('goatlas' as const) : ('voce' as const),
  }))
  const jaListado = (a: AnexoDoChamado) => meus.some((m) => mesmoArquivo(m, a))

  // `null` = a testemunha não respondeu (a Atlassian caiu naquela chamada). Não se sabe
  // o que **o time** anexou — mas o que a pessoa mandou continua sabido, e escondê-lo
  // aqui seria deixar a queda da Atlassian apagar o print dela da tela.
  if (doChamado === null) return { itens: meus, indisponivel: true }
  if (doChamado.length === 0) return { itens: meus, indisponivel: false }
  if (!prova.disponivel) return { itens: meus, indisponivel: true }

  const publicos = doChamado
    .filter((a) => !jaListado(a))
    .filter((a) => prova.anexos.some((p) => mesmoArquivo(a, p)))
  return {
    itens: [
      ...meus,
      ...publicos.map((a) => ({
        ...a,
        url: urlDoAnexoNoApp(issueKey, a.nomeArquivo),
        origem: 'time' as const,
      })),
    ],
    // Existe anexo, a prova funcionou e nenhum casou: isso é um chamado cujos anexos são
    // todos internos — resposta legítima, e "nenhum anexo seu por aqui" é verdade.
    indisponivel: false,
  }
}

/**
 * ⚠️ **Não existe função separada para autorizar o download.** A rota de bytes usa a
 * **mesma** `anexosParaExibir` e procura o nome dentro do resultado — uma segunda regra,
 * escrita só para o download, divergiria em silêncio da que a tela mostra, e o lado que
 * erra é sempre o que entrega bytes.
 */
