/**
 * A aba **Investigador** — spec 009 (`FR-11` a `FR-17`) e spec 013 (`FR-21` a `FR-32`).
 *
 * ## A tese da tela
 *
 * Isto não é um painel. Painel responde *"como estamos?"*, e essa pergunta já tem casa: o
 * console de administração (`D-25`). Aqui a pergunta é outra e é sempre a mesma — **"o que
 * aconteceu com esta pessoa?"** —, e ela se responde em **ordem**, não em agregado. Por isso
 * o elemento central da tela é uma **linha do tempo**, e não um mosaico de números.
 *
 * ## O que a spec 013 mudou, e por quê
 *
 * A 009 entregou o registro e esta tela o **despejava**: o `tipo` do evento saía cru, em
 * snake_case, e o `dados_json` era renderizado num `<pre>` **fora de qualquer `<details>`** —
 * sempre aberto, para os catorze eventos de um turno, com o histórico inteiro da conversa
 * dentro de cada `ia_chat`. O relato foi literal: *"apenas um conjunto de logs bizarros"*.
 *
 * Nada disso tocou no que é **gravado**. O que mudou:
 *
 * 1. **A unidade é o turno** (`turnos.ts`), agrupando por `requisicao_id` — um campo que já
 *    era gravado em todo evento e que nenhuma tela lia.
 * 2. **Cada evento é traduzido** (`eventos.ts`): título em português, linhas `rótulo → valor`,
 *    e o texto longo em bloco que declara o tamanho antes do conteúdo.
 * 3. 🚨 **O JSON cru mora dentro de um `<details>` fechado.** Ele não some — é a evidência —,
 *    mas deixa de ser o que se lê primeiro.
 * 4. **O cartão ganhou diff e trilha** (`proposta.ts`): o que a IA mudou, turno a turno.
 * 5. **A página sobrevive a falha parcial, se atualiza sozinha e tem endereço por sessão.**
 *
 * ## O vocabulário visual
 *
 * A **espinha lime** é o mesmo traço da leitura de documentação (`estilos.css`, `.doc`), e
 * ali ele diz *"daqui para a direita o conteúdo é de outra origem"*. É exatamente o que ele
 * diz aqui: à direita da espinha está o registro, não a opinião do app.
 *
 * ⚠️ **Origem é FORMA + PALAVRA, nunca cor.** O piso de a11y do projeto (regra 9) proíbe
 * estado só por cor, e a identidade GoGroup tem duas cores de acento — não seis.
 *
 * ⚠️ **Nada aqui é editável.** Escrita numa tela de investigação é a forma de perder a
 * evidência que se foi buscar; quem limpa é a retenção (`FR-19`).
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  api,
  type CorposDaRequisicao,
  type DetalheDeSessao,
  type EventoRegistrado,
  type RequisicaoRegistrada,
  type ResumoInvestigador,
  type SessaoInvestigada,
} from '../api'
import { Aviso, Vazio } from '../componentes'
import { aplicarRecorte, PARADA_HA_MINUTOS } from '@/lib/investigador/leitura'
import { contagem, descreverEvento, MOTIVOS_SEM_PROPOSTA, tamanho } from './eventos'
import { agruparEmTurnos, resumirChamadas, type Turno } from './turnos'
import { compararPropostas, trilhaDoCartao, type MudancaDeCampo, type VersaoDoCartao } from './proposta'

/** As duas visões da aba. Sessão é o padrão porque é a pergunta que se faz primeiro. */
type Visao = 'sessoes' | 'requisicoes'

/** De quanto em quanto tempo a lista se atualiza sozinha — `FR-28`. */
const INTERVALO_MS = 10_000

/**
 * Origem → como ela se apresenta.
 *
 * ⚠️ A `forma` vira `data-forma` no CSS e desenha o marcador na espinha. Origem nova sem
 * entrada aqui cai no rótulo cru, que é feio e correto: melhor um nome técnico visível que
 * um evento invisível.
 */
const ORIGENS: Readonly<Record<string, { rotulo: string; forma: string }>> = {
  usuario: { rotulo: 'Pessoa', forma: 'cheio' },
  ia: { rotulo: 'IA', forma: 'losango' },
  servidor: { rotulo: 'Servidor', forma: 'quadrado' },
  atlassian: { rotulo: 'Atlassian', forma: 'vazado' },
  teamguide: { rotulo: 'TeamGuide', forma: 'barra' },
  ocr: { rotulo: 'OCR', forma: 'cruz' },
}

/** `FR-13` — os recortes que respondem às perguntas caras, escritos como perguntas. */
const RECORTES: readonly { valor: string; rotulo: string }[] = [
  { valor: '', rotulo: 'Todas' },
  { valor: 'sem_proposta', rotulo: 'Sem cartão' },
  { valor: 'com_bloqueio', rotulo: 'Com bloqueio' },
  { valor: 'com_erro', rotulo: 'Com erro de API' },
  { valor: 'abandonada', rotulo: 'Sem chamado' },
  { valor: 'parada', rotulo: `Parada há +${PARADA_HA_MINUTOS} min` },
]

