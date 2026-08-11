/**
 * Os painéis de acompanhamento do console — `RF-42`, `RF-53`, `RF-55`, `RF-56`.
 *
 * Cada um mora na seção da configuração que ele mede, não numa área de "relatórios":
 * a taxa de override fica embaixo do controle de interrupção porque é com ela que o
 * controle se calibra (`R-04`), e o mapa de lacunas fica embaixo dos espaços do
 * Confluence porque lacuna é backlog de escrita naqueles espaços (`RF-42`).
 *
 * ⚠️ **"Não carregou" é diferente de "não tem dado".** A versão anterior guardava
 * `null` nos dois casos, então uma falha de rede aparecia como "carregando…" para
 * sempre. `Carga` separa os três estados, que é o que `RNF-18` pede: degradar
 * dizendo o que aconteceu, e deixar o resto da tela funcionando.
 */

import type {
  MapaDeLacunas,
  Recomendacao,
  RegistroAuditoria,
  RespostaAssentos,
  ResumoMetricas,
  ResumoPainel,
  TermoComLacuna,
} from '../api'
import { Selo } from '../componentes'

/** Os três estados de um painel. Nenhum deles se disfarça de outro. */
export type Carga<T> =
  | { readonly estado: 'carregando' }
  | { readonly estado: 'pronto'; readonly dado: T }
  | { readonly estado: 'falhou' }

export function Quando<T>({
  carga,
  carregando,
  children,
}: {
  carga: Carga<T>
  carregando: string
  children: (dado: T) => React.ReactNode
}) {
  if (carga.estado === 'carregando') return <p className="carregando">{carregando}</p>
  if (carga.estado === 'falhou') {
    return (
      <p className="dica" role="status">
        Não conseguimos carregar isto agora. O resto da página continua funcionando —
        recarregue para tentar de novo.
      </p>
    )
  }
  return <>{children(carga.dado)}</>
}

/* ---------- métricas de deflexão (RF-55, O1) ---------------------------- */

export function PainelMetricas({ metricas }: { metricas: ResumoMetricas }) {
  return (
    <div className="pilha">
      <div className="recibo">
        <dl>
          {/* Rótulos curtos: a coluna de `dt` é estreita, e um rótulo de três
              linhas ao lado de um número de uma some no meio da própria quebra. */}
          <dt>Insistiram</dt>
          <dd>{formatarPct(metricas.taxaOverrideGlobalPct)}</dd>
          <dt>Abertos conversando</dt>
          <dd>{metricas.chamadosPorVia.conversa ?? 0}</dd>
          <dt>Abertos no formulário</dt>
          <dd>{metricas.chamadosPorVia.formulario ?? 0}</dd>
        </dl>
      </div>

      <ul className="chamados">
        {metricas.deflexaoPorRegra.map((d) => (
          <li key={d.regra} className="chamado" style={{ cursor: 'default' }}>
            <span className="chamado-topo">
              <span className="chamado-chave">{rotuloRegra(d.regra)}</span>
              <Selo
                variante={
                  d.taxaDeflexaoPct !== null && d.taxaDeflexaoPct >= 50 ? 'lime' : 'contorno'
                }
              >
                {formatarPct(d.taxaDeflexaoPct)} resolveram sem abrir
              </Selo>
            </span>
            <span className="chamado-meta">
              <span className="dica">
                {d.overrides} de {d.totalBloqueios} seguiram mesmo assim
              </span>
            </span>
          </li>
        ))}
      </ul>

      <p className="dica">
        Taxa alta demais de quem insiste é sinal de que a interrupção está acontecendo
        cedo demais — ou de que a página encontrada não responde. Taxa zerada com muitos
        bloqueios é o contrário: pode estar barrando quem já sabia.
      </p>

      <PainelEvidencia evidencia={metricas.painel.evidencia} />
      <PainelArea area={metricas.area} />
    </div>
  )
}

/* ---------- fonte organizacional (T-520, D-37) --------------------------- */

/**
 * De onde veio a área de quem abriu chamado — e, quando não veio, **por quê**.
 *
 * ⚠️ Os dois motivos aparecem separados de propósito, e é a mesma razão de serem duas
 * ações de auditoria: *"não achei a pessoa"* é cadastro faltando na TeamGuide, e resolve-se
 * cadastrando; *"a fonte caiu"* é token ou API, e resolve-se olhando o secret. Um número
 * só mandaria alguém investigar a coisa errada metade das vezes.
 *
 * E o painel **não** tem campo para editar: não há o que decidir aqui — o token é secret,
 * está lá ou não está. É `D-25` aplicado: o console mostra o que se decide, e relata o
 * resto. Nenhum chamado deixa de abrir por causa disto (`RNF-18`), então a frase do rodapé
 * diz o efeito real em vez de alarmar.
 */
