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
  type ConfigValores,
  type MapaDeLacunas,
  type Recomendacao,
  type RegistroAuditoria,
  type RespostaAssentos,
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

function rotuloRecomendacao(tipo: 'rebaixar_para_customer' | 'remover_ocioso'): string {
  return tipo === 'rebaixar_para_customer' ? 'Rebaixar para customer' : 'Remover assento'
}

/** `null` nunca chega aqui — quem chama já testou `custoConfigurado`. */
function formatarUsd(valor: number | null): string {
  if (valor === null) return 'não configurado'
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'USD' }).format(valor)
}
