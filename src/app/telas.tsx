/**
 * As telas do goatlas.
 *
 * Quatro superfícies, uma coluna, mobile-first (RNF-28): conversa com o agente,
 * meus chamados, detalhe do chamado e o formulário sem IA (D-04).
 */

import { useEffect, useRef, useState, type FormEvent } from 'react'
import {
  api,
  ErroApi,
  PRIORIDADES,
  prioridadePor,
  type CampoRequestType,
  type DetalheChamado,
  type EstadoVerificacao,
  type Prioridade,
  type Proposta,
  type RespostaMeusChamados,
  type ResultadoCriacao,
  type TipoChamado,
  type TransicaoDisponivel,
} from './api'
import {
  Aviso,
  Selo,
  SeloPrioridade,
  SeloVerificacao,
  TextoDoAgente,
  TrilhaVerificacao,
  Vazio,
} from './componentes'

/* ======================= conversa com o agente ========================= */

interface Fala {
  readonly de: 'agente' | 'usuario'
  readonly texto: string
}

export function TelaConversa({ aoAbrirChamado }: { aoAbrirChamado: () => void }) {
  const [conversaId, setConversaId] = useState<string | null>(null)
  const [falas, setFalas] = useState<Fala[]>([
    {
      de: 'agente',
      texto:
        'Oi! Conte o que você precisa, com suas palavras. Vou entender o caso, checar se já existe resposta pronta e, se não existir, montar o chamado com você.',
    },
  ])
  const [rascunho, setRascunho] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [confluence, setConfluence] = useState<EstadoVerificacao>('pendente')
  const [historico, setHistorico] = useState<EstadoVerificacao>('pendente')
  const [bloqueado, setBloqueado] = useState(false)
  // Mora aqui, e não dentro de `CaminhoOverride`, porque quem precisa saber é o
  // compositor: enquanto a justificativa está aberta, a caixa de mensagem fecha.
  const [justificando, setJustificando] = useState(false)
  const [proposta, setProposta] = useState<Proposta | null>(null)
  const [criado, setCriado] = useState<ResultadoCriacao | null>(null)
  const fim = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fim.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [falas, proposta, criado])

  async function enviar(e: FormEvent) {
    e.preventDefault()
    const texto = rascunho.trim()
    if (!texto || enviando) return

    setErro(null)
    setEnviando(true)
    setFalas((f) => [...f, { de: 'usuario', texto }])
    setRascunho('')

    try {
      let id = conversaId
      if (!id) {
        id = (await api.iniciarConversa()).id
        setConversaId(id)
      }
      const r = await api.enviarMensagem(id, texto)
      setConfluence(r.verificacoes.confluence)
      setHistorico(r.verificacoes.historico)
      // ⚠️ `bloqueioPendente`, não `bloqueado`: o segundo vale só para o turno que
      // acabou, e usá-lo aqui fazia o caminho de override sumir assim que a pessoa
      // mandava outra mensagem — deixando-a sem saída agora que o servidor não
      // monta proposta enquanto o bloqueio não for sobreposto (RN-07).
      setBloqueado(r.bloqueioPendente)
      setProposta(r.proposta)
      setFalas((f) => [...f, { de: 'agente', texto: r.texto }])
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : 'Não conseguimos enviar sua mensagem. Tente de novo.')
    } finally {
      setEnviando(false)
    }
  }

  async function usarOverride(motivo: string) {
    if (!conversaId) return
    try {
      const r = await api.registrarOverride(conversaId, motivo)
      setBloqueado(false)
      setJustificando(false)
      // A proposta vem na resposta do override: a pessoa insistiu, então o próximo
      // passo aparece na hora, sem ela ter de adivinhar que precisa digitar de novo.
      if (r.proposta) setProposta(r.proposta)
      setFalas((f) => [
        ...f,
        {
          de: 'agente',
          texto: r.proposta
            ? 'Entendido, registrei que a documentação não cobre o seu caso — isso vai para a fila de melhoria. Montei o chamado abaixo, confira e confirme.'
            : 'Entendido, registrei que a documentação não cobre o seu caso. Me conte um pouco mais do que aconteceu para eu montar o chamado.',
        },
      ])
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : 'Não conseguimos registrar. Tente de novo.')
    }
  }

  if (criado) {
    return <ChamadoAberto resultado={criado} via="conversa" aoVerChamados={aoAbrirChamado} />
  }

  return (
    <div className="pilha">
      <TrilhaVerificacao
        confluence={confluence}
        historico={historico}
        chamado="pendente"
        emAndamento={enviando}
      />

      <div className="conversa">
        {falas.map((f, i) =>
          f.de === 'agente' ? (
            <div key={i}>
              <span className="autor">goatlas</span>
              <TextoDoAgente texto={f.texto} />
            </div>
          ) : (
            <p key={i} className="fala-usuario">
              {f.texto}
            </p>
          ),
        )}
        {enviando && (
          <p className="carregando" aria-live="polite">
            Verificando antes de responder…
          </p>
        )}
        <div ref={fim} />
      </div>

      {bloqueado && (
        <CaminhoOverride
          aberto={justificando}
          aoAbrir={() => setJustificando(true)}
          aoFechar={() => setJustificando(false)}
          aoConfirmar={usarOverride}
        />
      )}

      {proposta && conversaId && !bloqueado && (
        <ReciboConfirmacao
          conversaId={conversaId}
          propostaInicial={proposta}
          aoCriar={setCriado}
        />
      )}

      {erro && <Aviso atencao>{erro}</Aviso>}

      <Compositor
        valor={rascunho}
        aoMudar={setRascunho}
        aoEnviar={enviar}
        enviando={enviando}
        justificando={justificando}
      />
    </div>
  )
}

