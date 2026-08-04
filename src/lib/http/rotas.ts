/**
 * Rotas `/api/*`.
 *
 * ## Desenho que sustenta as travas
 *
 * **A identidade é resolvida uma vez, no roteador, e passada adiante.** Nenhum
 * handler recebe e-mail do corpo, da query ou de header customizado (RF-04,
 * RNF-05): eles recebem a `Identidade` já validada. O tipo é o que impede o
 * atalho — um handler não tem como ler um e-mail que não chegou.
 *
 * **A criação de chamado não tem rota "direta".** `POST /api/conversas/:id/criar`
 * chama `ServicoChamados.abrirPorConversa`, que passa pelo gate de RF-08/RF-17. O
 * formulário mínimo tem rota própria (`POST /api/chamados`) porque é um caminho
 * declaradamente diferente (D-04), e ele **marca o chamado como não verificado**.
 */

import { resolverIdentidade, MENSAGEM_NEGACAO, type Identidade } from '../auth'
import type { Contexto } from '../contexto'
import { ERROS, erro, json, lerJson } from './respostas'
import { verificarLimite } from './limite'
import { CriacaoRecusada, MENSAGEM_RECUSA } from '../agent/gate'
import { SLA_PRIMEIRA_RESPOSTA_HORAS, type Prioridade } from '../atlassian/tipos'
import type { PropostaChamado } from '../agent/estado'

export interface EnvCron {
  readonly GODEPLOY_CRON_KEY?: string
}

const PRIORIDADES: readonly Prioridade[] = ['critica', 'alta', 'normal']
const ehPrioridade = (v: unknown): v is Prioridade =>
  typeof v === 'string' && (PRIORIDADES as readonly string[]).includes(v)

export async function tratarRequisicao(
  req: Request,
  ctx: Contexto,
  env: EnvCron,
): Promise<Response> {
  const url = new URL(req.url)
  const caminho = url.pathname

  if (!caminho.startsWith('/api/')) return new Response(null, { status: 404 })

  // Health check é público de propósito: precisa responder mesmo quando o SSO ou
  // a config estão quebrados — é para isso que ele serve (RF-59).
  if (caminho === '/api/health') return await tratarHealth(ctx)

  // Cron é autenticado por header assinado da plataforma, não por sessão.
  if (caminho.startsWith('/api/cron/')) {
    return await tratarCron(req, ctx, env, caminho)
  }

  // --- daqui para baixo, tudo exige identidade válida (RF-01, RF-05) ---------
  const auth = await resolverIdentidade(req.headers, ctx.config)
  if (!auth.ok) {
    await ctx.auditoria.registrar({
      atorEmail: auth.emailTentado ?? '(sem identidade)',
      acao: 'acesso_negado',
      recurso: caminho,
      resultado: 'negado',
      detalhe: { motivo: auth.motivo },
    })
    return erro(MENSAGEM_NEGACAO[auth.motivo], 'acesso_negado', 403)
  }
  const eu = auth.identidade

  if (caminho === '/api/auth/me' && req.method === 'GET') {
    return json({ email: eu.email, nome: eu.nome, isAdmin: eu.isAdmin })
  }

  // RNF-11 — rate limit por usuário, antes de qualquer trabalho caro.
  if (req.method === 'POST') {
    const limite = await verificarLimite(
      ctx.db,
      eu.email,
      ctx.valores.limite_requisicoes_por_minuto,
      Date.parse(ctx.agora()),
    )
    if (!limite.permitido) {
      await ctx.auditoria.registrar({
        atorEmail: eu.email,
        acao: 'limite_excedido',
        recurso: caminho,
        resultado: 'negado',
        detalhe: { usadas: limite.usadas, limite: limite.limite },
      })
      return ERROS.limiteRequisicoes()
    }
  }

  try {
    return await rotear(req, ctx, eu, caminho, url)
  } catch (e) {
    if (e instanceof CriacaoRecusada) {
      return ERROS.regraDeCriacao(e.motivos.map((m) => MENSAGEM_RECUSA[m]))
    }
    // Erro inesperado nunca vaza detalhe (RNF-01, RNF-30), mas é auditado.
    await ctx.auditoria.registrar({
      atorEmail: eu.email,
      acao: 'acesso_negado',
      recurso: caminho,
      resultado: 'falha',
      detalhe: { erro: e instanceof Error ? e.message : String(e) },
    })
    return ERROS.interno()
  }
}

