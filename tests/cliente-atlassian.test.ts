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

/**
 * **`listarTiposChamado` — o endpoint global é EXPERIMENTAL e devolvia 412.**
 *
 * 🚨 Medido contra a Atlassian real em 07/08/2026, com credencial válida:
 * `GET /rest/servicedeskapi/requesttype` responde **412** com *"This API is experimental…
 * You must set the header 'X-ExperimentalApi: opt-in'"*. Era o endpoint que este método
 * usava, então **listar tipos de chamado não funcionava em produção** — e sem isso não há
 * allowlist de `RF-28` nem formulário sem IA sabendo o que oferecer.
 *
 * A correção **não** foi ligar o opt-in: "experimental" é a Atlassian avisando que pode
 * mudar sem aviso, e a allowlist de tipos é trava de roteamento (`RF-28`). O caminho
 * estável é por service desk, que responde 200 sem cabeçalho nenhum.
 *
 * _Requirements: RF-28, RNF-25, R-02_
 */
describe('listarTiposChamado usa o caminho estável, não o experimental', () => {
  function clienteFalso(
    responder: (url: string) => { status?: number; corpo?: unknown },
  ): { cliente: ClienteAtlassianHttp; urls: string[] } {
    const urls: string[] = []
    const fetchImpl = (async (url: string | URL | Request) => {
      const u = String(url)
      urls.push(u)
      const r = responder(u)
      return new Response(r.corpo === undefined ? null : JSON.stringify(r.corpo), {
        status: r.status ?? 200,
      })
    }) as unknown as typeof fetch
    return {
      cliente: new ClienteAtlassianHttp({ ...BASE, fetchImpl }),
      urls,
    }
  }

  const RESPOSTAS = (url: string) => {
    if (url.endsWith('/rest/servicedeskapi/servicedesk')) {
      return { corpo: { values: [{ id: 4 }, { id: 9 }] } }
    }
    if (url.includes('/servicedesk/4/requesttype')) {
      return { corpo: { values: [{ id: 70, name: 'Relatar um bug', description: 'bug' }] } }
    }
    if (url.includes('/servicedesk/9/requesttype')) {
      return { corpo: { values: [{ id: 12, name: 'Outro' }] } }
    }
    // O global existe no dublê e responde como a Atlassian real: 412.
    return { status: 412, corpo: { message: 'This API is experimental.' } }
  }

  it('NÃO chama o endpoint global — ele responde 412 na Atlassian real', async () => {
    const { cliente, urls } = clienteFalso(RESPOSTAS)
    await cliente.listarTiposChamado()
    expect(urls).not.toContain(`${BASE.baseUrl}/rest/servicedeskapi/requesttype`)
  })

  it('lista os desks e depois os tipos DE CADA UM', async () => {
    const { cliente, urls } = clienteFalso(RESPOSTAS)
    const tipos = await cliente.listarTiposChamado()
    expect(urls[0]).toBe(`${BASE.baseUrl}/rest/servicedeskapi/servicedesk`)
    expect(tipos.map((t) => t.id)).toEqual(['70', '12'])
  })

  it('o `serviceDeskId` vem do LAÇO — o endpoint por desk não o repete em cada item', async () => {
    const { cliente } = clienteFalso(RESPOSTAS)
    const tipos = await cliente.listarTiposChamado()
    // `String(undefined ?? '')` daria `''`, e tipo sem desk não cria chamado nenhum.
    expect(tipos.map((t) => t.serviceDeskId)).toEqual(['4', '9'])
    expect(tipos.every((t) => t.serviceDeskId.length > 0)).toBe(true)
  })
})

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

  it('o CLIENTE não decide campo de solicitante — quem decide é o mapa por tipo (D-36)', () => {
    // 🚨 Antes existia `campoSolicitanteId` nas opções, e um id GLOBAL. Medição de
    // 11/08/2026: o mesmo `fieldId` significa coisas diferentes por request type, então
    // um id global escreveria o e-mail do solicitante no campo errado com HTTP 201.
    // O cliente voltou a ser burro quanto a política — como já é para `RN-06`.
    const cliente = new ClienteAtlassianHttp({ ...BASE })
    const { camposExtra } = cliente.montarCamposSolicitante(dados)
    expect(Object.keys(camposExtra)).toHaveLength(0)
  })

  it('a descrição identifica quem pediu, SEMPRE — é a garantia, não o extra', () => {
    // Cinto e suspensório de propósito: 14 dos 15 tipos do `GN` não têm campo de
    // solicitante, então sem isto quase todo chamado chegaria ao time de tech como
    // "aberto pelo robô" — o risco R-03 inteiro.
    const cliente = new ClienteAtlassianHttp({ ...BASE })
    const { descricao } = cliente.montarCamposSolicitante(dados)
    expect(descricao).toContain('**Solicitante:** ana@gocase.com')
    expect(descricao).toContain('O pipeline diário não rodou.')
  })

  it('a chave de idempotência vai no corpo — é o que permite reconciliar (RNF-21)', () => {
    const cliente = new ClienteAtlassianHttp({ ...BASE })
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

/**
 * `RF-31` — anexos do chamado no cliente real (`D-45`).
 *
 * Duas coisas que o `ClienteAtlassianFake` **não** consegue afirmar, porque não faz HTTP:
 *
 * 1. A expansão `attachment` dos comentários é **tentada**, e a recusa dela não derruba a
 *    conversa do chamado — que é `RF-32`, P0, e não pode cair por causa de um `expand`
 *    que ninguém verificou contra a Atlassian real.
 * 2. O `_links.content` do anexo vem como URL **absoluta**, e só é aceito no próprio
 *    site: host diferente faria o app buscar bytes, **com a credencial**, onde a resposta
 *    mandasse.
 */
describe('anexos do chamado — o que só o cliente real decide', () => {
  function clienteComRespostas(
    responder: (url: string) => { status?: number; corpo?: unknown },
  ): { cliente: ClienteAtlassianHttp; urls: string[] } {
    const urls: string[] = []
    const fetchImpl = (async (url: string | URL | Request) => {
      const u = String(url)
      urls.push(u)
      const r = responder(u)
      return new Response(r.corpo === undefined ? null : JSON.stringify(r.corpo), {
        status: r.status ?? 200,
      })
    }) as unknown as typeof fetch
    return { cliente: new ClienteAtlassianHttp({ ...BASE, fetchImpl }), urls }
  }

  const COMENTARIO_PUBLICO = {
    id: '1',
    public: true,
    body: 'oi',
    created: { iso8601: '2026-08-12T12:00:00.000Z' },
    author: { displayName: 'Time' },
  }

  it('a expansão vai na query — é ela que prova publicidade', async () => {
    const { cliente, urls } = clienteComRespostas(() => ({ corpo: { values: [COMENTARIO_PUBLICO] } }))
    await cliente.listarComentariosPublicos('GN-1')
    expect(urls[0]).toContain('public=true&internal=false&expand=attachment')
  })

  it('expansão RECUSADA (4xx) não derruba os comentários — repete sem ela', async () => {
    const { cliente, urls } = clienteComRespostas((url) =>
      url.includes('expand=attachment')
        ? { status: 400 }
        : { corpo: { values: [COMENTARIO_PUBLICO] } },
    )
    const comentarios = await cliente.listarComentariosPublicos('GN-1')
    expect(comentarios).toHaveLength(1)
    // ⚠️ `null`, não `[]`: sem a expansão não há prova, e a camada de cima diz
    // "não conseguimos confirmar" em vez de "não há anexos".
    expect(comentarios[0]!.anexos).toBeNull()
    expect(urls).toHaveLength(2)
  })

  it('indisponibilidade (5xx) NÃO vira retentativa sem expansão — isso esconderia a queda', async () => {
    const urls: string[] = []
    const fetchImpl = (async (url: string | URL | Request) => {
      urls.push(String(url))
      return new Response(null, { status: 503 })
    }) as unknown as typeof fetch
    // `maxTentativas: 1` isola o que está sob teste: o backoff de `RNF-14` tem teste
    // próprio, e aqui ele só faria a suíte dormir.
    const cliente = new ClienteAtlassianHttp({ ...BASE, fetchImpl, maxTentativas: 1 })
    await expect(cliente.listarComentariosPublicos('GN-1')).rejects.toThrow()
    // Uma tentativa só: a queda sobe como queda. Repetir sem a expansão diria que o
    // problema é de contrato quando ele é de disponibilidade.
    expect(urls).toHaveLength(1)
  })

  it('200 SEM a expansão devolve `null`, nunca lista vazia', async () => {
    const { cliente } = clienteComRespostas(() => ({ corpo: { values: [COMENTARIO_PUBLICO] } }))
    const comentarios = await cliente.listarComentariosPublicos('GN-1')
    expect(comentarios[0]!.anexos).toBeNull()
  })

  it('a expansão paginada do JSM (`{values}`) é lida como lista de anexos', async () => {
    const { cliente } = clienteComRespostas(() => ({
      corpo: {
        values: [
          {
            ...COMENTARIO_PUBLICO,
            attachment: {
              size: 1,
              values: [{ filename: 'print.png', mimeType: 'image/png', size: 42 }],
            },
          },
        ],
      },
    }))
    const [c] = await cliente.listarComentariosPublicos('GN-1')
    expect(c!.anexos).toEqual([
      { nomeArquivo: 'print.png', tipoDeclarado: 'image/png', tamanhoBytes: 42, criadoEm: null },
    ])
  })

  it('tamanho ausente vira `null`, nunca `0` — "não sei" e "vazio" são frases diferentes', async () => {
    const { cliente } = clienteComRespostas(() => ({
      corpo: { values: [{ filename: 'x.pdf' }] },
    }))
    const [a] = await cliente.listarAnexosDoChamado('GN-1')
    expect(a!.tamanhoBytes).toBeNull()
    expect(a!.tipoDeclarado).toBeNull()
  })

  it('o download só aceita `_links.content` do PRÓPRIO site', async () => {
    const { cliente, urls } = clienteComRespostas(() => ({
      corpo: {
        values: [
          {
            filename: 'x.png',
            size: 4,
            _links: { content: 'https://evil.example.com/rest/api/3/attachment/content/9' },
          },
        ],
      },
    }))
    expect(await cliente.obterAnexoDoChamado('GN-1', 'x.png')).toEqual({ estado: 'nao_encontrado' })
    // Nenhuma requisição saiu para o host de fora — a credencial não foi oferecida a ele.
    expect(urls.some((u) => u.includes('evil.example.com'))).toBe(false)
  })

  it('URL absoluta do próprio site vira caminho relativo à base', async () => {
    const { cliente, urls } = clienteComRespostas((url) =>
      url.includes('/attachment/content/')
        ? { corpo: null }
        : {
            corpo: {
              values: [
                {
                  filename: 'x.png',
                  size: 4,
                  _links: {
                    content:
                      'https://goengenharia.atlassian.net/rest/api/3/attachment/content/9',
                  },
                },
              ],
            },
          },
    )
    const r = await cliente.obterAnexoDoChamado('GN-1', 'x.png')
    expect(r.estado).toBe('ok')
    expect(urls[1]).toBe('https://goengenharia.atlassian.net/rest/api/3/attachment/content/9')
  })

  it('nome que não está na lista DAQUELE chamado não baixa nada', async () => {
    const { cliente, urls } = clienteComRespostas(() => ({
      corpo: { values: [{ filename: 'outro.png', size: 4, _links: { content: '/x' } }] },
    }))
    expect(await cliente.obterAnexoDoChamado('GN-1', 'print.png')).toEqual({
      estado: 'nao_encontrado',
    })
    expect(urls).toHaveLength(1)
  })
})