export function PainelArea({
  area,
}: {
  area: ResumoMetricas['area']
}) {
  const total = area.comArea + area.semArea
  if (total === 0) {
    // Mesmo raciocínio de `taxaOverrideGlobalPct: null`: zero por falta de dado e zero
    // por tudo ter funcionado são coisas opostas.
    return (
      <div className="recibo">
        <span className="eyebrow">Área de quem abre</span>
        <p className="dica">Nenhum chamado aberto ainda — sem dado para mostrar.</p>
      </div>
    )
  }
  return (
    <div className="recibo">
      <span className="eyebrow">Área de quem abre</span>
      <dl>
        <dt>Com área</dt>
        <dd>
          {area.comArea} de {total}
        </dd>
        <dt>Não achei na TeamGuide</dt>
        <dd>{area.naoEncontrada}</dd>
        <dt>Fonte fora do ar</dt>
        <dd>{area.indisponivel}</dd>
      </dl>
      <p className="dica">
        Chamado sem área abre normalmente — a área é informação de apoio, e a falta dela
        nunca impede ninguém. "Não achei na TeamGuide" costuma ser cadastro faltando ou
        e-mail diferente do login; "fonte fora do ar" é a integração, não a pessoa.
      </p>
    </div>
  )
}

/* ---------- evidência na criação (T-422, ScC-7) -------------------------- */

/**
 * O efeito da pergunta obrigatória de anexo, medido em vez de presumido.
 *
 * ⚠️ **A taxa vem acompanhada dos três "por quês", na mesma caixa** — mesmo raciocínio da
 * calibragem (T-310): um número solto empurra para a única ação visível. "40% chegam com
 * evidência" sozinho sugere endurecer a pergunta; ao lado de "8 declararam ter e o envio
 * falhou", a ação certa passa a ser óbvia e é outra.
 *
 * E o denominador são os **perguntados**, não os chamados: cobrar evidência de quem nunca
 * viu a pergunta (tipo de chamado que não aceita anexo) mediria a composição da fila.
 */
export function PainelEvidencia({
  evidencia,
}: {
  evidencia: ResumoPainel['evidencia']
}) {
  return (
    <div className="recibo">
      <div>
        <span className="eyebrow">Evidência na abertura</span>
        <h3 className="titulo-secao" style={{ fontSize: 'var(--fs-h4)' }}>
          {evidencia.perguntados === 0
            ? 'Ninguém foi perguntado ainda'
            : `${formatarPct(evidencia.taxaPct)} chegam com anexo`}
        </h3>
      </div>
      <dl>
        <dt>Chegou arquivo</dt>
        <dd>
          {evidencia.comEvidencia} de {evidencia.perguntados} perguntados
        </dd>
        <dt>Disse que tinha e não subiu</dt>
        <dd>{evidencia.declarouTerEFalhou}</dd>
        <dt>Disse que não tinha</dt>
        <dd>{evidencia.declarouNaoTer}</dd>
        <dt>Não foi perguntado</dt>
        <dd>{evidencia.semPergunta}</dd>
      </dl>
      <p className="dica">
        {evidencia.declarouTerEFalhou > 0
          ? 'Quem disse que tinha material e ficou sem anexo é o número a olhar primeiro: ou o envio está falhando, ou a tela perde a pessoa entre responder e escolher o arquivo.'
          : 'Quem diz que não tem material é resposta legítima, não falha — o que importa é a diferença entre isso e não ter sido perguntado.'}
      </p>
      {evidencia.semPergunta > 0 && (
        <p className="dica">
          Chamado sem pergunta é tipo que não aceita anexo, ou schema que não pôde ser lido
          na hora. A auditoria distingue os dois.
        </p>
      )}
    </div>
  )
}

/* ---------- mapa de lacunas (RF-42) ------------------------------------- */