async function rotear(
  req: Request,
  ctx: Contexto,
  eu: Identidade,
  caminho: string,
  url: URL,
): Promise<Response> {
  // --- conversa -------------------------------------------------------------
  if (caminho === '/api/conversas' && req.method === 'POST') {
    const conversa = await ctx.conversas.criar(ctx.novoId(), eu.email)
    await ctx.auditoria.registrar({
      atorEmail: eu.email,
      acao: 'conversa_iniciada',
      recurso: conversa.id,
      resultado: 'sucesso',
    })
    return json({ id: conversa.id, estado: conversa.estado }, 201)
  }

  const mensagens = caminho.match(/^\/api\/conversas\/([^/]+)\/mensagens$/)
  if (mensagens && req.method === 'POST') {
    const corpo = await lerJson<{ texto?: unknown }>(req)
    const texto = typeof corpo?.texto === 'string' ? corpo.texto.trim() : ''
    if (!texto) return ERROS.dadosInvalidos('Escreva sua mensagem antes de enviar.')

    // Isolamento: a conversa tem de ser DESTE e-mail (RF-30, RNF-05).
    const conversa = await ctx.conversas.obterDoSolicitante(mensagens[1]!, eu.email)
    if (!conversa) return ERROS.naoEncontrado()

    await ctx.auditoria.registrar({
      atorEmail: eu.email,
      acao: 'mensagem_enviada',
      recurso: conversa.id,
      resultado: 'sucesso',
    })
    const r = await ctx.orquestrador.processarMensagem(conversa, texto, ctx.valores)
    const depois = await ctx.conversas.obterDoSolicitante(conversa.id, eu.email)
    return json({
      texto: r.texto,
      bloqueado: r.bloqueado,
      regraBloqueio: r.regraBloqueio,
      // RNF-12: a UI precisa mostrar progresso das duas verificações.
      verificacoes: {
        confluence: estadoVerificacao(depois?.confluenceVerificado, depois?.confluenceFalhou),
        historico: estadoVerificacao(depois?.historicoVerificado, depois?.historicoFalhou),
      },
      podeConfirmar: Boolean(depois?.proposta),
      proposta: depois?.proposta ?? null,
      tetoCustoAtingido: r.tetoCustoAtingido,
    })
  }

  // RF-13 / RN-07 — override. Bloqueio é orientação, não parede.
  const override = caminho.match(/^\/api\/conversas\/([^/]+)\/override$/)
  if (override && req.method === 'POST') {
    const conversa = await ctx.conversas.obterDoSolicitante(override[1]!, eu.email)
    if (!conversa) return ERROS.naoEncontrado()
    const corpo = await lerJson<{ motivo?: unknown }>(req)
    const motivo = typeof corpo?.motivo === 'string' ? corpo.motivo.trim() : ''
    if (!motivo) {
      return ERROS.dadosInvalidos(
        'Conte rapidamente o que a documentação não resolveu — isso ajuda a melhorá-la.',
      )
    }
    const sobrepostos = await ctx.conversas.registrarOverride(conversa.id, motivo)
    await ctx.auditoria.registrar({
      atorEmail: eu.email,
      acao: 'override_registrado',
      recurso: conversa.id,
      resultado: 'sucesso',
      detalhe: { bloqueiosSobrepostos: sobrepostos, motivo },
    })

    // O override é o sinal de seguir: monta a proposta na hora, em vez de deixar a
    // pessoa num beco sem saída depois de ela ter insistido (RF-13).
    const liberada = await ctx.conversas.obterDoSolicitante(conversa.id, eu.email)
    let proposta = liberada?.proposta ?? null
    if (liberada && !proposta) {
      await ctx.orquestrador.montarPropostaAgora(liberada, ctx.valores)
      proposta = (await ctx.conversas.obterDoSolicitante(conversa.id, eu.email))?.proposta ?? null
    }
    return json({ ok: true, bloqueiosSobrepostos: sobrepostos, proposta })
  }

  // RF-16 / RF-18 — a proposta é montada/editada antes de confirmar.
  const proposta = caminho.match(/^\/api\/conversas\/([^/]+)\/proposta$/)
  if (proposta && req.method === 'PUT') {
    const conversa = await ctx.conversas.obterDoSolicitante(proposta[1]!, eu.email)
    if (!conversa) return ERROS.naoEncontrado()
    const corpo = await lerJson<Record<string, unknown>>(req)
    const validada = validarProposta(corpo, ctx.valores.tipos_chamado_permitidos)
    if ('erro' in validada) return ERROS.dadosInvalidos(validada.erro)
    await ctx.conversas.definirProposta(conversa.id, validada.proposta)
    return json({
      proposta: validada.proposta,
      slaPrimeiraRespostaHoras: SLA_PRIMEIRA_RESPOSTA_HORAS[validada.proposta.prioridade],
    })
  }

  // RF-17 / RN-02 — a ÚNICA transição que autoriza criar. Só o usuário chega aqui.
  const confirmar = caminho.match(/^\/api\/conversas\/([^/]+)\/confirmar$/)
  if (confirmar && req.method === 'POST') {
    const conversa = await ctx.conversas.obterDoSolicitante(confirmar[1]!, eu.email)
    if (!conversa) return ERROS.naoEncontrado()
    if (!conversa.proposta) {
      return ERROS.dadosInvalidos('Ainda não há um chamado montado para confirmar.')
    }
    await ctx.conversas.registrarConfirmacao(conversa.id)
    await ctx.auditoria.registrar({
      atorEmail: eu.email,
      acao: 'confirmacao_registrada',
      recurso: conversa.id,
      resultado: 'sucesso',
    })

    const atual = await ctx.conversas.obterDoSolicitante(conversa.id, eu.email)
    const serviceDeskId = ctx.valores.service_desk_id
    if (!serviceDeskId) {
      // RNF-25 + Q1: sem service desk configurado não se inventa um.
      return ERROS.dadosInvalidos(
        'A abertura de chamados ainda não foi configurada nesta instalação. Fale com o time de tech.',
      )
    }
    // A chave de idempotência é derivada da CONVERSA, não gerada por requisição:
    // é o que faz duplo clique e reenvio caírem na mesma submissão (RF-24).
    const r = await ctx.chamados.abrirPorConversa(
      atual!,
      serviceDeskId,
      `conversa:${conversa.id}`,
    )
    if (r.estado === 'criado') await ctx.conversas.definirEstado(conversa.id, 'criado')
    return json(respostaCriacao(r, atual!.proposta!.prioridade), 201)
  }

  // --- formulário mínimo, caminho sem IA (D-04) -----------------------------
  if (caminho === '/api/chamados' && req.method === 'POST') {
    const corpo = await lerJson<Record<string, unknown>>(req)
    const validada = validarProposta(corpo, ctx.valores.tipos_chamado_permitidos)
    if ('erro' in validada) return ERROS.dadosInvalidos(validada.erro)
    const serviceDeskId = ctx.valores.service_desk_id
    if (!serviceDeskId) {
      return ERROS.dadosInvalidos(
        'A abertura de chamados ainda não foi configurada nesta instalação. Fale com o time de tech.',
      )
    }
    const chave =
      typeof corpo?.chaveIdempotencia === 'string' && corpo.chaveIdempotencia.length > 0
        ? `form:${eu.email}:${corpo.chaveIdempotencia}`
        : `form:${eu.email}:${ctx.novoId()}`

    const r = await ctx.chamados.abrirPorFormulario({
      solicitanteEmail: eu.email,
      chaveIdempotencia: chave,
      payload: {
        titulo: validada.proposta.titulo,
        descricao: validada.proposta.descricao,
        tipoChamadoId: validada.proposta.tipoChamadoId,
        serviceDeskId,
        prioridade: validada.proposta.prioridade,
      },
    })
    return json(respostaCriacao(r, validada.proposta.prioridade), 201)
  }

  // --- meus chamados (RF-29 a RF-33) ----------------------------------------
  if (caminho === '/api/chamados' && req.method === 'GET') {
    const vinculos = await ctx.vinculos.listarDoSolicitante(eu.email, 100)
    // RF-58 / RN-10 — a listagem TOCA a Atlassian (um `obterChamado` por item),
    // então é leitura auditável. Um registro para a listagem, não um por item:
    // auditoria que inunda deixa de ser útil para investigar.
    await ctx.auditoria.registrar({
      atorEmail: eu.email,
      acao: 'chamado_lido',
      recurso: 'meus-chamados',
      resultado: 'sucesso',
      detalhe: { quantidade: vinculos.length },
    })
    const itens = []
    for (const v of vinculos) {
      try {
        const chamado = await ctx.atlassian.obterChamado(v.issueKey)
        itens.push({
          issueKey: chamado.issueKey,
          titulo: chamado.titulo,
          status: chamado.status,
          prioridade: chamado.prioridade,
          atualizadoEm: chamado.atualizadoEm,
          via: v.via,
          verificadoRegras: v.verificadoRegras,
        })
      } catch {
        // RNF-19: um chamado ilegível não derruba a lista inteira. A pessoa vê o
        // que der para ver, com o estado explícito no que não deu.
        itens.push({
          issueKey: v.issueKey,
          titulo: null,
          status: 'indisponivel',
          prioridade: null,
          atualizadoEm: null,
          via: v.via,
          verificadoRegras: v.verificadoRegras,
        })
      }
    }
    return json({ itens })
  }

  const detalhe = caminho.match(/^\/api\/chamados\/([^/]+)$/)
  if (detalhe && req.method === 'GET') {
    const r = await ctx.chamados.obterChamadoDoSolicitante(detalhe[1]!, eu.email)
    if (!r) return ERROS.chamadoNaoSeu()
    const comentarios = await ctx.chamados.listarComentariosDoSolicitante(
      detalhe[1]!,
      eu.email,
    )
    return json({
      chamado: r.chamado,
      via: r.vinculo.via,
      verificadoRegras: r.vinculo.verificadoRegras,
      comentarios: comentarios ?? [],
    })
  }

  const comentar = caminho.match(/^\/api\/chamados\/([^/]+)\/comentarios$/)
  if (comentar && req.method === 'POST') {
    const vinculo = await ctx.vinculos.obterDoSolicitante(comentar[1]!, eu.email)
    if (!vinculo) return ERROS.chamadoNaoSeu()
    const corpo = await lerJson<{ texto?: unknown }>(req)
    const texto = typeof corpo?.texto === 'string' ? corpo.texto.trim() : ''
    if (!texto) return ERROS.dadosInvalidos('Escreva o comentário antes de enviar.')

    await ctx.atlassian.comentar(comentar[1]!, texto, eu.email)
    await ctx.auditoria.registrar({
      atorEmail: eu.email,
      acao: 'comentario_criado',
      recurso: comentar[1]!,
      resultado: 'sucesso',
    })
    return json({ ok: true }, 201)
  }

  // --- tipos de chamado disponíveis (RF-28) ---------------------------------
  if (caminho === '/api/tipos-chamado' && req.method === 'GET') {
    const permitidos = new Set(ctx.valores.tipos_chamado_permitidos)
    const todos = await ctx.atlassian.listarTiposChamado()
    // Negação por padrão: allowlist vazia expõe ZERO tipos (RNF-07, RF-28).
    return json({ itens: todos.filter((t) => permitidos.has(t.id)) })
  }

  // --- admin (RF-49, RF-50) -------------------------------------------------
  if (caminho === '/api/admin/config') {
    if (!eu.isAdmin) return ERROS.semPermissao()
    if (req.method === 'GET') return json({ config: ctx.valores })
    if (req.method === 'PUT') {
      const corpo = await lerJson<{ chave?: unknown; valor?: unknown }>(req)
      const chave = typeof corpo?.chave === 'string' ? corpo.chave : ''
      if (!(chave in ctx.valores)) return ERROS.dadosInvalidos('Configuração desconhecida.')
      await ctx.config.definir(
        chave as keyof typeof ctx.valores,
        corpo!.valor as never,
        eu.email,
        ctx.agora(),
      )
      await ctx.auditoria.registrar({
        atorEmail: eu.email,
        acao: 'config_alterada',
        recurso: chave,
        resultado: 'sucesso',
      })
      return json({ ok: true })
    }
  }

  if (caminho === '/api/admin/auditoria' && req.method === 'GET') {
    if (!eu.isAdmin) return ERROS.semPermissao()
    const alvo = url.searchParams.get('email') ?? eu.email
    return json({ itens: await ctx.auditoria.listarPorAtor(alvo, 200) })
  }

  return ERROS.naoEncontrado()
}

