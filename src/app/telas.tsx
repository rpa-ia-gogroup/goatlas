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
  type ChamadoResumo,
  type DetalheChamado,
  type EstadoVerificacao,
  type Prioridade,
  type Proposta,
  type ResultadoCriacao,
  type TipoChamado,
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
      setBloqueado(r.bloqueado)
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

      {bloqueado && <CaminhoOverride aoConfirmar={usarOverride} />}

      {proposta && conversaId && !bloqueado && (
        <ReciboConfirmacao
          conversaId={conversaId}
          propostaInicial={proposta}
          aoCriar={setCriado}
        />
      )}

      {erro && <Aviso atencao>{erro}</Aviso>}

      <form className="compositor" onSubmit={enviar}>
        <div className="campo">
          <label htmlFor="mensagem">Sua mensagem</label>
          <textarea
            id="mensagem"
            value={rascunho}
            onChange={(e) => setRascunho(e.target.value)}
            placeholder="Ex.: o relatório de vendas de ontem não atualizou"
            disabled={enviando}
          />
        </div>
        <div className="acoes">
          <button type="submit" className="botao botao-primario" disabled={enviando || !rascunho.trim()}>
            {enviando ? 'Enviando…' : 'Enviar'}
          </button>
        </div>
      </form>
    </div>
  )
}

/**
 * O caminho de override — RF-13, RN-07.
 *
 * Exige uma frase sobre o que faltou, e a copy diz por que: é o que alimenta a
 * melhoria da documentação. Bloqueio é orientação, não parede, e o caminho de saída
 * fica visível ao lado do bloqueio, não escondido.
 */
function CaminhoOverride({ aoConfirmar }: { aoConfirmar: (motivo: string) => void }) {
  const [aberto, setAberto] = useState(false)
  const [motivo, setMotivo] = useState('')

  if (!aberto) {
    return (
      <div className="acoes">
        <button type="button" className="botao botao-contorno" onClick={() => setAberto(true)}>
          Isso não resolve meu caso
        </button>
      </div>
    )
  }

  return (
    <form
      className="recibo"
      onSubmit={(e) => {
        e.preventDefault()
        if (motivo.trim()) aoConfirmar(motivo.trim())
      }}
    >
      <div className="campo">
        <label htmlFor="motivo-override">O que ficou de fora?</label>
        <textarea
          id="motivo-override"
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          placeholder="Ex.: a página trata da loja física, e meu caso é o e-commerce"
        />
        <span className="dica">
          Isso vai para a fila de melhoria da documentação — é assim que a próxima pessoa acha a
          resposta certa.
        </span>
      </div>
      <div className="acoes">
        <button type="submit" className="botao botao-primario" disabled={!motivo.trim()}>
          Seguir com o chamado
        </button>
        <button type="button" className="botao botao-discreto" onClick={() => setAberto(false)}>
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
    </div>
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
  const [itens, setItens] = useState<ChamadoResumo[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    api
      .meusChamados()
      .then((r) => setItens(r.itens))
      .catch((e) => setErro(e instanceof ErroApi ? e.message : 'Não conseguimos carregar seus chamados.'))
  }, [])

  if (erro) return <Aviso atencao>{erro}</Aviso>
  if (!itens) return <p className="carregando">Carregando seus chamados…</p>

  if (itens.length === 0) {
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
      <ul className="chamados">
        {itens.map((c) => (
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

  async function carregar() {
    try {
      setDados(await api.detalhe(issueKey))
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : 'Não conseguimos abrir esse chamado.')
    }
  }

  useEffect(() => {
    void carregar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issueKey])

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

      <section className="recibo">
        <span className="eyebrow">Descrição</span>
        <TextoDoAgente texto={dados.chamado.descricao} />
      </section>

      <section className="pilha">
        <h2 className="titulo-secao" style={{ fontSize: 'var(--fs-h3)' }}>
          Conversa do chamado
        </h2>
        {dados.comentarios.length === 0 ? (
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

  useEffect(() => {
    api
      .tiposChamado()
      .then((r) => {
        setTipos(r.itens)
        if (r.itens[0]) setTipo(r.itens[0].id)
      })
      .catch(() => setTipos([]))
  }, [])

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
