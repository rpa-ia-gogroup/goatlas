/**
 * Componentes compartilhados.
 *
 * A **trilha de verificação** é o elemento-assinatura: o motivo dos três círculos
 * da marca (§4.5 do documento de identidade), que por lá é decorativo, aqui carrega
 * informação. Os três passos são a sequência que RF-08 impõe — documentação →
 * histórico → chamado —, então a ordem numerada é honesta, não enfeite.
 *
 * ⚠️ Estado nunca comunicado só por cor: cada passo tem ícone, rótulo e texto para
 * leitor de tela.
 */

import type { ReactNode } from 'react'
import type { EstadoVerificacao, Prioridade } from './api'
import { prioridadePor } from './api'

/* ---------- trilha de verificação (assinatura) -------------------------- */

export type EstadoChamadoTrilha = 'pendente' | 'ok'

export interface TrilhaProps {
  readonly confluence: EstadoVerificacao
  readonly historico: EstadoVerificacao
  readonly chamado: EstadoChamadoTrilha
  /** `true` enquanto o agente está processando o turno. */
  readonly emAndamento?: boolean
}

const MARCA: Record<EstadoVerificacao | 'fazendo', string> = {
  ok: '✓',
  falhou: '!',
  pendente: '',
  fazendo: '',
}

const DESCRICAO: Record<EstadoVerificacao, string> = {
  pendente: 'ainda não verificado',
  ok: 'verificado',
  falhou: 'não foi possível verificar',
}

function Passo({
  ordem,
  rotulo,
  estado,
  fazendo,
}: {
  ordem: number
  rotulo: string
  estado: EstadoVerificacao
  fazendo: boolean
}) {
  const dataEstado = fazendo && estado === 'pendente' ? 'fazendo' : estado
  return (
    <li className="trilha-passo" data-estado={dataEstado}>
      <span className="trilha-marca" aria-hidden="true">
        {MARCA[dataEstado] || ordem}
      </span>
      <span className="trilha-rotulo">{rotulo}</span>
      <span className="sr-apenas">
        Passo {ordem}, {rotulo}: {DESCRICAO[estado]}.
      </span>
    </li>
  )
}

export function TrilhaVerificacao({ confluence, historico, chamado, emAndamento = false }: TrilhaProps) {
  return (
    <ol
      className="trilha"
      aria-label="Progresso da investigação antes de abrir o chamado"
      aria-live="polite"
    >
      <Passo ordem={1} rotulo="Documentação" estado={confluence} fazendo={emAndamento} />
      <Passo ordem={2} rotulo="Histórico" estado={historico} fazendo={emAndamento} />
      <Passo
        ordem={3}
        rotulo="Chamado"
        estado={chamado === 'ok' ? 'ok' : 'pendente'}
        fazendo={false}
      />
    </ol>
  )
}

/* ---------- selos ------------------------------------------------------- */

export function Selo({
  children,
  variante = 'neutro',
}: {
  children: ReactNode
  variante?: 'neutro' | 'lime' | 'contorno'
}) {
  const classe =
    variante === 'lime' ? 'selo selo-lime' : variante === 'contorno' ? 'selo selo-contorno' : 'selo'
  return <span className={classe}>{children}</span>
}

/** Selo de prioridade com o prazo de PRIMEIRA RESPOSTA junto (RN-08). */
export function SeloPrioridade({ prioridade }: { prioridade: Prioridade | null }) {
  if (!prioridade) return <Selo variante="contorno">Prioridade a definir</Selo>
  const p = prioridadePor(prioridade)
  return (
    <Selo variante={prioridade === 'critica' ? 'lime' : 'neutro'}>
      {p.rotulo} · 1ª resposta em {p.horas}h
    </Selo>
  )
}

/**
 * Selo do recibo de verificação — o dado `verificadoRegras` visível.
 *
 * Não é ornamento: um chamado aberto sem as regras terem rodado (tool fora do ar,
 * ou pelo formulário sem IA) precisa ser reconhecível, senão o caminho de
 * degradação vira fuga invisível da deflexão.
 */
export function SeloVerificacao({
  verificado,
  via,
}: {
  verificado: boolean
  via: 'conversa' | 'formulario'
}) {
  if (verificado) return <Selo variante="lime">✓ Verificado antes de abrir</Selo>
  return (
    <Selo variante="contorno">
      {via === 'formulario' ? 'Aberto pelo formulário' : 'Aberto sem verificação'}
    </Selo>
  )
}

/* ---------- avisos ----------------------------------------------------- */

export function Aviso({
  children,
  atencao = false,
}: {
  children: ReactNode
  atencao?: boolean
}) {
  return (
    <p className={atencao ? 'aviso aviso-atencao' : 'aviso'} role={atencao ? 'alert' : undefined}>
      {children}
    </p>
  )
}

