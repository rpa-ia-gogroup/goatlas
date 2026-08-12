/**
 * O segundo passo: transformar o pendente em anexo do chamado — `RF-61`, `RF-63`.
 *
 * ## Por que isto NÃO mora em `ServicoChamados.processar`
 *
 * Porque `processar` tem um `catch` que classifica o erro e chama
 * `registrarTentativaFalha` — e um erro definitivo ali marca a submissão como `falha`,
 * que **nunca é reprocessada**. Se a materialização acontecesse dentro daquele bloco,
 * um `temporaryAttachmentId` vencido (4xx, definitivo) apagaria o chamado da pessoa. É
 * exatamente o desenho que o `/analyze` derrubou (`plan.md` §0).
 *
 * Por isso a materialização é **fora** da criação e depois dela: o resultado do anexo é
 * um dado à parte na resposta, e nenhum caminho daqui pode mudar o estado da submissão.
 * Nada nesta função lança — o pior caso é `estado: 'falhou'` com a lista de nomes.
 *
 * ## A janela curta que se aceita de propósito
 *
 * Entre a criação e a materialização o chamado existe sem o anexo. Para o solicitante é
 * invisível (uma tela só); para quem observa a fila, um chamado pode aparecer segundos
 * antes do arquivo. É barato perto de perder chamado (`plan.md` §2).
 *
 * _Requirements: RF-24, RF-30, RF-44, RF-61, RF-63, RN-10, RNF-17, RNF-18_
 */

import type { ClienteAtlassian } from '../atlassian/tipos'
import type { Auditoria } from '../audit'
import type { RepositorioAnexosPendentes } from './anexos-pendentes'
import type { Outbox } from './outbox'

export type EstadoAnexoNaCriacao =
  /** Não havia arquivo esperando — inclui a reconfirmação, cujo anexo já subiu. */
  | 'sem_anexo'
  | 'anexado'
  | 'parcial'
  | 'falhou'
  /** `SC-07b` — a criação foi para a fila; o anexo **não** vai com ela. */
  | 'adiado'

export interface ResultadoAnexoNaCriacao {
  readonly estado: EstadoAnexoNaCriacao
  readonly anexados: readonly string[]
  readonly falharam: readonly string[]
  /** Texto para a pessoa (`RNF-30`, PT-BR). Vazio quando não há o que dizer. */
  readonly mensagem: string
}

const SEM_ANEXO: ResultadoAnexoNaCriacao = {
  estado: 'sem_anexo',
  anexados: [],
  falharam: [],
  mensagem: '',
}

/**
 * ⚠️ As mensagens de falha **não** insinuam que o chamado se perdeu.
 *
 * Quem lê "não consegui anexar" num app que acabou de abrir chamado assume o pior — e
 * assumir o pior aqui significa abrir um segundo chamado. A frase diz, na ordem: o
 * chamado está aberto · o arquivo não subiu · como resolver.
 */
function mensagemDe(
  estado: EstadoAnexoNaCriacao,
  falharam: readonly string[],
): string {
  if (estado === 'anexado' || estado === 'sem_anexo') return ''
  if (estado === 'adiado') {
    return 'Seu chamado entrou na fila e será aberto em instantes. O arquivo não vai junto: quando a chave aparecer aqui, abra o chamado e use "anexar arquivo" — leva um clique.'
  }
  const quais = falharam.join(', ')
  return estado === 'parcial'
    ? `Seu chamado está aberto, mas não consegui anexar ${quais}. Abra o chamado e use "anexar arquivo" para mandar o que faltou.`
    : `Seu chamado está aberto. O anexo (${quais}) não subiu — abra o chamado e use "anexar arquivo" para tentar de novo.`
}

export interface DependenciasAnexo {
  readonly anexosPendentes: RepositorioAnexosPendentes
  readonly atlassian: ClienteAtlassian
  readonly auditoria: Auditoria
  /** T-422 — onde o número durável de anexos fica. */
  readonly outbox: Pick<Outbox, 'registrarAnexosAnexados'>
  /**
   * `RF-31` — opcional: quem monta as dependências à mão (testes, caminhos antigos)
   * continua materializando sem registrar, com o comportamento de antes.
   */
  readonly anexosEnviados?: {
    registrar(dados: {
      issueKey: string
      solicitanteEmail: string
      nomeArquivo: string
      via: 'criacao' | 'chamado'
    }): Promise<void>
  }
}

