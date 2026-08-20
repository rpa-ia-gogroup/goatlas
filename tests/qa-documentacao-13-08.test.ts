/**
 * Bateria de QA da aba **Documentação** contra o app publicado — 13/08/2026.
 *
 * As 115 páginas dos três espaços liberados (`GT`, `DTE`, `GN`) foram lidas pela rota real
 * (`GET /api/confluence/pagina/:id`) e a árvore devolvida foi varrida à procura de texto que
 * a pessoa lê e não deveria estar ali. Quatro defeitos saíram, e nenhum deles quebrava teste,
 * derrubava rota ou aparecia em log — os quatro produziam **tela errada**, que é o único
 * lugar onde `RF-39`/`RF-43` podem falhar:
 *
 * 1. 🚨 **`ac:task-list` era desembrulhada** — as três tags do checklist do Confluence eram
 *    desconhecidas, e tag desconhecida vira `filhos()`. Cada tarefa chegava como três textos
 *    soltos e **colados**: `1incompleteO que fazer agora?` na página "Documentação do projeto
 *    mestre". O id interno (`RNF-30`) na frente, a palavra `incomplete` no meio (regra 4) e
 *    nenhuma caixinha. **130 nós soltos em 15 páginas** — o maior emissor de texto sem
 *    sentido da aba.
 * 2. **`&ordm;` e `&minus;` saíam literais** — `Lembrete para Customizar Pedido (15&ordm; dia)`
 *    na página "Programa de Envio Mensal Influencers". Mesma família do `&eacute;` de
 *    `version 22`, e `ordm`/`ordf` são justamente os que mais custam em português.
 * 3. **Página sem conteúdo abria em branco** — cinco páginas do `DTE` (`Agendor`, `Gateways
 *    financeiros`, `Engine Prisma`…) mostravam título, data e um retângulo vazio. "Está
 *    vazia" e "não carregou" são frases opostas, e o vazio é indistinguível das duas.
 * 4. **Bloco conhecido caindo em `desconhecido`** — `view-file` (arquivo anexado) e
 *    `adf:decision-list` imprimiam o **nome técnico em inglês** dentro de uma caixa que diz
 *    "o atlas ainda não sabe mostrar este bloco".
 *
 * As asserções são sobre o HTML que chegaria ao navegador, como em `rf43-adf-e-status.test.ts`:
 * árvore certa que o renderizador desenha errado não conserta nada.
 *
 * _Requirements: RF-39, RF-43, RNF-06, RNF-30_
 */

import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { sanitizarStorage, textoDe } from '@/lib/confluence/sanitizar'
import { ConteudoConfluence, montarIndice, renderizarNos } from '@/lib/confluence/renderizar'

const OPCOES_RENDER = {
  urlDeAnexo: (nome: string) => `/api/confluence/anexo/p1/${encodeURIComponent(nome)}`,
  urlDePagina: (titulo: string) => `/confluence/pagina?titulo=${encodeURIComponent(titulo)}`,
}

function markup(storage: string): string {
  const { nos } = sanitizarStorage(storage)
  return renderToStaticMarkup(renderizarNos(nos, OPCOES_RENDER))
}

/** A leitura de uma página inteira — é ela que tem índice, ao contrário do trecho de busca. */
function pagina(storage: string): string {
  const { nos, truncado } = sanitizarStorage(storage)
  return renderToStaticMarkup(ConteudoConfluence({ nos, truncado, opcoes: OPCOES_RENDER }))
}

/**
 * A forma medida no storage da Gocase. O `ac:task-id` de verdade chega a 46 dígitos numa
 * das páginas do `GN` — motivo a mais para ele nunca alcançar a tela.
 */
function tarefa(id: string, status: string, corpo: string): string {
  return (
    `<ac:task><ac:task-id>${id}</ac:task-id>` +
    `<ac:task-status>${status}</ac:task-status>` +
    `<ac:task-body>${corpo}</ac:task-body></ac:task>`
  )
}

