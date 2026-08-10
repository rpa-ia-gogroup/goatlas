/**
 * **T-421 / ScC-4** — nenhum `fieldId` de anexo aparece no código.
 *
 * ## O que este teste impede, e por que ele é estrutural
 *
 * O id do campo de anexo é dado **da instalação** (`RNF-25`), não do app. Um
 * `if (campo.fieldId === 'attachment')` funcionaria no site da Gocase e pararia de
 * funcionar em qualquer outro — e o modo de falha é o pior possível: `tipoAceitaAnexo`
 * passaria a devolver `false`, a pergunta de `RF-62` deixaria de aparecer, e **nada
 * quebraria**. Chamados voltariam a chegar sem evidência, exatamente o problema que a
 * spec 005 existe para resolver, sem nenhum erro em lugar nenhum.
 *
 * É o mesmo padrão de `rnf01-vazamento-credenciais` (T-094) e do teste que impede
 * `dangerouslySetInnerHTML` de voltar: quando a regra é "isto não pode aparecer no
 * código", quem a garante é uma varredura, não a revisão.
 *
 * ⚠️ **Duas exceções, as duas justificadas** — e é por elas que o teste varre por
 * literal, não por substring:
 *
 * - `atlassian/cliente.ts` — ali `'attachment'` é o **tipo de schema do JSM**
 *   (`jiraSchema.system`), o dado que diz "este campo é de anexo". É de onde a
 *   informação legitimamente vem.
 * - `confluence/anexo.ts` — ali é o valor de `Content-Disposition`, outro assunto.
 *
 * _Requirements: RNF-25, RF-27, RF-61, RF-62_
 */

import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { camposAdicionais } from '@/lib/atlassian/cliente'
import { exigeDeclaracaoDeAnexo, tipoAceitaAnexo } from '@/lib/tickets/declaracao-anexo'

/** Onde o literal é legítimo, com o motivo no comentário acima. */
const PERMITIDOS = ['src/lib/atlassian/cliente.ts', 'src/lib/confluence/anexo.ts']

function arquivos(dir: string): string[] {
  const saida: string[] = []
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome)
    if (statSync(caminho).isDirectory()) {
      saida.push(...arquivos(caminho))
      continue
    }
    if (/\.(ts|tsx)$/.test(nome)) saida.push(caminho)
  }
  return saida
}

describe('ScC-4 — o app decide por TIPO de campo, nunca por id', () => {
  it('nenhum literal de `fieldId` de anexo fora dos dois lugares justificados', () => {
    // Formas que um id de anexo tomaria: o nome de sistema do JSM e as variações de
    // campo customizado que alguém copiaria de uma resposta real.
    const suspeitos = [
      /['"]attachment['"]/,
      /['"]attachments['"]/,
      /['"]customfield_\d+['"]\s*===?/,
      /fieldId\s*===?\s*['"]/,
      /fieldId\s*!==?\s*['"]/,
    ]
    const encontrados: string[] = []
    for (const caminho of arquivos('src')) {
      const relativo = caminho.replace(/\\/g, '/')
      if (PERMITIDOS.includes(relativo)) continue
      const conteudo = readFileSync(caminho, 'utf8')
      for (const padrao of suspeitos) {
        if (padrao.test(conteudo)) encontrados.push(`${relativo} :: ${padrao}`)
      }
    }
    expect(encontrados).toEqual([])
  })

  it('a decisão é o TIPO: o mesmo campo com id arbitrário continua sendo anexo', () => {
    const comIdEstranho = [
      { fieldId: 'zzz-9999', rotulo: 'Arquivos', obrigatorio: false, tipo: 'anexo' as const, opcoes: [] },
    ]
    expect(tipoAceitaAnexo(comIdEstranho)).toBe(true)
    expect(exigeDeclaracaoDeAnexo({ conhecido: true, campos: comIdEstranho })).toBe(true)
  })

  it('e um campo de TEXTO chamado "attachment" NÃO conta como anexo', () => {
    // O oposto do bug: reconhecer pelo nome pegaria este e ofereceria um seletor de
    // arquivo para um campo que só aceita string.
    const armadilha = [
      { fieldId: 'attachment', rotulo: 'Anexo', obrigatorio: false, tipo: 'texto' as const, opcoes: [] },
    ]
    expect(tipoAceitaAnexo(armadilha)).toBe(false)
  })

  it('quem traduz o schema do JSM em `anexo` é o cliente, pelo `jiraSchema`', () => {
    // Prova que a informação existe e vem do lugar certo — é o que torna as duas
    // exceções da varredura legítimas em vez de convenientes.
    const [campo] = camposAdicionais([
      { fieldId: 'customfield_777', name: 'Evidência', jiraSchema: { system: 'attachment' } },
    ])
    expect(campo?.tipo).toBe('anexo')
    expect(campo?.fieldId).toBe('customfield_777')
  })
})