/**
 * A caixa de mensagem para o agente.
 *
 * ⚠️ Ela **fecha** enquanto a justificativa do override está aberta. Com as duas
 * disponíveis ao mesmo tempo, a pessoa escreve na de baixo — que é a maior, a que
 * ela já usou e a que está onde o dedo espera. Aí o texto vira mensagem para o
 * agente, o override não acontece, e ela fica repetindo "isso não resolve" para um
 * modelo que não tem como liberar nada (`RN-07`).
 *
 * Fechada, não escondida: sumir com o campo faz a página saltar e deixa a pessoa
 * sem entender o que aconteceu. O motivo vai escrito, e some assim que ela fecha a
 * justificativa pelo "Voltar".
 */
export function Compositor({
  valor,
  aoMudar,
  aoEnviar,
  enviando,
  justificando,
}: {
  valor: string
  aoMudar: (v: string) => void
  aoEnviar: (e: FormEvent) => void
  enviando: boolean
  justificando: boolean
}) {
  return (
    <form className="compositor" onSubmit={aoEnviar}>
      <div className="campo">
        <label htmlFor="mensagem">Sua mensagem</label>
        <textarea
          id="mensagem"
          value={valor}
          onChange={(e) => aoMudar(e.target.value)}
          placeholder="Ex.: o relatório de vendas de ontem não atualizou"
          disabled={enviando || justificando}
          aria-describedby={justificando ? 'mensagem-pausada' : undefined}
        />
        {justificando && (
          <span className="dica" id="mensagem-pausada">
            Termine a justificativa acima — ou use "Voltar" — para escrever aqui de novo.
          </span>
        )}
      </div>
      <div className="acoes">
        <button
          type="submit"
          className="botao botao-primario"
          disabled={enviando || justificando || !valor.trim()}
        >
          {enviando ? 'Enviando…' : 'Enviar'}
        </button>
      </div>
    </form>
  )
}

/**
 * O caminho de override — RF-13, RN-07.
 *
 * Exige uma frase sobre o que faltou, e a copy diz por que: é o que alimenta a
 * melhoria da documentação. Bloqueio é orientação, não parede, e o caminho de saída
 * fica visível ao lado do bloqueio, não escondido.
 */
export function CaminhoOverride({
  aberto,
  aoAbrir,
  aoFechar,
  aoConfirmar,
}: {
  aberto: boolean
  aoAbrir: () => void
  aoFechar: () => void
  aoConfirmar: (motivo: string) => void
}) {
  const [motivo, setMotivo] = useState('')

  if (!aberto) {
    return (
      <div className="acoes">
        <button type="button" className="botao botao-contorno" onClick={aoAbrir}>
          Isso não resolve meu caso
        </button>
      </div>
    )
  }

  return (
    <form
      className="justificativa"
      onSubmit={(e) => {
        e.preventDefault()
        if (motivo.trim()) aoConfirmar(motivo.trim())
      }}
    >
      {/* O sobretítulo existe para dizer o QUE este campo é antes de a pessoa
          começar a escrever. Sem ele, uma caixa de texto embaixo de uma conversa
          lê como mais uma mensagem — foi assim que confundiu na primeira vez. */}
      <span className="justificativa-titulo">Corrigir a recomendação</span>
      <div className="campo">
        <label htmlFor="motivo-override">Por que essas páginas não resolvem o seu caso?</label>
        <textarea
          id="motivo-override"
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          placeholder="Ex.: a página trata da loja física, e meu caso é o e-commerce"
        />
        <span className="dica">
          Isto não é uma mensagem para o agente: vai para a fila de melhoria da documentação, e é
          assim que a próxima pessoa acha a resposta certa.
        </span>
      </div>
      <div className="acoes">
        <button type="submit" className="botao botao-primario" disabled={!motivo.trim()}>
          Seguir com o chamado
        </button>
        <button type="button" className="botao botao-discreto" onClick={aoFechar}>
          Voltar
        </button>
      </div>
    </form>
  )
}

