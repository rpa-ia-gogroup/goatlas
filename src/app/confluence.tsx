/**
 * Busca e leitura de documentação — **T-114**, `RF-37`, `RF-39`, `RNF-28`.
 *
 * ## A ideia da tela
 *
 * Esta é a superfície que justifica o app existir para quem **não tem assento
 * Atlassian**: ler o processo sem abrir chamado, e sem bater numa tela de login da
 * Atlassian. Por isso ela é a **segunda aba**, logo depois do agente e antes de
 * "Meus chamados": a ordem das abas é a ordem que o produto recomenda.
 *
 * ## Direção visual
 *
 * A leitura já tem identidade desde T-106: o conteúdo é **citação**, com a espinha
 * lime à esquerda (`.doc`). Aqui a decisão é **estender essa espinha para trás**: cada
 * resultado de busca ganha a mesma espinha lime ao receber foco ou mouse, porque um
 * resultado é a prévia de um documento citado. A marca é aprendida uma vez e vale nos
 * dois lugares — em vez de inventar um segundo vocabulário para "isto vem do
 * Confluence".
 *
 * O `score` **não** aparece. Ele é o insumo da Regra 1 (`RF-09`), não informação que a
 * pessoa possa usar: "0,91" na tela é número decorativo, e decoração que finge ser
 * dado é pior que nada.
 *
 * ## Os três vazios são três telas diferentes
 *
 * Não buscou ainda · não há espaço configurado · não achou nada. O segundo é problema
 * do time de tech, o terceiro é lacuna de documentação (`RF-42`) — e dizer "nada
 * encontrado" nos três casos faria a pessoa procurar de novo com outras palavras para
 * sempre.
 *
 * _Requirements: RF-37, RF-39, RF-40, RF-42, RNF-28, RNF-02_
 */

import { useEffect, useState, type FormEvent } from 'react'
import {
  api,
  ErroApi,
  type Ancestral,
  type EspacoNavegavel,
  type NivelDaArvore,
  type PaginaLida,
  type RespostaBusca,
} from './api'
import { Aviso, Vazio } from './componentes'
import { ConteudoConfluence } from '../lib/confluence/renderizar'

/* ---------------------------------------------------------------------- */
/* Opções de render — RNF-02 e RF-40 na prática                           */
/* ---------------------------------------------------------------------- */

/**
 * Como a árvore vira links e imagens.
 *
 * **Imagem passa pelo proxy do app** (`RNF-02`): o navegador não tem credencial da
 * Atlassian e nunca fala com ela. A rota carrega o **id da página**, porque é ele que
 * amarra o anexo à página cuja exposição foi verificada (`RN-06`).
 *
 * **Link para outra página do Confluence vira busca pelo título.** O storage format dá
 * título e espaço, não id — e a rota de leitura pede id. Até T-115 (árvore do espaço),
 * cair na busca com o título preenchido é o comportamento honesto: leva a pessoa ao
 * documento em um clique a mais, em vez de fingir um link quebrado.
 */
export function opcoesDeRender(
  idPagina: string,
  /**
   * Presente só na LEITURA de página: é o que transforma o bloco `livesearch` numa busca
   * de verdade. Nos trechos de resultado de busca ele não existe — ali não há espaço
   * corrente nem para onde ir, e o bloco volta a ser a explicação honesta.
   */
  aoBuscarNoEspaco?: (termo: string) => void,
) {
  return {
    urlDeAnexo: (nomeArquivo: string) =>
      `/api/confluence/anexo/${encodeURIComponent(idPagina)}/${encodeURIComponent(nomeArquivo)}`,
    urlDePagina: (titulo: string) => `/?q=${encodeURIComponent(titulo)}`,
    ...(aoBuscarNoEspaco ? { aoBuscarNoEspaco } : {}),
  }
}

/* ---------------------------------------------------------------------- */
/* Partes puras — recebem dados, não buscam                               */
/* ---------------------------------------------------------------------- */

