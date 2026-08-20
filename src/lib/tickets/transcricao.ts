/**
 * A transcrição da conversa dentro do chamado — `RF-23`, `T-098`.
 *
 * ## O requisito tinha duas metades e só uma existia
 *
 * `RF-23` pede **persistir** a transcrição **e** anexá-la ao chamado. A primeira
 * metade está pronta desde a Fase 1 (`conversas`/`mensagens`, e `submissoes.conversa_id`
 * ligando o chamado à conversa). A segunda **não existia em lugar nenhum**: quem abre o
 * `GN-xxxx` no Jira nativo via o resumo que o modelo escreveu — `proposta.titulo` e
 * `proposta.descricao` — e não tinha caminho de volta para o diálogo, que é literalmente
 * o que o requisito chama de "o contexto que o time de tech mais perde hoje".
 *
 * ## Por que ANEXO, e não link nem descrição (`D-54`)
 *
 * **Linkar para dentro do app está morto por medição, não por gosto.** `RF-30` não tem
 * leitura sem e-mail — o filtro está no `WHERE` de `tickets/vinculos.ts`, e não existe
 * `obterPorIssueKey(issueKey)` sem e-mail. O agente do time abriria o link com o e-mail
 * dele e receberia **404**, e antes disso o edge do GoDeploy (`visibility: authenticated`)
 * o mandaria ao OAuth. Fazer o link funcionar exigiria uma rota de leitura de conversa
 * **alheia** — desenho novo de segurança, não "linkar".
 *
 * **Colar na descrição perde chamado.** A descrição viaja no corpo da criação, e criação
 * que responde 400 é **definitiva** (`RNF-17`): a submissão vira `falha` e nunca é
 * reprocessada. Uma conversa comprida encostando no limite do campo — limite que **não
 * foi medido** contra o JSM — apagaria o chamado da pessoa por causa de um extra. E
 * descrição não tem volta: o texto do pedido ficaria afogado embaixo de quarenta linhas
 * de diálogo, para sempre.
 *
 * O anexo é o caminho já trilhado (`RF-61`, `D-26`) e o único cujo pior caso é inócuo.
 *
 * ## Nada aqui lança — mesma razão de `anexo-na-criacao.ts`
 *
 * Quando esta função roda, o chamado **já nasceu**. Deixar um erro subir levaria a rota
 * ao `catch` e a pessoa leria "algo deu errado" tendo o chamado aberto. O pior caso é uma
 * linha de auditoria.
 *
 * ## E por isso ela é SILENCIOSA na tela
 *
 * O anexo da pessoa (`RF-61`) falhando vira mensagem, porque é a evidência **dela** e ela
 * precisa reagir. A transcrição é conveniência para o time de tech: dizer "não consegui
 * anexar a transcrição" num recibo de chamado recém-aberto ensina a pessoa a duvidar de
 * um chamado que está de pé — e quem duvida abre o segundo. O registro vai à auditoria,
 * que é quem precisa saber.
 *
 * _Requirements: RF-23, RF-25, RF-30, RNF-01, RNF-17, RNF-18, RNF-30_
 */

import type { ClienteAtlassian } from '../atlassian/tipos'
import type { Auditoria } from '../audit'
import type { MensagemIA, NomeTool } from '../ia/tipos'

/** Teto do arquivo gerado, em bytes de UTF-8. */
export const LIMITE_TRANSCRICAO_BYTES = 256 * 1024

/**
 * ⚠️ **O conteúdo da tool fica de fora, e o registro de que ela rodou fica.**
 *
 * O que a `search_confluence` devolve é trecho de página do Confluence, e o que a
 * `check_jira_history` devolve é resumo de chamado de outras pessoas. Despejar isso no
 * corpo de um chamado copiaria conteúdo de terceiros para um lugar com outra política de
 * acesso — `RN-06` decide a exposição **na leitura**, e um arquivo anexado não é
 * reavaliado por ninguém depois. O que o time de tech precisa saber é que a verificação
 * **aconteceu** antes de o chamado nascer; o conteúdo dela a pessoa já leu na conversa.
 */
const ROTULO_TOOL: Readonly<Record<NomeTool, string>> = {
  search_confluence: 'consultou a documentação',
  check_jira_history: 'consultou o histórico de chamados',
}

