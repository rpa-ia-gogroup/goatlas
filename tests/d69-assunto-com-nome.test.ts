/**
 * O assunto do chamado é escolhido pelo NOME — `D-69`.
 *
 * ## O que este arquivo existe para reprovar
 *
 * A extração recebia `config.tipos_chamado_permitidos.map((id) => ({ id, nome: id }))`, e o
 * prompt listava `- 92: 92`. O modelo escolhia a fila do chamado **entre números**, sem um
 * único dado que distinguisse um assunto do outro — e nada quebrava: a proposta nascia, o
 * cartão nomeava o tipo escolhido (`D-53`) e a criação respondia 201 na fila errada.
 *
 * Medido no app em 13/08/2026: "meu PC desliga sozinho a cada poucos minutos" saiu como o
 * tipo `92`, *"Problema com Nota Fiscal específica ou grupo de Notas"*.
 *
 * ⚠️ **O teste que vale afirma sobre o que ATRAVESSA a fronteira** — `params.tiposPermitidos`
 * como a camada de IA o recebeu —, nunca sobre a proposta que voltou. Um caso que só olhasse
 * a proposta continuaria verde com `nome: id`, porque o fake devolve o `tipoChamadoId` que
 * ele mesmo guarda (família de `D-47`).
 *
 * _Requirements: RF-15, RF-18, RF-28, RNF-07, RNF-16_
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { SqliteLocal } from '@/lib/db/sqlite-local'
import { migrar } from '@/lib/db/schema'
import { CONFIG_PADRAO, type ConfigValores } from '@/lib/config'
import { AuditoriaBanco } from '@/lib/audit'
import { ClienteAtlassianFake } from '@/lib/atlassian/fake'
import { ClienteIAFake } from '@/lib/ia/fake'
import { RepositorioConversas } from '@/lib/agent/estado'
import { ExecutorTools } from '@/lib/agent/tools'
import { Orquestrador } from '@/lib/agent/orquestrador'
import { montarPromptExtracao, PROMPT_EXTRACAO } from '@/lib/ia/prompts'
import { tiposOferecidos } from '@/lib/tickets/tipos-oferecidos'
import type { TipoChamado } from '@/lib/atlassian/tipos'

const ANA = 'ana@gocase.com'
const AGORA = '2026-08-13T12:00:00.000Z'

/** Os três tipos reais que este arquivo usa — dois do desk configurado, um de outro. */
const GENERICO: TipoChamado = {
  id: '68',
  serviceDeskId: '4',
  nome: 'Outras questões / dúvidas',
  descricao: null,
}
const NOTA_FISCAL: TipoChamado = {
  id: '92',
  serviceDeskId: '4',
  nome: 'Problema com Nota Fiscal específica ou grupo de Notas',
  descricao: null,
}
const DE_OUTRO_DESK: TipoChamado = {
  id: '410',
  serviceDeskId: '9',
  nome: 'Pedido da loja GOSHOP',
  descricao: null,
}

const CONFIG: ConfigValores = {
  ...CONFIG_PADRAO,
  dominios_permitidos: ['gocase.com'],
  service_desk_id: '4',
  tipos_chamado_permitidos: ['68', '92', '410'],
  // As duas verificações se declaram indisponíveis, o que SATISFAZ a ordem de `RF-08`
  // (`RNF-18`) e leva o turno até a extração sem encenar bloqueio.
  espacos_confluence: [],
  regra2_exemplos_ajuste_operacional: [],
}

let db: SqliteLocal
let conversas: RepositorioConversas
let atlassian: ClienteAtlassianFake
let ia: ClienteIAFake
let orquestrador: Orquestrador

function montar(tipos: readonly TipoChamado[]) {
  let n = 0
  const novoId = () => `id-${++n}`
  const auditoria = new AuditoriaBanco(db, () => AGORA, novoId)
  atlassian = new ClienteAtlassianFake({ tiposChamado: [...tipos] })
  // As duas verificações têm de ter sido TENTADAS para a extração rodar (`RF-08`). Com a
  // config acima elas se declaram indisponíveis, o que satisfaz a ordem (`RNF-18`) sem
  // encenar bloqueio — o assunto aqui é a escolha do tipo, não a deflexão.
  ia = new ClienteIAFake([
    {
      texto: 'Vou verificar.',
      toolsPropostas: [
        { nome: 'search_confluence', argumentos: { topico: 'notebook tela azul' } },
        { nome: 'check_jira_history', argumentos: { tipoProblema: 'hardware' } },
      ],
    },
    { texto: 'Entendi, montei o chamado abaixo.' },
  ])
  ia.propostaSugerida = {
    titulo: 'Notebook desliga sozinho a cada poucos minutos',
    descricao: 'O equipamento não permanece ligado por mais de 30 minutos.',
    prioridade: 'alta',
    tipoChamadoId: '68',
    area: null,
  }
  const executor = new ExecutorTools(atlassian, ia, db, auditoria, () => AGORA)
  orquestrador = new Orquestrador(ia, executor, conversas, auditoria, novoId, atlassian)
}

beforeEach(async () => {
  db = new SqliteLocal()
  await migrar(db)
  conversas = new RepositorioConversas(db, () => AGORA)
})