describe('QA 13/08 — checklist do Confluence (`ac:task-list`)', () => {
  const CHECKLIST =
    '<h1>Requisitos / Checklist</h1>' +
    '<ac:task-list>' +
    tarefa('1', 'incomplete', 'Teste unitários') +
    tarefa('2', 'complete', 'Migração aplicada') +
    '</ac:task-list>'

  it('não deixa `incomplete` nem `complete` chegarem à tela', () => {
    const html = markup(CHECKLIST)

    // O defeito original, na sua forma exata. As duas palavras são inglês (regra 4) e não
    // são conteúdo: são o valor cru de um atributo do storage.
    expect(html).not.toContain('incomplete')
    expect(html).not.toContain('complete')
  })

  it('não deixa o id interno da tarefa chegar à tela (`RNF-30`)', () => {
    const html = markup(CHECKLIST)

    // `1incompleteO que fazer agora?` — o `1` era o `ac:task-id`. Id de estrutura interna
    // não vai para a tela, aqui como em `tipoNome` e nos parâmetros de macro.
    expect(html).not.toContain('>1<')
    expect(html).not.toContain('>2<')
  })

  it('desenha as duas tarefas com o texto separado, e não grudado', () => {
    const html = markup(CHECKLIST)

    expect(html).toContain('Teste unitários')
    expect(html).toContain('Migração aplicada')
    // A colagem era o sintoma visível: três textos irmãos sem nó de bloco em volta.
    expect(html).not.toContain('1incomplete')
    expect(html).toContain('doc-tarefas')
  })

  it('diz o estado em PORTUGUÊS e por texto, nunca só pela forma', () => {
    const html = markup(CHECKLIST)

    // A caixinha é `aria-hidden`; quem lê com leitor de tela precisa da palavra. Mesmo piso
    // de a11y que impede `etiqueta` de comunicar estado por cor.
    expect(html).toContain('A fazer:')
    expect(html).toContain('Concluída:')
  })

  it('🚨 `incomplete` NÃO conta como concluída — a comparação é exata', () => {
    const { nos } = sanitizarStorage(
      `<ac:task-list>${tarefa('7', 'incomplete', 'Falta fazer')}</ac:task-list>`,
    )

    // `incomplete` CONTÉM `complete`: um `includes` marcaria o checklist inteiro como
    // pronto, e ninguém confere item a item para descobrir.
    expect(nos).toEqual([
      {
        tipo: 'tarefas',
        itens: [{ concluida: false, filhos: [{ tipo: 'texto', texto: 'Falta fazer' }] }],
      },
    ])
  })

  it('status desconhecido cai em "a fazer" — dizer que está pronto é a leitura que engana', () => {
    const { nos } = sanitizarStorage(
      `<ac:task-list>${tarefa('8', 'sei-la', 'Alguma coisa')}</ac:task-list>`,
    )

    expect(nos).toEqual([
      {
        tipo: 'tarefas',
        itens: [{ concluida: false, filhos: [{ tipo: 'texto', texto: 'Alguma coisa' }] }],
      },
    ])
  })

  it('tarefa sem corpo é descartada, e não vira caixinha vazia', () => {
    const { nos } = sanitizarStorage(
      `<ac:task-list>${tarefa('9', 'complete', '')}</ac:task-list>`,
    )

    // Uma linha só com a caixinha anuncia conteúdo que não existe — mesmo raciocínio de
    // `status` com `title` vazio.
    expect(nos).toEqual([])
  })

  it('metadado solto (marcação torta) também não aparece', () => {
    // `ac:task` sem `ac:task-list` em volta: os três `case` do conversor é que seguram isto.
    const html = markup(`<p>Antes</p>${tarefa('3', 'incomplete', 'Solta')}<p>Depois</p>`)

    expect(html).not.toContain('incomplete')
    expect(html).not.toContain('>3<')
  })

  it('o texto puro leva a tarefa, mas NÃO o estado', () => {
    const { nos } = sanitizarStorage(CHECKLIST)

    // Este texto vira trecho de busca: um "Concluída" que ninguém escreveu casaria com a
    // busca de quem procura por essa palavra.
    expect(textoDe(nos)).toContain('Teste unitários')
    expect(textoDe(nos)).not.toContain('Concluída')
    expect(textoDe(nos)).not.toContain('incomplete')
  })
})

