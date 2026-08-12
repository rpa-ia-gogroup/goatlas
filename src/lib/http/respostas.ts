/**
 * Respostas HTTP — RNF-30: erro em linguagem de negócio, nunca stack trace nem
 * código HTTP cru na tela.
 *
 * ⚠️ O status HTTP existe para o cliente programático; a **mensagem** é para a
 * pessoa. Nenhuma resposta daqui carrega detalhe de infraestrutura, nome de campo
 * do Jira, id de projeto ou trecho de erro do provedor (RNF-01).
 */

export function json(dados: unknown, status = 200): Response {
  return new Response(JSON.stringify(dados), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      // O app não é embutível, e o conteúdo vem de fontes internas.
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin',
    },
  })
}

export interface CorpoErro {
  readonly erro: string
  readonly codigo: string
}

/**
 * O código que diz à tela "este chamado não vai nascer" — `D-46`.
 *
 * ⚠️ **Um produtor só**, como a chave de idempotência (`tickets/chave-idempotencia.ts`).
 * A tela precisa distinguir esta falha das outras para oferecer o recomeço, e uma string
 * literal repetida em `telas.tsx` divergiria em silêncio no dia em que o código mudasse:
 * o botão de saída simplesmente deixaria de aparecer, sem erro nenhum e sem teste caindo.
 */
export const CODIGO_CRIACAO_NAO_CONCLUIDA = 'criacao_nao_concluida'

export function erro(mensagem: string, codigo: string, status: number): Response {
  return json({ erro: mensagem, codigo } satisfies CorpoErro, status)
}

/** Mensagens de erro do app, em linguagem de negócio (RNF-30, PT-BR com acento). */
export const ERROS = {
  naoAutenticado: () =>
    erro(
      'Não conseguimos identificar sua conta. Saia e entre novamente com seu e-mail corporativo.',
      'nao_autenticado',
      401,
    ),
  semPermissao: () =>
    erro('Você não tem acesso a isso.', 'sem_permissao', 403),
  naoEncontrado: () =>
    erro('Não encontramos o que você procura.', 'nao_encontrado', 404),
  /**
   * Chamado de outra pessoa devolve **404, não 403** — de propósito. Um 403 diria
   * "existe, mas não é seu", o que já é informação sobre o chamado de outro
   * (RF-30, RN-04).
   */
  chamadoNaoSeu: () =>
    erro('Não encontramos esse chamado entre os seus.', 'nao_encontrado', 404),
  dadosInvalidos: (detalhe: string) =>
    erro(detalhe, 'dados_invalidos', 400),
  /**
   * Dependência fora do ar numa LEITURA. Diferente de `naoEncontrado()` de
   * propósito: responder "não encontramos" quando a página existe manda a pessoa
   * abrir chamado por uma documentação que estava lá (RNF-18, RNF-19).
   */
  conteudoIndisponivel: () =>
    erro(
      'Não conseguimos carregar este conteúdo agora. Tente de novo em instantes.',
      'conteudo_indisponivel',
      503,
    ),
  anexoGrandeDemais: () =>
    erro(
      'Este anexo é grande demais para abrir por aqui. Peça o arquivo ao time de tech.',
      'anexo_grande_demais',
      413,
    ),
  limiteRequisicoes: () =>
    erro(
      'Você fez muitas solicitações em pouco tempo. Aguarde um instante e tente novamente.',
      'limite_requisicoes',
      429,
    ),
  regraDeCriacao: (motivos: readonly string[]) =>
    erro(
      motivos.join(' '),
      'criacao_nao_autorizada',
      409,
    ),
  /**
   * ⚠️ **Esta frase NÃO promete reprocessamento** — e a versão anterior prometia
   * (`D-46`). Ela dizia *"Sua solicitação não foi perdida — tente novamente em
   * instantes"*, e essa promessa só o **outbox** pode cumprir: ela é verdadeira quando a
   * submissão fica `pendente`, e nesse caso a rota responde **201** com
   * `estado: 'pendente'` e a frase própria de `respostaCriacao`. Por aqui passa
   * justamente o contrário — o erro que ninguém enfileirou.
   *
   * Medido na staging em 12/08/2026: `POST /api/conversas/:id/confirmar` → **500** com
   * esta frase, submissão marcada `falha` e `transitorio: false`. Ou seja, a solicitação
   * **tinha** se perdido, e "tente novamente em instantes" não reprocessava nada
   * (`RNF-17`).
   *
   * Genérica de propósito: este é o erro de **qualquer** rota, inclusive falha de boot no
   * `worker.ts`, e nenhuma afirmação sobre o destino do que a pessoa enviou seria
   * verdadeira nas duas pontas. Quem sabe o destino é quem criou a condição — daí
   * `criacaoNaoConcluida` existir separada.
   */
  interno: () =>
    erro(
      'Algo deu errado do nosso lado. Tente de novo em instantes — se continuar, fale com o time de tech.',
      'erro_interno',
      500,
    ),
  /**
   * A criação falhou de forma **definitiva**: a submissão está `falha`, o cron **não** a
   * reprocessa, e nenhum chamado vai nascer dela (`RNF-17`, `D-46`).
   *
   * ⚠️ **A saída é diferente nas duas superfícies, então a frase também é.** A chave de
   * idempotência do formulário vive na montagem da tela e a da conversa é derivada da
   * conversa (`conversa:<id>`) — reenviar o mesmo formulário sem recomeçar, ou confirmar
   * de novo a mesma conversa, cai na **mesma** submissão morta e recebe este mesmo erro.
   * Mandar "tente de novo" sem dizer *de onde* seria a segunda frase falsa no lugar da
   * primeira.
   *
   * ⚠️ Nada do corpo da resposta da Atlassian entra aqui (`RNF-01`, `RNF-30`) — o motivo
   * técnico já está na auditoria, que é onde ele serve para alguma coisa.
   */
  criacaoNaoConcluida: (via: 'conversa' | 'formulario') =>
    erro(
      'Não conseguimos abrir o chamado, e ele não ficou na fila para ser aberto depois. ' +
        (via === 'formulario'
          ? 'Comece de novo pelo botão abaixo — se acontecer outra vez, fale com o time de tech.'
          : 'Comece uma conversa nova pelo botão abaixo — se acontecer outra vez, fale com o time de tech.'),
      CODIGO_CRIACAO_NAO_CONCLUIDA,
      500,
    ),
} as const

/** Lê JSON do corpo sem explodir com corpo malformado. */
export async function lerJson<T>(req: Request): Promise<T | null> {
  try {
    return (await req.json()) as T
  } catch {
    return null
  }
}