/**
 * A mensagem que carrega a leitura do anexo (spec 007) tem rótulo próprio.
 *
 * ⚠️ **O conteúdo dela continua fora do diálogo**, como todo `tool` (`D-54`) — mas por outra
 * razão: aqui não é conteúdo de terceiro, é a leitura do arquivo da própria pessoa, e ela
 * aparece **inteira** na seção "Arquivos anexados". Repetir nos dois lugares faria a
 * transcrição dizer a mesma coisa duas vezes, em formatos diferentes.
 */
const ROTULO_LEITURA_DE_ANEXO = 'leu os arquivos anexados'

export interface DadosDaTranscricao {
  readonly conversaId: string
  readonly solicitanteEmail: string
  readonly issueKey: string
  /** Carimbo ISO de quando o arquivo foi gerado. */
  readonly geradoEm: string
  /**
   * O que a IA leu de cada anexo — spec 007, `SC-13` (`Q7-3`, respondida em 13/08/2026).
   *
   * 🚨 **Inclui a análise que a TELA não mostrou.** `irrelevante` fica calada para a pessoa
   * (`FR-5b`) e **vem** para cá: quem trabalha o chamado precisa saber que o arquivo foi
   * olhado e não acrescentava nada — senão abre o anexo por nada, que é justamente o custo
   * que `US-4` quer evitar. Esta é a única superfície onde a descrição irrelevante existe.
   *
   * Vazio = conversa sem anexo, e a seção não aparece.
   */
  readonly analises?: readonly {
    readonly nomeArquivo: string
    readonly estado: string
    readonly descricao: string | null
  }[]
}

function rotuloDoPapel(m: MensagemIA): string | null {
  switch (m.papel) {
    case 'user':
      return 'Solicitante'
    case 'assistant':
      return 'Agente'
    default:
      // ⚠️ `system` **nunca** entra. O prompt do agente é função da instalação (`D-33`):
      // ele carrega a allowlist de espaços, os exemplos da Regra 2 e as horas do SLA
      // configuradas. Copiá-lo para dentro de um chamado é pôr configuração interna numa
      // superfície que o requisito nem pediu (`RNF-30`).
      return null
  }
}

/**
 * Monta o Markdown. Função pura: dá para testá-la sem HTTP, sem banco e sem Atlassian.
 *
 * ⚠️ **O truncamento é DENUNCIADO no próprio arquivo.** Corte silencioso é o defeito de
 * `SC-08` (o quarto anexo que sumia sem nada na tela) na versão que ninguém veria nunca:
 * quem lê a transcrição no Jira não tem como saber que ela acabou antes da conversa.
 */
export function montarTranscricao(
  mensagens: readonly MensagemIA[],
  dados: DadosDaTranscricao,
): string {
  const cabecalho = [
    '# Conversa com o agente do atlas',
    '',
    `- **Chamado:** ${dados.issueKey}`,
    `- **Solicitante:** ${dados.solicitanteEmail}`,
    `- **Conversa:** ${dados.conversaId}`,
    `- **Gerado em:** ${dados.geradoEm}`,
    '',
    '> Diálogo que originou este chamado. O resultado das verificações automáticas não é',
    '> reproduzido aqui — só o registro de que elas rodaram antes de o chamado ser aberto.',
    '',
    '---',
    '',
  ].join('\n')

  const corpo: string[] = []

  // A seção vem ANTES do diálogo: quem abre o chamado quer saber o que havia nos arquivos
  // antes de ler a conversa inteira — é a ordem em que um agente de tech trabalha.
  const secaoDeAnexos = montarSecaoDeAnexos(dados.analises ?? [])
  if (secaoDeAnexos) corpo.push(secaoDeAnexos)

  for (const m of mensagens) {
    if (m.papel === 'tool') {
      // ⚠️ O `as string` é necessário: `toolNome` é tipado como `NomeTool`, e `anexo_lido`
      // **não é uma tool** — é a mensagem que carrega a leitura do anexo (spec 007). Alargar
      // `NomeTool` para incluí-la seria pior: ela apareceria em `toolsPermitidas` e no gate.
      const nome = m.toolNome as string | undefined
      const rotulo =
        nome === 'anexo_lido'
          ? ROTULO_LEITURA_DE_ANEXO
          : nome
            ? ROTULO_TOOL[nome as NomeTool]
            : undefined
      corpo.push(`_(o agente ${rotulo ?? 'usou uma ferramenta de verificação'})_`, '')
      continue
    }
    const quem = rotuloDoPapel(m)
    if (quem === null) continue
    const texto = m.conteudo.trim()
    if (texto.length === 0) continue
    corpo.push(`**${quem}:**`, '', texto, '')
  }

  if (corpo.length === 0) {
    corpo.push('_(esta conversa não tem mensagens registradas)_', '')
  }

  return recortar(cabecalho + corpo.join('\n'))
}