export function ResultadosDaBusca({
  resposta,
  aoAbrir,
  aoConversar,
}: {
  resposta: RespostaBusca
  aoAbrir: (id: string) => void
  aoConversar: () => void
}) {
  if (!resposta.buscaConfigurada) {
    // Não é "nada encontrado": é configuração. Dizer de quem é o problema evita que a
    // pessoa fique reescrevendo o termo achando que a culpa é dela.
    return (
      <Aviso atencao>
        A busca ainda não foi liberada para nenhum espaço do Confluence. Fale com o time
        de tech — é uma configuração pendente, não um problema no seu termo.
      </Aviso>
    )
  }

  if (resposta.itens.length === 0) {
    return (
      <Vazio
        titulo={`Nada encontrado para “${resposta.termo}”`}
        texto="Registramos esse termo como lacuna de documentação. Se você precisa disso hoje, fale com o agente — ele investiga e abre o chamado quando fizer sentido."
        acao={
          <button type="button" className="botao botao-primario" onClick={aoConversar}>
            Falar com o agente
          </button>
        }
      />
    )
  }

  return (
    <div className="pilha">
      <p className="contagem-resultados" role="status">
        {resposta.itens.length === 1
          ? `1 página para “${resposta.termo}”`
          : `${resposta.itens.length} páginas para “${resposta.termo}”`}
      </p>
      <ul className="resultados">
        {resposta.itens.map((r) => (
          <li key={r.id}>
            <button type="button" className="resultado" onClick={() => aoAbrir(r.id)}>
              <span className="resultado-espaco">{r.espaco}</span>
              <span className="resultado-titulo">{r.titulo}</span>
              {r.trecho !== '' && <span className="resultado-trecho">{r.trecho}</span>}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * Breadcrumb — `RF-41`.
 *
 * ⚠️ O caminho vem do servidor **já cortado** no primeiro ancestral não exposto
 * (`RN-06`), então ele pode ser curto ou vazio. A tela **não** inventa reticências
 * nem "…": um marcador de nível oculto contaria que existe algo escondido ali, que é
 * a informação que o corte existe para não dar. Sem caminho, não há caminho.
 */
export function Breadcrumb({
  espaco,
  ancestrais,
  aoAbrir,
}: {
  espaco: string
  ancestrais: readonly Ancestral[]
  aoAbrir: (id: string) => void
}) {
  if (ancestrais.length === 0) return null
  return (
    <nav className="breadcrumb" aria-label={`Caminho no espaço ${espaco}`}>
      <ol>
        {ancestrais.map((a) => (
          <li key={a.id}>
            <button type="button" className="breadcrumb-item" onClick={() => aoAbrir(a.id)}>
              {a.titulo}
            </button>
          </li>
        ))}
      </ol>
    </nav>
  )
}

/** Um nível da árvore: as páginas dentro da que está aberta (`RF-41`). */
export function FilhosDaPagina({
  nivel,
  aoAbrir,
}: {
  nivel: NivelDaArvore
  aoAbrir: (id: string) => void
}) {
  if (nivel.itens.length === 0) return null
  return (
    <section className="pilha secao-filhos">
      <h2 className="titulo-filhos">Dentro desta página</h2>
      <ul className="resultados">
        {nivel.itens.map((f) => (
          <li key={f.id}>
            <button type="button" className="resultado" onClick={() => aoAbrir(f.id)}>
              <span className="resultado-titulo">{f.titulo}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

/**
 * Porta de entrada da árvore (`RF-41`) — aparece no estado inicial, antes de qualquer
 * busca. Quem não sabe o que procurar navega; quem sabe, busca.
 */
/**
 * Os três estados da lista de espaços — e são **três**, não dois.
 *
 * ⚠️ `espacos` nascia `[]`, e `[]` significava as duas coisas ao mesmo tempo: "ainda estou
 * buscando" e "não há espaço configurado". Como o componente devolvia `null` nesse caso, a
 * tela ficava **em branco durante o carregamento** — sem título, sem sinal, sem nada: ninguém
 * percebia que havia algo a caminho. É o mesmo erro que `admin/paineis.tsx` já registra
 * ("'não carregou' é diferente de 'não tem dado'"), aqui na aba que mais gente abre.
 *
 * O terceiro estado (`falhou`) existe pelo mesmo motivo de lá: guardar `[]` numa falha de
 * rede transformaria queda em "não tem documentação", que manda a pessoa abrir chamado por
 * algo que está escrito.
 */
export type CargaEspacos =
  | { readonly estado: 'carregando' }
  | { readonly estado: 'pronto'; readonly itens: readonly EspacoNavegavel[] }
  | { readonly estado: 'falhou' }

export function EspacosNavegaveis({
  carga,
  aoAbrir,
}: {
  carga: CargaEspacos
  aoAbrir: (id: string) => void
}) {
  return (
    <section className="pilha secao-filhos">
      {/* O título aparece SEMPRE, inclusive carregando: é ele que diz que existe uma lista
          a caminho. Sem ele, o estado de carregamento é indistinguível de tela vazia. */}
      <h2 className="titulo-filhos">Ou navegue pela documentação</h2>

      {carga.estado === 'carregando' && (
        <p className="carregando" aria-live="polite">
          Carregando os espaços da documentação…
        </p>
      )}

      {carga.estado === 'falhou' && (
        <p className="dica" role="status">
          Não conseguimos carregar os espaços agora. A busca continua funcionando — e
          recarregar a página tenta de novo.
        </p>
      )}

      {carga.estado === 'pronto' && carga.itens.length === 0 && (
        // Zero por CONFIGURAÇÃO, e a frase diz isso em vez de sugerir que a empresa não tem
        // documentação — mesmo raciocínio de `buscaConfigurada`.
        <p className="dica">
          Nenhum espaço foi liberado nesta instalação ainda. Fale com o time de tech.
        </p>
      )}

      {carga.estado === 'pronto' && carga.itens.length > 0 && (
        <ul className="resultados">
          {carga.itens.map((e) => (
            <li key={e.chave}>
              <button type="button" className="resultado" onClick={() => aoAbrir(e.homepageId)}>
                <span className="resultado-espaco">{e.chave}</span>
                <span className="resultado-titulo">{e.nome}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export function LeituraDaPagina({
  pagina,
  filhos,
  aoAbrir,
  aoVoltar,
  veioDeBusca = false,
  aoBuscarNoEspaco,
}: {
  pagina: PaginaLida
  /** Nível abaixo desta página, quando já carregado (`RF-41`). */
  filhos?: NivelDaArvore | null
  aoAbrir: (id: string) => void
  aoVoltar: () => void
  /**
   * `true` quando existe uma busca para onde voltar. Quem chegou pela lista de espaços não
   * veio de busca nenhuma, e "voltar para a busca" mandaria para uma tela que ela nunca viu.
   */
  veioDeBusca?: boolean
  /**
   * Busca escopada no espaço desta página — é o que faz o bloco `livesearch` do Confluence
   * funcionar em vez de virar placeholder. O espaço sai de `pagina.espaco`, que veio do
   * servidor por um caminho já verificado (`RN-06`), nunca do parâmetro da macro.
   */
  aoBuscarNoEspaco?: (termo: string, espaco: string) => void
}) {
  return (
    <div className="pilha">
      <button type="button" className="botao botao-discreto" onClick={aoVoltar}>
        {veioDeBusca ? '← Voltar para os resultados' : '← Voltar para a documentação'}
      </button>

      <header className="pilha">
        <span className="eyebrow">{pagina.espaco}</span>
        <Breadcrumb espaco={pagina.espaco} ancestrais={pagina.ancestrais} aoAbrir={aoAbrir} />
        <h1 className="titulo-secao">{pagina.titulo}</h1>
        <p className="pagina-meta">
          {formatarData(pagina.atualizadoEm)}
          {/*
            O link existe porque parte do time TEM assento — mas o rótulo diz o que
            acontece, porque para a maioria ele leva a uma tela de login. Rótulo que
            esconde isso transforma o link numa pequena traição.
          */}
          {pagina.urlOriginal !== '' && (
            <>
              {' · '}
              <a
                className="doc-link"
                href={pagina.urlOriginal}
                target="_blank"
                rel="noopener noreferrer"
              >
                Ver no Confluence (precisa de conta Atlassian)
              </a>
            </>
          )}
        </p>
      </header>

      {/* A árvore chega sanitizada do servidor, e o renderizador revalida cada URL. */}
      <ConteudoConfluence
        nos={pagina.nos}
        truncado={pagina.truncado}
        opcoes={opcoesDeRender(
          pagina.id,
          aoBuscarNoEspaco
            ? (termo: string) => aoBuscarNoEspaco(termo, pagina.espaco)
            : undefined,
        )}
      />

      {filhos && <FilhosDaPagina nivel={filhos} aoAbrir={aoAbrir} />}
    </div>
  )
}

/**
 * Data em PT-BR, e **só quando existe**.
 *
 * O fake devolve a época Unix; mostrar "01/01/1970" faria a pessoa duvidar do
 * conteúdo inteiro por causa de um metadado. Sem data confiável, a linha some.
 */
function formatarData(iso: string): string {
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms) || ms <= 0) return 'Página do Confluence'
  return `Atualizada em ${new Date(ms).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  })}`
}

/* ---------------------------------------------------------------------- */
/* Contêiner                                                              */
/* ---------------------------------------------------------------------- */

export interface EntradaDocumentacao {
  /** Termo vindo da URL (`?q=`) — é assim que link entre páginas do Confluence chega. */
  readonly termo?: string
  /** Id vindo da URL (`?pagina=`), para a leitura ser compartilhável por link. */
  readonly pagina?: string
}

/**
 * Qual das três visões a aba mostra — **derivada**, nunca guardada.
 *
 * ## O bug que isto conserta, e por que ele era de desenho
 *
 * A tela decidia por `busca !== null`, e apagar o campo mexia só em `termo`. Resultado
 * medido no app real em 10/08/2026: a pessoa buscava, os resultados apareciam, ela **limpava
 * o campo esperando voltar** — e a lista antiga continuava travada na tela, sem caminho de
 * volta para as categorias. Ficava presa num resultado ("Arquitetura de Pipelines") sem
 * conseguir navegar para outro espaço.
 *
 * Consertar imperativamente (um `setBusca(null)` no `onChange`) funcionaria hoje e voltaria
 * a quebrar no próximo lugar que mexer em `termo` sem lembrar de limpar o resto — é o mesmo
 * raciocínio de `bloqueio` × `temBloqueioPendente` (`D-21`): estado derivado não desincroniza,
 * estado copiado desincroniza.
 *
 * ## A ordem das três regras é o comportamento
 *
 * 1. **Página aberta ganha de tudo.** Quem chegou lendo (por link, por categoria ou por
 *    resultado) continua lendo — a leitura tem o próprio botão de voltar.
 * 2. **Campo vazio = começar de novo.** É o que a pessoa quer dizer ao apagar o texto, e a
 *    única leitura que não deixa resultado velho preso.
 * 3. Com termo e resposta, resultados.
 */
export function visaoDaDocumentacao(estado: {
  readonly termo: string
  readonly busca: unknown | null
  readonly pagina: unknown | null
}): 'leitura' | 'resultados' | 'categorias' {
  if (estado.pagina !== null) return 'leitura'
  if (estado.termo.trim() === '') return 'categorias'
  return estado.busca !== null ? 'resultados' : 'categorias'
}

export function TelaDocumentacao({
  inicial,
  aoConversar,
}: {
  inicial: EntradaDocumentacao
  aoConversar: () => void
}) {
  const [termo, setTermo] = useState(inicial.termo ?? '')
  const [busca, setBusca] = useState<RespostaBusca | null>(null)
  const [pagina, setPagina] = useState<PaginaLida | null>(null)
  const [filhos, setFilhos] = useState<NivelDaArvore | null>(null)
  const [espacos, setEspacos] = useState<CargaEspacos>({ estado: 'carregando' })
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  async function buscar(alvo: string, espaco?: string) {
    const limpo = alvo.trim()
    if (limpo.length < 2) {
      setErro('Escreva ao menos duas letras do que você procura.')
      return
    }
    setCarregando(true)
    setErro(null)
    setPagina(null)
    try {
      setBusca(await api.buscarDocumentacao(limpo, espaco))
      // ⚠️ A URL guarda só o termo, não o espaço: `?q=` é contrato com `entradaDaUrl` e com
      // o link `ri:page` do Confluence (ver `CLAUDE.md`). Acrescentar `?espaco=` aqui
      // exigiria os dois lados combinando — e o ganho seria um link que busca em um espaço,
      // que não é caso de uso de ninguém. O escopo vale para a busca que acabou de rodar.
      lembrarNaUrl({ q: limpo })
    } catch (e) {
      setBusca(null)
      setErro(mensagemDe(e, 'Não conseguimos buscar agora.'))
    } finally {
      setCarregando(false)
    }
  }

  async function abrir(id: string, deBusca?: string | null) {
    setCarregando(true)
    setErro(null)
    setFilhos(null)
    try {
      const lida = await api.lerPagina(id, deBusca ?? null)
      setPagina(lida)
      lembrarNaUrl({ pagina: id })
      // O nível abaixo vem em requisição separada, DEPOIS de a leitura aparecer: a
      // página é o que a pessoa pediu, e a árvore não deve atrasá-la. Falhar aqui não
      // é erro de tela — só não há navegação para mostrar.
      try {
        setFilhos(await api.arvore(lida.espaco, lida.id))
      } catch {
        setFilhos(null)
      }
    } catch (e) {
      setPagina(null)
      // ⚠️ A mensagem NÃO distingue os motivos de recusa (`D-12`): "não está liberada"
      // e "não existe" chegam iguais do servidor, de propósito, e a tela mantém isso.
      setErro(
        mensagemDe(
          e,
          'Não encontramos essa página. Ela pode ter sido movida, ou não estar liberada para leitura por aqui.',
        ),
      )
    } finally {
      setCarregando(false)
    }
  }

  // Abre o que a URL pediu: `?pagina=` tem precedência, `?q=` já busca de entrada.
  useEffect(() => {
    if (inicial.pagina) void abrir(inicial.pagina)
    else if (inicial.termo) void buscar(inicial.termo)
    // Os espaços navegáveis não bloqueiam nada: se falharem, resta a busca.
    api
      .espacos()
      .then((r) => setEspacos({ estado: 'pronto', itens: r.itens }))
      .catch(() => setEspacos({ estado: 'falhou' }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function enviar(e: FormEvent) {
    e.preventDefault()
    void buscar(termo)
  }

  const visao = visaoDaDocumentacao({ termo, busca, pagina })

  return (
    <div className="pilha">
      {visao === 'leitura' && pagina ? (
        <LeituraDaPagina
          pagina={pagina}
          filhos={filhos}
          aoAbrir={abrir}
          aoBuscarNoEspaco={(t, espaco) => {
            setTermo(t)
            void buscar(t, espaco)
          }}
          veioDeBusca={busca !== null && termo.trim() !== ''}
          aoVoltar={() => {
            setPagina(null)
            lembrarNaUrl(termo.trim() ? { q: termo.trim() } : {})
          }}
        />
      ) : (
        <>
          <header className="pilha">
            <span className="eyebrow">Confluence, sem precisar de conta</span>
            <h1 className="titulo-secao">Documentação</h1>
          </header>

          <form className="busca-form" onSubmit={enviar}>
            <div className="campo">
              <label htmlFor="busca-termo">O que você procura?</label>
              <input
                id="busca-termo"
                type="search"
                value={termo}
                onChange={(ev) => {
                  setTermo(ev.target.value)
                  // Apagar o campo é "quero começar de novo": a visão já volta para as
                  // categorias por derivação, e a URL acompanha — senão recarregar
                  // ressuscitaria a busca que a pessoa acabou de descartar.
                  if (ev.target.value.trim() === '') {
                    setErro(null)
                    lembrarNaUrl({})
                  }
                }}
                placeholder="reprocessar relatório de vendas"
                autoComplete="off"
                enterKeyHint="search"
              />
            </div>
            <button type="submit" className="botao botao-primario" disabled={carregando}>
              {carregando ? 'Buscando…' : 'Buscar'}
            </button>
          </form>

          {erro && <Aviso atencao>{erro}</Aviso>}
          {carregando && <p className="carregando">Procurando na documentação…</p>}

          {!carregando && !erro && visao === 'categorias' && (
            <>
              <Vazio
                titulo="Procure antes de abrir chamado"
                texto="Busque por um processo, uma mensagem de erro ou o nome de um sistema. A resposta pode já estar documentada — e você lê aqui, sem conta da Atlassian."
              />
              <EspacosNavegaveis carga={espacos} aoAbrir={abrir} />
            </>
          )}

          {!carregando && visao === 'resultados' && busca !== null && (
            <ResultadosDaBusca
              resposta={busca}
              // O id da busca viaja com o clique: é o que transforma "ninguém abriu"
              // em sinal de lacuna (`RF-42`), em vez de silêncio.
              aoAbrir={(id) => void abrir(id, busca.buscaId)}
              aoConversar={aoConversar}
            />
          )}
        </>
      )}

      {pagina && erro && <Aviso atencao>{erro}</Aviso>}
      {!pagina && carregando && inicial.pagina && (
        <p className="carregando">Abrindo a página…</p>
      )}
    </div>
  )
}

function mensagemDe(erro: unknown, padrao: string): string {
  return erro instanceof ErroApi ? erro.message : padrao
}

/**
 * Reflete o estado na URL — **sem instalar router**.
 *
 * `App.tsx` navega por estado de propósito (Princípio V). O que existe aqui é só
 * *deep link*: `?q=` e `?pagina=` são lidos no boot e reescritos com
 * `replaceState`, o que dá duas coisas concretas — link de página compartilhável
 * entre colegas, e o link `ri:page` do próprio Confluence funcionando. Um router de
 * verdade entra com T-115, quando houver árvore e breadcrumb para navegar.
 */
function lembrarNaUrl(params: { q?: string; pagina?: string }): void {
  if (typeof window === 'undefined' || !window.history?.replaceState) return
  const url = new URL(window.location.href)
  url.searchParams.delete('q')
  url.searchParams.delete('pagina')
  if (params.pagina) url.searchParams.set('pagina', params.pagina)
  else if (params.q) url.searchParams.set('q', params.q)
  window.history.replaceState(null, '', url.toString())
}

/** Lê a entrada da URL uma vez, no boot. */
export function entradaDaUrl(busca: string): EntradaDocumentacao {
  const params = new URLSearchParams(busca)
  const pagina = params.get('pagina')?.trim()
  const termo = params.get('q')?.trim()
  return {
    ...(pagina ? { pagina } : {}),
    ...(termo ? { termo } : {}),
  }
}
