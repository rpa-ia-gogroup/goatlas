/**
 * A aba **Investigador** — spec 009, `FR-11` a `FR-17`.
 *
 * ## A tese da tela
 *
 * Isto não é um painel. Painel responde *"como estamos?"*, e essa pergunta já tem casa: o
 * console de administração (`D-25`). Aqui a pergunta é outra e é sempre a mesma — **"o que
 * aconteceu com esta pessoa?"** —, e ela se responde em **ordem**, não em agregado. Por isso
 * o elemento central da tela é uma **linha do tempo**, e não um mosaico de números.
 *
 * ## O vocabulário visual
 *
 * A **espinha lime** é o mesmo traço da leitura de documentação (`estilos.css`, `.doc`), e
 * ali ele diz *"daqui para a direita o conteúdo é de outra origem"*. É exatamente o que ele
 * diz aqui: à direita da espinha está o registro, não a opinião do app.
 *
 * ⚠️ **Origem é FORMA + PALAVRA, nunca cor.** O piso de a11y do projeto (regra 9) proíbe
 * estado só por cor, e a identidade GoGroup tem duas cores de acento — não seis. Cada
 * origem tem um marcador de forma diferente na espinha **e** o nome escrito ao lado; a cor
 * é a mesma para todas.
 *
 * ⚠️ **Nada aqui é editável.** Escrita numa tela de investigação é a forma de perder a
 * evidência que se foi buscar; quem limpa é a retenção (`FR-19`).
 */

import { useEffect, useState } from 'react'
import {
  api,
  ErroApi,
  type DetalheDeSessao,
  type EventoRegistrado,
  type RequisicaoRegistrada,
  type RespostaSessoes,
  type ResumoInvestigador,
  type SessaoInvestigada,
} from './api'
import { Aviso, Vazio } from './componentes'

/** As duas visões da aba. Sessão é o padrão porque é a pergunta que se faz primeiro. */
type Visao = 'sessoes' | 'requisicoes'

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

/**
 * Os motivos de "não houve proposta", em português.
 *
 * 🚨 **É a frase que responde ao caso de 14/08/2026.** Deixar o rótulo técnico na tela
 * (`extracao_sem_proposta`) devolveria metade do problema: quem lê o console precisa saber
 * **o que fazer**, e cada um destes pede uma ação diferente.
 */
const MOTIVOS_SEM_PROPOSTA: Readonly<Record<string, string>> = {
  allowlist_de_tipos_vazia: 'Nenhum assunto liberado na configuração — o cartão não tinha como nascer.',
  nenhum_tipo_com_nome:
    'Os assuntos liberados não vieram com nome do service desk configurado — o app se recusa a propor no escuro.',
  extracao_sem_proposta:
    'O modelo respondeu e a proposta foi recusada na leitura. Abra o evento para ver a resposta crua.',
  bloqueio_pendente_na_gravacao:
    'A proposta ficou pronta e foi descartada: nasceu um bloqueio enquanto ela estava sendo montada.',
  excecao_na_extracao: 'A montagem da proposta lançou um erro. Abra o evento para ver a classe.',
}

/** `FR-13` — os recortes que respondem às perguntas caras, escritos como perguntas. */
const RECORTES: readonly { valor: string; rotulo: string }[] = [
  { valor: '', rotulo: 'Todas' },
  { valor: 'sem_proposta', rotulo: 'Sem cartão' },
  { valor: 'com_bloqueio', rotulo: 'Com bloqueio' },
  { valor: 'com_erro', rotulo: 'Com erro de API' },
  { valor: 'abandonada', rotulo: 'Sem chamado' },
]

