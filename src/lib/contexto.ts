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
import { ClienteIAHttp } from './ia/cliente'
import { ClienteIAFake } from './ia/fake'
import type { ClienteIA } from './ia/tipos'
import { AuditoriaBanco, type Auditoria } from './audit'
import { Config, type ConfigValores } from './config'
import { migrar } from './db/schema'
import type { Banco } from './db/tipos'
import { RepositorioConversas } from './agent/estado'
import { ExecutorTools } from './agent/tools'
import { Orquestrador } from './agent/orquestrador'
import { Outbox } from './tickets/outbox'
import { RepositorioVinculos } from './tickets/vinculos'
import { ServicoChamados } from './tickets/servico'

/** O que o GoDeploy injeta. `DB` é a plataforma; o resto são secrets. */
export interface EnvGoDeploy {
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
  /** `1` usa os fakes — para desenvolvimento antes de Q1. Nunca em produção. */
  readonly GOATLAS_USAR_FAKES?: string
}

export interface Contexto {
  readonly db: Banco
  readonly config: Config
  readonly valores: ConfigValores
  readonly auditoria: Auditoria
  readonly atlassian: ClienteAtlassian
  readonly ia: ClienteIA
  readonly conversas: RepositorioConversas
  readonly vinculos: RepositorioVinculos
  readonly outbox: Outbox
  readonly chamados: ServicoChamados
  readonly orquestrador: Orquestrador
  readonly agora: () => string
  readonly novoId: () => string
  readonly usandoFakes: boolean
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
}

export async function montarContexto(
  env: EnvGoDeploy,
  agora: () => string = () => new Date().toISOString(),
  novoId: () => string = novoIdPadrao,
  reaproveitar: ClientesReaproveitados = {},
): Promise<Contexto> {
  await migrar(env.DB)

  const config = new Config(env.DB)
  const valores = await config.carregar()
  const auditoria = new AuditoriaBanco(env.DB, agora, novoId)

  const usandoFakes = env.GOATLAS_USAR_FAKES === '1' || !env.ATLASSIAN_API_TOKEN

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
        campoSolicitanteId: null,
      })

  const ia: ClienteIA = reaproveitar.ia
    ? reaproveitar.ia
    : usandoFakes || !env.LLM_API_KEY
      ? new ClienteIAFake()
      : new ClienteIAHttp({
          baseUrl: env.LLM_BASE_URL ?? null,
          apiKey: env.LLM_API_KEY,
          modelo: env.LLM_MODEL ?? 'gpt-5.4-mini',
          apiKeyFallback: env.LLM_FALLBACK ?? null,
          ...(env.LLM_FALLBACK_MODEL ? { modeloFallback: env.LLM_FALLBACK_MODEL } : {}),
        })

  const conversas = new RepositorioConversas(env.DB, agora)
  const vinculos = new RepositorioVinculos(env.DB, agora)
  const outbox = new Outbox(env.DB, agora)
  const chamados = new ServicoChamados(atlassian, outbox, vinculos, auditoria, novoId)
  const executor = new ExecutorTools(atlassian, ia, env.DB, auditoria, agora)
  const orquestrador = new Orquestrador(ia, executor, conversas, auditoria, novoId)

  return {
    db: env.DB,
    config,
    valores,
    auditoria,
    atlassian,
    ia,
    conversas,
    vinculos,
    outbox,
    chamados,
    orquestrador,
    agora,
    novoId,
    usandoFakes,
  }
}