export function TelaInvestigador({
  sessaoAberta = null,
  aoAbrirSessao,
}: {
  /** A sessão que a URL pede (`FR-29`). `null` é a lista. */
  sessaoAberta?: string | null
  aoAbrirSessao?: (id: string | null) => void
}) {
  const [visao, setVisao] = useState<Visao>('sessoes')
  const [resumo, setResumo] = useState<ResumoInvestigador | null>(null)
  const [sessoes, setSessoes] = useState<readonly SessaoInvestigada[] | null>(null)
  const [ligado, setLigado] = useState<boolean | null>(null)
  const [recorte, setRecorte] = useState('')
  const [email, setEmail] = useState('')
  const [busca, setBusca] = useState('')
  /**
   * O que NÃO carregou na última rodada.
   *
   * 🚨 **Sem isto, lista vazia por ERRO é indistinguível de lista vazia de verdade** — e o
   * godocs mediu o caso extremo: "0 submetidos" com 289 edições na mesma tela, o que é
   * impossível (todo reenvio pressupõe submissão). A tela antiga fazia pior: uma falha do
   * resumo trocava a página **inteira** por um aviso, escondendo as listas que responderam.
   */
  const [falhas, setFalhas] = useState<readonly string[]>([])
  const [atualizadoEm, setAtualizadoEm] = useState<Date | null>(null)
  /**
   * ⚠️ **Guarda de requisição em voo.** O tique é de 10 s e uma rodada lenta passa disso; sem
   * a guarda as chamadas se **empilham** sobre um endpoint já lento — a fila de `canceled`
   * que o godocs mediu nos logs da plataforma. `ref`, não estado: mudar isto não redesenha.
   */
  const emVoo = useRef(false)

  const carregar = useCallback(async () => {
    if (emVoo.current) return
    emVoo.current = true
    try {
      /*
        ⚠️ `allSettled`, nunca `all`: as duas fontes são independentes, e com `all` a rejeição
        de **qualquer** uma caía no `catch` e zerava as duas. O dado velho fica na tela,
        marcado como velho — zero nunca é afirmado por falha.
      */
      const [r, s] = await Promise.allSettled([
        api.investigadorResumo(),
        api.investigadorSessoes(busca ? { email: busca } : {}),
      ])
      if (r.status === 'fulfilled') setResumo(r.value)
      if (s.status === 'fulfilled') {
        setSessoes(s.value.itens)
        setLigado(s.value.ligado)
      }
      setFalhas(
        [
          r.status === 'rejected' ? 'o resumo' : null,
          s.status === 'rejected' ? 'as sessões' : null,
        ].filter((x): x is string => x !== null),
      )
      setAtualizadoEm(new Date())
    } finally {
      emVoo.current = false
    }
  }, [busca])

  useEffect(() => {
    void carregar()
    const id = setInterval(() => void carregar(), INTERVALO_MS)
    return () => clearInterval(id)
  }, [carregar])

  /*
    ⚠️ O recorte é aplicado **aqui**, com o predicado do servidor (`aplicarRecorte`), e não por
    uma consulta nova. Duas razões: contar quantas sessões há em cada recorte (`FR-32`) exige
    o conjunto inteiro, e reescrever a condição na tela seria a segunda regra que diverge em
    silêncio. O filtro por pessoa continua no `WHERE` do servidor.
  */
  const agora = atualizadoEm?.toISOString() ?? new Date(0).toISOString()
  const todas = sessoes ?? []
  const visiveis = aplicarRecorte(todas, recorte || null, agora)

  return (
    <div className="investigador">
      <header className="inv-topo">
        <span className="eyebrow">Somente admin</span>
        <h1 className="titulo-secao">Investigador</h1>
        <p className="dica">
          O que a pessoa mandou, o que a IA decidiu, o que o formulário virou e o que saiu
          daqui para o Jira — na ordem em que aconteceu.
        </p>
        <p className="inv-estado">
          {ligado === null ? 'Carregando' : ligado ? 'Registrando' : 'Registro desligado'}
          {resumo && (
            <>
              {` · guarda ${resumo.retencaoDias} dias · ${resumo.totalEventos.toLocaleString('pt-BR')} eventos`}
            </>
          )}
          {atualizadoEm && ` · atualizado às ${atualizadoEm.toLocaleTimeString('pt-BR')}`}
        </p>
      </header>

      {falhas.length > 0 && (
        <Aviso atencao>
          Não consegui carregar {falhas.join(' e ')} na última tentativa. O que está na tela é
          o que carregou antes — <strong>não leia os números como zero</strong>. A próxima
          atualização automática tenta de novo.
        </Aviso>
      )}

      {ligado === false && (
        <Aviso atencao>
          O registro está desligado (<code>investigador_ligado</code>). Nada novo está sendo
          gravado — o que aparece abaixo é o que ficou de antes.
        </Aviso>
      )}

      {resumo && <FaixaDeResumo resumo={resumo} />}

      <nav className="inv-visoes" aria-label="O que investigar">
        {(
          [
            ['sessoes', 'Sessões'],
            ['requisicoes', 'Chamadas de API'],
          ] as const
        ).map(([v, rotulo]) => (
          <button
            key={v}
            type="button"
            className="inv-visao"
            aria-current={visao === v ? 'true' : undefined}
            onClick={() => {
              setVisao(v)
              aoAbrirSessao?.(null)
            }}
          >
            {rotulo}
          </button>
        ))}
      </nav>

      {visao === 'sessoes' &&
        (sessaoAberta ? (
          <Detalhe conversaId={sessaoAberta} aoVoltar={() => aoAbrirSessao?.(null)} />
        ) : (
          <ListaDeSessoes
            todas={todas}
            visiveis={visiveis}
            carregando={sessoes === null}
            agora={agora}
            recorte={recorte}
            aoTrocarRecorte={setRecorte}
            email={email}
            aoDigitarEmail={setEmail}
            busca={busca}
            aoBuscar={setBusca}
            aoAbrir={(id) => aoAbrirSessao?.(id)}
          />
        ))}
      {visao === 'requisicoes' && <ListaDeRequisicoes />}
    </div>
  )
}

