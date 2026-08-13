/**
 * As telas do goatlas.
 *
 * Quatro superfícies, uma coluna, mobile-first (RNF-28): conversa com o agente,
 * meus chamados, detalhe do chamado e o formulário sem IA (D-04).
 */

import { useEffect, useRef, useState, type FormEvent, type ReactElement } from 'react'
import {
  api,
  ErroApi,
  PRIORIDADES,
  prioridadePor,
  type AnexoDoChamado,
  type CampoRequestType,
  type ComentarioPublico,
  type DetalheChamado,
  type Identidade,
  type EstadoVerificacao,
  type Prioridade,
  type Proposta,
  type RespostaMeusChamados,
  type ResultadoCriacao,
  type TipoChamado,
  type TransicaoDisponivel,
} from './api'
import {
  camposPreenchidosPeloApp,
  resolverCamposDoSolicitante,
} from '@/lib/tickets/campos-do-solicitante'
import { CODIGO_CRIACAO_NAO_CONCLUIDA } from '@/lib/http/respostas'
import {
  Aviso,
  Selo,
  SeloPrioridade,
  SeloVerificacao,
  TextoDoAgente,
  TrilhaVerificacao,
  Vazio,
} from './componentes'
import {
  arquivosDoColar,
  PerguntaDeAnexo,
  ResultadoDoAnexo,
  useAnexoNaConversa,
  type Declaracao,
} from './anexo'
import { MAX_ANEXOS_POR_CHAMADO } from '@/lib/tickets/anexos-pendentes'
import {
  faltaAlgumaCoisa,
  mensagemDePendencias,
  pendenciasParaAbrir,
} from './pendencias'

/* ======================= falha de criação (D-46) ======================= */

/**
 * O que a tela sabe sobre uma criação que deu errado — `D-46`.
 *
 * `naoSeraReprocessada` não é heurística nem leitura da frase: vem do **código** da
 * resposta, que o servidor só emite depois de a submissão ter sido marcada `falha` e,
 * portanto, ficado fora do reprocessamento do outbox (`RNF-17`). É o que autoriza a tela
 * a oferecer o recomeço — e a **não** oferecê-lo nos erros corrigíveis (campo obrigatório
 * faltando, opção fora da lista, declaração pendente), onde recomeçar jogaria fora tudo o
 * que a pessoa escreveu para resolver algo que ela conserta ali mesmo.
 */
interface Falha {
  readonly mensagem: string
  readonly naoSeraReprocessada: boolean
}

function falhaDeCriacao(e: unknown, padrao: string): Falha {
  if (!(e instanceof ErroApi)) return { mensagem: padrao, naoSeraReprocessada: false }
  return {
    mensagem: e.message,
    naoSeraReprocessada: e.codigo === CODIGO_CRIACAO_NAO_CONCLUIDA,
  }
}

/**
 * A saída da falha definitiva, ao lado da frase que a explica.
 *
 * ⚠️ A mensagem do servidor **termina** dizendo "pelo botão abaixo", então o botão é parte
 * da frase: renderizar um sem o outro deixa uma instrução apontando para o nada.
 */
function AvisoDeFalha({ falha, aoRecomecar }: { falha: Falha; aoRecomecar: () => void }) {
  return (
    <>
      <Aviso atencao>{falha.mensagem}</Aviso>
      {falha.naoSeraReprocessada && (
        <div className="acoes">
          <button type="button" className="botao botao-contorno" onClick={aoRecomecar}>
            Começar de novo
          </button>
        </div>
      )}
    </>
  )
}

/* ======================= conversa com o agente ========================= */

/**
 * `justificativa` é a frase do override — palavras da pessoa, mas **não** uma
 * mensagem para o agente. Ela foi para a auditoria e para a fila de melhoria da
 * documentação (`RF-42`), e some da conversa se não tiver entrada própria: a
 * pessoa escreve, aperta, e não vê registro nenhum do que disse.
 */
interface Fala {
  readonly de: 'agente' | 'usuario' | 'justificativa'
  readonly texto: string
}

/**
 * Recomeçar é REMONTAR, nunca uma sequência de `setX(inicial)` — `D-46`.
 *
 * Depois do recibo ("Chamado aberto · GN-6898") não havia caminho de volta: clicar a aba
 * que já estava ativa não faz nada (é a mesma tela), e só recarregar a página devolvia o
 * formulário. Quem precisa abrir o **segundo** chamado conclui que o app travou.
 *
 * A saída é um botão no recibo — e o que ele faz é trocar a `key` da tela inteira. Um
 * `reiniciar()` com nove `setState` funcionaria hoje e apagaria alguém amanhã: bastaria
 * esquecer `setBloqueado(false)` para a caixa de override reaparecer sobre uma conversa
 * nova, ou esquecer a chave de idempotência para o "segundo chamado" cair na **mesma**
 * submissão do primeiro (`RF-24`) e a pessoa receber de volta o chamado que já tinha.
 * Remontando, o estado inicial é o único estado que existe — inclusive o
 * `useRef(crypto.randomUUID())` da chave e a lista de envios dentro de `PerguntaDeAnexo`,
 * que aponta para a chave antiga e mostraria arquivos que não vão para o chamado novo.
 */