describe('D-69 — a extração escolhe o assunto pelo nome, não por um número', () => {
  it('🚨 cada tipo chega à camada de IA COM NOME — nunca o id no lugar dele', async () => {
    montar([GENERICO, NOTA_FISCAL])
    const c = await conversas.criar('c1', ANA)
    await orquestrador.processarMensagem(c, 'meu PC desliga sozinho a cada poucos minutos', CONFIG)

    expect(ia.extracoesRecebidas).toHaveLength(1)
    const oferecidos = ia.extracoesRecebidas[0]!.tiposPermitidos
    expect(oferecidos).toEqual([
      { id: '68', serviceDeskId: '4', nome: 'Outras questões / dúvidas', descricao: null },
      {
        id: '92',
        serviceDeskId: '4',
        nome: 'Problema com Nota Fiscal específica ou grupo de Notas',
        descricao: null,
      },
    ])
    // A afirmação que reprova a regressão exata: nenhum nome é o próprio id.
    for (const t of oferecidos) expect(t.nome).not.toBe(t.id)
  })

  it('o NOME aparece no texto que o provedor recebe, ao lado do id', () => {
    const texto = montarPromptExtracao({
      mensagens: [{ papel: 'user', conteudo: 'meu notebook reinicia sozinho' }],
      tiposPermitidos: [GENERICO, NOTA_FISCAL],
    })
    expect(texto).toContain('- 68: Outras questões / dúvidas')
    expect(texto).toContain('- 92: Problema com Nota Fiscal específica ou grupo de Notas')
    // `- 92: 92` era a linha que o app mandava de verdade.
    expect(texto).not.toContain('- 92: 92')
  })

  it('a instrução manda escolher o genérico quando nada corresponde — em português', () => {
    expect(PROMPT_EXTRACAO).toContain('genérico')
    expect(PROMPT_EXTRACAO).toContain('Nunca escolha um tipo por eliminação')
  })

  it('tipo de OUTRO service desk não é oferecido, mesmo estando na allowlist', async () => {
    montar([GENERICO, DE_OUTRO_DESK])
    const c = await conversas.criar('c1', ANA)
    await orquestrador.processarMensagem(c, 'meu PC desliga sozinho', CONFIG)

    const ids = ia.extracoesRecebidas[0]!.tiposPermitidos.map((t) => t.id)
    expect(ids).toEqual(['68'])
    // Oferecê-lo produziria proposta aceita por `validarProposta` e recusada só na
    // criação, onde o `serviceDeskId` vem fixo da config.
    expect(ids).not.toContain('410')
  })

  it('🚨 lista de tipos ILEGÍVEL não propõe — e NÃO cai para os ids', async () => {
    montar([GENERICO, NOTA_FISCAL])
    atlassian.estado.falhas.listarTiposChamado = 'indisponivel'
    const c = await conversas.criar('c1', ANA)
    await orquestrador.processarMensagem(c, 'meu PC desliga sozinho', CONFIG)

    // Nem chegou a pedir extração: sem nome não há escolha a fazer.
    expect(ia.extracoesRecebidas).toHaveLength(0)
    expect((await conversas.obter('c1'))?.proposta ?? null).toBeNull()
  })

  it('sem service desk configurado a lista é vazia, e a extração não roda (RNF-16)', async () => {
    montar([GENERICO, NOTA_FISCAL])
    const c = await conversas.criar('c1', ANA)
    await orquestrador.processarMensagem(c, 'meu PC desliga sozinho', {
      ...CONFIG,
      service_desk_id: null,
    })
    expect(ia.extracoesRecebidas).toHaveLength(0)
  })
})

describe('tiposOferecidos — a regra mora num lugar só', () => {
  const fonte = { listarTiposChamado: async () => [GENERICO, NOTA_FISCAL, DE_OUTRO_DESK] }

  it('allowlist vazia expõe ZERO tipos (negação por padrão, RNF-07)', async () => {
    const r = await tiposOferecidos(fonte, {
      tipos_chamado_permitidos: [],
      service_desk_id: '4',
    })
    expect(r).toEqual([])
  })

  it('devolve a interseção de allowlist e service desk', async () => {
    const r = await tiposOferecidos(fonte, {
      tipos_chamado_permitidos: ['68', '410'],
      service_desk_id: '4',
    })
    expect(r.map((t) => t.id)).toEqual(['68'])
  })

  it('id na allowlist que o site NÃO conhece simplesmente não é oferecido', async () => {
    const r = await tiposOferecidos(fonte, {
      tipos_chamado_permitidos: ['68', '999'],
      service_desk_id: '4',
    })
    expect(r.map((t) => t.id)).toEqual(['68'])
  })

  it('LANÇA quando a leitura falha — quem chama decide como degradar', async () => {
    const quebrada = {
      listarTiposChamado: async (): Promise<readonly TipoChamado[]> => {
        throw new Error('indisponível')
      },
    }
    await expect(
      tiposOferecidos(quebrada, { tipos_chamado_permitidos: ['68'], service_desk_id: '4' }),
    ).rejects.toThrow()
  })
})
