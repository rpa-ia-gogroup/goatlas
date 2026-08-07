/**
 * Autenticação do cron — o header é **assinado**, não é a chave crua.
 *
 * ## O bug que motivou este arquivo
 *
 * As sete rotas de cron devolviam **403 com a chave corretamente configurada**. A
 * verificação era `enviado !== esperado`, e a plataforma não manda a chave: manda
 * `t=<unix>;<rótulo>=<hmac-sha256-hex>`. O sintoma era indistinguível de "esqueci de
 * configurar o secret", e nenhum teste pegava porque todos passavam a chave crua no header
 * — o teste reproduzia a suposição errada, não a plataforma.
 *
 * Formato medido no app real em 07/08/2026 por um diagnóstico que registrava só a
 * estrutura (separadores, tamanho e conjunto de caracteres por segmento), nunca o valor:
 * `separadores "=;="`, segmentos `[1 base64url][10 dígitos][3 base64url][64 hex]`.
 *
 * _Requirements: RNF-05, RNF-07_
 */

import { describe, expect, it } from 'vitest'
import {
  hexConfere,
  JANELA_CRON_SEG,
  lerAssinaturaCron,
  mensagensCandidatas,
  verificarCron,
} from '@/lib/http/cron-auth'

const CHAVE = 'a'.repeat(64)
const AGORA_MS = Date.parse('2026-08-07T03:00:00.000Z')
const CARIMBO = Math.floor(AGORA_MS / 1000)

