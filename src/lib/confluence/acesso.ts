/**
 * O gate de exposição do Confluence — as **três** condições de `RN-06`, num lugar
 * só. `RF-40`, `RNF-07`, `RNF-09`.
 *
 * ## Por que existe um módulo para isto
 *
 * A busca (`buscarConfluence`) já aplica as três condições, mas a busca não é o
 * único caminho: a leitura direta aceita um ID na URL, e o proxy de anexo aceita ID
 * + nome de arquivo. Se cada rota reimplementasse a verificação, a pergunta "esta
 * rota checou as três?" passaria a ser respondida lendo três arquivos — e a resposta
 * mudaria quando alguém adicionasse a quarta rota.
 *
 * ## O desenho, na ordem em que importa
 *
 * 1. **Metadados → decidir → conteúdo.** `verificarExposicao` não traz o corpo da
 *    página. Trazer primeiro e filtrar depois funciona hoje e vaza no dia em que um
 *    caminho esquecer o filtro: o conteúdo restrito já estaria na memória do app. É
 *    o mesmo motivo pelo qual a allowlist da busca vive no CQL, não num `.filter()`.
 * 2. **O corpo só sai por `lerPaginaAutorizada`**, e ela sanitiza antes de devolver.
 *    Nenhuma rota chama `obterCorpoStorage` — há teste estrutural cobrando isso. Um
 *    gate que se possa contornar é documentação, não trava.
 * 3. **Ausência de informação = negar.** Allowlist vazia nega sem nem consultar a
 *    Atlassian; erro ao resolver espaço, labels ou restrição também nega. Só
 *    indisponibilidade é distinguida — e para dizer "tente de novo", não para
 *    liberar.
 * 4. **O motivo da recusa fica aqui e na auditoria, nunca na resposta.** Um corpo
 *    diferente por motivo confirma que a página existe e insinua por que está
 *    fechada. Quem chama transforma qualquer recusa na **mesma** resposta.
 *
 * _Requirements: RF-40, RN-06, RNF-06, RNF-07, RNF-09_
 */

import { ErroAtlassian, type ClienteAtlassian, type MetadadosPagina } from '../atlassian/tipos'
import { sanitizarStorage, type ResultadoSanitizacao } from './sanitizar'

/** O que o gate precisa da config (`RNF-25` — nada hardcoded). */
export interface AllowlistConfluence {
  readonly espacos_confluence: readonly string[]
  readonly labels_bloqueadas: readonly string[]
}

/**
 * Motivos de recusa. Servem para **auditoria e diagnóstico**; a resposta HTTP é a
 * mesma para todos, menos `indisponivel`.
 */
export type MotivoRecusa =
  | 'espaco_fora_da_allowlist'
  | 'label_bloqueada'
  | 'pagina_restrita'
  | 'pagina_nao_atual'
  | 'nao_encontrada'
  | 'id_invalido'
  /** Dependência fora do ar. Único caso em que a rota **não** responde "não achei". */
  | 'indisponivel'

export type Exposicao =
  | { readonly ok: true; readonly metadados: MetadadosPagina }
  | { readonly ok: false; readonly motivo: MotivoRecusa }

export type LeituraPagina =
  | {
      readonly ok: true
      readonly metadados: MetadadosPagina
      readonly conteudo: ResultadoSanitizacao
    }
  | { readonly ok: false; readonly motivo: MotivoRecusa }

/**
 * ID de página do Confluence é numérico, mas aceitar `[A-Za-z0-9]` cobre id de
 * conteúdo legado sem abrir a porta para caminho (`../`), separador ou espaço.
 * Recusar cedo evita transformar entrada do usuário em caminho de URL.
 */
const FORMATO_ID = /^[A-Za-z0-9_-]{1,64}$/

/**
 * As três condições de `RN-06`, sem tocar no conteúdo da página.
 *
 * Serve à leitura (`RF-39`) e ao proxy de anexo (`RNF-02`) — o anexo precisa
 * exatamente desta decisão e de nada mais, e é por isso que ela não traz o corpo.
 */