/** Estado vazio como convite para agir. */
export function Vazio({
  titulo,
  texto,
  acao,
}: {
  titulo: string
  texto: string
  acao?: ReactNode
}) {
  return (
    <div className="vazio">
      <span className="selo-g" aria-hidden="true">
        g
      </span>
      <h2>{titulo}</h2>
      <p>{texto}</p>
      {acao}
    </div>
  )
}

/* ---------- markdown mínimo do agente ---------------------------------- */

/**
 * Renderiza o mínimo de markdown que os prompts produzem: `**negrito**`,
 * `[texto](url)` e listas com `- `.
 *
 * ⚠️ **Não usa `dangerouslySetInnerHTML`.** O texto do agente pode conter trecho de
 * página do Confluence, que é editável por qualquer pessoa da empresa — injetar HTML
 * aí seria XSS armazenado (RNF-06). Aqui tudo vira nó de React, e link só é criado
 * quando a URL aponta para `http(s)` **ou** casa com a rota de leitura do app.
 */
export function TextoDoAgente({ texto }: { texto: string }) {
  const linhas = texto.split('\n')
  return (
    <div className="fala-agente">
      {linhas.map((linha, i) => {
        const item = linha.match(/^\s*[-*]\s+(.*)$/)
        if (item) {
          return (
            <p key={i} style={{ paddingLeft: '1rem' }}>
              • {formatarInline(item[1] ?? '')}
            </p>
          )
        }
        if (linha.trim() === '') return <br key={i} />
        return <p key={i}>{formatarInline(linha)}</p>
      })}
    </div>
  )
}

/**
 * A ÚNICA forma de caminho interno que vira link — `T-118`.
 *
 * ⚠️ É allowlist de **forma**, não "começa com barra". Este texto carrega saída do
 * modelo, que pode repetir conteúdo de página do Confluence editável por qualquer
 * pessoa (`R-07`): aceitar qualquer caminho deixaria o modelo (ou a página) escolher
 * para onde o app manda um colega clicar. O id é aceito percent-encoded porque é
 * assim que `urlDeLeituraNoApp` o escreve.
 */
/**
 * ⚠️ **O caminho entrou aqui junto com `rotas.ts`, e esquecer isto teria sido silencioso.**
 * `urlDeLeituraNoApp` passou a escrever `/documentacao?pagina=…`; com o padrão preso a
 * `/?pagina=…`, o link da deflexão continuaria **aparecendo** na conversa e deixaria de ser
 * clicável — a mensagem inteira de `RF-12` intacta, e o clique morrendo. Terceira camada do
 * mesmo contrato, ao lado de `urlDeLeituraNoApp` e `entradaDaUrl`.
 */
const ROTA_DE_LEITURA = /^\/documentacao\?pagina=(?:[A-Za-z0-9_.~-]|%[0-9A-Fa-f]{2})+$/

function formatarInline(texto: string): ReactNode[] {
  const nós: ReactNode[] = []
  // Um passo só: link ou negrito, na ordem em que aparecerem.
  const padrao = /\[([^\]]+)\]\(([^)]+)\)|\*\*([^*]+)\*\*/g
  let ultimo = 0
  let m: RegExpExecArray | null
  let chave = 0

  while ((m = padrao.exec(texto)) !== null) {
    if (m.index > ultimo) nós.push(texto.slice(ultimo, m.index))
    if (m[1] && m[2]) {
      const url = m[2]
      // A deflexão da Regra 1 aponta para a leitura DENTRO do app (T-118).
      //
      // ⚠️ **Em outra aba, de propósito.** A conversa vive em estado de React: navegar
      // na mesma aba a destrói, e com ela vai o botão "isso não resolve meu caso" —
      // ou seja, a pessoa perderia justamente o caminho de override (RF-13) ao aceitar
      // o convite de ler primeiro. Ler ao lado e voltar para a conversa intacta é o
      // comportamento que a deflexão precisa.
      if (ROTA_DE_LEITURA.test(url)) {
        nós.push(
          <a key={chave++} href={url} target="_blank" rel="noopener">
            {m[1]}
          </a>,
        )
      } else if (/^https?:\/\//i.test(url)) {
        // Só http(s). `javascript:` e afins não viram link.
        nós.push(
          <a key={chave++} href={url} target="_blank" rel="noopener noreferrer">
            {m[1]}
          </a>,
        )
      } else {
        nós.push(m[1])
      }
    } else if (m[3]) {
      nós.push(<strong key={chave++}>{m[3]}</strong>)
    }
    ultimo = m.index + m[0].length
  }
  if (ultimo < texto.length) nós.push(texto.slice(ultimo))
  return nós
}
