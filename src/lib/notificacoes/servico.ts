/**
 * O serviço de notificação — RF-44 a RF-48.
 *
 * ## A decisão central: webhook e polling NÃO têm lógica própria
 *
 * O reflexo é o webhook ler o evento do payload (`comment.body`, `changelog.items`) e
 * o polling ler o chamado pela API. Dois caminhos, duas leituras, dois formatos de
 * carimbo — e a dedupe de `RF-47` deixa de funcionar exatamente onde precisa
 * funcionar, porque o mesmo fato produz chaves diferentes em cada caminho.
 *
 * Aqui os dois só **disparam a mesma sincronização**: `sincronizarChamado(issueKey)`.
 * O webhook diz "olhe este chamado agora", o cron diz "olhe estes que mudaram". Quem
 * decide o que é novo é sempre este arquivo, lendo sempre a mesma fonte (a API), o que
 * torna a chave de dedupe idêntica por construção em vez de por coincidência.
 *
 * O bônus é de segurança: o corpo do webhook é **entrada não confiável** e passa a ser
 * usado só como *ponteiro* (uma chave de chamado), nunca como conteúdo. Um evento
 * forjado com `comment.body: "clique aqui https://…"` não tem como virar mensagem
 * enviada — o app relê o comentário da Atlassian.
 */

import type { ClienteAtlassian, Prioridade } from '../atlassian/tipos'
import { ehComentarioDoSolicitante } from '../atlassian/comentarios'
import {
  conjuntoDeArquivosNossos,
  ehComentarioSoDeAnexoNosso,
} from '../tickets/comentario-de-anexo'
import type { Auditoria } from '../audit'
import type { RepositorioVinculos } from '../tickets/vinculos'
import { RepositorioAcoesProprias } from './acoes'
import {
  RepositorioAlertasSla,
  RepositorioAvaliacoesSla,
  RepositorioNotificacoes,
  type FonteNotificacao,
  type Notificacao,
} from './dedupe'
import {
  mensagemChamadoCriado,
  mensagemComentarioPublico,
  mensagemSlaEmRisco,
  mensagemStatusAlterado,
} from './mensagens'
import type { RepositorioPreferencias } from './preferencias'
import { avaliarSla, primeiraRespostaDoTime } from './sla'
import { ErroCanal, type Canal, type Mensagem, type NomeCanal, type TipoEvento } from './tipos'

/** Tentativas antes de desistir de um envio transitório (mesmo espírito do outbox). */
export const MAX_TENTATIVAS_ENVIO = 5

export interface ValoresNotificacao {
  /** Q11 — `null` significa "ninguém decidiu ainda"; ver `preferencias.ts`. */
  readonly canalPadrao: NomeCanal | null
  /** Base pública do app, para o link da mensagem. `null` = mensagem sem link. */
  readonly baseApp: string | null
  /** RF-46 — fração do prazo a partir da qual o SLA entra em risco. */
  readonly fracaoAvisoSla: number
}

export type ResultadoEnfileiramento = 'nova' | 'duplicada' | 'suprimida_acao_propria' | 'sem_canal'

export class ServicoNotificacoes {
  constructor(
    private readonly notificacoes: RepositorioNotificacoes,
    private readonly alertasSla: RepositorioAlertasSla,
    private readonly avaliacoesSla: RepositorioAvaliacoesSla,
    private readonly acoes: RepositorioAcoesProprias,
    private readonly preferencias: RepositorioPreferencias,
    private readonly vinculos: RepositorioVinculos,
    private readonly atlassian: ClienteAtlassian,
    /** Resolve o canal pelo nome — injetado para o teste usar `CanalFake`. */
    private readonly canalPor: (nome: NomeCanal) => Canal,
    private readonly auditoria: Auditoria,
    private readonly novoId: () => string,
    private readonly agora: () => string,
    /**
     * `D-56` — os arquivos que **o app** pôs no chamado, para o SLA não contar o
     * comentário que o JSM cria para carregá-los como resposta do time.
     *
     * Opcional pelo mesmo motivo de `anexosEnviados` em `ServicoChamados`: quem monta o
     * serviço à mão (testes, caminhos antigos) não passa a exigir um repositório que não
     * usa — e sem ele o comportamento é o de antes.
     */
    private readonly anexosEnviados?: {
      listarDoSolicitante(
        issueKey: string,
        email: string,
      ): Promise<readonly { nomeArquivo: string }[]>
    },
  ) {}

