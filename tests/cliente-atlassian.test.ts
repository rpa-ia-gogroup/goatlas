/**
 * Cliente Atlassian real — as partes que dá para testar sem credencial (Q1).
 *
 * O foco é a **construção de query**, e não por preciosismo: o termo de busca vem
 * do usuário e, pior, pode vir de um tópico que o LLM extraiu de conteúdo
 * recuperado (R-07). Se ele escapar da string, reescreve a cláusula `space in
 * (...)` — que é literalmente a allowlist (RN-06). Injeção de CQL aqui é
 * vazamento de conteúdo restrito.
 *
 * _Requirements: RF-21, RN-06, RNF-07, RNF-25, R-03, R-07_
 */

import { describe, expect, it } from 'vitest'
import {
  ClienteAtlassianHttp,
  escaparCql,
  montarCql,
  montarJql,
} from '@/lib/atlassian/cliente'
import { interpretarClassificacao } from '@/lib/ia/cliente'

const BASE = {
  baseUrl: 'https://goengenharia.atlassian.net',
  email: 'servico@gocase.com',
  apiToken: 'token',
  ttlMetadadosSeg: 900,
  ttlConteudoSeg: 300,
}

describe('RN-06 — injeção de CQL não reescreve a allowlist', () => {
  it('aspas no termo são escapadas', () => {
    expect(escaparCql('a"b')).toBe('a\\"b')
    expect(escaparCql('a\\b')).toBe('a\\\\b')
  })

  it('BURLA — termo que tenta fechar a string e abrir novo espaço', () => {
    const cql = montarCql({
      termo: 'x" OR space = "RH" AND text ~ "salario',
      espacosPermitidos: ['TECH'],
      labelsBloqueadas: [],
      limite: 5,
    })
    // A allowlist tem de continuar sendo exatamente TECH.
    expect(cql).toContain('space in ("TECH")')
    // E nenhuma aspa do usuário pode aparecer sem escape.
    const semEscapadas = cql.replace(/\\"/g, '')
    const aspas = (semEscapadas.match(/"/g) ?? []).length
    // Aspas legítimas: as 2 de "TECH" e as 2 que envolvem o texto = 4.
    expect(aspas).toBe(4)
  })

  it('BURLA — nome de espaço malicioso na allowlist também é escapado', () => {
    const cql = montarCql({
      termo: 'x',
      espacosPermitidos: ['TECH") OR space in ("RH'],
      labelsBloqueadas: [],
      limite: 5,
    })
    expect(cql).not.toMatch(/space in \("TECH"\) OR space in \("RH"\)/)
  })

  it('labels bloqueadas entram como exclusão na própria query', () => {
    const cql = montarCql({
      termo: 'pipeline',
      espacosPermitidos: ['TECH', 'OPS'],
      labelsBloqueadas: ['confidencial', 'rascunho'],
      limite: 5,
    })
    expect(cql).toContain('space in ("TECH", "OPS")')
    expect(cql).toContain('label != "confidencial"')
    expect(cql).toContain('label != "rascunho"')
    expect(cql).toContain('type = page')
  })
})

describe('RNF-07 — allowlist vazia não busca nada, e não sai requisição', () => {
  it('sem espaço liberado, retorna vazio sem tocar a rede', async () => {
    let chamou = false
    const cliente = new ClienteAtlassianHttp({
      ...BASE,
      campoSolicitanteId: null,
      fetchImpl: (async () => {
        chamou = true
        return new Response('{}', { status: 200 })
      }) as unknown as typeof fetch,
    })
    const r = await cliente.buscarConfluence({
      termo: 'qualquer coisa',
      espacosPermitidos: [],
      labelsBloqueadas: [],
      limite: 5,
    })
    expect(r).toEqual([])
    // Allowlist vazia com query aberta buscaria o site TODO. Nem sai requisição.
    expect(chamou).toBe(false)
  })
})

describe('Regra 2 — JQL com janela e campo de agrupamento vindos de config (Q2)', () => {
  it('o campo de agrupamento não é hardcoded (RNF-25)', () => {
    expect(montarJql({ chaveAgrupamento: 'pipeline', campoAgrupamento: 'labels', janelaDias: 90, limite: 20 }))
      .toContain('labels = "pipeline"')
    expect(montarJql({ chaveAgrupamento: 'pipeline', campoAgrupamento: 'component', janelaDias: 90, limite: 20 }))
      .toContain('component = "pipeline"')
  })

  it('a janela limita o histórico — é o que contém o custo da IA (R-08)', () => {
    const jql = montarJql({
      chaveAgrupamento: 'x',
      campoAgrupamento: 'labels',
      janelaDias: 30,
      limite: 20,
    })
    expect(jql).toContain('created >= -30d')
    expect(jql).toContain('statusCategory = Done')
  })

  it('valor de agrupamento também é escapado', () => {
    const jql = montarJql({
      chaveAgrupamento: 'x" OR project = "SEGREDO',
      campoAgrupamento: 'labels',
      janelaDias: 90,
      limite: 20,
    })
    expect(jql).toContain('\\"')
  })
})

describe('RF-21 / R-03 — o solicitante real vai no chamado, com e sem o campo customizado', () => {
  const dados = {
    serviceDeskId: 'sd-1',
    tipoChamadoId: 'rt-1',
    titulo: 'Pipeline falhou',
    descricao: 'O pipeline diário não rodou.',
    prioridade: 'alta' as const,
    solicitanteEmail: 'ana@gocase.com',
    chaveIdempotencia: 'chave-123',
  }

  it('com o campo configurado (Q4 respondida): campo estruturado E descrição', () => {
    const cliente = new ClienteAtlassianHttp({ ...BASE, campoSolicitanteId: 'customfield_10050' })
    const { descricao, camposExtra } = cliente.montarCamposSolicitante(dados)
    expect(camposExtra.customfield_10050).toBe('ana@gocase.com')
    expect(descricao).toContain('**Solicitante:** ana@gocase.com')
    expect(descricao).toContain('O pipeline diário não rodou.')
  })

  it('SEM o campo (Q4 em aberto): a descrição ainda identifica quem pediu', () => {
    // Cinto e suspensório de propósito: sem isso, todo chamado chega ao time de
    // tech como "aberto pelo robô" — o risco R-03 inteiro. Deixar a identificação
    // depender de uma config que pode estar ausente é aceitar o pior caso em
    // silêncio.
    const cliente = new ClienteAtlassianHttp({ ...BASE, campoSolicitanteId: null })
    const { descricao, camposExtra } = cliente.montarCamposSolicitante(dados)
    expect(Object.keys(camposExtra)).toHaveLength(0)
    expect(descricao).toContain('**Solicitante:** ana@gocase.com')
  })

  it('a chave de idempotência vai no corpo — é o que permite reconciliar (RNF-21)', () => {
    const cliente = new ClienteAtlassianHttp({ ...BASE, campoSolicitanteId: null })
    const { descricao } = cliente.montarCamposSolicitante(dados)
    expect(descricao).toContain('chave-123')
  })
})

describe('classificador — resposta ilegível NUNCA vira ajuste operacional', () => {
  it('classe desconhecida, JSON inválido e vazio caem em indeterminado', () => {
    // Indeterminado não bloqueia (ver rules/). Transformar erro de parsing em
    // bloqueio seria fabricar falso bloqueio (R-04).
    for (const bruto of ['', '   ', 'não é json', '{"classe":"talvez"}', null, 42, undefined]) {
      expect(interpretarClassificacao(bruto).classe, String(bruto)).toBe('indeterminado')
    }
  })

  it('as duas classes válidas são reconhecidas', () => {
    expect(interpretarClassificacao('{"classe":"ajuste_operacional","justificativa":"x"}').classe)
      .toBe('ajuste_operacional')
    expect(interpretarClassificacao('{"classe":"resolucao_real","justificativa":"y"}').classe)
      .toBe('resolucao_real')
  })

  it('justificativa ausente não vira undefined na auditoria', () => {
    expect(interpretarClassificacao('{"classe":"resolucao_real"}').justificativa)
      .toBe('sem justificativa')
  })
})
