/**
 * Implementações de `Canal` — T-221 (fake), T-222 (Google Chat), T-223 (e-mail).
 *
 * ## O que está resolvido e o que depende de Q11
 *
 * O **transporte** dos dois canais está escrito e testado contra `fetch` simulado: URL
 * montada, corpo no formato do provedor, erro classificado como transitório ou
 * definitivo. O que **Q11** decide é outra coisa — *qual* canal a empresa usa, para
 * qual espaço do Chat, e por qual provedor de e-mail. Isso é configuração
 * (`ConfigValores`), não código, exatamente para que a resposta de Q11 não vire deploy.
 *
 * ⚠️ **Sem destino configurado, o canal se declara indisponível** em vez de fingir
 * envio. Um canal que devolve `ok` sem mandar nada é o pior resultado possível: a fila
 * esvazia, a métrica diz "enviadas", e ninguém recebeu nada.
 */

import { ErroCanal, type Canal, type Mensagem, type NomeCanal } from './tipos'

/** Texto plano da mensagem — o `**negrito**` do markdown sobrevive no Chat e é ruído
 * em e-mail plano, então cada canal decide. */
function textoPlano(m: Mensagem): string {
  const corpo = m.corpo.replace(/\*\*/g, '')
  return m.link ? `${corpo}\n\n${m.link}` : corpo
}

/**
 * Canal de teste e de demonstração (T-221).
 *
 * Guarda o que foi "enviado" em memória e tem falha injetável por chamada — é o que
 * permite testar retry, dedupe e supressão sem provedor nenhum, do mesmo jeito que
 * `ClienteAtlassianFake` sustenta a Fase 1.
 */
export class CanalFake implements Canal {
  readonly nome: NomeCanal
  readonly enviadas: { destino: string; mensagem: Mensagem }[] = []
  /** `'nenhum'` entrega; qualquer outro valor lança com aquela classificação. */
  falha: 'nenhum' | 'transitorio' | 'definitivo' = 'nenhum'

  constructor(nome: NomeCanal = 'chat') {
    this.nome = nome
  }

  async enviar(destino: string, mensagem: Mensagem): Promise<void> {
    if (this.falha !== 'nenhum') {
      throw new ErroCanal(`canal fake: ${this.falha}`, {
        transitorio: this.falha === 'transitorio',
      })
    }
    this.enviadas.push({ destino, mensagem })
  }

  async verificarSaude(): Promise<{ ok: boolean; detalhe: string }> {
    return { ok: this.falha === 'nenhum', detalhe: 'canal fake' }
  }
}

export interface OpcoesCanalHttp {
  /** Endpoint do provedor. `null` = não configurado (Q11) — o canal recusa e diz. */
  readonly endpoint: string | null
  readonly fetchImpl?: typeof fetch
}

/**
 * Google Chat (T-222).
 *
 * Entrega por **webhook de espaço**: é o caminho que não exige o app ter identidade no
 * Workspace de cada pessoa, o que casa com o desenho do atlas (o app não é o
 * usuário). O `destino` é o webhook do espaço, e ele vem de **config de admin**, nunca
 * do usuário final — ver `validarPreferencia`.
 */
export class CanalGoogleChat implements Canal {
  readonly nome: NomeCanal = 'chat'
  private readonly fetchImpl: typeof fetch

  constructor(private readonly opcoes: OpcoesCanalHttp) {
    // ⚠️ **`fetch` PRECISA vir com `this` amarrado ao global.** Guardado numa propriedade e
    // chamado como `this.fetchImpl(...)`, o `this` passa a ser este objeto, e o runtime dos
    // Workers recusa com `Illegal invocation` — a chamada nem sai. No Node dos testes
    // funciona, porque lá o `fetch` não confere o `this`: por isso 643 testes verdes
    // conviviam com um cliente que não conseguia fazer uma única requisição em produção.
    // Descoberto em 07/08/2026, no instante em que o modo demonstração saiu.
    this.fetchImpl = opcoes.fetchImpl ?? fetch.bind(globalThis)
  }