/**
 * A faixa do topo — `FR-17`.
 *
 * ⚠️ **Faixa, não cartões grandes.** Estes números orientam; a tela é sobre o que vem depois
 * deles. Cartões do tamanho de uma seção diriam o contrário.
 */
function FaixaDeResumo({ resumo }: { resumo: ResumoInvestigador }) {
  return (
    <dl className="inv-faixa">
      <Numero rotulo="Chamadas" valor={resumo.totalRequisicoes.toLocaleString('pt-BR')} />
      <Numero
        rotulo="Com erro"
        // `null` é "ainda não deu para medir", nunca `0%` — que se leria como "nada falha".
        valor={resumo.taxaErro === null ? 'sem dados' : `${resumo.taxaErro}%`}
        detalhe={resumo.totalErros > 0 ? `${resumo.totalErros} chamadas` : undefined}
      />
      <Numero
        rotulo="Duração média"
        valor={resumo.duracaoMediaMs === null ? 'sem dados' : formatarMs(resumo.duracaoMediaMs)}
      />
      <Numero rotulo="Acima de 5 s" valor={resumo.lentas.toLocaleString('pt-BR')} />
      {/* Vírgula decimal, como todo número desta tela (regra 4). */}
      <Numero rotulo="Custo de IA" valor={dinheiro(resumo.custoIaUsd)} />
    </dl>
  )
}

function Numero({
  rotulo,
  valor,
  detalhe,
}: {
  rotulo: string
  valor: string
  detalhe?: string | undefined
}) {
  return (
    <div className="inv-numero">
      <dt>{rotulo}</dt>
      <dd>
        {valor}
        {detalhe && <small>{detalhe}</small>}
      </dd>
    </div>
  )
}

function ListaDeSessoes({
  todas,
  visiveis,
  carregando,
  agora,
  recorte,
  aoTrocarRecorte,
  email,
  aoDigitarEmail,
  busca,
  aoBuscar,
  aoAbrir,
}: {
  todas: readonly SessaoInvestigada[]
  visiveis: readonly SessaoInvestigada[]
  carregando: boolean
  agora: string
  recorte: string
  aoTrocarRecorte: (v: string) => void
  email: string
  aoDigitarEmail: (v: string) => void
  busca: string
  aoBuscar: (v: string) => void
  aoAbrir: (id: string) => void
}) {
  return (
    <section className="inv-secao">
      <div className="inv-filtros">
        <div className="inv-chips" role="group" aria-label="Recorte das sessões">
          {RECORTES.map((r) => {
            // ⚠️ O número sai do MESMO predicado que filtra (`aplicarRecorte`). Contar de um
            // jeito e filtrar de outro produz "3" ao lado de uma lista de quatro.
            const quantas = aplicarRecorte(todas, r.valor || null, agora).length
            return (
              <button
                key={r.valor}
                type="button"
                className="inv-chip"
                aria-pressed={recorte === r.valor}
                onClick={() => aoTrocarRecorte(r.valor)}
              >
                {r.rotulo}
                <span className="inv-chip-conta">{quantas}</span>
              </button>
            )
          })}
        </div>
        <form
          className="inv-busca"
          onSubmit={(e) => {
            e.preventDefault()
            aoBuscar(email.trim())
          }}
        >
          <label htmlFor="inv-email">Filtrar por pessoa</label>
          <input
            id="inv-email"
            type="search"
            value={email}
            placeholder="nome@gocase.com"
            onChange={(e) => aoDigitarEmail(e.target.value)}
          />
          <button type="submit">Filtrar</button>
        </form>
      </div>

      {/*
        Os filtros ativos, removíveis — `FR-32`. Existe porque o recorte e a busca ficam em
        controles diferentes: com a lista curta, "não tem nada aqui" e "eu esqueci um filtro
        ligado" têm exatamente a mesma cara.
      */}
      {(recorte !== '' || busca !== '') && (
        <div className="inv-filtros-ativos">
          <span className="dica">Filtrando por:</span>
          {recorte !== '' && (
            <button type="button" className="inv-filtro-ativo" onClick={() => aoTrocarRecorte('')}>
              {RECORTES.find((r) => r.valor === recorte)?.rotulo ?? recorte}
              <span aria-hidden="true">×</span>
            </button>
          )}
          {busca !== '' && (
            <button
              type="button"
              className="inv-filtro-ativo"
              onClick={() => {
                aoDigitarEmail('')
                aoBuscar('')
              }}
            >
              {busca}
              <span aria-hidden="true">×</span>
            </button>
          )}
        </div>
      )}

      {carregando && <p className="carregando">Carregando as sessões…</p>}
      {!carregando && visiveis.length === 0 && (
        <Vazio
          titulo="Nenhuma sessão neste recorte"
          texto="Ou ninguém usou o app com este filtro, ou o registro estava desligado no período."
        />
      )}

      <ul className="inv-sessoes">
        {visiveis.map((s) => (
          <LinhaDeSessao key={s.conversaId} sessao={s} aoAbrir={() => aoAbrir(s.conversaId)} />
        ))}
      </ul>
    </section>
  )
}

/**
 * Uma sessão.
 *
 * ⚠️ **As marcas são PALAVRAS, e a mais importante é a ausência do cartão.** Uma conversa
 * longa sem cartão é o caso de 14/08/2026, e ele não tem sintoma nenhum — nenhum erro,
 * nenhum status 500. Aqui ele é a primeira coisa que se lê na linha.
 */