export function TelaConversa(props: { eu: Identidade; aoAbrirChamado: () => void }) {
  const [sessao, setSessao] = useState(0)
  return (
    <ConversaEmCurso
      key={sessao}
      {...props}
      aoRecomecar={() => setSessao((s) => s + 1)}
    />
  )
}

function ConversaEmCurso({
  eu,
  aoAbrirChamado,
  aoRecomecar,
}: {
  eu: Identidade
  aoAbrirChamado: () => void
  aoRecomecar: () => void
}) {
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
  // `D-53` — o nome do assunto acompanha a proposta, mas não faz parte dela.
  const [tipoNome, setTipoNome] = useState<string | null>(null)
  const [criado, setCriado] = useState<ResultadoCriacao | null>(null)
  // `D-59` — só o **realce** do arrasto. O upload em si é do hook abaixo.
  const [arrastando, setArrastando] = useState(false)
  const fim = useRef<HTMLDivElement>(null)
  /** `D-59b` — ver `garantirConversa`. Guarda a PROMESSA, não o id. */
  const conversaEmVoo = useRef<Promise<string> | null>(null)

  // `D-59` — o anexo passa a existir DURANTE a conversa, não só no cartão. Fica aqui, e
  // não dentro do compositor, porque as três formas de entregar o arquivo (clipe, soltar,
  // colar) nascem em lugares diferentes da tela e precisam da mesma função.
  const anexo = useAnexoNaConversa({
    garantirConversa,
    maximo: MAX_ANEXOS_POR_CHAMADO,
  })

  useEffect(() => {
    fim.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [falas, proposta, criado])

  /**
   * 🚨 **O Ctrl+V vale na tela inteira, não só onde o foco está** — `D-62`.
   *
   * O `onPaste` vivia **no `textarea`**, e o relato foi o oposto do esperado: *"só consigo
   * enviar um anexo se clicar fora do campo de texto"*. Duas causas somadas, e a segunda é
   * a que um handler no campo não alcança: `clipboardData.files` vem **vazio** para print
   * de algumas origens (quem tem o arquivo é `items[]`, ver `arquivosDoColar`), e colar com
   * o foco em qualquer outro lugar da página não tinha handler nenhum.
   *
   * Fica no `document` por isso: colar é gesto da **tela**, não de um campo. Um listener só
   * — nunca os dois — porque o evento do `textarea` **borbulha** até aqui, e handler nos
   * dois lugares subiria o mesmo arquivo duas vezes (`RF-63` não tem desfazer).
   *
   * ⚠️ A função vive num `ref`: `anexo.enviar` é recriada a cada render, e usá-la na
   * dependência reinscreveria o listener em toda tecla digitada.
   */
  const enviarAnexo = useRef(anexo.enviar)
  enviarAnexo.current = anexo.enviar
  useEffect(() => {
    function aoColar(evento: ClipboardEvent) {
      const arquivos = arquivosDoColar(evento.clipboardData)
      if (arquivos.length === 0) return
      // Só quando há arquivo: colar texto continua sendo colar texto.
      evento.preventDefault()
      void enviarAnexo.current(arquivos)
    }
    document.addEventListener('paste', aoColar)
    return () => document.removeEventListener('paste', aoColar)
  }, [])

  /**
   * O id da conversa, criando-a se ainda não existir — `D-59b`.
   *
   * 🚨 **A promessa é memoizada num `ref`, não só o id no estado.** `setConversaId` não
   * atualiza a variável desta closure, então dois disparos concorrentes — soltar dois
   * arquivos, ou colar um print e mandar a mensagem no mesmo instante — criariam **duas**
   * conversas. A segunda ficaria invisível, e o anexo dela também: o arquivo subiria com
   * `200` para uma conversa que nunca vira chamado. É a mesma classe de corrida que
   * `RF-24` resolve na criação, aqui um nível antes.
   */
  async function garantirConversa(): Promise<string> {
    if (conversaId) return conversaId
    if (!conversaEmVoo.current) {
      conversaEmVoo.current = api
        .iniciarConversa()
        .then((r) => {
          setConversaId(r.id)
          return r.id
        })
        .catch((e) => {
          // Falha não fica memoizada: a próxima tentativa tem de poder criar de verdade.
          conversaEmVoo.current = null
          throw e
        })
    }
    return conversaEmVoo.current
  }

  async function enviar(e: FormEvent) {
    e.preventDefault()
    const texto = rascunho.trim()
    if (!texto || enviando) return

    setErro(null)
    setEnviando(true)
    setFalas((f) => [...f, { de: 'usuario', texto }])
    setRascunho('')

    try {
      // `D-59b` — o MESMO caminho do anexo. Duas criações independentes fariam a conversa
      // do texto e a do arquivo divergirem, e o anexo iria para a que ninguém vê.
      const id = await garantirConversa()
      const r = await api.enviarMensagem(id, texto)
      setConfluence(r.verificacoes.confluence)
      setHistorico(r.verificacoes.historico)
      // ⚠️ `bloqueioPendente`, não `bloqueado`: o segundo vale só para o turno que
      // acabou, e usá-lo aqui fazia o caminho de override sumir assim que a pessoa
      // mandava outra mensagem — deixando-a sem saída agora que o servidor não
      // monta proposta enquanto o bloqueio não for sobreposto (RN-07).
      setBloqueado(r.bloqueioPendente)
      setProposta(r.proposta)
      setTipoNome(r.tipoNome ?? null)
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
      if (r.proposta) {
        setProposta(r.proposta)
        setTipoNome(r.tipoNome ?? null)
      }
      setFalas((f) => [
        ...f,
        // A frase da pessoa entra na conversa ANTES da resposta: sem ela, some da
        // tela o que ela acabou de escrever, e a resposta do agente ("registrei que
        // a documentação não cobre o seu caso") fica sem referente.
        { de: 'justificativa', texto: motivo },
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
    return (
      <ChamadoAberto
        resultado={criado}
        via="conversa"
        aoVerChamados={aoAbrirChamado}
        aoRecomecar={aoRecomecar}
      />
    )
  }

  return (
    <div className="pilha">
      <TrilhaVerificacao
        confluence={confluence}
        historico={historico}
        chamado="pendente"
        emAndamento={enviando}
      />

      {/* ⚠️ **A área inteira é o alvo, e ela só se anuncia enquanto o arquivo está no ar.**
          Uma caixa tracejada permanente ocuparia a conversa para uma ação que a maioria das
          pessoas não faz — e o pedido era o contrário: sempre disponível, sem poluir. Quem
          nunca arrastar nada vê só o clipe no compositor. */}
      <div
        className={arrastando ? 'conversa conversa-soltando' : 'conversa'}
        onDragEnter={(e) => {
          e.preventDefault()
          setArrastando(true)
        }}
        onDragOver={(e) => {
          e.preventDefault()
          setArrastando(true)
        }}
        onDragLeave={() => setArrastando(false)}
        onDrop={(e) => {
          e.preventDefault()
          setArrastando(false)
          const arquivos = Array.from(e.dataTransfer.files ?? [])
          if (arquivos.length > 0) void anexo.enviar(arquivos)
        }}
      >
        {falas.map((f, i) => (
          <EntradaConversa key={i} fala={f} />
        ))}
        {enviando && (
          <p className="carregando" aria-live="polite">
            Verificando antes de responder…
          </p>
        )}
        {arrastando && (
          <p className="conversa-soltar-aviso" aria-hidden="true">
            Solte para anexar ao chamado
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
          eu={eu}
          conversaId={conversaId}
          propostaInicial={proposta}
          tipoNome={tipoNome}
          aoCriar={setCriado}
          aoRecomecar={aoRecomecar}
        />
      )}

      {erro && <Aviso atencao>{erro}</Aviso>}

      <Compositor
        valor={rascunho}
        aoMudar={setRascunho}
        aoEnviar={enviar}
        enviando={enviando}
        justificando={justificando}
        anexo={anexo.elemento}
      />
    </div>
  )
}

/**
 * Uma entrada da conversa. Três tipos, três formas — e a terceira existe porque
 * duas não bastavam.
 *
 * A justificativa do override são palavras da pessoa, mas não são uma mensagem: ela
 * não foi para o agente, foi para a auditoria e para a fila de melhoria da
 * documentação. Mostrá-la como balão de usuário diria que ela conversou; não
 * mostrar diria que o que ela escreveu se perdeu. Fica como **registro**: espinha
 * lime e sobretítulo, o mesmo par visual do formulário onde ela acabou de digitar,
 * para que uma coisa leve à outra.
 */
export function EntradaConversa({ fala }: { fala: Fala }) {
  if (fala.de === 'agente') {
    return (
      <div>
        <span className="autor">goatlas</span>
        <TextoDoAgente texto={fala.texto} />
      </div>
    )
  }
  if (fala.de === 'justificativa') {
    return (
      <div className="fala-justificativa">
        <span className="autor">Justificativa registrada</span>
        <p>{fala.texto}</p>
      </div>
    )
  }
  return <p className="fala-usuario">{fala.texto}</p>
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
  anexo,
}: {
  valor: string
  aoMudar: (v: string) => void
  aoEnviar: (e: FormEvent) => void
  enviando: boolean
  justificando: boolean
  /** `D-59` — o clipe e a lista de enviados. `null` antes de a conversa existir. */
  anexo?: ReactElement | null
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
          // 🚨 **O `onPaste` NÃO mora aqui** (`D-62`). Colar é o caminho que mais importa —
          // print nasce no clipboard —, e por isso ele passou para um listener no
          // `document`, em `TelaConversa`: com o handler no campo, colar com o foco em
          // qualquer outro lugar da tela não fazia nada. Devolvê-lo para cá **sem** remover
          // o de lá sobe o mesmo arquivo duas vezes: o evento borbulha até o documento.
        />
        {justificando && (
          <span className="dica" id="mensagem-pausada">
            Termine a justificativa acima — ou use "Voltar" — para escrever aqui de novo.
          </span>
        )}
      </div>
      <div className="acoes acoes-compositor">
        {anexo}
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
export function ReciboConfirmacao({
  eu,
  conversaId,
  propostaInicial,
  tipoNome,
  aoCriar,
  aoRecomecar,
}: {
  eu: Identidade
  conversaId: string
  propostaInicial: Proposta
  /** `RF-18`/`D-53` — o nome do assunto; `null` quando não deu para identificar. */
  tipoNome: string | null
  aoCriar: (r: ResultadoCriacao) => void
  /** `D-46` — a saída quando a criação falhou e NÃO vai ser reprocessada. */
  aoRecomecar: () => void
}) {
  const [prioridade, setPrioridade] = useState<Prioridade>(propostaInicial.prioridade)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<Falha | null>(null)
  const p = prioridadePor(prioridade)

  // RF-61/RF-62 (T-418) — a pergunta só existe se o tipo aceitar anexo. `false` enquanto
  // carrega e se a leitura falhar: o mesmo fail-open do servidor (`SC-05b`), pelo mesmo
  // motivo — indisponibilidade de schema não pode virar botão que não abre chamado.
  const [aceitaAnexo, setAceitaAnexo] = useState(false)
  const [declarou, setDeclarou] = useState<Declaracao>(null)
  // 🚨 RF-27 na conversa (`D-38`). Sem coletar isto, tipo com campo obrigatório — 70
  // ("Relatar um bug"), 134, 108, 93 — **não abria chamado** por aqui: o JSM recusava e a
  // pessoa lia "algo deu errado". `null` = ainda carregando; `[]` = sem campo extra OU a
  // leitura falhou, tratados igual pelo mesmo fail-open de sempre.
  const [campos, setCampos] = useState<CampoRequestType[] | null>(null)
  const [valoresCampos, setValoresCampos] = useState<Record<string, string>>({})

  const idsDoSolicitante = camposPreenchidosPeloApp(propostaInicial.tipoChamadoId)
  const camposDoSolicitante = (campos ?? []).filter((c) => idsDoSolicitante.includes(c.fieldId))
  const camposComuns = (campos ?? []).filter((c) => !idsDoSolicitante.includes(c.fieldId))

  useEffect(() => {
    let vivo = true
    api
      .camposDoTipo(propostaInicial.tipoChamadoId)
      .then((r) => {
        if (!vivo) return
        setAceitaAnexo(r.aceitaAnexo)
        setCampos(r.itens)
        setValoresCampos(
          resolverCamposDoSolicitante(
            propostaInicial.tipoChamadoId,
            { conhecido: true, campos: r.itens },
            eu,
          ),
        )
      })
      .catch(() => {
        if (vivo) setCampos([])
      })
    return () => {
      vivo = false
    }
  }, [propostaInicial.tipoChamadoId, eu])

  // A mesma regra do servidor (`obrigatoriosFaltando`), na tela — camada 1 das duas. O
  // servidor recusa de qualquer jeito; isto evita a pessoa descobrir só depois de clicar.
  // `D-46` — e quem compõe a frase é `pendencias.ts`, o mesmo módulo do formulário: aqui
  // também dava para faltar campo E declaração ao mesmo tempo, e a tela só contava uma.
  const pendencias = pendenciasParaAbrir({
    campos: campos ?? [],
    valores: valoresCampos,
    faltaDeclararAnexo: aceitaAnexo && declarou === null,
  })
  const falta = faltaAlgumaCoisa(pendencias)

  async function confirmar() {
    setSalvando(true)
    setErro(null)
    try {
      if (prioridade !== propostaInicial.prioridade) {
        await api.salvarProposta(conversaId, { ...propostaInicial, prioridade })
      }
      aoCriar(
        await api.confirmar(
          conversaId,
          aceitaAnexo ? (declarou ?? undefined) : undefined,
          valoresCampos,
        ),
      )
    } catch (e) {
      setErro(falhaDeCriacao(e, 'Não conseguimos abrir o chamado agora.'))
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

        {/* `RF-18`/`D-53` — o **assunto** decide a fila que recebe o chamado, e confirmar
            sem vê-lo é confirmar o roteamento no escuro. Nunca o id (`RNF-30`): `68` não
            informa ninguém. Sem nome, diz-se isso — inventar rótulo a partir do id seria
            pior, porque pareceria informação. */}
        <dt>Assunto</dt>
        <dd>
          {tipoNome || (
            <span className="dica">não foi possível identificar o assunto agora</span>
          )}
        </dd>

        {/* `D-52` — a área **sempre** aparece, inclusive quando não foi identificada.
            Escondê-la quando é nula tirava da tela justamente o caso em que a pessoa
            precisaria corrigir, e deixava `RF-18` incompleto sem nada indicando. O
            valor mostrado aqui é o que vai para o vínculo: uma fonte só. */}
        <dt>Área</dt>
        <dd>
          {propostaInicial.area || (
            <span className="dica">
              não identificada — você pode corrigir depois de abrir o chamado
            </span>
          )}
        </dd>

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
              {/* ⚠️ Só o rótulo. O critério vinha junto ("Alta — Funcionalidade
                  comprometida, com solução alternativa temporária") e nenhuma
                  largura de select comportava isso: truncava no meio da palavra,
                  escondendo justamente o texto que ajuda a decidir. Ele desceu para
                  a dica, onde aparece inteiro e acompanha a seleção — e é lá que
                  importa, na hora de conferir se a sugestão cabe no caso (RF-16). */}
              {PRIORIDADES.map((op) => (
                <option key={op.valor} value={op.valor}>
                  {op.rotulo}
                </option>
              ))}
            </select>
            <span className="dica">
              {p.criterio}.{' '}
              {prioridade === propostaInicial.prioridade
                ? `Sugerimos ${prioridadePor(propostaInicial.prioridade).rotulo.toLowerCase()} — ajuste se não bate com o seu caso.`
                : `A sugestão era ${prioridadePor(propostaInicial.prioridade).rotulo.toLowerCase()}.`}
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

      {camposDoSolicitante.length > 0 && (
        <fieldset className="grupo-solicitante">
          <legend>
            <span className="eyebrow">De quem é o acesso</span>
            <span className="grupo-solicitante-titulo">Quem vai usar</span>
            <span className="dica">
              Preenchemos com a sua conta. Se o acesso é para outra pessoa, troque o nome e o
              e-mail.
            </span>
          </legend>
          {camposDoSolicitante.map((c) => (
            <CampoDinamico
              key={c.fieldId}
              campo={c}
              valor={valoresCampos[c.fieldId] ?? ''}
              aoMudar={(v) => setValoresCampos((atuais) => ({ ...atuais, [c.fieldId]: v }))}
            />
          ))}
        </fieldset>
      )}

      {camposComuns.length > 0 && (
        <div className="pilha">
          {camposComuns.map((c) => (
            <CampoDinamico
              key={c.fieldId}
              campo={c}
              valor={valoresCampos[c.fieldId] ?? ''}
              aoMudar={(v) => setValoresCampos((atuais) => ({ ...atuais, [c.fieldId]: v }))}
            />
          ))}
        </div>
      )}

      {aceitaAnexo && (
        <PerguntaDeAnexo
          alvo={{ via: 'conversa', conversaId }}
          declarou={declarou}
          aoDeclarar={setDeclarou}
        />
      )}

      {erro && <AvisoDeFalha falha={erro} aoRecomecar={aoRecomecar} />}

      <div className="acoes">
        <button
          type="button"
          className="botao botao-primario"
          onClick={confirmar}
          disabled={salvando || falta}
          // ⚠️ O botão desabilitado precisa DIZER o que falta — TUDO o que falta. Botão
          // morto sem explicação é indistinguível de app quebrado, e explicação que conta
          // só a primeira pendência é pior: a pessoa resolve aquela e o botão continua
          // morto (`D-46`).
          aria-describedby={falta ? 'falta-abrir-recibo' : undefined}
        >
          {salvando ? 'Abrindo…' : 'Abrir chamado'}
        </button>
      </div>
      {falta && (
        <p className="dica" id="falta-abrir-recibo">
          {mensagemDePendencias(pendencias)}
        </p>
      )}
    </section>
  )
}

/**
 * O recibo do chamado aberto — e o caminho de volta, que faltava (`D-46`).
 *
 * ⚠️ **Duas ações, e a segunda não é conveniência.** O recibo era terminal: clicar a aba
 * "Abrir direto" (que já estava ativa) não faz nada, porque é a mesma tela, e só
 * recarregar a página devolvia o formulário. Quem abre um chamado e precisa abrir o
 * segundo — a sequência normal de quem junta pendências — conclui que o app travou.
 *
 * A ordem é a do próximo passo mais provável: acompanhar o que acabou de abrir vem antes
 * de abrir outro, e por isso "Ver meus chamados" fica em contorno e "Abrir outro chamado"
 * em discreto. Nenhum dos dois é destrutivo, então nenhum precisa de confirmação.
 */
export function ChamadoAberto({
  resultado,
  via,
  aoVerChamados,
  aoRecomecar,
}: {
  resultado: ResultadoCriacao
  via: 'conversa' | 'formulario'
  aoVerChamados: () => void
  aoRecomecar: () => void
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
        {/* RF-63 — o que aconteceu com o anexo vem DEPOIS da frase do chamado, nunca
            no lugar dela. A ordem é o que evita a pessoa achar que o chamado falhou. */}
        <ResultadoDoAnexo anexo={resultado.anexo} />
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
          <button type="button" className="botao botao-discreto" onClick={aoRecomecar}>
            Abrir outro chamado
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

        {/* T-084 / RF-31 — o que JÁ está no chamado vem antes da caixa de envio: a
            pessoa chega aqui para conferir se o print chegou, e só depois para mandar
            outro. Ler antes de escrever. */}
        <ArquivosDoChamado
          itens={dados.anexos}
          indisponiveis={dados.anexosIndisponiveis}
        />

        <form className="zona-anexo" onSubmit={anexar}>
          {/* `D-46` aplicado à segunda superfície: o `input[type=file]` sai da tela por
              `clip` — **nunca** `display: none`, que o tiraria da ordem de tabulação — e
              quem aparece é o `label`, que já era o nome acessível do campo. O anel de
              foco é reemitido nele por `:focus-visible +` (`estilos.css`).
              ⚠️ O texto que descrevia o que anexar desceu para a `dica`, apontada por
              `aria-describedby`: com o rótulo virando botão, ele precisa dizer a **ação**
              ("Escolher arquivo"), e o resto é descrição, não nome. */}
          <div className="escolher-arquivo">
            <input
              id="anexo-chamado"
              className="entrada-arquivo"
              type="file"
              multiple
              aria-describedby="dica-anexo-chamado"
              onChange={(e) => setArquivos(Array.from(e.target.files ?? []))}
              disabled={anexando}
            />
            <label htmlFor="anexo-chamado" className="botao botao-contorno rotulo-arquivo">
              Escolher arquivo
            </label>
          </div>
          <span className="dica" id="dica-anexo-chamado">
            Print, planilha ou documento — até 3 arquivos por envio, de no máximo 8 MB
            cada. Quem trabalha o chamado vê os anexos junto com a sua descrição.
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
              <ComentarioDoChamado key={c.id} comentario={c} />
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

/**
 * Tamanho legível — `RF-31`.
 *
 * ⚠️ `null` devolve `null`, nunca `'0 KB'`: o app não sabe o tamanho daquele arquivo, e
 * inventar um número é afirmar sobre o arquivo da pessoa. Arredonda para cima no piso de
 * 1 KB pelo mesmo motivo da lista de envio — `0 KB` num arquivo que existe lê-se como
 * arquivo corrompido.
 */
function tamanhoLegivel(bytes: number | null): string | null {
  if (bytes === null || !Number.isFinite(bytes)) return null
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

/**
 * Extensão em maiúscula, a partir do NOME — `RF-31`.
 *
 * Do nome e não do `tipoDeclarado` de propósito: o tipo é o que alguém escolheu no upload
 * (é por isso que `D-11` não confia nele), e `application/octet-stream` na tela não diz
 * nada a ninguém. `PNG` diz.
 */
function extensaoLegivel(nomeArquivo: string): string | null {
  const ponto = nomeArquivo.lastIndexOf('.')
  if (ponto <= 0 || ponto === nomeArquivo.length - 1) return null
  const ext = nomeArquivo.slice(ponto + 1)
  return ext.length <= 5 ? ext.toUpperCase() : null
}

/**
 * Os arquivos que já estão no chamado — `RF-31`, T-084.
 *
 * ⚠️ **Três estados, três frases**, e trocar uma pela outra é o defeito: "nenhum arquivo
 * anexado" e "não conseguimos confirmar" são afirmações opostas, e a errada faz a pessoa
 * mandar o print de novo — o mesmo raciocínio de `comentariosIndisponiveis`, na seção de
 * cima. A ordem é a do risco: a dúvida é dita antes de qualquer lista.
 *
 * O nome do arquivo **é** o link (texto descritivo é o que leitor de tela anuncia); o
 * tipo e o tamanho ficam numa linha secundária, e a seta é decorativa.
 */
function ArquivosDoChamado({
  itens,
  indisponiveis,
}: {
  itens: readonly AnexoDoChamado[]
  indisponiveis: boolean
}) {
  // ⚠️ **A dúvida deixou de esconder a lista** (`D-51`). Enquanto a única fonte era a
  // Atlassian, `indisponiveis` significava "não sei de nada" e devolver só a frase era
  // honesto. Agora o que o app enviou é sabido por outra via — e sumir com o print da
  // pessoa porque não deu para confirmar o *do time* seria o defeito medido no `GN-6898`
  // com outra roupa. A dúvida vira nota **ao lado** da lista, e vem antes dela.
  if (itens.length === 0) {
    return (
      <p className="dica">
        {indisponiveis
          ? 'Não conseguimos confirmar os anexos deste chamado agora. Isso não significa que não há nenhum — tente recarregar em instantes.'
          : 'Nenhum arquivo anexado a este chamado ainda.'}
      </p>
    )
  }
  return (
    <>
      {indisponiveis && (
        <p className="dica">
          Pode haver arquivos enviados pelo time que não conseguimos confirmar agora. Os
          seus estão listados abaixo.
        </p>
      )}
      <ul className="arquivos-do-chamado">
        {itens.map((a) => {
          const detalhes = [
            // A origem é dita em **palavras**, nunca só por posição ou cor (regra 9): quem
            // mandou o arquivo precisa reconhecê-lo, e "o time respondeu com um anexo" é
            // outra notícia. Ausente = resposta antiga do servidor; aí não se afirma nada.
            // ⚠️ `goatlas` **não** é uma das duas: a transcrição de `RF-23` não foi
            // enviada por ninguém, e chamá-la de "você enviou" ou "do time" seria a tela
            // afirmando autoria falsa — o defeito de `D-43`, na versão arquivo.
            a.origem === 'voce'
              ? 'você enviou'
              : a.origem === 'time'
                ? 'do time'
                : a.origem === 'goatlas'
                  ? 'gerado pelo goatlas'
                  : null,
            extensaoLegivel(a.nomeArquivo),
            tamanhoLegivel(a.tamanhoBytes),
          ]
            .filter((p): p is string => p !== null)
            .join(' · ')
          return (
            <li key={a.nomeArquivo}>
              {/* 🚨 **O `download` SAIU** (`D-62`). Ele forçava "salvar em disco" mesmo nos
                  tipos que o servidor já entrega `inline` (`D-11`: PNG, JPEG, WEBP, GIF,
                  PDF e — a partir do `D-62` — o `.md` da transcrição), então clicar no
                  próprio print baixava um arquivo em vez de mostrá-lo. Quem decide continua
                  sendo o servidor, pela allowlist: tipo fora dela desce como anexo de
                  qualquer forma, e aí a aba nova se fecha sozinha.
                  ⚠️ Abre em **outra aba** de propósito, como o link de página do agente: a
                  conversa vive em estado de React, e navegar na mesma aba destruiria a tela. */}
              <a className="arquivo" href={a.url} target="_blank" rel="noopener noreferrer">
                <span className="arquivo-nome">{a.nomeArquivo}</span>
                {detalhes && <span className="dica">{detalhes}</span>}
                <span className="arquivo-seta" aria-hidden="true">
                  ↗
                </span>
              </a>
            </li>
          )
        })}
      </ul>
    </>
  )
}

/**
 * Um comentário na conversa do chamado — `D-43`.
 *
 * ## O que esta tela pode afirmar, e o que não pode
 *
 * Sob proxy total (`D-01`) o `autorNome` que volta do JSM é o da conta que
 * **registrou** o comentário, e para tudo que sai do goatlas essa conta é a de
 * serviço. A tela imprimia esse nome como autor: o comentário da própria pessoa
 * aparecia assinado por um colega, com o prefixo de `D-13` logo abaixo dizendo
 * outro nome. A leitura natural — *alguém escreveu em meu nome* — é a pior possível.
 *
 * Então a tela só afirma o que o servidor sabe:
 *
 * - **`doSolicitante`** → "Você". O servidor classificou pelo prefixo que o próprio
 *   app escreveu, e o chamado é isolado por e-mail (`RF-30`): não há outro caminho
 *   para um comentário prefixado existir aqui.
 * - **Caso contrário** → "Resposta do time", que é verdade mesmo se quem respondeu
 *   usou a conta de serviço pelo portal. E o nome da conta continua na tela, uma
 *   linha abaixo, enunciado como **registro** (`Conta que registrou: …`) e não como
 *   autoria — apagá-lo consertaria o caso da conta de serviço e estragaria o caso
 *   comum, o agente que respondeu de verdade com a conta dele.
 *
 * ## Acessibilidade
 *
 * "É seu" é dito por **três** sinais e nenhum deles é só cor: o rótulo em palavras, o
 * lado da coluna e a bolha (o mesmo vocabulário que a tela de conversa já ensina —
 * `.fala-usuario`). Nenhuma animação entra aqui, então não há `prefers-reduced-motion`
 * a respeitar; o `<article>` com `<h3>` dá ao leitor de tela o mesmo agrupamento que o
 * olho recebe da moldura.
 */
function ComentarioDoChamado({ comentario }: { comentario: ComentarioPublico }) {
  if (comentario.doSolicitante) {
    return (
      <article className="comentario comentario-meu">
        <h3 className="autor">Você</h3>
        <p className="fala-usuario">{comentario.corpo}</p>
      </article>
    )
  }
  return (
    <article className="comentario">
      <h3 className="autor">Resposta do time</h3>
      {comentario.autorNome && (
        // ⚠️ "Conta que registrou" e não "escrito por": é o que o Jira guarda, e sob
        // `D-01` a conta pode não ser a pessoa. Enunciar o registro é honesto nos dois
        // casos; enunciar autoria é honesto só em um.
        <p className="autor-registro">Conta que registrou: {comentario.autorNome}</p>
      )}
      <TextoDoAgente texto={comentario.corpo} />
    </article>
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
export function TelaFormulario(props: { eu: Identidade; aoAbrirChamado: () => void }) {
  // `D-46` — mesma casca da conversa, e pela mesma razão: recomeçar é remontar. Aqui a
  // remontagem é o que garante a chave de idempotência NOVA (o `useRef` abaixo), sem a
  // qual o "segundo chamado" cairia na submissão do primeiro (`RF-24`) e a pessoa
  // receberia de volta o chamado que já tinha.
  const [sessao, setSessao] = useState(0)
  return (
    <FormularioEmCurso key={sessao} {...props} aoRecomecar={() => setSessao((s) => s + 1)} />
  )
}

function FormularioEmCurso({
  eu,
  aoAbrirChamado,
  aoRecomecar,
}: {
  eu: Identidade
  aoAbrirChamado: () => void
  aoRecomecar: () => void
}) {
  const [tipos, setTipos] = useState<TipoChamado[] | null>(null)
  const [titulo, setTitulo] = useState('')
  const [descricao, setDescricao] = useState('')
  const [tipoChamadoId, setTipo] = useState('')
  const [prioridade, setPrioridade] = useState<Prioridade>('normal')
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<Falha | null>(null)
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
  // RF-61/RF-62 (T-417) — o schema também diz se o tipo aceita arquivo.
  const [aceitaAnexo, setAceitaAnexo] = useState(false)
  const [declarou, setDeclarou] = useState<Declaracao>(null)

  useEffect(() => {
    api
      .tiposChamado()
      .then((r) => {
        setTipos(r.itens)
        if (r.itens[0]) setTipo(r.itens[0].id)
      })
      .catch(() => setTipos([]))
  }, [])

  // RF-21 / D-36 — quais campos deste tipo o app preenche a partir do login. Vem do
  // MESMO mapa que o servidor usa: uma lista escrita à parte aqui divergiria em
  // silêncio, e o sintoma seria a tela mostrando um campo como "seu" enquanto o
  // servidor o trata como campo comum (ou o contrário).
  const idsDoSolicitante = camposPreenchidosPeloApp(tipoChamadoId)
  const camposDoSolicitante = (campos ?? []).filter((c) => idsDoSolicitante.includes(c.fieldId))
  const camposComuns = (campos ?? []).filter((c) => !idsDoSolicitante.includes(c.fieldId))

  useEffect(() => {
    if (!tipoChamadoId) return
    setCampos(null)
    setValoresCampos({})
    // ⚠️ Trocar de tipo zera a declaração: a pergunta que ela respondia era de outro
    // tipo de chamado. Manter o "não tenho" de antes seria registrar uma resposta que
    // ninguém deu para esta pergunta.
    setAceitaAnexo(false)
    setDeclarou(null)
    api
      .camposDoTipo(tipoChamadoId)
      .then((r) => {
        setCampos(r.itens)
        setAceitaAnexo(r.aceitaAnexo)
        // Pré-preenche o que o app sabe. É PADRÃO, não imposição: a pessoa edita, e o
        // servidor respeita o que ela mandar (`FR-3`). Quem abriu continua sendo a
        // identidade da sessão, que não sai deste corpo.
        const meus = resolverCamposDoSolicitante(
          tipoChamadoId,
          { conhecido: true, campos: r.itens },
          eu,
        )
        if (Object.keys(meus).length > 0) setValoresCampos(meus)
      })
      .catch(() => setCampos([]))
  }, [tipoChamadoId, eu])

  // 🚨 `D-46` — a mesma composição do recibo da conversa, e aqui ela **inclui os campos
  // fixos**. A frase antiga era uma constante que afirmava "É a única coisa que falta", e
  // com título, descrição e os obrigatórios do tipo todos vazios ela era simplesmente
  // falsa: faltavam quatro coisas. Quem segurava o envio era o `required` do navegador —
  // que funciona, mas só depois de a tela já ter mentido.
  const pendencias = pendenciasParaAbrir({
    fixos: [
      { rotulo: 'Título', valor: titulo },
      { rotulo: 'O que está acontecendo', valor: descricao },
    ],
    campos: campos ?? [],
    valores: valoresCampos,
    faltaDeclararAnexo: aceitaAnexo && declarou === null,
  })
  const falta = faltaAlgumaCoisa(pendencias)

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
          ...(aceitaAnexo && declarou !== null ? { declarouAnexo: declarou } : {}),
        }),
      )
    } catch (err) {
      setErro(falhaDeCriacao(err, 'Não conseguimos abrir o chamado agora.'))
    } finally {
      setEnviando(false)
    }
  }

  if (resultado)
    return (
      <ChamadoAberto
        resultado={resultado}
        via="formulario"
        aoVerChamados={aoAbrirChamado}
        aoRecomecar={aoRecomecar}
      />
    )

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

      {camposDoSolicitante.length > 0 && (
        <fieldset className="grupo-solicitante">
          <legend>
            <span className="eyebrow">De quem é o acesso</span>
            <span className="grupo-solicitante-titulo">Quem vai usar</span>
            <span className="dica">
              Preenchemos com a sua conta. Se o acesso é para outra pessoa, troque o nome e o
              e-mail.
            </span>
          </legend>
          {camposDoSolicitante.map((c) => (
            <CampoDinamico
              key={c.fieldId}
              campo={c}
              valor={valoresCampos[c.fieldId] ?? ''}
              aoMudar={(v) => setValoresCampos((atuais) => ({ ...atuais, [c.fieldId]: v }))}
            />
          ))}
        </fieldset>
      )}

      {camposComuns.length > 0 && (
        <div className="pilha">
          {camposComuns.map((c) => (
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

      {aceitaAnexo && (
        <PerguntaDeAnexo
          alvo={{ via: 'formulario', chaveIdempotencia: chave.current }}
          declarou={declarou}
          aoDeclarar={setDeclarou}
        />
      )}

      {erro && <AvisoDeFalha falha={erro} aoRecomecar={aoRecomecar} />}

      <div className="acoes">
        <button
          type="submit"
          className="botao botao-primario"
          disabled={enviando || falta}
          aria-describedby={falta ? 'falta-abrir-form' : undefined}
        >
          {enviando ? 'Abrindo…' : 'Abrir chamado'}
        </button>
      </div>
      {falta && (
        <p className="dica" id="falta-abrir-form">
          {mensagemDePendencias(pendencias)}
        </p>
      )}
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