function estadoVerificacao(
  verificado: boolean | undefined,
  falhou: boolean | undefined,
): 'pendente' | 'ok' | 'falhou' {
  if (falhou) return 'falhou'
  return verificado ? 'ok' : 'pendente'
}

function respostaCriacao(
  r: { issueKey: string | null; estado: string; duplicada: boolean; verificadoRegras: boolean },
  prioridade: Prioridade,
) {
  return {
    issueKey: r.issueKey,
    estado: r.estado,
    duplicada: r.duplicada,
    verificadoRegras: r.verificadoRegras,
    prioridade,
    // RN-08 — sempre PRIMEIRA RESPOSTA, e o rótulo deixa isso explícito.
    slaPrimeiraRespostaHoras: SLA_PRIMEIRA_RESPOSTA_HORAS[prioridade],
    mensagem:
      r.estado === 'criado'
        ? 'Chamado aberto. Você acompanha tudo por aqui.'
        : 'Recebemos sua solicitação e estamos abrindo o chamado. Nada se perdeu — você verá a chave aqui em instantes.',
  }
}

type ValidacaoProposta = { proposta: PropostaChamado } | { erro: string }

/**
 * Valida a proposta vinda do cliente.
 *
 * ⚠️ O `tipoChamadoId` é checado contra a **allowlist do admin** (RF-28): tipo
 * fora da lista é recusado mesmo que exista no Jira. Sem isso, o cliente
 * escolheria qualquer fila do site.
 */
