/**
 * Sanitização do storage format do Confluence — **RNF-06**. A trava da Fase 2.
 *
 * Na Fase 1 este HTML era lido por um modelo. Agora ele é **renderizado no
 * navegador de um colega**, e qualquer pessoa da empresa pode editar a página que
 * o origina. Isso faz de cada página um vetor de **XSS armazenado**.
 *
 * Quatro decisões, na ordem em que importam:
 *
 * 1. **Allowlist, nunca blocklist.** Blocklist perde a corrida contra vetor novo;
 *    allowlist erra para o lado de não renderizar. Vale para tag, para atributo e
 *    para esquema de URL.
 * 2. **A saída é uma árvore de nós TIPADA, não uma string de HTML.** É isto que
 *    torna `dangerouslySetInnerHTML` desnecessário por construção. Uma string
 *    "sanitizada" depende de o sanitizador estar certo; uma árvore fechada depende
 *    de o renderizador não inventar — e o renderizador só sabe emitir os nós que
 *    conhece. Note que **nenhum nó carrega saco de atributos**: não existe
 *    `atributos: Record<string,string>` para um `onerror` viajar dentro.
 * 3. **URL só passa se começar com `http://` ou `https://`.** A pergunta não é "é
 *    `javascript:`?" — é "é http(s)?". Assim `vbscript:`, `data:`, `blob:`,
 *    `file:`, protocolo-relativo (`//`) e o esquema que ninguém previu caem todos
 *    pela mesma porta.
 * 4. **Entidade é decodificada UMA vez, ao criar o nó de texto, e o resultado
 *    nunca é reparseado.** É a diferença entre `&lt;script&gt;` continuar texto e
 *    virar tag na segunda volta.
 *
 * ⚠️ São **duas passagens** de propósito. A primeira (`tokenizar` + árvore bruta)
 * lida com marcação malformada e com limites; a segunda (`converter`) aplica a
 * allowlist. Misturar as duas foi tentador e é onde o furo mora: a checagem de
 * allowlist fica espalhada por cima do tratamento de erro de parse, e um caminho
 * de recuperação passa a ser um caminho sem checagem. A árvore bruta é **interna** —
 * não é exportada, não sai deste arquivo.
 *
 * _Requirements: RNF-06, RF-39, RF-43_
 */

/* ---------------------------------------------------------------------- */
/* A árvore que sai daqui                                                 */
/* ---------------------------------------------------------------------- */

export type NivelTitulo = 1 | 2 | 3 | 4 | 5 | 6
export type VarianteEnfase = 'forte' | 'italico' | 'sublinhado' | 'riscado' | 'codigo'
export type VariantePainel = 'info' | 'nota' | 'aviso' | 'dica'

export type DestinoLink =
  | { readonly tipo: 'externo'; readonly url: string }
  | {
      readonly tipo: 'paginaConfluence'
      readonly titulo: string
      readonly espaco: string | null
    }
  /**
   * `T-142` — anexo da **própria** página, servido pelo proxy do app (`RNF-02`).
   *
   * `RF-39` pede fidelidade em "títulos, listas, tabelas, código, imagens **e anexos
   * servidos pelo proxy**", e o sexto valia só para imagem: `converterAcLink` tratava
   * `ri:page` e `ri:url`, então um link para PDF ou planilha anexada caía no `return
   * corpo` e virava **texto puro** — sem link e sem nada na tela dizendo que havia um
   * arquivo ali. É a degradação silenciosa que `RF-43` proíbe para macro, na mesma tela.
   */
  | { readonly tipo: 'anexoDaPagina'; readonly nomeArquivo: string }

export type OrigemImagem =
  /** Anexo da página — servido pelo proxy do app, nunca pelo navegador (RNF-02). */
  | { readonly tipo: 'anexo'; readonly nomeArquivo: string }
  /**
   * Imagem em URL externa. O sanitizador **não produz** este caso hoje (ver
   * `IMAGEM_EXTERNA_PERMITIDA`); ele existe porque o renderizador precisa saber
   * recusá-lo — a segunda camada não pode depender de o produtor ser confiável.
   */
  | { readonly tipo: 'externa'; readonly url: string }

export interface CelulaTabela {
  readonly filhos: readonly No[]
  readonly colunas: number
  readonly linhas: number
  /** `<th>` — pode ser a primeira COLUNA, não só a primeira linha. */
  readonly cabecalho: boolean
}

export interface LinhaTabela {
  /** Linha inteira de cabeçalho: dentro de `<thead>` ou com todas as células `<th>`. */
  readonly cabecalho: boolean
  readonly celulas: readonly CelulaTabela[]
}

/**
 * Um item da lista de tarefas do Confluence (`ac:task`) — o checklist inline.
 *
 * `concluida` sai de `ac:task-status`, que no storage vale `complete`/`incomplete`. Ele é
 * traduzido **aqui**, e não levado adiante como string: a palavra do storage é inglesa, e
 * qualquer coisa que a carregue até a tela reabre o bug que este tipo existe para fechar.
 */
export interface ItemDeTarefa {
  readonly concluida: boolean
  readonly filhos: readonly No[]
}

export type No =
  | { readonly tipo: 'texto'; readonly texto: string }
  | { readonly tipo: 'paragrafo'; readonly filhos: readonly No[] }
  | { readonly tipo: 'titulo'; readonly nivel: NivelTitulo; readonly filhos: readonly No[] }
  | { readonly tipo: 'enfase'; readonly variante: VarianteEnfase; readonly filhos: readonly No[] }
  | { readonly tipo: 'lista'; readonly ordenada: boolean; readonly itens: readonly (readonly No[])[] }
  /**
   * 🚨 **Checklist do Confluence (`ac:task-list`) — e ele NÃO é uma `lista` comum.**
   *
   * Medido no app real em 13/08/2026: as três tags do checklist eram desconhecidas, e tag
   * desconhecida é **desembrulhada**. Então cada tarefa chegava à tela como três textos
   * soltos e colados — `1incompleteO que fazer agora?` na página "Documentação do projeto
   * mestre" — com o **id interno** na frente (`RNF-30`) e a palavra `incomplete` no meio,
   * em inglês (regra 4), sem caixinha nenhuma. Eram **130 nós soltos em 15 páginas**: o
   * maior emissor de texto sem sentido da aba Documentação.
   *
   * ⚠️ **Reaproveitar `lista` não serviria:** o estado de cada item é a metade da
   * informação — um checklist onde não se distingue feito de por fazer é uma lista de
   * frases. O tipo próprio é o que obriga o renderizador a desenhar o estado.
   */
  | { readonly tipo: 'tarefas'; readonly itens: readonly ItemDeTarefa[] }
  | { readonly tipo: 'citacao'; readonly filhos: readonly No[] }
  | { readonly tipo: 'tabela'; readonly linhas: readonly LinhaTabela[] }
  | { readonly tipo: 'link'; readonly destino: DestinoLink; readonly filhos: readonly No[] }
  | { readonly tipo: 'imagem'; readonly origem: OrigemImagem; readonly alt: string }
  | { readonly tipo: 'codigo'; readonly linguagem: string | null; readonly conteudo: string }
  | { readonly tipo: 'painel'; readonly variante: VariantePainel; readonly filhos: readonly No[] }
  | { readonly tipo: 'quebra' }
  | { readonly tipo: 'separador' }
  /**
   * Etiqueta inline da macro `status` — o "lozenge" do Confluence.
   *
   * ⚠️ **Não carrega a cor**, e isso é decisão, não simplificação. A identidade GoGroup
   * não tem vermelho nem verde (§1.3), e o piso de a11y do projeto proíbe estado
   * comunicado só por cor: pintar `Green`/`Red` seria inventar paleta **e** apostar que
   * quem lê distingue as duas. O que a pessoa escreveu no `title` é o estado — é ele que
   * vai para a tela, e é ele que um leitor de tela lê.
   */
  | { readonly tipo: 'etiqueta'; readonly texto: string }
  /** RF-43 — degradação VISÍVEL. Macro que some em silêncio é o pior dos dois erros. */
  | { readonly tipo: 'macroNaoSuportada'; readonly nome: string }

export type MotivoDescarte =
  | 'tag_proibida'
  | 'tag_desconhecida'
  | 'tag_nao_terminada'
  | 'atributo_descartado'
  | 'url_recusada'
  | 'imagem_externa_recusada'
  | 'macro_nao_suportada'
  | 'profundidade'
  /**
   * `T-142` — `ri:attachment` apontando para outra página. Não é conteúdo hostil nem
   * limitação nossa de renderização: é referência que o proxy **não tem como** resolver
   * sem servir o arquivo errado. Auditado à parte porque o volume dele é o que diria se
   * vale um dia resolver anexo entre páginas.
   */
  | 'anexo_de_outra_pagina'

export interface Descarte {
  readonly motivo: MotivoDescarte
  /** Nome da tag, do atributo ou da macro. **Nunca o valor** — valor pode ser dado interno. */
  readonly detalhe: string
}