export async function verificarExposicao(
  atlassian: ClienteAtlassian,
  allowlist: AllowlistConfluence,
  idPagina: string,
): Promise<Exposicao> {
  // Negação por padrão (RNF-07): allowlist vazia não expõe nada, e não gasta
  // requisição para descobrir isso.
  if (allowlist.espacos_confluence.length === 0) {
    return { ok: false, motivo: 'espaco_fora_da_allowlist' }
  }
  if (!FORMATO_ID.test(idPagina)) return { ok: false, motivo: 'id_invalido' }

  let metadados: MetadadosPagina
  try {
    metadados = await atlassian.obterMetadadosPagina(idPagina)
  } catch (erro) {
    return { ok: false, motivo: ehTransitorio(erro) ? 'indisponivel' : 'nao_encontrada' }
  }

  // Condição 1 — espaço na allowlist. Comparação exata, igual à do CQL: é a MESMA
  // verificação da busca, e uma comparação mais frouxa aqui abriria por esta porta
  // o que a busca fecha.
  if (!allowlist.espacos_confluence.includes(metadados.espaco)) {
    return { ok: false, motivo: 'espaco_fora_da_allowlist' }
  }

  // Condição 2 — sem label de bloqueio. Sem diferenciar maiúsculas: a label é
  // digitada por quem edita a página, e `Confidencial` bloqueia tanto quanto
  // `confidencial`.
  const bloqueadas = allowlist.labels_bloqueadas.map((l) => l.toLowerCase())
  if (metadados.labels.some((l) => bloqueadas.includes(l.toLowerCase()))) {
    return { ok: false, motivo: 'label_bloqueada' }
  }

  // Página em lixeira ou rascunho não é conteúdo publicado — e orientação revogada
  // guiando uma decisão é pior que página nenhuma.
  if (!metadados.atual) return { ok: false, motivo: 'pagina_nao_atual' }

  // Condição 3 — sem restrição de página. O cliente real já devolve `true` quando a
  // consulta falha; o `try` aqui é a segunda camada, para o gate não depender de
  // toda implementação da interface ter sido fail-closed.
  let restrita = true
  try {
    restrita = await atlassian.paginaRestrita(idPagina)
  } catch {
    restrita = true
  }
  if (restrita) return { ok: false, motivo: 'pagina_restrita' }

  return { ok: true, metadados }
}

/**
 * Leitura autorizada: verifica, busca o corpo e **sanitiza**, nesta ordem.
 *
 * A sanitização acontece aqui dentro de propósito. Se a função devolvesse storage
 * cru, existiria um caminho em que HTML de página editável por qualquer pessoa
 * chega a quem chama — e `RNF-06` passaria a depender de cada rota lembrar de
 * sanitizar.
 */
export async function lerPaginaAutorizada(
  atlassian: ClienteAtlassian,
  allowlist: AllowlistConfluence,
  idPagina: string,
): Promise<LeituraPagina> {
  const exposicao = await verificarExposicao(atlassian, allowlist, idPagina)
  if (!exposicao.ok) return exposicao

  let storage: string
  try {
    storage = await atlassian.obterCorpoStorage(idPagina)
  } catch (erro) {
    return { ok: false, motivo: ehTransitorio(erro) ? 'indisponivel' : 'nao_encontrada' }
  }

  return { ok: true, metadados: exposicao.metadados, conteudo: sanitizarStorage(storage) }
}

/**
 * Transitório = "tente de novo"; o resto = "não existe para você".
 *
 * Erro que não é `ErroAtlassian` (bug nosso, JSON inesperado) cai no lado
 * conservador: não vira convite a repetir a chamada.
 */
function ehTransitorio(erro: unknown): boolean {
  return erro instanceof ErroAtlassian && erro.detalhe.transitorio
}
