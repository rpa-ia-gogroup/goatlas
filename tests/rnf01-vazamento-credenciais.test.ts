/**
 * T-094 — varredura provando que nenhuma das três credenciais (API token
 * Jira/Confluence, API key da Organizations API, chave da API de IA) aparece em
 * log, resposta ou bundle.
 *
 * Não é um teste de "será que existe algum bug" — as três camadas de transporte
 * (`atlassian/http.ts`, `atlassian/organizacao.ts`, `ia/cliente.ts`) já foram
 * escritas para nunca repassar o corpo da resposta, e a auditoria já redige
 * chaves sensíveis. O que faltava era a PROVA executável dessas garantias, não a
 * garantia em si — RNF-01 pede exatamente isso: crença não documentada é
 * documentação, não trava.
 *
 * _Requirements: RNF-01_
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { SqliteLocal } from '@/lib/db/sqlite-local'
import { migrar } from '@/lib/db/schema'
import { AuditoriaBanco, redigirSensiveis } from '@/lib/audit'
import { TransporteAtlassian } from '@/lib/atlassian/http'
import { TransporteOrganizacao } from '@/lib/atlassian/organizacao'
import { ClienteIAHttp } from '@/lib/ia/cliente'

function arquivosFonte(): string[] {
  const raiz = fileURLToPath(new URL('../src', import.meta.url))
  const arquivos: string[] = []
  const varrer = (dir: string) => {
    for (const item of readdirSync(dir)) {
      const caminho = join(dir, item)
      if (statSync(caminho).isDirectory()) varrer(caminho)
      else if (/\.(ts|tsx)$/.test(item)) arquivos.push(caminho)
    }
  }
  varrer(raiz)
  return arquivos
}

describe('RNF-01 — as três credenciais só são lidas em contexto.ts', () => {
  // Estrutural de propósito, como o teste de `dangerouslySetInnerHTML` e o de
  // `obterCorpoStorage`: um segundo lugar lendo `env.ATLASSIAN_API_TOKEN` faz a
  // garantia depender de disciplina em vez de estrutura — este teste faz a
  // regressão aparecer como teste vermelho, não como revisão de código perdida.
  const PADROES: readonly { nome: string; regex: RegExp }[] = [
    { nome: 'ATLASSIAN_API_TOKEN', regex: /\benv\.ATLASSIAN_API_TOKEN\b/ },
    { nome: 'ATLASSIAN_ORG_API_KEY', regex: /\benv\.ATLASSIAN_ORG_API_KEY\b/ },
    { nome: 'LLM_API_KEY', regex: /\benv\.LLM_API_KEY\b/ },
    { nome: 'LLM_FALLBACK', regex: /\benv\.LLM_FALLBACK\b/ },
  ]

  it.each(PADROES)('$nome nunca é lida fora de lib/contexto.ts', ({ regex }) => {
    // `ATLASSIAN_ORG_API_KEY` ainda não tem transporte real ligado (Q1,
    // T-122/T-123) — hoje a lista pode vir vazia, e está certo que venha. O que
    // este teste proíbe é um SEGUNDO lugar lendo a env var, não exige um primeiro.
    const raiz = fileURLToPath(new URL('../src', import.meta.url))
    const chamadores = arquivosFonte()
      .filter((a) => regex.test(readFileSync(a, 'utf8')))
      .map((a) => a.replace(raiz, '').replace(/\\/g, '/'))
    expect(chamadores.every((c) => c === '/lib/contexto.ts')).toBe(true)
  })

  it('as três já em uso (token, chave de IA, fallback) são lidas ao menos em contexto.ts', () => {
    // Complementa o teste acima: aquele proíbe um SEGUNDO lugar; este confirma
    // que o PRIMEIRO lugar continua existindo — sem ele, a regressão seria "a
    // credencial nunca é lida em lugar nenhum", que quebraria o app inteiro em
    // silêncio até alguém notar que nada de real acontece.
    const contexto = readFileSync(
      fileURLToPath(new URL('../src/lib/contexto.ts', import.meta.url)),
      'utf8',
    )
    expect(contexto).toMatch(/\benv\.ATLASSIAN_API_TOKEN\b/)
    expect(contexto).toMatch(/\benv\.LLM_API_KEY\b/)
    expect(contexto).toMatch(/\benv\.LLM_FALLBACK\b/)
  })
})

describe('RNF-01 — mensagem de erro nunca inclui o corpo da resposta', () => {
  const SEGREDO_TOKEN = 'segredo-atlassian-real-abc123'
  const SEGREDO_ORG = 'segredo-org-admin-real-xyz789'
  const SEGREDO_IA = 'segredo-ia-real-qwe456'

  function respostaFalhaComSegredo(segredo: string): Response {
    // Simula um servidor quebrado que ecoa dado interno (inclusive, no pior
    // caso, a própria credencial recebida) no corpo do erro — o cenário que a
    // regra "nunca inclui o corpo" existe para neutralizar.
    return new Response(
      JSON.stringify({ error: 'internal', debug: { receivedAuth: segredo } }),
      { status: 500 },
    )
  }

  it('TransporteAtlassian: erro 500 não vaza o token nem o corpo', async () => {
    const transporte = new TransporteAtlassian({
      baseUrl: 'https://goengenharia.atlassian.net',
      email: 'servico@gocase.com',
      apiToken: SEGREDO_TOKEN,
      maxTentativas: 1,
      fetchImpl: (async () => respostaFalhaComSegredo(SEGREDO_TOKEN)) as typeof fetch,
    })

    await expect(transporte.requisitar('/rest/api/x')).rejects.toSatisfy((erro: unknown) => {
      const msg = String((erro as Error).message)
      expect(msg).not.toContain(SEGREDO_TOKEN)
      expect(msg).not.toContain('receivedAuth')
      expect(msg).not.toContain('debug')
      return true
    })
  })

  it('TransporteOrganizacao: erro 500 não vaza a API key nem o corpo', async () => {
    const transporte = new TransporteOrganizacao({
      baseUrl: 'https://api.atlassian.com/admin',
      apiKey: SEGREDO_ORG,
      maxTentativas: 1,
      fetchImpl: (async () => respostaFalhaComSegredo(SEGREDO_ORG)) as typeof fetch,
    })

    await expect(transporte.requisitar('/v1/orgs/org-1/users')).rejects.toSatisfy(
      (erro: unknown) => {
        const msg = String((erro as Error).message)
        expect(msg).not.toContain(SEGREDO_ORG)
        expect(msg).not.toContain('receivedAuth')
        expect(msg).not.toContain('debug')
        return true
      },
    )
  })

  it('ClienteIAHttp: erro 500 não vaza a chave nem o corpo', async () => {
    const cliente = new ClienteIAHttp({
      baseUrl: 'https://ai-proxy.gogroupbr.com',
      apiKey: SEGREDO_IA,
      modelo: 'gpt-5.4-mini',
      fetchImpl: (async () => respostaFalhaComSegredo(SEGREDO_IA)) as typeof fetch,
    })

    await expect(
      cliente.chat({
        mensagens: [{ papel: 'user', conteudo: 'oi' }],
        toolsPermitidas: [],
      }),
    ).rejects.toSatisfy((erro: unknown) => {
      const msg = String((erro as Error).message)
      expect(msg).not.toContain(SEGREDO_IA)
      expect(msg).not.toContain('receivedAuth')
      expect(msg).not.toContain('debug')
      return true
    })
  })

  it('ClienteIAHttp: falha de rede também não vaza a chave (mensagem fixa)', async () => {
    const cliente = new ClienteIAHttp({
      baseUrl: 'https://ai-proxy.gogroupbr.com',
      apiKey: SEGREDO_IA,
      modelo: 'gpt-5.4-mini',
      fetchImpl: (async () => {
        throw new Error(`falha de conexão com header Authorization: Bearer ${SEGREDO_IA}`)
      }) as typeof fetch,
    })

    await expect(
      cliente.chat({ mensagens: [{ papel: 'user', conteudo: 'oi' }], toolsPermitidas: [] }),
    ).rejects.toSatisfy((erro: unknown) => {
      expect(String((erro as Error).message)).not.toContain(SEGREDO_IA)
      return true
    })
  })
})

describe('RNF-01 — auditoria redige campos sensíveis antes de persistir', () => {
  it('redigirSensiveis troca chave sensível pelo marcador, recursivamente', () => {
    const saida = redigirSensiveis({
      acao: 'login',
      apiToken: 'segredo-1',
      Authorization: 'Bearer segredo-2',
      aninhado: { password: 'segredo-3', ok: true },
      contagem: 3,
    })
    expect(saida.apiToken).toBe('[REDIGIDO]')
    expect(saida.Authorization).toBe('[REDIGIDO]')
    expect((saida.aninhado as Record<string, unknown>).password).toBe('[REDIGIDO]')
    expect((saida.aninhado as Record<string, unknown>).ok).toBe(true)
    expect(saida.acao).toBe('login')
    expect(saida.contagem).toBe(3)
  })

  let db: SqliteLocal
  beforeEach(async () => {
    db = new SqliteLocal()
    await migrar(db)
  })

  it('o que fica gravado no banco não contém o valor do segredo, só o marcador', async () => {
    const SEGREDO = 'segredo-persistido-nao-pode-vazar'
    let n = 0
    const auditoria = new AuditoriaBanco(db, () => '2026-08-05T00:00:00.000Z', () => `id-${++n}`)

    await auditoria.registrar({
      atorEmail: 'ana@gocase.com',
      acao: 'chamado_criado',
      resultado: 'falha',
      detalhe: { apiKey: SEGREDO, motivo: 'timeout' },
    })

    const registros = await auditoria.listarPorAtor('ana@gocase.com', 10)
    expect(registros).toHaveLength(1)
    const bruto = registros[0]!.detalhe_json ?? ''
    expect(bruto).not.toContain(SEGREDO)
    expect(bruto).toContain('[REDIGIDO]')
    expect(bruto).toContain('timeout')
  })
})

describe('RNF-01 — build do Worker não embute credencial no bundle', () => {
  it('esbuild não usa `define`/`inject` — env só existe em runtime via `env.X`', () => {
    // Sem `define`, nenhuma env var vira valor literal no bundle: `env.X` só
    // resolve quando o Worker roda, nunca no momento do build. Um `define` futuro
    // mapeando `process.env.ATLASSIAN_API_TOKEN` para uma string congelaria a
    // credencial de quem rodou o build dentro do `worker.js` versionado.
    const fonte = readFileSync(
      fileURLToPath(new URL('../scripts/build-worker.mjs', import.meta.url)),
      'utf8',
    )
    expect(fonte).not.toMatch(/\bdefine\s*:/)
    expect(fonte).not.toMatch(/\binject\s*:/)
  })

  it('nenhum arquivo `.env*` está versionado no repo', () => {
    const raiz = fileURLToPath(new URL('..', import.meta.url))
    const nomes = readdirSync(raiz)
    const suspeitos = nomes.filter((n) => /^\.env/.test(n))
    expect(suspeitos).toEqual([])
  })
})
