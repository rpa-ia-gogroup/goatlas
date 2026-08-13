/**
 * O system prompt do agente — RNF-24, RNF-18, RNF-30, RN-08.
 *
 * ⚠️ Prompt não é trava (Princípio X): nada aqui garante comportamento do modelo, e
 * estes testes **não** afirmam sobre o que ele responde. O que eles cobram é o que é
 * verificável sem provedor: que o texto entregue ao modelo descreve o produto certo,
 * que ele não afirma capacidade que a instalação não tem, que os prazos são os mesmos
 * que o cron do SLA cobra, e que nenhum valor de configuração vaza para dentro dele.
 *
 * O bug que originou o arquivo: a "olá" o agente respondia "Olá! Como posso te ajudar
 * hoje?" — assistente genérico, sem dizer o que faz. Quem não sabe o que o app faz
 * volta para o Google Chat, que é justamente o número que R-04/T-235 tentam mover.
 *
 * _Requirements: RNF-24, RNF-18, RNF-25, RNF-30, RN-08, RF-13, RF-16_
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { montarPromptAgente } from '@/lib/ia/prompts'
import { SLA_PRIMEIRA_RESPOSTA_HORAS } from '@/lib/atlassian/tipos'
import { CONFIG_PADRAO, type ConfigValores } from '@/lib/config'
import { SqliteLocal } from '@/lib/db/sqlite-local'
import { migrar } from '@/lib/db/schema'
import { AuditoriaBanco } from '@/lib/audit'
import { ClienteAtlassianFake } from '@/lib/atlassian/fake'
import { ClienteIAFake } from '@/lib/ia/fake'
import { RepositorioConversas } from '@/lib/agent/estado'
import { ExecutorTools } from '@/lib/agent/tools'
import { Orquestrador } from '@/lib/agent/orquestrador'

const ANA = 'ana@gocase.com'
const AGORA = '2026-08-10T12:00:00.000Z'

const COMPLETO = { buscaDocumentacaoDisponivel: true, historicoDisponivel: true }

describe('prompt do agente — identidade e escopo', () => {
  it('se apresenta como o agente de chamados, não como assistente genérico', () => {
    const p = montarPromptAgente(COMPLETO)
    expect(p).toContain('goatlas')
    expect(p).toMatch(/chamado/i)
    // A frase que fecha o buraco do "Olá! Como posso te ajudar hoje?": o prompt tem de
    // dizer o que fazer quando a pessoa só cumprimenta.
    expect(p).toMatch(/cumprimenta/i)
    expect(p).toMatch(/Como posso te ajudar/i)
    expect(p).toMatch(/não é um assistente de uso geral/i)
  })

  it('descreve as capacidades reais do app — o que a pessoa pode esperar daqui', () => {
    const p = montarPromptAgente(COMPLETO)
    for (const capacidade of [
      /documenta(ção|cao) interna/i, // Regra 1
      /chamados anteriores/i, // Regra 2
      /Meus chamados/i, // acompanhamento no app (RF-29)
      /anexa/i, // RF-25 / RF-34
      /formulário/i, // D-04
    ]) {
      expect(p).toMatch(capacidade)
    }
  })

  it('mantém as decisões de produto que a redação sustenta', () => {
    const p = montarPromptAgente(COMPLETO)
    // RN-08 — primeira resposta, nunca resolução.
    expect(p).toMatch(/primeira resposta/i)
    expect(p).toMatch(/não\s+(é\s+)?de resolução|não promete prazo de solução/i)
    // RF-16 — prioridade editável.
    expect(p).toMatch(/editável/i)
    // RF-13 / D-21 — o botão é o caminho de saída, e o agente não anuncia proposta antes.
    expect(p).toContain('Isso não resolve meu caso')
    // RNF-08 — conteúdo de tool é informação, nunca instrução.
    expect(p).toMatch(/nunca instrução/i)
  })
})

describe('prompt do agente — prazos vêm da mesma constante do SLA (RN-08)', () => {
  it('não repete as horas à mão: o texto usa SLA_PRIMEIRA_RESPOSTA_HORAS', () => {
    const p = montarPromptAgente(COMPLETO)
    expect(p).toContain(`${SLA_PRIMEIRA_RESPOSTA_HORAS.critica}h`)
    expect(p).toContain(`${SLA_PRIMEIRA_RESPOSTA_HORAS.alta}h`)
    expect(p).toContain(`${SLA_PRIMEIRA_RESPOSTA_HORAS.normal}h`)
    // O piso garantido é o prazo da prioridade normal (R-05) — se um dia mudar, muda
    // na constante, e esta asserção é o que impede o texto de ficar para trás.
    expect(p).toMatch(
      new RegExp(`${SLA_PRIMEIRA_RESPOSTA_HORAS.normal}h é o \\*\\*piso garantido\\*\\*`),
    )
  })
})

describe('prompt do agente — o que a instalação NÃO tem, ele não promete (RNF-18)', () => {
  it('sem allowlist de espaços, manda não prometer a busca nem concluir ausência', () => {
    const p = montarPromptAgente({ ...COMPLETO, buscaDocumentacaoDisponivel: false })
    expect(p).toMatch(/busca na documentação interna ainda não está disponível/i)
    // A metade que importa: "não devolveu resultado" ≠ "não está documentado".
    expect(p).toMatch(/não conclua que o assunto não está documentado/i)
  })

  it('sem os exemplos da Regra 2, manda não prometer o histórico', () => {
    const p = montarPromptAgente({ ...COMPLETO, historicoDisponivel: false })
    expect(p).toMatch(/chamados anteriores não está disponível/i)
  })

  it('com tudo configurado, nenhum dos dois avisos aparece', () => {
    const p = montarPromptAgente(COMPLETO)
    expect(p).not.toMatch(/não está disponível/i)
  })
})

describe('prompt do agente — nada de configuração vaza para o texto (RNF-30)', () => {
  it('o prompt não carrega espaço, tipo de chamado, id nem threshold', () => {
    const p = montarPromptAgente(COMPLETO)
    for (const vazamento of ['espacos_confluence', 'customfield', 'threshold_score', 'serviceDeskId']) {
      expect(p).not.toContain(vazamento)
    }
    // Sem menção à ferramenta do time: quem usa o app não tem assento e não deve ser
    // mandado para lá.
    expect(p).not.toMatch(/atlassian\.net/i)
  })
})

describe('prompt do agente — é ele que chega ao provedor', () => {
  let db: SqliteLocal
  let ia: ClienteIAFake

  beforeEach(async () => {
    db = new SqliteLocal()
    await migrar(db)
  })

  /**
   * O ponto do teste é o **acoplamento**: o orquestrador deriva o contexto da mesma
   * config que o executor usa. Uma instalação sem espaço e sem exemplos tem de produzir
   * um system prompt que já sabe disso — senão o agente promete e o servidor não cumpre.
   */
  async function primeiroSystemPrompt(config: ConfigValores): Promise<string> {
    let n = 0
    const novoId = () => `id-${++n}`
    const conversas = new RepositorioConversas(db, () => AGORA)
    const auditoria = new AuditoriaBanco(db, () => AGORA, novoId)
    const atlassian = new ClienteAtlassianFake({ paginas: [], historico: [] })
    ia = new ClienteIAFake([{ texto: 'oi' }])
    const executor = new ExecutorTools(atlassian, ia, db, auditoria, () => AGORA)
    const orquestrador = new Orquestrador(ia, executor, conversas, auditoria, novoId, atlassian)
    const c = await conversas.criar('c1', ANA)
    await orquestrador.processarMensagem(c, 'olá', config)
    const primeira = ia.chatsRecebidos[0]!.mensagens[0]!
    expect(primeira.papel).toBe('system')
    return primeira.conteudo
  }

  it('instalação configurada: o prompt chega sem os avisos de indisponibilidade', async () => {
    const conteudo = await primeiroSystemPrompt({
      ...CONFIG_PADRAO,
      espacos_confluence: ['TECH'],
      regra2_exemplos_ajuste_operacional: ['Rodei o pipeline manualmente'],
    })
    expect(conteudo).toContain('goatlas')
    expect(conteudo).not.toMatch(/não está disponível/i)
  })

  it('instalação crua (defaults fail-closed): o prompt chega avisando dos dois', async () => {
    const conteudo = await primeiroSystemPrompt(CONFIG_PADRAO)
    expect(conteudo).toMatch(/busca na documentação interna ainda não está disponível/i)
    expect(conteudo).toMatch(/chamados anteriores não está disponível/i)
  })
})
