/**
 * Árvore sanitizada → elementos React. **Zero `dangerouslySetInnerHTML`** —
 * `RNF-06`, `RF-39`, `RF-43`.
 *
 * ## Por que isto é a segunda camada, e não só "a parte visual"
 *
 * Padrão do projeto: trava crítica tem duas camadas (ver `agent/gate.ts`). Aqui a
 * primeira é `sanitizar.ts`; a segunda é este arquivo **desconfiar da árvore que
 * recebe**. Toda URL é revalidada por `urlSegura` no momento de virar `href`/`src`,
 * mesmo já vindo pronta. A camada 1 sozinha seria suficiente hoje e insuficiente na
 * primeira vez que alguém construir nó à mão — cache, importação, migração, teste.
 *
 * O tipo `No` é uma união fechada e nenhum de seus membros carrega saco de
 * atributos. Então não existe caminho em que uma string do Confluence se torne
 * marcação: o pior caso é um nó que este arquivo não sabe renderizar, e o `switch`
 * é exaustivo.
 *
 * ## Direção visual
 *
 * O conteúdo é **citação**, não página nativa: chegou de outro lugar e está aqui
 * para a pessoa decidir se resolve o problema dela antes de abrir chamado. Daí a
 * **espinha lime** à esquerda da coluna — um traço só, dizendo "daqui para a
 * direita, o texto é do Confluence". É o mesmo lime que `.cartao-deflexao` usa no
 * momento da deflexão, agora como estrutura em vez de moldura.
 *
 * Painel de aviso e placeholder de macro **nunca comunicam por cor sozinha**: cada
 * um tem rótulo textual. E o placeholder reaproveita o tracejado que a trilha já
 * usa para "não foi possível" — vocabulário existente, não invenção nova.
 */

import { useState, type ReactNode } from 'react'
import type { CelulaTabela, LinhaTabela, No, VariantePainel } from './sanitizar'
import { urlSegura } from './sanitizar'

export interface OpcoesRender {
  /**
   * URL do proxy de anexo do app. O navegador **nunca** busca imagem na Atlassian
   * (`RNF-02`), e a rota não é hardcoded aqui (`RNF-25`).
   */
  readonly urlDeAnexo: (nomeArquivo: string) => string
  /** URL da leitura de outra página, dentro do próprio app. */
  readonly urlDePagina: (titulo: string, espaco: string | null) => string
  /**
   * O bloco `livesearch` do Confluence vira **busca de verdade** quando isto existe.
   *
   * ## Por que é opcional, e não sempre
   *
   * Este renderizador também desenha **trecho de resultado de busca** e roda em SSR nos
   * testes. Nesses contextos não há para onde uma busca ir, e uma caixa de texto que não
   * faz nada é pior que a explicação honesta. Ausente = o bloco continua sendo o
   * placeholder de `RF-43`; presente = a tela assume a busca.
   *
   * ⚠️ **O espaço vem de quem chama, não do parâmetro da macro.** O storage traz
   * `spaceKey`, mas conteúdo de página é editável por qualquer pessoa (`R-07`) e
   * parâmetro de macro não vai para a tela (`RNF-30`). Quem sabe em que espaço a pessoa
   * está é a tela, que leu a página por um caminho já verificado (`RN-06`).
   */
  readonly aoBuscarNoEspaco?: (termo: string) => void
}

const ROTULO_PAINEL: Readonly<Record<VariantePainel, string>> = {
  info: 'Informação',
  nota: 'Nota',
  aviso: 'Atenção',
  dica: 'Dica',
}

const MARCA_PAINEL: Readonly<Record<VariantePainel, string>> = {
  info: 'i',
  nota: '—',
  aviso: '!',
  dica: '★',
}

/**
 * URL gerada pelo próprio app. Tem de ser caminho absoluto do site: começa com
 * `/` e **não** com `//` (que seria protocolo-relativo, isto é, outro host).
 *
 * Existe porque `urlDeAnexo`/`urlDePagina` são injetadas: se um dia alguém passar
 * um gerador que devolve URL externa, o link deixa de ser criado em vez de virar
 * saída silenciosa para fora do app.
 */
