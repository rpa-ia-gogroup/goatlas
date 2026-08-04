/**
 * RF-01, RF-02, RF-04, RF-05, RN-09, RNF-05, RNF-07.
 *
 * O edge do GoDeploy diz QUEM é (D-02). O app decide SE pode — a cada requisição,
 * no servidor. Estes testes tentam entrar por caminhos que o cliente controla.
 *
 * _Requirements: RF-01, RF-02, RF-04, RF-05, RN-09, RNF-05, RNF-07_
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { SqliteLocal } from '@/lib/db/sqlite-local'
import { migrar } from '@/lib/db/schema'
import { Config } from '@/lib/config'
import { HEADER_EMAIL, HEADER_NOME, derivarNomeDeEmail, resolverIdentidade } from '@/lib/auth'

const AGORA = '2026-08-03T12:00:00.000Z'
let db: SqliteLocal
let config: Config

beforeEach(async () => {
  db = new SqliteLocal()
  await migrar(db)
  config = new Config(db)
})

const headers = (h: Record<string, string>) => new Headers(h)

describe('RNF-07 — negação por padrão', () => {
  it('config recém-criada NEGA todo mundo, não libera todo mundo', async () => {
    // O erro mais fácil de escrever aqui seria `if (dominios.length === 0) return ok`.
    // Ele passaria em qualquer teste de caminho feliz e abriria o app em produção
    // no dia em que alguém esquecesse de configurar.
    const r = await resolverIdentidade(headers({ [HEADER_EMAIL]: 'ana@gocase.com' }), config)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.motivo).toBe('nenhum_dominio_configurado')
  })

  it('nenhuma allowlist nasce povoada — nada exposto por padrão', async () => {
    expect(await config.obter('espacos_confluence')).toEqual([])
    expect(await config.obter('tipos_chamado_permitidos')).toEqual([])
    expect(await config.obter('admins')).toEqual([])
    expect(await config.obter('dominios_permitidos')).toEqual([])
    expect(await config.obter('regra2_exemplos_ajuste_operacional')).toEqual([])
  })
})

describe('RF-01 / RF-05 — domínio é decidido no servidor', () => {
  beforeEach(async () => {
    await config.definir('dominios_permitidos', ['gocase.com'], 'admin@gocase.com', AGORA)
  })

  it('domínio permitido entra', async () => {
    const r = await resolverIdentidade(headers({ [HEADER_EMAIL]: 'ana@gocase.com' }), config)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.identidade.email).toBe('ana@gocase.com')
  })

  it('BURLA — domínio de fora é negado', async () => {
    const r = await resolverIdentidade(headers({ [HEADER_EMAIL]: 'alguem@gmail.com' }), config)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.motivo).toBe('dominio_nao_permitido')
  })

  it('BURLA — domínio que só TERMINA com o permitido é negado', async () => {
    // `gocase.com.br` e `evil-gocase.com` não são `gocase.com`. Uma comparação
    // por `endsWith` deixaria os dois entrarem.
    for (const email of ['ana@gocase.com.br', 'ana@evil-gocase.com', 'ana@notgocase.com']) {
      const r = await resolverIdentidade(headers({ [HEADER_EMAIL]: email }), config)
      expect(r.ok, email).toBe(false)
    }
  })

  it('BURLA — segundo @ no e-mail não engana a extração de domínio', async () => {
    const r = await resolverIdentidade(
      headers({ [HEADER_EMAIL]: 'ana@gmail.com@gocase.com' }),
      config,
    )
    expect(r.ok).toBe(false)
  })

  it('sem header do edge: negado (não há identidade a assumir)', async () => {
    const r = await resolverIdentidade(headers({}), config)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.motivo).toBe('sem_identidade_do_edge')
  })

  it('e-mail é normalizado para minúsculas — a chave de identidade é única (RF-04)', async () => {
    const r = await resolverIdentidade(headers({ [HEADER_EMAIL]: '  ANA@GoCase.com ' }), config)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.identidade.email).toBe('ana@gocase.com')
  })

  it('multi-domínio (Q7): cada marca do grupo entra pela sua entrada na lista', async () => {
    await config.definir(
      'dominios_permitidos',
      ['gocase.com', 'gobeaute.com.br'],
      'admin@gocase.com',
      AGORA,
    )
    expect((await resolverIdentidade(headers({ [HEADER_EMAIL]: 'ana@gocase.com' }), config)).ok).toBe(true)
    expect((await resolverIdentidade(headers({ [HEADER_EMAIL]: 'bo@gobeaute.com.br' }), config)).ok).toBe(true)
    expect((await resolverIdentidade(headers({ [HEADER_EMAIL]: 'x@outra.com' }), config)).ok).toBe(false)
  })
})

describe('RF-04 / RNF-05 — identificador do cliente é ignorado', () => {
  beforeEach(async () => {
    await config.definir('dominios_permitidos', ['gocase.com'], 'admin@gocase.com', AGORA)
    await config.definir('admins', ['chefe@gocase.com'], 'admin@gocase.com', AGORA)
  })

  it('BURLA — header alternativo de e-mail não substitui o do edge', async () => {
    const r = await resolverIdentidade(
      headers({
        [HEADER_EMAIL]: 'ana@gocase.com',
        'x-user-email': 'chefe@gocase.com',
        'x-forwarded-email': 'chefe@gocase.com',
        from: 'chefe@gocase.com',
      }),
      config,
    )
    expect(r.ok).toBe(true)
    // A identidade é a do edge, e o admin da tentativa não pegou.
    if (r.ok) {
      expect(r.identidade.email).toBe('ana@gocase.com')
      expect(r.identidade.isAdmin).toBe(false)
    }
  })

  it('RN-09 — admin vem SÓ da allowlist explícita, nunca é inferido', async () => {
    const chefe = await resolverIdentidade(headers({ [HEADER_EMAIL]: 'chefe@gocase.com' }), config)
    expect(chefe.ok && chefe.identidade.isAdmin).toBe(true)

    // Nem e-mail com cara de admin engana.
    for (const email of ['admin@gocase.com', 'root@gocase.com', 'ti@gocase.com']) {
      const r = await resolverIdentidade(headers({ [HEADER_EMAIL]: email }), config)
      expect(r.ok && r.identidade.isAdmin, email).toBe(false)
    }
  })

  it('mudar a allowlist de admin vale sem deploy (RF-02)', async () => {
    const antes = await resolverIdentidade(headers({ [HEADER_EMAIL]: 'ana@gocase.com' }), config)
    expect(antes.ok && antes.identidade.isAdmin).toBe(false)

    await config.definir('admins', ['ana@gocase.com'], 'chefe@gocase.com', AGORA)
    const depois = await resolverIdentidade(headers({ [HEADER_EMAIL]: 'ana@gocase.com' }), config)
    expect(depois.ok && depois.identidade.isAdmin).toBe(true)
  })
})

describe('RF-06 — nome sem pedir cadastro', () => {
  beforeEach(async () => {
    await config.definir('dominios_permitidos', ['gocase.com'], 'admin@gocase.com', AGORA)
  })

  it('usa o nome do edge quando ele vem', async () => {
    const r = await resolverIdentidade(
      headers({ [HEADER_EMAIL]: 'ana@gocase.com', [HEADER_NOME]: 'Ana Paula Souza' }),
      config,
    )
    expect(r.ok && r.identidade.nome).toBe('Ana Paula Souza')
  })

  it('deriva do e-mail quando o edge não manda nome', async () => {
    const r = await resolverIdentidade(
      headers({ [HEADER_EMAIL]: 'ana.paula.souza@gocase.com' }),
      config,
    )
    expect(r.ok && r.identidade.nome).toBe('Ana Paula Souza')
  })

  it('derivação lida com separadores variados', () => {
    expect(derivarNomeDeEmail('joao_victor@gocase.com')).toBe('Joao Victor')
    expect(derivarNomeDeEmail('LUIS-EDUARDO@gocase.com')).toBe('Luis Eduardo')
    expect(derivarNomeDeEmail('kaique@gocase.com')).toBe('Kaique')
  })
})