export interface ResultadoSanitizacao {
  readonly nos: readonly No[]
  /**
   * O que foi descartado, para diagnóstico e auditoria. Limitado a
   * `MAX_DESCARTES`: conteúdo hostil não precisa de script para derrubar o Worker,
   * basta uma página com 200 mil atributos e um diagnóstico sem teto.
   */
  readonly descartes: readonly Descarte[]
  /** `true` quando a entrada ou a árvore bateu no limite e foi cortada. */
  readonly truncado: boolean
}

/* ---------------------------------------------------------------------- */
/* Limites                                                                */
/* ---------------------------------------------------------------------- */

/** Página editável por qualquer pessoa é entrada não confiável — inclusive no tamanho. */
const MAX_ENTRADA = 400_000
const MAX_PROFUNDIDADE = 64
const MAX_NOS = 20_000
const MAX_DESCARTES = 64
const MAX_SPAN_CELULA = 64

/**
 * Imagem em URL externa fica de fora. Não é só XSS: uma imagem externa numa
 * página editável por qualquer pessoa é um rastreador de quem leu — o IP e o
 * horário de cada leitor interno vazam para um domínio de terceiro sem que nada
 * na tela indique isso. Imagem do Confluence vem por anexo, pelo proxy do app.
 */
const IMAGEM_EXTERNA_PERMITIDA: boolean = false

/* ---------------------------------------------------------------------- */
/* Entidades                                                              */
/* ---------------------------------------------------------------------- */

/**
 * Símbolos cuja caixa **muda o significado** — busca EXATA, como as letras.
 *
 * ## Por que esta tabela nasceu junto com `ordm`/`minus`
 *
 * `ENTIDADES_SIMBOLO` é consultada com `toLowerCase()`, e isso é certo para `&COPY;`/`&copy;`.
 * Mas há pares em que a maiúscula é **outro caractere**: `&larr;` é `←` e `&lArr;` é `⇐`;
 * `&dagger;` é `†` e `&Dagger;` é `‡`. As três setas já estavam na tabela tolerante, então
 * `&lArr;` já saía como `←` — errado em silêncio, do mesmo jeito que `&Eacute;` → `é` era.
 *
 * Acrescentar `dagger` e as setas verticais sem esta tabela **espalharia** esse defeito em vez
 * de contê-lo. Ela é consultada antes da tolerante, e é o único lugar onde a caixa importa
 * para símbolo.
 */
const ENTIDADES_SIMBOLO_EXATO: Readonly<Record<string, string>> = {
  larr: '←',
  rarr: '→',
  harr: '↔',
  uarr: '↑',
  darr: '↓',
  lArr: '⇐',
  rArr: '⇒',
  hArr: '⇔',
  uArr: '⇑',
  dArr: '⇓',
  dagger: '†',
  Dagger: '‡',
  prime: '′',
  Prime: '″',
}

/**
 * Símbolos — o lookup **ignora a caixa**, e aqui isso é correto: `&COPY;` e `&copy;` são o
 * mesmo `©`, e o HTML tolera as duas formas.
 *
 * ⚠️ **Entrada nova só entra AQUI se a maiúscula significar o MESMO caractere.** Quando não
 * significa, o lugar dela é `ENTIDADES_SIMBOLO_EXATO`, logo acima — senão a tabela tolerante
 * devolve o símbolo errado sem nada quebrar.
 *
 * Medido no app real em 13/08/2026: `15&ordm; dia` e `&minus;` apareciam **literais** na aba
 * Documentação, em três páginas. `ordm`/`ordf` são os que mais custam em português (`1º`,
 * `1ª`), e faltavam desde sempre — mesma família do `&eacute;` de `version 22`.
 */
const ENTIDADES_SIMBOLO: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  bull: '•',
  middot: '·',
  laquo: '«',
  raquo: '»',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  sbquo: '‚',
  bdquo: '„',
  lsaquo: '‹',
  rsaquo: '›',
  copy: '©',
  reg: '®',
  trade: '™',
  deg: '°',
  ordm: 'º',
  ordf: 'ª',
  plusmn: '±',
  minus: '−',
  times: '×',
  divide: '÷',
  frac12: '½',
  frac14: '¼',
  frac34: '¾',
  sup1: '¹',
  sup2: '²',
  sup3: '³',
  micro: 'µ',
  ne: '≠',
  le: '≤',
  ge: '≥',
  asymp: '≈',
  infin: '∞',
  permil: '‰',
  euro: '€',
  pound: '£',
  yen: '¥',
  cent: '¢',
  curren: '¤',
  sect: '§',
  para: '¶',
  check: '✓',
}

/**
 * Letras acentuadas, em MINÚSCULA. A maiúscula é derivada abaixo.
 *
 * ## Por que esta tabela não existia, e o que isso causou
 *
 * Medido no app real em 07/08/2026 (`version 22`): uma página do Confluence aparecia na aba
 * Documentação com `Pr&eacute;-requisitos` e `&Eacute; preciso` **literais** — violando a
 * regra 4 do projeto na única superfície feita para as pessoas lerem.
 *
 * Só a entidade **nomeada** falhava. A numérica (`&#233;`) sempre funcionou, porque
 * `doPontoDeCodigo` resolve qualquer código: o sintoma dependia de como o autor da página
 * digitou, que é o tipo de bug que atravessa revisão inteira sem ninguém reproduzir.
 *
 * ## 🚨 Por que é SEPARADA dos símbolos, e não mais entradas na mesma tabela
 *
 * Porque o lookup de letra é **case-sensitive** e o de símbolo não. `&Eacute;` é **É** e
 * `&eacute;` é **é**. Uma tabela só, consultada com `toLowerCase()` como era antes,
 * transformaria `&Eacute; preciso` em `é preciso` — acento certo, **caixa errada, em
 * silêncio**. Isso é pior que o bug original: parece consertado.
 *
 * Cobertura: português inteiro, mais as vizinhas que aparecem em documentação técnica
 * (espanhol, francês, alemão, italiano). Não pretende ser a lista HTML5 completa — são
 * 2.231 entidades, e o que falta continua saindo cru, que é o comportamento honesto.
 */
const LETRAS_MINUSCULAS: Readonly<Record<string, string>> = {
  aacute: 'á', agrave: 'à', acirc: 'â', atilde: 'ã', auml: 'ä', aring: 'å', aelig: 'æ',
  ccedil: 'ç',
  eacute: 'é', egrave: 'è', ecirc: 'ê', euml: 'ë',
  iacute: 'í', igrave: 'ì', icirc: 'î', iuml: 'ï',
  ntilde: 'ñ',
  oacute: 'ó', ograve: 'ò', ocirc: 'ô', otilde: 'õ', ouml: 'ö', oslash: 'ø',
  uacute: 'ú', ugrave: 'ù', ucirc: 'û', uuml: 'ü',
  yacute: 'ý', yuml: 'ÿ',
}

/**
 * `ß` fica fora da derivação: **não existe `&Szlig;`**. Derivar produziria uma entidade que
 * o navegador não reconhece, e nós decodificaríamos algo que ele deixa cru.
 */
const LETRAS_SEM_MAIUSCULA: Readonly<Record<string, string>> = { szlig: 'ß' }

/**
 * As duas caixas de cada letra, **derivadas** em vez de digitadas.
 *
 * ⚠️ A derivação é correta porque a forma maiúscula da entidade HTML capitaliza **só a
 * primeira letra do nome** (`&Eacute;`, `&Ccedil;`, `&Atilde;`) — nunca o nome inteiro.
 * `&EACUTE;` não é entidade, e continua saindo cru, como no navegador.
 *
 * Derivar elimina a classe de erro mais provável aqui: um par trocado (`Eacute: 'é'`) que
 * ninguém enxerga lendo 56 linhas de tabela.
 */
const ENTIDADES_LETRA: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries([
    ...Object.entries(LETRAS_SEM_MAIUSCULA),
    ...Object.entries(LETRAS_MINUSCULAS).flatMap(([nome, letra]) => [
      [nome, letra],
      [nome.charAt(0).toUpperCase() + nome.slice(1), letra.toUpperCase()],
    ]),
  ]),
)

/**
 * Resolve o nome da entidade — **exato primeiro, caixa livre por último**.
 *
 * A ordem É a correção: letra (`&Eacute;` ≠ `&eacute;`), depois símbolo de caixa
 * significativa (`&lArr;` ≠ `&larr;`), e só então a tabela tolerante, onde `toLowerCase()`
 * é o comportamento certo. Mover o `toLowerCase()` para cima reabre o bug de caixa nas duas
 * famílias, e ele volta **sem quebrar nada visível**.
 */
function letraOuSimbolo(nome: string): string | undefined {
  return (
    ENTIDADES_LETRA[nome] ?? ENTIDADES_SIMBOLO_EXATO[nome] ?? ENTIDADES_SIMBOLO[nome.toLowerCase()]
  )
}

