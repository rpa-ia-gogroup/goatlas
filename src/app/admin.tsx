/**
 * Tela de admin — `RF-49`, `RF-50`, `RF-56`.
 *
 * Traz para a Fase 1 a parte do console que **não** depende de credencial: editar a
 * configuração e ler a auditoria. O console de governança de assentos (`RF-51`…
 * `RF-54`) segue na Fase 2, porque precisa da credencial de Org Admin.
 *
 * Por que veio antes do planejado: o admin não tinha **nenhuma** superfície, então
 * "admin vê tudo" era só uma flag no banco. E `RF-50` (thresholds sem deploy) é o que
 * permite calibrar a deflexão — sem tela, calibrar exigiria `curl`.
 */

import { useEffect, useState } from 'react'
import {
  api,
  ErroApi,
  type CalibragemRegra,
  type ConfigValores,
  type MapaDeLacunas,
  type Recomendacao,
  type RegistroAuditoria,
  type RespostaAssentos,
  type ResumoMetricas,
  type TermoComLacuna,
} from './api'
import { Aviso, Selo } from './componentes'

/**
 * Descritor dos campos editáveis.
 *
 * Só o que o admin deve mexer aparece aqui — e cada um diz **o que acontece** se
 * ficar vazio, porque o app é fail-closed e vazio significa negar. Sem essa
 * explicação, alguém apaga a lista de espaços achando que "vazio = todos".
 */
const CAMPOS: readonly {
  chave: keyof ConfigValores
  rotulo: string
  tipo: 'lista' | 'numero' | 'texto'
  ajuda: string
}[] = [
  {
    chave: 'dominios_permitidos',
    rotulo: 'Domínios de e-mail permitidos',
    tipo: 'lista',
    ajuda: 'Quem pode entrar no app. Vazio NEGA todo mundo — não é "todos liberados".',
  },
  {
    chave: 'admins',
    rotulo: 'Admins',
    tipo: 'lista',
    ajuda: 'E-mails com acesso a esta tela. Perfil admin nunca é inferido, só concedido aqui.',
  },
  {
    chave: 'tipos_chamado_permitidos',
    rotulo: 'Tipos de chamado oferecidos',
    tipo: 'lista',
    ajuda: 'IDs de request type do JSM. Vazio não oferece nenhum tipo.',
  },
  {
    chave: 'service_desk_id',
    rotulo: 'Service desk do JSM',
    tipo: 'texto',
    ajuda: 'Sem isso, a abertura de chamados fica indisponível.',
  },
  {
    chave: 'campo_solicitante_id',
    rotulo: 'Campo customizado "Solicitante" (Q4)',
    tipo: 'texto',
    ajuda:
      'Ex.: customfield_10050. Vazio não bloqueia nada — o solicitante real continua indo na descrição do chamado.',
  },
  {
    chave: 'espacos_confluence',
    rotulo: 'Espaços do Confluence liberados',
    tipo: 'lista',
    ajuda: 'Vazio não expõe nada — e a busca nem sai daqui.',
  },
  {
    chave: 'labels_bloqueadas',
    rotulo: 'Labels que bloqueiam a página',
    tipo: 'lista',
    ajuda: 'Página com uma destas não aparece, mesmo em espaço liberado.',
  },
  {
    chave: 'regra1_threshold_score',
    rotulo: 'Regra 1 — score mínimo para bloquear',
    tipo: 'numero',
    ajuda: 'Mais alto bloqueia menos. Comece conservador e aperte com dado da taxa de override.',
  },
  {
    chave: 'regra2_threshold_recorrencia',
    rotulo: 'Regra 2 — quantos ajustes operacionais bloqueiam',
    tipo: 'numero',
    ajuda: 'Sugestão do requisito: 3 em 90 dias.',
  },
  {
    chave: 'regra2_janela_dias',
    rotulo: 'Regra 2 — janela em dias',
    tipo: 'numero',
    ajuda: 'Janela maior custa mais IA por conversa.',
  },
  {
    chave: 'regra2_campo_agrupamento',
    rotulo: 'Regra 2 — campo que delimita "mesmo tipo"',
    tipo: 'texto',
    ajuda: 'label, component ou issuetype. Decisão de Q2, com o time de tech.',
  },
  {
    chave: 'regra2_exemplos_ajuste_operacional',
    rotulo: 'Regra 2 — exemplos reais de ajuste operacional',
    tipo: 'lista',
    ajuda:
      'Exemplos da própria Gocase (Q3). VAZIO desliga a Regra 2, de propósito: sem exemplos do contexto real a classificação erra e gera falso bloqueio.',
  },
  {
    chave: 'canal_notificacao_padrao',
    rotulo: 'Canal de aviso padrao (Q11)',
    tipo: 'texto',
    ajuda:
      'chat, email ou nenhum. VAZIO significa "ninguem decidiu ainda": o aviso e registrado e fica suprimido, e a contagem abaixo mostra quantos. Preencher aqui liga a notificacao sem deploy.',
  },
  {
    chave: 'chat_webhook_url',
    rotulo: 'Webhook do espaco no Google Chat',
    tipo: 'texto',
    ajuda: 'Sem isso, o canal de chat se declara indisponivel em vez de fingir envio.',
  },
  {
    chave: 'email_endpoint',
    rotulo: 'Endpoint do provedor de e-mail',
    tipo: 'texto',
    ajuda:
      'HTTP, nao SMTP: a plataforma nao tem TCP puro. Sem isso, o canal de e-mail recusa.',
  },
  {
    chave: 'email_remetente',
    rotulo: 'Remetente dos e-mails',
    tipo: 'texto',
    ajuda: 'Ex.: goatlas@gocase.com.',
  },
  {
    chave: 'base_publica_app',
    rotulo: 'Endereco publico do app',
    tipo: 'texto',
    ajuda:
      'Usado no link das notificacoes. Vazio manda a mensagem SEM link — melhor que um link quebrado. O cron nao tem como descobrir isso sozinho.',
  },
  {
    chave: 'sla_fracao_aviso',
    rotulo: 'SLA — fracao do prazo que liga o alerta',
    tipo: 'numero',
    ajuda: '0,75 avisa aos 75% do prazo de PRIMEIRA RESPOSTA. Calibre com o volume real.',
  },
  {
    chave: 'emails_piloto',
    rotulo: 'E-mails do piloto (Q13)',
    tipo: 'lista',
    ajuda:
      'ATENCAO: esta e a unica lista do app em que VAZIO LIBERA TODO MUNDO — vazio = piloto desligado. Com nomes na lista, quem esta fora recebe encaminhamento para o canal atual, e a documentacao segue liberada para todos.',
  },
  {
    chave: 'retencao_conversas_dias',
    rotulo: 'Retencao de conversas (dias)',
    tipo: 'numero',
    ajuda: 'Vazio GUARDA para sempre. Apagar conversa leva as mensagens dela.',
  },
  {
    chave: 'retencao_auditoria_dias',
    rotulo: 'Retencao da auditoria (dias)',
    tipo: 'numero',
    ajuda:
      'Vazio guarda para sempre. Valor abaixo de 180 dias e elevado ao piso: a auditoria e o que responde "quem viu o que" numa investigacao.',
  },
  {
    chave: 'retencao_notificacoes_dias',
    rotulo: 'Retencao de notificacoes (dias)',
    tipo: 'numero',
    ajuda: 'Vazio guarda para sempre. Aviso ainda na fila nunca e apagado.',
  },
  {
    chave: 'teto_custo_conversa_usd',
    rotulo: 'Teto de custo por conversa (USD)',
    tipo: 'numero',
    ajuda: 'Atingido o teto, a conversa encerra e aponta o formulário.',
  },
  {
    chave: 'limite_requisicoes_por_minuto',
    rotulo: 'Limite de requisições por minuto, por pessoa',
    tipo: 'numero',
    ajuda: 'Impede que uma pessoa (ou um script) consuma o orçamento de todos.',
  },
]