  /**
   * Enfileira um aviso, aplicando as três travas na ordem certa.
   *
   * 1. **Ação própria** (`RF-48`) — a pessoa não é avisada do que ela mesma fez.
   * 2. **Dedupe** (`RF-47`) — pela constraint, não por `SELECT`.
   * 3. **Canal** (`RF-45`) — sem canal, `suprimida`, e isso aparece na métrica.
   *
   * A ordem importa: checar canal antes de ação própria gravaria "suprimida por falta
   * de canal" para um aviso que nunca deveria existir, e a métrica de Q11 contaria
   * avisos fantasmas.
   */
  async enfileirar(dados: {
    issueKey: string
    destinatarioEmail: string
    tipoEvento: TipoEvento
    carimboMudanca: string
    fonte: FonteNotificacao
    mensagem: Mensagem
    /** Conteúdo que identifica a ação, quando ela pode ter sido do próprio usuário. */
    conteudoDaAcao?: string
    valores: ValoresNotificacao
  }): Promise<ResultadoEnfileiramento> {
    if (dados.conteudoDaAcao !== undefined) {
      const propria = await this.acoes.ehAcaoPropria({
        issueKey: dados.issueKey,
        tipoEvento: dados.tipoEvento,
        conteudo: dados.conteudoDaAcao,
      })
      if (propria) {
        // Gravada como `suprimida`, não descartada: sem o registro, a dedupe não
        // reconheceria o fato quando a OUTRA fonte o trouxesse, e o polling notificaria
        // o comentário que o webhook já tinha suprimido.
        await this.notificacoes.registrar({
          id: this.novoId(),
          issueKey: dados.issueKey,
          destinatarioEmail: dados.destinatarioEmail,
          tipoEvento: dados.tipoEvento,
          carimboMudanca: dados.carimboMudanca,
          fonte: dados.fonte,
          canal: null,
          destino: null,
          mensagem: dados.mensagem,
          estado: 'suprimida',
        })
        return 'suprimida_acao_propria'
      }
    }

    const preferencia = await this.preferencias.obterEfetiva(
      dados.destinatarioEmail,
      dados.valores.canalPadrao,
    )
    const semCanal = preferencia.canal === 'nenhum'
    const destino = preferencia.destino ?? dados.destinatarioEmail

    const r = await this.notificacoes.registrar({
      id: this.novoId(),
      issueKey: dados.issueKey,
      destinatarioEmail: dados.destinatarioEmail,
      tipoEvento: dados.tipoEvento,
      carimboMudanca: dados.carimboMudanca,
      fonte: dados.fonte,
      canal: semCanal ? null : preferencia.canal,
      destino: semCanal ? null : destino,
      mensagem: dados.mensagem,
      estado: semCanal ? 'suprimida' : 'pendente',
    })

    if (!r.nova) return 'duplicada'
    return semCanal ? 'sem_canal' : 'nova'
  }

  /** Aviso de criação (RF-44). Chamado no momento em que o chamado nasce. */
  async avisarCriacao(dados: {
    issueKey: string
    solicitanteEmail: string
    titulo: string
    prioridade: Prioridade
    slaPrimeiraRespostaHoras: number
    criadoEm: string
    valores: ValoresNotificacao
  }): Promise<ResultadoEnfileiramento> {
    return this.enfileirar({
      issueKey: dados.issueKey,
      destinatarioEmail: dados.solicitanteEmail,
      tipoEvento: 'chamado_criado',
      carimboMudanca: dados.criadoEm,
      // `app`: nem webhook nem polling — o app sabe da criação porque ele criou.
      fonte: 'app',
      mensagem: mensagemChamadoCriado({
        issueKey: dados.issueKey,
        titulo: dados.titulo,
        prioridade: dados.prioridade,
        slaPrimeiraRespostaHoras: dados.slaPrimeiraRespostaHoras,
        baseApp: dados.valores.baseApp,
      }),
      valores: dados.valores,
    })
  }

