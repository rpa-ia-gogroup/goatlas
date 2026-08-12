/**
 * O comentário que o JSM cria sozinho para carregar um anexo — `RF-46`, `RF-31`, `D-56`.
 *
 * ## O defeito que este arquivo existe para impedir
 *
 * Medido na staging em 12/08/2026 (`GN-6903`, `GN-6906`): ao materializar um anexo, o JSM
 * **cria um comentário público** cujo corpo é só o marcador do arquivo —
 * `[^conversa-GN-6903.md] _(4 kB)_`. Ninguém escreveu nada; é a forma como o Jira mostra
 * que há um arquivo ali.
 *
 * `primeiraRespostaDoTime` conta como resposta do time **todo comentário público sem o
 * prefixo de `D-13`** — e este não tem prefixo, porque não passou por `prefixarAutoria`.
 * Resultado: **todo chamado com anexo nascia com o SLA de primeira resposta já
 * satisfeito**. A aderência de `RF-55` ia a ~100% e o alerta de `RF-46` nunca disparava —
 * exatamente para o solicitante que o `D-20` escolheu como único destinatário.
 *
 * ⚠️ **O bug é mais velho que `D-54`.** Ele chega por `RF-61` (anexo na criação) desde que
 * aquilo existe; `D-54` só o tornou universal, porque agora **toda** conversa gera um
 * arquivo. O contraste que isola a causa: `GN-6906` (com anexo) nasceu com 1 comentário,
 * `GN-6904` (sem anexo) com 0.
 *
 * ## Por que a prova é o NOME, e não o formato
 *
 * Reconhecer "comentário que só tem marcador de anexo" resolveria o caso e falharia no dia
 * em que a Atlassian mudasse o texto — em silêncio, e na direção ruim (o SLA voltaria a se
 * satisfazer sozinho). Pior: descartaria também o anexo **do time**, que é resposta de
 * verdade — um agente que responde mandando o print resolveu o chamado, e dizer que
 * ninguém respondeu faria o alerta cobrar quem já tinha agido.
 *
 * Por isso são **duas** condições: o corpo não pode ter texto **e** todos os arquivos
 * citados têm de ser nossos — os de `anexos_enviados`, a tabela permanente que só o app
 * escreve (`D-51`). É o mesmo raciocínio de `RF-48`: não se detecta ação própria pelo
 * autor, e sim pelo que o app registrou ter feito.
 *
 * _Requirements: RF-31, RF-46, RF-48, RF-55, RN-08_
 */

/** `[^arquivo.png]` — a forma como o Jira referencia um anexo dentro do corpo. */
const MARCADOR = /\[\^([^\]]+)\]/g

/** `_(4 kB)_`, `_(0.0 kB)_` — a anotação de tamanho que acompanha o marcador. */
const TAMANHO = /_\([^)]*\)_/g

export function arquivosReferenciados(corpo: string): readonly string[] {
  return [...corpo.matchAll(MARCADOR)].map((m) => (m[1] ?? '').trim()).filter((n) => n.length > 0)
}

/**
 * Este comentário é **só** o carregador de um arquivo que nós enviamos?
 *
 * `true` significa: ninguém escreveu nada, e o arquivo é um dos que o app pôs lá. Não é
 * resposta do time, não é comentário do solicitante — é ruído de transporte.
 */
export function ehComentarioSoDeAnexoNosso(
  corpo: string,
  arquivosNossos: ReadonlySet<string>,
): boolean {
  const citados = arquivosReferenciados(corpo)
  // Sem marcador nenhum, é um comentário comum — de quem quer que seja.
  if (citados.length === 0) return false

  // Qualquer palavra fora dos marcadores é alguém falando: o comentário vira resposta,
  // ainda que traga um arquivo junto.
  const residuo = corpo.replace(MARCADOR, '').replace(TAMANHO, '').trim()
  if (residuo.length > 0) return false

  // ⚠️ Um único arquivo que não é nosso basta para o comentário voltar a ser do time.
  // O anexo do time É resposta, e tratá-lo como ruído faria o alerta cobrar quem agiu.
  return citados.every((nome) => arquivosNossos.has(nome))
}

/**
 * Constrói o conjunto a partir do que `anexos_enviados` guarda.
 *
 * ⚠️ **`anexos_enviados`, nunca `anexos_pendentes`** — a segunda é expurgada em 12 h
 * (`D-51`, armadilha de `T-422`), e meio dia depois de o chamado nascer o comentário
 * voltaria a contar como resposta do time. O bug reapareceria sozinho, sem ninguém mexer
 * em nada.
 */
export function conjuntoDeArquivosNossos(
  enviados: readonly { nomeArquivo: string }[],
): ReadonlySet<string> {
  return new Set(enviados.map((a) => a.nomeArquivo))
}
