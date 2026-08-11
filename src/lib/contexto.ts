/**
 * Montagem do contexto de requisição — onde os secrets viram objetos.
 *
 * ⚠️ Este é o **único** lugar que lê `env`. As três credenciais (RNF-01) entram
 * aqui e nunca saem: nada abaixo recebe token, e nenhuma resposta ou log os
 * carrega. Se um segundo lugar começar a ler `env.ATLASSIAN_API_TOKEN`, a
 * garantia de RNF-01 passa a depender de disciplina em vez de estrutura.
 */

import { ClienteAtlassianHttp, novasCachesAtlassian } from './atlassian/cliente'
import { ClienteAtlassianFake } from './atlassian/fake'
import { ClienteAtlassianSomenteLeitura } from './atlassian/somente-leitura'
import type { ClienteAtlassian } from './atlassian/tipos'
import { ClienteOrganizacaoFake } from './atlassian/organizacao-fake'
import { ClienteOrganizacaoHttp, type ClienteOrganizacao } from './atlassian/organizacao'
import { ClienteIAHttp } from './ia/cliente'
import { ClienteIAFake } from './ia/fake'
import { ClienteIAIndisponivel } from './ia/indisponivel'
import type { ClienteIA } from './ia/tipos'
import { AuditoriaBanco, type Auditoria } from './audit'
import { Config, valoresDoBootstrap, type BootstrapEnv, type ConfigValores } from './config'
import { configDemo, repovoarChamadosDemo, semearAtlassianDemo, semearIaDemo } from './demo'
import { garantirMigracao } from './db/schema'
import type { Banco } from './db/tipos'
import { RepositorioConversas } from './agent/estado'
import { RegistroConhecimento } from './confluence/registro'
import { ExecutorTools } from './agent/tools'
import { Orquestrador } from './agent/orquestrador'
import { Outbox } from './tickets/outbox'
import { RepositorioAnexosPendentes } from './tickets/anexos-pendentes'
import { RepositorioVinculos } from './tickets/vinculos'
import { ServicoChamados } from './tickets/servico'
import { RepositorioInventario } from './governanca/inventario'
import {
  MarcaAguaPolling,
  RepositorioAlertasSla,
  RepositorioAvaliacoesSla,
  RepositorioNotificacoes,
} from './notificacoes/dedupe'
import { RepositorioAcoesProprias } from './notificacoes/acoes'
import { RepositorioPreferencias } from './notificacoes/preferencias'
import { ServicoNotificacoes, type ValoresNotificacao } from './notificacoes/servico'
import { CanalEmail, CanalFake, CanalGoogleChat, CanalIndisponivel } from './notificacoes/canais'
import type { Canal, NomeCanal } from './notificacoes/tipos'

/** O que o GoDeploy injeta. `DB` é a plataforma; o resto são secrets. */
export interface EnvGoDeploy extends BootstrapEnv {
  readonly DB: Banco
  readonly ATLASSIAN_BASE_URL?: string
  readonly ATLASSIAN_EMAIL?: string
  readonly ATLASSIAN_API_TOKEN?: string
  readonly ATLASSIAN_ORG_API_KEY?: string
  readonly LLM_BASE_URL?: string
  readonly LLM_API_KEY?: string
  readonly LLM_MODEL?: string
  readonly LLM_FALLBACK?: string
  readonly LLM_FALLBACK_MODEL?: string
  readonly GODEPLOY_CRON_KEY?: string
  /**
   * RF-48 — segredo que a Atlassian estampa no webhook do Jira. Sem ele a rota de
   * webhook **não funciona** (fail-closed): o contrário deixaria aberta justamente a
   * única superfície pública do app.
   */
  readonly GOATLAS_WEBHOOK_SEGREDO?: string
  /** Q11 — chave do provedor de e-mail transacional (Workers não têm SMTP). */
  readonly EMAIL_API_KEY?: string
  /** `1` usa os fakes — para desenvolvimento antes de Q1. Nunca em produção real. */
  readonly GOATLAS_USAR_FAKES?: string
  /**
   * `1` publica o app em **modo demonstração**: fakes semeados com dados fictícios
   * e tarja de aviso permanente na interface. Ver `demo.ts` — a tarja não é
   * cosmética: sem ela alguém acredita que o chamado chegou ao time de tech.
   */
  readonly GOATLAS_MODO_DEMO?: string
  /**
   * `1` liga o **modo somente leitura**: o app lê o Confluence e o Jira de verdade e
   * **recusa toda escrita** (chamado, comentário, anexo, transição).
   *
   * ⚠️ É o estado do meio que faltava entre "fakes em tudo" (`GOATLAS_MODO_DEMO`) e
   * "produção". Serve para desenvolver e demonstrar com dado real sem que um clique
   * errado abra chamado na fila do time de tech. A trava é um decorador do cliente
   * (`atlassian/somente-leitura.ts`), não um `if` espalhado pelas rotas.
   */
  readonly GOATLAS_SOMENTE_LEITURA?: string
}

