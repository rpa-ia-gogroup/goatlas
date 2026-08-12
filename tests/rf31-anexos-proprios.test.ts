/**
 * `RF-31` — o que **o app** anexou aparece para quem anexou, sem depender da Atlassian.
 *
 * ## O defeito que estes testes travam
 *
 * Medido na staging em 12/08/2026: o `GN-6898` nasceu com um arquivo enviado pelo app, e
 * `GET /api/chamados/GN-6898` respondeu `anexos: [], anexosIndisponiveis: true`. `D-45`
 * está certo sobre o anexo do **time** — a lista da Atlassian é filtrada pelo papel de
 * quem pergunta, e nós perguntamos como agente —, mas aplicá-lo também ao que **nós**
 * enviamos transformou cuidado em silêncio sobre o arquivo da própria pessoa.
 *
 * Os casos afirmam sobre a **função pura** e sobre o **repositório**, não sobre a tela:
 * é a regra que precisa continuar valendo quando a tela mudar.
 *
 * _Requirements: RF-30, RF-31, RF-34, RF-61, RF-63, RN-05_
 */

import { describe, expect, it } from 'vitest'
import { anexosParaExibir, provaDePublicidade } from '../src/lib/tickets/anexos-do-chamado'
import { AnexosEnviados } from '../src/lib/tickets/anexos-enviados'
import type { AnexoDoChamado, ComentarioPublico } from '../src/lib/atlassian/tipos'
import { SqliteLocal } from '@/lib/db/sqlite-local'
import { migrar } from '@/lib/db/schema'

const arquivo = (nome: string, bytes: number | null = 10): AnexoDoChamado => ({
  nomeArquivo: nome,
  tipoDeclarado: 'text/plain',
  tamanhoBytes: bytes,
  criadoEm: '2026-08-12T12:00:00.000Z',
})

const comentario = (anexos: readonly AnexoDoChamado[] | null): ComentarioPublico => ({
  id: '1',
  corpo: 'resposta do time',
  autorNome: 'Conta de Serviço',
  criadoEm: '2026-08-12T12:00:00.000Z',
  anexos,
})

describe('RF-31 · o anexo que o app enviou não depende de prova da Atlassian', () => {
  it('aparece mesmo quando a prova de publicidade não veio', () => {
    // O estado exato do `GN-6898`: a testemunha respondeu, os comentários não deram prova.
    const r = anexosParaExibir(
      'GN-6898',
      [arquivo('evidencia.txt')],
      { disponivel: false, anexos: [] },
      [arquivo('evidencia.txt')],
    )
    expect(r.itens.map((i) => i.nomeArquivo)).toEqual(['evidencia.txt'])
    expect(r.itens[0]!.origem).toBe('voce')
  })

  it('aparece mesmo quando a Atlassian caiu (`doChamado === null`)', () => {
    const r = anexosParaExibir('GN-1', null, { disponivel: false, anexos: [] }, [
      arquivo('print.png'),
    ])
    expect(r.itens.map((i) => i.nomeArquivo)).toEqual(['print.png'])
    // ⚠️ A bandeira continua de pé — mas agora ela fala do **time**, não de tudo.
    expect(r.indisponivel).toBe(true)
  })

  it('não duplica quando a Atlassian também lista o mesmo arquivo', () => {
    const meu = arquivo('log.txt', 42)
    const r = anexosParaExibir('GN-1', [meu], provaDePublicidade([comentario([meu])]), [meu])
    expect(r.itens).toHaveLength(1)
    expect(r.itens[0]!.origem).toBe('voce')
  })

  it('🚨 o anexo interno do time continua fora — `D-45` não foi enfraquecido', () => {
    const meu = arquivo('meu-print.png')
    const interno = arquivo('conversa-interna.pdf')
    // A lista da Atlassian traz os dois (ela responde como agente); a prova só cobre o meu.
    const r = anexosParaExibir(
      'GN-1',
      [meu, interno],
      provaDePublicidade([comentario([meu])]),
      [meu],
    )
    expect(r.itens.map((i) => i.nomeArquivo)).toEqual(['meu-print.png'])
    expect(r.itens.some((i) => i.nomeArquivo === 'conversa-interna.pdf')).toBe(false)
  })

  it('o anexo público do time entra junto, marcado como do time', () => {
    const meu = arquivo('meu.txt')
    const doTime = arquivo('resposta-do-time.pdf')
    const r = anexosParaExibir(
      'GN-1',
      [meu, doTime],
      provaDePublicidade([comentario([doTime])]),
      [meu],
    )
    expect(r.itens.map((i) => [i.nomeArquivo, i.origem])).toEqual([
      ['meu.txt', 'voce'],
      ['resposta-do-time.pdf', 'time'],
    ])
    expect(r.indisponivel).toBe(false)
  })

  it('sem anexo nenhum continua sendo "não há", não "não sei"', () => {
    const r = anexosParaExibir('GN-1', [], { disponivel: true, anexos: [] }, [])
    expect(r.itens).toEqual([])
    expect(r.indisponivel).toBe(false)
  })
})