/**
 * "Arquivos anexados e o que foi lido deles" — `SC-13`.
 *
 * ⚠️ Cada linha diz o **nome** e o que se sabe, e os estados sem descrição ganham frase
 * própria: para quem trabalha o chamado, "não sei ler este formato" e "não consegui ler agora"
 * mudam o que ele faz com o arquivo (abrir na mão × pedir de novo).
 */
function montarSecaoDeAnexos(
  analises: readonly {
    readonly nomeArquivo: string
    readonly estado: string
    readonly descricao: string | null
  }[],
): string | null {
  if (analises.length === 0) return null
  const linhas = analises.map((a) => {
    const temDescricao = a.descricao && (a.estado === 'pronta' || a.estado === 'irrelevante')
    const detalhe = temDescricao
      ? a.descricao
      : (FRASE_DO_ESTADO[a.estado] ?? 'não foi possível ler este arquivo')
    // `irrelevante` é marcado: o agente sabe que alguém olhou e não achou nada, o que é
    // diferente de ninguém ter olhado.
    const marca = a.estado === 'irrelevante' ? ' _(sem conteúdo útil para o caso)_' : ''
    return `- **${a.nomeArquivo}** — ${detalhe}${marca}`
  })
  return ['## Arquivos anexados e o que foi lido deles', '', ...linhas, ''].join('\n')
}

/** As frases dos estados sem descrição. Espelham as da tela, e por isso são curtas. */
const FRASE_DO_ESTADO: Readonly<Record<string, string>> = {
  analisando: 'a leitura não havia terminado quando o chamado foi aberto',
  tipo_nao_suportado: 'o atlas não lê este formato de arquivo',
  sem_conteudo: 'não havia texto ou imagem legível neste arquivo',
  falhou: 'a leitura falhou — o arquivo não foi analisado',
}

function recortar(texto: string): string {
  const aviso =
    '\n\n---\n\n_⚠️ Transcrição truncada: a conversa passou do limite de arquivo do atlas. O diálogo completo continua registrado no app._\n'
  const codificador = new TextEncoder()
  if (codificador.encode(texto).length <= LIMITE_TRANSCRICAO_BYTES) return texto

  const sobra = LIMITE_TRANSCRICAO_BYTES - codificador.encode(aviso).length
  // Corta por bytes e reconstrói ignorando o caractere partido ao meio — acento no limite
  // não pode virar byte solto (regra 4: o arquivo é texto visível a uma pessoa).
  const bytes = codificador.encode(texto).slice(0, Math.max(0, sobra))
  const decodificador = new TextDecoder('utf-8', { fatal: false })
  return decodificador.decode(bytes).replace(/�+$/u, '') + aviso
}

export function nomeDoArquivo(issueKey: string): string {
  // Só o que o issue key já é (`[A-Z]+-\d+`); saneado mesmo assim porque ele vira nome de
  // arquivo dentro de um multipart.
  return `conversa-${issueKey.replace(/[^A-Za-z0-9-]/g, '')}.md`
}

export interface DependenciasTranscricao {
  readonly atlassian: Pick<
    ClienteAtlassian,
    'subirAnexoTemporario' | 'materializarAnexosTemporarios'
  >
  readonly auditoria: Auditoria
  readonly conversas: { listarMensagens(conversaId: string): Promise<MensagemIA[]> }
  /**
   * `RF-31` — opcional, e quando existe é o que faz a transcrição aparecer na tela da
   * pessoa com a origem certa. Ver `anexos-do-chamado.ts`.
   */
  readonly anexosEnviados?: {
    registrar(dados: {
      issueKey: string
      solicitanteEmail: string
      nomeArquivo: string
      tamanhoBytes?: number | null
      tipo?: string | null
      via: 'transcricao'
    }): Promise<void>
  }
  /**
   * spec 007, `SC-13` — o que a IA leu de cada anexo. Opcional pelo mesmo motivo de
   * `anexosEnviados`: os testes antigos montam estas dependências à mão, e um campo
   * obrigatório novo os quebraria sem que nada de comportamento tivesse mudado.
   */
  readonly analisesAnexo?: {
    listarDaConversa(
      conversaId: string,
      solicitanteEmail: string,
    ): Promise<readonly { nomeArquivo: string; estado: string; descricao: string | null }[]>
  }
  readonly agora: () => string
}