/**
 * Recibo de confirmação — RF-16, RF-17, RF-18.
 *
 * Metáfora de recibo: é o artefato que a pessoa vai registrar, e ela precisa
 * reconhecer o que sai dali. A prioridade é **editável**: priorização automática sem
 * revisão vira jogo, e as pessoas aprendem as palavras que produzem "Crítica".
 */
function ReciboConfirmacao({
  conversaId,
  propostaInicial,
  aoCriar,
}: {
  conversaId: string
  propostaInicial: Proposta
  aoCriar: (r: ResultadoCriacao) => void
}) {
  const [prioridade, setPrioridade] = useState<Prioridade>(propostaInicial.prioridade)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const p = prioridadePor(prioridade)

  async function confirmar() {
    setSalvando(true)
    setErro(null)
    try {
      if (prioridade !== propostaInicial.prioridade) {
        await api.salvarProposta(conversaId, { ...propostaInicial, prioridade })
      }
      aoCriar(await api.confirmar(conversaId))
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : 'Não conseguimos abrir o chamado agora.')
    } finally {
      setSalvando(false)
    }
  }

  return (
    <section className="recibo" aria-labelledby="titulo-recibo">
      <div>
        <span className="eyebrow">Confira antes de abrir</span>
        <h2 id="titulo-recibo" className="titulo-secao">
          {propostaInicial.titulo}
        </h2>
      </div>

      <dl>
        <dt>Descrição</dt>
        <dd>{propostaInicial.descricao}</dd>

        {propostaInicial.area && (
          <>
            <dt>Área</dt>
            <dd>{propostaInicial.area}</dd>
          </>
        )}

        <dt>Prioridade</dt>
        <dd>
          <div className="campo">
            <label className="sr-apenas" htmlFor="prioridade">
              Prioridade
            </label>
            <select
              id="prioridade"
              value={prioridade}
              onChange={(e) => setPrioridade(e.target.value as Prioridade)}
            >
              {PRIORIDADES.map((op) => (
                <option key={op.valor} value={op.valor}>
                  {op.rotulo} — {op.criterio}
                </option>
              ))}
            </select>
            <span className="dica">
              Sugerimos {prioridadePor(propostaInicial.prioridade).rotulo.toLowerCase()}. Ajuste se
              não bate com o seu caso.
            </span>
          </div>
        </dd>

        <dt>Prazo</dt>
        <dd className="prazo">
          {p.horas}h
          <small>
            Prazo de <strong>primeira resposta</strong>, não de solução. É o piso garantido —
            muitas áreas respondem antes.
          </small>
        </dd>
      </dl>

      {erro && <Aviso atencao>{erro}</Aviso>}

      <div className="acoes">
        <button type="button" className="botao botao-primario" onClick={confirmar} disabled={salvando}>
          {salvando ? 'Abrindo…' : 'Abrir chamado'}
        </button>
      </div>
    </section>
  )
}

function ChamadoAberto({
  resultado,
  via,
  aoVerChamados,
}: {
  resultado: ResultadoCriacao
  via: 'conversa' | 'formulario'
  aoVerChamados: () => void
}) {
  const p = prioridadePor(resultado.prioridade)
  // Pelo formulário as verificações não FALHARAM — elas não foram executadas
  // (D-04). Marcá-las como falha diria que algo deu errado; `pendente` é o estado
  // verdadeiro, e é o que a pessoa precisa entender para saber o que ganharia
  // conversando com o agente.
  const estadoVerificacoes = resultado.verificadoRegras
    ? 'ok'
    : via === 'formulario'
      ? 'pendente'
      : 'falhou'
  return (
    <div className="pilha">
      <TrilhaVerificacao
        confluence={estadoVerificacoes}
        historico={estadoVerificacoes}
        chamado="ok"
      />
      <section className="recibo">
        <div>
          <span className="eyebrow">
            {resultado.estado === 'criado' ? 'Chamado aberto' : 'Recebido'}
          </span>
          <h2 className="titulo-secao">{resultado.issueKey ?? 'Estamos abrindo'}</h2>
        </div>
        <p>{resultado.mensagem}</p>
        <div className="chamado-meta">
          <Selo variante={resultado.prioridade === 'critica' ? 'lime' : 'neutro'}>
            {p.rotulo} · 1ª resposta em {p.horas}h
          </Selo>
          <SeloVerificacao verificado={resultado.verificadoRegras} via={via} />
        </div>
        <div className="acoes">
          <button type="button" className="botao botao-contorno" onClick={aoVerChamados}>
            Ver meus chamados
          </button>
        </div>
      </section>

      {resultado.issueKey && <CorrigirArea issueKey={resultado.issueKey} />}
    </div>
  )
}

