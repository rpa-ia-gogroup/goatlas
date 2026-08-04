/**
 * Tipos mínimos da plataforma (Cloudflare Workers via GoDeploy).
 *
 * Declarados à mão em vez de instalar `@cloudflare/workers-types`: só duas
 * formas são usadas, e a dependência traria centenas de globais que este projeto
 * não toca — o que atrapalharia mais do que ajuda a pegar erro real.
 */
interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void
  passThroughOnException(): void
}
