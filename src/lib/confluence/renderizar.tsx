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

import type { ReactNode } from 'react'
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

    case 'macroNaoSuportada':
      return <MacroNaoSuportada nome={no.nome} />
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
function MacroNaoSuportada({ nome }: { nome: string }): ReactNode {
  return (
    <div className="doc-macro">
      <p className="doc-macro-rotulo">
        <span aria-hidden="true" className="doc-macro-marca">
          ⌗
        </span>
        Bloco não exibido
      </p>
      <p className="doc-macro-texto">
        Esta página tem um bloco <code className="doc-codigo-inline">{nome}</code> que o goatlas
        ainda não sabe mostrar. O resto do conteúdo está completo.
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