/**
 * Correção da área — RF-19, T-305.
 *
 * Mesmo padrão de `RF-16` com a prioridade: o app **sugere** e a pessoa corrige antes de
 * o dado virar métrica. O mapa de e-mail → área envelhece, e pessoa que muda de área é a
 * regra, não a exceção — sem esta caixa, a única forma de arrumar seria um admin editando
 * configuração, e a métrica por área (`T-312`) ficaria errada em silêncio.
 *
 * Fica **fechada** por padrão: quem acabou de abrir chamado quer saber que ele foi aberto,
 * não preencher mais um campo. Aparece como uma frase discreta com o caminho de saída.
 */
function CorrigirArea({ issueKey }: { issueKey: string }) {
  const [aberto, setAberto] = useState(false)
  const [area, setArea] = useState('')
  const [salvo, setSalvo] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  if (salvo !== null) {
    return (
      <p className="dica" aria-live="polite">
        Área do chamado: <strong>{salvo || 'não informada'}</strong>.
      </p>
    )
  }

  if (!aberto) {
    return (
      <div className="acoes">
        <button type="button" className="botao botao-discreto" onClick={() => setAberto(true)}>
          Corrigir a minha área
        </button>
      </div>
    )
  }

  return (
    <form
      className="recibo"
      onSubmit={async (e) => {
        e.preventDefault()
        try {
          const r = await api.corrigirArea(issueKey, area.trim() || null)
          setSalvo(r.area ?? '')
        } catch (err) {
          setErro(err instanceof ErroApi ? err.message : 'Não conseguimos salvar a área.')
        }
      }}
    >
      <div className="campo">
        <label htmlFor="area-chamado">Sua área</label>
        <input
          id="area-chamado"
          value={area}
          onChange={(e) => setArea(e.target.value)}
          placeholder="Ex.: CX, Produção, Growth"
        />
        <span className="dica">
          Serve para o time de tech ver de onde vêm os pedidos. Deixe vazio se preferir não
          informar — em branco é melhor que uma área errada.
        </span>
      </div>
      {erro && <Aviso atencao>{erro}</Aviso>}
      <div className="acoes">
        <button type="submit" className="botao botao-primario">
          Salvar área
        </button>
        <button type="button" className="botao botao-discreto" onClick={() => setAberto(false)}>
          Deixar como está
        </button>
      </div>
    </form>
  )
}

/* ======================= meus chamados ================================== */

