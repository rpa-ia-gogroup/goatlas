/**
 * Autenticação do cron da plataforma — `X-Godeploy-Cron`.
 *
 * ## Por que isto não é uma comparação de igualdade
 *
 * A documentação da plataforma diz que ela estampa um header **assinado** e não descreve o
 * formato. A implementação anterior comparava o header com `GODEPLOY_CRON_KEY` por
 * igualdade, e **nunca casava** — todas as sete rotas de cron respondiam 403 com a chave
 * corretamente configurada.
 *
 * O formato foi **medido em 07/08/2026**, no app real, por um diagnóstico que registrava só
 * a *estrutura* do valor (separadores, tamanho e conjunto de caracteres por segmento) e
 * nunca o valor:
 *
 * ```
 * separadores: "=;="
 * segmentos:   [1 base64url] [10 dígitos] [3 base64url] [64 hex-minúsculo]
 * ```
 *
 * Isto é o esquema conhecido `t=<unix>;<rótulo>=<hmac-sha256-hex>`: um carimbo de tempo e
 * um HMAC-SHA256 em hexadecimal, com a chave configurada como segredo.
 *
 * ## O que este módulo garante
 *
 * 1. **HMAC, comparado em tempo constante.** Sem a chave não se forja assinatura, e o
 *    tempo de resposta não vaza quanto do hash estava certo.
 * 2. **Janela de tempo.** Um carimbo é inútil se não for conferido: sem janela, uma
 *    requisição de cron capturada hoje vale para sempre. `JANELA_CRON_SEG` limita o
 *    replay ao que a rede consegue atrasar de verdade.
 * 3. **Fail-closed em cada degrau.** Sem chave, sem header, formato irreconhecível,
 *    carimbo velho ou assinatura errada — todos recusam.
 *
 * ⚠️ **A mensagem assinada não está documentada, então são candidatas.** Cada candidata é
 * um HMAC *com o mesmo segredo*: aceitar mais de uma construção **não** enfraquece a
 * garantia — forjar qualquer uma delas exige a chave. O que a lista evita é o oposto:
 * 403 eterno porque a plataforma concatena `<ts>.<corpo>` e nós supomos `<ts>`. Quando a
 * candidata vencedora for confirmada em log, reduzir a lista a ela é o passo seguinte.
 */

/** Tolerância do carimbo de tempo. Cinco minutos cobre atraso de rede e relógio torto. */
export const JANELA_CRON_SEG = 300

export interface AssinaturaCron {
  readonly carimboSeg: number
  readonly assinaturaHex: string
}

/**
 * Separa `t=<unix>;<rótulo>=<hex>` em carimbo e assinatura.
 *
 * Aceita os campos em qualquer ordem e ignora rótulo desconhecido — o formato é de outra
 * equipe e pode ganhar campo novo. O que **não** se aceita é ausência de carimbo ou de
 * assinatura: sem os dois não há o que verificar.
 */
export function lerAssinaturaCron(bruto: string): AssinaturaCron | null {
  let carimboSeg: number | null = null
  let assinaturaHex: string | null = null

  for (const parte of bruto.split(';')) {
    const [chave, valor] = parte.split('=', 2)
    if (chave === undefined || valor === undefined) continue
    const nome = chave.trim()
    const conteudo = valor.trim()
    if (nome === 't' && /^\d{1,15}$/.test(conteudo)) {
      carimboSeg = Number(conteudo)
      continue
    }
    // Qualquer rótulo com 64 hex é a assinatura. Não se fixa o nome (`sig`, `v1`, `mac`)
    // porque ele é detalhe da plataforma e mudá-lo não deveria derrubar o cron.
    if (/^[0-9a-f]{64}$/.test(conteudo)) assinaturaHex = conteudo
  }

  if (carimboSeg === null || assinaturaHex === null) return null
  return { carimboSeg, assinaturaHex }
}

/**
 * As construções candidatas da mensagem assinada, em ordem de probabilidade.
 *
 * O rótulo viaja junto para que o log diga **qual** casou, sem revelar assinatura nenhuma —
 * é o que permite reduzir esta lista a uma só depois da primeira rodada bem-sucedida.
 */
export function mensagensCandidatas(dados: {
  carimboSeg: number
  metodo: string
  caminho: string
  corpo: string
}): readonly { readonly rotulo: string; readonly mensagem: string }[] {
  const t = String(dados.carimboSeg)
  return [
    { rotulo: 't.corpo', mensagem: `${t}.${dados.corpo}` },
    { rotulo: 't', mensagem: t },
    { rotulo: 't:corpo', mensagem: `${t}:${dados.corpo}` },
    { rotulo: 'corpo', mensagem: dados.corpo },
    { rotulo: 't.caminho', mensagem: `${t}.${dados.caminho}` },
    { rotulo: 't.metodo.caminho', mensagem: `${t}.${dados.metodo}.${dados.caminho}` },
    { rotulo: 't+corpo', mensagem: `${t}${dados.corpo}` },
    { rotulo: 't.metodo caminho', mensagem: `${t}.${dados.metodo} ${dados.caminho}` },
    { rotulo: 'caminho.t', mensagem: `${dados.caminho}.${t}` },
    { rotulo: 't|caminho|corpo', mensagem: `${t}|${dados.caminho}|${dados.corpo}` },
  ]
}

