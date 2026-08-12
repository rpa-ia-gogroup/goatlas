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
  BaselineAssentos,
  CalibragemRegra,
  MapaDeLacunas,
  Recomendacao,
  RegistroAuditoria,
  RespostaAssentos,
  ResumoMetricas,
  ResumoPainel,
  ResumoSla,
  TermoComLacuna,
} from '../api'
import type { SecaoDoConsole } from '@/lib/config/diagnostico'
import { Aviso, Selo } from '../componentes'

/**
 * ⚠️ **Onde cada número calculado aparece — e a trava contra ele sumir de novo.**
 *
 * A calibragem foi entregue em `T-310`, atravessou duas fases e **desapareceu** no rewrite
 * do console (`D-25`): o servidor continuou montando `calibragem`, `sla`, `chamadosPorArea`
 * e `chamadosPorPrioridade`, e este arquivo passou a consumir só `painel.evidencia`. Nada
 * ficou vermelho — `tests/tela-admin.test.ts` afirma sobre descritores, rótulos e estados,
 * nunca sobre *quais painéis são renderizados*. O único rastro foi um CSS órfão.
 *
 * Este mapa é `Record<keyof ResumoPainel, …>` de propósito: campo novo no painel **sem
 * destino declarado não compila** — mesma trava do mapa `FAMILIA` em `config/validar.ts`.
 * E `tests/painel-do-console.test.ts` renderiza cada seção e procura o número lá dentro,
 * então declarar a casa sem desenhar o painel também reprova.
 *
 * A seção é sempre aquela cuja **configuração aquele número calibra** (`D-25`, `R-04`): a
 * taxa de override embaixo do controle de interrupção, o custo de IA embaixo do teto de
 * custo. Não existe aba de "relatórios" — número longe do controle não muda decisão.
 */
export const PAINEIS_DO_CONSOLE: Readonly<Record<keyof ResumoPainel, SecaoDoConsole | null>> = {
  calibragem: 'interrupcao',
  deflexaoAparente: 'interrupcao',
  avisoDeflexao: 'interrupcao',
  evidencia: 'interrupcao',
  sla: 'chamados',
  chamadosPorArea: 'chamados',
  chamadosPorPrioridade: 'chamados',
  canal: 'chamados',
  notificacoes: 'chamados',
  ia: 'custo',
  telemetriaAtlassian: 'custo',
  /**
   * Não é um número: é a flag que declara que `deflexaoAparente` é **proxy**, e o que ela
   * governa — o aviso do viés — está na tela logo ao lado do número (`T-235`, `D-20`).
   * Desenhá-la seria mostrar "false" para alguém.
   */
  deflexaoResolvidaConhecida: null,
}

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

      <PainelDeflexaoAparente painel={metricas.painel} />
      <PainelEvidencia evidencia={metricas.painel.evidencia} />
      <PainelArea area={metricas.area} />
    </div>
  )
}

/* ---------- deflexão aparente (T-235, D-20) ----------------------------- */

/**
 * O proxy de "foi interrompido e resolveu" — com o viés **na mesma caixa**.
 *
 * ⚠️ O app não sabe se a pessoa leu a página e resolveu ou se foi pedir no chat; sabe
 * apenas se ela voltou a abrir chamado. `D-20` decidiu mostrar o número **com o viés
 * impresso ao lado**, não escondê-lo nem renomeá-lo para "resolvidos pela documentação" —
 * que seria o projeto se avaliando bem por engano (`R-04`). Tirar a frase daqui e mandá-la
 * para um rodapé é a mesma coisa que apagá-la.
 */
export function PainelDeflexaoAparente({ painel }: { painel: ResumoPainel }) {
  const d = painel.deflexaoAparente
  return (
    <div className="recibo">
      <span className="eyebrow">Não voltaram a abrir</span>
      <dl>
        <dt>Interrompidos e não insistiram</dt>
        <dd>{d.bloqueiosSemOverride}</dd>
        <dt>Sem chamado nos {d.janelaDias} dias seguintes</dt>
        <dd>
          {d.semChamadoDepois} — {formatarPct(d.taxaPct)}
        </dd>
      </dl>
      <p className="dica">{painel.avisoDeflexao}</p>
      <p className="dica">{d.viesConhecido}</p>
    </div>
  )
}