/**
 * Decodifica entidades em **uma passagem só**.
 *
 * A passagem única é o ponto: `&amp;lt;` vira `&lt;` e **para aí**, porque o `&lt;`
 * produzido não é reexaminado. Um laço "decodifica até não mudar" transformaria
 * dupla codificação em tag — é o bug clássico de sanitizador.
 *
 * Numeral aceita ponto-e-vírgula opcional (o navegador também aceita, e é por aí
 * que `&#106;avascript` chega); nomeada exige o `;`, senão "AT&T" viraria outra
 * coisa.
 *
 * ⚠️ A resolução do nome é **case-sensitive para letra** e tolerante para símbolo — ver
 * `letraOuSimbolo`. Foi um bug real: `&Eacute;` virava `é`.
 */
export function decodificarEntidades(entrada: string): string {
  if (!entrada.includes('&')) return entrada
  return entrada.replace(
    /&(?:#([0-9]{1,8});?|#[xX]([0-9a-fA-F]{1,6});?|([a-zA-Z][a-zA-Z0-9]{1,31});)/g,
    (todo, decimal?: string, hexa?: string, nome?: string) => {
      if (decimal !== undefined) return doPontoDeCodigo(Number.parseInt(decimal, 10)) ?? todo
      if (hexa !== undefined) return doPontoDeCodigo(Number.parseInt(hexa, 16)) ?? todo
      if (nome !== undefined) return letraOuSimbolo(nome) ?? todo
      return todo
    },
  )
}

function doPontoDeCodigo(codigo: number): string | null {
  if (!Number.isFinite(codigo) || codigo <= 0 || codigo > 0x10ffff) return null
  // Surrogate solto quebra a string; melhor devolver nada e deixar o texto cru.
  if (codigo >= 0xd800 && codigo <= 0xdfff) return null
  try {
    return String.fromCodePoint(codigo)
  } catch {
    return null
  }
}

/* ---------------------------------------------------------------------- */
/* URL                                                                    */
/* ---------------------------------------------------------------------- */

/**
 * Devolve a URL normalizada se — e só se — ela for `http(s)://` absoluta.
 * `null` para tudo o mais.
 *
 * Ordem obrigatória: **decodificar entidade → remover controle e espaço →
 * verificar o esquema**. Verificar antes de decodificar deixa passar
 * `&#106;avascript:`; verificar antes de limpar deixa passar `java\tscript:`, que o
 * navegador lê como `javascript:`.
 *
 * Recusar é seguro por construção: quem chama mantém o texto do link e joga o
 * `href` fora. A pessoa continua lendo; só não tem onde clicar.
 */
export function urlSegura(bruta: string): string | null {
  const decodificada = decodificarEntidades(bruta)
  // Controle, espaço, separador Unicode, soft hyphen e BOM: o navegador ignora
  // todos ao resolver o esquema. É assim que `java\tscript:` vira `javascript:` na
  // hora de navegar — então a limpeza vem ANTES da verificação.
  const limpa = decodificada.replace(
    /[\u0000-\u0020\u007f-\u00a0\u00ad\u1680\u180e\u2000-\u200f\u2028-\u202f\u205f-\u2060\u3000\ufeff]/g,
    '',
  )
  if (!/^https?:\/\/[^/]/i.test(limpa)) return null
  // `"`, `'`, `<` e `>` numa URL não escapam do React, mas também não têm razão de
  // estar ali sem codificação — negar é mais barato que raciocinar sobre o caso.
  if (/["'<>`\\]/.test(limpa)) return null
  return limpa
}

/* ---------------------------------------------------------------------- */
/* Passagem 1 — tokenizador                                               */
/* ---------------------------------------------------------------------- */

type Token =
  | { readonly t: 'texto'; readonly valor: string }
  | {
      readonly t: 'abre'
      readonly nome: string
      readonly atributos: ReadonlyMap<string, string>
      readonly vazia: boolean
    }
  | { readonly t: 'fecha'; readonly nome: string }

/** Tags sem conteúdo — não empilham, não esperam fechamento. */
const TAGS_VAZIAS = new Set([
  'br',
  'hr',
  'img',
  'wbr',
  'col',
  'area',
  'base',
  'embed',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'ri:attachment',
  'ri:url',
  'ri:page',
  'ri:space',
  'ri:user',
  'ri:blog-post',
  'ri:card-appearance',
  'ac:emoticon',
  'ac:placeholder',
])

/**
 * Tags cujo **conteúdo também** é descartado.
 *
 * ⚠️ Isto **não é** o que garante a segurança — a garantia é a allowlist da
 * segunda passagem, que simplesmente não transforma nenhuma delas em nó. Aqui é
 * outra coisa: se `<script>alert(1)</script>` fosse desembrulhado, `alert(1)`
 * apareceria como texto visível na página. Inerte, mas ruído que faz quem lê
 * duvidar do que está lendo. Então o critério desta lista é "executa código ou
 * carrega recurso", e o efeito é cosmético mais defesa em profundidade.
 */
const TAGS_COM_CONTEUDO_DESCARTADO = new Set([
  'script',
  'style',
  'iframe',
  'object',
  'embed',
  'applet',
  'param',
  'frame',
  'frameset',
  'noframes',
  'noscript',
  'template',
  'slot',
  'portal',
  'svg',
  'math',
  'form',
  'input',
  'button',
  'select',
  'textarea',
  'option',
  'optgroup',
  'fieldset',
  'legend',
  'label',
  'base',
  'link',
  'meta',
  'audio',
  'video',
  'source',
  'track',
  'canvas',
  'map',
  'area',
  'dialog',
  'marquee',
  // Legado de texto cru: no navegador estas engolem o resto do documento.
  'xmp',
  'plaintext',
  'listing',
])

const INICIO_NOME = /[A-Za-z]/
const CORPO_NOME = /[A-Za-z0-9:_.\-À-ɏ]/

interface Coletor {
  readonly descartes: Descarte[]
  truncado: boolean
}

function anotar(coletor: Coletor, motivo: MotivoDescarte, detalhe: string): void {
  if (coletor.descartes.length >= MAX_DESCARTES) return
  coletor.descartes.push({ motivo, detalhe })
}

function tokenizar(entrada: string, coletor: Coletor): Token[] {
  const tokens: Token[] = []
  let i = 0
  let texto = ''

  const despejarTexto = () => {
    if (texto !== '') {
      tokens.push({ t: 'texto', valor: decodificarEntidades(texto) })
      texto = ''
    }
  }

  while (i < entrada.length) {
    const c = entrada[i]

    if (c !== '<') {
      texto += c
      i += 1
      continue
    }

    // `<!--` comentário: fora, com o conteúdo.
    if (entrada.startsWith('<!--', i)) {
      const fim = entrada.indexOf('-->', i + 4)
      i = fim === -1 ? entrada.length : fim + 3
      continue
    }

    // CDATA: em XML a entidade NÃO é expandida ali dentro. O Confluence põe código
    // em CDATA — expandir mudaria o código exibido e, pior, criaria um segundo
    // caminho de parse sobre um texto que já era final.
    if (entrada.startsWith('<![CDATA[', i)) {
      const fim = entrada.indexOf(']]>', i + 9)
      const bruto = entrada.slice(i + 9, fim === -1 ? entrada.length : fim)
      despejarTexto()
      if (bruto !== '') tokens.push({ t: 'texto', valor: bruto })
      i = fim === -1 ? entrada.length : fim + 3
      continue
    }

    // Declaração (`<!DOCTYPE`) ou instrução (`<?xml`): fora.
    if (entrada.startsWith('<!', i) || entrada.startsWith('<?', i)) {
      const fim = entrada.indexOf('>', i)
      i = fim === -1 ? entrada.length : fim + 1
      continue
    }

    if (entrada.startsWith('</', i)) {
      const nome = lerNome(entrada, i + 2)
      if (nome === null) {
        // `</` sem nome não é fechamento; é texto, como no navegador.
        texto += c
        i += 1
        continue
      }
      const fim = entrada.indexOf('>', nome.fim)
      despejarTexto()
      tokens.push({ t: 'fecha', nome: nome.valor })
      i = fim === -1 ? entrada.length : fim + 1
      continue
    }

    const nome = lerNome(entrada, i + 1)
    if (nome === null) {
      // `3 < 4` — `<` seguido de coisa que não é nome é texto literal.
      texto += c
      i += 1
      continue
    }

    const tag = lerAtributos(entrada, nome.fim)
    if (tag === null) {
      // Tag não terminada no fim da entrada. Descartar, não emitir como texto:
      // emitir texto de uma tag quebrada é o caminho que reintroduz marcação.
      anotar(coletor, 'tag_nao_terminada', nome.valor)
      despejarTexto()
      break
    }

    despejarTexto()
    tokens.push({
      t: 'abre',
      nome: nome.valor,
      atributos: tag.atributos,
      vazia: tag.autoFechada || TAGS_VAZIAS.has(nome.valor),
    })
    i = tag.fim
  }

  despejarTexto()
  return tokens
}

function lerNome(entrada: string, inicio: number): { valor: string; fim: number } | null {
  const primeiro = entrada[inicio]
  if (primeiro === undefined || !INICIO_NOME.test(primeiro)) return null
  let j = inicio + 1
  while (j < entrada.length) {
    const c = entrada[j]
    if (c === undefined || !CORPO_NOME.test(c)) break
    j += 1
  }
  return { valor: entrada.slice(inicio, j).toLowerCase(), fim: j }
}

/**
 * Lê os atributos até `>`.
 *
 * O nome é sempre **minúsculo** — `ONERROR`, `oNeRrOr` e `onerror` colidem na
 * mesma chave e param na mesma allowlist. E como o valor é lido só quando o nome
 * está na allowlist, `ON ERROR = "alert(1)"` produz duas chaves (`on` e `error`)
 * que ninguém consulta: um handler com espaço no meio não se reconstrói.
 *
 * Devolve `null` se a tag não fechar antes do fim da entrada.
 */
function lerAtributos(
  entrada: string,
  inicio: number,
): { atributos: ReadonlyMap<string, string>; autoFechada: boolean; fim: number } | null {
  const atributos = new Map<string, string>()
  let j = inicio
  let autoFechada = false

  while (j < entrada.length) {
    while (j < entrada.length && /\s/.test(entrada[j] ?? '')) j += 1
    const c = entrada[j]
    if (c === undefined) return null

    if (c === '>') return { atributos, autoFechada, fim: j + 1 }
    if (c === '/') {
      autoFechada = true
      j += 1
      continue
    }

    let inicioNome = j
    while (j < entrada.length && !/[\s=>/]/.test(entrada[j] ?? '')) j += 1
    if (j === inicioNome) {
      // Caractere que não abre nome nem fecha tag: consome e segue.
      j += 1
      continue
    }
    const nome = entrada.slice(inicioNome, j).toLowerCase()

    while (j < entrada.length && /\s/.test(entrada[j] ?? '')) j += 1
    let valor = ''
    if (entrada[j] === '=') {
      j += 1
      while (j < entrada.length && /\s/.test(entrada[j] ?? '')) j += 1
      const aspa = entrada[j]
      if (aspa === '"' || aspa === "'") {
        const fim = entrada.indexOf(aspa, j + 1)
        if (fim === -1) return null
        valor = entrada.slice(j + 1, fim)
        j = fim + 1
      } else {
        inicioNome = j
        while (j < entrada.length && !/[\s>]/.test(entrada[j] ?? '')) j += 1
        valor = entrada.slice(inicioNome, j)
      }
    }
    // Primeira ocorrência ganha, como no navegador.
    if (!atributos.has(nome)) atributos.set(nome, valor)
  }
  return null
}

/* ---------------------------------------------------------------------- */
/* Passagem 1 — árvore bruta (interna, nunca exportada)                   */
/* ---------------------------------------------------------------------- */

interface ElementoBruto {
  readonly tipo: 'elemento'
  readonly nome: string
  readonly atributos: ReadonlyMap<string, string>
  readonly filhos: NoBruto[]
}
type NoBruto = ElementoBruto | { readonly tipo: 'texto'; readonly texto: string }

interface Quadro {
  readonly nome: string
  /** Onde os filhos deste quadro são anexados. */
  readonly destino: NoBruto[]
}

function montarArvoreBruta(tokens: readonly Token[], coletor: Coletor): NoBruto[] {
  const raiz: NoBruto[] = []
  const pilha: Quadro[] = [{ nome: '#raiz', destino: raiz }]
  let nos = 0

  /** Nome da tag proibida em curso e quantos níveis dela já abriram. */
  let suprimindo: string | null = null
  let profundidadeSupressao = 0

  const atual = (): Quadro => pilha[pilha.length - 1] as Quadro

  for (const token of tokens) {
    if (suprimindo !== null) {
      if (token.t === 'abre' && token.nome === suprimindo && !token.vazia) {
        profundidadeSupressao += 1
      } else if (token.t === 'fecha' && token.nome === suprimindo) {
        profundidadeSupressao -= 1
        if (profundidadeSupressao === 0) suprimindo = null
      }
      continue
    }

    if (nos >= MAX_NOS) {
      coletor.truncado = true
      break
    }

    if (token.t === 'texto') {
      atual().destino.push({ tipo: 'texto', texto: token.valor })
      nos += 1
      continue
    }

    if (token.t === 'fecha') {
      const indice = pilha.findIndex((q) => q.nome === token.nome)
      // Fechamento órfão é ignorado; fechamento cruzado (`<b><i>x</b>`) fecha o
      // que estiver aberto acima também — é o que o navegador faz, e o que impede
      // marcação torta de virar árvore torta.
      if (indice > 0) pilha.length = indice
      continue
    }

    if (TAGS_COM_CONTEUDO_DESCARTADO.has(token.nome)) {
      anotar(coletor, 'tag_proibida', token.nome)
      if (!token.vazia) {
        suprimindo = token.nome
        profundidadeSupressao = 1
      }
      continue
    }

    if (pilha.length > MAX_PROFUNDIDADE) {
      // Passou do teto: o elemento não é criado, mas um quadro **transparente**
      // entra na pilha para que o fechamento correspondente ainda case. Sem ele,
      // o `</div>` deste elemento fecharia um ancestral e o resto da página
      // migraria para fora do lugar.
      anotar(coletor, 'profundidade', token.nome)
      if (!token.vazia) pilha.push({ nome: token.nome, destino: atual().destino })
      continue
    }

    const elemento: ElementoBruto = {
      tipo: 'elemento',
      nome: token.nome,
      atributos: token.atributos,
      filhos: [],
    }
    atual().destino.push(elemento)
    nos += 1
    if (!token.vazia) pilha.push({ nome: token.nome, destino: elemento.filhos })
  }

  return raiz
}

/* ---------------------------------------------------------------------- */
/* Passagem 2 — allowlist                                                 */
/* ---------------------------------------------------------------------- */

/**
 * Tags conhecidas que **não** viram nó: o conteúdo sobe para o pai. É o
 * "desembrulhar". Estão listadas para que não gerem ruído em `descartes` — tag
 * fora desta lista e fora do conversor é desembrulhada **e** anotada como
 * desconhecida, que é o sinal de que falta suporte a algo.
 */
const TAGS_TRANSPARENTES = new Set([
  'html',
  'body',
  'head',
  'title',
  'div',
  'span',
  'section',
  'article',
  'main',
  'header',
  'footer',
  'aside',
  'nav',
  'figure',
  'figcaption',
  'center',
  'font',
  'tt',
  'small',
  'big',
  'sup',
  'sub',
  'abbr',
  'cite',
  'dfn',
  'kbd',
  'samp',
  'var',
  'time',
  'mark',
  'ruby',
  'rt',
  'rp',
  'bdi',
  'bdo',
  'dl',
  'dt',
  'dd',
  'caption',
  'colgroup',
  'address',
  'details',
  'summary',
  // Andaime do Confluence: layout, tarefas e marcador de comentário inline.
  'ac:layout',
  'ac:layout-section',
  'ac:layout-cell',
  'ac:task-list',
  'ac:task',
  'ac:task-body',
  'ac:task-status',
  'ac:task-id',
  'ac:inline-comment-marker',
  'ac:rich-text-body',
  'ac:plain-text-body',
  'ac:link-body',
  'ac:plain-text-link-body',
  // Andaime do editor novo (ADF). `ac:adf-extension` e `ac:adf-node` são resolvidos no
  // `switch` — estes dois estão aqui para o caso de chegarem soltos, e as marcas de
  // formatação do ADF (negrito, link) que só embrulham conteúdo.
  'ac:adf-content',
  'ac:adf-fallback',
  'ac:adf-mark',
  'ac:adf-mark-fragment',
])

/** Atributos lidos, por tag. Tudo que não estiver aqui é anotado e jogado fora. */
const ATRIBUTOS_PERMITIDOS: Readonly<Record<string, readonly string[]>> = {
  a: ['href'],
  img: ['src', 'alt'],
  td: ['colspan', 'rowspan'],
  th: ['colspan', 'rowspan'],
  'ac:structured-macro': ['ac:name'],
  'ac:parameter': ['ac:name'],
  'ac:adf-node': ['type'],
  'ac:adf-attribute': ['key'],
  'ac:image': ['ac:alt'],
  // ⚠️ São CONTEÚDO, não configuração: é neles que mora o emoji que a pessoa digitou.
  // Ver `converterEmoticon` — sem estes dois o emoji some e sobra o espaço à frente.
  'ac:emoticon': ['ac:emoji-fallback', 'ac:emoji-id'],
  'time': ['datetime'],
  'ri:attachment': ['ri:filename'],
  'ri:url': ['ri:value'],
  'ri:page': ['ri:content-title', 'ri:space-key'],
}

const PAINEL_POR_MACRO: Readonly<Record<string, VariantePainel>> = {
  info: 'info',
  note: 'nota',
  panel: 'nota',
  warning: 'aviso',
  tip: 'dica',
}

/**
 * `panel-type` do painel do editor novo → a mesma `VariantePainel` da macro antiga.
 *
 * Os dois editores produzem o mesmo painel com nomes diferentes (`warning` na macro,
 * `error`/`warning` no ADF), e mapear para a união existente é o que faz um painel de
 * aviso escrito no editor novo continuar sendo **aviso** na leitura. Tipo fora da lista
 * (`custom`, ou algo que a Atlassian acrescente depois) cai em `nota`: moldura neutra,
 * nunca sumir com o texto.
 */
const PAINEL_POR_TIPO_ADF: Readonly<Record<string, VariantePainel>> = {
  info: 'info',
  note: 'nota',
  warning: 'aviso',
  error: 'aviso',
  success: 'dica',
  tip: 'dica',
}

const ENFASE_POR_TAG: Readonly<Record<string, VarianteEnfase>> = {
  strong: 'forte',
  b: 'forte',
  em: 'italico',
  i: 'italico',
  u: 'sublinhado',
  ins: 'sublinhado',
  del: 'riscado',
  s: 'riscado',
  strike: 'riscado',
  code: 'codigo',
}

/**
 * Ponto de entrada. Storage format → árvore tipada.
 *
 * Nunca lança: conteúdo hostil não deve virar 500. O que não dá para tratar sai
 * como descarte anotado.
 */
export function sanitizarStorage(storage: string): ResultadoSanitizacao {
  const coletor: Coletor = { descartes: [], truncado: false }

  let entrada = storage
  if (entrada.length > MAX_ENTRADA) {
    entrada = entrada.slice(0, MAX_ENTRADA)
    coletor.truncado = true
  }

  const bruta = montarArvoreBruta(tokenizar(entrada, coletor), coletor)
  const nos = converterLista(bruta, coletor)
  return { nos, descartes: coletor.descartes, truncado: coletor.truncado }
}

function converterLista(brutos: readonly NoBruto[], coletor: Coletor): No[] {
  const saida: No[] = []
  for (const bruto of brutos) saida.push(...converter(bruto, coletor))
  return saida
}

function converter(bruto: NoBruto, coletor: Coletor): No[] {
  if (bruto.tipo === 'texto') {
    return bruto.texto === '' ? [] : [{ tipo: 'texto', texto: bruto.texto }]
  }

  // A checagem de atributo roda para TODO elemento, inclusive os que serão
  // desembrulhados: `<p onclick>` precisa ser anotado mesmo que o `<p>` vire nó
  // sem atributo nenhum. É o registro de que o vetor apareceu.
  conferirAtributos(bruto, coletor)

  const nome = bruto.nome
  const filhos = () => converterLista(bruto.filhos, coletor)

  const enfase = ENFASE_POR_TAG[nome]
  if (enfase !== undefined) {
    const dentro = filhos()
    return dentro.length === 0 ? [] : [{ tipo: 'enfase', variante: enfase, filhos: dentro }]
  }

  switch (nome) {
    case 'p': {
      const dentro = filhos()
      return dentro.length === 0 ? [] : [{ tipo: 'paragrafo', filhos: dentro }]
    }
    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6': {
      const dentro = filhos()
      const nivel = Number.parseInt(nome.slice(1), 10) as NivelTitulo
      return dentro.length === 0 ? [] : [{ tipo: 'titulo', nivel, filhos: dentro }]
    }
    case 'br':
      return [{ tipo: 'quebra' }]
    case 'hr':
      return [{ tipo: 'separador' }]
    case 'blockquote': {
      const dentro = filhos()
      return dentro.length === 0 ? [] : [{ tipo: 'citacao', filhos: dentro }]
    }
    case 'pre': {
      const conteudo = textoDe(filhos())
      return conteudo.trim() === '' ? [] : [{ tipo: 'codigo', linguagem: null, conteudo }]
    }
    case 'ul':
    case 'ol':
      return converterListaHtml(bruto, nome === 'ol', coletor)
    case 'ac:task-list':
      return converterTarefas(bruto, coletor)
    case 'ac:task-id':
    case 'ac:task-uuid':
    case 'ac:task-status':
      // Metadado da tarefa, nunca conteúdo — e é a razão de existirem estes três `case`.
      // Desembrulhados, o id vira número solto na tela (`RNF-30`) e o status vira a palavra
      // `incomplete`, em inglês, no meio da frase da pessoa. `converterTarefas` já os lê do
      // bruto; chegando aqui soltos (marcação torta, `ac:task` sem lista em volta), somem.
      return []
    case 'li': {
      // `<li>` fora de lista: melhor um parágrafo que texto solto colado no anterior.
      const dentro = filhos()
      return dentro.length === 0 ? [] : [{ tipo: 'paragrafo', filhos: dentro }]
    }
    case 'table':
      return converterTabela(bruto, coletor)
    case 'a':
      return converterAncora(bruto, coletor)
    case 'img':
      return converterImg(bruto, coletor)
    case 'ac:image':
      return converterAcImage(bruto, coletor)
    case 'ac:link':
      return converterAcLink(bruto, coletor)
    case 'ac:structured-macro':
      return converterMacro(bruto, coletor)
    case 'ac:adf-extension':
    case 'ac:adf-node':
      return converterAdf(bruto, coletor)
    case 'ac:parameter':
    case 'ac:adf-attribute':
    case 'ac:adf-parameter':
      // Parâmetro é configuração da macro, não conteúdo. Chegando aqui solto, some:
      // JQL e chave de espaço podem revelar estrutura interna (ver `converterMacro`).
      //
      // ⚠️ Os dois do ADF **precisam** estar aqui, não só serem ignorados por
      // `converterAdf`: desembrulhados como tag desconhecida, o VALOR deles viraria texto
      // visível — a página mostraria `1f5d1 custom #c9372c` antes do painel.
      return []
    case 'ac:emoticon':
      return converterEmoticon(bruto)
    case 'time':
      return converterData(bruto)
    case 'ac:placeholder':
      return []
    default:
      break
  }

  if (!TAGS_TRANSPARENTES.has(nome)) anotar(coletor, 'tag_desconhecida', nome)
  return filhos()
}

function conferirAtributos(bruto: ElementoBruto, coletor: Coletor): void {
  const permitidos = ATRIBUTOS_PERMITIDOS[bruto.nome] ?? []
  for (const nome of bruto.atributos.keys()) {
    if (!permitidos.includes(nome)) anotar(coletor, 'atributo_descartado', nome)
  }
}

/** Valor de atributo já decodificado. Para URL, use `atributoCru` + `urlSegura`. */
function atributo(bruto: ElementoBruto, nome: string): string | null {
  const permitidos = ATRIBUTOS_PERMITIDOS[bruto.nome] ?? []
  if (!permitidos.includes(nome)) return null
  const valor = bruto.atributos.get(nome)
  return valor === undefined ? null : decodificarEntidades(valor)
}

/** Valor cru — `urlSegura` faz a única decodificação, para não decodificar duas vezes. */
function atributoCru(bruto: ElementoBruto, nome: string): string | null {
  const permitidos = ATRIBUTOS_PERMITIDOS[bruto.nome] ?? []
  if (!permitidos.includes(nome)) return null
  return bruto.atributos.get(nome) ?? null
}

/**
 * ⚠️ **Lista sem item nenhum devolve NADA, não uma lista vazia.**
 *
 * `<ul></ul>` chegava como `{ tipo: 'lista', itens: [] }`, e o renderizador desenhava um
 * `<ul>` sem filhos: invisível, mas com o `gap` da coluna — um buraco no meio do texto que se
 * lê como "faltou alguma coisa aqui". Uma ocorrência medida em 13/08/2026 ("Notas de
 * Reunião"), e é o mesmo raciocínio de `status` com `title` vazio e de tarefa sem corpo:
 * moldura vazia anuncia conteúdo que não existe.
 */
function converterListaHtml(bruto: ElementoBruto, ordenada: boolean, coletor: Coletor): No[] {
  const itens: No[][] = []
  for (const filho of bruto.filhos) {
    if (filho.tipo === 'elemento' && filho.nome === 'li') {
      conferirAtributos(filho, coletor)
      itens.push(converterLista(filho.filhos, coletor))
      continue
    }
    // Conteúdo direto na lista (marcação torta): entra no último item, ou abre um.
    const convertido = converter(filho, coletor)
    if (convertido.length === 0) continue
    const ultimo = itens[itens.length - 1]
    if (ultimo === undefined) itens.push(convertido)
    else ultimo.push(...convertido)
  }
  const comConteudo = itens.filter((i) => i.length > 0)
  return comConteudo.length === 0 ? [] : [{ tipo: 'lista', ordenada, itens: comConteudo }]
}

/**
 * 🚨 **O emoji do título era descartado, e sobrava o espaço.**
 *
 * Medido no app real em 13/08/2026: **69 títulos** de `DTE` e `GN` começavam com um espaço —
 * `" Data"`, `" Instruções"`, `" Objetivos"`. O emoji que os abre no Confluence
 * (`🗓 Data`, `🗒 Instruções`) vem como `ac:emoticon`, que este arquivo descartava inteiro.
 * Nos modelos de base de conhecimento do JSM o emoji é a âncora visual de **toda** seção:
 * sem ele a página perde a varredura que o autor desenhou, e ninguém percebe que perdeu.
 *
 * O emoji chega em dois lugares, e os dois são lidos:
 *
 * - `ac:emoji-fallback` — o caractere pronto (`📅`). É o caminho normal.
 * - `ac:emoji-id` — o ponto de código em hexa (`1f4c5`). Usado quando o `fallback` não vem.
 *   ⚠️ **Só decodifica se for hexa de verdade:** o id de emoji personalizado da Atlassian é
 *   texto (`atlassian-blue_star`), e `parseInt` dele devolveria lixo silencioso.
 *
 * ⚠️ **Sem nenhum dos dois continua descartando**, como antes. `ac:name` fica de fora de
 * propósito: ele é o apelido interno (`blue-star`), e imprimi-lo trocaria um emoji perdido
 * por jargão em inglês na tela — o defeito que `D-63` acabou de fechar nos blocos.
 */
function converterEmoticon(bruto: ElementoBruto): No[] {
  const pronto = atributo(bruto, 'ac:emoji-fallback')
  if (pronto !== null && pronto.trim() !== '') return [{ tipo: 'texto', texto: pronto }]

  const id = atributo(bruto, 'ac:emoji-id')
  if (id === null || !/^[0-9a-fA-F]{4,6}$/.test(id)) return []
  const ponto = Number.parseInt(id, 16)
  // `String.fromCodePoint` **lança** fora do intervalo, e isto roda sobre conteúdo que
  // qualquer pessoa edita: um id malformado não pode derrubar a leitura da página inteira.
  if (!Number.isFinite(ponto) || ponto < 0x20 || ponto > 0x10ffff) return []
  return [{ tipo: 'texto', texto: String.fromCodePoint(ponto) }]
}

/**
 * A macro de data do editor novo é `<time datetime="2026-08-13"/>` — tag **vazia**, com a
 * informação inteira no atributo. Desconhecida, ela era desembrulhada e não sobrava nada:
 * a seção "Data" das notas de reunião ficava com o título e o vazio embaixo.
 *
 * ⚠️ **O formato é `dd/mm/aaaa`, montado por fatia de string, não por `Date`.** `new
 * Date('2026-08-13')` é meia-noite **UTC**, e num fuso a oeste `toLocaleDateString` devolve o
 * dia **anterior** — a data da reunião mudaria de dia sozinha. Aqui não há fuso envolvido:
 * o storage traz a data civil que o autor escolheu, e ela é reordenada como está.
 *
 * Sem `datetime` utilizável sobra o texto do próprio elemento, e sem ele não sobra nada —
 * que é o comportamento de antes.
 */
function converterData(bruto: ElementoBruto): No[] {
  const iso = atributo(bruto, 'datetime')
  const casou = iso === null ? null : /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (casou !== null) return [{ tipo: 'texto', texto: `${casou[3]}/${casou[2]}/${casou[1]}` }]

  const proprio = textoBrutoDe(bruto).trim()
  return proprio === '' ? [] : [{ tipo: 'texto', texto: proprio }]
}

/**
 * `ac:task-list` → `tarefas`. A forma no storage é:
 *
 * ```xml
 * <ac:task-list>
 *   <ac:task>
 *     <ac:task-id>1</ac:task-id>
 *     <ac:task-status>incomplete</ac:task-status>
 *     <ac:task-body>Teste unitários</ac:task-body>
 *   </ac:task>
 * </ac:task-list>
 * ```
 *
 * ⚠️ **`complete` é a única palavra que marca "feito", e a comparação é exata.** O storage
 * usa `complete`/`incomplete`, e `incomplete` **contém** `complete`: um `includes` daria
 * checklist inteiro marcado como concluído — errado de um jeito que ninguém confere item a
 * item. Qualquer outro valor cai em "a fazer", que é o fail-closed certo aqui: dizer que
 * está pronto o que não se sabe é a única das duas leituras que engana.
 *
 * ⚠️ **Tarefa sem corpo é DESCARTADA, não vira item vazio.** Uma linha só com a caixinha
 * anuncia conteúdo que não existe — o mesmo raciocínio de `title` vazio em `status`.
 */
function converterTarefas(bruto: ElementoBruto, coletor: Coletor): No[] {
  const itens: ItemDeTarefa[] = []
  for (const filho of bruto.filhos) {
    if (filho.tipo !== 'elemento' || filho.nome !== 'ac:task') continue
    conferirAtributos(filho, coletor)

    const status = primeiroFilho(filho, 'ac:task-status')
    const concluida = status !== null && textoBrutoDe(status).trim().toLowerCase() === 'complete'

    const corpo = primeiroFilho(filho, 'ac:task-body')
    const dentro = corpo === null ? [] : converterLista(corpo.filhos, coletor)
    if (dentro.length === 0) continue

    itens.push({ concluida, filhos: dentro })
  }
  return itens.length === 0 ? [] : [{ tipo: 'tarefas', itens }]
}

function converterTabela(bruto: ElementoBruto, coletor: Coletor): No[] {
  const linhas: LinhaTabela[] = []

  const percorrer = (nos: readonly NoBruto[], dentroDeCabecalho: boolean) => {
    for (const no of nos) {
      if (no.tipo !== 'elemento') continue
      if (no.nome === 'thead') {
        conferirAtributos(no, coletor)
        percorrer(no.filhos, true)
      } else if (no.nome === 'tbody' || no.nome === 'tfoot') {
        conferirAtributos(no, coletor)
        percorrer(no.filhos, false)
      } else if (no.nome === 'tr') {
        conferirAtributos(no, coletor)
        linhas.push(converterLinha(no, dentroDeCabecalho, coletor))
      } else {
        // `<caption>`, `<colgroup>` e afins: já são transparentes na conversão normal.
        converter(no, coletor)
      }
    }
  }
  percorrer(bruto.filhos, false)

  const comCelulas = linhas.filter((l) => l.celulas.length > 0)
  return comCelulas.length === 0 ? [] : [{ tipo: 'tabela', linhas: comCelulas }]
}

function converterLinha(bruto: ElementoBruto, dentroDeCabecalho: boolean, coletor: Coletor): LinhaTabela {
  const celulas: CelulaTabela[] = []
  for (const no of bruto.filhos) {
    if (no.tipo !== 'elemento' || (no.nome !== 'td' && no.nome !== 'th')) continue
    conferirAtributos(no, coletor)
    celulas.push({
      filhos: converterLista(no.filhos, coletor),
      colunas: span(atributo(no, 'colspan')),
      linhas: span(atributo(no, 'rowspan')),
      cabecalho: dentroDeCabecalho || no.nome === 'th',
    })
  }
  // Tabela "Campo | Valor" do Confluence tem `<th>` na primeira COLUNA de toda
  // linha. Marcar a linha como cabeçalho por causa de um `<th>` faria a tabela
  // inteira virar cabeçalho — daí a distinção entre célula e linha.
  const todasCabecalho = celulas.length > 0 && celulas.every((c) => c.cabecalho)
  return { cabecalho: dentroDeCabecalho || todasCabecalho, celulas }
}

function span(valor: string | null): number {
  const n = valor === null ? 1 : Number.parseInt(valor, 10)
  if (!Number.isFinite(n) || n < 1) return 1
  return Math.min(n, MAX_SPAN_CELULA)
}

function converterAncora(bruto: ElementoBruto, coletor: Coletor): No[] {
  const dentro = converterLista(bruto.filhos, coletor)
  const cru = atributoCru(bruto, 'href')
  const url = cru === null ? null : urlSegura(cru)
  if (url === null) {
    // Fail-closed sem apagar informação: o rótulo do link continua legível.
    if (cru !== null) anotar(coletor, 'url_recusada', 'a/href')
    return dentro
  }
  return dentro.length === 0 ? [] : [{ tipo: 'link', destino: { tipo: 'externo', url }, filhos: dentro }]
}

function converterImg(bruto: ElementoBruto, coletor: Coletor): No[] {
  const cru = atributoCru(bruto, 'src')
  const url = cru === null ? null : urlSegura(cru)
  if (url === null) {
    anotar(coletor, 'url_recusada', 'img/src')
    return []
  }
  if (!IMAGEM_EXTERNA_PERMITIDA) {
    anotar(coletor, 'imagem_externa_recusada', 'img/src')
    return []
  }
  return [{ tipo: 'imagem', origem: { tipo: 'externa', url }, alt: atributo(bruto, 'alt') ?? '' }]
}

/**
 * 🚨 **O nome do anexo só serve se ele for da PRÓPRIA página.**
 *
 * No storage format, `ri:attachment` aceita um `ri:page`/`ri:space` aninhado — é assim
 * que uma página referencia arquivo de outra. O proxy do app serve anexo **da página que
 * está sendo lida**, então usar o nome mesmo assim entregaria um arquivo homônimo desta
 * página (ou um 404) no lugar do que o autor escreveu: conteúdo errado com cara de certo,
 * que é pior que conteúdo ausente — a mesma razão de `D-42` recusar nome onde se espera
 * chave.
 *
 * `null` aqui não é erro: é "não dá para resolver com segurança", e quem chama degrada
 * dizendo que havia um arquivo, em vez de linkar para o lugar errado.
 */
function nomeDeAnexoDaPropriaPagina(
  /**
   * ⚠️ **O pai, não o `ri:attachment`.** `ri:attachment` está na lista de tags **void**
   * deste sanitizador, então `<ri:attachment><ri:page/></ri:attachment>` do storage não
   * produz um filho: o `ri:page` vira **irmão**, dentro do `ac:link`/`ac:image`. Procurar
   * o aninhamento no lugar errado devolveria "é desta página" para todo caso — a checagem
   * existiria e nunca reprovaria, que é o defeito que `RN-06` já sofreu com o `spaceId`.
   */
  pai: ElementoBruto,
  anexo: ElementoBruto,
  coletor: Coletor,
): string | null {
  conferirAtributos(anexo, coletor)
  if (primeiroFilho(pai, 'ri:page') !== null || primeiroFilho(pai, 'ri:space') !== null) {
    anotar(coletor, 'anexo_de_outra_pagina', 'ri:attachment')
    return null
  }
  const nomeArquivo = atributo(anexo, 'ri:filename')
  return nomeArquivo !== null && nomeArquivo !== '' ? nomeArquivo : null
}

function converterAcImage(bruto: ElementoBruto, coletor: Coletor): No[] {
  const alt = atributo(bruto, 'ac:alt') ?? ''
  const anexo = primeiroFilho(bruto, 'ri:attachment')
  if (anexo !== null) {
    const nomeArquivo = nomeDeAnexoDaPropriaPagina(bruto, anexo, coletor)
    if (nomeArquivo !== null) {
      return [{ tipo: 'imagem', origem: { tipo: 'anexo', nomeArquivo }, alt }]
    }
    // Imagem de outra página: não dá para servir sem arriscar o arquivo errado, e sumir
    // calada é o que `RF-43` proíbe. O `alt` — que o autor escreveu — vira o texto.
    if (alt !== '') return [{ tipo: 'texto' as const, texto: `Imagem em outra página: ${alt}` }]
  }
  const externa = primeiroFilho(bruto, 'ri:url')
  if (externa !== null) {
    conferirAtributos(externa, coletor)
    anotar(coletor, 'imagem_externa_recusada', 'ac:image/ri:url')
  }
  return []
}

function converterAcLink(bruto: ElementoBruto, coletor: Coletor): No[] {
  const corpo = converterLista(bruto.filhos.filter(ehCorpoDeLink), coletor)
  const pagina = primeiroFilho(bruto, 'ri:page')
  if (pagina !== null) {
    conferirAtributos(pagina, coletor)
    const titulo = atributo(pagina, 'ri:content-title')
    if (titulo !== null && titulo !== '') {
      const filhos = corpo.length > 0 ? corpo : [{ tipo: 'texto' as const, texto: titulo }]
      return [
        {
          tipo: 'link',
          destino: { tipo: 'paginaConfluence', titulo, espaco: atributo(pagina, 'ri:space-key') },
          filhos,
        },
      ]
    }
  }
  // `T-142` — o anexo da página. Sem isto, link para PDF ou planilha virava texto puro.
  const anexo = primeiroFilho(bruto, 'ri:attachment')
  if (anexo !== null) {
    const nomeArquivo = nomeDeAnexoDaPropriaPagina(bruto, anexo, coletor)
    if (nomeArquivo !== null) {
      // ⚠️ Corpo vazio usa o **nome do arquivo** como texto visível, como `ri:page` usa o
      // título. Um `<a>` sem texto é um link que ninguém vê nem alcança pelo teclado.
      const filhos = corpo.length > 0 ? corpo : [{ tipo: 'texto' as const, texto: nomeArquivo }]
      return [{ tipo: 'link', destino: { tipo: 'anexoDaPagina', nomeArquivo }, filhos }]
    }
    // Não deu para resolver com segurança — mas houve um arquivo ali, e sumir com ele
    // calado é o defeito que esta tarefa conserta. O texto do link (ou o nome, quando ele
    // existe) fica na tela; quem lê sabe que falta algo em vez de decidir sem saber.
    const nomeCru = atributo(anexo, 'ri:filename')
    if (corpo.length > 0) return corpo
    if (nomeCru !== null && nomeCru !== '') {
      return [{ tipo: 'texto' as const, texto: `Arquivo anexado em outra página: ${nomeCru}` }]
    }
  }

  const externa = primeiroFilho(bruto, 'ri:url')
  if (externa !== null) {
    conferirAtributos(externa, coletor)
    const cru = atributoCru(externa, 'ri:value')
    const url = cru === null ? null : urlSegura(cru)
    if (url !== null && corpo.length > 0) {
      return [{ tipo: 'link', destino: { tipo: 'externo', url }, filhos: corpo }]
    }
    if (url === null) anotar(coletor, 'url_recusada', 'ac:link/ri:url')
  }
  return corpo
}

function ehCorpoDeLink(no: NoBruto): boolean {
  if (no.tipo === 'texto') return true
  return no.nome === 'ac:plain-text-link-body' || no.nome === 'ac:link-body'
}

/**
 * Macro do Confluence. As suportadas viram nó; as demais viram **placeholder
 * visível** (`RF-43`).
 *
 * ⚠️ O placeholder leva **só o nome** da macro. Parâmetro de macro (JQL, id de
 * filtro, chave de espaço) descreve estrutura interna e pode citar projeto que
 * quem lê não deveria conhecer — e o nome já basta para a pessoa saber que falta
 * algo ali e pedir o link da página original.
 */
function converterMacro(bruto: ElementoBruto, coletor: Coletor): No[] {
  const nome = (atributo(bruto, 'ac:name') ?? '').trim().toLowerCase()

  if (nome === 'code' || nome === 'noformat') {
    const corpo = bruto.filhos.find((f) => f.tipo === 'elemento' && f.nome === 'ac:plain-text-body')
    const conteudo = corpo === undefined ? '' : textoDe(converter(corpo, coletor))
    const linguagem = nome === 'code' ? parametroDaMacro(bruto, 'language') : null
    return conteudo.trim() === '' ? [] : [{ tipo: 'codigo', linguagem, conteudo }]
  }

  /**
   * 🚨 **`status` tem texto, mas não tem CORPO — e era isso que a fazia virar caixa cinza.**
   *
   * O critério deste arquivo para "dá para renderizar?" era ter `ac:rich-text-body`. O
   * `status` não tem: o texto dele mora num **parâmetro** (`title`), como a linguagem do
   * bloco de código. Então a macro mais usada para marcar "CONCLUÍDO"/"EM ANDAMENTO" caía
   * no placeholder de `RF-43` dizendo *"o atlas ainda não sabe mostrar este bloco"* —
   * acusando limitação nossa sobre um texto que estava ali, a um `parametroDaMacro` de
   * distância. Visto no app real em 10/08/2026, duas vezes na mesma página.
   *
   * A cor (`colour`) é descartada de propósito — ver `etiqueta` em `No`.
   *
   * ⚠️ **`title` vazio devolve nada, e não o placeholder.** Uma etiqueta sem texto é uma
   * pílula vazia: o Confluence desenha assim, e não há informação nenhuma a preservar.
   * Mandar o placeholder ali seria o erro oposto — anunciar conteúdo escondido que não
   * existe, que é exatamente o que a frase antiga de `RF-43` fazia.
   */
  if (nome === 'status') {
    const texto = parametroDaMacro(bruto, 'title')
    return texto === null ? [] : [{ tipo: 'etiqueta', texto }]
  }

  const painel = PAINEL_POR_MACRO[nome]
  if (painel !== undefined) {
    const dentro = converterLista(
      bruto.filhos.filter((f) => f.tipo === 'elemento' && f.nome === 'ac:rich-text-body'),
      coletor,
    )
    return dentro.length === 0 ? [] : [{ tipo: 'painel', variante: painel, filhos: dentro }]
  }

  if (nome === 'expand' || nome === 'section' || nome === 'column' || nome === 'div') {
    // Macro de layout: não há o que sinalizar, o conteúdo é que importa.
    return converterLista(
      bruto.filhos.filter((f) => f.tipo === 'elemento' && f.nome === 'ac:rich-text-body'),
      coletor,
    )
  }

  /**
   * ⚠️ **Macro desconhecida que TEM corpo: o corpo é renderizado, não descartado.**
   *
   * Este era o desperdício silencioso da leitura. Qualquer macro fora das listas acima virava
   * uma caixa cinza — **e o texto dentro dela ia embora**. `panel`, `deck`/`card` (abas),
   * `excerpt`, e qualquer macro que a Gocase use para envolver conteúdo caíam aqui: a página
   * tinha o texto, a pessoa não via, e a tela ainda dizia "o texto ao redor está completo".
   *
   * Renderizar o corpo é **de graça** (nenhuma chamada nova) e **seguro**: o corpo passa por
   * `converterLista`, exatamente a mesma allowlist de todo o resto — é a diferença entre "não
   * sei desenhar esta moldura" e "não posso mostrar este conteúdo". A moldura se perde; o
   * texto aparece.
   *
   * O `anotar` continua acontecendo: a auditoria de `RF-43` registra qual macro apareceu, e é
   * dela que sai a lista do que vale implementar de verdade um dia. Perder a moldura sem
   * registrar seria perder também o sinal.
   */
  const corpos = bruto.filhos.filter(
    (f) => f.tipo === 'elemento' && f.nome === 'ac:rich-text-body',
  )
  if (corpos.length > 0) {
    const dentro = converterLista(corpos, coletor)
    if (dentro.length > 0) {
      anotar(coletor, 'macro_nao_suportada', nome === '' ? 'sem nome' : nome)
      return dentro
    }
  }

  anotar(coletor, 'macro_nao_suportada', nome === '' ? 'sem nome' : nome)
  return [{ tipo: 'macroNaoSuportada', nome: nome === '' ? 'sem nome' : nome }]
}

/**
 * 🚨 **Bloco do editor novo (ADF): renderiza UM dos dois lados, nunca os dois.**
 *
 * ## O bug que isto conserta
 *
 * Painel escrito no editor novo é guardado assim:
 *
 * ```xml
 * <ac:adf-extension>
 *   <ac:adf-node type="panel">
 *     <ac:adf-attribute key="panel-type">info</ac:adf-attribute>
 *     <ac:adf-content><p>Bem-vindo…</p></ac:adf-content>
 *   </ac:adf-node>
 *   <ac:adf-fallback><div class="panel"><p>Welcome…</p></div></ac:adf-fallback>
 * </ac:adf-extension>
 * ```
 *
 * As três tags eram desconhecidas, então cada uma era **desembrulhada** e o conteúdo saía
 * **duas vezes**: uma do nó, outra do fallback. Na página inicial de espaço da Gocase isso
 * aparecia como o mesmo painel repetido com o título em português e depois em inglês —
 * medido no app real em 10/08/2026. Ninguém lê duas vezes para descobrir que é o mesmo
 * texto; quem vê conteúdo repetido conclui que o app está quebrado, e quem conclui isso
 * abre chamado, que é o oposto do que a aba existe para fazer.
 *
 * ## Por que o nó ganha do fallback, e não o contrário
 *
 * O nó é o conteúdo **de verdade** — o fallback é uma cópia em HTML que a Atlassian grava
 * para editores antigos, e é ela que estava em inglês. Preferir o fallback funcionaria
 * hoje e entregaria a tradução errada.
 *
 * ⚠️ **Mas o fallback não é decoração: ele é o caminho dos nós INLINE.** `status`, `date` e
 * afins vêm como `ac:adf-node` **sem** `ac:adf-content` — o texto deles mora nos atributos
 * — e o fallback traz a `ac:structured-macro` equivalente, que o resto deste arquivo já
 * sabe converter. É por isso que a regra é "conteúdo do nó, **senão** fallback" em vez de
 * "só o nó": trocar por "só o nó" faria toda etiqueta do editor novo desaparecer.
 */
function converterAdf(bruto: ElementoBruto, coletor: Coletor): No[] {
  const no = bruto.nome === 'ac:adf-node' ? bruto : primeiroFilho(bruto, 'ac:adf-node')

  if (no !== null) {
    const dentro = converterLista(
      no.filhos.filter((f) => f.tipo === 'elemento' && f.nome === 'ac:adf-content'),
      coletor,
    )
    if (dentro.length > 0) {
      if (atributo(no, 'type') !== 'panel') return dentro
      const tipo = atributoAdf(no, 'panel-type') ?? ''
      return [{ tipo: 'painel', variante: PAINEL_POR_TIPO_ADF[tipo] ?? 'nota', filhos: dentro }]
    }
  }

  const fallback = converterLista(
    bruto.filhos.filter((f) => f.tipo === 'elemento' && f.nome === 'ac:adf-fallback'),
    coletor,
  )
  if (fallback.length > 0) return fallback

  // Nem conteúdo nem fallback: aí é o placeholder de `RF-43`, com o tipo do nó como pista.
  // `adf:` no nome deixa claro na auditoria que veio do editor novo, e não de uma macro.
  const tipo = no === null ? '' : (atributo(no, 'type') ?? '')
  const nome = tipo === '' ? 'adf' : `adf:${tipo}`
  anotar(coletor, 'macro_nao_suportada', nome)
  return [{ tipo: 'macroNaoSuportada', nome }]
}

/**
 * Atributo do nó ADF — o equivalente de `parametroDaMacro` no editor novo.
 *
 * Só `panel-type` é lido, e ele é **apresentação** ("este painel é um aviso"), não
 * estrutura: `RNF-30` guarda JQL, chave de espaço e id de filtro, que descrevem o interior
 * da Atlassian. `panel-icon-id` e `panel-color` continuam fora — cor não decide nada aqui
 * (ver `etiqueta` em `No`).
 */
function atributoAdf(no: ElementoBruto, chave: string): string | null {
  for (const filho of no.filhos) {
    if (filho.tipo !== 'elemento' || filho.nome !== 'ac:adf-attribute') continue
    if (atributo(filho, 'key') !== chave) continue
    const valor = textoBrutoDe(filho).trim()
    return valor === '' ? null : valor
  }
  return null
}

function parametroDaMacro(bruto: ElementoBruto, nomeParametro: string): string | null {
  for (const filho of bruto.filhos) {
    if (filho.tipo !== 'elemento' || filho.nome !== 'ac:parameter') continue
    if (atributo(filho, 'ac:name') !== nomeParametro) continue
    const valor = textoBrutoDe(filho).trim()
    return valor === '' ? null : valor
  }
  return null
}

function primeiroFilho(bruto: ElementoBruto, nome: string): ElementoBruto | null {
  for (const filho of bruto.filhos) {
    if (filho.tipo === 'elemento' && filho.nome === nome) return filho
  }
  return null
}

function textoBrutoDe(bruto: NoBruto): string {
  if (bruto.tipo === 'texto') return bruto.texto
  return bruto.filhos.map(textoBrutoDe).join('')
}

/* ---------------------------------------------------------------------- */
/* Utilitário público                                                     */
/* ---------------------------------------------------------------------- */

/** Texto puro da árvore. Serve para trecho de busca, título e teste. */
export function textoDe(nos: readonly No[]): string {
  let saida = ''
  for (const no of nos) {
    switch (no.tipo) {
      case 'texto':
        saida += no.texto
        break
      case 'codigo':
        saida += no.conteudo
        break
      // A etiqueta entra no texto puro: ela é conteúdo da página, e é justamente o tipo de
      // palavra ("Concluído", "Bloqueado") que faz um trecho de busca dizer se vale abrir.
      case 'etiqueta':
        saida += no.texto
        break
      case 'macroNaoSuportada':
        break
      case 'quebra':
      case 'separador':
        saida += '\n'
        break
      case 'lista':
        for (const item of no.itens) saida += `${textoDe(item)}\n`
        break
      // Só o texto da tarefa. O estado NÃO entra: este texto vira trecho de busca e
      // resumo, e um "Concluído" que a pessoa não escreveu casaria com a busca dela.
      case 'tarefas':
        for (const item of no.itens) saida += `${textoDe(item.filhos)}\n`
        break
      case 'tabela':
        for (const linha of no.linhas) {
          saida += `${linha.celulas.map((c) => textoDe(c.filhos)).join(' | ')}\n`
        }
        break
      case 'imagem':
        saida += no.alt
        break
      case 'paragrafo':
      case 'titulo':
      case 'citacao':
      case 'painel':
        saida += `${textoDe(no.filhos)}\n`
        break
      case 'enfase':
      case 'link':
        saida += textoDe(no.filhos)
        break
    }
  }
  return saida
}
