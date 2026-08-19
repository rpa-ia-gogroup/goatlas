/**
 * Leitura das variáveis de ambiente **do próprio app**, aceitando o prefixo antigo.
 *
 * 🚨 **O app chamou-se `goatlas` até 19/08/2026, e os secrets do GoDeploy ainda se
 * chamam `GOATLAS_*`.** O valor de um secret **não é legível** por nenhuma ferramenta
 * (`listAppSecrets` devolve só o nome), então renomear em código sem uma ponte deixaria
 * o app publicado sem `dominios_permitidos`, sem `admins` e sem `service_desk_id` — e
 * como quase toda allowlist do projeto é fail-closed (`RNF-07`), o sintoma seria o app
 * **negando tudo para todo mundo**, com HTTP 200 e nada no log dizendo por quê.
 *
 * Por isso a leitura aceita as duas formas e o resto do código conhece **só a nova**:
 * mesma forma de `linhasComoObjetos` e do prefixo de autoria em `atlassian/comentarios.ts`
 * — duas leituras, uma escrita.
 *
 * ⚠️ **Este módulo é o único lugar que sabe da palavra `GOATLAS`.** Ler `env.GOATLAS_X`
 * direto em outro arquivo faz a dívida deixar de ter um dono, e aí ela não sai nunca.
 *
 * ⚠️ **Quando remover:** depois de recriar os nove secrets `GOATLAS_*` como `ATLAS_*` em
 * prod (`9c47f42f`) e na staging (`3936ca2d`) — os valores têm de ser recolados à mão,
 * porque ninguém consegue lê-los de volta. Só então `PREFIXO_LEGADO` sai daqui, e o teste
 * de `tests/env-do-app.test.ts` é o que reprova a remoção feita pela metade.
 *
 * ⚠️ **Não pega `ATLASSIAN_*`**: a troca é ancorada no começo e exige o `_`, e
 * `ATLASSIAN_API_TOKEN` não tem underscore depois de `ATLAS`. As credenciais da
 * Atlassian nunca se chamaram `GOATLAS_*` — continuam lidas em `contexto.ts` (`RNF-01`).
 */

const PREFIXO_ATUAL = 'ATLAS_'
const PREFIXO_LEGADO = 'GOATLAS_'

/** O nome antigo desta variável, ou `null` se ela não é uma variável do app. */
export function nomeLegado(chave: string): string | null {
  if (!chave.startsWith(PREFIXO_ATUAL)) return null
  return PREFIXO_LEGADO + chave.slice(PREFIXO_ATUAL.length)
}

/**
 * O valor de uma variável do app: o nome novo ganha, o antigo é o fallback.
 *
 * Vazio (`''`) conta como ausência — secret recriado em branco não deve mascarar o
 * valor antigo que ainda funciona.
 */
export function valorDoApp(env: object, chave: string): string | undefined {
  const bruto = env as Record<string, string | undefined>
  const novo = bruto[chave]
  if (novo !== undefined && novo !== '') return novo
  const legado = nomeLegado(chave)
  if (legado === null) return novo
  const antigo = bruto[legado]
  return antigo !== undefined && antigo !== '' ? antigo : novo
}