export function TelaMeusChamados({
  aoAbrirDetalhe,
  aoConversar,
}: {
  aoAbrirDetalhe: (issueKey: string) => void
  aoConversar: () => void
}) {
  const [resposta, setResposta] = useState<RespostaMeusChamados | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  // Rascunho separado do que já foi aplicado: o filtro roda no servidor (status e
  // título vivem no Jira), e disparar uma requisição por tecla digitada gastaria o
  // orçamento da credencial única (R-02) para nada.
  const [termo, setTermo] = useState('')
  const [status, setStatus] = useState('')
  const [buscando, setBuscando] = useState(false)

  async function carregar(filtros: { status?: string; termo?: string } = {}) {
    setBuscando(true)
    try {
      setResposta(await api.meusChamados(filtros))
      setErro(null)
    } catch (e) {
      setErro(
        e instanceof ErroApi ? e.message : 'Não conseguimos carregar seus chamados.',
      )
    } finally {
      setBuscando(false)
    }
  }

  useEffect(() => {
    void carregar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function aplicar(e: FormEvent) {
    e.preventDefault()
    void carregar({
      ...(status ? { status } : {}),
      ...(termo.trim() ? { termo: termo.trim() } : {}),
    })
  }

  if (erro) return <Aviso atencao>{erro}</Aviso>
  if (!resposta) return <p className="carregando">Carregando seus chamados…</p>

  const filtrando = Boolean(status || termo.trim())

  // Vazio de verdade (nunca abriu chamado) é convite para agir. Vazio por filtro é
  // outra coisa: a pessoa TEM chamados, e dizer "nenhum chamado por aqui" faria ela
  // achar que perdeu o histórico.
  if (resposta.total === 0) {
    return (
      <Vazio
        titulo="Nenhum chamado por aqui"
        texto="Quando você abrir um chamado, ele aparece nesta lista com status e prazo."
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
      <h1 className="titulo-secao">Meus chamados</h1>

      <form className="filtros" onSubmit={aplicar}>
        <div className="campo">
          <label htmlFor="busca-chamados">Procurar</label>
          <input
            id="busca-chamados"
            value={termo}
            onChange={(e) => setTermo(e.target.value)}
            placeholder="palavra do título ou o número do chamado"
          />
        </div>
        <div className="campo">
          <label htmlFor="filtro-status">Status</label>
          <select
            id="filtro-status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="">Todos</option>
            {/* Montado com o que EXISTE nos chamados da pessoa: os status são do
                workflow do JSM, e uma lista fixa aqui ficaria errada no dia em que o
                time de tech renomear uma coluna. */}
            {resposta.statusDisponiveis.map((s) => (
              <option key={s} value={s}>
                {rotuloStatus(s)}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className="botao botao-contorno" disabled={buscando}>
          {buscando ? 'Filtrando…' : 'Filtrar'}
        </button>
      </form>

      {filtrando && (
        <p className="contagem-resultados" aria-live="polite">
          {resposta.itens.length} de {resposta.total}{' '}
          {resposta.total === 1 ? 'chamado' : 'chamados'}
          {resposta.itens.length === 0 && ' — nenhum com esses filtros.'}
        </p>
      )}

      <ul className="chamados">
        {resposta.itens.map((c) => (
          <li key={c.issueKey}>
            <button type="button" className="chamado" onClick={() => aoAbrirDetalhe(c.issueKey)}>
              <span className="chamado-topo">
                <span className="chamado-chave">{c.issueKey}</span>
                <Selo variante="contorno">{rotuloStatus(c.status)}</Selo>
              </span>
              <span className="chamado-titulo">
                {c.titulo ?? 'Título indisponível no momento'}
              </span>
              <span className="chamado-meta">
                <SeloPrioridade prioridade={c.prioridade} />
                <SeloVerificacao verificado={c.verificadoRegras} via={c.via} />
                {c.area && <Selo variante="contorno">{c.area}</Selo>}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** `indisponivel` vem do backend quando o Jira não respondeu por aquele item (RNF-19). */
function rotuloStatus(status: string): string {
  return status === 'indisponivel' ? 'Status indisponível' : status
}

/* ======================= detalhe ======================================== */

export function TelaDetalhe({ issueKey, aoVoltar }: { issueKey: string; aoVoltar: () => void }) {
  const [dados, setDados] = useState<DetalheChamado | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [comentario, setComentario] = useState('')
  const [enviando, setEnviando] = useState(false)
  // T-242 — `null` = ainda carregando; `[]` = o workflow do JSM não oferece nenhuma
  // transição ao cliente, que é o caso NORMAL e não um erro. A tela some com o bloco.
  const [transicoes, setTransicoes] = useState<readonly TransicaoDisponivel[] | null>(null)
  const [transicionando, setTransicionando] = useState<string | null>(null)
  const [arquivos, setArquivos] = useState<File[]>([])
  const [anexando, setAnexando] = useState(false)
  const [avisoAcao, setAvisoAcao] = useState<string | null>(null)

  async function carregar() {
    try {
      setDados(await api.detalhe(issueKey))
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : 'Não conseguimos abrir esse chamado.')
    }
  }

  useEffect(() => {
    void carregar()
    // As ações não bloqueiam o chamado: lista indisponível vira "nenhuma ação", e a
    // pessoa continua vendo e comentando (RNF-18).
    api
      .transicoes(issueKey)
      .then((r) => setTransicoes(r.itens))
      .catch(() => setTransicoes([]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issueKey])

  async function anexar(e: FormEvent) {
    e.preventDefault()
    if (arquivos.length === 0) return
    setAnexando(true)
    setErro(null)
    try {
      const r = await api.anexar(issueKey, arquivos)
      setArquivos([])
      setAvisoAcao(
        r.enviados.length === 1
          ? 'Arquivo anexado ao chamado.'
          : `${r.enviados.length} arquivos anexados ao chamado.`,
      )
      await carregar()
    } catch (err) {
      setErro(err instanceof ErroApi ? err.message : 'Não conseguimos anexar agora.')
    } finally {
      setAnexando(false)
    }
  }

  async function transicionar(id: string, nome: string) {
    setTransicionando(id)
    setErro(null)
    try {
      await api.transicionar(issueKey, id)
      setAvisoAcao(`Chamado atualizado: ${nome}.`)
      await carregar()
      setTransicoes((await api.transicoes(issueKey)).itens)
    } catch (err) {
      setErro(
        err instanceof ErroApi ? err.message : 'Não conseguimos atualizar o chamado agora.',
      )
    } finally {
      setTransicionando(null)
    }
  }

  async function comentar(e: FormEvent) {
    e.preventDefault()
    const texto = comentario.trim()
    if (!texto) return
    setEnviando(true)
    try {
      await api.comentar(issueKey, texto)
      setComentario('')
      await carregar()
    } catch (err) {
      setErro(err instanceof ErroApi ? err.message : 'Não conseguimos enviar seu comentário.')
    } finally {
      setEnviando(false)
    }
  }

  if (erro) {
    return (
      <div className="pilha">
        <Aviso atencao>{erro}</Aviso>
        <div className="acoes">
          <button type="button" className="botao botao-contorno" onClick={aoVoltar}>
            Voltar para meus chamados
          </button>
        </div>
      </div>
    )
  }
  if (!dados) return <p className="carregando">Carregando o chamado…</p>

  return (
    <div className="pilha">
      <button type="button" className="botao botao-discreto" onClick={aoVoltar}>
        ← Meus chamados
      </button>

      <div>
        <span className="eyebrow">{dados.chamado.issueKey}</span>
        <h1 className="titulo-secao">{dados.chamado.titulo}</h1>
      </div>

      <div className="chamado-meta">
        <Selo variante="contorno">{rotuloStatus(dados.chamado.status)}</Selo>
        <SeloPrioridade prioridade={dados.chamado.prioridade} />
        <SeloVerificacao verificado={dados.verificadoRegras} via={dados.via} />
      </div>

      {avisoAcao && <Aviso>{avisoAcao}</Aviso>}

      {/* RNF-19 — o chamado existe; o que faltou foi ler o estado dele. Dizer isso é o
          oposto de mostrar uma tela vazia e deixar a pessoa concluir que o chamado sumiu. */}
      {dados.degradado && (
        <Aviso atencao>
          Não conseguimos consultar o estado atual deste chamado agora. O que você vê aqui é
          o que registramos na abertura — <strong>seu chamado está a salvo</strong>. Tente
          recarregar em instantes.
        </Aviso>
      )}

      <section className="recibo">
        <span className="eyebrow">Descrição</span>
        <TextoDoAgente texto={dados.chamado.descricao} />
      </section>

      {/* T-242 / RF-36 — só o que o workflow do JSM oferece ao cliente. Sem transição
          exposta, o bloco não existe: o app não inventa ação que o projeto não tem. */}
      {transicoes && transicoes.length > 0 && (
        <section className="pilha">
          <h2 className="titulo-secao" style={{ fontSize: 'var(--fs-h3)' }}>
            Ações
          </h2>
          <div className="acoes">
            {transicoes.map((t) => (
              <button
                key={t.id}
                type="button"
                className="botao botao-contorno"
                onClick={() => void transicionar(t.id, t.nome)}
                disabled={transicionando !== null}
              >
                {transicionando === t.id ? 'Atualizando…' : t.nome}
              </button>
            ))}
          </div>
        </section>
      )}

      {/* T-240 / RF-25 — anexo do solicitante. Fica depois da descrição e antes da
          conversa: anexar é complemento do pedido, não uma resposta. */}
      <section className="pilha">
        <h2 className="titulo-secao" style={{ fontSize: 'var(--fs-h3)' }}>
          Anexos
        </h2>
        <form className="zona-anexo" onSubmit={anexar}>
          <label htmlFor="anexo-chamado">Anexar print, planilha ou documento</label>
          <input
            id="anexo-chamado"
            type="file"
            multiple
            onChange={(e) => setArquivos(Array.from(e.target.files ?? []))}
            disabled={anexando}
          />
          <span className="dica">
            Até 3 arquivos por envio, de no máximo 8 MB cada. Quem trabalha o chamado vê
            os anexos junto com a sua descrição.
          </span>
          {arquivos.length > 0 && (
            <ul className="lista-anexos">
              {arquivos.map((a) => (
                <li key={a.name}>
                  {a.name} · {Math.max(1, Math.round(a.size / 1024))} KB
                </li>
              ))}
            </ul>
          )}
          <div className="acoes">
            <button
              type="submit"
              className="botao botao-primario"
              disabled={anexando || arquivos.length === 0}
            >
              {anexando ? 'Enviando…' : 'Anexar'}
            </button>
          </div>
        </form>
      </section>

      <section className="pilha">
        <h2 className="titulo-secao" style={{ fontSize: 'var(--fs-h3)' }}>
          Conversa do chamado
        </h2>
        {dados.comentariosIndisponiveis ? (
          // ⚠️ Nunca "ainda não há respostas" quando o que houve foi falha de leitura:
          // seriam frases opostas, e a errada faz a pessoa achar que ninguém olhou.
          <p className="dica">
            Não conseguimos carregar as respostas agora. Isso não significa que não há
            nenhuma — tente recarregar em instantes.
          </p>
        ) : dados.comentarios.length === 0 ? (
          <p className="dica">
            Ainda não há respostas. Você recebe aviso aqui quando o time responder.
          </p>
        ) : (
          <div className="conversa">
            {dados.comentarios.map((c) => (
              <div key={c.id}>
                <span className="autor">{c.autorNome}</span>
                <TextoDoAgente texto={c.corpo} />
              </div>
            ))}
          </div>
        )}

        <form className="compositor" onSubmit={comentar}>
          <div className="campo">
            <label htmlFor="comentario">Adicionar comentário</label>
            <textarea
              id="comentario"
              value={comentario}
              onChange={(e) => setComentario(e.target.value)}
              placeholder="Escreva uma informação nova, um print, um número de pedido…"
              disabled={enviando}
            />
          </div>
          <div className="acoes">
            <button
              type="submit"
              className="botao botao-primario"
              disabled={enviando || !comentario.trim()}
            >
              {enviando ? 'Enviando…' : 'Comentar'}
            </button>
          </div>
        </form>
      </section>
    </div>
  )
}

/* ======================= formulário sem IA (D-04) ====================== */

/**
 * O caminho sem agente — D-04, RNF-18.
 *
 * Existe para que uma queda do provedor de IA não derrube a única porta de entrada
 * de chamados da empresa. A copy é honesta sobre a diferença: aqui não há
 * verificação, e o chamado nasce marcado como não verificado.
 */
export function TelaFormulario({ aoAbrirChamado }: { aoAbrirChamado: () => void }) {
  const [tipos, setTipos] = useState<TipoChamado[] | null>(null)
  const [titulo, setTitulo] = useState('')
  const [descricao, setDescricao] = useState('')
  const [tipoChamadoId, setTipo] = useState('')
  const [prioridade, setPrioridade] = useState<Prioridade>('normal')
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [resultado, setResultado] = useState<ResultadoCriacao | null>(null)
  // Chave estável por montagem: duplo clique ou reenvio caem na MESMA submissão
  // (RF-24). Gerar por clique perderia a proteção justamente no duplo clique.
  const chave = useRef(crypto.randomUUID())

  // RF-27 (T-130) — campos adicionais do request type selecionado. `null` =
  // ainda carregando; `[]` = nenhum campo extra OU a busca falhou — os dois
  // casos são tratados IGUAL de propósito: o formulário fixo não pode parar de
  // funcionar por causa do schema (RNF-18).
  const [campos, setCampos] = useState<CampoRequestType[] | null>(null)
  const [valoresCampos, setValoresCampos] = useState<Record<string, string>>({})

  useEffect(() => {
    api
      .tiposChamado()
      .then((r) => {
        setTipos(r.itens)
        if (r.itens[0]) setTipo(r.itens[0].id)
      })
      .catch(() => setTipos([]))
  }, [])

  useEffect(() => {
    if (!tipoChamadoId) return
    setCampos(null)
    setValoresCampos({})
    api
      .camposDoTipo(tipoChamadoId)
      .then((r) => setCampos(r.itens))
      .catch(() => setCampos([]))
  }, [tipoChamadoId])

  async function enviar(e: FormEvent) {
    e.preventDefault()
    setEnviando(true)
    setErro(null)
    try {
      setResultado(
        await api.abrirPorFormulario({
          titulo: titulo.trim(),
          descricao: descricao.trim(),
          tipoChamadoId,
          prioridade,
          chaveIdempotencia: chave.current,
          ...(Object.keys(valoresCampos).length > 0 ? { camposDinamicos: valoresCampos } : {}),
        }),
      )
    } catch (err) {
      setErro(err instanceof ErroApi ? err.message : 'Não conseguimos abrir o chamado agora.')
    } finally {
      setEnviando(false)
    }
  }

  if (resultado)
    return <ChamadoAberto resultado={resultado} via="formulario" aoVerChamados={aoAbrirChamado} />

  if (tipos && tipos.length === 0) {
    return (
      <Vazio
        titulo="Formulário ainda não configurado"
        texto="Nenhum tipo de chamado foi liberado nesta instalação. Fale com o time de tech."
      />
    )
  }

  return (
    <form className="pilha" onSubmit={enviar}>
      <div>
        <span className="eyebrow">Sem conversa</span>
        <h1 className="titulo-secao">Abrir chamado direto</h1>
      </div>

      <Aviso>
        Por aqui não checamos se já existe resposta pronta — então o chamado pode demorar mais do
        que se você conversar com o agente. Use quando já souber exatamente o que precisa.
      </Aviso>

      <div className="campo">
        <label htmlFor="titulo">Título</label>
        <input
          id="titulo"
          value={titulo}
          onChange={(e) => setTitulo(e.target.value)}
          placeholder="Ex.: relatório de vendas não atualizou"
          required
          minLength={5}
        />
      </div>

      <div className="campo">
        <label htmlFor="descricao">O que está acontecendo</label>
        <textarea
          id="descricao"
          value={descricao}
          onChange={(e) => setDescricao(e.target.value)}
          placeholder="Descreva o que você esperava, o que aconteceu e desde quando."
          required
          minLength={10}
        />
      </div>

      <div className="campo">
        <label htmlFor="tipo">Tipo de chamado</label>
        <select id="tipo" value={tipoChamadoId} onChange={(e) => setTipo(e.target.value)} required>
          {(tipos ?? []).map((t) => (
            <option key={t.id} value={t.id}>
              {t.nome}
            </option>
          ))}
        </select>
      </div>

      {campos && campos.length > 0 && (
        <div className="pilha">
          {campos.map((c) => (
            <CampoDinamico
              key={c.fieldId}
              campo={c}
              valor={valoresCampos[c.fieldId] ?? ''}
              aoMudar={(v) => setValoresCampos((atuais) => ({ ...atuais, [c.fieldId]: v }))}
            />
          ))}
        </div>
      )}

      <div className="campo">
        <label htmlFor="prioridade-form">Prioridade</label>
        <select
          id="prioridade-form"
          value={prioridade}
          onChange={(e) => setPrioridade(e.target.value as Prioridade)}
        >
          {PRIORIDADES.map((op) => (
            <option key={op.valor} value={op.valor}>
              {op.rotulo} — {op.criterio}
            </option>
          ))}
        </select>
        <span className="dica">
          Primeira resposta em {prioridadePor(prioridade).horas}h. Prazo de resposta, não de
          solução.
        </span>
      </div>

      {erro && <Aviso atencao>{erro}</Aviso>}

      <div className="acoes">
        <button type="submit" className="botao botao-primario" disabled={enviando}>
          {enviando ? 'Abrindo…' : 'Abrir chamado'}
        </button>
      </div>
    </form>
  )
}

/**
 * Um campo adicional do request type (RF-27, T-130) — renderizado a partir do
 * schema, nunca hardcoded. Só três formas de input: o schema do JSM tem bem
 * mais tipo de campo do que isso, e um tipo não reconhecido aqui cairia melhor
 * como texto livre do que travando o formulário inteiro por causa de um campo
 * extra que a pessoa nem precisa preencher para abrir o chamado.
 */
function CampoDinamico({
  campo,
  valor,
  aoMudar,
}: {
  campo: CampoRequestType
  valor: string
  aoMudar: (valor: string) => void
}) {
  const id = `campo-dinamico-${campo.fieldId}`
  return (
    <div className="campo">
      <label htmlFor={id}>{campo.rotulo}</label>
      {campo.tipo === 'texto_longo' ? (
        <textarea
          id={id}
          value={valor}
          onChange={(e) => aoMudar(e.target.value)}
          required={campo.obrigatorio}
        />
      ) : campo.tipo === 'selecao' ? (
        <select id={id} value={valor} onChange={(e) => aoMudar(e.target.value)} required={campo.obrigatorio}>
          <option value="">Selecione…</option>
          {campo.opcoes.map((o) => (
            <option key={o.id} value={o.id}>
              {o.rotulo}
            </option>
          ))}
        </select>
      ) : (
        <input id={id} value={valor} onChange={(e) => aoMudar(e.target.value)} required={campo.obrigatorio} />
      )}
    </div>
  )
}
