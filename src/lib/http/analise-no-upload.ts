/**
 * A análise do anexo, dentro da requisição de upload — spec 007, `FR-1`, `FR-8`, `FR-10`.
 *
 * ## Por que é um módulo, e não seis linhas na rota
 *
 * Pela mesma razão de `tickets/anexo-na-criacao.ts`: **nada aqui pode lançar**. A rota já
 * mandou o arquivo para a Atlassian e já respondeu `sucesso` na auditoria; uma exceção subindo
 * daqui transformaria "arquivo enviado, leitura falhou" em "arquivo perdido" — a inversão que
 * `RNF-18` proíbe. Separado, a garantia é lida de uma vez.
 *
 * ## A ordem é a trava
 *
 * `abrir` (estado `analisando`) **antes** da chamada de rede. Uma linha que só aparecesse
 * depois faria a rota da mensagem concluir "nada pendente" e responder sem o arquivo — o
 * defeito que a feature existe para consertar, na versão silenciosa.
 *
 * `abrir` devolvendo `false` significa "outra requisição já está com este arquivo" (`FR-2`):
 * aqui isso é **retorno**, não erro, e ninguém paga a chamada duas vezes.
 *
 * _Requirements: FR-1, FR-2, FR-8, FR-10, RNF-01, RNF-18_
 */

import { analisarAnexo } from '../agent/analise-de-anexo'
import { acaoDeAuditoriaDaAnalise } from '../tickets/analises-anexo'
import { MAX_ANEXOS_POR_CHAMADO } from '../tickets/anexos-pendentes'
import type { Contexto } from '../contexto'

export async function analisarAnexoDaConversa(
  ctx: Contexto,
  arquivo: {
    readonly conversaId: string
    readonly solicitanteEmail: string
    readonly nome: string
    readonly tipo: string | null
    readonly bytes: Uint8Array
  },
): Promise<void> {
  try {
    // ⚠️ O teto vem de `MAX_ANEXOS_POR_CHAMADO`, importado (achado `F5`): um `3` escrito aqui
    // divergiria em silêncio no dia em que o teto mudasse. É ele que limita o gasto da
    // feature — `FR-5c` decidiu que a análise **não** consome o teto de custo da conversa.
    const jaAnalisados = await ctx.analisesAnexo.contarDaConversa(arquivo.conversaId)
    if (jaAnalisados >= MAX_ANEXOS_POR_CHAMADO) return

    const abriu = await ctx.analisesAnexo.abrir({
      id: ctx.novoId(),
      conversaId: arquivo.conversaId,
      solicitanteEmail: arquivo.solicitanteEmail,
      nomeArquivo: arquivo.nome,
    })
    if (!abriu) return

    const r = await analisarAnexo(
      { nome: arquivo.nome, tipoDeclarado: arquivo.tipo, bytes: arquivo.bytes },
      { ia: ctx.ia, lerPdf: ctx.lerPdf },
    )

    await ctx.analisesAnexo.concluir({
      conversaId: arquivo.conversaId,
      nomeArquivo: arquivo.nome,
      estado: r.estado,
      descricao: r.descricao,
      custoUsd: r.custoUsd,
    })

    await ctx.auditoria.registrar({
      atorEmail: arquivo.solicitanteEmail,
      // Três ações, derivadas dos seis estados por uma função só (achado `F3`).
      acao: acaoDeAuditoriaDaAnalise(r.estado),
      recurso: arquivo.conversaId,
      resultado: r.estado === 'falhou' ? 'falha' : 'sucesso',
      // ⚠️ **O conteúdo do arquivo NÃO entra na auditoria**, nem a descrição: o admin lê esta
      // tabela, e o arquivo é conteúdo pessoal de quem o enviou (`RNF-01`, `RNF-30`, e o mesmo
      // raciocínio que mantém o nome do arquivo fora do registro em `anexo_servido`).
      detalhe: { estado: r.estado },
    })
  } catch {
    // O arquivo **está** anexado; o que falhou foi a leitura. A linha pode ficar em
    // `analisando`, e a espera do turno a trata como não lida (`FR-7`).
  }
}
