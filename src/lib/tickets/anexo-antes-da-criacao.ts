/**
 * O anexo que viaja DENTRO da criação — `RF-79` (spec 010).
 *
 * ## Por que existe um segundo caminho de anexo
 *
 * `anexo-na-criacao.ts` é o caminho de `D-26`: cria o chamado e anexa **depois**, para que
 * um id temporário vencido nunca derrube a criação. Ele continua sendo o caminho certo —
 * para os 9 assuntos em que o anexo é opcional.
 *
 * Nos outros 6 (`90`, `91`, `92`, `94`, `96`, `134` no `GN`) o Jira **exige** o arquivo, e
 * medimos a frase dele em 17/08/2026, com todos os demais campos preenchidos:
 *
 * > "Por favor, adicione pelo menos um arquivo"
 *
 * Ali, criar-e-anexar-depois é criar-e-falhar: 400, definitivo, chamado perdido. E
 * `M-2` mediu que `requestFieldValues.attachment = [temporaryAttachmentId]` **funciona**
 * (`GN-6916`, HTTP 201).
 *
 * ## O que torna isto seguro, e não uma volta ao problema de `D-26`
 *
 * O id temporário usado aqui é **novo**: sai de um upload feito neste instante, a partir
 * dos bytes guardados em `anexos_conteudo` (`RF-78`, `D-74`). Não é o id de 40 minutos
 * atrás. É essa troca — guardar bytes para poder subir de novo — que dissolve o motivo de
 * `D-26` neste caminho.
 *
 * ⚠️ **Risco residual, declarado:** os ids entram no payload que o outbox persiste
 * (`D-39`), então uma **retentativa muito depois** os reenviaria já vencidos, e 400 é
 * definitivo. É estreito (a retentativa do cron roda em minutos) e visível na auditoria —
 * mas não é zero, e está anotado como trabalho seguinte em `D-75`.
 *
 * _Requirements: RF-78, RF-79, RN-14, RNF-17, RNF-18_
 */

import type { ClienteAtlassian } from '../atlassian/tipos'
import type { Auditoria } from '../audit'
import type { ResultadoAnexoNaCriacao } from './anexo-na-criacao'
import type { RepositorioAnexosConteudo } from './anexos-conteudo'
import type { RepositorioAnexosPendentes } from './anexos-pendentes'

export interface DependenciasAnexoAntes {
  readonly anexosPendentes: RepositorioAnexosPendentes
  readonly anexosConteudo: RepositorioAnexosConteudo
  readonly atlassian: ClienteAtlassian
  readonly auditoria: Auditoria
  readonly anexosEnviados?: {
    registrar(dados: {
      issueKey: string
      solicitanteEmail: string
      nomeArquivo: string
      via: 'criacao' | 'chamado'
    }): Promise<void>
  }
  readonly outbox?: { registrarAnexosAnexados(chave: string, quantos: number): Promise<void> }
}

export interface AnexosParaCriacao {
  /** Ids temporários prontos para entrar em `requestFieldValues.attachment`. */
  readonly ids: readonly string[]
  /** `(anexoId, nome)` do que foi preparado — é o que se marca depois da criação. */
  readonly itens: readonly { readonly anexoId: string; readonly nomeArquivo: string }[]
  /** `true` quando o id veio do upload antigo, por falta de bytes guardados. */
  readonly usouIdAntigo: boolean
}

/**
 * Sobe os arquivos AGORA e devolve ids fresquinhos.
 *
 * ⚠️ **Cai para o id antigo quando não há bytes** — arquivo enviado antes desta versão, ou
 * expurgado. É degradação declarada (`RNF-18`): o id velho pode estar vencido, mas a
 * alternativa é recusar a criação de alguém que anexou direitinho. Quem falha aqui falha
 * como sempre falhou; quem tem bytes ganha a garantia.
 *
 * ⚠️ **Lança** se o upload falhar: quem chama está **antes** de qualquer efeito, e a falha
 * precisa ser classificada por `RNF-17` (5xx transitório · 4xx definitivo) como qualquer
 * outra. Engolir aqui produziria uma criação sem anexo — que o Jira recusa de qualquer
 * forma, só que mais tarde e sem explicação.
 */