export interface Contexto {
  readonly db: Banco
  readonly config: Config
  readonly valores: ConfigValores
  readonly auditoria: Auditoria
  readonly atlassian: ClienteAtlassian
  readonly ia: ClienteIA
  readonly conversas: RepositorioConversas
  /** Registro de busca/leitura da documentação e o mapa de lacunas (RF-42). */
  readonly conhecimento: RegistroConhecimento
  readonly vinculos: RepositorioVinculos
  readonly outbox: Outbox
  /** RF-61 (T-408) — anexos subidos antes de o chamado existir. */
  readonly anexosPendentes: RepositorioAnexosPendentes
  readonly chamados: ServicoChamados
  readonly orquestrador: Orquestrador
  /**
   * `null` = **não configurada** (sem `ATLASSIAN_ORG_API_KEY`). A rota de governança
   * trata isso como ausência de configuração, nunca como erro — é a diferença entre
   * "ninguém emitiu a credencial de Org Admin ainda" (Q1) e "a governança quebrou".
   */
  readonly organizacao: ClienteOrganizacao | null
  readonly inventarioAssentos: RepositorioInventario
  /** Fase 3 — notificação, dedupe e alerta de SLA (RF-44 a RF-48). */
  readonly notificacoes: RepositorioNotificacoes
  readonly acoesProprias: RepositorioAcoesProprias
  readonly preferencias: RepositorioPreferencias
  readonly marcaAguaPolling: MarcaAguaPolling
  readonly avaliacoesSla: RepositorioAvaliacoesSla
  readonly notificador: ServicoNotificacoes
  /**
   * Resolve o canal pelo nome (RF-45).
   *
   * Exposto no contexto porque em modo fake ele devolve **a mesma instância** de
   * `CanalFake` a cada chamada — é assim que o teste injeta falha de canal e depois
   * afirma sobre o que foi "entregue", do mesmo jeito que `ClienteAtlassianFake` sustenta
   * os testes das fases anteriores.
   */
  readonly canalPor: (nome: NomeCanal) => Canal
  /** Os valores derivados da config que o serviço de notificação usa. */
  readonly valoresNotificacao: ValoresNotificacao
  /** Segredo do webhook do Jira (RF-48) — só existe aqui, como os outros secrets. */
  readonly segredoWebhook: string | undefined
  readonly agora: () => string
  readonly novoId: () => string
  readonly usandoFakes: boolean
  readonly modoDemo: boolean
  /** Lê de verdade, recusa toda escrita. Ver `GOATLAS_SOMENTE_LEITURA`. */
  readonly somenteLeitura: boolean
}

export function novoIdPadrao(): string {
  return crypto.randomUUID()
}

/**
 * Clientes já instanciados, para reaproveitar entre montagens.
 *
 * Existe para o shim de desenvolvimento (`vite-plugin-api-dev.ts`), que monta o
 * contexto **por requisição** — como o Worker faz, para que config alterada pelo
 * console valha na requisição seguinte — mas precisa manter o estado dos fakes
 * (tipos de chamado, páginas, chamados criados) entre elas.
 */
export interface ClientesReaproveitados {
  readonly atlassian?: ClienteAtlassian
  readonly ia?: ClienteIA
  readonly organizacao?: ClienteOrganizacao
}

/**
 * As caches da Atlassian, **vivas pelo tempo do isolate** (RNF-13).
 *
 * ⚠️ **Este é o conserto de um cache que nunca acertava.** `ClienteAtlassianHttp` sempre
 * teve `CacheTtl`, e vários comentários do código contavam com ela para conter o custo das
 * chamadas por página ("contido pelo cache de conteúdo"). Só que a cache morava na
 * instância, e a instância é criada **a cada requisição** aqui embaixo — então o TTL nunca
 * chegava a valer: toda leitura de página rebuscava metadados, labels, restrição e corpo, e
 * cada nível do breadcrumb rebuscava os três primeiros de novo.
 *
 * Módulo é escopo de isolate no runtime dos Workers, que é exatamente a vida que se quer:
 * sobrevive entre requisições, morre com o isolate, e não precisa de invalidação
 * distribuída. O teto de entradas de cada cache está em `novasCachesAtlassian` — cache
 * compartilhada sem teto é vazamento de memória com prazo.
 *
 * ⚠️ Compartilhar é seguro **porque a identidade perante a Atlassian é sempre a mesma**
 * (proxy total, `D-01`): não existe resposta "de um usuário" para vazar para outro. Num
 * mundo com `raiseOnBehalfOf` por pessoa (`RNF-22`) esta cache teria de ser por identidade,
 * e é por isso que ela mora aqui, num lugar só, e não escondida dentro do cliente.
 *
 * ⚠️ A cache **não** guarda decisão de exposição. `RN-06` continua sendo avaliada por
 * requisição em `confluence/acesso.ts`, contra a allowlist de `ctx.valores`: mudar a
 * allowlist no console vale na requisição seguinte, mesmo com metadados em cache. O que a
 * cache evita é rebuscar o **insumo**, não repetir a **decisão**.
 */
