/**
 * **T-098** — a transcrição da conversa chegando ao chamado (`RF-23`).
 *
 * ## O que estes testes travam
 *
 * - **Os bytes que cruzam a fronteira**, não o que o dublê devolveu. `D-47` nomeia a
 *   família: quando o fake é a única evidência de um campo que atravessa o limite, o
 *   campo não está verificado. Por isso o cliente aqui é um espião escrito à mão que
 *   **guarda o `ArrayBuffer`** — o `ClienteAtlassianFake` registra só nome e tipo, então
 *   um teste contra ele passaria com o arquivo vazio.
 * - **O prompt do agente não vai junto** (`papel: 'system'`). Ele é função da instalação
 *   (`D-33`) e carrega allowlist, exemplos e horas de SLA configuradas.
 * - **O conteúdo das tools não vai junto** — trecho de página do Confluence e resumo de
 *   chamado de terceiros dentro de um arquivo que ninguém reavalia depois.
 * - **Nada lança.** O chamado já nasceu quando esta função roda; erro subindo faria a
 *   pessoa ler "algo deu errado" com o chamado aberto (mesma razão de `D-26`).
 * - **A tela não afirma autoria falsa** — a transcrição não é "você enviou" nem "do
 *   time" (`D-43` aplicado a arquivo).
 *
 * _Requirements: RF-23, RF-25, RF-30, RF-31, RNF-01, RNF-17, RNF-18, RNF-30_
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { SqliteLocal } from '@/lib/db/sqlite-local'
import { migrar } from '@/lib/db/schema'
import { Config } from '@/lib/config'
import { montarContexto, type Contexto } from '@/lib/contexto'
import { tratarRequisicao } from '@/lib/http/rotas'
import { HEADER_EMAIL } from '@/lib/auth'
import { ClienteAtlassianFake } from '@/lib/atlassian/fake'
import { ClienteIAFake } from '@/lib/ia/fake'
import { linhasComoObjetos } from '@/lib/db/tipos'
import {
  LIMITE_TRANSCRICAO_BYTES,
  anexarTranscricaoDoChamado,
  montarTranscricao,
  nomeDoArquivo,
} from '@/lib/tickets/transcricao'
import { anexosParaExibir } from '@/lib/tickets/anexos-do-chamado'
import type { MensagemIA } from '@/lib/ia/tipos'

const EMAIL = 'ana@gocase.com'
const AGORA = '2026-08-12T18:40:00.000Z'

const DIALOGO: MensagemIA[] = [
  { papel: 'system', conteudo: 'Você é o agente do atlas. Espaços permitidos: GT, DTE.' },
  { papel: 'user', conteudo: 'Minha VPN não conecta desde ontem à tarde.' },
  {
    papel: 'tool',
    conteudo: 'PÁGINA 123: "Reinicie o cliente e limpe o cache de sessão"...',
    toolNome: 'search_confluence',
  },
  { papel: 'assistant', conteudo: 'Encontrei uma página sobre isso. Você já tentou reiniciar?' },
  { papel: 'user', conteudo: 'Já tentei, continua igual.' },
]

const DADOS = {
  conversaId: 'c-1',
  solicitanteEmail: EMAIL,
  issueKey: 'GN-6903',
  geradoEm: AGORA,
}

/** Espião de cliente: guarda o que de fato foi entregue à camada de transporte. */
function espiaoAtlassian(opcoes: { falharUpload?: boolean } = {}) {
  const uploads: { serviceDeskId: string; nome: string; tipo: string; texto: string }[] = []
  const materializados: { issueKey: string; ids: readonly string[] }[] = []
  return {
    uploads,
    materializados,
    cliente: {
      async subirAnexoTemporario(
        serviceDeskId: string,
        arquivo: { nome: string; tipo: string; bytes: ArrayBuffer },
      ): Promise<string> {
        if (opcoes.falharUpload) throw new Error('fake: upload recusado')
        uploads.push({
          serviceDeskId,
          nome: arquivo.nome,
          tipo: arquivo.tipo,
          texto: new TextDecoder().decode(arquivo.bytes),
        })
        return 'tmp-1'
      },
      async materializarAnexosTemporarios(issueKey: string, ids: readonly string[]) {
        materializados.push({ issueKey, ids })
      },
    },
  }
}