export function TelaInvestigador() {
  const [visao, setVisao] = useState<Visao>('sessoes')
  const [resumo, setResumo] = useState<ResumoInvestigador | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [aberta, setAberta] = useState<string | null>(null)

  useEffect(() => {
    api
      .investigadorResumo()
      .then(setResumo)
      .catch((e) =>
        setErro(e instanceof ErroApi ? e.message : 'Não consegui carregar o registro.'),
      )
  }, [])

  if (erro) return <Aviso atencao>{erro}</Aviso>

  return (
    <div className="investigador">
      <header className="inv-topo">
        <span className="eyebrow">Somente admin</span>
        <h1 className="titulo-secao">Investigador</h1>
        <p className="dica">
          O que a pessoa mandou, o que a IA decidiu, o que o formulário virou e o que saiu
          daqui para o Jira — na ordem em que aconteceu.
        </p>
        {resumo && (
          <p className="inv-estado">
            {resumo.ligado ? 'Registrando' : 'Registro desligado'} · guarda{' '}
            {resumo.retencaoDias} dias · {resumo.totalEventos.toLocaleString('pt-BR')} eventos
          </p>
        )}
      </header>

      {resumo && !resumo.ligado && (
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
              setAberta(null)
            }}
          >
            {rotulo}
          </button>
        ))}
      </nav>

      {visao === 'sessoes' &&
        (aberta ? (
          <Detalhe conversaId={aberta} aoVoltar={() => setAberta(null)} />
        ) : (
          <ListaDeSessoes aoAbrir={setAberta} />
        ))}
      {visao === 'requisicoes' && <ListaDeRequisicoes />}
    </div>
  )
}

/**
 * A faixa do topo — `FR-17`.
 *
 * ⚠️ **Faixa, não cartões grandes.** Estes quatro números orientam; a tela é sobre o que
 * vem depois deles. Cartões do tamanho de uma seção diriam o contrário.
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
      <Numero rotulo="Custo de IA" valor={`US$ ${resumo.custoIaUsd.toFixed(4)}`} />
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

function ListaDeSessoes({ aoAbrir }: { aoAbrir: (id: string) => void }) {
  const [recorte, setRecorte] = useState('')
  const [email, setEmail] = useState('')
  const [busca, setBusca] = useState('')
  const [dados, setDados] = useState<RespostaSessoes | null>(null)
  const [falhou, setFalhou] = useState(false)

  useEffect(() => {
    setDados(null)
    setFalhou(false)
    api
      .investigadorSessoes({ ...(recorte ? { recorte } : {}), ...(busca ? { email: busca } : {}) })
      .then(setDados)
      .catch(() => setFalhou(true))
  }, [recorte, busca])

  return (
    <section className="inv-secao">
      <div className="inv-filtros">
        <div className="inv-chips" role="group" aria-label="Recorte das sessões">
          {RECORTES.map((r) => (
            <button
              key={r.valor}
              type="button"
              className="inv-chip"
              aria-pressed={recorte === r.valor}
              onClick={() => setRecorte(r.valor)}
            >
              {r.rotulo}
            </button>
          ))}
        </div>
        <form
          className="inv-busca"
          onSubmit={(e) => {
            e.preventDefault()
            setBusca(email.trim())
          }}
        >
          <label htmlFor="inv-email">Filtrar por pessoa</label>
          <input
            id="inv-email"
            type="search"
            value={email}
            placeholder="nome@gocase.com"
            onChange={(e) => setEmail(e.target.value)}
          />
          <button type="submit">Filtrar</button>
        </form>
      </div>

      {falhou && <Aviso atencao>Não consegui carregar as sessões.</Aviso>}
      {!falhou && dados === null && <p className="carregando">Carregando as sessões…</p>}
      {dados !== null && dados.itens.length === 0 && (
        <Vazio
          titulo="Nenhuma sessão neste recorte"
          texto="Ou ninguém usou o app com este filtro, ou o registro estava desligado no período."
        />
      )}

      <ul className="inv-sessoes">
        {(dados?.itens ?? []).map((s) => (
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
          <Marca>{s.mensagensDaPessoa} mensagens</Marca>
          {s.issueKey ? (
            <Marca destaque>Chamado {s.issueKey}</Marca>
          ) : (
            <Marca>Sem chamado</Marca>
          )}
          {semCartao && <Marca destaque>Sem cartão</Marca>}
          {s.bloqueios > 0 && (
            <Marca>
              {s.bloqueios} bloqueio{s.bloqueios > 1 ? 's' : ''}
              {s.overrides > 0 ? ` · ${s.overrides} override` : ''}
            </Marca>
          )}
          {s.errosDeApi > 0 && <Marca destaque>{s.errosDeApi} erros de API</Marca>}
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

      {dados && (
        <>
          <h2 className="titulo-secao">Linha do tempo</h2>
          {dados.eventos.length === 0 ? (
            <Vazio
              titulo="Nenhum evento registrado nesta conversa"
              texto="Ela é anterior ao Investigador, ou o registro estava desligado quando aconteceu."
            />
          ) : (
            <ol className="inv-tempo">
              {dados.eventos.map((e) => (
                <ItemDoTempo key={e.id} evento={e} />
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
            <summary>
              A conversa como o modelo a leu ({dados.mensagens.length} mensagens)
            </summary>
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
                  <p>{m.conteudo}</p>
                </li>
              ))}
            </ul>
          </details>

          <h2 className="titulo-secao">Chamadas de API desta sessão</h2>
          <ListaCrua itens={dados.requisicoes} />
        </>
      )}
    </section>
  )
}

/** Um item da linha do tempo — fechado é uma linha; aberto é o JSON inteiro. */
function ItemDoTempo({ evento }: { evento: EventoRegistrado }) {
  const origem = ORIGENS[evento.origem] ?? { rotulo: evento.origem, forma: 'cheio' }
  return (
    <li className="inv-evento" data-forma={origem.forma}>
      <div className="inv-evento-cabeca">
        <time dateTime={evento.criado_em}>{formatarHora(evento.criado_em)}</time>
        <span className="inv-origem">{origem.rotulo}</span>
        <span className="inv-tipo">{evento.tipo}</span>
        {evento.duracao_ms !== null && <span className="inv-medida">{formatarMs(evento.duracao_ms)}</span>}
        {evento.custo_usd !== null && evento.custo_usd > 0 && (
          <span className="inv-medida">US$ {evento.custo_usd.toFixed(4)}</span>
        )}
      </div>
      <p className="inv-resumo">{evento.resumo}</p>
      {evento.dados_json && <BlocoJson rotulo="Dados do evento" json={evento.dados_json} />}
    </li>
  )
}