export function LinhaDeSessao({
  sessao: s,
  aoAbrir,
}: {
  sessao: SessaoInvestigada
  aoAbrir: () => void
}) {
  const semCartao = !s.temProposta && s.mensagensDaPessoa > 0
  return (
    <li className="inv-sessao">
      <button type="button" className="inv-sessao-alvo" onClick={aoAbrir}>
        <span className="inv-sessao-topo">
          <strong>{s.solicitanteEmail}</strong>
          <time dateTime={s.criadoEm}>{formatarQuando(s.criadoEm)}</time>
        </span>
        <span className="inv-sessao-marcas">
          {/* ⚠️ Concordância, não capricho (regra 4): "1 mensagens" apareceu na staging em
              14/08 e é o tipo de erro que a suíte não pega e que todo leitor vê. */}
          <Marca>{contagem(s.mensagensDaPessoa, 'mensagem', 'mensagens')}</Marca>
          {s.issueKey ? (
            <Marca destaque>Chamado {s.issueKey}</Marca>
          ) : (
            <Marca>Sem chamado</Marca>
          )}
          {semCartao && <Marca destaque>Sem cartão</Marca>}
          {s.bloqueios > 0 && (
            <Marca>
              {contagem(s.bloqueios, 'bloqueio', 'bloqueios')}
              {s.overrides > 0 ? ` · ${contagem(s.overrides, 'override', 'overrides')}` : ''}
            </Marca>
          )}
          {s.errosDeApi > 0 && (
            <Marca destaque>{contagem(s.errosDeApi, 'erro de API', 'erros de API')}</Marca>
          )}
          {s.duracaoMaximaMs !== null && s.duracaoMaximaMs >= 5000 && (
            <Marca>Turno mais lento: {formatarMs(s.duracaoMaximaMs)}</Marca>
          )}
        </span>
        {semCartao && s.motivoSemProposta && (
          <span className="inv-motivo">
            {MOTIVOS_SEM_PROPOSTA[s.motivoSemProposta] ?? s.motivoSemProposta}
          </span>
        )}
      </button>
    </li>
  )
}

function Marca({ children, destaque }: { children: React.ReactNode; destaque?: boolean }) {
  return <span className={destaque ? 'inv-marca inv-marca-destaque' : 'inv-marca'}>{children}</span>
}

/** O detalhe de uma sessão: a linha do tempo, a conversa e as chamadas daquele caso. */
function Detalhe({ conversaId, aoVoltar }: { conversaId: string; aoVoltar: () => void }) {
  const [dados, setDados] = useState<DetalheDeSessao | null>(null)
  const [falhou, setFalhou] = useState(false)

  useEffect(() => {
    setDados(null)
    setFalhou(false)
    api
      .investigadorSessao(conversaId)
      .then(setDados)
      .catch(() => setFalhou(true))
  }, [conversaId])

  return (
    <section className="inv-secao">
      <button type="button" className="inv-voltar" onClick={aoVoltar}>
        <span aria-hidden="true">←</span> Todas as sessões
      </button>

      {falhou && <Aviso atencao>Não consegui carregar esta sessão.</Aviso>}
      {!falhou && dados === null && <p className="carregando">Carregando a linha do tempo…</p>}

      {dados && <LinhaDoTempo dados={dados} conversaId={conversaId} />}
    </section>
  )
}

/** A linha do tempo da sessão, turno a turno — `FR-21`. */
export function LinhaDoTempo({
  dados,
  conversaId,
}: {
  dados: DetalheDeSessao
  conversaId?: string
}) {
  const turnos = agruparEmTurnos(dados.eventos, dados.requisicoes)
  const trilha = trilhaDoCartao(dados.eventos)
  return (
    <>
      <div className="inv-detalhe-topo">
        <h2 className="titulo-secao">Linha do tempo</h2>
        <BotaoExportar dados={dados} conversaId={conversaId ?? ''} turnos={turnos} />
      </div>

      {trilha.length > 0 && <TrilhaDoCartao trilha={trilha} />}

      {turnos.length === 0 ? (
        <Vazio
          titulo="Nenhum evento registrado nesta conversa"
          texto="Ela é anterior ao Investigador, ou o registro estava desligado quando aconteceu."
        />
      ) : (
        <ol className="inv-turnos">
          {turnos.map((t) => (
            <BlocoDeTurno key={t.chave} turno={t} />
          ))}
        </ol>
      )}

      {/*
        ⚠️ A conversa vem da tabela **de produção**, não do registro — é a mesma que o
        modelo lê e que a transcrição de `D-54` anexa ao chamado. Fica fechada porque a
        linha do tempo acima já mostra o que a pessoa escreveu; o que só existe aqui é o
        resultado das tools, do jeito que o modelo o recebeu.
      */}
      <details className="inv-bloco">
        <summary>A conversa como o modelo a leu ({dados.mensagens.length} mensagens)</summary>
        <ul className="inv-mensagens">
          {dados.mensagens.map((m) => (
            <li key={m.id}>
              <span className="inv-papel">
                {m.papel === 'user'
                  ? 'pessoa'
                  : m.papel === 'assistant'
                    ? 'agente'
                    : `ferramenta${m.tool_nome ? ` · ${m.tool_nome}` : ''}`}
              </span>
              <TextoLongo texto={m.conteudo} />
            </li>
          ))}
        </ul>
      </details>

      <h2 className="titulo-secao">Chamadas de API desta sessão</h2>
      <ListaCrua itens={dados.requisicoes} />
    </>
  )
}