/**
 * As duas leituras possíveis da chave — e por que isso não é paranoia.
 *
 * ⚠️ A chave configurada tem **64 caracteres hexadecimais**, o que são **32 bytes**. E
 * `HMAC(chave_ascii)` ≠ `HMAC(bytes_decodificados)`: são segredos diferentes, e a
 * assinatura sai completamente diferente. Quem gera a chave como 32 bytes aleatórios e a
 * imprime em hex normalmente assina com os **bytes**; quem a trata como senha assina com o
 * texto. Não há como saber de fora qual das duas a plataforma faz.
 *
 * Tentar as duas é o que evita outra rodada de cinco minutos por hipótese. E não afrouxa
 * nada: as duas exigem conhecer a chave.
 */
function chavesCandidatas(chave: string): readonly { readonly rotulo: string; readonly bytes: Uint8Array }[] {
  const comoTexto = { rotulo: 'ascii', bytes: new TextEncoder().encode(chave) }
  if (!/^[0-9a-fA-F]{2,}$/.test(chave) || chave.length % 2 !== 0) return [comoTexto]

  const bytes = new Uint8Array(chave.length / 2)
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(chave.slice(i * 2, i * 2 + 2), 16)
  }
  // Bytes primeiro: é a leitura mais provável para uma chave que É hex.
  return [{ rotulo: 'hex', bytes }, comoTexto]
}

/** Hex de um HMAC-SHA256. `crypto.subtle` é o que existe no runtime dos Workers. */
async function hmacHex(chaveBytes: Uint8Array, mensagem: string): Promise<string> {
  const material = await crypto.subtle.importKey(
    'raw',
    chaveBytes as unknown as ArrayBuffer,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const bytes = await crypto.subtle.sign('HMAC', material, new TextEncoder().encode(mensagem))
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Comparação em **tempo constante** de dois hex.
 *
 * Um `===` aqui vaza, pelo tempo de resposta, quantos caracteres do hash estavam certos —
 * e com um endpoint que aceita chamadas repetidas isso é a assinatura descoberta por
 * tentativa. Mesmo raciocínio de `segredoConfere` no webhook.
 */
export function hexConfere(a: string, b: string): boolean {
  let diferenca = a.length ^ b.length
  const n = Math.max(a.length, b.length)
  for (let i = 0; i < n; i += 1) {
    diferenca |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0)
  }
  return diferenca === 0
}

export type ResultadoCron =
  | { readonly ok: true; readonly candidata: string }
  | {
      readonly ok: false
      readonly motivo:
        | 'chave_ausente'
        | 'header_ausente'
        | 'formato_desconhecido'
        | 'carimbo_fora_da_janela'
        | 'assinatura_invalida'
    }

/**
 * Verifica o header do cron.
 *
 * ⚠️ **A ordem dos degraus importa para o diagnóstico, não para a segurança:** todos
 * recusam. Mas distinguir "chave ausente" de "assinatura inválida" é a diferença entre
 * "esqueci de configurar" e "alguém está tentando", e essa distinção precisa aparecer na
 * auditoria — foi a falta dela que fez este bug custar uma noite.
 *
 * `agoraMs` é injetado para o teste não depender do relógio real, como no resto do projeto.
 */
export async function verificarCron(dados: {
  headerEnviado: string | null
  chave: string | undefined
  metodo: string
  caminho: string
  corpo: string
  agoraMs: number
}): Promise<ResultadoCron> {
  // Fail-closed: sem chave configurada, nada passa. O contrário deixaria a rota aberta
  // justamente na instalação que esqueceu de configurar.
  if (!dados.chave) return { ok: false, motivo: 'chave_ausente' }
  if (dados.headerEnviado === null) return { ok: false, motivo: 'header_ausente' }

  // Compatibilidade: se um dia a plataforma mandar a chave crua (ou outro ambiente o
  // fizer), a igualdade em tempo constante continua valendo.
  if (hexConfere(dados.headerEnviado, dados.chave)) return { ok: true, candidata: 'chave_crua' }

  const assinatura = lerAssinaturaCron(dados.headerEnviado)
  if (!assinatura) return { ok: false, motivo: 'formato_desconhecido' }

  // O carimbo sem janela é decoração. Com ela, uma requisição capturada só vale por
  // `JANELA_CRON_SEG` — e o `Math.abs` cobre relógio adiantado, que é tão comum quanto atrasado.
  const idadeSeg = Math.abs(dados.agoraMs / 1000 - assinatura.carimboSeg)
  if (idadeSeg > JANELA_CRON_SEG) return { ok: false, motivo: 'carimbo_fora_da_janela' }

  const mensagens = mensagensCandidatas({
    carimboSeg: assinatura.carimboSeg,
    metodo: dados.metodo,
    caminho: dados.caminho,
    corpo: dados.corpo,
  })
  for (const chave of chavesCandidatas(dados.chave)) {
    for (const candidata of mensagens) {
      const esperado = await hmacHex(chave.bytes, candidata.mensagem)
      if (hexConfere(esperado, assinatura.assinaturaHex)) {
        // O rótulo composto é o que permite reduzir as duas listas a uma combinação só
        // depois da primeira rodada bem-sucedida.
        return { ok: true, candidata: `${chave.rotulo}/${candidata.rotulo}` }
      }
    }
  }

  return { ok: false, motivo: 'assinatura_invalida' }
}