function deps(
  mensagens: readonly MensagemIA[],
  opcoes: { falharUpload?: boolean } = {},
) {
  const espiao = espiaoAtlassian(opcoes)
  const auditado: { acao: string; resultado: string; detalhe?: Record<string, unknown> }[] = []
  const registrados: { nomeArquivo: string; via: string }[] = []
  return {
    espiao,
    auditado,
    registrados,
    deps: {
      atlassian: espiao.cliente,
      auditoria: {
        async registrar(e: {
          acao: string
          resultado: string
          detalhe?: Readonly<Record<string, unknown>>
        }) {
          auditado.push({ acao: e.acao, resultado: e.resultado, detalhe: { ...e.detalhe } })
        },
      } as never,
      conversas: {
        async listarMensagens() {
          return [...mensagens]
        },
      },
      anexosEnviados: {
        async registrar(d: { nomeArquivo: string; via: string }) {
          registrados.push({ nomeArquivo: d.nomeArquivo, via: d.via })
        },
      } as never,
      agora: () => AGORA,
    },
  }
}

describe('montarTranscricao — o que entra e o que fica de fora', () => {
  it('traz o diálogo das duas pontas, com acentuação', () => {
    const md = montarTranscricao(DIALOGO, DADOS)
    expect(md).toContain('Minha VPN não conecta desde ontem à tarde.')
    expect(md).toContain('Encontrei uma página sobre isso. Você já tentou reiniciar?')
    expect(md).toContain('**Solicitante:**')
    expect(md).toContain('**Agente:**')
    // O cabeçalho é o que dá o caminho de volta a quem lê no Jira nativo.
    expect(md).toContain('GN-6903')
    expect(md).toContain(EMAIL)
    expect(md).toContain('c-1')
  })

  it('🚨 NÃO leva o prompt do sistema — ele é configuração da instalação (D-33)', () => {
    const md = montarTranscricao(DIALOGO, DADOS)
    expect(md).not.toContain('Espaços permitidos')
    expect(md).not.toContain('Você é o agente do atlas')
  })

  it('🚨 registra que a tool rodou, e NÃO o que ela devolveu', () => {
    const md = montarTranscricao(DIALOGO, DADOS)
    expect(md).toContain('consultou a documentação')
    // Trecho de página do Confluence dentro de um anexo não passa por `RN-06` de novo.
    expect(md).not.toContain('PÁGINA 123')
    expect(md).not.toContain('limpe o cache de sessão')
  })

  it('conversa sem mensagem vira frase, nunca arquivo vazio', () => {
    const md = montarTranscricao([], DADOS)
    expect(md).toContain('não tem mensagens registradas')
  })

  it('truncamento é DENUNCIADO no próprio arquivo, e o arquivo cabe no teto', () => {
    const enorme: MensagemIA[] = [
      { papel: 'user', conteudo: 'á'.repeat(LIMITE_TRANSCRICAO_BYTES) },
    ]
    const md = montarTranscricao(enorme, DADOS)
    expect(new TextEncoder().encode(md).length).toBeLessThanOrEqual(LIMITE_TRANSCRICAO_BYTES)
    expect(md).toContain('Transcrição truncada')
    // Corte por bytes não pode deixar meio caractere para trás (regra 4).
    expect(md).not.toContain('�')
  })

  it('o nome do arquivo carrega a chave do chamado', () => {
    expect(nomeDoArquivo('GN-6903')).toBe('conversa-GN-6903.md')
  })
})