function paraTexto(valor: unknown, tipo: 'lista' | 'numero' | 'texto'): string {
  if (tipo === 'lista') return Array.isArray(valor) ? valor.join(', ') : ''
  return valor === null || valor === undefined ? '' : String(valor)
}

function doTexto(texto: string, tipo: 'lista' | 'numero' | 'texto'): unknown {
  if (tipo === 'lista') {
    return texto
      .split(',')
      .map((v) => v.trim())
      .filter((v) => v.length > 0)
  }
  if (tipo === 'numero') {
    const n = Number(texto)
    return Number.isFinite(n) ? n : 0
  }
  const limpo = texto.trim()
  return limpo.length > 0 ? limpo : null
}

export function TelaAdmin() {
  const [config, setConfig] = useState<ConfigValores | null>(null)
  const [rascunhos, setRascunhos] = useState<Record<string, string>>({})
  const [salvando, setSalvando] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [auditoria, setAuditoria] = useState<RegistroAuditoria[] | null>(null)
  const [filtroEmail, setFiltroEmail] = useState('')
  const [lacunas, setLacunas] = useState<MapaDeLacunas | null>(null)
  const [metricas, setMetricas] = useState<ResumoMetricas | null>(null)
  const [assentos, setAssentos] = useState<RespostaAssentos | null>(null)
  const [recomendacoes, setRecomendacoes] = useState<Recomendacao[] | null>(null)

  async function carregar() {
    try {
      const r = await api.adminConfig()
      setConfig(r.config)
      const iniciais: Record<string, string> = {}
      for (const c of CAMPOS) iniciais[c.chave] = paraTexto(r.config[c.chave], c.tipo)
      setRascunhos(iniciais)
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : 'Não conseguimos carregar a configuração.')
    }
  }

  async function carregarAuditoria(email?: string) {
    try {
      setAuditoria((await api.adminAuditoria(email)).itens)
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : 'Não conseguimos carregar a auditoria.')
    }
  }

  useEffect(() => {
    void carregar()
    void carregarAuditoria()
    // O mapa de lacunas não bloqueia a tela: se falhar, a configuração continua
    // editável — são coisas independentes.
    api
      .adminLacunas()
      .then(setLacunas)
      .catch(() => setLacunas(null))
    api
      .adminMetricas()
      .then(setMetricas)
      .catch(() => setMetricas(null))
    api
      .adminAssentos()
      .then(setAssentos)
      .catch(() => setAssentos(null))
    api
      .adminRecomendacoesAssentos()
      .then((r) => setRecomendacoes(r.itens))
      .catch(() => setRecomendacoes(null))
  }, [])

  async function salvar(chave: keyof ConfigValores, tipo: 'lista' | 'numero' | 'texto') {
    setSalvando(chave)
    setErro(null)
    setAviso(null)
    try {
      await api.adminSalvarConfig(chave, doTexto(rascunhos[chave] ?? '', tipo))
      setAviso(`"${chave}" salvo. Vale na próxima requisição, sem deploy.`)
      await carregar()
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : 'Não conseguimos salvar.')
    } finally {
      setSalvando(null)
    }
  }

  if (erro && !config) return <Aviso atencao>{erro}</Aviso>
  if (!config) return <p className="carregando">Carregando a configuração…</p>

  return (
    <div className="pilha">
      <div>
        <span className="eyebrow">Somente admin</span>
        <h1 className="titulo-secao">Configuração</h1>
      </div>

      <Aviso>
        Tudo aqui vale <strong>sem deploy</strong>, na requisição seguinte. E o app é{' '}
        <strong>fail-closed</strong>: lista vazia significa <em>negar</em>, nunca
        "liberar todos".
      </Aviso>

      {aviso && <Aviso>{aviso}</Aviso>}
      {erro && <Aviso atencao>{erro}</Aviso>}

      <div className="pilha">
        {CAMPOS.map((c) => {
          const atual = paraTexto(config[c.chave], c.tipo)
          const mudou = (rascunhos[c.chave] ?? '') !== atual
          return (
            <div className="campo" key={c.chave}>
              <label htmlFor={`cfg-${c.chave}`}>{c.rotulo}</label>
              <input
                id={`cfg-${c.chave}`}
                type={c.tipo === 'numero' ? 'number' : 'text'}
                step={c.tipo === 'numero' ? 'any' : undefined}
                value={rascunhos[c.chave] ?? ''}
                onChange={(e) =>
                  setRascunhos((r) => ({ ...r, [c.chave]: e.target.value }))
                }
                placeholder={c.tipo === 'lista' ? 'separe por vírgula' : ''}
              />
              <span className="dica">{c.ajuda}</span>
              {mudou && (
                <div className="acoes">
                  <button
                    type="button"
                    className="botao botao-primario"
                    onClick={() => void salvar(c.chave, c.tipo)}
                    disabled={salvando === c.chave}
                  >
                    {salvando === c.chave ? 'Salvando…' : 'Salvar'}
                  </button>
                  <button
                    type="button"
                    className="botao botao-discreto"
                    onClick={() => setRascunhos((r) => ({ ...r, [c.chave]: atual }))}
                  >
                    Desfazer
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>

      <h2 className="titulo-secao" style={{ fontSize: 'var(--fs-h3)' }}>
        Métricas
      </h2>
      <Aviso>
        Taxa de deflexão, taxa de override e via de abertura — o mínimo para
        calibrar o threshold da Regra 1 e da Regra 2 (O1, R-04). Sem bloqueio ou
        busca ainda, a taxa aparece como <strong>"sem dados"</strong>, nunca 0% —
        0% pareceria "a regra funciona perfeitamente" quando não há nada para medir.
      </Aviso>

      {metricas === null ? (
        <p className="carregando">Carregando as métricas…</p>
      ) : (
        <div className="pilha">
          <div className="recibo">
            <dl>
              <dt>Taxa de override (geral)</dt>
              <dd>{formatarPct(metricas.taxaOverrideGlobalPct)}</dd>
              <dt>Chamados por conversa</dt>
              <dd>{metricas.chamadosPorVia.conversa ?? 0}</dd>
              <dt>Chamados por formulário</dt>
              <dd>{metricas.chamadosPorVia.formulario ?? 0}</dd>
              <dt>Buscas sem resultado</dt>
              <dd>
                {metricas.buscas.semResultado} de {metricas.buscas.total} (
                {formatarPct(metricas.buscas.taxaSemResultadoPct)})
              </dd>
            </dl>
          </div>

          <div className="pilha">
            <h3 className="titulo-filhos">Deflexão por regra</h3>
            <p className="dica">{metricas.painel.avisoDeflexao}</p>
            <ul className="chamados">
              {metricas.deflexaoPorRegra.map((d) => (
                <li key={d.regra} className="chamado" style={{ cursor: 'default' }}>
                  <span className="chamado-topo">
                    <span className="chamado-chave">{rotuloRegra(d.regra)}</span>
                    <Selo
                      variante={
                        d.taxaDeflexaoPct !== null && d.taxaDeflexaoPct >= 50
                          ? 'lime'
                          : 'contorno'
                      }
                    >
                      {formatarPct(d.taxaDeflexaoPct)}
                    </Selo>
                  </span>
                  <span className="chamado-meta">
                    <span className="dica">
                      {d.overrides} override{d.overrides === 1 ? '' : 's'} de{' '}
                      {d.totalBloqueios} bloqueio{d.totalBloqueios === 1 ? '' : 's'}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <PainelDaFase3 metricas={metricas} />
        </div>
      )}

      <h2 className="titulo-secao" style={{ fontSize: 'var(--fs-h3)' }}>
        Governança de assentos
      </h2>
      <Aviso>
        Inventário e último acesso vêm da Organizations API, coletados <strong>uma vez
        por dia</strong> por um cron — não dá para consultar ao vivo.{' '}
        {assentos?.coletadoEm
          ? `Última coleta: ${assentos.coletadoEm}.`
          : 'Ainda não há nenhuma coleta registrada.'}
      </Aviso>

      {assentos === null ? (
        <p className="carregando">Carregando o inventário de assentos…</p>
      ) : assentos.coletadoEm === null ? (
        <p className="dica">
          Sem dado ainda — ou a organização não está configurada (Q1), ou o cron diário
          ainda não rodou.
        </p>
      ) : (
        <div className="pilha">
          <div className="recibo">
            <dl>
              <dt>Assentos ociosos</dt>
              <dd>
                {assentos.custo.ocioso.usuarios} sem uso de nenhum produto atribuído há
                pelo menos {assentos.ociosoDesdeDias} dias
              </dd>
              <dt>Custo mensal</dt>
              <dd>
                {assentos.custo.custoConfigurado ? (
                  formatarUsd(assentos.custo.totalMensalUsd)
                ) : (
                  <>
                    <Selo variante="contorno">Não configurado</Selo> — falta o preço por
                    produto (Q8, com o financeiro)
                  </>
                )}
              </dd>
            </dl>
          </div>

          <Aviso atencao>
            {assentos.limitacoesUltimoAcesso.criterioAtivo} E o dado pode atrasar até{' '}
            {assentos.limitacoesUltimoAcesso.atrasoMaximoHoras}h — não rebaixe o acesso
            de alguém só porque "sem uso" apareceu agora.
          </Aviso>

          {/* Q1 — o que ainda não foi verificado contra a API real vai PARA A TELA.
              Um console que promete revogar assento e falha no clique é pior que um
              console que avisa antes. */}
          {assentos.endpointsNaoVerificados.length > 0 && (
            <Aviso atencao>
              <strong>Ainda não verificado contra a API real.</strong> A credencial de Org
              Admin não existe nesta instalação (Q1), então as chamadas abaixo foram
              escritas pela documentação e testadas só contra o dublê:
              <ul className="lista-endpoints">
                {assentos.endpointsNaoVerificados.map((e) => (
                  <li key={e.caminho}>
                    <span className="caminho-api">
                      {e.metodo} {e.caminho}
                    </span>{' '}
                    — {e.risco}
                  </li>
                ))}
              </ul>
            </Aviso>
          )}

          <div className="pilha">
            <h3 className="titulo-filhos">Por produto</h3>
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
                      {p.ociosos} {p.ociosos === 1 ? 'ocioso' : 'ociosos'}
                    </Selo>
                    <span className="dica">
                      {p.custoMensalUsd === null
                        ? 'custo não configurado'
                        : formatarUsd(p.custoMensalUsd) + '/mês'}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div className="pilha">
            <div className="chamado-topo">
              <h3 className="titulo-filhos">Recomendações de rebaixamento/remoção</h3>
              <a
                className="botao botao-contorno"
                href="/api/admin/assentos/recomendacoes?formato=csv"
                download="recomendacoes-assentos.csv"
              >
                Exportar CSV
              </a>
            </div>
            {!recomendacoes ? (
              <p className="carregando">Carregando as recomendações…</p>
            ) : recomendacoes.length === 0 ? (
              <p className="dica">Nada por aqui — o que é uma boa notícia.</p>
            ) : (
              <ul className="chamados">
                {recomendacoes.map((r) => (
                  <li key={r.accountId} className="chamado" style={{ cursor: 'default' }}>
                    <span className="chamado-topo">
                      <span className="chamado-chave">{r.email}</span>
                      <Selo variante={r.tipo === 'rebaixar_para_customer' ? 'lime' : 'contorno'}>
                        {rotuloRecomendacao(r.tipo)}
                      </Selo>
                    </span>
                    <span className="chamado-titulo">{r.motivo}</span>
                    <span className="chamado-meta">
                      <span className="dica">{r.produtosAfetados.join(', ')}</span>
                    </span>
                    <Revogacao
                      recomendacao={r}
                      aoRevogar={() => {
                        setAviso(null)
                        void api
                          .adminAssentos()
                          .then(setAssentos)
                          .catch(() => undefined)
                      }}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      <h2 className="titulo-secao" style={{ fontSize: 'var(--fs-h3)' }}>
        Lacunas de documentação
      </h2>
      <Aviso>
        O que as pessoas procuraram e <strong>não resolveu</strong>. São três sinais
        diferentes, e o segundo é o menos óbvio: documentação que existe, aparece na
        busca e ninguém abre. Isto é backlog de <strong>escrita</strong> — por isso
        conta pessoas em vez de nomeá-las.
      </Aviso>

      {lacunas === null ? (
        <p className="carregando">Carregando o mapa de lacunas…</p>
      ) : (
        <div className="pilha">
          <ListaDeLacunas
            titulo="Ninguém documentou"
            explicacao="A busca não achou nada para estes termos."
            itens={lacunas.semResultado}
          />
          <ListaDeLacunas
            titulo="Documentado, mas ninguém abriu"
            explicacao="Havia resultado e a pessoa seguiu sem abrir — o título não convenceu, ou não era isso."
            itens={lacunas.semClique}
          />
          <div className="pilha">
            <h3 className="titulo-filhos">O que disseram ao insistir</h3>
            <p className="dica">
              Motivo escrito por quem foi bloqueado e seguiu mesmo assim (RF-13). É o
              sinal mais direto do que falta na página.
            </p>
            {lacunas.overrides.length === 0 ? (
              <p className="dica">Nenhum override registrado ainda.</p>
            ) : (
              <ul className="chamados">
                {lacunas.overrides.map((o, i) => (
                  <li key={i} className="chamado" style={{ cursor: 'default' }}>
                    <span className="chamado-topo">
                      <span className="chamado-chave">{rotuloRegra(o.regra)}</span>
                      <span className="dica">{o.criadoEm}</span>
                    </span>
                    <span className="chamado-titulo">{o.motivo}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      <h2 className="titulo-secao" style={{ fontSize: 'var(--fs-h3)' }}>
        Auditoria
      </h2>
      <Aviso>
        Registro append-only de toda ação que toca a Atlassian ou a IA —{' '}
        <strong>inclusive as que falham e as que são negadas</strong>.
      </Aviso>

      <div className="campo">
        <label htmlFor="filtro-email">Filtrar por e-mail (vazio mostra todos)</label>
        <input
          id="filtro-email"
          value={filtroEmail}
          onChange={(e) => setFiltroEmail(e.target.value)}
          placeholder="pessoa@gocase.com"
        />
        <div className="acoes">
          <button
            type="button"
            className="botao botao-contorno"
            onClick={() => void carregarAuditoria(filtroEmail.trim() || undefined)}
          >
            Filtrar
          </button>
        </div>
      </div>

      {!auditoria ? (
        <p className="carregando">Carregando a auditoria…</p>
      ) : auditoria.length === 0 ? (
        <p className="dica">Nenhum registro ainda.</p>
      ) : (
        <ul className="chamados">
          {auditoria.map((r) => (
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
                <span className="dica">{r.criado_em}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}


/**
 * O painel de RF-55 — T-232, T-233, T-234, T-310, T-312.
 *
 * Ordem deliberada: **calibragem primeiro**. É a única parte da tela em que o admin toma
 * uma decisão; o resto é leitura. Pôr os números de volume no topo faria a pessoa rolar
 * até o fim para achar a única coisa acionável.
 */
function PainelDaFase3({ metricas }: { metricas: ResumoMetricas }) {
  const p = metricas.painel
  return (
    <div className="pilha">
      <h3 className="titulo-filhos">Calibragem das regras</h3>
      <p className="dica">
        A barra é a proporção de bloqueios em que a pessoa insistiu. Antes de mexer no
        threshold, leia o que ela escreveu e veja qual página apareceu: subir o número
        bloqueia menos, mas quem estava certo era quem insistiu.
      </p>
      {p.calibragem.map((c) => (
        <FaixaCalibragem key={c.regra} calibragem={c} />
      ))}

      <div className="grade-metricas">
        <Metrica
          rotulo="Não voltaram por chamado"
          valor={formatarPct(p.deflexaoAparente.taxaPct)}
          semDados={p.deflexaoAparente.taxaPct === null}
          nota={`${p.deflexaoAparente.semChamadoDepois} de ${p.deflexaoAparente.bloqueiosSemOverride} bloqueios, em ${p.deflexaoAparente.janelaDias} dias`}
        />
      </div>
      {/* ⚠️ O viés vai JUNTO do número, não num rodapé. Este é o campo mais fácil de ler
          errado do painel inteiro: quem foi pedir no chat conta aqui como "resolveu". */}
      <p className="dica">{p.deflexaoAparente.viesConhecido}</p>

      <h3 className="titulo-filhos">SLA de primeira resposta</h3>
      <p className="dica">
        Avaliado na última rodada do cron, não agora — ler os comentários de todos os
        chamados a cada abertura desta tela custaria dezenas de chamadas à Atlassian. E o
        prazo é de <strong>primeira resposta</strong>: chamado respondido em uma hora e
        resolvido em duas semanas está dentro do SLA.
      </p>
      <div className="grade-metricas">
        <Metrica
          rotulo="Aderência"
          valor={formatarPct(p.sla.aderenciaPct)}
          semDados={p.sla.aderenciaPct === null}
          nota={`${p.sla.dentroDoPrazo} de ${p.sla.respondidos} respondidos no prazo`}
        />
        <Metrica
          rotulo="Perto do prazo"
          valor={String(p.sla.emRisco)}
          nota="ainda sem primeira resposta"
        />
        <Metrica
          rotulo="Prazo estourado"
          valor={String(p.sla.estourados)}
          alerta={p.sla.estourados > 0}
          nota="ninguém respondeu no prazo"
        />
        <Metrica
          rotulo="Avaliados"
          valor={String(p.sla.totalAvaliados)}
          nota="chamados na última rodada"
        />
      </div>

      <h3 className="titulo-filhos">Avisos</h3>
      {!metricas.canalNotificacaoDefinido && (
        <Aviso atencao>
          Nenhum canal de aviso definido (Q11). Os avisos estão sendo{' '}
          <strong>registrados e suprimidos</strong> — o número de "não enviados" abaixo é o
          tamanho do que passa a sair no dia em que o canal for escolhido.
        </Aviso>
      )}
      <div className="grade-metricas">
        <Metrica rotulo="Enviados" valor={String(p.notificacoes.enviada)} />
        <Metrica rotulo="Na fila" valor={String(p.notificacoes.pendente)} />
        <Metrica
          rotulo="Falharam"
          valor={String(p.notificacoes.falha)}
          alerta={p.notificacoes.falha > 0}
          nota="canal recusou depois de várias tentativas"
        />
        <Metrica
          rotulo="Não enviados"
          valor={String(p.notificacoes.suprimida)}
          nota="ação da própria pessoa, ou sem canal definido"
        />
      </div>

      <h3 className="titulo-filhos">Volume</h3>
      <div className="grade-metricas">
        <Metrica
          rotulo="Pelo agente"
          valor={String(p.canal.porVia.conversa ?? 0)}
          nota="com as duas verificações"
        />
        <Metrica
          rotulo="Pelo formulário"
          valor={String(p.canal.porVia.formulario ?? 0)}
          nota="sem verificação (D-04)"
        />
        {Object.entries(p.chamadosPorPrioridade).map(([prioridade, total]) => (
          <Metrica key={prioridade} rotulo={rotuloPrioridade(prioridade)} valor={String(total)} />
        ))}
      </div>
      {/* Aderência de canal (O5) NÃO aparece como taxa: o denominador seria "todos os
          pedidos que chegaram ao time de tech", incluindo chat e reunião — dado que o app
          não vê. Mostrar uma porcentagem aqui seria inventar o denominador. */}
      <p className="dica">
        {p.canal.totalPeloApp} {p.canal.totalPeloApp === 1 ? 'chamado' : 'chamados'} abertos
        pelo app. A aderência de canal (`O5`) compara isso com o que entrou por chat,
        reunião e Jira direto — número que só o Jira tem, e que entra como comparação
        manual.
      </p>

      <h3 className="titulo-filhos">Por área</h3>
      {p.chamadosPorArea.length === 0 ? (
        <p className="dica">Nenhum chamado ainda.</p>
      ) : (
        <ul className="chamados">
          {p.chamadosPorArea.map((a) => (
            <li key={a.area ?? 'sem-area'} className="chamado" style={{ cursor: 'default' }}>
              <span className="chamado-topo">
                <span className="chamado-chave">{a.area ?? 'Sem área'}</span>
                <Selo variante="contorno">
                  {a.total} {a.total === 1 ? 'chamado' : 'chamados'}
                </Selo>
              </span>
              {a.area === null && (
                <span className="chamado-meta">
                  <span className="dica">
                    E-mail fora do mapa de áreas — o app não chuta uma área.
                  </span>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      <h3 className="titulo-filhos">Orçamento de API e custo de IA</h3>
      <p className="dica">
        A Atlassian não publica o limite por API token e só manda os cabeçalhos de rate
        limit <em>em respostas 429</em>. Medir a taxa de 429 é a única telemetria de
        orçamento que existe.
      </p>
      <div className="grade-metricas">
        <Metrica
          rotulo="Taxa de 429"
          valor={formatarPct(p.telemetriaAtlassian.taxa429Pct)}
          semDados={p.telemetriaAtlassian.taxa429Pct === null}
          alerta={p.telemetriaAtlassian.acimaDoLimiar}
          nota={`${p.telemetriaAtlassian.total429} de ${p.telemetriaAtlassian.totalRequisicoes} requisições`}
        />
        <Metrica
          rotulo="Custo de IA"
          valor={formatarUsd(p.ia.custoTotalUsd)}
          nota={`${p.ia.conversas} ${p.ia.conversas === 1 ? 'conversa' : 'conversas'}`}
        />
        <Metrica
          rotulo="Custo por conversa"
          valor={p.ia.custoMedioUsd === null ? 'sem dados' : formatarUsd(p.ia.custoMedioUsd)}
          semDados={p.ia.custoMedioUsd === null}
        />
      </div>

      {metricas.piloto.ligado && (
        <Aviso atencao>
          O piloto está ligado para <strong>{metricas.piloto.pessoas}</strong>{' '}
          {metricas.piloto.pessoas === 1 ? 'pessoa' : 'pessoas'}. Os números acima são
          dessas pessoas, não da empresa.
        </Aviso>
      )}

      <h3 className="titulo-filhos">Assentos: antes × depois</h3>
      {metricas.baselineAssentos === null ? (
        <p className="dica">
          Sem baseline. O retrato de assentos de antes do projeto é levantado na Fase 0 e
          preenchido em <code>baseline_assentos</code> — sem ele não há comparação, e
          comparar contra zero mostraria uma economia de 100% que não aconteceu.
        </p>
      ) : (
        <div className="grade-metricas">
          {Object.entries(metricas.baselineAssentos.porProduto).map(([produto, total]) => (
            <Metrica
              key={produto}
              rotulo={produto}
              valor={String(total)}
              nota={`baseline de ${metricas.baselineAssentos!.coletadoEm.slice(0, 10)}`}
            />
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * A faixa de calibragem — T-310.
 *
 * ⚠️ Os motivos e as páginas ficam DENTRO da mesma caixa que a barra, de propósito. A tela
 * de calibragem tem um viés embutido: o threshold é o único valor editável, então mostrar
 * "66% de override" sozinho empurra para mexer nele. Quase sempre a resposta certa é
 * escrever a página que as pessoas apontaram (`RF-13`, `RF-42`) — e para escolher entre as
 * duas é preciso ver as duas juntas.
 */
function FaixaCalibragem({ calibragem }: { calibragem: CalibragemRegra }) {
  const semDados = calibragem.totalBloqueios === 0
  const pct = calibragem.taxaOverridePct ?? 0
  return (
    <div className="faixa-calibragem">
      <div className="faixa-topo">
        <span className="faixa-nome">{rotuloRegra(calibragem.regra)}</span>
        <span className="dica">
          threshold atual: <strong>{calibragem.thresholdAtual}</strong>
        </span>
      </div>

      <div
        className="faixa-trilho"
        data-sem-dados={semDados ? 'true' : 'false'}
        role="img"
        aria-label={
          semDados
            ? 'Nenhum bloqueio registrado ainda nesta regra'
            : `${calibragem.overrides} de ${calibragem.totalBloqueios} bloqueios tiveram override`
        }
      >
        {!semDados && (
          <div className="faixa-preenchimento" style={{ width: `${Math.min(100, pct)}%` }} />
        )}
      </div>

      <div className="faixa-legenda">
        <span>
          <strong>{formatarPct(calibragem.taxaOverridePct)}</strong> insistiram
        </span>
        <span className="dica">
          {calibragem.overrides} de {calibragem.totalBloqueios}{' '}
          {calibragem.totalBloqueios === 1 ? 'bloqueio' : 'bloqueios'}
        </span>
      </div>

      {calibragem.paginasApontadas.length > 0 && (
        <div>
          <span className="eyebrow">O que apareceu e não convenceu</span>
          <ul className="faixa-paginas">
            {calibragem.paginasApontadas.map((pa) => (
              <li key={pa.titulo}>
                {pa.titulo}{' '}
                <span className="dica">
                  ({pa.vezes}
                  {pa.vezes === 1 ? ' vez' : ' vezes'})
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {calibragem.motivosDeOverride.length > 0 && (
        <div>
          <span className="eyebrow">Nas palavras de quem insistiu</span>
          <div className="faixa-motivos">
            {calibragem.motivosDeOverride.slice(0, 5).map((m, i) => (
              <p key={i}>{m}</p>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/** Um número que o admin lê de relance. `semDados` nunca vira `0`. */
function Metrica({
  rotulo,
  valor,
  nota,
  semDados,
  alerta,
}: {
  rotulo: string
  valor: string
  nota?: string
  semDados?: boolean
  alerta?: boolean
}) {
  return (
    <div className="metrica" data-alerta={alerta ? 'true' : 'false'}>
      <span className="metrica-rotulo">{rotulo}</span>
      <span className="metrica-valor" data-sem-dados={semDados ? 'true' : 'false'}>
        {valor}
      </span>
      {nota && <span className="metrica-nota">{nota}</span>}
    </div>
  )
}

/**
 * Revogar produto — T-131, RF-57.
 *
 * ⚠️ A segunda confirmação é **digitar o e-mail**, não um "tem certeza?". Um diálogo
 * clicável adiciona um clique; digitar obriga a olhar QUEM está sendo afetado. O erro que
 * se quer evitar não é clicar sem querer — é revogar a linha errada de uma tabela que
 * estava ordenada de outro jeito do que se esperava.
 *
 * E nada de lime: o acento positivo da marca numa ação destrutiva treina o olho errado.
 */
function Revogacao({
  recomendacao,
  aoRevogar,
}: {
  recomendacao: Recomendacao
  aoRevogar: () => void
}) {
  const [aberto, setAberto] = useState(false)
  const [produto, setProduto] = useState(recomendacao.produtosAfetados[0] ?? '')
  const [confirmacao, setConfirmacao] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [feito, setFeito] = useState<string | null>(null)

  if (feito) {
    return (
      <span className="chamado-meta">
        <Selo variante="contorno">Revogado</Selo>
        <span className="dica">{feito}</span>
      </span>
    )
  }

  if (!aberto) {
    return (
      <div className="acoes">
        <button type="button" className="botao botao-discreto" onClick={() => setAberto(true)}>
          Revogar produto…
        </button>
      </div>
    )
  }

  const confere = confirmacao.trim().toLowerCase() === recomendacao.email.toLowerCase()

  return (
    <div className="confirmacao-critica">
      <p>
        Revogar o acesso de <span className="alvo-revogacao">{recomendacao.email}</span>. A
        pessoa perde o produto escolhido nesta organização Atlassian — não é reversível
        daqui.
      </p>

      {recomendacao.produtosAfetados.length > 1 && (
        <div className="campo">
          <label htmlFor={`produto-${recomendacao.accountId}`}>Produto</label>
          <select
            id={`produto-${recomendacao.accountId}`}
            value={produto}
            onChange={(e) => setProduto(e.target.value)}
          >
            {recomendacao.produtosAfetados.map((pr) => (
              <option key={pr} value={pr}>
                {pr}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="campo">
        <label htmlFor={`confirma-${recomendacao.accountId}`}>
          Para confirmar, digite o e-mail da pessoa
        </label>
        <input
          id={`confirma-${recomendacao.accountId}`}
          value={confirmacao}
          onChange={(e) => setConfirmacao(e.target.value)}
          placeholder={recomendacao.email}
          autoComplete="off"
        />
      </div>

      {erro && <Aviso atencao>{erro}</Aviso>}

      <div className="acoes">
        <button
          type="button"
          className="botao botao-primario"
          disabled={!confere || enviando || !produto}
          onClick={async () => {
            setEnviando(true)
            setErro(null)
            try {
              const r = await api.adminRevogarAssento({
                accountId: recomendacao.accountId,
                produto,
                email: recomendacao.email,
                emailConfirmado: confirmacao.trim(),
              })
              setFeito(r.aviso)
              aoRevogar()
            } catch (e) {
              setErro(
                e instanceof ErroApi
                  ? e.message
                  : 'Não conseguimos revogar agora. O acesso continua como estava.',
              )
            } finally {
              setEnviando(false)
            }
          }}
        >
          {enviando ? 'Revogando…' : 'Revogar acesso'}
        </button>
        <button
          type="button"
          className="botao botao-discreto"
          onClick={() => {
            setAberto(false)
            setConfirmacao('')
          }}
        >
          Cancelar
        </button>
      </div>
    </div>
  )
}

/** Uma das duas listas de termo do mapa (`RF-42`). */
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
      <h3 className="titulo-filhos">{titulo}</h3>
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
                <Selo variante="contorno">
                  {t.pessoas === 1 ? '1 pessoa' : `${t.pessoas} pessoas`}
                </Selo>
                <span className="dica">última: {t.ultimaEm}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function rotuloRegra(regra: string): string {
  return regra === 'regra1_confluence' ? 'Documentação' : 'Histórico'
}

function rotuloPrioridade(prioridade: string): string {
  if (prioridade === 'critica') return 'Crítica'
  if (prioridade === 'alta') return 'Alta'
  if (prioridade === 'normal') return 'Normal'
  return 'Sem prioridade'
}

function rotuloRecomendacao(tipo: 'rebaixar_para_customer' | 'remover_ocioso'): string {
  return tipo === 'rebaixar_para_customer' ? 'Rebaixar para customer' : 'Remover assento'
}

/** `null` = não configurado (Q8). Nunca `US$ 0,00`, que pareceria custo zero. */
function formatarUsd(valor: number | null): string {
  if (valor === null) return 'não configurado'
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'USD' }).format(valor)
}

/** `null` = sem dado ainda — nunca "0%", que pareceria a regra funcionando. */
function formatarPct(valor: number | null): string {
  return valor === null ? 'sem dados' : `${valor.toFixed(1)}%`
}
