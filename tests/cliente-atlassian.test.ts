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
  camposAdicionais,
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

describe('RF-27 (T-130) — camposAdicionais filtra o que o formulário fixo já cobre', () => {
  it('summary/description/priority NUNCA aparecem — já têm input fixo (D-04)', () => {
    const campos = camposAdicionais([
      { fieldId: 'summary', name: 'Summary', jiraSchema: { type: 'string', system: 'summary' } },
      { fieldId: 'description', name: 'Description', jiraSchema: { type: 'string', system: 'description' } },
      { fieldId: 'priority', name: 'Priority', jiraSchema: { type: 'priority', system: 'priority' } },
      { fieldId: 'customfield_1', name: 'Sistema afetado', jiraSchema: { type: 'string' } },
    ])
    expect(campos.map((c) => c.fieldId)).toEqual(['customfield_1'])
  })

  it('campo sem `validValues` e sem custom textarea vira "texto"', () => {
    const [campo] = camposAdicionais([
      { fieldId: 'customfield_1', name: 'Sistema afetado', required: true, jiraSchema: { type: 'string' } },
    ])
    expect(campo?.tipo).toBe('texto')
    expect(campo?.obrigatorio).toBe(true)
    expect(campo?.opcoes).toEqual([])
  })

  it('custom textarea vira "texto_longo"', () => {
    const [campo] = camposAdicionais([
      {
        fieldId: 'customfield_2',
        name: 'Detalhes',
        jiraSchema: { type: 'string', custom: 'com.atlassian.jira.plugin.system.customfieldtypes:textarea' },
      },
    ])
    expect(campo?.tipo).toBe('texto_longo')
  })

  it('campo com `validValues` vira "selecao", com as opções mapeadas', () => {
    const [campo] = camposAdicionais([
      {
        fieldId: 'customfield_3',
        name: 'Ambiente',
        jiraSchema: { type: 'option' },
        validValues: [
          { id: '1', label: 'Produção' },
          { id: '2', label: 'Homologação' },
        ],
      },
    ])
    expect(campo?.tipo).toBe('selecao')
    expect(campo?.opcoes).toEqual([
      { id: '1', rotulo: 'Produção' },
      { id: '2', rotulo: 'Homologação' },
    ])
  })

  it('campo sem fieldId é descartado — não há como enviar valor sem ele', () => {
    expect(camposAdicionais([{ name: 'Sem id' }])).toEqual([])
  })
})

describe('RF-27 (T-130) — criarChamado inclui camposDinamicos em requestFieldValues', () => {
  it('o valor dinâmico chega no corpo da requisição', async () => {
    let corpoEnviado: Record<string, unknown> | null = null
    const cliente = new ClienteAtlassianHttp({
      ...BASE,
      campoSolicitanteId: null,
      maxTentativas: 1,
      fetchImpl: (async (_url: string, init: { body?: string }) => {
        corpoEnviado = JSON.parse(init.body ?? '{}')
        return new Response(JSON.stringify({ issueKey: 'GOATLAS-1', issueId: '1' }), { status: 200 })
      }) as unknown as typeof fetch,
    })
    await cliente.criarChamado({
      serviceDeskId: 'sd-1',
      tipoChamadoId: 'rt-1',
      titulo: 'Título',
      descricao: 'Descrição',
      prioridade: 'normal',
      solicitanteEmail: 'ana@gocase.com',
      chaveIdempotencia: 'chave-1',
      camposDinamicos: { customfield_1: 'Servidor de vendas' },
    })
    const enviado = corpoEnviado as unknown as {
      requestFieldValues: Record<string, unknown>
    }
    expect(enviado.requestFieldValues.customfield_1).toBe('Servidor de vendas')
  })

  it('BURLA — camposDinamicos não sobrescreve summary/description do sistema', async () => {
    let corpoEnviado: Record<string, unknown> | null = null
    const cliente = new ClienteAtlassianHttp({
      ...BASE,
      campoSolicitanteId: null,
      maxTentativas: 1,
      fetchImpl: (async (_url: string, init: { body?: string }) => {
        corpoEnviado = JSON.parse(init.body ?? '{}')
        return new Response(JSON.stringify({ issueKey: 'GOATLAS-1', issueId: '1' }), { status: 200 })
      }) as unknown as typeof fetch,
    })
    await cliente.criarChamado({
      serviceDeskId: 'sd-1',
      tipoChamadoId: 'rt-1',
      titulo: 'Título real',
      descricao: 'Descrição real',
      prioridade: 'normal',
      solicitanteEmail: 'ana@gocase.com',
      chaveIdempotencia: 'chave-1',
      camposDinamicos: { summary: 'forjado', description: 'forjado' },
    })
    const enviado = corpoEnviado as unknown as {
      requestFieldValues: { summary: unknown; description: unknown }
    }
    expect(enviado.requestFieldValues.summary).toBe('Título real')
    expect(String(enviado.requestFieldValues.description)).toContain('Descrição real')
  })
})

