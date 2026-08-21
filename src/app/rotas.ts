/**
 * As telas do app têm URL, e o **voltar do navegador** funciona.
 *
 * ## O que estava quebrado
 *
 * Relato do mantenedor usando o app publicado: *"não dá pra voltar pra lista de categorias
 * apenas dando ← no navegador"*. Tudo morava em `/`, e o único registro de estado na URL
 * (`?q=`, `?pagina=`) era escrito com **`replaceState`** — que por definição **substitui** a
 * entrada atual do histórico. Abrir cinco páginas do Confluence em sequência deixava o
 * histórico com **uma** entrada, e o ← saía do app.
 *
 * O comentário que este arquivo substitui já previa o momento: *"um router de verdade entra
 * com T-115, quando houver árvore e breadcrumb para navegar"*. A árvore e o breadcrumb
 * existem desde a `T-115`; o que faltava era o histórico.
 *
 * ## Por que é uma TABELA, e não uma lib de router
 *
 * São sete telas sem parâmetro além do `issueKey`, e a navegação continua sendo estado de
 * React (Princípio V) — o que muda é que cada mudança de tela **empilha** uma entrada e a
 * volta do navegador é ouvida. Instalar TanStack Router para isto seria a abstração
 * prematura que o Princípio V recusa; o custo aqui é uma tabela de sete linhas.
 *
 * ⚠️ **O caminho da SPA depende de `not_found_handling: "single-page-application"`** no
 * `updateApp` (ver `docs/DEPLOY.md`): é ele que faz `/documentacao` servir o `index.html`
 * em vez de 404. Sem isso, recarregar a página fora da raiz quebra — e o sintoma aparece só
 * no deploy, nunca em `npm run dev`.
 *
 * ⚠️ **Nenhum caminho pode começar com `/api`**, que é do Worker.
 */

/** Uma tela do app. `detalhe` é a única que carrega dado na URL. */
export type Tela =
  | { readonly nome: 'conversa' }
  | { readonly nome: 'documentacao' }
  | { readonly nome: 'chamados' }
  | { readonly nome: 'formulario' }
  | { readonly nome: 'admin' }
  /**
   * spec 009 — o registro de depuração. Só admin, e o gate real é do servidor.
   *
   * ⚠️ **`conversaId` opcional é a segunda tela com dado na URL** (`FR-29`, spec 013). Sem
   * ele não existia como **mandar uma sessão a alguém**: quem achasse o caso descrevia o
   * e-mail e o horário para o outro procurar de novo. Mesmo desenho de `detalhe`.
   */
  | { readonly nome: 'investigador'; readonly conversaId?: string }
  | { readonly nome: 'detalhe'; readonly issueKey: string }

export type NomeDeTela = Tela['nome']

/**
 * O caminho da aba Documentação, exportado porque **duas camadas o escrevem**: `App.tsx` ao
 * trocar de aba e `confluence.tsx` ao abrir página ou buscar. Repetir a string nos dois faz
 * um deles divergir no dia em que o caminho mudar — e o sintoma seria o ← levando à tela
 * errada, sem erro nenhum. Mesma razão de a chave de idempotência ter um produtor só.
 */
export const CAMINHO_DOCUMENTACAO = '/documentacao'

/**
 * A conversa também tem caminho próprio — `/chat`.
 *
 * 🚨 **Antes ela era a raiz, e isso deixava uma tela sem endereço.** Pedido do mantenedor:
 * *"tudo tem que ser paginado"*. Consequência concreta, não estética: sem caminho próprio não
 * havia como mandar alguém direto para a conversa, e o ← saía do app quando a primeira coisa
 * que a pessoa fazia era trocar de aba — a raiz não empilhava nada distinguível.
 *
 * ⚠️ **`/` continua funcionando e continua caindo aqui.** É o endereço que as pessoas têm
 * salvo, é o que o edge do GoDeploy serve, e é o que o link `?pagina=` antigo usa (`D-56`:
 * `urlDeLeituraNoApp` escrevia `/?pagina=`). A diferença é que, ao abrir em `/`, o app
 * **reescreve** a URL para `/chat` com `replaceState` — nunca `push`, senão o primeiro ← da
 * sessão voltaria para a mesma tela e pareceria travado.
 */
export const CAMINHO_CONVERSA = '/chat'