const cachesAtlassianDoIsolate = novasCachesAtlassian()

export async function montarContexto(
  env: EnvGoDeploy,
  agora: () => string = () => new Date().toISOString(),
  novoId: () => string = novoIdPadrao,
  reaproveitar: ClientesReaproveitados = {},
): Promise<Contexto> {
  // Uma vez por banco, não por requisição — ver `garantirMigracao`. Eram ~400 ms de DDL
  // sequencial cobrados de toda rota, inclusive do turno do agente.
  await garantirMigracao(env.DB)

  const modoDemo = env.GOATLAS_MODO_DEMO === '1'
  // Bootstrap: padrão fail-closed → env → banco. A demo acrescenta o mínimo para o
  // app ser clicável; domínios e admins vêm SEMPRE do env/banco, nunca da demo.
  const bootstrap = { ...(modoDemo ? configDemo() : {}), ...valoresDoBootstrap(env) }
  const config = new Config(env.DB, bootstrap)
  const valores = await config.carregar()
  const auditoria = new AuditoriaBanco(env.DB, agora, novoId)

  const usandoFakes = modoDemo || env.GOATLAS_USAR_FAKES === '1' || !env.ATLASSIAN_API_TOKEN
  const somenteLeitura = env.GOATLAS_SOMENTE_LEITURA === '1'

  const atlassianBase: ClienteAtlassian = reaproveitar.atlassian
    ? reaproveitar.atlassian
    : usandoFakes
    ? new ClienteAtlassianFake()
    : new ClienteAtlassianHttp({
        baseUrl: env.ATLASSIAN_BASE_URL ?? '',
        email: env.ATLASSIAN_EMAIL ?? '',
        apiToken: env.ATLASSIAN_API_TOKEN ?? '',
        ttlMetadadosSeg: valores.ttl_metadados_seg,
        ttlConteudoSeg: valores.ttl_conteudo_seg,
        // O que faz o TTL acima valer de verdade — ver `cachesAtlassianDoIsolate`.
        caches: cachesAtlassianDoIsolate,
        // RF-21, Q4 — configurável (RNF-25), nunca hardcoded. `null` até o time
        // de tech confirmar o id do campo "Solicitante"; o solicitante real
        // continua indo na descrição enquanto isso (cinto e suspensório).
      })

  /**
   * ⚠️ A trava envolve o cliente **inclusive o fake**. Parece exagero e não é: é o que
   * permite testar a recusa sem credencial, e é o que impede alguém de concluir que o
   * modo somente leitura "só vale em produção" e escrever um caminho que o contorna.
   */
  const atlassian: ClienteAtlassian = somenteLeitura
    ? new ClienteAtlassianSomenteLeitura(atlassianBase)
    : atlassianBase

  // ⚠️ O fake só é alcançável por `usandoFakes`. Antes, `!env.LLM_API_KEY` também
  // caía nele — o que produzia **Atlassian real com IA falsa**: agente respondendo
  // roteiro de demonstração e chamado nascendo de verdade no JSM. Chave ausente com
  // o resto configurado é ausência de configuração, e ausência = negar, nunca dublê.
  const ia: ClienteIA = reaproveitar.ia
    ? reaproveitar.ia
    : usandoFakes
      ? new ClienteIAFake()
      : !env.LLM_API_KEY
      ? new ClienteIAIndisponivel()
      : new ClienteIAHttp({
          baseUrl: env.LLM_BASE_URL ?? null,
          apiKey: env.LLM_API_KEY,
          modelo: env.LLM_MODEL ?? 'gpt-5.4-mini',
          apiKeyFallback: env.LLM_FALLBACK ?? null,
          ...(env.LLM_FALLBACK_MODEL ? { modeloFallback: env.LLM_FALLBACK_MODEL } : {}),
        })

  // A governança é a única camada com credencial de Org Admin (RNF-04) e a única com
  // três estados em vez de dois: fake · real · **não configurada**. `null` continua
  // significando "não configurada" — sem `ATLASSIAN_ORG_API_KEY` não existe cliente,
  // e a rota trata isso como ausência de configuração, nunca como erro (RNF-18).
  const organizacao: ClienteOrganizacao | null = reaproveitar.organizacao
    ? reaproveitar.organizacao
    : usandoFakes
      ? new ClienteOrganizacaoFake()
      : env.ATLASSIAN_ORG_API_KEY
        ? new ClienteOrganizacaoHttp({ apiKey: env.ATLASSIAN_ORG_API_KEY })
        : null

  if (modoDemo) {
    // Os fakes são semeados a cada montagem porque o Worker é stateless: o estado
    // deles não sobrevive entre requisições. O que persiste (conversa, vínculo,
    // chamado) está no banco.
    // ⚠️ Semeia o cliente BASE, não o embrulhado: com a trava de somente leitura ligada,
    // `atlassian` é o decorador e o `instanceof` seria falso — a demonstração subiria sem
    // dado nenhum e pareceria quebrada.
    if (atlassianBase instanceof ClienteAtlassianFake) {
      semearAtlassianDemo(atlassianBase)
      // O Worker é stateless: sem isto, o chamado aberto na requisição anterior aparece
      // como indisponível na seguinte. Ver `repovoarChamadosDemo`.
      await repovoarChamadosDemo(atlassianBase, env.DB)
    }
    if (ia instanceof ClienteIAFake) semearIaDemo(ia)
  }

  const conversas = new RepositorioConversas(env.DB, agora)
  const conhecimento = new RegistroConhecimento(env.DB, agora, novoId)
  const vinculos = new RepositorioVinculos(env.DB, agora)
  const outbox = new Outbox(env.DB, agora)
  const anexosPendentes = new RepositorioAnexosPendentes(env.DB, agora)
  const chamados = new ServicoChamados(atlassian, outbox, vinculos, auditoria, novoId)
  const executor = new ExecutorTools(atlassian, ia, env.DB, auditoria, agora)
  const orquestrador = new Orquestrador(ia, executor, conversas, auditoria, novoId)
  const inventarioAssentos = new RepositorioInventario(env.DB, novoId)

  // --- Fase 3: notificação (RF-44 a RF-48) ----------------------------------
  const repoNotificacoes = new RepositorioNotificacoes(env.DB, agora)
  const alertasSla = new RepositorioAlertasSla(env.DB, agora)
  const avaliacoesSla = new RepositorioAvaliacoesSla(env.DB, agora)
  const acoesProprias = new RepositorioAcoesProprias(env.DB, agora, novoId)
  const preferencias = new RepositorioPreferencias(env.DB, agora)
  const marcaAguaPolling = new MarcaAguaPolling(env.DB, agora)

  /**
   * Resolve o canal pelo nome.
   *
   * ⚠️ Fora dos fakes, canal sem configuração vira `CanalIndisponivel` — **nunca** o
   * fake. É o mesmo raciocínio de `ClienteIAIndisponivel` (T-132): se o lugar do canal
   * não configurado fosse um dublê, a fila esvaziaria em produção marcando "enviada"
   * com ninguém recebendo nada. Ausência de configuração nega e denuncia.
   */
  const canaisFake = new Map<NomeCanal, Canal>()
  const canalPor = (nome: NomeCanal): Canal => {
    if (usandoFakes) {
      const existente = canaisFake.get(nome)
      if (existente) return existente
      const novo = new CanalFake(nome)
      canaisFake.set(nome, novo)
      return novo
    }
    if (nome === 'chat') {
      return valores.chat_webhook_url
        ? new CanalGoogleChat({ endpoint: valores.chat_webhook_url })
        : new CanalIndisponivel()
    }
    if (nome === 'email') {
      return valores.email_endpoint
        ? new CanalEmail({
            endpoint: valores.email_endpoint,
            remetente: valores.email_remetente ?? 'goatlas@gocase.com',
            apiKey: env.EMAIL_API_KEY ?? null,
          })
        : new CanalIndisponivel()
    }
    return new CanalIndisponivel()
  }

  const valoresNotificacao: ValoresNotificacao = {
    canalPadrao: valores.canal_notificacao_padrao,
    baseApp: valores.base_publica_app,
    fracaoAvisoSla: valores.sla_fracao_aviso,
  }

  const notificador = new ServicoNotificacoes(
    repoNotificacoes,
    alertasSla,
    avaliacoesSla,
    acoesProprias,
    preferencias,
    vinculos,
    atlassian,
    canalPor,
    auditoria,
    novoId,
    agora,
  )

  return {
    db: env.DB,
    config,
    valores,
    auditoria,
    atlassian,
    ia,
    conversas,
    conhecimento,
    vinculos,
    outbox,
    anexosPendentes,
    chamados,
    orquestrador,
    organizacao,
    inventarioAssentos,
    notificacoes: repoNotificacoes,
    acoesProprias,
    preferencias,
    marcaAguaPolling,
    avaliacoesSla,
    notificador,
    canalPor,
    valoresNotificacao,
    segredoWebhook: env.GOATLAS_WEBHOOK_SEGREDO,
    agora,
    novoId,
    usandoFakes,
    modoDemo,
    somenteLeitura,
  }
}