function urlInternaSegura(url: string): string | null {
  if (!url.startsWith('/') || url.startsWith('//')) return null
  if (/[\u0000-\u0020"'<>`\\]/.test(url)) return null
  return url
}

/** Renderiza uma lista de nós. É o ponto de entrada usado pelos testes e pela tela. */
export function renderizarNos(nos: readonly No[], opcoes: OpcoesRender): ReactNode {
  return nos.map((no, i) => <Fragmento key={i} no={no} opcoes={opcoes} />)
}

function Fragmento({ no, opcoes }: { no: No; opcoes: OpcoesRender }): ReactNode {
  switch (no.tipo) {
    case 'texto':
      return no.texto

    case 'paragrafo':
      return <p>{renderizarNos(no.filhos, opcoes)}</p>

    case 'titulo': {
      const filhos = renderizarNos(no.filhos, opcoes)
      switch (no.nivel) {
        case 1:
          return <h1>{filhos}</h1>
        case 2:
          return <h2>{filhos}</h2>
        case 3:
          return <h3>{filhos}</h3>
        case 4:
          return <h4>{filhos}</h4>
        case 5:
          return <h5>{filhos}</h5>
        case 6:
          return <h6>{filhos}</h6>
      }
    }

    case 'enfase': {
      const filhos = renderizarNos(no.filhos, opcoes)
      switch (no.variante) {
        case 'forte':
          return <strong>{filhos}</strong>
        case 'italico':
          return <em>{filhos}</em>
        case 'sublinhado':
          return <u>{filhos}</u>
        case 'riscado':
          return <s>{filhos}</s>
        case 'codigo':
          return <code className="doc-codigo-inline">{filhos}</code>
      }
    }

    case 'lista': {
      const itens = no.itens.map((item, i) => <li key={i}>{renderizarNos(item, opcoes)}</li>)
      return no.ordenada ? <ol>{itens}</ol> : <ul>{itens}</ul>
    }

    case 'citacao':
      return <blockquote>{renderizarNos(no.filhos, opcoes)}</blockquote>

    case 'quebra':
      return <br />

    case 'separador':
      return <hr />

    case 'tabela':
      return <Tabela linhas={no.linhas} opcoes={opcoes} />

    case 'link':
      return <Link no={no} opcoes={opcoes} />

    case 'imagem':
      return <Imagem no={no} opcoes={opcoes} />

    case 'codigo':
      return <Codigo linguagem={no.linguagem} conteudo={no.conteudo} />

    case 'painel':
      return (
        <aside className="doc-painel" data-variante={no.variante}>
          <p className="doc-painel-rotulo">
            <span aria-hidden="true" className="doc-painel-marca">
              {MARCA_PAINEL[no.variante]}
            </span>
            {ROTULO_PAINEL[no.variante]}
          </p>
          <div className="doc-painel-corpo">{renderizarNos(no.filhos, opcoes)}</div>
        </aside>
      )

    case 'etiqueta':
      // Pílula com contorno, sem cor de estado: a identidade não tem vermelho nem verde
      // (§1.3) e estado nunca é comunicado só por cor. Quem diz o estado é a palavra que a
      // pessoa escreveu — e ela é lida por leitor de tela como texto comum, de propósito.
      return <span className="doc-etiqueta">{no.texto}</span>

    case 'macroNaoSuportada':
      // ⚠️ O bloco de busca é resolvido AQUI, no renderizador — a sanitização continua
      // tratando `livesearch` como macro não suportada, e é de propósito: ela é a camada
      // de segurança, e "esta macro virou um formulário" é decisão de apresentação. Mexer
      // no sanitizador para isto misturaria as duas camadas que `RNF-06` mantém separadas.
      return no.nome === 'livesearch' && opcoes.aoBuscarNoEspaco !== undefined ? (
        <BuscaDoEspaco aoBuscar={opcoes.aoBuscarNoEspaco} />
      ) : (
        <MacroNaoSuportada nome={no.nome} />
      )
  }
}

/* ---------------------------------------------------------------------- */

function Link({
  no,
  opcoes,
}: {
  no: Extract<No, { tipo: 'link' }>
  opcoes: OpcoesRender
}): ReactNode {
  const filhos = renderizarNos(no.filhos, opcoes)

  if (no.destino.tipo === 'paginaConfluence') {
    const url = urlInternaSegura(opcoes.urlDePagina(no.destino.titulo, no.destino.espaco))
    // Leitura de outra página continua dentro do app: quem lê não tem assento
    // Atlassian, então mandar para o Confluence seria mandar para uma parede.
    if (url === null) return filhos
    return (
      <a className="doc-link" href={url}>
        {filhos}
      </a>
    )
  }

  if (no.destino.tipo === 'anexoDaPagina') {
    // `T-142` — o MESMO proxy da imagem (`RNF-02`): o navegador nunca fala com a
    // Atlassian, e quem decide `Content-Type` e inline × download é `decidirEntrega`
    // (`D-11`), nunca este link. Sem `download`: para PDF a leitura na aba é o caminho
    // curto, e o servidor força `attachment` no que não é exibível.
    const url = urlInternaSegura(opcoes.urlDeAnexo(no.destino.nomeArquivo))
    if (url === null) return filhos
    return (
      <a className="doc-link doc-link-anexo" href={url}>
        {filhos}
      </a>
    )
  }

  // Revalidação — camada 2. Nó vindo pronto não é nó confiável.
  const url = urlSegura(no.destino.url)
  if (url === null) return filhos
  return (
    <a className="doc-link" href={url} target="_blank" rel="noopener noreferrer">
      {filhos}
    </a>
  )
}

function Imagem({
  no,
  opcoes,
}: {
  no: Extract<No, { tipo: 'imagem' }>
  opcoes: OpcoesRender
}): ReactNode {
  const url =
    no.origem.tipo === 'anexo'
      ? urlInternaSegura(opcoes.urlDeAnexo(no.origem.nomeArquivo))
      : urlSegura(no.origem.url)

  // Sem URL utilizável não há `<img>` sem `src` nem alt órfão: o texto
  // alternativo entra como legenda, para a informação não desaparecer calada.
  if (url === null) {
    return no.alt === '' ? null : <p className="doc-imagem-ausente">Imagem: {no.alt}</p>
  }
  return <img className="doc-imagem" src={url} alt={no.alt} loading="lazy" />
}

function Codigo({ linguagem, conteudo }: { linguagem: string | null; conteudo: string }): ReactNode {
  return (
    <figure className="doc-codigo">
      {linguagem !== null && <figcaption className="doc-codigo-linguagem">{linguagem}</figcaption>}
      <pre>
        <code>{conteudo}</code>
      </pre>
    </figure>
  )
}

function Tabela({
  linhas,
  opcoes,
}: {
  linhas: readonly LinhaTabela[]
  opcoes: OpcoesRender
}): ReactNode {
  const cabecalho = linhas.filter((l) => l.cabecalho)
  const corpo = linhas.filter((l) => !l.cabecalho)

  const renderizarLinha = (linha: LinhaTabela, i: number) => (
    <tr key={i}>
      {linha.celulas.map((celula, j) => (
        <Celula key={j} celula={celula} opcoes={opcoes} />
      ))}
    </tr>
  )

  // O `div` de rolagem é obrigatório, não enfeite: metade das solicitações nasce
  // no celular (RNF-28) e tabela de documentação não cabe em 360px.
  return (
    <div className="doc-tabela-rolagem">
      <table className="doc-tabela">
        {cabecalho.length > 0 && <thead>{cabecalho.map(renderizarLinha)}</thead>}
        <tbody>{corpo.map(renderizarLinha)}</tbody>
      </table>
    </div>
  )
}

function Celula({ celula, opcoes }: { celula: CelulaTabela; opcoes: OpcoesRender }): ReactNode {
  const conteudo = renderizarNos(celula.filhos, opcoes)
  const span = {
    ...(celula.colunas > 1 ? { colSpan: celula.colunas } : {}),
    ...(celula.linhas > 1 ? { rowSpan: celula.linhas } : {}),
  }
  return celula.cabecalho ? (
    <th scope="col" {...span}>
      {conteudo}
    </th>
  ) : (
    <td {...span}>{conteudo}</td>
  )
}

/**
 * RF-43 — degradação **visível**.
 *
 * Macro que desaparece em silêncio faz o leitor decidir com informação faltando
 * **sem saber que falta**: ele lê a página, conclui que não tem a resposta e abre
 * chamado, quando a resposta estava no bloco que sumiu. Então o placeholder diz
 * três coisas: que falta algo, qual é o bloco, e que o resto do texto está inteiro.
 *
 * ⚠️ Só o **nome** da macro. Parâmetro (JQL, id de filtro, chave de espaço)
 * descreve estrutura interna e pode citar projeto que quem lê não deveria conhecer.
 */
/**
 * O que cada bloco do Confluence é, em português — `RF-43`, `RNF-30`, regra 4.
 *
 * ## Por que nomear em vez de imprimir o nome técnico
 *
 * A versão anterior mostrava `livesearch`, `listlabels`, `recently-updated` — nome de macro
 * do Confluence, que não diz nada a quem só quer resolver um problema. Três caixas cinzas
 * empilhadas com palavras em inglês fazem a página parecer quebrada, e quem acha que o app
 * está quebrado abre chamado: o oposto do que a tela existe para fazer.
 *
 * ## E por que a distinção entre os três tipos é a parte que importa
 *
 * ⚠️ A frase antiga dizia **"o resto do conteúdo está completo"** em cada caixa. Numa página
 * inicial de espaço — que é feita *só* desses blocos — ela afirmava o contrário da verdade e
 * ainda insinuava que havia texto sendo escondido por nós.
 *
 * Não há. Estes blocos são **gerados no momento da exibição**: o formato de armazenamento
 * guarda "aqui vai uma busca", nunca o resultado dela. É diferente de um bloco cujo texto
 * existe em outra página (`include`), e diferente de um bloco que simplesmente não
 * conhecemos. As três situações pedem três frases, porque levam a três ações diferentes de
 * quem lê.
 */
type NaturezaDoBloco = 'dinamico' | 'deOutraPagina' | 'jaNaTela' | 'desconhecido'

const BLOCOS_CONHECIDOS: Readonly<Record<string, { nome: string; natureza: NaturezaDoBloco }>> = {
  livesearch: { nome: 'Busca dentro deste espaço', natureza: 'dinamico' },
  listlabels: { nome: 'Etiquetas usadas neste espaço', natureza: 'dinamico' },
  'recently-updated': { nome: 'Páginas alteradas recentemente', natureza: 'dinamico' },
  'recently-updated-dashboard': { nome: 'Páginas alteradas recentemente', natureza: 'dinamico' },
  // ⚠️ Estes dois o app JÁ mostra: a leitura lista as páginas filhas no fim (T-115, `RF-41`),
  // com a verificação de restrição por item que `RN-06` exige. Dizer "não há o que trazer"
  // seria falso — o conteúdo está na tela, alguns centímetros abaixo.
  children: { nome: 'Lista das páginas filhas', natureza: 'jaNaTela' },
  pagetree: { nome: 'Árvore de páginas', natureza: 'jaNaTela' },
  contentbylabel: { nome: 'Páginas com uma etiqueta', natureza: 'dinamico' },
  detailssummary: { nome: 'Tabela montada a partir de outras páginas', natureza: 'dinamico' },
  'blog-posts': { nome: 'Últimas publicações', natureza: 'dinamico' },
  attachments: { nome: 'Lista de anexos da página', natureza: 'dinamico' },
  toc: { nome: 'Índice desta página', natureza: 'dinamico' },
  jira: { nome: 'Lista de chamados do Jira', natureza: 'dinamico' },
  jirachart: { nome: 'Gráfico de chamados do Jira', natureza: 'dinamico' },
  include: { nome: 'Trecho de outra página', natureza: 'deOutraPagina' },
  'excerpt-include': { nome: 'Trecho de outra página', natureza: 'deOutraPagina' },
  // `excerpt` tem o próprio corpo no storage, então o sanitizador já o renderiza. Fica aqui
  // só para o caso de corpo vazio, e aí "abra a origem" seria conselho errado: a origem é
  // esta página.
  excerpt: { nome: 'Trecho reaproveitado em outras páginas', natureza: 'jaNaTela' },
}

/**
 * ⚠️ **Tentei e descartei um aviso no topo do tipo "esta página é só um índice".**
 *
 * A página inicial padrão de espaço *parece* ser só blocos, mas tem texto: o placeholder do
 * próprio Confluence ("In a sentence or two, describe the purpose of this space"). Um
 * predicado honesto — "todos os nós são blocos?" — devolve `false` ali, então o aviso nunca
 * apareceria no caso real que o motivou. Fazê-lo aparecer exigiria adivinhar que aquele
 * parágrafo é placeholder: heurística sobre conteúdo de terceiro, que quebra na primeira
 * mudança de template e na primeira página em outro idioma.
 *
 * O que sobrou é o que resolve o problema de verdade: cada bloco dizer **o que é** e **por
 * que não há texto**. Página inicial vazia é lacuna de documentação, e quem mede isso é
 * `RF-42` (o mapa de lacunas), não uma frase adivinhada na hora da leitura.
 */
/**
 * O bloco `livesearch`, **funcionando** — `RF-37`, `RF-39`.
 *
 * ## Por que este bloco é diferente dos outros
 *
 * Os demais blocos dinâmicos são **resultados** que o Confluence calcula (lista de páginas
 * recentes, gráfico do Jira): para reproduzi-los teríamos de refazer a consulta e verificar
 * restrição de cada item, uma chamada por página (`R-02`, `RN-06`).
 *
 * `livesearch` não é resultado — é uma **caixa de busca**. E busca no espaço é exatamente
 * o que o goatlas já faz melhor que o Confluence para este público: sem assento, com a
 * allowlist aplicada no servidor, e registrando lacuna de documentação (`RF-42`). Aqui não
 * há nada a reproduzir: há um caminho nosso a oferecer.
 *
 * Sem `<form>` de verdade de propósito: submit dentro da SPA recarregaria a página e
 * perderia o estado da leitura. O botão chama a tela, que já sabe buscar.
 */
function BuscaDoEspaco({ aoBuscar }: { aoBuscar: (termo: string) => void }): ReactNode {
  const [termo, setTermo] = useState('')
  const podeBuscar = termo.trim().length >= 2
  return (
    <div className="doc-busca-espaco">
      <label className="doc-busca-rotulo" htmlFor="busca-neste-espaco">
        Buscar neste espaço
      </label>
      <div className="doc-busca-linha">
        <input
          id="busca-neste-espaco"
          type="search"
          value={termo}
          onChange={(e) => setTermo(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && podeBuscar) aoBuscar(termo.trim())
          }}
          placeholder="Ex.: reprocessar relatório"
        />
        <button
          type="button"
          className="botao botao-primario"
          disabled={!podeBuscar}
          onClick={() => aoBuscar(termo.trim())}
        >
          Buscar
        </button>
      </div>
      <span className="dica">
        Procura só nas páginas deste espaço que o goatlas pode mostrar.
      </span>
    </div>
  )
}

function MacroNaoSuportada({ nome }: { nome: string }): ReactNode {
  const conhecido = BLOCOS_CONHECIDOS[nome]
  const natureza: NaturezaDoBloco = conhecido?.natureza ?? 'desconhecido'
  return (
    <div className="doc-macro">
      <p className="doc-macro-rotulo">
        <span aria-hidden="true" className="doc-macro-marca">
          ⌗
        </span>
        {conhecido ? conhecido.nome : 'Bloco não exibido'}
      </p>
      <p className="doc-macro-texto">
        {natureza === 'dinamico' ? (
          <>
            Este bloco é montado pelo Confluence no momento em que a página abre — uma busca,
            uma lista ou um gráfico. A página não guarda texto dele, então não há o que trazer
            para cá.
          </>
        ) : natureza === 'deOutraPagina' ? (
          <>Este bloco mostra texto de outra página. Abra a página de origem para ler.</>
        ) : natureza === 'jaNaTela' ? (
          <>As páginas abaixo desta já aparecem listadas no fim da leitura.</>
        ) : (
          <>
            O goatlas ainda não sabe mostrar este bloco (
            <code className="doc-codigo-inline">{nome}</code>). O texto ao redor está completo.
          </>
        )}
      </p>
    </div>
  )
}

/**
 * Envelope da leitura: a coluna com a espinha lime.
 *
 * Separado de `renderizarNos` porque a rota de busca também renderiza trechos sem
 * envelope — o mesmo conteúdo, sem a moldura de "estou lendo uma página".
 */
export function ConteudoConfluence({
  nos,
  opcoes,
  truncado = false,
}: {
  nos: readonly No[]
  opcoes: OpcoesRender
  /** `true` quando a sanitização cortou a página por limite de tamanho. */
  truncado?: boolean
}): ReactNode {
  return (
    <article className="doc">
      {renderizarNos(nos, opcoes)}
      {truncado && (
        <p className="doc-truncado">
          Esta página é longa e foi cortada aqui. O começo está completo; o fim não
          aparece.
        </p>
      )}
    </article>
  )
}
