/**
 * Cliente do **OCR Worker** — PDF (bytes) → texto. Transporte próprio (`RNF-04`).
 *
 * ## O worker não é novo, e isso é o principal argumento a favor dele
 *
 * `POST <url>` com `Content-Type: application/pdf`, `Authorization: Bearer <token>` e os bytes
 * crus; resposta `200 {text?|content?}`. Ele faz **camada de texto e OCR de escaneado num
 * passo só**, roda em produção no godocs, e o contrato está exercitado em
 * `analise-notas-fiscais/src/extract/ocr-worker.ts` — que chegou nele **abandonando** OCR
 * local (pdf-parse + pdfjs + Tesseract). Aqui OCR local nem é opção: a plataforma não tem
 * binário nativo.
 *
 * ## As três armadilhas deste projeto, fechadas por construção
 *
 * 🚨 **1. `fetch` guardado SEM `bind`** (`D-50`). Guardar o global numa propriedade e chamá-lo
 * como método passa o **cliente** como receptor; o runtime dos Workers recusa com
 * `TypeError: Illegal invocation` **antes de abrir conexão**. No Node dos testes o receptor
 * não é conferido, então isto é invisível para teste de comportamento — foram 643 testes
 * verdes na primeira vez e 1181 na segunda. A varredura de `src/` em
 * `tests/rf19-area-teamguide.test.ts` alcança este arquivo.
 *
 * 🚨 **2. Credencial com espaço ou `\n` na ponta** (`D-50`). O secret é colado à mão no console
 * do GoDeploy, e a falha resultante tem a **mesma assinatura** do item 1 — o que torna as duas
 * causas indistinguíveis se ninguém as separar. Quem apara e verifica é
 * `prepararCredencialDeCabecalho`, o **mesmo** módulo da TeamGuide: uma segunda implementação
 * divergiria na primeira correção.
 *
 * 🚨 **3. Timeout decidido por `e.name`** (`D-40`). `AbortError` só aparece quando o aborto
 * acontece **antes** da resposta; com os cabeçalhos já recebidos, abortar derruba a leitura do
 * corpo e o runtime lança erro genérico de rede. Ou seja: o nosso próprio timeout se
 * apresentaria como `erro_de_rede`, e a hipótese mais provável (PDF grande demais) seria a
 * única que o registro nunca poderia acusar. Quem responde é `controle.signal.aborted`.
 *
 * ## O que este arquivo NÃO faz
 *
 * Não cacheia. Cada arquivo é único, e cachear seria guardar conteúdo pessoal na memória do
 * isolate — o oposto do que a spec 007 promete (§Non-Goals). Não decide se o texto é
 * relevante: isso é do analisador. E **não lança**: falha vem no retorno, porque quem chama
 * está no meio de um upload que não pode cair por causa de leitura (`RNF-18`, `FR-8`).
 *
 * _Requirements: FR-6, FR-7, FR-8, RNF-01, RNF-04, RNF-18, RNF-30_
 */

import { prepararCredencialDeCabecalho } from '../credencial-de-cabecalho'
import type { FaseOcr, LeitorPdf, ResultadoOcr } from './contrato'

/** Teto de cada pedaço de `classe` — é o que a torna rótulo por construção (`RNF-30`). */
const TETO_ROTULO = 24

export interface OpcoesOcr {
  readonly url: string
  readonly token: string
  readonly timeoutMs: number
  readonly fetchImpl?: typeof fetch
}