/** Assina como a plataforma assina, para o teste não depender da suposição. */
async function assinar(mensagem: string, chave = CHAVE): Promise<string> {
  const codificador = new TextEncoder()
  const material = await crypto.subtle.importKey(
    'raw',
    codificador.encode(chave),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const bytes = await crypto.subtle.sign('HMAC', material, codificador.encode(mensagem))
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

const base = {
  chave: CHAVE,
  metodo: 'POST',
  caminho: '/api/cron/polling-jira',
  corpo: '',
  agoraMs: AGORA_MS,
}

describe('lerAssinaturaCron — o formato medido na plataforma', () => {
  it('lê `t=<unix>;sig=<hex64>`', () => {
    const r = lerAssinaturaCron(`t=${CARIMBO};sig=${'b'.repeat(64)}`)
    expect(r?.carimboSeg).toBe(CARIMBO)
    expect(r?.assinaturaHex).toBe('b'.repeat(64))
  })

  it('não fixa o RÓTULO da assinatura — é detalhe da plataforma', () => {
    // `sig`, `v1`, `mac`: mudar o nome do campo não deveria derrubar o cron.
    for (const rotulo of ['sig', 'v1', 'mac', 'hmac']) {
      expect(lerAssinaturaCron(`t=${CARIMBO};${rotulo}=${'c'.repeat(64)}`)?.assinaturaHex).toBe(
        'c'.repeat(64),
      )
    }
  })

  it('aceita ordem invertida e campo extra desconhecido', () => {
    const r = lerAssinaturaCron(`v=2;sig=${'d'.repeat(64)};t=${CARIMBO}`)
    expect(r?.carimboSeg).toBe(CARIMBO)
  })

  it('sem carimbo ou sem assinatura, `null` — não há o que verificar', () => {
    expect(lerAssinaturaCron(`sig=${'e'.repeat(64)}`)).toBeNull()
    expect(lerAssinaturaCron(`t=${CARIMBO}`)).toBeNull()
    expect(lerAssinaturaCron('lixo')).toBeNull()
    // Hex curto não é assinatura de SHA-256.
    expect(lerAssinaturaCron(`t=${CARIMBO};sig=abc`)).toBeNull()
  })
})

describe('verificarCron — o caminho felizes e os cinco degraus de recusa', () => {
  it('assinatura válida passa, e diz QUAL combinação casou', async () => {
    const header = `t=${CARIMBO};sig=${await assinar(`${CARIMBO}.`)}`
    const r = await verificarCron({ ...base, headerEnviado: header })
    expect(r.ok).toBe(true)
    // O rótulo é composto — `<leitura da chave>/<construção da mensagem>` — porque as duas
    // dimensões são desconhecidas e é a combinação que precisa ser confirmada em log.
    if (r.ok) expect(r.candidata).toBe('ascii/t.corpo')
  })

  it('a chave HEX-DECODIFICADA também é aceita — 64 hex são 32 bytes', async () => {
    // ⚠️ `HMAC(chave_ascii)` ≠ `HMAC(bytes)`: são segredos diferentes. Quem gera a chave
    // como 32 bytes e a imprime em hex assina com os bytes; quem a trata como senha assina
    // com o texto. De fora não há como saber qual, e errar dá 403 idêntico a "sem chave".
    const bytes = new Uint8Array(32).fill(0xab)
    const material = await crypto.subtle.importKey(
      'raw',
      bytes as unknown as ArrayBuffer,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    )
    const sig = [
      ...new Uint8Array(
        await crypto.subtle.sign('HMAC', material, new TextEncoder().encode(`${CARIMBO}.`)),
      ),
    ]
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')

    const r = await verificarCron({
      ...base,
      chave: 'ab'.repeat(32),
      headerEnviado: `t=${CARIMBO};sig=${sig}`,
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.candidata).toBe('hex/t.corpo')
  })

  it('cada candidata da lista é aceita — nenhuma exige a lista inteira estar certa', async () => {
    for (const c of mensagensCandidatas({
      carimboSeg: CARIMBO,
      metodo: base.metodo,
      caminho: base.caminho,
      corpo: base.corpo,
    })) {
      const header = `t=${CARIMBO};sig=${await assinar(c.mensagem)}`
      const r = await verificarCron({ ...base, headerEnviado: header })
      expect(r.ok, `candidata ${c.rotulo}`).toBe(true)
    }
  })

  it('a chave CRUA continua valendo — compatibilidade com outro ambiente', async () => {
    const r = await verificarCron({ ...base, headerEnviado: CHAVE })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.candidata).toBe('chave_crua')
  })

  it('sem chave configurada, recusa (fail-closed) — nem tenta verificar', async () => {
    const header = `t=${CARIMBO};sig=${await assinar(`${CARIMBO}.`)}`
    const r = await verificarCron({ ...base, chave: undefined, headerEnviado: header })
    expect(r).toEqual({ ok: false, motivo: 'chave_ausente' })
  })

  it('sem header, recusa', async () => {
    expect(await verificarCron({ ...base, headerEnviado: null })).toEqual({
      ok: false,
      motivo: 'header_ausente',
    })
  })

  it('formato irreconhecível é distinguido de assinatura errada', async () => {
    // A distinção é diagnóstica e vale a noite que este bug custou: "formato desconhecido"
    // aponta para a plataforma ter mudado o esquema; "assinatura inválida", para chave errada.
    expect(await verificarCron({ ...base, headerEnviado: 'sem-formato' })).toEqual({
      ok: false,
      motivo: 'formato_desconhecido',
    })
  })

  it('assinatura de OUTRA chave não casa — e só passa pela porta da presença', async () => {
    // ⚠️ Esta é a fronteira honesta do desenho atual: enquanto a mensagem assinada pelo
    // gateway for desconhecida, a assinatura errada cai na aceitação por presença. O que
    // impede abuso não é o HMAC aqui, é a ausência de identidade de usuário — e a rota
    // destrutiva, que exige o HMAC de verdade.
    const header = `t=${CARIMBO};sig=${await assinar(`${CARIMBO}.`, 'z'.repeat(64))}`

    const semIdentidade = await verificarCron({ ...base, headerEnviado: header })
    expect(semIdentidade.ok).toBe(true)
    if (semIdentidade.ok) expect(semIdentidade.candidata).toBe('presenca_sem_identidade')

    const comIdentidade = await verificarCron({
      ...base,
      headerEnviado: header,
      identidadeDeUsuario: 'ana@gocase.com',
    })
    expect(comIdentidade.ok).toBe(false)

    const naDestrutiva = await verificarCron({
      ...base,
      caminho: '/api/cron/retencao',
      headerEnviado: header,
    })
    expect(naDestrutiva.ok).toBe(false)
  })

  it('⚠️ carimbo VELHO é recusado, mesmo com assinatura válida', async () => {
    // Sem janela, o carimbo é decoração: uma requisição de cron capturada hoje valeria para
    // sempre. É a única proteção contra replay que este esquema oferece.
    const antigo = CARIMBO - JANELA_CRON_SEG - 60
    const header = `t=${antigo};sig=${await assinar(`${antigo}.`)}`
    expect(await verificarCron({ ...base, headerEnviado: header })).toEqual({
      ok: false,
      motivo: 'carimbo_fora_da_janela',
    })
  })

  it('carimbo do FUTURO também é recusado — relógio adiantado é tão comum quanto atrasado', async () => {
    const futuro = CARIMBO + JANELA_CRON_SEG + 60
    const header = `t=${futuro};sig=${await assinar(`${futuro}.`)}`
    expect(await verificarCron({ ...base, headerEnviado: header })).toEqual({
      ok: false,
      motivo: 'carimbo_fora_da_janela',
    })
  })

  it('dentro da janela, passa', async () => {
    const quase = CARIMBO - (JANELA_CRON_SEG - 10)
    const header = `t=${quase};sig=${await assinar(`${quase}.`)}`
    expect((await verificarCron({ ...base, headerEnviado: header })).ok).toBe(true)
  })

  it('a assinatura é ligada ao CARIMBO — trocar o carimbo invalida o HMAC', async () => {
    // Na rota destrutiva, onde só o HMAC vale, isso é recusa direta.
    const header = `t=${CARIMBO + 1};sig=${await assinar(`${CARIMBO}.`)}`
    const r = await verificarCron({
      ...base,
      caminho: '/api/cron/retencao',
      headerEnviado: header,
    })
    expect(r).toEqual({ ok: false, motivo: 'presenca_insuficiente_para_rota_destrutiva' })
  })
})

describe('hexConfere — tempo constante', () => {
  it('confere igual e recusa diferente', () => {
    expect(hexConfere('abc', 'abc')).toBe(true)
    expect(hexConfere('abc', 'abd')).toBe(false)
  })

  it('recusa por tamanho SEM atalho — prefixo correto não vale nada', () => {
    // Um `===` vazaria, pelo tempo, quanto do hash estava certo — e com um endpoint que
    // aceita chamadas repetidas isso é a assinatura descoberta por tentativa.
    expect(hexConfere('abc', 'abcdef')).toBe(false)
    expect(hexConfere('abcdef', 'abc')).toBe(false)
  })
})

/**
 * Aceitação por PRESENÇA — a solução que os outros apps da plataforma usam, com as três
 * condições que eles não têm.
 *
 * ⚠️ O `godaily` só checa `if (!req.headers.get('x-godeploy-cron')) return 401`. Funciona,
 * e é frágil de um jeito que lá não importa e aqui importa: **qualquer pessoa logada**
 * atravessa o edge e pode forjar o header. No `godaily` o pior caso é reprocessar um lote;
 * aqui, `/api/cron/retencao` apaga dado.
 */
describe('presença do header vale para o idempotente, nunca para o destrutivo', () => {
  const semAssinaturaValida = `t=${CARIMBO};sig=${'f'.repeat(64)}`

  it('rota idempotente passa por presença, quando NÃO há identidade de usuário', async () => {
    const r = await verificarCron({ ...base, headerEnviado: semAssinaturaValida })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.candidata).toBe('presenca_sem_identidade')
  })

  it('⚠️ com identidade de usuário, RECUSA — é o funcionário logado forjando o header', async () => {
    // O edge injeta o e-mail em toda requisição de pessoa; o gateway de cron não injeta.
    // É este bit que separa "a plataforma chamou" de "alguém com sessão chamou".
    const r = await verificarCron({
      ...base,
      headerEnviado: semAssinaturaValida,
      identidadeDeUsuario: 'ana@gocase.com',
    })
    expect(r).toEqual({ ok: false, motivo: 'presenca_com_identidade_de_usuario' })
  })

  it('⚠️ a rota DESTRUTIVA exige assinatura — presença não basta', async () => {
    // Preferir dado apagado por engano a um cron parado seria a troca errada.
    const r = await verificarCron({
      ...base,
      caminho: '/api/cron/retencao',
      headerEnviado: semAssinaturaValida,
    })
    expect(r).toEqual({ ok: false, motivo: 'presenca_insuficiente_para_rota_destrutiva' })
  })

  it('a rota destrutiva PASSA com assinatura válida', async () => {
    const header = `t=${CARIMBO};sig=${await assinar(`${CARIMBO}.`)}`
    const r = await verificarCron({
      ...base,
      caminho: '/api/cron/retencao',
      headerEnviado: header,
    })
    expect(r.ok).toBe(true)
  })

  it('presença NÃO dispensa a janela de tempo nem o formato', async () => {
    const velho = CARIMBO - JANELA_CRON_SEG - 60
    expect(
      (await verificarCron({ ...base, headerEnviado: `t=${velho};sig=${'f'.repeat(64)}` })).ok,
    ).toBe(false)
    expect((await verificarCron({ ...base, headerEnviado: 'qualquer-coisa' })).ok).toBe(false)
  })

  it('e sem chave configurada, nada passa — nem por presença', async () => {
    const r = await verificarCron({
      ...base,
      chave: undefined,
      headerEnviado: semAssinaturaValida,
    })
    expect(r).toEqual({ ok: false, motivo: 'chave_ausente' })
  })
})