export async function materializarAnexosDoChamado(
  deps: DependenciasAnexo,
  dados: {
    readonly chaveIdempotencia: string
    readonly solicitanteEmail: string
    /** `null` = criação diferida (outbox), `SC-07b`. */
    readonly issueKey: string | null
  },
): Promise<ResultadoAnexoNaCriacao> {
  const pendentes = await deps.anexosPendentes.listarNaoMaterializados(
    dados.chaveIdempotencia,
    dados.solicitanteEmail,
  )
  if (pendentes.length === 0) return SEM_ANEXO

  if (dados.issueKey === null) {
    // ⚠️ **Não reivindica.** Marcar aqui faria a linha parecer resolvida, e o expurgo a
    // levaria sem que ninguém soubesse que o arquivo nunca subiu. Ela fica pendente e
    // morre no TTL — que é a verdade: o id já terá expirado quando o cron rodar.
    await deps.auditoria.registrar({
      atorEmail: dados.solicitanteEmail,
      acao: 'anexo_enviado',
      recurso: dados.chaveIdempotencia,
      resultado: 'falha',
      detalhe: {
        etapa: 'materializacao',
        motivo: 'criacao_diferida',
        quantidade: pendentes.length,
      },
    })
    const nomes = pendentes.map((p) => p.nomeArquivo)
    return {
      estado: 'adiado',
      anexados: [],
      falharam: nomes,
      mensagem: mensagemDe('adiado', nomes),
    }
  }

  const anexados: string[] = []
  const falharam: string[] = []

  for (const pendente of pendentes) {
    // T-413b — a reivindicação é o lock. Perdeu a corrida: outro clique já materializou
    // esta linha, e anexar de novo colocaria o arquivo duas vezes no chamado.
    const meu = await deps.anexosPendentes.reivindicar(pendente.id, dados.solicitanteEmail)
    if (!meu) continue
    try {
      await deps.atlassian.materializarAnexosTemporarios(dados.issueKey, [
        pendente.temporaryAttachmentId,
      ])
      // `RF-31` — o arquivo entrou no chamado; fica registrado para a pessoa vê-lo
      // depois. `anexos_pendentes` não serve para isso: ela é expurgada em 12 h, e a
      // lista sumiria sozinha meio dia depois de o chamado nascer.
      await deps.anexosEnviados?.registrar({
        issueKey: dados.issueKey,
        solicitanteEmail: dados.solicitanteEmail,
        nomeArquivo: pendente.nomeArquivo,
        via: 'criacao',
      })
      anexados.push(pendente.nomeArquivo)
    } catch {
      // ⚠️ Engolido de propósito, e é a única razão de esta função existir separada: o
      // chamado JÁ nasceu. Deixar subir levaria o erro ao `catch` da rota e a pessoa
      // veria "algo deu errado" tendo o chamado aberto.
      //
      // A mensagem do erro não entra em nada: ela pode carregar corpo de resposta da
      // Atlassian (`RNF-01`, `RNF-30`).
      falharam.push(pendente.nomeArquivo)
    }
  }

  if (anexados.length === 0 && falharam.length === 0) return SEM_ANEXO

  const estado: EstadoAnexoNaCriacao =
    falharam.length === 0 ? 'anexado' : anexados.length === 0 ? 'falhou' : 'parcial'

  // T-422 — o número durável, gravado junto do chamado. Vai **antes** da auditoria de
  // propósito: é dado de produto (o painel de `ScC-7` lê daqui), não registro de acesso.
  await deps.outbox.registrarAnexosAnexados(dados.chaveIdempotencia, anexados.length)

  await deps.auditoria.registrar({
    atorEmail: dados.solicitanteEmail,
    acao: 'anexo_enviado',
    recurso: dados.issueKey,
    resultado: estado === 'anexado' ? 'sucesso' : 'falha',
    // T-416 — o resultado do envio fica registrado **inclusive quando falha**: é a única
    // forma de saber depois se "os chamados chegam sem evidência" é a pergunta que não
    // funciona ou o envio que não funciona.
    detalhe: {
      etapa: 'materializacao',
      estado,
      anexados: anexados.length,
      falharam: falharam.length,
    },
  })

  return { estado, anexados, falharam, mensagem: mensagemDe(estado, falharam) }
}