  /**
   * A sincronização — o único lugar que decide o que é novo num chamado.
   *
   * Devolve contagem em vez de lançar quando a Atlassian falha: uma indisponibilidade
   * não pode derrubar a rodada dos outros chamados (`RNF-18`), e o polling volta na
   * próxima janela porque a marca-d'água **só avança no que deu certo**.
   */
  async sincronizarChamado(
    issueKey: string,
    fonte: FonteNotificacao,
    valores: ValoresNotificacao,
  ): Promise<{ eventos: number; ok: boolean }> {
    const vinculo = await this.vinculos.obterParaNotificacao_semIsolamento(issueKey)
    // Sem vínculo local não há a quem avisar. É o caso do evento forjado (T-201) e
    // também o do chamado que o time de tech abriu direto no Jira — os dois terminam
    // aqui, sem efeito e sem resposta diferente.
    if (!vinculo) return { eventos: 0, ok: true }

    let chamado
    let comentarios: readonly { id: string; corpo: string; autorNome: string; criadoEm: string }[]
    try {
      chamado = await this.atlassian.obterChamado(issueKey)
      comentarios = await this.atlassian.listarComentariosPublicos(issueKey)
    } catch {
      return { eventos: 0, ok: false }
    }

    let eventos = 0

    // --- status (RF-44) -----------------------------------------------------
    // Compara STATUS, não `updated`: `updated` muda quando alguém edita qualquer
    // campo, e a pessoa receberia "mudou para Em andamento" a cada edição.
    if (chamado.status && chamado.status !== vinculo.ultimoStatusNotificado) {
      const r = await this.enfileirar({
        issueKey,
        destinatarioEmail: vinculo.solicitanteEmail,
        tipoEvento: 'status_alterado',
        carimboMudanca: chamado.atualizadoEm,
        fonte,
        mensagem: mensagemStatusAlterado({
          issueKey,
          status: chamado.status,
          baseApp: valores.baseApp,
        }),
        // ⚠️ RF-48 também vale para status: quem clicou em "marcar como resolvido" no app
        // não pode receber "seu chamado mudou para Resolvido" logo depois. A rota registra
        // o status resultante como ação própria (ver `rotas.ts`), e é ele que casa aqui.
        conteudoDaAcao: chamado.status,
        valores,
      })
      if (r === 'nova') eventos += 1
      // O marcador avança mesmo em `duplicada`/`sem_canal`: o fato foi processado, e
      // não avançar faria a próxima rodada tentar de novo para sempre.
      await this.vinculos.marcarSincronizado(issueKey, {
        ultimoStatusNotificado: chamado.status,
      })
    }

    // --- comentários públicos (RF-44, RF-48) -------------------------------
    // ⚠️ Sem marca (`notificadoAte` nulo) o corte é `-Infinity`, **não `0`**: `0` é a
    // epoch, e comentário com carimbo exatamente na epoch — o que o fake usa, e o que uma
    // data ausente do Jira produz — cairia no `<=` e desapareceria. "Nunca sincronizei"
    // tem de significar "tudo é novo", não "tudo depois de 1970".
    const desdeMs = vinculo.notificadoAte
      ? Date.parse(vinculo.notificadoAte)
      : Number.NEGATIVE_INFINITY
    let maiorCarimbo = vinculo.notificadoAte
    for (const c of comentarios) {
      const ms = Date.parse(c.criadoEm)
      if (!Number.isFinite(ms)) continue
      if (Number.isFinite(desdeMs) && ms <= desdeMs) continue
      const r = await this.enfileirar({
        issueKey,
        destinatarioEmail: vinculo.solicitanteEmail,
        tipoEvento: 'comentario_publico',
        carimboMudanca: c.criadoEm,
        fonte,
        mensagem: mensagemComentarioPublico({
          issueKey,
          autorNome: c.autorNome,
          corpo: c.corpo,
          baseApp: valores.baseApp,
        }),
        // ⚠️ A supressão de ação própria depende deste campo. Sob proxy total o autor
        // não distingue nada (ver `acoes.ts`).
        conteudoDaAcao: c.corpo,
        valores,
      })
      if (r === 'nova') eventos += 1
      if (!maiorCarimbo || ms > Date.parse(maiorCarimbo)) maiorCarimbo = c.criadoEm
    }
    if (maiorCarimbo !== vinculo.notificadoAte) {
      await this.vinculos.marcarSincronizado(issueKey, { notificadoAte: maiorCarimbo })
    }

    return { eventos, ok: true }
  }