/**
 * A trilha do cartão — `FR-26`.
 *
 * ⚠️ **Lê os eventos, nunca a conversa.** A tabela `conversas` guarda só o **último** estado;
 * *"em que turno o assunto mudou?"* só tem resposta no registro.
 */
function TrilhaDoCartao({ trilha }: { trilha: readonly VersaoDoCartao[] }) {
  return (
    <section className="inv-trilha">
      <h3>Evolução do cartão</h3>
      <ol>
        {trilha.map((v) => (
          <li key={v.numero}>
            <div className="inv-trilha-cabeca">
              <span className="inv-trilha-versao">v{v.numero}</span>
              <time dateTime={v.quando}>{formatarHora(v.quando)}</time>
              {v.prioridade && <Marca>{v.prioridade}</Marca>}
              {v.assunto && <Marca>assunto {v.assunto}</Marca>}
              {v.forcada && <Marca destaque>montado a pedido dela</Marca>}
            </div>
            {v.titulo && <p className="inv-trilha-titulo">{v.titulo}</p>}
            {v.numero === 1 ? (
              <p className="dica">Primeira versão — não há o que comparar.</p>
            ) : (
              <TabelaDeDiff mudancas={v.mudancas} />
            )}
          </li>
        ))}
      </ol>
    </section>
  )
}

/**
 * O antes×depois de uma rederivação — `FR-25`.
 *
 * ⚠️ **Lista vazia é resposta, e ela é dita em palavras.** Uma tabela de diff vazia se lê
 * como defeito de carregamento (`ScB-02`).
 */
