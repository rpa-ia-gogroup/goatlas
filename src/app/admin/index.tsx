/**
 * O console de administração — `RF-49`, `RF-50`, `RF-42`, `RF-53`, `RF-55`, `RF-56`.
 *
 * A versão anterior era um scroll único com cinco trabalhos empilhados: 14 campos
 * na ordem em que foram implementados, depois métricas, assentos, lacunas e
 * auditoria. Funcionava e ninguém entendia — que é o mesmo que não funcionar, já
 * que `RF-49`/`RF-50` existem para a calibração acontecer **sem deploy**, e um
 * console indecifrável empurra a calibração de volta para o `curl`.
 *
 * Três decisões de estrutura:
 *
 * 1. **Organizado por capacidade, não por tipo de dado.** "Quem entra", "Chamados",
 *    "Documentação", "Interrupções". A pessoa chega com um problema ("a busca não
 *    acha nada"), não com o nome de uma chave.
 * 2. **O ajuste mora ao lado do dado que ele afeta.** A taxa de override fica na
 *    mesma seção do controle de interrupção — é o número com que ele se calibra
 *    (`R-04`). O mapa de lacunas fica com os espaços do Confluence, porque lacuna é
 *    backlog de escrita naqueles espaços.
 * 3. **A trilha é navegação E diagnóstico.** Cada seção carrega o próprio estado,
 *    então "o que está desligado" se lê sem abrir nada — mesmo princípio da trilha
 *    de verificação da conversa: o motivo dos três círculos da marca carregando
 *    informação em vez de decoração.
 *
 * Navegação por estado, como o resto do app (Princípio V) — a seção não vai para a
 * URL: é console de uma pessoa por vez, não link que se compartilha.
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
  type ResumoMetricas,
} from '../api'
import { Aviso } from '../componentes'
import {
  diagnosticar,
  estadoDaSecao,
  type Capacidade,
  type SecaoDoConsole,
} from '@/lib/config/diagnostico'
import {
  BlocoDeDado,
  Campo,
  Detalhe,
  MarcaDeEstado,
  paraRascunho,
  doRascunho,
  PrecoPorProduto,
  SECOES,
  type DescritorSecao,
} from './campos'
import {
  PainelAssentos,
  PainelAuditoria,
  PainelLacunas,
  PainelMetricas,
  Quando,
  type Carga,
} from './paineis'

const CARREGANDO = { estado: 'carregando' } as const

export function TelaAdmin() {
  const [secao, setSecao] = useState<SecaoDoConsole>('visao')
  const [config, setConfig] = useState<ConfigValores | null>(null)
  const [rascunhos, setRascunhos] = useState<Record<string, string>>({})
  const [precos, setPrecos] = useState<Record<string, string>>({})
  const [salvando, setSalvando] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [filtroAuditoria, setFiltroAuditoria] = useState('')

  const [metricas, setMetricas] = useState<Carga<ResumoMetricas>>(CARREGANDO)
  const [lacunas, setLacunas] = useState<Carga<MapaDeLacunas>>(CARREGANDO)
  const [assentos, setAssentos] = useState<Carga<RespostaAssentos>>(CARREGANDO)
  const [recomendacoes, setRecomendacoes] = useState<Carga<readonly Recomendacao[]>>(CARREGANDO)
  const [auditoria, setAuditoria] = useState<Carga<readonly RegistroAuditoria[]>>(CARREGANDO)

  async function carregarConfig() {
    try {
      const r = await api.adminConfig()
      setConfig(r.config)
      const iniciais: Record<string, string> = {}
      for (const s of SECOES) {
        for (const c of s.campos) {
          iniciais[c.chave] = paraRascunho(r.config[c.chave], c.tipo)
        }
      }
      setRascunhos(iniciais)
      setPrecos(
        Object.fromEntries(
          Object.entries(r.config.custo_mensal_por_produto).map(([p, v]) => [p, String(v)]),
        ),
      )
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : 'Não conseguimos carregar a configuração.')
    }
  }

  async function carregarAuditoria(email?: string) {
    setAuditoria(CARREGANDO)
    try {
      setAuditoria({ estado: 'pronto', dado: (await api.adminAuditoria(email)).itens })
    } catch {
      setAuditoria({ estado: 'falhou' })
    }
  }

  useEffect(() => {
    void carregarConfig()
    void carregarAuditoria()
    // Cada painel carrega por conta própria: a falha de um não pode impedir a
    // edição do resto (`RNF-18`). Por isso "falhou" é um estado, não um `null`
    // indistinguível de "ainda carregando".
    const buscar = <T,>(p: Promise<T>, guardar: (c: Carga<T>) => void) =>
      p.then((dado) => guardar({ estado: 'pronto', dado })).catch(() => guardar({ estado: 'falhou' }))

    void buscar(api.adminMetricas(), setMetricas)
    void buscar(api.adminLacunas(), setLacunas)
    void buscar(api.adminAssentos(), setAssentos)
    void buscar(
      api.adminRecomendacoesAssentos().then((r) => r.itens as readonly Recomendacao[]),
      setRecomendacoes,
    )
  }, [])

  /**
   * Trocar de seção limpa os recados da anterior. Sem isto, "Domínios de e-mail
   * aceitos salvo" continuava no alto enquanto a pessoa já editava outra coisa —
   * confirmação de uma ação que não é mais a que está na tela.
   */
  function irPara(destino: SecaoDoConsole) {
    setSecao(destino)
    setAviso(null)
    setErro(null)
  }

  async function salvar(chave: string, valor: unknown, rotulo: string) {
    setSalvando(chave)
    setErro(null)
    setAviso(null)
    try {
      await api.adminSalvarConfig(chave as keyof ConfigValores, valor)
      setAviso(`${rotulo} salvo. Já vale na próxima ação de quem estiver usando o app.`)
      await carregarConfig()
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : 'Não conseguimos salvar.')
    } finally {
      setSalvando(null)
    }
  }

  if (erro && !config) return <Aviso atencao>{erro}</Aviso>
  if (!config) return <p className="carregando">Carregando o console…</p>

  const atual = SECOES.find((s) => s.id === secao) ?? SECOES[0]!
  const capacidades = diagnosticar(config)

  return (
    <div className="console">
      <div className="console-topo">
        <span className="eyebrow">Somente admin</span>
        <h1 className="titulo-secao">Administração</h1>
        <p className="dica">
          Toda mudança aqui vale <strong>sem deploy</strong>, já na próxima ação de quem
          estiver usando o app.
        </p>
      </div>

      <nav className="console-trilha" aria-label="Seções da administração">
        {(['configurar', 'acompanhar'] as const).map((grupo) => (
          <div className="trilha-grupo" key={grupo}>
            <h2 className="trilha-grupo-titulo">
              {grupo === 'configurar' ? 'Configurar' : 'Acompanhar'}
            </h2>
            <ul>
              {SECOES.filter((s) => s.grupo === grupo).map((s) => {
                const estado = estadoDaSecao(s.id, config)
                return (
                  <li key={s.id}>
                    <button
                      type="button"
                      className="trilha-item"
                      aria-current={s.id === secao ? 'true' : undefined}
                      onClick={() => irPara(s.id)}
                    >
                      <span>{s.rotulo}</span>
                      {estado && <MarcaDeEstado estado={estado} />}
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="console-conteudo">
        <header className="secao-cabecalho">
          <h2 className="titulo-secao">{atual.titulo}</h2>
          <p className="secao-resumo">{atual.resumo}</p>
        </header>

        {aviso && <Aviso>{aviso}</Aviso>}
        {erro && <Aviso atencao>{erro}</Aviso>}

        {secao === 'visao' ? (
          <VisaoGeral capacidades={capacidades} aoIr={irPara} />
        ) : (
          <div className="pilha">
            {atual.campos.map((c) => (
              <Campo
                key={c.chave}
                descritor={c}
                config={config}
                rascunho={rascunhos[c.chave] ?? ''}
                salvando={salvando === c.chave}
                aoMudar={(texto) => setRascunhos((r) => ({ ...r, [c.chave]: texto }))}
                aoDesfazer={() =>
                  setRascunhos((r) => ({ ...r, [c.chave]: paraRascunho(config[c.chave], c.tipo) }))
                }
                aoSalvar={() =>
                  void salvar(c.chave, doRascunho(rascunhos[c.chave] ?? '', c.tipo), c.rotulo)
                }
              />
            ))}

            <DadosDaSecao
              secao={atual}
              precosSalvos={config.custo_mensal_por_produto}
              assentos={assentos}
              auditoria={auditoria}
              filtroAuditoria={filtroAuditoria}
              lacunas={lacunas}
              metricas={metricas}
              precos={precos}
              recomendacoes={recomendacoes}
              salvando={salvando}
              aoFiltrarAuditoria={() =>
                void carregarAuditoria(filtroAuditoria.trim() || undefined)
              }
              aoMudarFiltro={setFiltroAuditoria}
              aoMudarPreco={(produto, texto) => setPrecos((p) => ({ ...p, [produto]: texto }))}
              aoSalvarPrecos={() =>
                void salvar('custo_mensal_por_produto', mapaDePrecos(precos), 'Preço por produto')
              }
            />
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * A primeira seção: o estado do app em cinco frases.
 *
 * É o que substitui abrir 13 campos para descobrir que a busca está desligada
 * porque uma lista está vazia. Cada cartão leva para a seção que resolve.
 */
function VisaoGeral({
  capacidades,
  aoIr,
}: {
  capacidades: readonly Capacidade[]
  aoIr: (s: SecaoDoConsole) => void
}) {
  return (
    <ul className="capacidades">
      {capacidades.map((c) => (
        <li key={c.id} className="capacidade" data-estado={c.estado}>
          <div className="capacidade-topo">
            <h3>{c.nome}</h3>
            <MarcaDeEstado estado={c.estado} />
          </div>
          <p>{c.consequencia}</p>
          <button type="button" className="botao botao-discreto" onClick={() => aoIr(c.secao)}>
            Ajustar {c.nome.toLowerCase()} →
          </button>
        </li>
      ))}
    </ul>
  )
}

/** O acompanhamento que pertence a cada seção — nenhuma área genérica de relatórios. */
function DadosDaSecao({
  secao,
  metricas,
  lacunas,
  assentos,
  recomendacoes,
  auditoria,
  precos,
  precosSalvos,
  salvando,
  filtroAuditoria,
  aoMudarFiltro,
  aoFiltrarAuditoria,
  aoMudarPreco,
  aoSalvarPrecos,
}: {
  secao: DescritorSecao
  metricas: Carga<ResumoMetricas>
  lacunas: Carga<MapaDeLacunas>
  assentos: Carga<RespostaAssentos>
  recomendacoes: Carga<readonly Recomendacao[]>
  auditoria: Carga<readonly RegistroAuditoria[]>
  /** Rascunho digitado. */
  precos: Record<string, string>
  /** O que está no banco — é contra isto que se decide se há mudança pendente. */
  precosSalvos: Readonly<Record<string, number>>
  salvando: string | null
  filtroAuditoria: string
  aoMudarFiltro: (v: string) => void
  aoFiltrarAuditoria: () => void
  aoMudarPreco: (produto: string, texto: string) => void
  aoSalvarPrecos: () => void
}) {
  if (secao.id === 'interrupcao') {
    return (
      <BlocoDeDado
        titulo="Está funcionando?"
        explicacao="Quantos resolveram sem abrir chamado, e quantos insistiram mesmo assim. É com estes números que se mexe nos controles acima — não no achismo."
      >
        <Quando carga={metricas} carregando="Somando as interrupções…">
          {(m) => <PainelMetricas metricas={m} />}
        </Quando>
      </BlocoDeDado>
    )
  }

  if (secao.id === 'documentacao') {
    return (
      <BlocoDeDado
        titulo="O que falta escrever"
        explicacao="Três sinais do que as pessoas procuraram e não resolveu. Isto é backlog de escrita: conta quantas pessoas, nunca quais."
      >
        <Quando carga={lacunas} carregando="Montando o mapa…">
          {(l) => <PainelLacunas lacunas={l} />}
        </Quando>
      </BlocoDeDado>
    )
  }

  if (secao.id === 'assentos') {
    return (
      <div className="pilha">
        <Quando carga={assentos} carregando="Buscando a última coleta…">
          {(a) => (
            <>
              <Detalhe resumo="Preço mensal de cada produto">
                <PrecoPorProduto
                  produtos={a.custo.porProduto.map((p) => p.produto)}
                  precos={precosSalvos}
                  rascunhos={precos}
                  salvando={salvando === 'custo_mensal_por_produto'}
                  aoMudar={aoMudarPreco}
                  aoSalvar={aoSalvarPrecos}
                />
              </Detalhe>
              <BlocoDeDado
                titulo="Quem está consumindo licença"
                explicacao="Da última coleta diária. Nenhuma ação aqui mexe na Atlassian — a lista é para decidir, não executa."
              >
                <PainelAssentos assentos={a} recomendacoes={recomendacoes} />
              </BlocoDeDado>
            </>
          )}
        </Quando>
      </div>
    )
  }

  if (secao.id === 'auditoria') {
    return (
      <PainelAuditoria
        auditoria={auditoria}
        filtro={filtroAuditoria}
        aoMudarFiltro={aoMudarFiltro}
        aoFiltrar={aoFiltrarAuditoria}
      />
    )
  }

  return null
}

/** Produto sem número digitado sai do mapa — melhor ausente que zero inventado. */
function mapaDePrecos(rascunhos: Record<string, string>): Record<string, number> {
  const mapa: Record<string, number> = {}
  for (const [produto, texto] of Object.entries(rascunhos)) {
    const n = Number(texto)
    if (texto.trim().length > 0 && Number.isFinite(n) && n >= 0) mapa[produto] = n
  }
  return mapa
}