  /**
   * Alerta de SLA de primeira resposta (RF-46, T-231).
   *
   * ⚠️ **O destino do alerta é decisão de produto em aberto** — a spec marca T-231 como
   * bloqueada por isso. O que está resolvido: *quando* alertar (cálculo puro em
   * `sla.ts`), *não repetir* (tabela `alertas_sla`) e *para quem*, no único destino que
   * o app conhece com certeza hoje — o **solicitante**. O dia em que se decidir alertar
   * o time de tech ou a liderança, é um destinatário a mais nesta função, com o mesmo
   * enfileiramento; nada do cálculo muda.
   */
  async avaliarESinalizarSla(
    vinculo: { issueKey: string; solicitanteEmail: string },
    valores: ValoresNotificacao,
  ): Promise<{ estado: string; alertou: boolean }> {
    let chamado
    let comentarios
    try {
      chamado = await this.atlassian.obterChamado(vinculo.issueKey)
      comentarios = await this.atlassian.listarComentariosPublicos(vinculo.issueKey)
    } catch {
      return { estado: 'indisponivel', alertou: false }
    }

    // Chamado sem prioridade conhecida não tem prazo a cobrar: `normal` seria inventar
    // um SLA de 24h para algo que talvez fosse crítico.
    if (!chamado.prioridade) return { estado: 'sem_prioridade', alertou: false }

    // `D-56` — sem isto, o comentário que o JSM cria para carregar o anexo (sem o prefixo
    // de `D-13`, porque não passou por `prefixarAutoria`) contava como resposta do time, e
    // **todo** chamado com anexo nascia com o SLA satisfeito. Falha de leitura aqui não
    // pode derrubar a avaliação: conjunto vazio devolve o comportamento anterior, que é
    // super-contar resposta — e o alerta a mais é o lado seguro do erro.
    let arquivosNossos: ReadonlySet<string> = new Set()
    try {
      const enviados = await this.anexosEnviados?.listarDoSolicitante(
        vinculo.issueKey,
        vinculo.solicitanteEmail,
      )
      if (enviados) arquivosNossos = conjuntoDeArquivosNossos(enviados)
    } catch {
      // Silêncio deliberado — ver acima.
    }

    const primeiraResposta = primeiraRespostaDoTime(
      comentarios,
      ehComentarioDoSolicitante,
      (corpo) => ehComentarioSoDeAnexoNosso(corpo, arquivosNossos),
    )
    const avaliacao = avaliarSla({
      criadoEm: chamado.criadoEm,
      prioridade: chamado.prioridade,
      primeiraRespostaEm: primeiraResposta,
      agoraMs: Date.parse(this.agora()),
      fracaoAviso: valores.fracaoAvisoSla,
    })

    // ⚠️ Grava o RETRATO antes de decidir alertar, e mesmo quando não alerta: é o que o
    // painel de admin lê (`T-232`). Gravar só quando alerta faria a aderência ao SLA
    // contar apenas os chamados problemáticos — 0% de aderência por construção.
    await this.avaliacoesSla.registrar({
      issueKey: vinculo.issueKey,
      estado: avaliacao.estado,
      prazoEm: avaliacao.prazoEm,
      respondidaEm: primeiraResposta,
      dentroDoPrazo:
        primeiraResposta === null
          ? null
          : Date.parse(primeiraResposta) <= Date.parse(avaliacao.prazoEm),
    })

    if (avaliacao.estado !== 'risco' && avaliacao.estado !== 'estourado') {
      return { estado: avaliacao.estado, alertou: false }
    }

    // A tabela é o que impede o mesmo alerta a cada rodada do cron — sem ela, o alerta
    // vira ruído e o time aprende a ignorá-lo.
    const primeiraVez = await this.alertasSla.registrarSePrimeiraVez(
      vinculo.issueKey,
      avaliacao.estado,
    )
    if (!primeiraVez) return { estado: avaliacao.estado, alertou: false }

    await this.enfileirar({
      issueKey: vinculo.issueKey,
      destinatarioEmail: vinculo.solicitanteEmail,
      tipoEvento: 'sla_em_risco',
      // O carimbo é o PRAZO, não `agora()`: é o que torna o alerta idempotente entre
      // as duas fontes e entre rodadas.
      carimboMudanca: avaliacao.prazoEm,
      fonte: 'app',
      mensagem: mensagemSlaEmRisco({
        issueKey: vinculo.issueKey,
        horasRestantes: Math.max(0, Math.ceil(avaliacao.horasRestantes ?? 0)),
        estourado: avaliacao.estado === 'estourado',
        baseApp: valores.baseApp,
      }),
      valores,
    })
    return { estado: avaliacao.estado, alertou: true }
  }