describe('QA 13/08 — entidades que saíam cruas', () => {
  it('decodifica `&ordm;` e `&ordf;` — os dois que mais custam em português', () => {
    const html = markup('<p>Lembrete (15&ordm; dia) e a 2&ordf; via</p>')

    expect(html).toContain('15º dia')
    expect(html).toContain('2ª via')
    expect(html).not.toContain('ordm')
  })

  it('decodifica `&minus;` e os sinais de comparação', () => {
    const html = markup('<p>&minus;3 &le; x &ne; y &ge; 0 &asymp; z</p>')

    expect(html).toContain('−3 ≤ x ≠ y ≥ 0 ≈ z')
  })

  it('🚨 seta de caixa diferente é caractere diferente — `&lArr;` não vira `&larr;`', () => {
    const html = markup('<p>&larr; e &lArr; e &rarr; e &rArr;</p>')

    // A tabela tolerante já respondia `←` para `&lArr;` — errado em silêncio, do mesmo
    // jeito que `&Eacute;` → `é` era antes das duas tabelas de letra.
    expect(html).toContain('← e ⇐ e → e ⇒')
  })

  it('`&dagger;` e `&Dagger;` continuam distintos', () => {
    expect(markup('<p>&dagger;&Dagger;</p>')).toContain('†‡')
  })

  it('o caminho tolerante continua tolerante onde a caixa não muda nada', () => {
    // `&COPY;` e `&copy;` são o mesmo `©` — a exatidão nova não pode ter quebrado isto.
    expect(markup('<p>&COPY; &Nbsp;fim</p>')).toContain('©')
  })

  it('entidade fora da tabela continua saindo crua, que é o comportamento honesto', () => {
    // Não pretendemos cobrir as 2.231 entidades do HTML5; o que falta sai como no navegador
    // de quem não conhece a entidade, em vez de virar caractere errado.
    expect(markup('<p>&clubsuit;</p>')).toContain('&amp;clubsuit;')
  })
})

describe('QA 13/08 — página sem conteúdo nenhum', () => {
  it('diz que a página está vazia, em vez de mostrar um retângulo em branco', () => {
    const html = renderToStaticMarkup(ConteudoConfluence({ nos: [], opcoes: OPCOES_RENDER }))

    expect(html).toContain('ainda não tem conteúdo escrito no Confluence')
  })

  it('não acusa o app de estar quebrado — o trabalho é de quem escreve', () => {
    const html = renderToStaticMarkup(ConteudoConfluence({ nos: [], opcoes: OPCOES_RENDER }))

    // "Não conseguimos carregar" mandaria a pessoa tentar de novo para sempre. A distinção
    // é a mesma de `comentariosIndisponiveis` × "não há respostas".
    expect(html).not.toContain('Não conseguimos')
    expect(html).not.toContain('atlas ainda não sabe')
  })

  it('página COM conteúdo não ganha o aviso', () => {
    const { nos } = sanitizarStorage('<p>Tem texto aqui.</p>')
    const html = renderToStaticMarkup(ConteudoConfluence({ nos, opcoes: OPCOES_RENDER }))

    expect(html).toContain('Tem texto aqui.')
    expect(html).not.toContain('ainda não tem conteúdo')
  })
})