export function PainelLacunas({ lacunas }: { lacunas: MapaDeLacunas }) {
  return (
    <div className="pilha">
      <ListaDeLacunas
        titulo="Procuraram e não existe"
        explicacao="A busca não achou nada para estes termos."
        itens={lacunas.semResultado}
      />
      <ListaDeLacunas
        titulo="Existe, apareceu, e ninguém abriu"
        explicacao="Havia resultado e a pessoa seguiu sem clicar — o título não convenceu, ou não era aquilo. É o sinal que nenhuma contagem de 'busca vazia' mostra."
        itens={lacunas.semClique}
      />
      <div className="pilha">
        <h4 className="titulo-filhos">O que escreveram ao insistir</h4>
        <p className="dica">
          Motivo de quem foi interrompido e seguiu assim mesmo. É o mais direto sobre o
          que falta na página.
        </p>
        {lacunas.overrides.length === 0 ? (
          <p className="dica">Ninguém insistiu ainda.</p>
        ) : (
          <ul className="chamados">
            {lacunas.overrides.map((o, i) => (
              <li key={i} className="chamado" style={{ cursor: 'default' }}>
                <span className="chamado-topo">
                  <span className="chamado-chave">{rotuloRegra(o.regra)}</span>
                  <span className="dica">{formatarData(o.criadoEm)}</span>
                </span>
                <span className="chamado-titulo">{o.motivo}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function ListaDeLacunas({
  titulo,
  explicacao,
  itens,
}: {
  titulo: string
  explicacao: string
  itens: readonly TermoComLacuna[]
}) {
  return (
    <div className="pilha">
      <h4 className="titulo-filhos">{titulo}</h4>
      <p className="dica">{explicacao}</p>
      {itens.length === 0 ? (
        <p className="dica">Nada por aqui — o que é uma boa notícia.</p>
      ) : (
        <ul className="chamados">
          {itens.map((t) => (
            <li key={t.termo} className="chamado" style={{ cursor: 'default' }}>
              <span className="chamado-titulo">{t.termo}</span>
              <span className="chamado-meta">
                <Selo variante="contorno">
                  {t.ocorrencias === 1 ? '1 busca' : `${t.ocorrencias} buscas`}
                </Selo>
                {/* Conta pessoas, nunca as nomeia: isto é backlog de escrita, e
                    nomear quem procurou transformaria a lista em cobrança. */}
                <Selo variante="contorno">
                  {t.pessoas === 1 ? '1 pessoa' : `${t.pessoas} pessoas`}
                </Selo>
                <span className="dica">última: {formatarData(t.ultimaEm)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/* ---------- assentos (RF-51 a RF-54) ------------------------------------ */

export function PainelAssentos({
  assentos,
  recomendacoes,
}: {
  assentos: RespostaAssentos
  recomendacoes: Carga<readonly Recomendacao[]>
}) {
  if (assentos.coletadoEm === null) {
    return (
      <p className="dica">
        Nenhuma coleta ainda. Ou falta apontar a organização acima, ou a coleta diária
        ainda não rodou uma vez.
      </p>
    )
  }

  return (
    <div className="pilha">
      <div className="recibo">
        <dl>
          <dt>Assentos parados</dt>
          <dd>
            {assentos.custo.ocioso.usuarios} sem usar nada há {assentos.ociosoDesdeDias}{' '}
            dias ou mais
            {/* T-134 — a economia é TETO enquanto não houver curva de preço por faixa.
                Fica ao lado do próprio número, não em rodapé: é aqui que alguém decide
                cortar acesso, e economia superestimada empurra para cortar. */}
            {assentos.custo.ocioso.custoMensalUsd !== null &&
              !assentos.custo.ocioso.economiaConfiavel && (
                <>
                  {' — '}
                  <Selo variante="contorno">Economia é teto</Selo> o preço da Atlassian é
                  escalonado, então cortar assento pode subir o preço unitário dos que
                  ficam. Sem a curva por faixa configurada, o valor é o máximo possível,
                  não o esperado.
                </>
              )}
          </dd>
          <dt>Custo por mês</dt>
          <dd>
            {assentos.custo.custoConfigurado ? (
              formatarUsd(assentos.custo.totalMensalUsd)
            ) : (
              <>
                <Selo variante="contorno">Sem preço</Selo> preencha o preço de cada
                produto acima
              </>
            )}
          </dd>
          <dt>Coletado em</dt>
          <dd>{formatarData(assentos.coletadoEm)}</dd>
        </dl>
      </div>

      <p className="dica" role="note">
        {assentos.limitacoesUltimoAcesso.criterioAtivo} O dado pode atrasar até{' '}
        {assentos.limitacoesUltimoAcesso.atrasoMaximoHoras}h — não tire o acesso de
        alguém só porque "sem uso" apareceu agora.
      </p>

      <ul className="chamados">
        {assentos.custo.porProduto.map((p) => (
          <li key={p.produto} className="chamado" style={{ cursor: 'default' }}>
            <span className="chamado-topo">
              <span className="chamado-chave">{p.produto}</span>
              <Selo variante="contorno">
                {p.usuarios} {p.usuarios === 1 ? 'assento' : 'assentos'}
              </Selo>
            </span>
            <span className="chamado-meta">
              <Selo variante={p.ociosos > 0 ? 'lime' : 'contorno'}>
                {p.ociosos} {p.ociosos === 1 ? 'parado' : 'parados'}
              </Selo>
              <span className="dica">
                {p.custoMensalUsd === null
                  ? 'sem preço configurado'
                  : formatarUsd(p.custoMensalUsd) + '/mês'}
              </span>
            </span>
          </li>
        ))}
      </ul>

      <div className="pilha">
        <div className="chamado-topo">
          <h4 className="titulo-filhos">O que dá para fazer</h4>
          <a
            className="botao botao-contorno"
            href="/api/admin/assentos/recomendacoes?formato=csv"
            download="recomendacoes-assentos.csv"
          >
            Baixar em CSV
          </a>
        </div>
        <Quando carga={recomendacoes} carregando="Calculando as recomendações…">
          {(itens) =>
            itens.length === 0 ? (
              <p className="dica">Nada a fazer — o que é uma boa notícia.</p>
            ) : (
              <ul className="chamados">
                {itens.map((r) => (
                  <li key={r.accountId} className="chamado" style={{ cursor: 'default' }}>
                    <span className="chamado-topo">
                      <span className="chamado-chave">{r.email}</span>
                      <Selo
                        variante={r.tipo === 'rebaixar_para_customer' ? 'lime' : 'contorno'}
                      >
                        {rotuloRecomendacao(r.tipo)}
                      </Selo>
                    </span>
                    <span className="chamado-titulo">{r.motivo}</span>
                    <span className="chamado-meta">
                      <span className="dica">{r.produtosAfetados.join(', ')}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )
          }
        </Quando>
      </div>
    </div>
  )
}

/* ---------- auditoria (RF-56) ------------------------------------------- */

export function PainelAuditoria({
  auditoria,
  filtro,
  aoMudarFiltro,
  aoFiltrar,
}: {
  auditoria: Carga<readonly RegistroAuditoria[]>
  filtro: string
  aoMudarFiltro: (v: string) => void
  aoFiltrar: () => void
}) {
  return (
    <div className="pilha">
      <div className="campo-console">
        <label htmlFor="filtro-email">Ver só o que uma pessoa fez</label>
        <p className="campo-ajuda" id="filtro-email-ajuda">
          Em branco mostra todo mundo.
        </p>
        <input
          id="filtro-email"
          aria-describedby="filtro-email-ajuda"
          value={filtro}
          placeholder="pessoa@gocase.com"
          onChange={(e) => aoMudarFiltro(e.target.value)}
        />
        <div className="acoes">
          <button type="button" className="botao botao-contorno" onClick={aoFiltrar}>
            Filtrar
          </button>
        </div>
      </div>

      <Quando carga={auditoria} carregando="Carregando o registro…">
        {(itens) =>
          itens.length === 0 ? (
            <p className="dica">Nenhum registro ainda.</p>
          ) : (
            <ul className="chamados">
              {itens.map((r) => (
                <li key={r.id} className="chamado" style={{ cursor: 'default' }}>
                  <span className="chamado-topo">
                    <span className="chamado-chave">{r.acao}</span>
                    <Selo variante={r.resultado === 'sucesso' ? 'lime' : 'contorno'}>
                      {r.resultado}
                    </Selo>
                  </span>
                  <span className="chamado-titulo">{r.ator_email}</span>
                  <span className="chamado-meta">
                    {r.recurso && <span className="dica">{r.recurso}</span>}
                    <span className="dica">{formatarData(r.criado_em)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )
        }
      </Quando>
    </div>
  )
}

/* ---------- formatação -------------------------------------------------- */

function rotuloRegra(regra: string): string {
  return regra === 'regra1_confluence' ? 'Documentação' : 'Histórico'
}

function rotuloRecomendacao(tipo: 'rebaixar_para_customer' | 'remover_ocioso'): string {
  return tipo === 'rebaixar_para_customer' ? 'Vira só cliente do portal' : 'Tirar o assento'
}

function formatarUsd(valor: number | null): string {
  if (valor === null) return 'sem preço'
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'USD' }).format(valor)
}

/** `null` = nada aconteceu ainda — nunca "0%", que pareceria a regra funcionando. */
function formatarPct(valor: number | null): string {
  return valor === null ? 'sem dados ainda' : `${valor.toFixed(1)}%`
}

/**
 * O banco guarda ISO 8601 e é isso que a API devolve — mas `2026-08-07T10:47:20.584Z`
 * numa tela é ruído que a pessoa tem que decodificar. O que não dá para fazer é
 * esconder o horário: a auditoria é para investigar, e "ontem" não serve.
 *
 * Data que não parseia volta como veio: inventar "data inválida" apagaria a única
 * pista de que algo estranho está gravado.
 */
function formatarData(iso: string): string {
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return iso
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(ms))
}