/* ---------------------------------------------------------------------- */
/* T-110 — leitura de página pela v2                                      */
/* ---------------------------------------------------------------------- */

/**
 * Encena a v2 do Confluence: página, espaço, labels, anexos e download.
 *
 * Existe porque o **formato** da v2 é a pegadinha desta tarefa, e o fake não a
 * reproduz: a v2 devolve `spaceId` **numérico**, enquanto a allowlist de `RN-06` é
 * por **chave** de espaço. Um teste que só use o fake nunca vê esse degrau.
 */
function fetchV2(mapa: {
  pagina?: Record<string, unknown>
  espacos?: Record<string, string>
  labels?: string[]
  anexos?: { title: string; mediaType?: string; fileSize?: number; downloadLink?: string }[]
  bytesDownload?: Uint8Array
  tipoDownload?: string
  tamanhoDeclarado?: number
  contar?: (url: string) => void
}): typeof fetch {
  return (async (url: string) => {
    mapa.contar?.(url)
    if (/\/wiki\/api\/v2\/pages\/[^/?]+\/labels/.test(url)) {
      return new Response(
        JSON.stringify({ results: (mapa.labels ?? []).map((name) => ({ name })) }),
        { status: 200 },
      )
    }
    if (/\/wiki\/api\/v2\/pages\/[^/?]+\/attachments/.test(url)) {
      return new Response(JSON.stringify({ results: mapa.anexos ?? [] }), { status: 200 })
    }
    if (url.includes('/wiki/api/v2/spaces/')) {
      const id = url.split('/wiki/api/v2/spaces/')[1] ?? ''
      const chave = (mapa.espacos ?? {})[id]
      return chave === undefined
        ? new Response('{}', { status: 404 })
        : new Response(JSON.stringify({ id, key: chave }), { status: 200 })
    }
    if (url.includes('/wiki/api/v2/pages/')) {
      return new Response(JSON.stringify(mapa.pagina ?? {}), { status: 200 })
    }
    if (url.includes('/download/')) {
      const cabecalhos: Record<string, string> = {
        'Content-Type': mapa.tipoDownload ?? 'image/png',
      }
      if (mapa.tamanhoDeclarado !== undefined) {
        cabecalhos['Content-Length'] = String(mapa.tamanhoDeclarado)
      }
      const u8 = mapa.bytesDownload ?? new Uint8Array([1, 2, 3])
      const corpo = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer
      return new Response(corpo, { status: 200, headers: cabecalhos })
    }
    return new Response('{}', { status: 200 })
  }) as unknown as typeof fetch
}

const PAGINA_V2 = {
  id: '77',
  title: 'Como reprocessar',
  spaceId: '9001',
  status: 'current',
  version: { number: 4, createdAt: '2026-08-01T10:00:00.000Z' },
  _links: { webui: '/spaces/TECH/pages/77/Como+reprocessar' },
}

const clienteV2 = (mapa: Parameters<typeof fetchV2>[0]) =>
  new ClienteAtlassianHttp({
    ...BASE,
    campoSolicitanteId: null,
    maxTentativas: 1,
    fetchImpl: fetchV2(mapa),
  })

describe('T-110 / RN-06 — `spaceId` da v2 é resolvido para CHAVE de espaço', () => {
  it('os metadados trazem a chave (`TECH`), nunca o id numérico', async () => {
    // Comparar a allowlist com `9001` não daria erro: daria uma condição de RN-06
    // que nunca reprova, ou que reprova tudo. É por isso que a resolução é do
    // cliente, e não de quem consome.
    const cliente = clienteV2({ pagina: PAGINA_V2, espacos: { '9001': 'TECH' } })
    const m = await cliente.obterMetadadosPagina('77')
    expect(m.espaco).toBe('TECH')
    expect(m.espaco).not.toBe('9001')
    expect(m.titulo).toBe('Como reprocessar')
    expect(m.atual).toBe(true)
    expect(m.versao).toBe(4)
  })

  it('espaço que não resolve LANÇA — o gate trata como recusa (fail-closed)', async () => {
    // Sem a chave não há como avaliar a allowlist. Devolver `''` deixaria a decisão
    // acontecer com informação faltando.
    const cliente = clienteV2({ pagina: PAGINA_V2, espacos: {} })
    await expect(cliente.obterMetadadosPagina('77')).rejects.toThrow()
  })

  it('página sem `spaceId` LANÇA', async () => {
    const cliente = clienteV2({ pagina: { ...PAGINA_V2, spaceId: undefined } })
    await expect(cliente.obterMetadadosPagina('77')).rejects.toThrow()
  })

  it('label vem em requisição separada e chega nos metadados', async () => {
    const cliente = clienteV2({
      pagina: PAGINA_V2,
      espacos: { '9001': 'TECH' },
      labels: ['confidencial', 'rascunho'],
    })
    expect((await cliente.obterMetadadosPagina('77')).labels).toEqual([
      'confidencial',
      'rascunho',
    ])
  })

  it('status diferente de `current` chega como `atual: false`', async () => {
    const cliente = clienteV2({
      pagina: { ...PAGINA_V2, status: 'trashed' },
      espacos: { '9001': 'TECH' },
    })
    expect((await cliente.obterMetadadosPagina('77')).atual).toBe(false)
  })

  it('metadados e corpo são CACHEADOS (RNF-13)', async () => {
    // Sem cache, quem é bloqueado pela Regra 1 e volta para reler a página gera
    // quatro chamadas por leitura — o app viraria amplificador (R-02).
    const urls: string[] = []
    const cliente = clienteV2({
      pagina: PAGINA_V2,
      espacos: { '9001': 'TECH' },
      contar: (u) => urls.push(u),
    })
    await cliente.obterMetadadosPagina('77')
    await cliente.obterMetadadosPagina('77')
    await cliente.obterCorpoStorage('77')
    await cliente.obterCorpoStorage('77')
    // 1 página + 1 espaço + 1 labels + 1 corpo.
    expect(urls).toHaveLength(4)
  })

  it('o corpo é pedido em `storage`, e vem cru — não sanitizado aqui', async () => {
    const urls: string[] = []
    const cliente = clienteV2({
      pagina: { body: { storage: { value: '<p>oi</p><script>x</script>' } } },
      contar: (u) => urls.push(u),
    })
    // A camada isolada devolve o que a Atlassian deu. Sanitizar é do gate
    // (`confluence/acesso.ts`), para que não exista rota que receba storage cru.
    expect(await cliente.obterCorpoStorage('77')).toContain('<script>')
    expect(urls[0]).toContain('body-format=storage')
  })
})