describe('QA 13/08 — blocos que imprimiam o nome técnico em inglês', () => {
  function macro(nome: string): string {
    return `<ac:structured-macro ac:name="${nome}"/>`
  }

  it('`view-file` é nomeado em português e não cai em "não sabe mostrar"', () => {
    const html = markup(macro('view-file'))

    expect(html).toContain('Pré-visualização de um arquivo anexado')
    // O nome técnico só aparece quando é a única pista que temos.
    expect(html).not.toContain('view-file')
    expect(html).not.toContain('ainda não sabe mostrar')
  })

  it('`view-file` diz que existe um arquivo — nunca "não há o que trazer"', () => {
    const html = markup(macro('view-file'))

    // A frase de bloco dinâmico ("a página não guarda texto dele") seria falsa aqui: o
    // arquivo existe, e é isso que a pessoa precisa saber para ir atrás dele.
    expect(html).toContain('arquivo anexado à página')
    expect(html).not.toContain('não há o que trazer')
  })

  it('`adf:decision-list` é nomeado em português', () => {
    // Nó ADF sem conteúdo nem fallback — a forma medida em "Notas de Reunião".
    const html = markup(
      '<ac:adf-extension><ac:adf-node type="decision-list"/></ac:adf-extension>',
    )

    expect(html).toContain('Decisões registradas nesta página')
    expect(html).not.toContain('adf:decision-list')
  })

  it('bloco de verdade desconhecido CONTINUA mostrando o nome — ali ele é a única pista', () => {
    const html = markup(macro('macro-que-ninguem-viu'))

    expect(html).toContain('ainda não sabe mostrar')
    expect(html).toContain('macro-que-ninguem-viu')
  })

  it('`adf:extension` é nomeado, e diz que veio de um aplicativo', () => {
    const html = markup('<ac:adf-extension><ac:adf-node type="extension"/></ac:adf-extension>')

    expect(html).toContain('Bloco de um aplicativo do Confluence')
    expect(html).not.toContain('adf:extension')
  })
})

describe('QA 13/08 — o emoji do título era jogado fora', () => {
  it('usa `ac:emoji-fallback` — o caractere que a pessoa digitou', () => {
    const html = markup('<h2><ac:emoticon ac:name="calendar" ac:emoji-fallback="🗓"/> Data</h2>')

    // Eram 69 títulos assim (`" Data"`, `" Instruções"`): sobrava só o espaço da frente.
    expect(html).toContain('🗓 Data')
  })

  it('sem `fallback`, decodifica `ac:emoji-id` (ponto de código em hexa)', () => {
    const html = markup('<h2><ac:emoticon ac:name="dart" ac:emoji-id="1f3af"/> Objetivos</h2>')

    expect(html).toContain('🎯 Objetivos')
  })

  it('🚨 id que NÃO é hexa não vira lixo — some, como antes', () => {
    // O emoji personalizado da Atlassian tem id em texto (`atlassian-blue_star`), e um
    // `parseInt` dele devolveria um caractere qualquer, em silêncio.
    const html = markup('<h2><ac:emoticon ac:emoji-id="atlassian-blue_star"/> Seção</h2>')

    expect(html).toContain('Seção')
    expect(html).not.toContain('atlassian')
  })

  it('id hexa fora do intervalo de Unicode não derruba a leitura da página', () => {
    // Isto roda sobre conteúdo que qualquer pessoa edita: `String.fromCodePoint` lança.
    const html = markup('<p>Antes<ac:emoticon ac:emoji-id="ffffff"/>Depois</p>')

    expect(html).toContain('Antes')
    expect(html).toContain('Depois')
  })

  it('sem nenhum dos dois atributos continua descartando, e o nome interno não vaza', () => {
    const html = markup('<p>Oi <ac:emoticon ac:name="blue-star"/> tchau</p>')

    // `ac:name` é apelido interno em inglês: imprimi-lo trocaria emoji perdido por jargão.
    expect(html).not.toContain('blue-star')
    expect(html).toContain('Oi')
  })
})

describe('QA 13/08 — a data do editor novo desaparecia', () => {
  it('`<time datetime>` vira data em `dd/mm/aaaa`', () => {
    const html = markup('<p>Reunião de <time datetime="2026-08-13"/></p>')

    expect(html).toContain('13/08/2026')
  })

  it('🚨 a data NÃO passa por `Date` — não pode andar um dia por causa de fuso', () => {
    // `new Date('2026-01-01')` é meia-noite UTC; num fuso a oeste, formatar devolveria
    // `31/12/2025`. A data civil do storage é reordenada como está.
    expect(markup('<p><time datetime="2026-01-01"/></p>')).toContain('01/01/2026')
  })

  it('sem `datetime` utilizável sobra o texto do próprio elemento', () => {
    expect(markup('<p><time>ontem</time></p>')).toContain('ontem')
  })
})