export async function prepararAnexosParaCriacao(
  deps: DependenciasAnexoAntes,
  dados: {
    readonly chaveIdempotencia: string
    readonly solicitanteEmail: string
    readonly serviceDeskId: string
  },
): Promise<AnexosParaCriacao> {
  const pendentes = await deps.anexosPendentes.listarNaoMaterializados(
    dados.chaveIdempotencia,
    dados.solicitanteEmail,
  )
  if (pendentes.length === 0) return { ids: [], itens: [], usouIdAntigo: false }

  const guardados = await deps.anexosConteudo.lerDaChave(
    dados.chaveIdempotencia,
    dados.solicitanteEmail,
  )
  const bytesPorId = new Map(guardados.map((g) => [g.anexoId, g]))

  const ids: string[] = []
  const itens: { anexoId: string; nomeArquivo: string }[] = []
  let usouIdAntigo = false

  for (const pendente of pendentes) {
    const guardado = bytesPorId.get(pendente.id)
    if (guardado) {
      ids.push(
        await deps.atlassian.subirAnexoTemporario(dados.serviceDeskId, {
          nome: guardado.nomeArquivo,
          tipo: guardado.tipoArquivo,
          bytes: guardado.bytes,
        }),
      )
    } else {
      usouIdAntigo = true
      ids.push(pendente.temporaryAttachmentId)
    }
    itens.push({ anexoId: pendente.id, nomeArquivo: pendente.nomeArquivo })
  }

  return { ids, itens, usouIdAntigo }
}

/**
 * Depois que o chamado nasceu **com** os arquivos: fecha as linhas e registra.
 *
 * ⚠️ Chamado **só** no sucesso. Marcar antes deixaria o arquivo fora da lista da pessoa se
 * a criação falhasse — e ela teria de reenviar sem saber por quê.
 *
 * ⚠️ **Nada aqui lança**, pela mesma razão de `anexo-na-criacao.ts`: o chamado já existe, e
 * um erro de bookkeeping não pode virar "algo deu errado" na cara de quem acabou de abrir.
 */
export async function registrarAnexosDaCriacao(
  deps: DependenciasAnexoAntes,
  dados: {
    readonly chaveIdempotencia: string
    readonly solicitanteEmail: string
    readonly issueKey: string
    readonly itens: readonly { readonly anexoId: string; readonly nomeArquivo: string }[]
  },
): Promise<{ readonly anexados: readonly string[] }> {
  const anexados: string[] = []
  for (const item of dados.itens) {
    try {
      // A reivindicação é o mesmo lock de `D-26`: sem ela, um segundo clique materializaria
      // o arquivo de novo, e anexo em dobro não tem caminho de volta.
      const meu = await deps.anexosPendentes.reivindicar(item.anexoId, dados.solicitanteEmail)
      if (!meu) continue
      await deps.anexosEnviados?.registrar({
        issueKey: dados.issueKey,
        solicitanteEmail: dados.solicitanteEmail,
        nomeArquivo: item.nomeArquivo,
        via: 'criacao',
      })
      // Os bytes já cumpriram o papel; guardá-los é custo e dado pessoal a mais (`D-17`).
      await deps.anexosConteudo.apagar(item.anexoId)
      anexados.push(item.nomeArquivo)
    } catch {
      // Sem detalhe: a mensagem pode carregar corpo da Atlassian (`RNF-01`, `RNF-30`).
    }
  }

  if (anexados.length > 0) {
    await deps.outbox
      ?.registrarAnexosAnexados(dados.chaveIdempotencia, anexados.length)
      .catch(() => undefined)
  }
  await deps.auditoria.registrar({
    atorEmail: dados.solicitanteEmail,
    acao: 'anexo_enviado',
    recurso: dados.issueKey,
    resultado: anexados.length === dados.itens.length ? 'sucesso' : 'falha',
    detalhe: {
      etapa: 'na_criacao',
      anexados: anexados.length,
      esperados: dados.itens.length,
    },
  })
  return { anexados }
}

/**
 * Traduz o resultado deste caminho para a **mesma forma** que a tela já sabe ler.
 *
 * ⚠️ Um formato próprio aqui obrigaria o recibo a conhecer dois vocabulários de anexo, e o
 * segundo seria o que ninguém testa. As frases de falha continuam vindo de
 * `anexo-na-criacao.ts` — com uma diferença que importa: aqui, se o arquivo não entrou, o
 * **chamado também não existe**, então não há "chamado aberto sem o anexo" para explicar.
 */
export function respostaDeAnexoNaCriacao(
  anexados: readonly string[],
  esperados: readonly string[],
): ResultadoAnexoNaCriacao {
  const falharam = esperados.filter((nome) => !anexados.includes(nome))
  if (esperados.length === 0) {
    return { estado: 'sem_anexo', anexados: [], falharam: [], mensagem: '' }
  }
  return {
    estado: falharam.length === 0 ? 'anexado' : anexados.length === 0 ? 'falhou' : 'parcial',
    anexados: [...anexados],
    falharam,
    // O arquivo entrou junto com o chamado: não há segunda etapa que possa ter falhado, e
    // por isso a mensagem é vazia mesmo no caso parcial — o que a pessoa vê é a lista.
    mensagem: '',
  }
}