/* ---------- calibragem das regras (T-310, R-04) ------------------------- */

/**
 * A calibragem — o painel que **precisa** ficar ao lado do controle de interrupção.
 *
 * ⚠️ Os motivos e as páginas apontadas moram **dentro da mesma caixa** que a barra, e isso
 * não é preferência de layout. O threshold é o único campo editável daquela seção: mostrar
 * "50% insistiram" sozinho empurra para mexer nele, quando a resposta certa quase sempre é
 * escrever a página que as pessoas apontaram (`RF-13`, `RF-42`). Para escolher entre as
 * duas é preciso ver as duas juntas — separá-las devolve o viés.
 */
export function PainelCalibragem({
  calibragem,
}: {
  calibragem: readonly CalibragemRegra[]
}) {
  if (calibragem.length === 0) {
    return (
      <p className="dica">
        Nenhuma regra configurada ainda — sem verificação, ninguém é interrompido e não há
        o que calibrar.
      </p>
    )
  }
  return (
    <div className="pilha">
      {calibragem.map((c) => (
        <FaixaCalibragem key={c.regra} calibragem={c} />
      ))}
    </div>
  )
}

function FaixaCalibragem({ calibragem }: { calibragem: CalibragemRegra }) {
  const semDados = calibragem.totalBloqueios === 0
  const pct = calibragem.taxaOverridePct ?? 0
  return (
    <div className="faixa-calibragem">
      <div className="faixa-topo">
        <span className="faixa-nome">{rotuloRegra(calibragem.regra)}</span>
        <span className="dica">
          hoje interrompe a partir de <strong>{Math.round(calibragem.thresholdAtual * 100)}%</strong>{' '}
          de certeza
        </span>
      </div>

      {/* A barra é desenho, não informação sozinha: o número e a contagem estão logo
          abaixo, em texto. Estado nunca só por cor nem só por comprimento (regra 9). */}
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
          <strong>{formatarPct(calibragem.taxaOverridePct)}</strong> seguiram assim mesmo
        </span>
        <span className="dica">
          {calibragem.overrides} de {calibragem.totalBloqueios}{' '}
          {calibragem.totalBloqueios === 1 ? 'interrupção' : 'interrupções'}
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
          <span className="eyebrow">Nas palavras de quem seguiu</span>
          {/* Cinco: o suficiente para ver um padrão, pouco o bastante para caber ao
              lado do controle. O histórico completo é o mapa de lacunas (`RF-42`). */}
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

/* ---------- SLA de primeira resposta (RF-46, T-232) --------------------- */

/**
 * ⚠️ **É retrato, não consulta.** Saber se houve primeira resposta exige ler os comentários
 * de cada chamado; fazer isso ao abrir o console deixaria a página lenta na proporção do
 * sucesso do projeto. O cron de SLA já lê tudo isso e grava o retrato — por isso a tela
 * diz *quando* foi avaliado em vez de fingir que o número é de agora.
 *
 * E o prazo é de **primeira resposta** (`RN-08`): chamado respondido em uma hora e resolvido
 * em duas semanas está dentro do SLA. O rótulo diz isso, senão o número parece prometer
 * outra coisa.
 */
export function PainelSla({ sla }: { sla: ResumoSla }) {
  return (
    <div className="grade-metricas">
      <Metrica
        rotulo="No prazo"
        valor={formatarPct(sla.aderenciaPct)}
        semDados={sla.aderenciaPct === null}
        nota={`${sla.dentroDoPrazo} de ${sla.respondidos} respondidos`}
      />
      <Metrica
        rotulo="Perto do prazo"
        valor={String(sla.emRisco)}
        nota="ainda sem primeira resposta"
      />
      <Metrica
        rotulo="Prazo estourado"
        valor={String(sla.estourados)}
        alerta={sla.estourados > 0}
        nota="ninguém respondeu no prazo"
      />
      <Metrica
        rotulo="Avaliados"
        valor={String(sla.totalAvaliados)}
        nota="chamados na última rodada"
      />
    </div>
  )
}

/* ---------- volume: via, prioridade e área (T-312) ---------------------- */

/**
 * Por onde os chamados entram e o que eles são.
 *
 * ⚠️ **Não existe "taxa de aderência de canal" aqui, e a ausência é deliberada** (`O5`,
 * `painel.ts`). O denominador seria *todo pedido que chegou ao time de tech*, incluindo
 * chat, reunião e Jira direto — dado que o app não vê por definição. O que a tela mostra é
 * o numerador, dito como numerador: uma porcentagem aqui seria denominador inventado.
 */
export function PainelVolume({ painel }: { painel: ResumoPainel }) {
  const prioridades = Object.entries(painel.chamadosPorPrioridade)
  return (
    <div className="pilha">
      <div className="grade-metricas">
        <Metrica
          rotulo="Conversando com o agente"
          valor={String(painel.canal.porVia.conversa ?? 0)}
          nota="com as duas verificações"
        />
        <Metrica
          rotulo="Pelo formulário"
          valor={String(painel.canal.porVia.formulario ?? 0)}
          nota="sem verificação (D-04)"
        />
        {prioridades.map(([prioridade, total]) => (
          <Metrica key={prioridade} rotulo={rotuloPrioridade(prioridade)} valor={String(total)} />
        ))}
      </div>
      <p className="dica">
        {painel.canal.totalPeloApp}{' '}
        {painel.canal.totalPeloApp === 1 ? 'chamado aberto' : 'chamados abertos'} pelo app. O
        quanto isso representa do total só o Jira sabe: chamado aberto direto lá, por chat ou
        em reunião não passa por aqui, e comparar as duas coisas é conferência manual.
      </p>
    </div>
  )
}

export function PainelPorArea({
  chamadosPorArea,
}: {
  chamadosPorArea: ResumoPainel['chamadosPorArea']
}) {
  if (chamadosPorArea.length === 0) {
    return <p className="dica">Nenhum chamado aberto ainda — sem dado para separar por área.</p>
  }
  return (
    <ul className="chamados">
      {chamadosPorArea.map((a) => (
        <li key={a.area ?? 'sem-area'} className="chamado" style={{ cursor: 'default' }}>
          <span className="chamado-topo">
            <span className="chamado-chave">{a.area ?? 'Sem área'}</span>
            <Selo variante="contorno">
              {a.total} {a.total === 1 ? 'chamado' : 'chamados'}
            </Selo>
          </span>
          {a.area === null && (
            <span className="chamado-meta">
              {/* Duas causas opostas, e o painel de área diz qual foi. Aqui basta não
                  afirmar que a pessoa "não tem área": o app é que não soube. */}
              <span className="dica">
                A fonte organizacional não respondeu por estas pessoas — o app não chuta uma
                área.
              </span>
            </span>
          )}
        </li>
      ))}
    </ul>
  )
}

/* ---------- avisos enviados (RF-45, D-19) ------------------------------- */

/**
 * ⚠️ **"Não enviados" é o número que `D-19` mandou pôr na tela.** Sem canal escolhido
 * (`Q11`), o aviso é registrado e suprimido — e esse contador é o tamanho do que passa a
 * sair no dia em que alguém escolher o canal. Sem ele, a decisão em aberto ficaria
 * invisível e "ninguém recebe aviso" pareceria escolha.
 */
export function PainelNotificacoes({
  notificacoes,
  canalDefinido,
}: {
  notificacoes: ResumoPainel['notificacoes']
  canalDefinido: boolean
}) {
  return (
    <div className="pilha">
      {!canalDefinido && (
        <Aviso atencao>
          Nenhum canal de aviso foi escolhido ainda. Os avisos estão sendo{' '}
          <strong>registrados e não enviados</strong> — o número abaixo é o tamanho do que
          passa a sair no dia da escolha.
        </Aviso>
      )}
      <div className="grade-metricas">
        <Metrica rotulo="Enviados" valor={String(notificacoes.enviada)} />
        <Metrica rotulo="Na fila" valor={String(notificacoes.pendente)} />
        <Metrica
          rotulo="Falharam"
          valor={String(notificacoes.falha)}
          alerta={notificacoes.falha > 0}
          nota="o canal recusou depois de várias tentativas"
        />
        <Metrica
          rotulo="Não enviados"
          valor={String(notificacoes.suprimida)}
          nota="ação da própria pessoa, ou sem canal escolhido"
        />
      </div>
    </div>
  )
}

/* ---------- orçamento de API e custo de IA (T-234, RF-60) --------------- */

/**
 * ⚠️ **Medir 429 é a única telemetria de orçamento que existe com API token** (`RNF-15`):
 * a Atlassian não publica o limite por token e só manda os cabeçalhos de rate limit
 * *dentro das respostas 429*. Um número baixo aqui não prova folga — prova que ainda não
 * batemos no teto.
 */
export function PainelOrcamento({ painel }: { painel: ResumoPainel }) {
  return (
    <div className="pilha">
      <div className="grade-metricas">
        <Metrica
          rotulo="Gasto com IA"
          valor={formatarUsd(painel.ia.custoTotalUsd)}
          nota={`${painel.ia.conversas} ${painel.ia.conversas === 1 ? 'conversa' : 'conversas'}`}
        />
        <Metrica
          rotulo="Por conversa"
          valor={painel.ia.custoMedioUsd === null ? 'sem dados ainda' : formatarUsd(painel.ia.custoMedioUsd)}
          semDados={painel.ia.custoMedioUsd === null}
        />
        <Metrica
          rotulo="Pedidos recusados pela Atlassian"
          valor={formatarPct(painel.telemetriaAtlassian.taxa429Pct)}
          semDados={painel.telemetriaAtlassian.taxa429Pct === null}
          alerta={painel.telemetriaAtlassian.acimaDoLimiar}
          nota={`${painel.telemetriaAtlassian.total429} de ${painel.telemetriaAtlassian.totalRequisicoes} chamadas`}
        />
      </div>
      <p className="dica">
        A Atlassian não publica quantas chamadas o app pode fazer, e só avisa que passou do
        limite <em>ao recusar</em>. Por isso a recusa é medida: é o único sinal que existe.
      </p>
    </div>
  )
}

/* ---------- assentos: antes × depois (T-311, O2) ------------------------ */

/**
 * ⚠️ **Sem baseline, a tela diz "sem baseline"** — comparar contra zero mostraria uma
 * economia de 100% que não aconteceu. O retrato de antes do projeto é levantado uma vez,
 * na Fase 0, e não há como o app derivá-lo sozinho: ele nasceu depois.
 */
export function PainelBaseline({ baseline }: { baseline: BaselineAssentos | null }) {
  if (baseline === null) {
    return (
      <p className="dica">
        Sem o retrato de antes do projeto não há comparação. Ele é levantado uma vez e
        preenchido na configuração — comparar contra zero mostraria uma economia de 100% que
        não aconteceu.
      </p>
    )
  }
  return (
    <div className="grade-metricas">
      {Object.entries(baseline.porProduto).map(([produto, total]) => (
        <Metrica
          key={produto}
          rotulo={produto}
          valor={String(total)}
          nota={`assentos em ${formatarData(baseline.coletadoEm)}`}
        />
      ))}
    </div>
  )
}

/** Um número que se lê de relance. `semDados` nunca vira `0` (T-095). */
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

/**
 * `sem_prioridade` é a chave que o servidor usa para o chamado que não trouxe prioridade —
 * e ela vira uma frase, não o nome da chave. ⚠️ Prioridade desconhecida sai **como veio**:
 * inventar "Outra" esconderia um valor novo do Jira que ninguém mapeou aqui.
 */
function rotuloPrioridade(prioridade: string): string {
  if (prioridade === 'critica') return 'Crítica'
  if (prioridade === 'alta') return 'Alta'
  if (prioridade === 'normal') return 'Normal'
  if (prioridade === 'sem_prioridade') return 'Sem prioridade'
  return prioridade
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