function validarProposta(
  corpo: Record<string, unknown> | null,
  tiposPermitidos: readonly string[],
): ValidacaoProposta {
  const titulo = typeof corpo?.titulo === 'string' ? corpo.titulo.trim() : ''
  const descricao = typeof corpo?.descricao === 'string' ? corpo.descricao.trim() : ''
  const tipoChamadoId = typeof corpo?.tipoChamadoId === 'string' ? corpo.tipoChamadoId : ''
  const prioridade = corpo?.prioridade

  if (titulo.length < 5) return { erro: 'Dê um título com pelo menos 5 caracteres.' }
  if (descricao.length < 10) {
    return { erro: 'Descreva o pedido com um pouco mais de detalhe (ao menos 10 caracteres).' }
  }
  if (!ehPrioridade(prioridade)) {
    return { erro: 'Escolha a prioridade entre crítica, alta e normal.' }
  }
  if (!tiposPermitidos.includes(tipoChamadoId)) {
    return { erro: 'Escolha um tipo de chamado da lista.' }
  }

  return {
    proposta: {
      titulo,
      descricao,
      tipoChamadoId,
      prioridade,
      area: typeof corpo?.area === 'string' ? corpo.area : null,
      componente: typeof corpo?.componente === 'string' ? corpo.componente : null,
    },
  }
}

