/**
 * Modo somente leitura — a trava para desenvolver **com credencial real**.
 *
 * ## O problema que ela resolve
 *
 * O modo demonstração (`D-07`) é tudo-ou-nada: ou o app usa fakes em tudo, ou fala com a
 * Atlassian de verdade em tudo. Falta o estado do meio, que é onde o projeto está agora:
 * credenciais reais registradas, **querendo ler** o Confluence e o histórico do Jira para
 * mostrar o produto funcionando, e **não querendo escrever nada** — nem chamado, nem
 * comentário, nem anexo, nem transição.
 *
 * Sem esse estado, mostrar o app com dado real exigiria aceitar que um clique errado abre
 * um chamado de verdade na fila do time de tech. É exatamente o tipo de risco que não se
 * gerencia com cuidado: se gerencia com trava.
 *
 * ## Por que um DECORADOR e não um `if` nas rotas
 *
 * Mesmo raciocínio de `agent/gate.ts`: a trava tem de estar onde não dá para esquecer. Um
 * `if (ctx.somenteLeitura)` em cada rota de escrita é uma lista que envelhece — a próxima
 * rota de escrita nasce sem ele e ninguém percebe. Aqui, quem envolve o cliente **não tem
 * como** chamar um método de escrita: ele lança antes de tocar a rede.
 *
 * E a lista de métodos bloqueados é fechada pelo compilador: `ClienteAtlassian` é a
 * interface, e implementar todos os métodos é obrigatório. Um método de escrita novo
 * aparece aqui como erro de tipo até alguém decidir de que lado ele fica.
 *
 * ⚠️ **A leitura passa inteira.** Busca, página, anexo de leitura, histórico e health
 * continuam iguais — a trava é sobre efeito colateral, não sobre acesso.
 */

import {
  ErroAtlassian,
  type AnexoDoChamado,
  type BuscaConfluenceParams,
  type CampoRequestType,
  type Chamado,
  type ChamadoCriado,
  type ClienteAtlassian,
  type ComentarioPublico,
  type EspacoConfluence,
  type FilhosParams,
  type HistoricoParams,
  type MetadadosPagina,
  type NovoChamado,
  type PaginaConfluence,
  type ResultadoAnexo,
  type TicketHistorico,
  type TipoChamado,
} from './tipos'
import type { CampoDoSchema } from './schema-diagnostico'

/** Mensagem única, em linguagem de negócio — ela chega ao usuário (RNF-30). */
export const MENSAGEM_SOMENTE_LEITURA =
  'O goatlas está em modo somente leitura: consulta à documentação e aos chamados funciona, mas nada é criado ou alterado no Jira. Fale com o time de tech se precisar abrir um chamado agora.'

export class ClienteAtlassianSomenteLeitura implements ClienteAtlassian {
  constructor(private readonly real: ClienteAtlassian) {}

  /**
   * Toda escrita passa por aqui.
   *
   * `transitorio: false` de propósito: não é indisponibilidade, é recusa. Marcar como
   * transitório faria o outbox reprocessar para sempre uma submissão que **nunca** vai
   * ser aceita enquanto a trava estiver ligada.
   */
  private recusar(operacao: string): never {
    throw new ErroAtlassian(MENSAGEM_SOMENTE_LEITURA, {
      transitorio: false,
      recurso: operacao,
    })
  }

  // --- ESCRITA: bloqueada -------------------------------------------------
  async criarChamado(_dados: NovoChamado): Promise<ChamadoCriado> {
    this.recusar('criarChamado')
  }

  // Os parâmetros são declarados mesmo sem uso: a assinatura idêntica à da interface é o
  // que faz o compilador acusar quando um método de escrita novo aparecer em
  // `ClienteAtlassian` e ninguém decidir de que lado dele ele fica.
  async comentar(
    _issueKey: string,
    _corpo: string,
    _autorEmail: string,
    _autorNome?: string,
  ): Promise<void> {
    this.recusar('comentar')
  }

  async anexarArquivo(
    _serviceDeskId: string,
    _issueKey: string,
    _arquivo: { nome: string; tipo: string; bytes: ArrayBuffer },
  ): Promise<void> {
    this.recusar('anexarArquivo')
  }

