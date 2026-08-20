/**
 * Escopo do piloto e mapa de áreas — R-06, RF-19, T-302/T-303.
 *
 * Funções **puras**: entram config e e-mail, sai decisão. Nada de banco, nada de rede.
 *
 * ## Por que allowlist simples, e não feature flag
 *
 * O piloto é **1–2 áreas nomeadas** (`Q13`). Infraestrutura de rollout gradual —
 * porcentagem de usuários, flag por conta, bucket determinístico por hash de e-mail —
 * resolveria um problema que este projeto não tem, e criaria um que ele não quer: um
 * jeito de a pessoa estar dentro hoje e fora amanhã sem ninguém ter decidido nada.
 *
 * ## O vazio significa o CONTRÁRIO do resto do projeto
 *
 * ⚠️ Em todo lugar do atlas, allowlist vazia **nega** (`RNF-07`). Aqui, vazia significa
 * **piloto desligado — todo mundo entra**. A diferença é o que a lista governa: as
 * outras governam exposição de conteúdo, onde vazio-nega evita vazamento; esta governa
 * quem pode **pedir ajuda**. Vazio-nega aqui significaria que subir o app antes de
 * alguém preencher a lista tranca a empresa inteira fora do canal de suporte — um
 * incidente, não uma proteção. Está escrito neste comentário e no do campo em
 * `ConfigValores` porque é exatamente o tipo de inconsistência que alguém "conserta"
 * de boa-fé.
 */

export type DecisaoPiloto =
  | { readonly dentro: true }
  | { readonly dentro: false; readonly mensagem: string }

/**
 * Mensagem de **encaminhamento**, não erro cru (RNF-30).
 *
 * Quem está fora do piloto não fez nada errado — o app ainda não chegou na área dele. A
 * mensagem diz para onde ir no meio-tempo, porque a alternativa (403 com "acesso
 * negado") faz a pessoa achar que perdeu acesso a algo que tinha.
 */
export const MENSAGEM_FORA_DO_PILOTO =
  'O atlas está em piloto e ainda não abrange a sua área. Enquanto isso, siga pedindo pelo canal que você já usa hoje com o time de tech — e a gente avisa quando chegar a sua vez. A consulta à documentação continua liberada para você aqui mesmo.'

export function dentroDoPiloto(email: string, emailsPiloto: readonly string[]): DecisaoPiloto {
  // Piloto desligado: ninguém é barrado. Ver o aviso no topo do arquivo.
  if (emailsPiloto.length === 0) return { dentro: true }
  const alvo = email.trim().toLowerCase()
  const lista = emailsPiloto.map((e) => e.trim().toLowerCase())
  return lista.includes(alvo)
    ? { dentro: true }
    : { dentro: false, mensagem: MENSAGEM_FORA_DO_PILOTO }
}

/**
 * Área do solicitante a partir do mapa (RF-19).
 *
 * ⚠️ E-mail desconhecido devolve `null` — **nunca** uma área padrão. "Sem área" é um
 * dado que a métrica sabe mostrar (e que aponta o mapa incompleto); área errada
 * contamina a métrica por área de um jeito que ninguém percebe, e é a métrica que
 * decide onde o rollout continua (`T-320`).
 */
export function areaDoEmail(
  email: string,
  mapa: Readonly<Record<string, string>>,
): string | null {
  const alvo = email.trim().toLowerCase()
  for (const [chave, area] of Object.entries(mapa)) {
    if (chave.trim().toLowerCase() === alvo) {
      const limpa = area.trim()
      return limpa.length > 0 ? limpa : null
    }
  }
  return null
}

/** As áreas conhecidas, para a UI oferecer na correção manual (T-305). */
export function areasConhecidas(mapa: Readonly<Record<string, string>>): readonly string[] {
  return [...new Set(Object.values(mapa).map((a) => a.trim()).filter((a) => a.length > 0))].sort()
}
