/**
 * Visualização rápida do anexo — spec 007, `FR-11`…`FR-13`.
 *
 * ## Duas superfícies, DUAS fontes (achado `F1` do `/analyze`)
 *
 * 🚨 Na tela do **chamado** o arquivo vem do proxy (`/api/chamados/:key/anexos/:nome`, com os
 * cabeçalhos de `D-11`/`D-62`). Na **conversa** não existe rota que o sirva: `urlDoAnexoNoApp`
 * exige `issueKey` + vínculo, e o chamado ainda não existe. Apontar para lá daria **404 em cima
 * do próprio print da pessoa** — o pior lugar possível para um link quebrado. Ali a fonte é o
 * `File` que **esta aba** acabou de anexar, por `URL.createObjectURL`.
 *
 * ⚠️ Isso **não** fura `RNF-02`: o blob é o arquivo que ela escolheu e nunca sai do navegador
 * dela. E é o único caminho possível — o servidor não guarda os bytes (`D-26`).
 *
 * ⚠️ **Consequência aceita:** recarregar a página perde o blob. O anexo continua no chamado, e
 * quem assume a exibição depois é a tela do chamado. Antes disso, sem blob, o item **não é
 * clicável** — nunca uma janela vazia (`FR-12`).
 *
 * ## Por que `<dialog>` nativo
 *
 * Ele já entrega o que `FR-13` pede e que uma `div` obrigaria a reimplementar: foco contido,
 * `Esc` fechando e camada acima do resto. Reescrever isso à mão é como se perde o teclado —
 * e a conversa continua atrás, viva (`D-21`: navegar para fora destruiria o botão de override).
 *
 * _Requirements: FR-11, FR-12, FR-13, RNF-02, RNF-28_
 */

import { useEffect, useRef, type ReactElement } from 'react'

/** O que dá para mostrar aqui dentro. `baixar` é o resto — e ele é dito, não escondido. */
export type FormaDeExibir = 'imagem' | 'pdf' | 'texto' | 'baixar'

/**
 * Como exibir, decidido pelo tipo — **nunca** pela extensão do nome.
 *
 * ⚠️ A allowlist é a **mesma** ideia de `decidirEntrega` (`D-11`), e por isso `image/svg+xml`
 * fica fora: SVG é documento XML com script, e aqui ele seria renderizado no nosso domínio.
 * Markdown é **texto cru**, nunca HTML renderizado (`D-62`).
 */
export function formaDeExibir(tipo: string | null): FormaDeExibir {
  const base = (tipo ?? '').split(';')[0]?.trim().toLowerCase() ?? ''
  if (['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif', 'image/bmp'].includes(base)) {
    return 'imagem'
  }
  if (base === 'application/pdf') return 'pdf'
  if (['text/plain', 'text/markdown', 'text/csv'].includes(base)) return 'texto'
  return 'baixar'
}

/** A frase de `FR-12`: nunca uma janela vazia, sempre um caminho. */
export const AVISO_NAO_EXIBIVEL =
  'Este tipo de arquivo não é exibido aqui. Baixe para abrir no seu computador.'

export interface AnexoParaVer {
  readonly nome: string
  readonly tipo: string | null
  /** URL de onde buscar: o proxy (chamado) ou um `blob:` (conversa). */
  readonly url: string
  /** `true` quando a URL é `blob:` — o download precisa do atributo, não do servidor. */
  readonly local?: boolean
}

export function Visualizador({
  anexo,
  aoFechar,
}: {
  anexo: AnexoParaVer | null
  aoFechar: () => void
}): ReactElement | null {
  const caixa = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const el = caixa.current
    if (!el) return
    if (anexo && !el.open) el.showModal()
    if (!anexo && el.open) el.close()
  }, [anexo])

  if (!anexo) return null
  const forma = formaDeExibir(anexo.tipo)

  return (
    <dialog
      ref={caixa}
      className="visualizador"
      // `Esc` e o clique no fundo levam ao mesmo lugar. Sem `onCancel`, o `Esc` fecharia o
      // `dialog` e o React continuaria achando que ele está aberto.
      onCancel={(e) => {
        e.preventDefault()
        aoFechar()
      }}
      onClick={(e) => {
        if (e.target === caixa.current) aoFechar()
      }}
      aria-label={`Arquivo ${anexo.nome}`}
    >
      <div className="visualizador-topo">
        <strong className="visualizador-nome">{anexo.nome}</strong>
        <div className="acoes">
          {/* O download continua disponível nos dois casos. No blob ele precisa do atributo:
              não há servidor para decidir `Content-Disposition`. */}
          <a
            className="botao botao-contorno"
            href={anexo.url}
            {...(anexo.local ? { download: anexo.nome } : { target: '_blank', rel: 'noopener noreferrer' })}
          >
            Baixar
          </a>
          <button type="button" className="botao botao-primario" onClick={aoFechar}>
            Fechar
          </button>
        </div>
      </div>

      <div className="visualizador-corpo">
        {forma === 'imagem' && <img src={anexo.url} alt={`Conteúdo de ${anexo.nome}`} />}
        {forma === 'pdf' && (
          // O `Content-Security-Policy: sandbox` da resposta continua valendo dentro do
          // iframe, e é ele que torna isto seguro (`D-11`).
          <iframe src={anexo.url} title={`Conteúdo de ${anexo.nome}`} />
        )}
        {forma === 'texto' && <TextoDoArquivo url={anexo.url} />}
        {forma === 'baixar' && <p className="dica">{AVISO_NAO_EXIBIVEL}</p>}
      </div>
    </dialog>
  )
}

/**
 * Texto do arquivo, buscado e mostrado **cru**.
 *
 * ⚠️ `<pre>`, nunca markdown renderizado: renderizar HTML de um arquivo que a pessoa anexou é
 * exatamente o que `D-11`/`D-62` mantêm fechado. E os três estados aparecem — carregando,
 * pronto e falhou —, porque "vazio" e "não deu para buscar" são frases opostas.
 */
function TextoDoArquivo({ url }: { url: string }): ReactElement {
  const estado = useRef<HTMLPreElement>(null)
  useEffect(() => {
    let vivo = true
    const alvo = estado.current
    if (alvo) alvo.textContent = 'Carregando…'
    void fetch(url)
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
      .then((texto) => {
        if (vivo && estado.current) estado.current.textContent = texto || '(arquivo vazio)'
      })
      .catch(() => {
        if (vivo && estado.current) {
          estado.current.textContent = 'Não consegui abrir o conteúdo agora. Tente baixar.'
        }
      })
    return () => {
      vivo = false
    }
  }, [url])
  return <pre className="visualizador-texto" ref={estado} />
}