/** A lista de chamadas, com os dois corpos — `FR-15`. */
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
        <li key={r.id} className="inv-chamada" data-erro={r.status >= 400 ? 'sim' : undefined}>
          <details>
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
              {r.req_json ? (
                <BlocoJson rotulo="Entrada" json={r.req_json} />
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
              {r.resp_json ? (
                <BlocoJson rotulo="Saída" json={r.resp_json} />
              ) : (
                <p className="dica">
                  Saída não registrada{r.resp_bytes ? ` — ${r.resp_bytes} bytes` : ''}.
                </p>
              )}
            </div>
          </details>
        </li>
      ))}
    </ul>
  )
}

/**
 * JSON legível, copiável em um clique — `FR-16`.
 *
 * ⚠️ **Reindenta quando dá, e mostra cru quando não dá.** Corpo truncado (`FR-3`) não é JSON
 * válido de propósito: a marca `…[truncado, N caracteres]` fica no fim. Tentar formatá-lo e
 * falhar em silêncio esconderia justamente o caso em que o conteúdo é grande — o mais
 * interessante de todos.
 */
function BlocoJson({ rotulo, json }: { rotulo: string; json: string }) {
  const [copiado, setCopiado] = useState(false)
  let texto = json
  try {
    texto = JSON.stringify(JSON.parse(json), null, 2)
  } catch {
    // Truncado ou não-JSON: vai cru, e a marca de truncamento continua visível.
  }
  return (
    <div className="inv-json">
      <div className="inv-json-topo">
        <span>{rotulo}</span>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard?.writeText(texto).then(() => {
              setCopiado(true)
              setTimeout(() => setCopiado(false), 2000)
            })
          }}
        >
          {copiado ? 'Copiado' : 'Copiar'}
        </button>
      </div>
      <pre>{texto}</pre>
    </div>
  )
}

/** `1,2 s` acima de mil, `340 ms` abaixo — a unidade muda com a grandeza, como se fala. */
export function formatarMs(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(1).replace('.', ',')} s`
  return `${Math.round(ms)} ms`
}

function formatarHora(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleTimeString('pt-BR')
}

function formatarQuando(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('pt-BR')
}
