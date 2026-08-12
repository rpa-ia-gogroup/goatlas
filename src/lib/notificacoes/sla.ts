/**
 * Prazo de primeira resposta — RF-46, RN-08, T-230. Funções **puras**.
 *
 * ## Três coisas que este arquivo NÃO faz, de propósito
 *
 * 1. **Não é prazo de resolução.** O SLA do goatlas é de **primeira resposta**
 *    (`RN-08`). "Respondido" é o primeiro comentário público de alguém que não é o
 *    solicitante; o chamado pode seguir aberto por semanas depois disso sem violar
 *    nada.
 * 2. **Não conta horário útil.** Conta **hora corrida**, porque é o que o requisito
 *    diz literalmente — 4h/12h/24h por prioridade. Horário comercial seria mudança de
 *    requisito, com decisão de qual calendário, qual fuso por área e o que fazer com
 *    feriado regional; virar isso "por bom senso" aqui faria o número medido deixar de
 *    ser o número prometido. ⚠️ Se um dia mudar, muda **aqui**, e o teste de RF-46 é o
 *    que documenta a escolha.
 * 3. **Não usa fuso local.** Tudo em **UTC**, a partir de milissegundos. O Worker roda
 *    em fuso indefinido, então qualquer aritmética em horário local produziria prazo
 *    diferente por região de execução — e um SLA que muda de valor conforme o servidor
 *    que atendeu é pior que não ter SLA.
 */

import { SLA_PRIMEIRA_RESPOSTA_HORAS, type Prioridade } from '../atlassian/tipos'

const MS_POR_HORA = 3_600_000

export type EstadoSla = 'respondido' | 'ok' | 'risco' | 'estourado'

export interface AvaliacaoSla {
  readonly estado: EstadoSla
  /** Instante-limite em ISO/UTC. */
  readonly prazoEm: string
  /** Horas até o prazo. Negativo quando já passou; `null` quando já respondido. */
  readonly horasRestantes: number | null
  readonly horasDoPrazo: number
}

/** Instante-limite (ms epoch) da primeira resposta. */
export function prazoEmMs(criadoEmMs: number, prioridade: Prioridade): number {
  return criadoEmMs + SLA_PRIMEIRA_RESPOSTA_HORAS[prioridade] * MS_POR_HORA
}

/**
 * Avalia onde o chamado está em relação ao prazo.
 *
 * `fracaoAviso` é o limiar configurável de `RF-46`: `0.75` = avisa quando 75% do prazo
 * passou. Ele existe porque o número certo depende do volume real da fila e só se
 * descobre no piloto (`Fase 4`) — deixá-lo fixo obrigaria deploy para calibrar.
 *
 * Data de criação ilegível devolve `ok`, nunca `estourado`: alerta falso de SLA
 * treina o time a ignorar o alerta, e o dado ruim é problema de leitura, não do
 * chamado de alguém.
 */
export function avaliarSla(dados: {
  criadoEm: string
  prioridade: Prioridade
  /** Primeiro comentário público de OUTRA pessoa, se houve. */
  primeiraRespostaEm: string | null
  agoraMs: number
  fracaoAviso: number
}): AvaliacaoSla {
  const horasDoPrazo = SLA_PRIMEIRA_RESPOSTA_HORAS[dados.prioridade]
  const criadoMs = Date.parse(dados.criadoEm)

  if (!Number.isFinite(criadoMs)) {
    return {
      estado: 'ok',
      prazoEm: new Date(dados.agoraMs + horasDoPrazo * MS_POR_HORA).toISOString(),
      horasRestantes: horasDoPrazo,
      horasDoPrazo,
    }
  }

  const limiteMs = prazoEmMs(criadoMs, dados.prioridade)
  const prazoEm = new Date(limiteMs).toISOString()

  if (dados.primeiraRespostaEm) {
    return { estado: 'respondido', prazoEm, horasRestantes: null, horasDoPrazo }
  }

  const restanteMs = limiteMs - dados.agoraMs
  const horasRestantes = Math.round((restanteMs / MS_POR_HORA) * 10) / 10

  if (restanteMs <= 0) return { estado: 'estourado', prazoEm, horasRestantes, horasDoPrazo }

  const decorrido = 1 - restanteMs / (horasDoPrazo * MS_POR_HORA)
  return {
    estado: decorrido >= dados.fracaoAviso ? 'risco' : 'ok',
    prazoEm,
    horasRestantes,
    horasDoPrazo,
  }
}

/**
 * A primeira resposta **de outra pessoa**, a partir dos comentários públicos.
 *
 * ⚠️ Sob proxy total (`D-01`) o autor da API não distingue ninguém: todo comentário
 * sai da conta de serviço. O que distingue é o prefixo que o próprio app escreve nos
 * comentários do solicitante (`D-13`, `**Nome** (email) via goatlas:`). Comentário
 * **sem** esse prefixo veio do Jira nativo — ou seja, do time de tech.
 *
 * Isso torna a contagem de SLA dependente de um formato que o app controla, o que é
 * frágil de um jeito visível: o teste de `RF-46` casa o prefixo gerado por
 * `atlassian/comentarios.ts` com o reconhecido aqui, para que mudar um lado sem o
 * outro quebre a suíte em vez de inflar a aderência ao SLA silenciosamente.
 */
export function primeiraRespostaDoTime(
  comentarios: readonly { corpo: string; criadoEm: string }[],
  ehDoSolicitante: (corpo: string) => boolean,
  /**
   * `D-56` — o comentário que o JSM cria sozinho para carregar um anexo **nosso**.
   *
   * Ele não tem o prefixo de `D-13` (não passou por `prefixarAutoria`), então caía direto
   * no `!ehDoSolicitante` e satisfazia o SLA: todo chamado com anexo nascia "respondido".
   * O default é `() => false` para que quem monta esta função à mão continue com o
   * comportamento anterior — e para que a decisão de o que é ruído more em
   * `tickets/comentario-de-anexo.ts`, não aqui.
   */
  ehRuidoDeAnexo: (corpo: string) => boolean = () => false,
): string | null {
  const doTime = comentarios
    .filter((c) => !ehDoSolicitante(c.corpo) && !ehRuidoDeAnexo(c.corpo))
    .map((c) => c.criadoEm)
    .filter((c) => Number.isFinite(Date.parse(c)))
    .sort()
  return doTime[0] ?? null
}

/** Aderência ao SLA (RF-55) — proporção respondida dentro do prazo. */
export function aderenciaSla(
  avaliacoes: readonly { estado: EstadoSla; dentroDoPrazo: boolean }[],
): { total: number; dentroDoPrazo: number; taxa: number | null } {
  const respondidas = avaliacoes.filter((a) => a.estado === 'respondido')
  const dentro = respondidas.filter((a) => a.dentroDoPrazo).length
  return {
    total: respondidas.length,
    dentroDoPrazo: dentro,
    // ⚠️ Sem nenhum chamado respondido ainda, a taxa é `null` — nunca `0%`. Mesmo
    // raciocínio de `governanca/metricas.ts` (T-095): "0% de aderência" seria lido
    // como "o time nunca respondeu no prazo" quando ninguém respondeu nada ainda.
    taxa: respondidas.length === 0 ? null : dentro / respondidas.length,
  }
}