/** RF-59 — health check das dependências, em rota própria e pública. */
async function tratarHealth(ctx: Contexto): Promise<Response> {
  const [atlassian, ia] = await Promise.all([
    ctx.atlassian.verificarSaude(),
    ctx.ia.verificarSaude(),
  ])
  let banco = { ok: true, detalhe: 'ok' }
  try {
    await ctx.db.query('SELECT 1 AS ok', [])
  } catch {
    banco = { ok: false, detalhe: 'indisponível' }
  }
  const ok = atlassian.ok && ia.ok && banco.ok
  return json(
    {
      ok,
      usandoFakes: ctx.usandoFakes,
      dependencias: { atlassian, ia, banco, sso: { ok: true, detalhe: 'edge GoDeploy' } },
    },
    ok ? 200 : 503,
  )
}

/**
 * Rotas de cron — RNF-17, RNF-21.
 *
 * ⚠️ O cron é da **plataforma** (`createCronJob`), não do app: o GoDeploy chama
 * estas rotas e estampa `X-Godeploy-Cron` assinado. O app **valida** o header
 * contra `GODEPLOY_CRON_KEY`. Sem essa validação, qualquer um dispararia
 * reprocessamento em massa.
 */
async function tratarCron(
  req: Request,
  ctx: Contexto,
  env: EnvCron,
  caminho: string,
): Promise<Response> {
  if (req.method !== 'POST') return ERROS.naoEncontrado()

  const enviado = req.headers.get('x-godeploy-cron')
  const esperado = env.GODEPLOY_CRON_KEY
  // Fail-closed: sem chave configurada, a rota não funciona. O contrário deixaria
  // a rota aberta justamente na instalação que esqueceu de configurar.
  if (!esperado || !enviado || enviado !== esperado) {
    await ctx.auditoria.registrar({
      atorEmail: '(cron)',
      acao: 'acesso_negado',
      recurso: caminho,
      resultado: 'negado',
      detalhe: { motivo: 'cron_nao_autenticado' },
    })
    return ERROS.semPermissao()
  }

  if (caminho === '/api/cron/reprocessar-submissoes') {
    const r = await ctx.chamados.reprocessarPendentes(25)
    await ctx.auditoria.registrar({
      atorEmail: '(cron)',
      acao: 'submissao_reprocessada',
      resultado: 'sucesso',
      detalhe: r,
    })
    return json(r)
  }

  if (caminho === '/api/cron/reconciliar-vinculos') {
    const recuperados = await ctx.chamados.reconciliarVinculos(50)
    return json({ recuperados })
  }

  return ERROS.naoEncontrado()
}
