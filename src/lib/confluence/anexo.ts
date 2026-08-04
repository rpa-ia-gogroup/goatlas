/**
 * O que sai do proxy de anexo — `RNF-06`, `RNF-02`. Funções puras.
 *
 * ## O vetor
 *
 * A sanitização fecha o XSS do **corpo** da página. O anexo entra por outra porta:
 * um arquivo `.png` cujo `Content-Type` de upload é `text/html`, servido a partir do
 * **nosso** domínio, roda com a sessão do app. O tipo vem da Atlassian, que repete o
 * que alguém escolheu no upload — é entrada não confiável com cara de metadado.
 *
 * ## As três decisões
 *
 * 1. **Allowlist de tipos exibíveis, e o resto vira download opaco.** Não se
 *    pergunta "é `text/html`?" — pergunta-se "é um dos tipos que sabemos exibir?".
 *    Blocklist perde a corrida contra `application/xhtml+xml`, `image/svg+xml`,
 *    `text/xml` e o próximo da lista.
 * 2. **`image/svg+xml` fica FORA da allowlist**, apesar de ser imagem. SVG é
 *    documento XML com `<script>` e handlers de evento — servido inline, é XSS.
 *    Imagem de verdade no Confluence é PNG/JPEG; SVG de diagrama vira download, o
 *    que é chato e não é vazamento.
 * 3. **O nome do arquivo é entrada não confiável num cabeçalho HTTP.** Quem edita a
 *    página escolhe o nome; CRLF nele é tentativa de escrever um segundo cabeçalho.
 *    Daí `filename` ASCII entre aspas (sem aspas, sem barra, sem controle) **mais**
 *    `filename*` em UTF-8, que é o que preserva acento — e PT-BR não é caso de borda
 *    aqui.
 *
 * _Requirements: RNF-06, RNF-02, RF-39_
 */

/**
 * Tipos exibidos inline. Curta de propósito: cada tipo aqui é um formato que o
 * navegador renderiza no nosso domínio, então entrar nesta lista é uma decisão de
 * segurança, não de conveniência.
 */
const TIPOS_INLINE = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/bmp',
  // PDF é o formato de procedimento anexado — exibir inline é metade do valor do
  // proxy. Ele roda no visualizador do navegador, não no DOM da página.
  'application/pdf',
])

/** Tipo de saída de tudo que não é exibível: opaco, sem palpite. */
export const TIPO_OPACO = 'application/octet-stream'

/**
 * Grade de token de mídia do RFC 9110. Serve como validação **e** como barreira de
 * injeção: `image/png\r\nSet-Cookie: ...` não casa, então nunca chega ao cabeçalho.
 */
const TOKEN_MIDIA = /^[a-z0-9!#$%&'*+.^_`|~-]+\/[a-z0-9!#$%&'*+.^_`|~-]+$/

export interface Entrega {
  readonly contentType: string
  readonly disposicao: 'inline' | 'attachment'
}

/**
 * Decide o que sai no `Content-Type` e no `Content-Disposition`.
 *
 * O parâmetro é o que a **Atlassian** declarou; o retorno é o que o **app** afirma.
 * Nunca são a mesma coisa por acaso: quando são iguais, é porque o tipo passou pela
 * allowlist.
 */
export function decidirEntrega(tipoDeclarado: string | null): Entrega {
  // `image/png; charset=binary` → `image/png`. Parâmetro de mídia não interessa e
  // seria mais superfície para injeção.
  const base = (tipoDeclarado ?? '').split(';')[0]?.trim().toLowerCase() ?? ''
  if (!TOKEN_MIDIA.test(base) || !TIPOS_INLINE.has(base)) {
    return { contentType: TIPO_OPACO, disposicao: 'attachment' }
  }
  return { contentType: base, disposicao: 'inline' }
}

/** Teto do nome no cabeçalho. Nome de 100 KB não é caso de uso; é carga. */
const MAX_NOME = 120

/**
 * `Content-Disposition` seguro para um nome escolhido por terceiros.
 *
 * O `filename` ASCII existe para cliente antigo; o `filename*` é o que preserva
 * acento (RFC 5987). Os dois saem do **mesmo** nome, e nenhum dos dois carrega
 * caractere capaz de fechar o valor ou quebrar a linha.
 */
export function cabecalhoContentDisposition(
  nomeArquivo: string,
  disposicao: 'inline' | 'attachment',
): string {
  const cortado = nomeArquivo.slice(0, MAX_NOME)
  // ASCII imprimível, menos o que tem significado na sintaxe do cabeçalho. Tudo o
  // mais (inclusive CR, LF e acento) vira `_` — a versão fiel vai no `filename*`.
  const ascii = cortado.replace(/[^\x20-\x7e]/g, '_').replace(/["\\;]/g, '_')
  const seguro = ascii.trim() === '' ? 'anexo' : ascii
  // `encodeURIComponent` não escapa `'`, `(`, `)`, `!`, `*` — que são legais em
  // `ext-value`, mas `'` delimita o valor logo antes. Escapar à mão fecha isso.
  const utf8 = encodeURIComponent(cortado).replace(
    /['()!*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  )
  return `${disposicao}; filename="${seguro}"; filename*=UTF-8''${utf8}`
}

/**
 * Cabeçalhos fixos da resposta de anexo.
 *
 * `nosniff` é obrigatório: sem ele o navegador pode adivinhar `text/html` a partir
 * do conteúdo e desfazer a decisão de `decidirEntrega`. O CSP `sandbox` é a terceira
 * camada — se um tipo escapar da allowlist algum dia, ele ainda cai sem script, sem
 * origem e sem rede.
 */
export const CABECALHOS_ANEXO: Readonly<Record<string, string>> = Object.freeze({
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; sandbox",
  'Referrer-Policy': 'same-origin',
  // Privado, nunca `public`: um cache compartilhado serviria o anexo a quem a
  // verificação de RN-06 negaria.
  'Cache-Control': 'private, max-age=300',
})