describe('QA 13/08 — lista sem item nenhum', () => {
  it('não vira `<ul>` vazio', () => {
    const { nos } = sanitizarStorage('<p>Antes</p><ul></ul><p>Depois</p>')

    // O `<ul>` vazio é invisível mas carrega o `gap` da coluna: um buraco que se lê como
    // "faltou alguma coisa aqui".
    expect(nos.some((n) => n.tipo === 'lista')).toBe(false)
    expect(markup('<p>Antes</p><ul></ul><p>Depois</p>')).not.toContain('<ul>')
  })

  it('lista com item continua sendo lista', () => {
    expect(markup('<ul><li>Um</li></ul>')).toContain('<ul><li>Um</li></ul>')
  })
})

describe('QA 13/08 — `toc` dizia que não havia o que trazer, e havia', () => {
  const COM_TITULOS =
    '<ac:structured-macro ac:name="toc"/>' +
    '<h2>Objetivos</h2><p>a</p><h3>Detalhe</h3><p>b</p><h2>Rotinas</h2><p>c</p>'

  it('vira o índice de verdade, com um link por título', () => {
    const html = pagina(COM_TITULOS)

    expect(html).toContain('Nesta página')
    expect(html).toContain('>Objetivos</a>')
    expect(html).toContain('>Detalhe</a>')
    expect(html).toContain('>Rotinas</a>')
    // A frase antiga era FALSA aqui: o texto do índice são os títulos que estão na tela.
    expect(html).not.toContain('não há o que trazer')
  })

  it('o link do índice e o `id` do título são a MESMA âncora', () => {
    const html = pagina(COM_TITULOS)
    const ancora = /href="#([^"]+)"/.exec(html)?.[1]

    expect(ancora).toBeDefined()
    // Divergir aqui é silencioso: o link continua bonito e não leva a lugar nenhum — mesma
    // classe de bug de `urlDeLeituraNoApp`/`entradaDaUrl`.
    expect(html).toContain(`id="${ancora}"`)
  })

  it('🚨 títulos com o MESMO texto ganham âncoras diferentes', () => {
    const indice = montarIndice(sanitizarStorage('<h2>Instruções</h2><h2>Instruções</h2>').nos)

    // Âncoras iguais fazem o segundo link levar ao primeiro título — pior que não ter índice.
    expect(indice.itens).toHaveLength(2)
    expect(indice.itens[0]?.ancora).not.toBe(indice.itens[1]?.ancora)
  })

  it('página sem título nenhum volta ao placeholder — ali a frase é verdadeira', () => {
    const html = pagina('<ac:structured-macro ac:name="toc"/><p>Só texto corrido.</p>')

    expect(html).toContain('não há o que trazer')
    expect(html).not.toContain('Nesta página')
  })

  it('no trecho de BUSCA continua placeholder — não há página para ancorar', () => {
    const html = markup(COM_TITULOS)

    // `renderizarNos` desenha um pedaço; âncora de pedaço aponta para título fora da tela.
    expect(html).toContain('não há o que trazer')
    expect(html).not.toContain('href="#')
  })

  it('o índice ignora os parâmetros da macro (`RNF-30`)', () => {
    const html = pagina(
      '<ac:structured-macro ac:name="toc"><ac:parameter ac:name="maxLevel">2</ac:parameter>' +
        '</ac:structured-macro><h2>Um</h2><h3>Dois</h3>',
    )

    // `maxLevel` é preferência de quem editou a página; respeitá-lo pediria levar parâmetro
    // de macro para a decisão de tela. Todos os níveis aparecem, recuados.
    expect(html).toContain('>Um</a>')
    expect(html).toContain('>Dois</a>')
    expect(html).not.toContain('maxLevel')
  })

  it('título dentro de painel também entra no índice', () => {
    const html = pagina(
      '<ac:structured-macro ac:name="info"><ac:rich-text-body><h2>Dentro</h2>' +
        '</ac:rich-text-body></ac:structured-macro><ac:structured-macro ac:name="toc"/>',
    )

    expect(html).toContain('>Dentro</a>')
  })
})