  async enviar(destino: string, mensagem: Mensagem): Promise<void> {
    const url = destino || this.opcoes.endpoint
    if (!url) {
      // Não configurado é DEFINITIVO: retentar 4 vezes contra uma configuração que
      // não existe só enche a fila de tentativas.
      throw new ErroCanal('canal de chat sem destino configurado', { transitorio: false })
    }
    const resposta = await this.fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: `*${mensagem.titulo}*\n${textoPlano(mensagem)}` }),
    })
    if (!resposta.ok) {
      // ⚠️ Nunca inclui o corpo da resposta na mensagem (RNF-01, RNF-30) — ela sobe
      // até o log e pode carregar o webhook inteiro.
      throw new ErroCanal(`canal de chat respondeu ${resposta.status}`, {
        transitorio: resposta.status === 429 || resposta.status >= 500,
        status: resposta.status,
      })
    }
  }

  async verificarSaude(): Promise<{ ok: boolean; detalhe: string }> {
    return this.opcoes.endpoint
      ? { ok: true, detalhe: 'webhook de espaço configurado' }
      : { ok: false, detalhe: 'sem webhook configurado (Q11)' }
  }
}

/**
 * E-mail (T-223).
 *
 * Provedor por HTTP, não SMTP: o Worker não tem TCP puro (restrição dura da
 * plataforma). O formato do corpo é o mais comum entre provedores transacionais
 * (`to`/`subject`/`text`); um provedor com outro formato troca **esta classe**, e nada
 * acima muda — é para isso que a camada existe.
 */
export class CanalEmail implements Canal {
  readonly nome: NomeCanal = 'email'
  private readonly fetchImpl: typeof fetch

  constructor(
    private readonly opcoes: OpcoesCanalHttp & {
      readonly remetente?: string
      readonly apiKey?: string | null
    },
  ) {
    // Ver o aviso acima: `fetch` sem `bind` dá `Illegal invocation` no Worker.
    this.fetchImpl = opcoes.fetchImpl ?? fetch.bind(globalThis)
  }

  async enviar(destino: string, mensagem: Mensagem): Promise<void> {
    if (!this.opcoes.endpoint) {
      throw new ErroCanal('canal de e-mail sem provedor configurado', { transitorio: false })
    }
    if (!destino) {
      throw new ErroCanal('canal de e-mail sem destinatário', { transitorio: false })
    }
    const resposta = await this.fetchImpl(this.opcoes.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.opcoes.apiKey ? { Authorization: `Bearer ${this.opcoes.apiKey}` } : {}),
      },
      body: JSON.stringify({
        from: this.opcoes.remetente ?? 'atlas@gocase.com',
        to: destino,
        subject: mensagem.titulo,
        text: textoPlano(mensagem),
      }),
    })
    if (!resposta.ok) {
      throw new ErroCanal(`provedor de e-mail respondeu ${resposta.status}`, {
        transitorio: resposta.status === 429 || resposta.status >= 500,
        status: resposta.status,
      })
    }
  }

  async verificarSaude(): Promise<{ ok: boolean; detalhe: string }> {
    return this.opcoes.endpoint
      ? { ok: true, detalhe: 'provedor configurado' }
      : { ok: false, detalhe: 'sem provedor configurado (Q11)' }
  }
}

/**
 * Canal que recusa tudo — o estado "Q11 não respondida".
 *
 * Existe para o mesmo motivo de `ClienteIAIndisponivel` (T-132): ausência de
 * configuração **nega e denuncia**, nunca simula. Se o lugar de `nenhum` fosse um
 * `CanalFake`, a fila esvaziaria em produção com ninguém recebendo nada.
 */
export class CanalIndisponivel implements Canal {
  readonly nome: NomeCanal = 'nenhum'

  async enviar(): Promise<void> {
    throw new ErroCanal('nenhum canal de notificação configurado (Q11)', {
      transitorio: false,
    })
  }

  async verificarSaude(): Promise<{ ok: boolean; detalhe: string }> {
    return { ok: false, detalhe: 'nenhum canal configurado (Q11 em aberto)' }
  }
}
