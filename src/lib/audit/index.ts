/**
 * Auditoria append-only — RF-58, RN-10.
 *
 * Registra TODA ação que toque a Atlassian ou a IA, **inclusive as que falham** —
 * é o requisito explícito, e é o que permite investigar tentativa de burla (uma
 * tentativa bloqueada não aparece em nenhum outro lugar).
 *
 * ⚠️ Este módulo expõe apenas `registrar` e leituras. **Não existe update nem
 * delete de auditoria em lugar algum do código**, e não deve passar a existir:
 * append-only é a propriedade que dá valor ao registro.
 */

import type { Banco } from '../db/tipos'
import { linhasComoObjetos } from '../db/tipos'

export type ResultadoAcao = 'sucesso' | 'falha' | 'negado'

/**
 * Ações auditadas. União fechada de propósito: ação nova exige passar por aqui,
 * o que força a pergunta "isto precisa de auditoria?" na revisão do PR.
 */
export type AcaoAuditada =
  | 'login'
  | 'acesso_negado'
  | 'conversa_iniciada'
  | 'mensagem_enviada'
  | 'busca_confluence'
  /** Leitura direta de página (RF-39) — toca a Atlassian, e a recusa é o registro de burla. */
  | 'pagina_confluence_lida'
  /** Anexo servido pelo proxy (RNF-02) — mesma razão. */
  | 'anexo_servido'
  /** Navegação pela árvore do espaço (RF-41) — expõe títulos, então é auditada. */
  | 'arvore_navegada'
  | 'consulta_historico'
  | 'bloqueio_disparado'
  | 'override_registrado'
  | 'confirmacao_registrada'
  | 'chamado_criado'
  | 'chamado_lido'
  | 'comentario_criado'
  | 'submissao_reprocessada'
  | 'vinculo_reconciliado'
  | 'config_alterada'
  | 'tool_recusada'
  | 'limite_excedido'
  /** Coleta diária da Organizations API (RF-51, RF-52, T-124) — toca a Atlassian,
   * então é auditada mesmo quando falha. */
  | 'inventario_coletado'

export interface EntradaAuditoria {
  readonly atorEmail: string
  readonly acao: AcaoAuditada
  readonly recurso?: string | null
  readonly resultado: ResultadoAcao
  readonly detalhe?: Readonly<Record<string, unknown>>
}

export interface RegistroAuditoria {
  readonly id: string
  readonly ator_email: string
  readonly acao: string
  readonly recurso: string | null
  readonly resultado: ResultadoAcao
  readonly detalhe_json: string | null
  readonly criado_em: string
}

/**
 * Chaves cujo valor nunca vai para o registro — RNF-01: credencial não aparece em
 * log. A auditoria é gravada por muitos pontos do código; confiar em cada chamador
 * lembrar disso é frágil, então a redação acontece AQUI, uma vez.
 */
const CHAVES_SENSIVEIS = /(token|senha|password|secret|api[_-]?key|authorization|bearer|cookie)/i

export function redigirSensiveis(
  detalhe: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const saida: Record<string, unknown> = {}
  for (const [chave, valor] of Object.entries(detalhe)) {
    if (CHAVES_SENSIVEIS.test(chave)) {
      saida[chave] = '[REDIGIDO]'
      continue
    }
    saida[chave] =
      valor && typeof valor === 'object' && !Array.isArray(valor)
        ? redigirSensiveis(valor as Record<string, unknown>)
        : valor
  }
  return saida
}

export interface Auditoria {
  registrar(entrada: EntradaAuditoria): Promise<void>
  listarPorAtor(email: string, limite: number): Promise<readonly RegistroAuditoria[]>
  /**
   * Registros recentes de **todos** os atores — a leitura do console de admin
   * (`RF-56`). Separada de `listarPorAtor` de propósito: o nome diz que ela não
   * filtra, então usá-la numa rota de colaborador é bug visível na revisão.
   */
  listarRecentes(limite: number): Promise<readonly RegistroAuditoria[]>
}

export class AuditoriaBanco implements Auditoria {
  constructor(
    private readonly db: Banco,
    private readonly agora: () => string,
    private readonly novoId: () => string,
  ) {}

  async registrar(entrada: EntradaAuditoria): Promise<void> {
    const detalhe = entrada.detalhe ? JSON.stringify(redigirSensiveis(entrada.detalhe)) : null
    await this.db.exec(
      `INSERT INTO auditoria (id, ator_email, acao, recurso, resultado, detalhe_json, criado_em)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        this.novoId(),
        entrada.atorEmail,
        entrada.acao,
        entrada.recurso ?? null,
        entrada.resultado,
        detalhe,
        this.agora(),
      ],
    )
  }

  async listarRecentes(limite: number): Promise<readonly RegistroAuditoria[]> {
    const r = await this.db.query(
      `SELECT id, ator_email, acao, recurso, resultado, detalhe_json, criado_em
         FROM auditoria ORDER BY criado_em DESC, rowid DESC LIMIT ?`,
      [limite],
    )
    return linhasComoObjetos<RegistroAuditoria>(r)
  }

  async listarPorAtor(email: string, limite: number): Promise<readonly RegistroAuditoria[]> {
    const r = await this.db.query(
      `SELECT id, ator_email, acao, recurso, resultado, detalhe_json, criado_em
         FROM auditoria WHERE ator_email = ? ORDER BY criado_em DESC LIMIT ?`,
      [email, limite],
    )
    return linhasComoObjetos<RegistroAuditoria>(r)
  }
}
