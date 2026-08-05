/**
 * Montagem do contexto de requisição — onde os secrets viram objetos.
 *
 * ⚠️ Este é o **único** lugar que lê `env`. As três credenciais (RNF-01) entram
 * aqui e nunca saem: nada abaixo recebe token, e nenhuma resposta ou log os
 * carrega. Se um segundo lugar começar a ler `env.ATLASSIAN_API_TOKEN`, a
 * garantia de RNF-01 passa a depender de disciplina em vez de estrutura.
 */

import { ClienteAtlassianHttp } from './atlassian/cliente'
import { ClienteAtlassianFake } from './atlassian/fake'
import type { ClienteAtlassian } from './atlassian/tipos'
import { ClienteOrganizacaoFake } from './atlassian/organizacao-fake'
import type { ClienteOrganizacao } from './atlassian/organizacao'
import { ClienteIAHttp } from './ia/cliente'
import { ClienteIAFake } from './ia/fake'
import { ClienteIAIndisponivel } from './ia/indisponivel'
import type { ClienteIA } from './ia/tipos'
import { AuditoriaBanco, type Auditoria } from './audit'
import { Config, valoresDoBootstrap, type BootstrapEnv, type ConfigValores } from './config'
import { configDemo, semearAtlassianDemo, semearIaDemo } from './demo'
import { migrar } from './db/schema'
import type { Banco } from './db/tipos'
import { RepositorioConversas } from './agent/estado'
import { RegistroConhecimento } from './confluence/registro'
import { ExecutorTools } from './agent/tools'
import { Orquestrador } from './agent/orquestrador'
import { Outbox } from './tickets/outbox'
import { RepositorioVinculos } from './tickets/vinculos'
import { ServicoChamados } from './tickets/servico'
import { RepositorioInventario } from './governanca/inventario'

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
  /** `1` usa os fakes — para desenvolvimento antes de Q1. Nunca em produção real. */
  readonly GOATLAS_USAR_FAKES?: string
  /**
   * `1` publica o app em **modo demonstração**: fakes semeados com dados fictícios
   * e tarja de aviso permanente na interface. Ver `demo.ts` — a tarja não é
   * cosmética: sem ela alguém acredita que o chamado chegou ao time de tech.
   */
  readonly GOATLAS_MODO_DEMO?: string
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
  readonly chamados: ServicoChamados
  readonly orquestrador: Orquestrador
  /**
   * `null` fora dos fakes: a credencial de Org Admin ainda não existe (Q1), e não
   * há `ClienteOrganizacaoHttp` para instanciar — T-122/T-123 é o que a criará.
   * Rota de governança trata `null` como "não configurado", nunca como erro.
   */
  readonly organizacao: ClienteOrganizacao | null
  readonly inventarioAssentos: RepositorioInventario
  readonly agora: () => string
  readonly novoId: () => string
  readonly usandoFakes: boolean
  readonly modoDemo: boolean
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

export async function montarContexto(
  env: EnvGoDeploy,
  agora: () => string = () => new Date().toISOString(),
  novoId: () => string = novoIdPadrao,
  reaproveitar: ClientesReaproveitados = {},
): Promise<Contexto> {
  await migrar(env.DB)

  const modoDemo = env.GOATLAS_MODO_DEMO === '1'
  // Bootstrap: padrão fail-closed → env → banco. A demo acrescenta o mínimo para o
  // app ser clicável; domínios e admins vêm SEMPRE do env/banco, nunca da demo.
  const bootstrap = { ...(modoDemo ? configDemo() : {}), ...valoresDoBootstrap(env) }
  const config = new Config(env.DB, bootstrap)
  const valores = await config.carregar()
  const auditoria = new AuditoriaBanco(env.DB, agora, novoId)

  const usandoFakes = modoDemo || env.GOATLAS_USAR_FAKES === '1' || !env.ATLASSIAN_API_TOKEN

  const atlassian: ClienteAtlassian = reaproveitar.atlassian
    ? reaproveitar.atlassian
    : usandoFakes
    ? new ClienteAtlassianFake()
    : new ClienteAtlassianHttp({
        baseUrl: env.ATLASSIAN_BASE_URL ?? '',
        email: env.ATLASSIAN_EMAIL ?? '',
        apiToken: env.ATLASSIAN_API_TOKEN ?? '',
        ttlMetadadosSeg: valores.ttl_metadados_seg,
        ttlConteudoSeg: valores.ttl_conteudo_seg,
        // RF-21, Q4 — configurável (RNF-25), nunca hardcoded. `null` até o time
        // de tech confirmar o id do campo "Solicitante"; o solicitante real
        // continua indo na descrição enquanto isso (cinto e suspensório).
        campoSolicitanteId: valores.campo_solicitante_id,
      })

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

  // `null` fora dos fakes: a credencial de Org Admin é Q1, e não há
  // `ClienteOrganizacaoHttp` para instanciar ainda (T-122/T-123). A rota de
  // governança trata `null` como "não configurado", nunca como erro (RNF-18).
  const organizacao: ClienteOrganizacao | null = reaproveitar.organizacao
    ? reaproveitar.organizacao
    : usandoFakes
      ? new ClienteOrganizacaoFake()
      : null

  if (modoDemo) {
    // Os fakes são semeados a cada montagem porque o Worker é stateless: o estado
    // deles não sobrevive entre requisições. O que persiste (conversa, vínculo,
    // chamado) está no banco.
    if (atlassian instanceof ClienteAtlassianFake) semearAtlassianDemo(atlassian)
    if (ia instanceof ClienteIAFake) semearIaDemo(ia)
  }

  const conversas = new RepositorioConversas(env.DB, agora)
  const conhecimento = new RegistroConhecimento(env.DB, agora, novoId)
  const vinculos = new RepositorioVinculos(env.DB, agora)
  const outbox = new Outbox(env.DB, agora)
  const chamados = new ServicoChamados(atlassian, outbox, vinculos, auditoria, novoId)
  const executor = new ExecutorTools(atlassian, ia, env.DB, auditoria, agora)
  const orquestrador = new Orquestrador(ia, executor, conversas, auditoria, novoId)
  const inventarioAssentos = new RepositorioInventario(env.DB, novoId)

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
    chamados,
    orquestrador,
    organizacao,
    inventarioAssentos,
    agora,
    novoId,
    usandoFakes,
    modoDemo,
  }
}
