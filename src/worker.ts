/**
 * Entrypoint do Worker no GoDeploy.
 *
 * Só três responsabilidades: montar o contexto (único lugar que lê `env`),
 * delegar `/api/*` ao roteador, e deixar o SPA fallback para a plataforma
 * (`assetConfig.not_found_handling: "single-page-application"`).
 *
 * ⚠️ `ctx.waitUntil` fica exposto em `globalThis.__waitUntil` porque a plataforma
 * CANCELA promessas não registradas quando a Response retorna — fire-and-forget
 * sem isso simplesmente não roda.
 */

import { montarContexto, type EnvGoDeploy } from './lib/contexto'
import { tratarRequisicao } from './lib/http/rotas'
import { ERROS } from './lib/http/respostas'

export default {
  async fetch(req: Request, env: EnvGoDeploy, ctx: ExecutionContext): Promise<Response> {
    ;(globalThis as unknown as { __waitUntil?: typeof ctx.waitUntil }).__waitUntil =
      ctx.waitUntil.bind(ctx)

    const url = new URL(req.url)
    if (!url.pathname.startsWith('/api/')) {
      // Asset ou rota do SPA: a plataforma serve.
      return new Response(null, { status: 404 })
    }

    try {
      const contexto = await montarContexto(env)
      return await tratarRequisicao(req, contexto, env)
    } catch {
      // Falha no boot (banco fora, migração) não pode virar stack trace na tela.
      return ERROS.interno()
    }
  },
}