function TabelaDeDiff({ mudancas }: { mudancas: readonly MudancaDeCampo[] }) {
  if (mudancas.length === 0) return <p className="dica">A IA não mudou nada nesta versão.</p>
  const curtas = mudancas.filter((m) => !m.longo)
  const longas = mudancas.filter((m) => m.longo)
  return (
    <div className="inv-diff">
      {curtas.length > 0 && (
        <table>
          <thead>
            <tr>
              <th scope="col">Campo</th>
              <th scope="col">Antes</th>
              <th scope="col">Depois</th>
            </tr>
          </thead>
          <tbody>
            {curtas.map((m) => (
              <tr key={m.rotulo}>
                <th scope="row">
                  {m.rotulo}
                  {/* Estado em PALAVRA, nunca só em cor (regra 9). */}
                  <span className="inv-diff-status">{m.status}</span>
                </th>
                <td>{m.antes ?? '—'}</td>
                <td>{m.depois ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {longas.map((m) => (
        <details key={m.rotulo} className="inv-bloco-texto">
          <summary>
            {m.rotulo}
            <span className="inv-medida">{` · ${m.status}`}</span>
          </summary>
          <div className="inv-diff-longo">
            <div>
              <h4>Antes</h4>
              <pre>{m.antes ?? '—'}</pre>
            </div>
            <div>
              <h4>Depois</h4>
              <pre>{m.depois ?? '—'}</pre>
            </div>
          </div>
        </details>
      ))}
    </div>
  )
}

/**
 * Um turno.
 *
 * ⚠️ O cabeçalho responde **antes de abrir**: quanto durou, quanto custou, que ferramentas
 * rodaram, quanto do tempo foi espera por terceiro e o que o turno produziu.
 */
function BlocoDeTurno({ turno: t }: { turno: Turno }) {
  const externas = resumirChamadas(t.chamadasExternas)
  return (
    <li className="inv-turno">
      <header className="inv-turno-cabeca">
        <span className="inv-turno-numero">
          {t.numero === null ? 'Fora de turno' : `Turno ${t.numero}`}
        </span>
        {t.criadoEm !== '' && <time dateTime={t.criadoEm}>{formatarHora(t.criadoEm)}</time>}
        {t.duracaoMs !== null && <span className="inv-medida">{formatarMs(t.duracaoMs)}</span>}
        {t.custoUsd > 0 && <span className="inv-medida">{dinheiro(t.custoUsd)}</span>}
        {t.toolsExecutadas.length > 0 && <Marca>{t.toolsExecutadas.join(' · ')}</Marca>}
        {t.toolsRecusadas.length > 0 && (
          <Marca destaque>
            {contagem(t.toolsRecusadas.length, 'ferramenta recusada', 'ferramentas recusadas')}
          </Marca>
        )}
        {t.chamadasExternas.length > 0 && (
          <Marca>
            {contagem(t.chamadasExternas.length, 'ida para fora', 'idas para fora')} ·{' '}
            {formatarMs(t.tempoExternoMs)}
          </Marca>
        )}
        {t.desfecho !== null && <span className="inv-turno-desfecho">{t.desfecho}</span>}
      </header>

      {t.requisicao === null ? (
        // ⚠️ Dito, nunca escondido: evento sem requisição casada é dado anterior ao
        // `requisicao_id`, ou requisição fora do teto de 500 do detalhe.
        <p className="dica">
          Estes eventos não puderam ser casados com uma requisição — são anteriores ao
          agrupamento por turno, ou a requisição ficou fora do teto desta consulta.
        </p>
      ) : (
        <p className="inv-turno-rota">
          <span className="inv-metodo">{t.requisicao.metodo}</span>
          <span className="inv-caminho">{t.requisicao.caminho}</span>
          <span className="inv-status">{t.requisicao.status}</span>
        </p>
      )}

      <ol className="inv-tempo">
        {t.eventos.map((e) => (
          <ItemDoTempo key={e.id} evento={e} />
        ))}
      </ol>

      {t.chamadasExternas.length > 0 && (
        /*
          ⚠️ Agrupadas, e fechadas. Seis idas à Atlassian no meio da conversa é o ruído que
          fazia a linha do tempo parecer log; o total no cabeçalho é o achado de `D-73`
          (~2,6 s só para nomear os assuntos) visível de relance. Continuam abríveis.
        */
        <details className="inv-externas">
          <summary>
            {contagem(t.chamadasExternas.length, 'chamada para fora', 'chamadas para fora')} ·{' '}
            {externas.map((x) => `${x.alvo} ${x.total}× (${formatarMs(x.ms)})`).join(' · ')}
          </summary>
          <ol className="inv-tempo">
            {t.chamadasExternas.map((e) => (
              <ItemDoTempo key={e.id} evento={e} />
            ))}
          </ol>
        </details>
      )}
    </li>
  )
}

/**
 * Um item da linha do tempo — traduzido, com o JSON cru guardado atrás de um clique.
 *
 * 🚨 **O `<details>` do registro cru é o conserto principal desta spec.** Antes, o `<pre>` do
 * `dados_json` era renderizado direto, sempre aberto, em todos os eventos.
 */
function ItemDoTempo({ evento }: { evento: EventoRegistrado }) {
  const origem = ORIGENS[evento.origem] ?? { rotulo: evento.origem, forma: 'cheio' }
  const descrito = descreverEvento(evento.tipo, evento.dados_json, evento.resumo)
  // `FR-25` — a rederivação carrega a base e a proposta nova; o diff é a leitura delas.
  const diff = evento.tipo === 'proposta_rederivada' ? diffDoEvento(evento) : null
  return (
    <li
      className="inv-evento"
      data-forma={origem.forma}
      data-lado={evento.origem === 'usuario' ? 'direita' : 'esquerda'}
    >
      <div className="inv-evento-cabeca">
        <time dateTime={evento.criado_em}>{formatarHora(evento.criado_em)}</time>
        <span className="inv-origem">{origem.rotulo}</span>
        {evento.duracao_ms !== null && (
          <span className="inv-medida">{formatarMs(evento.duracao_ms)}</span>
        )}
        {evento.custo_usd !== null && evento.custo_usd > 0 && (
          <span className="inv-medida">{dinheiro(evento.custo_usd)}</span>
        )}
      </div>

      <p className="inv-evento-titulo">{descrito.titulo}</p>

      {descrito.linhas.length > 0 && (
        <dl className="inv-evento-linhas">
          {descrito.linhas.map((l) => (
            <div key={l.rotulo}>
              <dt>{l.rotulo}</dt>
              <dd>{l.valor}</dd>
            </div>
          ))}
        </dl>
      )}

      {diff !== null && <TabelaDeDiff mudancas={diff} />}

      {descrito.blocos.map((b) => (
        <details key={b.rotulo} className="inv-bloco-texto">
          {/*
            ⚠️ O separador vive DENTRO do `inv-medida`, não num `gap` de CSS. O `gap` separa
            na tela e some no **nome acessível**: `textContent` concatena, e o leitor de tela
            anunciava "O que voltou ao modelo444 bytes" (medido em 20/08/2026).
          */}
          <summary>
            {b.rotulo}
            <span className="inv-medida">{` · ${tamanho(b.texto.length) ?? ''}`}</span>
          </summary>
          <pre>{b.texto}</pre>
        </details>
      ))}

      {evento.dados_json && (
        <details className="inv-cru">
          <summary>Ver o registro cru</summary>
          <BlocoJson rotulo="Dados do evento" json={evento.dados_json} />
        </details>
      )}
    </li>
  )
}

/** O diff de um evento de rederivação, ou `null` quando ele não carrega base. */
function diffDoEvento(evento: EventoRegistrado): readonly MudancaDeCampo[] | null {
  if (evento.dados_json === null) return null
  try {
    const d = JSON.parse(evento.dados_json) as Record<string, unknown>
    if (d.baseAnterior === undefined || d.baseAnterior === null) return null
    return compararPropostas(d.baseAnterior, d.proposta)
  } catch {
    return null
  }
}

/** A lista de chamadas, com os dois corpos sob demanda — `FR-15`, `FR-30`. */
function ListaDeRequisicoes() {
  const [recorte, setRecorte] = useState('')
  const [caminho, setCaminho] = useState('')
  const [busca, setBusca] = useState('')
  const [itens, setItens] = useState<RequisicaoRegistrada[] | null>(null)
  const [falhou, setFalhou] = useState(false)

  useEffect(() => {
    setItens(null)
    setFalhou(false)
    api
      .investigadorRequisicoes({
        ...(recorte ? { recorte } : {}),
        ...(busca ? { caminho: busca } : {}),
      })
      .then((r) => setItens(r.itens))
      .catch(() => setFalhou(true))
  }, [recorte, busca])

  return (
    <section className="inv-secao">
      <div className="inv-filtros">
        <div className="inv-chips" role="group" aria-label="Recorte das chamadas">
          {(
            [
              ['', 'Todas'],
              ['erro', 'Com erro'],
              ['lento', 'Acima de 5 s'],
            ] as const
          ).map(([v, rotulo]) => (
            <button
              key={v}
              type="button"
              className="inv-chip"
              aria-pressed={recorte === v}
              onClick={() => setRecorte(v)}
            >
              {rotulo}
            </button>
          ))}
        </div>
        <form
          className="inv-busca"
          onSubmit={(e) => {
            e.preventDefault()
            setBusca(caminho.trim())
          }}
        >
          <label htmlFor="inv-caminho">Filtrar por caminho</label>
          <input
            id="inv-caminho"
            type="search"
            value={caminho}
            placeholder="/api/conversas"
            onChange={(e) => setCaminho(e.target.value)}
          />
          <button type="submit">Filtrar</button>
        </form>
      </div>

      {falhou && <Aviso atencao>Não consegui carregar as chamadas.</Aviso>}
      {!falhou && itens === null && <p className="carregando">Carregando as chamadas…</p>}
      {itens !== null && itens.length === 0 && (
        <Vazio
          titulo="Nenhuma chamada neste recorte"
          texto="Mude o filtro, ou confirme se o registro está ligado."
        />
      )}
      {itens && <ListaCrua itens={itens} />}
    </section>
  )
}

function ListaCrua({ itens }: { itens: readonly RequisicaoRegistrada[] }) {
  if (itens.length === 0) return <p className="dica">Nenhuma chamada registrada.</p>
  return (
    <ul className="inv-chamadas">
      {itens.map((r) => (
        <LinhaDeChamada key={r.id} requisicao={r} />
      ))}
    </ul>
  )
}

/**
 * Uma chamada de API — os corpos chegam **quando ela abre** (`FR-30`).
 *
 * 🚨 **Antes eles vinham na listagem**, até 500 linhas com dois corpos de até 16 mil
 * caracteres cada, para uma tela que lê um par por vez. Era o oposto do orçamento de
 * `RNF-36`, na parte que ninguém vê até a conta chegar.
 */
export function LinhaDeChamada({ requisicao: r }: { requisicao: RequisicaoRegistrada }) {
  const [corpos, setCorpos] = useState<CorposDaRequisicao | null>(null)
  const [buscando, setBuscando] = useState(false)
  const [falhou, setFalhou] = useState(false)

  function aoAbrir(aberto: boolean) {
    if (!aberto || corpos !== null || buscando) return
    setBuscando(true)
    setFalhou(false)
    api
      .investigadorCorpos(r.id)
      .then(setCorpos)
      .catch(() => setFalhou(true))
      .finally(() => setBuscando(false))
  }

  return (
    <li className="inv-chamada" data-erro={r.status >= 400 ? 'sim' : undefined}>
      <details onToggle={(e) => aoAbrir((e.currentTarget as HTMLDetailsElement).open)}>
        <summary>
          <span className="inv-metodo">{r.metodo}</span>
          <span className="inv-caminho">{r.caminho}</span>
          <span className="inv-status">{r.status}</span>
          <span className="inv-medida">{formatarMs(r.duracao_ms)}</span>
          <time dateTime={r.criado_em}>{formatarHora(r.criado_em)}</time>
        </summary>
        <div className="inv-chamada-corpo">
          <p className="dica">
            {r.ator_email}
            {r.conversa_id ? ` · conversa ${r.conversa_id}` : ''}
          </p>
          {r.erro && <Aviso atencao>{r.erro}</Aviso>}
          {buscando && <p className="carregando">Carregando os corpos…</p>}
          {falhou && <Aviso atencao>Não consegui carregar os corpos desta chamada.</Aviso>}
          {corpos && (
            <>
              {corpos.req_json ? (
                <BlocoJson rotulo="Entrada" json={corpos.req_json} />
              ) : (
                /*
                  ⚠️ Corpo ausente não é corpo vazio, e a frase diz qual dos dois é: upload de
                  arquivo e proxy de anexo não têm o conteúdo registrado de propósito (`FR-2`).
                */
                <p className="dica">
                  Entrada não registrada{r.req_bytes ? ` — ${r.req_bytes} bytes` : ''} (não era
                  JSON, ou passava do teto).
                </p>
              )}
              {corpos.resp_json ? (
                <BlocoJson rotulo="Saída" json={corpos.resp_json} />
              ) : (
                <p className="dica">
                  Saída não registrada{r.resp_bytes ? ` — ${r.resp_bytes} bytes` : ''}.
                </p>
              )}
            </>
          )}
        </div>
      </details>
    </li>
  )
}

/**
 * Texto longo com o tamanho declarado antes do conteúdo — `FR-24`.
 *
 * ⚠️ **Nunca `.slice()` silencioso.** O texto vai inteiro para dentro do `<details>`; o que
 * muda é ele não estar aberto. Cortar aqui apagaria a marca de truncamento de `FR-3`.
 */
function TextoLongo({ texto }: { texto: string }) {
  const CURTO = 400
  if (texto.length <= CURTO) return <p>{texto}</p>
  return (
    <details className="inv-bloco-texto">
      <summary>
        {texto.slice(0, 120)}…
        <span className="inv-medida">{` · ${tamanho(texto.length) ?? ''}`}</span>
      </summary>
      <pre>{texto}</pre>
    </details>
  )
}

/**
 * JSON legível, copiável em um clique — `FR-16`.
 *
 * ⚠️ **Reindenta quando dá, e mostra cru quando não dá.** Corpo truncado (`FR-3`) não é JSON
 * válido de propósito: a marca `…[truncado, N caracteres]` fica no fim. Tentar formatá-lo e
 * falhar em silêncio esconderia justamente o caso em que o conteúdo é grande.
 *
 * ⚠️ **Acima do teto ele abre cortado, com o corte DITO** — e "expandir tudo" ao lado. Um
 * `<pre>` de dezesseis mil caracteres empurra tudo o que vem depois para fora da tela.
 */
function BlocoJson({ rotulo, json }: { rotulo: string; json: string }) {
  const [copiado, setCopiado] = useState<'nao' | 'sim' | 'falhou'>('nao')
  const [inteiro, setInteiro] = useState(false)
  let texto = json
  try {
    texto = JSON.stringify(JSON.parse(json), null, 2)
  } catch {
    // Truncado ou não-JSON: vai cru, e a marca de truncamento continua visível.
  }
  const TETO = 3000
  const grande = texto.length > TETO
  const exibido = grande && !inteiro ? `${texto.slice(0, 2000)}\n\n…` : texto
  const linhas = texto.split('\n').length

  return (
    <div className="inv-json">
      <div className="inv-json-topo">
        <span>
          {rotulo}
          <span className="inv-medida">
            {` · ${tamanho(texto.length) ?? ''} · ${contagem(linhas, 'linha', 'linhas')}`}
          </span>
        </span>
        <span className="inv-json-acoes">
          {grande && (
            <button type="button" onClick={() => setInteiro((v) => !v)}>
              {inteiro ? 'Recolher' : 'Expandir tudo'}
            </button>
          )}
          <button type="button" onClick={() => void copiar(texto, setCopiado)}>
            {copiado === 'sim'
              ? 'Copiado'
              : copiado === 'falhou'
                ? 'Não deu para copiar'
                : 'Copiar'}
          </button>
        </span>
      </div>
      <pre>{exibido}</pre>
    </div>
  )
}

/**
 * Copiar, com a falha DITA.
 *
 * ⚠️ O clipboard recusa em contexto sem permissão, e um botão que não faz nada e não avisa
 * faz a pessoa colar o conteúdo **antigo** achando que copiou o novo — o pior desfecho
 * possível numa tela cujo produto é evidência.
 */
async function copiar(
  texto: string,
  avisar: (estado: 'nao' | 'sim' | 'falhou') => void,
): Promise<void> {
  try {
    const escrever = navigator.clipboard?.writeText(texto)
    if (escrever === undefined) {
      avisar('falhou')
      return
    }
    await escrever
    avisar('sim')
    setTimeout(() => avisar('nao'), 2000)
  } catch {
    avisar('falhou')
  }
}

/**
 * Exportar a sessão — `FR-31`.
 *
 * ⚠️ **JSON enxuto, e a tradução é a MESMA da tela** (`descreverEvento`). Um serializador
 * próprio produziria um segundo vocabulário, que divergiria na primeira correção — e o valor
 * disto é justamente colar num chat de depuração o que a tela mostra.
 */
function BotaoExportar({
  dados,
  conversaId,
  turnos,
}: {
  dados: DetalheDeSessao
  conversaId: string
  turnos: readonly Turno[]
}) {
  const [estado, setEstado] = useState<'nao' | 'sim' | 'falhou'>('nao')
  return (
    <button
      type="button"
      className="inv-exportar"
      onClick={() =>
        void copiar(JSON.stringify(montarExportacao(dados, conversaId, turnos), null, 2), setEstado)
      }
    >
      {estado === 'sim'
        ? 'Copiado'
        : estado === 'falhou'
          ? 'Não deu para copiar'
          : 'Copiar a sessão em JSON'}
    </button>
  )
}

/**
 * A sessão inteira, enxuta. Exportado por causa do teste — a suíte não clica em botão.
 *
 * ⚠️ **Os blocos longos viram marcador de tamanho**, não conteúdo: o histórico enviado ao
 * modelo aparece a cada ciclo e sozinho passa do que qualquer conversa aguenta receber. É a
 * mesma escolha do `buildChatExport` do godocs, que reduz o material extraído a `[12kb]`.
 */
export function montarExportacao(
  dados: DetalheDeSessao,
  conversaId: string,
  turnos: readonly Turno[],
) {
  return {
    conversa: conversaId,
    mensagens: dados.mensagens.length,
    turnos: turnos.map((t) => ({
      turno: t.numero,
      quando: t.criadoEm,
      duracaoMs: t.duracaoMs,
      custoUsd: t.custoUsd,
      rota: t.requisicao ? `${t.requisicao.metodo} ${t.requisicao.caminho}` : null,
      status: t.requisicao?.status ?? null,
      desfecho: t.desfecho,
      chamadasExternas: resumirChamadas(t.chamadasExternas),
      eventos: t.eventos.map((e) => {
        const d = descreverEvento(e.tipo, e.dados_json, e.resumo)
        return {
          quando: e.criado_em,
          origem: ORIGENS[e.origem]?.rotulo ?? e.origem,
          o_que: d.titulo,
          ...(d.linhas.length > 0
            ? { dados: Object.fromEntries(d.linhas.map((l) => [l.rotulo, l.valor])) }
            : {}),
          ...(d.blocos.length > 0
            ? { textos: d.blocos.map((b) => `${b.rotulo}: ${tamanho(b.texto.length)}`) }
            : {}),
        }
      }),
    })),
  }
}

/** `1,2 s` acima de mil, `340 ms` abaixo — a unidade muda com a grandeza, como se fala. */
export function formatarMs(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(1).replace('.', ',')} s`
  return `${Math.round(ms)} ms`
}

/** Vírgula decimal, como todo número desta tela (regra 4). */
function dinheiro(usd: number): string {
  return `US$ ${usd.toFixed(4).replace('.', ',')}`
}

function formatarHora(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleTimeString('pt-BR')
}

function formatarQuando(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('pt-BR')
}