describe('anexarTranscricaoDoChamado', () => {
  it('entrega o TEXTO à Atlassian, não só um nome de arquivo', async () => {
    const t = deps(DIALOGO)
    const ok = await anexarTranscricaoDoChamado(t.deps as never, {
      conversaId: 'c-1',
      solicitanteEmail: EMAIL,
      serviceDeskId: '4',
      issueKey: 'GN-6903',
    })

    expect(ok).toBe(true)
    expect(t.espiao.uploads).toHaveLength(1)
    const enviado = t.espiao.uploads[0]!
    expect(enviado.serviceDeskId).toBe('4')
    expect(enviado.nome).toBe('conversa-GN-6903.md')
    expect(enviado.tipo).toBe('text/markdown')
    // ⚠️ A asserção que vale: o conteúdo real dos bytes que cruzaram a fronteira.
    expect(enviado.texto).toContain('Minha VPN não conecta desde ontem à tarde.')
    expect(t.espiao.materializados).toEqual([{ issueKey: 'GN-6903', ids: ['tmp-1'] }])
  })

  it('registra o arquivo como `transcricao`, nunca como envio da pessoa', async () => {
    const t = deps(DIALOGO)
    await anexarTranscricaoDoChamado(t.deps as never, {
      conversaId: 'c-1',
      solicitanteEmail: EMAIL,
      serviceDeskId: '4',
      issueKey: 'GN-6903',
    })
    expect(t.registrados).toEqual([{ nomeArquivo: 'conversa-GN-6903.md', via: 'transcricao' }])
  })

  it('criação diferida: não fala com a Atlassian e a auditoria diz por quê', async () => {
    const t = deps(DIALOGO)
    const ok = await anexarTranscricaoDoChamado(t.deps as never, {
      conversaId: 'c-1',
      solicitanteEmail: EMAIL,
      serviceDeskId: '4',
      issueKey: null,
    })

    expect(ok).toBe(false)
    expect(t.espiao.uploads).toHaveLength(0)
    expect(t.auditado).toEqual([
      {
        acao: 'transcricao_anexada',
        resultado: 'falha',
        detalhe: { motivo: 'criacao_diferida' },
      },
    ])
  })

  it('🚨 falha de anexo NÃO lança — o chamado já nasceu (mesma razão de D-26)', async () => {
    const t = deps(DIALOGO, { falharUpload: true })
    const ok = await anexarTranscricaoDoChamado(t.deps as never, {
      conversaId: 'c-1',
      solicitanteEmail: EMAIL,
      serviceDeskId: '4',
      issueKey: 'GN-6903',
    })

    expect(ok).toBe(false)
    expect(t.registrados).toHaveLength(0)
    expect(t.auditado).toEqual([
      { acao: 'transcricao_anexada', resultado: 'falha', detalhe: { motivo: 'anexo_recusado' } },
    ])
  })

  it('a auditoria é a ÚNICA evidência do sucesso — a tela não é avisada', async () => {
    const t = deps(DIALOGO)
    await anexarTranscricaoDoChamado(t.deps as never, {
      conversaId: 'c-1',
      solicitanteEmail: EMAIL,
      serviceDeskId: '4',
      issueKey: 'GN-6903',
    })
    expect(t.auditado[0]?.acao).toBe('transcricao_anexada')
    expect(t.auditado[0]?.resultado).toBe('sucesso')
    expect(t.auditado[0]?.detalhe?.mensagens).toBe(DIALOGO.length)
  })
})

/**
 * ⚠️ **O caso que prova a fiação.** Os de cima testam a função; este testa que a **rota**
 * a chama — a metade que faltava em `RF-23` era exatamente essa (o módulo não existia,
 * mas o board dava a tarefa como pronta, `D-47`).
 */