describe('RF-30 · o registro não é legível sem o e-mail de quem mandou', () => {
  it('não devolve o anexo de outra pessoa no mesmo chamado', async () => {
    const db = new SqliteLocal()
    await migrar(db)
    const repo = new AnexosEnviados(db, () => '2026-08-12T12:00:00.000Z')

    await repo.registrar({
      issueKey: 'GN-1',
      solicitanteEmail: 'maria@gocase.com',
      nomeArquivo: 'da-maria.png',
      via: 'chamado',
    })
    await repo.registrar({
      issueKey: 'GN-1',
      solicitanteEmail: 'joao@gocase.com',
      nomeArquivo: 'do-joao.png',
      via: 'chamado',
    })

    const daMaria = await repo.listarDoSolicitante('GN-1', 'maria@gocase.com')
    expect(daMaria.map((a) => a.nomeArquivo)).toEqual(['da-maria.png'])
  })

  it('o e-mail casa sem depender de caixa ou espaço', async () => {
    const db = new SqliteLocal()
    await migrar(db)
    const repo = new AnexosEnviados(db, () => '2026-08-12T12:00:00.000Z')
    await repo.registrar({
      issueKey: 'GN-2',
      solicitanteEmail: '  Maria@Gocase.com ',
      nomeArquivo: 'print.png',
      via: 'criacao',
    })
    const r = await repo.listarDoSolicitante('GN-2', 'maria@gocase.com')
    expect(r).toHaveLength(1)
  })

  it('reenviar o mesmo arquivo não duplica a linha (idempotência pela constraint)', async () => {
    const db = new SqliteLocal()
    await migrar(db)
    const repo = new AnexosEnviados(db, () => '2026-08-12T12:00:00.000Z')
    const dados = {
      issueKey: 'GN-3',
      solicitanteEmail: 'maria@gocase.com',
      nomeArquivo: 'print.png',
      via: 'criacao' as const,
    }
    await repo.registrar(dados)
    await repo.registrar(dados)
    expect(await repo.listarDoSolicitante('GN-3', 'maria@gocase.com')).toHaveLength(1)
  })

  it('🚨 falha de banco não derruba o envio que já aconteceu', async () => {
    const quebrado = {
      exec: async () => {
        throw new Error('banco fora do ar')
      },
      query: async () => [],
    }
    const repo = new AnexosEnviados(quebrado as never, () => '2026-08-12T12:00:00.000Z')
    // O arquivo já está na Atlassian neste ponto: lançar aqui faria a rota responder erro
    // sobre um envio bem-sucedido.
    await expect(
      repo.registrar({
        issueKey: 'GN-4',
        solicitanteEmail: 'maria@gocase.com',
        nomeArquivo: 'print.png',
        via: 'chamado',
      }),
    ).resolves.toBeUndefined()
  })
})
