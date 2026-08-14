/**
 * Ler o corpo **sem** pagar o preço de lê-lo — spec 009, `FR-2`.
 *
 * ## O que estes dois gates evitam
 *
 * O caminho mais apertado do app é o upload de anexo: sem disco e sem streaming, o arquivo
 * já passa **duas vezes** pela memória do Worker (`http/anexo-entrada.ts`), e por isso o teto
 * de envio é menor que o de leitura. Um `req.clone().text()` incondicional dobraria isso de
 * novo — e o pior é que só quebraria em produção, com o arquivo grande de alguém.
 *
 * Do outro lado, o proxy de anexo (`D-11`) devolve megabytes binários; clonar a resposta
 * para "ver o corpo" faria o registro carregar a imagem inteira.
 *
 * Por isso: **só JSON, e só abaixo do teto**. Fora disso, guarda-se o que é barato e
 * honesto — tipo e tamanho —, nunca uma versão truncada de bytes binários, que não ajuda
 * ninguém a investigar e ocupa a mesma coluna.
 */

/** Acima disto o corpo não é lido; o tamanho ainda é registrado. */
export const MAX_CORPO_LIDO_BYTES = 64_000

function ehJson(tipo: string | null): boolean {
  if (!tipo) return false
  const t = tipo.toLowerCase()
  return t.includes('application/json') || t.includes('+json')
}

/** O que se sabe de um corpo sem necessariamente tê-lo lido. */
export interface CorpoObservado {
  readonly texto: string | null
  readonly bytes: number | null
}

/**
 * O corpo da **requisição**, lido de um clone.
 *
 * ⚠️ Clonar é obrigatório: quem consome o corpo de verdade é o handler
 * (`lerJson`), e um `Request` só pode ser lido uma vez. Ler aqui sem clonar deixaria toda
 * rota `POST` sem corpo — o modo mais caro possível de descobrir que o registro existe.
 */
export async function corpoDaRequisicao(req: Request): Promise<CorpoObservado> {
  const tipo = req.headers.get('content-type')
  const declarado = Number(req.headers.get('content-length') ?? '')
  const bytes = Number.isFinite(declarado) && declarado >= 0 ? declarado : null

  if (req.method === 'GET' || req.method === 'HEAD') return { texto: null, bytes: null }
  if (!ehJson(tipo)) return { texto: null, bytes }
  if (bytes !== null && bytes > MAX_CORPO_LIDO_BYTES) return { texto: null, bytes }

  try {
    const texto = await req.clone().text()
    // ⚠️ Sem `content-length` (o comum em `fetch` com corpo em stream) o tamanho vem daqui,
    // depois de ler — nunca de um palpite.
    return { texto, bytes: bytes ?? texto.length }
  } catch {
    return { texto: null, bytes }
  }
}

/**
 * O corpo da **resposta**, lido de um clone.
 *
 * ⚠️ O clone é lido inteiro em memória. Por isso o gate de tipo vem primeiro: o proxy de
 * anexo serve `application/octet-stream` e imagem, e nenhum dos dois entra aqui.
 */
export async function corpoDaResposta(r: Response): Promise<CorpoObservado> {
  const tipo = r.headers.get('content-type')
  if (!ehJson(tipo)) {
    const declarado = Number(r.headers.get('content-length') ?? '')
    return { texto: null, bytes: Number.isFinite(declarado) ? declarado : null }
  }
  try {
    const texto = await r.clone().text()
    return { texto, bytes: texto.length }
  } catch {
    return { texto: null, bytes: null }
  }
}