  /**
   * Despacha a fila (T-225).
   *
   * Falha de envio **não perde** a notificação: transitório volta pendente, definitivo
   * vira `falha` e fica visível. Mesma lógica do outbox de chamados — e pelo mesmo
   * motivo, porque "o canal piscou" não pode virar "o aviso nunca existiu".
   */
  async despacharPendentes(limite: number): Promise<{ enviadas: number; falhas: number; pendentes: number }> {
    const fila = await this.notificacoes.listarPendentes(limite)
    let enviadas = 0
    let falhas = 0
    for (const n of fila) {
      const resultado = await this.despachar(n)
      if (resultado) enviadas += 1
      else falhas += 1
    }
    const restantes = await this.notificacoes.listarPendentes(limite)
    return { enviadas, falhas, pendentes: restantes.length }
  }

  private async despachar(n: Notificacao): Promise<boolean> {
    if (!n.canal || n.canal === 'nenhum' || !n.destino) {
      await this.notificacoes.registrarTentativaFalha(
        n.id,
        'sem canal ou destino',
        false,
        MAX_TENTATIVAS_ENVIO,
      )
      return false
    }
    try {
      await this.canalPor(n.canal).enviar(n.destino, {
        titulo: n.titulo,
        corpo: n.corpo,
        link: null,
      })
      await this.notificacoes.marcarEnviada(n.id)
      await this.auditoria.registrar({
        atorEmail: '(cron)',
        acao: 'notificacao_enviada',
        recurso: n.issueKey,
        resultado: 'sucesso',
        // ⚠️ O CORPO não vai para a auditoria: ele carrega trecho de comentário de
        // chamado, e auditoria é lida por admin (RNF-30, RF-30).
        detalhe: { tipoEvento: n.tipoEvento, canal: n.canal },
      })
      return true
    } catch (e) {
      const transitorio = e instanceof ErroCanal ? e.detalhe.transitorio : true
      await this.notificacoes.registrarTentativaFalha(
        n.id,
        e instanceof Error ? e.message : String(e),
        transitorio,
        MAX_TENTATIVAS_ENVIO,
      )
      await this.auditoria.registrar({
        atorEmail: '(cron)',
        acao: 'notificacao_enviada',
        recurso: n.issueKey,
        resultado: 'falha',
        detalhe: { tipoEvento: n.tipoEvento, canal: n.canal, transitorio },
      })
      return false
    }
  }
}
