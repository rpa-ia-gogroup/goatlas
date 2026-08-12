/**
 * Ampliação da busca — `D-40`. `RF-37`, `RF-09`, `RF-42`.
 *
 * ## O defeito que este módulo fecha
 *
 * `text ~ "<termo>"` com a **frase inteira** casa quase nada. Medido na staging em
 * 12/08/2026: o tópico `processo de deploy na Gocase` devolveu zero, e a palavra
 * `deploy` devolvia 10 páginas na mesma instalação. O agente escreveu a conclusão
 * natural — *"não encontrei nenhuma página relevante"* — que é a frase oposta à
 * verdade e manda a pessoa abrir chamado por algo que está escrito (`D-33`).
 *
 * ## Por que aqui, e não no prompt
 *
 * O termo mal formado chega por **dois** caminhos: o tópico que o modelo extrai
 * (`search_confluence`) e a caixa de busca da aba Documentação, onde quem digita é
 * uma pessoa — e pessoa digita frase. Instruir o modelo a mandar palavras-chave não
 * ajudaria a segunda, e não é garantia nem na primeira: prompt instrui, não trava
 * (Princípio X), e o modo de falha é justamente o silencioso — o app continua
 * respondendo, só que a coisa errada. Aqui a correção vale para os dois chamadores,
 * com uma consulta a mais **no pior caso**, e é verificável sem modelo nenhum.
 *
 * ## O teto, e por que ele existe
 *
 * São **no máximo duas** consultas por busca (`MAX_CONSULTAS_BUSCA`): a frase, e —
 * só se ela não casar nada — as palavras significativas em `OR`. Um leque de N
 * tentativas por turno é como se descobre o burst limit não publicado da Atlassian
 * do jeito ruim (`R-02`, `RNF-15`), e cada resultado ainda custa uma consulta de
 * restrição por página (`RN-06`).
 *
 * A ordem é **precisão primeiro**: a frase inteira, quando casa, casa melhor. A
 * ampliação só existe para o zero.
 *
 * ⚠️ A ampliação **nunca** mexe no escopo. `espacosPermitidos`, `labelsBloqueadas` e
 * `limite` vão idênticos na segunda tentativa: "achar mais" jamais pode significar
 * "procurar em mais lugares" (`RN-06`, `RNF-07`).
 *
 * _Requirements: RF-09, RF-37, RF-42, RN-06, RNF-07, R-02_
 */

import type {
  BuscaConfluenceParams,
  ClienteAtlassian,
  PaginaConfluence,
} from '../atlassian/tipos'

/** Teto de consultas CQL por busca (`R-02`). */
export const MAX_CONSULTAS_BUSCA = 2

/**
 * Teto de palavras na consulta ampliada.
 *
 * Cada palavra é um `OR` a mais, e mais `OR` é mais resultado — e cada resultado
 * custa uma consulta de restrição (`RN-06`). Seis cobre qualquer frase que alguém
 * digite de verdade sem transformar a segunda tentativa numa varredura.
 */
export const MAX_PALAVRAS_AMPLIACAO = 6

/**
 * Palavras que não dizem sobre o quê é a busca.
 *
 * Deliberadamente **curta e só de palavras de função**: artigo, preposição,
 * pronome, interrogativo e os verbos de pedido que abrem toda pergunta. Palavra de
 * conteúdo fica — "acesso", "erro" e "ajuda" são assunto, e cortá-las trocaria um
 * zero por um resultado errado, que é pior.
 */
