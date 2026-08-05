/**
 * Fake da Organizations API — habilita construir e testar o console de governança
 * inteiro sem a credencial de Org Admin, que não existe ainda (Q1).
 *
 * Mesmo padrão de `atlassian/fake.ts`: estado seedável e falha injetável por
 * operação, para que degradação (RNF-18) seja testável e não só uma frase no
 * documento.
 */

import {
  ErroOrganizacao,
  type ClienteOrganizacao,
  type UltimoAcesso,
  type UltimoAcessoProduto,
  type UsuarioOrganizacao,
} from './organizacao'

export type ModoFalhaOrganizacao = 'nenhum' | 'indisponivel' | 'rate_limit' | 'timeout'

const FALHAS: Readonly<Record<Exclude<ModoFalhaOrganizacao, 'nenhum'>, { status: number; transitorio: boolean }>> =
  Object.freeze({
    indisponivel: { status: 503, transitorio: true },
    rate_limit: { status: 429, transitorio: true },
    timeout: { status: 504, transitorio: true },
  })

export interface EstadoOrganizacaoFake {
  usuarios: UsuarioOrganizacao[]
  /** `accountId` → último acesso por produto. Sem entrada = "nunca coletado". */
  ultimoAcesso: Map<string, UltimoAcessoProduto[]>
  falhas: {
    listarUsuarios: ModoFalhaOrganizacao
    ultimoAcesso: ModoFalhaOrganizacao
    revogarProduto: ModoFalhaOrganizacao
  }
}

export class ClienteOrganizacaoFake implements ClienteOrganizacao {
  readonly estado: EstadoOrganizacaoFake

  constructor(inicial: Partial<EstadoOrganizacaoFake> = {}) {
    this.estado = {
      usuarios: inicial.usuarios ?? [],
      ultimoAcesso: inicial.ultimoAcesso ?? new Map(),
      falhas: {
        listarUsuarios: 'nenhum',
        ultimoAcesso: 'nenhum',
        revogarProduto: 'nenhum',
        ...inicial.falhas,
      },
    }
  }

  private checar(modo: ModoFalhaOrganizacao, recurso: string): void {
    if (modo === 'nenhum') return
    const { status, transitorio } = FALHAS[modo]
    throw new ErroOrganizacao(`fake organização: ${modo}`, { status, transitorio, recurso })
  }

  async listarUsuarios(_orgId: string): Promise<readonly UsuarioOrganizacao[]> {
    this.checar(this.estado.falhas.listarUsuarios, 'listarUsuarios')
    return this.estado.usuarios
  }

  async ultimoAcesso(_orgId: string, accountId: string): Promise<UltimoAcesso> {
    this.checar(this.estado.falhas.ultimoAcesso, 'ultimoAcesso')
    return {
      accountId,
      porProduto: this.estado.ultimoAcesso.get(accountId) ?? [],
      coletadoEm: new Date(0).toISOString(),
    }
  }

  async revogarProduto(_orgId: string, accountId: string, produto: string): Promise<void> {
    this.checar(this.estado.falhas.revogarProduto, 'revogarProduto')
    const usuario = this.estado.usuarios.find((u) => u.accountId === accountId)
    if (!usuario) {
      throw new ErroOrganizacao('usuário não encontrado', {
        status: 404,
        transitorio: false,
        recurso: 'revogarProduto',
      })
    }
    const index = this.estado.usuarios.indexOf(usuario)
    this.estado.usuarios[index] = {
      ...usuario,
      produtos: usuario.produtos.filter((p) => p.chave !== produto),
    }
  }
}