describe('T-112 — o anexo é casado na página, e o link não leva para fora', () => {
  const anexoBase = {
    pagina: PAGINA_V2,
    espacos: { '9001': 'TECH' },
    anexos: [
      { title: 'diagrama.png', mediaType: 'image/png', fileSize: 3, downloadLink: '/download/attachments/77/diagrama.png?version=1' },
    ],
  }

  it('anexo por nome exato volta com bytes e tipo', async () => {
    const r = await clienteV2(anexoBase).obterAnexo('77', 'diagrama.png')
    expect(r.estado).toBe('ok')
    if (r.estado !== 'ok') return
    expect(new Uint8Array(r.anexo.bytes)).toEqual(new Uint8Array([1, 2, 3]))
    expect(r.anexo.tipoDeclarado).toBe('image/png')
  })

  it('nome que não está na lista DAQUELA página: não encontrado', async () => {
    // A lista é o que amarra anexo à página cuja exposição foi verificada.
    const r = await clienteV2(anexoBase).obterAnexo('77', 'salarios.pdf')
    expect(r.estado).toBe('nao_encontrado')
  })

  it('BURLA — `downloadLink` para OUTRO host é recusado', async () => {
    // O link vem da Atlassian, mas seguir link absoluto faria o app buscar, **com a
    // credencial**, onde a resposta mandasse.
    for (const link of [
      'https://exfiltra.exemplo/x.png',
      '//exfiltra.exemplo/x.png',
      'download/attachments/77/x.png',
    ]) {
      const r = await clienteV2({
        ...anexoBase,
        anexos: [{ title: 'x.png', downloadLink: link }],
      }).obterAnexo('77', 'x.png')
      expect(r.estado, link).toBe('nao_encontrado')
    }
  })

  it('link que já vem com `/wiki` não é prefixado duas vezes', async () => {
    const urls: string[] = []
    await clienteV2({
      ...anexoBase,
      anexos: [{ title: 'x.png', downloadLink: '/wiki/download/attachments/77/x.png' }],
      contar: (u) => urls.push(u),
    }).obterAnexo('77', 'x.png')
    expect(urls.some((u) => u.includes('/wiki/wiki/'))).toBe(false)
  })

  it('tamanho anunciado acima do teto reprova SEM baixar', async () => {
    const urls: string[] = []
    const r = await clienteV2({
      ...anexoBase,
      anexos: [{ title: 'x.png', fileSize: 999_999_999, downloadLink: '/download/x.png' }],
      contar: (u) => urls.push(u),
    }).obterAnexo('77', 'x.png')
    expect(r.estado).toBe('grande_demais')
    expect(urls.some((u) => u.includes('/download/'))).toBe(false)
  })

  it('`Content-Length` acima do teto reprova antes de ler o corpo', async () => {
    // O `fileSize` da listagem pode mentir ou faltar; o teto tem de valer no
    // download também — é a diferença entre limite e sugestão.
    const r = await clienteV2({
      ...anexoBase,
      anexos: [{ title: 'x.png', downloadLink: '/download/x.png' }],
      tamanhoDeclarado: 999_999_999,
    }).obterAnexo('77', 'x.png')
    expect(r.estado).toBe('grande_demais')
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
