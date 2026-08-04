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
  interno: () =>
    erro(
      'Algo deu errado do nosso lado. Sua solicitação não foi perdida — tente novamente em instantes.',
      'erro_interno',
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