/**
 * Anexa a transcrição ao chamado recém-criado. **Não lança, nunca.**
 *
 * Devolve `true` só quando o arquivo entrou — quem chama usa isso para teste, não para
 * falar com a pessoa.
 */
export async function anexarTranscricaoDoChamado(
  deps: DependenciasTranscricao,
  dados: {
    readonly conversaId: string
    readonly solicitanteEmail: string
    readonly serviceDeskId: string
    /** `null` = a criação foi para a fila (`SC-07b`) e ainda não há chamado. */
    readonly issueKey: string | null
  },
): Promise<boolean> {
  const registrar = (resultado: 'sucesso' | 'falha', detalhe: Record<string, unknown>) =>
    deps.auditoria
      .registrar({
        atorEmail: dados.solicitanteEmail,
        acao: 'transcricao_anexada',
        recurso: dados.issueKey ?? `conversa:${dados.conversaId}`,
        resultado,
        detalhe,
      })
      // A auditoria falhando não pode derrubar quem já tem chamado aberto.
      .catch(() => undefined)

  if (dados.issueKey === null) {
    // Mesmo raciocínio do `adiado` de `anexo-na-criacao.ts`: sem chave não há onde anexar.
    // A diferença é que aqui **nada se perde** — a conversa continua no banco, que é a
    // metade de `RF-23` que sempre funcionou.
    await registrar('falha', { motivo: 'criacao_diferida' })
    return false
  }

  try {
    const mensagens = await deps.conversas.listarMensagens(dados.conversaId)
    // spec 007, `SC-13` — as análises vêm do repositório, não das mensagens: a `irrelevante`
    // nunca virou mensagem (ela não vai ao modelo, `FR-5b`) e é justamente uma das que o
    // agente de tech precisa ver. Sem repositório injetado, a seção simplesmente não aparece.
    const analises = deps.analisesAnexo
      ? await deps.analisesAnexo
          .listarDaConversa(dados.conversaId, dados.solicitanteEmail)
          .catch(() => [])
      : []
    const texto = montarTranscricao(mensagens, {
      conversaId: dados.conversaId,
      solicitanteEmail: dados.solicitanteEmail,
      issueKey: dados.issueKey,
      geradoEm: deps.agora(),
      analises,
    })
    const bytes = new TextEncoder().encode(texto)
    const nome = nomeDoArquivo(dados.issueKey)

    const id = await deps.atlassian.subirAnexoTemporario(dados.serviceDeskId, {
      nome,
      tipo: 'text/markdown',
      // `slice()` porque o `Uint8Array` do encoder pode ser uma vista de um buffer maior.
      bytes: bytes.slice().buffer as ArrayBuffer,
    })
    await deps.atlassian.materializarAnexosTemporarios(dados.issueKey, [id])

    // A transcrição **não** é "você enviou" nem "do time": ninguém a mandou, o app a
    // gerou. Registrá-la com `via: 'transcricao'` é o que permite à tela dizer isso em
    // palavras, em vez de afirmar uma autoria falsa — a lição de `D-43`.
    await deps.anexosEnviados
      ?.registrar({
        issueKey: dados.issueKey,
        solicitanteEmail: dados.solicitanteEmail,
        nomeArquivo: nome,
        tamanhoBytes: bytes.byteLength,
        tipo: 'text/markdown',
        via: 'transcricao',
      })
      .catch(() => undefined)

    await registrar('sucesso', { bytes: bytes.byteLength, mensagens: mensagens.length })
    return true
  } catch {
    // ⚠️ A mensagem do erro não entra em nada: ela pode carregar corpo de resposta da
    // Atlassian (`RNF-01`, `RNF-30`).
    await registrar('falha', { motivo: 'anexo_recusado' })
    return false
  }
}