export function criarLeitorPdf(opcoes: OpcoesOcr): LeitorPdf {
  // 🚨 `fetch.bind(globalThis)` — ver o item 1 do cabeçalho. Sem isto o cliente não faz uma
  // única requisição em produção, e nenhum teste de comportamento percebe.
  const fetchImpl = opcoes.fetchImpl ?? fetch.bind(globalThis)
  const credencial = prepararCredencialDeCabecalho(opcoes.token)
  const url = (opcoes.url ?? '').trim()

  return async (bytes) => {
    // Ausência de configuração é ausência: recusa e denuncia, nunca simula (T-132).
    if (!url) return { estado: 'falhou', motivo: 'nao_configurado' }
    if (credencial.invalida) {
      return { estado: 'falhou', motivo: 'credencial_malformada', classe: credencial.invalida }
    }

    const controle = new AbortController()
    const timer = setTimeout(() => controle.abort(), opcoes.timeoutMs)
    try {
      let r: Response
      try {
        r = await fetchImpl(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/pdf',
            Authorization: `Bearer ${credencial.valor}`,
          },
          // Cópia com offset 0: envia exatamente o conteúdo, sem carregar o resto do buffer.
          body: new Uint8Array(bytes),
          signal: controle.signal,
        })
      } catch (e) {
        return daFalhaDeRuntime(e, 'conexao', controle.signal.aborted)
      }

      // ⚠️ O corpo da resposta NUNCA entra no rótulo (`RNF-01`): ele vem de um serviço
      // interno, mas o erro sobe até a auditoria, e "interno" não é "publicável".
      if (!r.ok) return { estado: 'falhou', motivo: `http_${r.status}` }

      let json: unknown
      try {
        json = await r.json()
      } catch (e) {
        // Corpo ilegível pode ser página de erro de gateway (HTML) ou aborto no meio da
        // leitura — a fase distingue as duas para quem for investigar.
        if (controle.signal.aborted) return daFalhaDeRuntime(e, 'corpo', true)
        return { estado: 'falhou', motivo: 'formato_inesperado', fase: 'corpo' }
      }

      const texto = textoDe(json)
      if (texto === null) return { estado: 'falhou', motivo: 'formato_inesperado', fase: 'corpo' }
      // ⚠️ Vazio é `sem_conteudo`, não falha: PDF em branco existe, e "não deu para ler" é a
      // frase oposta a "não tem nada escrito" (`FR-7`).
      return texto.trim() ? { estado: 'lido', texto } : { estado: 'sem_conteudo' }
    } finally {
      clearTimeout(timer)
    }
  }
}

/** `{text}` ou `{content}` — o worker usa os dois nomes. `null` = formato que não reconhecemos. */
function textoDe(json: unknown): string | null {
  if (!json || typeof json !== 'object') return null
  const corpo = json as { text?: unknown; content?: unknown }
  if (typeof corpo.text === 'string') return corpo.text
  if (typeof corpo.content === 'string') return corpo.content
  // Objeto JSON sem nenhum dos dois campos: pode ser um contrato que mudou. `{}` é o caso
  // legítimo de "respondeu, sem texto" e cai aqui — tratado como sem conteúdo por quem chama.
  if (corpo.text === undefined && corpo.content === undefined) return ''
  return null
}

function daFalhaDeRuntime(e: unknown, fase: FaseOcr, abortado: boolean): ResultadoOcr {
  return {
    estado: 'falhou',
    // 🚨 O SINAL decide, não `e.name` — ver o item 3 do cabeçalho.
    motivo: abortado ? 'timeout' : 'erro_de_rede',
    fase,
    classe: classeDe(e),
  }
}

/**
 * O **nome** do erro, saneado — nunca a mensagem (`D-40`, `RNF-30`).
 *
 * Mensagem de terceiro promovida a rótulo é o defeito que o teste `/^[a-z0-9_]+$/` sobre
 * `e.message` produzia na TeamGuide: qualquer frase minúscula passava a parecer um rótulo
 * nosso. Aqui o charset e o teto tornam isso estrutural.
 */
function classeDe(e: unknown): string {
  const pedacos = [
    e?.constructor?.name,
    e instanceof Error ? e.name : undefined,
    e instanceof Error ? (e.cause as { code?: unknown } | undefined)?.code : undefined,
  ]
  const rotulos = pedacos
    .filter((p): p is string => typeof p === 'string' && p.length > 0)
    .map((p) => p.toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, TETO_ROTULO))
  return [...new Set(rotulos)].join('_') || 'desconhecida'
}