const PALAVRAS_VAZIAS: ReadonlySet<string> = new Set([
  'a', 'ao', 'aos', 'as', 'o', 'os', 'um', 'uma', 'uns', 'umas',
  'de', 'do', 'da', 'dos', 'das', 'em', 'no', 'na', 'nos', 'nas', 'num', 'numa',
  'por', 'pelo', 'pela', 'pelos', 'pelas', 'para', 'pra', 'com', 'sem', 'sob',
  'sobre', 'entre', 'ate', 'apos', 'desde',
  'e', 'ou', 'mas', 'que', 'se', 'como', 'quando', 'onde', 'qual', 'quais',
  'quem', 'porque', 'pq',
  'eu', 'me', 'meu', 'minha', 'meus', 'minhas', 'nosso', 'nossa', 'voce',
  'voces', 'ele', 'ela', 'eles', 'elas', 'isso', 'isto', 'aquilo', 'esse',
  'essa', 'este', 'esta', 'esses', 'essas', 'estes', 'estas',
  'ser', 'sao', 'esta', 'estao', 'ter', 'tem', 'foi', 'vai', 'vou', 'ver',
  'vejo', 'saber', 'sei', 'fazer', 'faco', 'faz', 'preciso', 'precisa',
  'quero', 'queria', 'gostaria', 'consigo', 'consegue', 'poderia', 'pode',
  'aqui', 'ali', 'la', 'agora', 'entao', 'tambem', 'ainda', 'ja',
  'nao', 'sim', 'muito', 'mais', 'menos', 'todo', 'toda', 'todos', 'todas',
])

/** Sem acento e em minúsculas — só para COMPARAR; o retorno preserva o original. */
function normalizar(palavra: string): string {
  return palavra
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
}

/**
 * As palavras do termo que valem uma consulta.
 *
 * ⚠️ Devolve a palavra **como foi escrita**, com acento e caixa. O CQL casa o texto
 * da página, e "producao" não é "produção"; normalizar aqui trocaria um resultado
 * por zero. A normalização serve só para comparar com `PALAVRAS_VAZIAS`.
 *
 * ⚠️ Lista **vazia** não é detalhe: significa que a frase não tinha o que procurar
 * ("como faço isso?"), e nesse caso o zero **não** é lacuna de documentação
 * (`RF-42`) — é o mesmo raciocínio de `buscaConfigurada` e do escopo vazio de
 * `D-30`. Quem chama decide com base nisto.
 */
export function palavrasSignificativas(termo: string): readonly string[] {
  const vistas = new Set<string>()
  const palavras: string[] = []
  for (const bruta of termo.split(/[^\p{L}\p{N}_-]+/u)) {
    const chave = normalizar(bruta)
    if (chave.length < 2 || PALAVRAS_VAZIAS.has(chave) || vistas.has(chave)) continue
    vistas.add(chave)
    palavras.push(bruta)
    if (palavras.length === MAX_PALAVRAS_AMPLIACAO) break
  }
  return palavras
}

export interface BuscaAmpliada {
  readonly paginas: readonly PaginaConfluence[]
  /** As palavras significativas do termo. Vazia = nada pesquisável nele. */
  readonly palavras: readonly string[]
  /** A segunda tentativa aconteceu? (a frase inteira não casou nada) */
  readonly ampliou: boolean
  /** Consultas feitas à camada — nunca acima de `MAX_CONSULTAS_BUSCA`. */
  readonly consultas: number
}

/**
 * Busca com uma segunda tentativa quando a frase inteira não casa nada.
 *
 * Fica **acima** da camada isolada, e não dentro dela, por duas razões que valem
 * sozinhas: a camada continua burra quanto a política (mesmo desenho de `D-39`,
 * onde quem traduz campo é a rota), e quem chama precisa saber **que** houve
 * ampliação para a auditoria mostrar o termo da pessoa ao lado do que foi de fato
 * consultado. Ampliação invisível faria o mapa de lacunas mentir de outro jeito.
 */
export async function buscarComAmpliacao(
  cliente: ClienteAtlassian,
  params: BuscaConfluenceParams,
): Promise<BuscaAmpliada> {
  const palavras = palavrasSignificativas(params.termo)
  const primeira = await cliente.buscarConfluence(params)

  // Uma palavra só: a consulta ampliada seria idêntica à que acabou de voltar vazia.
  // Nenhuma palavra: não há o que ampliar. Nos dois casos a segunda ida é desperdício.
  if (primeira.length > 0 || palavras.length < 2) {
    return { paginas: primeira, palavras, ampliou: false, consultas: 1 }
  }

  const segunda = await cliente.buscarConfluence({ ...params, palavrasAlternativas: palavras })
  return { paginas: segunda, palavras, ampliou: true, consultas: MAX_CONSULTAS_BUSCA }
}