describe('pela rota real: confirmar a conversa leva a transcrição ao chamado', () => {
  const ANA = 'ana@gocase.com'
  const ROTEIRO = [
    {
      texto: 'Deixa eu verificar se isso já está documentado.',
      toolsPropostas: [{ nome: 'search_confluence', argumentos: { topico: 'vpn' } }],
    },
    {
      texto: 'Agora vou ver se já aconteceu antes.',
      toolsPropostas: [{ nome: 'check_jira_history', argumentos: { tipoProblema: 'vpn' } }],
    },
    { texto: 'Montei o chamado. Confira e confirme.' },
  ]

  let db: SqliteLocal
  let ctx: Contexto
  let atlassian: ClienteAtlassianFake

  beforeEach(async () => {
    db = new SqliteLocal()
    await migrar(db)
    const config = new Config(db)
    await config.definir('dominios_permitidos', ['gocase.com'], ANA, AGORA)
    await config.definir('tipos_chamado_permitidos', ['rt-1'], ANA, AGORA)
    await config.definir('service_desk_id', 'sd-1', ANA, AGORA)
    await config.definir('espacos_confluence', ['TECH'], ANA, AGORA)
    await config.definir('regra2_exemplos_ajuste_operacional', ['Rodei manualmente'], ANA, AGORA)

    // ⚠️ `D-70` — a extração escolhe o assunto pelo **nome**, e o nome vem de
    // `listarTiposChamado`. Sem o tipo registrado no fake não nasce proposta, e sem
    // proposta não há confirmação para levar transcrição a chamado nenhum.
    atlassian = new ClienteAtlassianFake({
      tiposChamado: [
        { id: 'rt-1', serviceDeskId: 'sd-1', nome: 'Suporte de tecnologia', descricao: null },
      ],
    })
    let n = 0
    ctx = await montarContexto({ DB: db, ATLAS_USAR_FAKES: '1' }, () => AGORA, () => `id-${++n}`, {
      atlassian,
      ia: new ClienteIAFake(ROTEIRO),
    })
  })

  const req = (caminho: string, corpo?: unknown) =>
    new Request(`https://atlas.devgogroup.com${caminho}`, {
      method: 'POST',
      headers: { [HEADER_EMAIL]: ANA },
      ...(corpo === undefined ? {} : { body: JSON.stringify(corpo) }),
    })
  const chamar = (r: Request) => tratarRequisicao(r, ctx, {})

  it('sobe um `conversa-<chave>.md` com a fala da pessoa dentro', async () => {
    const { id } = await (await chamar(req('/api/conversas'))).json()
    await chamar(req(`/api/conversas/${id}/mensagens`, { texto: 'minha VPN não conecta' }))
    const criado = await (await chamar(req(`/api/conversas/${id}/confirmar`))).json()
    expect(criado.issueKey).toBeTruthy()

    const uploads = atlassian.chamadas.filter((c) => c.operacao === 'subirAnexoTemporario')
    expect(uploads).toHaveLength(1)
    expect((uploads[0]!.params as { nome: string }).nome).toBe(
      `conversa-${criado.issueKey}.md`,
    )

    // O registro permanente — é dele que a tela lê, e é ele que sobrevive ao expurgo de
    // 12 h de `anexos_pendentes` (a armadilha de T-422).
    const enviados = await ctx.anexosEnviados.listarDoSolicitante(criado.issueKey, ANA)
    expect(enviados.map((a) => [a.nomeArquivo, a.via])).toEqual([
      [`conversa-${criado.issueKey}.md`, 'transcricao'],
    ])

    const auditoria = linhasComoObjetos<{ acao: string; resultado: string }>(
      await db.query(`SELECT acao, resultado FROM auditoria WHERE acao = ?`, [
        'transcricao_anexada',
      ]),
    )
    expect(auditoria).toEqual([{ acao: 'transcricao_anexada', resultado: 'sucesso' }])
  })

  it('🚨 o anexo recusado NÃO derruba a criação — a pessoa recebe o chamado', async () => {
    atlassian.estado.falhas.subirAnexoTemporario = 'indisponivel'
    const { id } = await (await chamar(req('/api/conversas'))).json()
    await chamar(req(`/api/conversas/${id}/mensagens`, { texto: 'minha VPN não conecta' }))
    const r = await chamar(req(`/api/conversas/${id}/confirmar`))

    expect(r.status).toBe(201)
    const criado = await r.json()
    expect(criado.issueKey).toBeTruthy()
    // E a única evidência da falha está onde ela precisa estar.
    const auditoria = linhasComoObjetos<{ resultado: string }>(
      await db.query(`SELECT resultado FROM auditoria WHERE acao = ?`, ['transcricao_anexada']),
    )
    expect(auditoria).toEqual([{ resultado: 'falha' }])
  })
})

describe('a tela não inventa autoria para a transcrição (D-43 aplicado a arquivo)', () => {
  const base = { tamanhoBytes: 10, tipoDeclarado: 'text/markdown', criadoEm: AGORA }

  it('`via: transcricao` sai como `atlas`, e o envio da pessoa continua `voce`', () => {
    const r = anexosParaExibir(
      'GN-6903',
      [],
      { disponivel: true, anexos: [] },
      [
        { ...base, nomeArquivo: 'conversa-GN-6903.md', via: 'transcricao' },
        { ...base, nomeArquivo: 'print.png', via: 'criacao' },
      ],
    )
    expect(r.itens.map((i) => [i.nomeArquivo, i.origem])).toEqual([
      ['conversa-GN-6903.md', 'atlas'],
      ['print.png', 'voce'],
    ])
  })

  it('sem `via` (caminhos antigos) continua sendo `voce`', () => {
    const r = anexosParaExibir('GN-6903', [], { disponivel: true, anexos: [] }, [
      { ...base, nomeArquivo: 'print.png' },
    ])
    expect(r.itens[0]?.origem).toBe('voce')
  })
})
