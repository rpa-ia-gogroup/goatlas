/**
 * Validação do anexo que o SOLICITANTE envia — RF-25, RF-34, T-240.
 *
 * ## Este é o caminho oposto ao de `confluence/anexo.ts`, e o risco é outro
 *
 * `confluence/anexo.ts` protege **o navegador de quem lê** um arquivo que veio da
 * Atlassian: lá o problema é `Content-Type` (SVG com script servido do nosso domínio é
 * XSS com a sessão do app). Aqui o arquivo vai na direção contrária — do navegador para
 * o Jira — e os riscos são dois, os dois de recurso:
 *
 * 1. **Memória do Worker.** Não há disco nem streaming: o arquivo inteiro passa pela
 *    memória, duas vezes (recebido e remontado no multipart). Teto pequeno não é
 *    mesquinhez, é o que impede um upload de derrubar o app para todos.
 * 2. **Nome de arquivo.** Ele vai para um cabeçalho de multipart e depois é exibido no
 *    Jira. Barra, `..` e caractere de controle saem — não porque montamos caminho com
 *    ele (não montamos), mas porque `../../etc/passwd` como nome de anexo é o tipo de
 *    coisa que passa por três sistemas até encontrar um que o interprete.
 *
 * ⚠️ **O tipo declarado pelo navegador não é confiança, e aqui isso é aceitável.** O
 * arquivo não será servido por nós: ele vai para o Jira, que aplica a própria política.
 * Uma allowlist de tipos neste ponto recusaria o `.zip` de log que o time de tech pediu
 * — e o app não é antivírus. O que se controla é tamanho e nome.
 */

/**
 * Teto do anexo enviado.
 *
 * Menor que `MAX_ANEXO_BYTES` (12 MB, o teto de leitura) de propósito: leitura passa
 * bytes adiante uma vez, envio os mantém em memória enquanto monta o multipart.
 */
export const MAX_ANEXO_ENVIADO_BYTES = 8 * 1024 * 1024

/** Quantos arquivos por requisição. Cada um custa duas chamadas à Atlassian (R-02). */
export const MAX_ANEXOS_POR_ENVIO = 3

export type ResultadoValidacaoAnexo =
  | { readonly ok: true; readonly nome: string; readonly tipo: string; readonly bytes: ArrayBuffer }
  | { readonly ok: false; readonly mensagem: string }

/** Nome saneado: sem caminho, sem controle, com acento preservado. */
export function sanearNomeArquivo(bruto: string): string {
  const semCaminho = bruto.replace(/^.*[\\/]/, '')
  const limpo = semCaminho
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\.{2,}/g, '.')
    .trim()
  return limpo.length > 0 ? limpo.slice(0, 200) : 'anexo'
}

export async function validarAnexoEnviado(arquivo: unknown): Promise<ResultadoValidacaoAnexo> {
  if (!(arquivo instanceof File)) {
    return { ok: false, mensagem: 'Anexe um arquivo para enviar.' }
  }
  if (arquivo.size === 0) {
    return { ok: false, mensagem: 'O arquivo está vazio.' }
  }
  if (arquivo.size > MAX_ANEXO_ENVIADO_BYTES) {
    const mb = Math.floor(MAX_ANEXO_ENVIADO_BYTES / (1024 * 1024))
    return { ok: false, mensagem: `O arquivo passa de ${mb} MB. Envie um menor ou um link.` }
  }
  return {
    ok: true,
    nome: sanearNomeArquivo(arquivo.name),
    // Navegador que não declara tipo não vira erro: `octet-stream` é o que o próprio
    // HTTP usa para "não sei", e o Jira lida com isso.
    tipo: arquivo.type || 'application/octet-stream',
    bytes: await arquivo.arrayBuffer(),
  }
}
