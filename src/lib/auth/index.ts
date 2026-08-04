/**
 * Identidade e autorização — RF-01 a RF-06, RNF-05.
 *
 * O OAuth é do **edge do GoDeploy** (decisão D-02): o app roda com
 * `visibility: authenticated` e o edge injeta `x-godeploy-user-email`. O app
 * **não** implementa fluxo OAuth — daí RF-06 ("do login à conversa em um clique")
 * sair quase de graça.
 *
 * O que continua sendo do app, e não é negociável:
 *   1. A **política de domínio** é nossa (Q7), revalidada A CADA requisição
 *      (RF-01, RF-05) — o edge diz *quem* é, não *se pode*.
 *   2. **Nenhum identificador vindo do cliente** é aceito (RF-04, RNF-05). Body,
 *      query e headers customizados são ignorados na decisão de identidade.
 *   3. Perfil admin **nunca é inferido** (RN-09).
 *
 * ⚠️ `dominios_permitidos` vazio significa **negar todo mundo**, não "liberar
 * todos". Se a config nunca foi preenchida, o app é fechado — fail-closed
 * (RNF-07). Um `if (lista.length === 0) return true` aqui seria a porta aberta
 * mais fácil de escrever e a mais difícil de notar.
 */

import type { Config } from '../config'

/** Header em que o edge do GoDeploy injeta o e-mail do visitante autenticado. */
export const HEADER_EMAIL = 'x-godeploy-user-email'
/** Header de nome, quando o edge o fornece (D-02, a confirmar — T-021). */
export const HEADER_NOME = 'x-godeploy-user-name'

export interface Identidade {
  readonly email: string
  readonly nome: string
  readonly isAdmin: boolean
}

export type MotivoNegacao =
  | 'sem_identidade_do_edge'
  | 'email_malformado'
  | 'dominio_nao_permitido'
  | 'nenhum_dominio_configurado'

export type ResultadoAuth =
  | { readonly ok: true; readonly identidade: Identidade }
  | { readonly ok: false; readonly motivo: MotivoNegacao; readonly emailTentado: string | null }

/** Local-part @ domínio, sem espaços. Estrito de propósito: e-mail é a chave de identidade (RF-04). */
const FORMATO_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function extrairDominio(email: string): string | null {
  const partes = email.toLowerCase().split('@')
  return partes.length === 2 && partes[1] ? partes[1] : null
}

/**
 * Nome legível a partir do e-mail, quando o edge não fornece nome.
 * `ana.paula.souza@gocase.com` → `Ana Paula Souza`.
 */
export function derivarNomeDeEmail(email: string): string {
  const local = email.split('@')[0] ?? email
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
    .join(' ')
}

/**
 * Resolve a identidade a partir dos headers da requisição.
 *
 * Recebe `Headers` inteiro, e não um e-mail já extraído, de propósito: se o
 * chamador pudesse passar o e-mail, existiria um caminho em que ele vem do
 * cliente. A única fonte é `HEADER_EMAIL`.
 */
export async function resolverIdentidade(
  headers: Headers,
  config: Config,
): Promise<ResultadoAuth> {
  const bruto = headers.get(HEADER_EMAIL)?.trim().toLowerCase() ?? ''
  if (!bruto) {
    return { ok: false, motivo: 'sem_identidade_do_edge', emailTentado: null }
  }
  if (!FORMATO_EMAIL.test(bruto)) {
    return { ok: false, motivo: 'email_malformado', emailTentado: bruto }
  }

  const dominios = (await config.obter('dominios_permitidos')).map((d) => d.toLowerCase())
  if (dominios.length === 0) {
    // Fail-closed. Config não preenchida = app fechado, nunca app aberto.
    return { ok: false, motivo: 'nenhum_dominio_configurado', emailTentado: bruto }
  }
  const dominio = extrairDominio(bruto)
  if (!dominio || !dominios.includes(dominio)) {
    return { ok: false, motivo: 'dominio_nao_permitido', emailTentado: bruto }
  }

  const admins = (await config.obter('admins')).map((a) => a.toLowerCase())
  const nomeDoEdge = headers.get(HEADER_NOME)?.trim()

  return {
    ok: true,
    identidade: {
      email: bruto,
      nome: nomeDoEdge && nomeDoEdge.length > 0 ? nomeDoEdge : derivarNomeDeEmail(bruto),
      isAdmin: admins.includes(bruto),
    },
  }
}

export const MENSAGEM_NEGACAO: Readonly<Record<MotivoNegacao, string>> = Object.freeze({
  // Linguagem de negócio, nunca código HTTP cru nem stack trace (RNF-30).
  sem_identidade_do_edge:
    'Não conseguimos identificar sua conta. Saia e entre novamente com seu e-mail corporativo.',
  email_malformado:
    'Não conseguimos identificar sua conta. Saia e entre novamente com seu e-mail corporativo.',
  dominio_nao_permitido:
    'Este app é restrito às contas corporativas do grupo. Se você deveria ter acesso, fale com o time de tech.',
  nenhum_dominio_configurado:
    'O app ainda não foi liberado para nenhum domínio de e-mail. Fale com o time de tech.',
})