  /**
   * ⚠️ **O upload temporário é escrita, mesmo sem `issueKey`** — `SC-10`.
   *
   * Ele consome armazenamento na Atlassian e gasta a credencial única, e o único motivo
   * de existir é virar anexo de um chamado. Deixá-lo passar "porque não altera nada"
   * produziria o pior resultado possível do modo somente leitura: a tela dizendo
   * "arquivo enviado", a pessoa confirmando, e a criação sendo recusada depois — com o
   * arquivo já lá. Recusa honesta e explícita, nunca sucesso simulado.
   */
  async subirAnexoTemporario(
    _serviceDeskId: string,
    _arquivo: { nome: string; tipo: string; bytes: ArrayBuffer },
  ): Promise<string> {
    this.recusar('subirAnexoTemporario')
  }

  async materializarAnexosTemporarios(_issueKey: string, _ids: readonly string[]): Promise<void> {
    this.recusar('materializarAnexosTemporarios')
  }

  async transicionar(_issueKey: string, _transicaoId: string): Promise<void> {
    this.recusar('transicionar')
  }

  // --- LEITURA: passa inteira ---------------------------------------------
  listarTiposChamado(): Promise<readonly TipoChamado[]> {
    return this.real.listarTiposChamado()
  }

  obterCamposDoTipo(sd: string, rt: string): Promise<readonly CampoRequestType[]> {
    return this.real.obterCamposDoTipo(sd, rt)
  }

  /**
   * ⚠️ Leitura, e tem de continuar passando **justamente aqui**: a pergunta que este
   * método responde ("o request type expõe prioridade?") só se responde contra a
   * Atlassian real, e o app real está em somente leitura (`D-24`). Um diagnóstico que a
   * trava recusa é um diagnóstico que nunca roda.
   */
  obterSchemaDoTipo(sd: string, rt: string): Promise<readonly CampoDoSchema[]> {
    return this.real.obterSchemaDoTipo(sd, rt)
  }

  obterChamado(issueKey: string): Promise<Chamado> {
    return this.real.obterChamado(issueKey)
  }

  listarComentariosPublicos(issueKey: string): Promise<readonly ComentarioPublico[]> {
    return this.real.listarComentariosPublicos(issueKey)
  }

  listarAnexosDoChamado(issueKey: string): Promise<readonly AnexoDoChamado[]> {
    return this.real.listarAnexosDoChamado(issueKey)
  }

  obterAnexoDoChamado(issueKey: string, nomeArquivo: string): Promise<ResultadoAnexo> {
    return this.real.obterAnexoDoChamado(issueKey, nomeArquivo)
  }

  buscarConfluence(params: BuscaConfluenceParams): Promise<readonly PaginaConfluence[]> {
    return this.real.buscarConfluence(params)
  }

  obterMetadadosPagina(id: string): Promise<MetadadosPagina> {
    return this.real.obterMetadadosPagina(id)
  }

  obterEspaco(chave: string): Promise<EspacoConfluence> {
    return this.real.obterEspaco(chave)
  }

  listarFilhosDaPagina(params: FilhosParams): Promise<readonly PaginaConfluence[]> {
    return this.real.listarFilhosDaPagina(params)
  }

  paginaRestrita(id: string): Promise<boolean> {
    return this.real.paginaRestrita(id)
  }

  obterCorpoStorage(id: string): Promise<string> {
    return this.real.obterCorpoStorage(id)
  }

  obterAnexo(id: string, nome: string): Promise<ResultadoAnexo> {
    return this.real.obterAnexo(id, nome)
  }

  buscarHistoricoTickets(params: HistoricoParams): Promise<readonly TicketHistorico[]> {
    return this.real.buscarHistoricoTickets(params)
  }

  buscarChamadosAtualizadosDesde(params: {
    desde: string | null
    limite: number
  }): Promise<readonly { issueKey: string; atualizadoEm: string }[]> {
    return this.real.buscarChamadosAtualizadosDesde(params)
  }

  buscarChamadosPorChaveIdempotencia(chave: string): Promise<readonly ChamadoCriado[]> {
    return this.real.buscarChamadosPorChaveIdempotencia(chave)
  }

  /**
   * ⚠️ Leitura, apesar do nome parecer escrita: só **consulta** quais transições o
   * workflow oferece. Quem executa é `transicionar`, que está bloqueada.
   */
  listarTransicoes(issueKey: string): Promise<readonly { id: string; nome: string }[]> {
    return this.real.listarTransicoes(issueKey)
  }

  telemetria(): { total429: number; totalRequisicoes: number } {
    return this.real.telemetria()
  }

  async verificarSaude(): Promise<{ ok: boolean; detalhe: string }> {
    const r = await this.real.verificarSaude()
    // O health precisa DIZER que está travado: um app somente leitura que se declara
    // "ok" faz alguém concluir que a abertura de chamado está funcionando.
    return { ...r, detalhe: `${r.detalhe} · somente leitura` }
  }
}