/**
 * Caminho de cada tela — em português, como todo texto que a pessoa lê (regra 4). A URL é
 * superfície: `/meus-chamados` diz onde se está, `/` não diz nada.
 *
 * ⚠️ `conversa` tem caminho próprio (`/chat`), e a **raiz continua caindo nela** — ver
 * `CAMINHO_CONVERSA`. Um link para o app sem caminho nenhum tem de chegar em algum lugar
 * útil, e é também o que faz `entradaDaUrl` continuar funcionando para quem chega por
 * `?pagina=` num link antigo, sem caminho.
 */
const CAMINHO_POR_TELA: Readonly<Record<NomeDeTela, string>> = {
  conversa: CAMINHO_CONVERSA,
  documentacao: CAMINHO_DOCUMENTACAO,
  chamados: '/meus-chamados',
  formulario: '/abrir-chamado',
  admin: '/administracao',
  investigador: '/investigador',
  // O detalhe vive DENTRO de "meus chamados" na URL como vive na tela: o botão "voltar"
  // dele leva à lista, e agora o ← do navegador faz a mesma coisa.
  detalhe: '/meus-chamados',
}


export function caminhoDaTela(tela: Tela): string {
  if (tela.nome === 'detalhe') {
    return `${CAMINHO_POR_TELA.detalhe}/${encodeURIComponent(tela.issueKey)}`
  }
  if (tela.nome === 'investigador' && tela.conversaId !== undefined) {
    return `${CAMINHO_POR_TELA.investigador}/${encodeURIComponent(tela.conversaId)}`
  }
  return CAMINHO_POR_TELA[tela.nome]
}

/**
 * Caminho → tela. **Desconhecido cai na conversa**, nunca em erro: URL digitada errada, link
 * velho e caminho de uma versão futura são todos a mesma coisa para quem lê — chegar em algum
 * lugar útil é melhor que uma tela de "rota não encontrada" dentro de um app de sete telas.
 *
 * ⚠️ A leitura é **exata por segmento**, não `startsWith`: `/documentacao-antiga` não é
 * `/documentacao`, e tratá-lo como se fosse abriria a aba errada sem nada na tela dizendo.
 */
export function telaDoCaminho(caminho: string): Tela {
  const partes = caminho.split('/').filter((p) => p !== '')

  if (partes.length === 0) return { nome: 'conversa' }

  const primeiro = `/${partes[0]}`

  if (primeiro === CAMINHO_POR_TELA.investigador) {
    const conversa = partes[1]
    // Sem id é a lista de sessões; com id, aquela sessão aberta. O gate de admin continua
    // sendo do servidor: um link colado por quem não é admin cai em 403 na rota, não aqui.
    return conversa === undefined
      ? { nome: 'investigador' }
      : { nome: 'investigador', conversaId: decodeURIComponent(conversa) }
  }

  if (primeiro === CAMINHO_POR_TELA.detalhe) {
    const chave = partes[1]
    // Sem chave é a lista; com chave é o detalhe daquele chamado. A rota do servidor
    // continua sendo quem decide se ele é da pessoa (`RF-30`) — isto aqui é só a tela.
    return chave === undefined
      ? { nome: 'chamados' }
      : { nome: 'detalhe', issueKey: decodeURIComponent(chave) }
  }

  for (const [nome, caminhoDaEntrada] of Object.entries(CAMINHO_POR_TELA)) {
    // `detalhe` já foi tratado acima (ele compartilha o caminho da lista, com a chave depois).
    // ⚠️ `conversa` **não** é mais exceção aqui: desde que ela tem `/chat`, ela casa pela
    // tabela como qualquer outra — e continua sendo o destino do desconhecido, logo abaixo.
    if (nome === 'detalhe' || nome === 'investigador') continue
    if (primeiro === caminhoDaEntrada) return { nome: nome as NomeDeTela } as Tela
  }

  return { nome: 'conversa' }
}

/**
 * Empilha uma entrada no histórico — é o que faz o ← do navegador voltar um passo.
 *
 * ⚠️ **`push` × `replace` é o coração deste arquivo.** Empilhar é para o que a pessoa
 * reconhece como "um passo" (abrir uma página, rodar uma busca, trocar de aba). Substituir é
 * para correção do estado atual — apagar o campo de busca não é um passo para trás, e
 * empilhá-lo obrigaria a apertar ← duas vezes para sair de onde já se estava.
 */
export function irPara(caminho: string, modo: 'empilhar' | 'substituir' = 'empilhar'): void {
  if (typeof window === 'undefined' || !window.history?.pushState) return
  const atual = `${window.location.pathname}${window.location.search}`
  if (atual === caminho) return
  if (modo === 'empilhar') window.history.pushState(null, '', caminho)
  else window.history.replaceState(null, '', caminho)
}
