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

import { resolverIdentidade, HEADER_EMAIL, MENSAGEM_NEGACAO, type Identidade } from '../auth'
import type { Contexto } from '../contexto'
import { ERROS, erro, json, lerJson } from './respostas'
import { verificarLimite } from './limite'
import { CONCORRENCIA_ATLASSIAN, mapearComLimite } from '../paralelo'
import { CriacaoRecusada, MENSAGEM_RECUSA } from '../agent/gate'
import { ErroAtlassian, SLA_PRIMEIRA_RESPOSTA_HORAS, type Prioridade } from '../atlassian/tipos'
import type { PropostaChamado } from '../agent/estado'
import { ancestraisExpostos, lerPaginaAutorizada, verificarExposicao } from '../confluence/acesso'
import { buscarComAmpliacao } from '../confluence/busca'
import { CABECALHOS_ANEXO, cabecalhoContentDisposition, decidirEntrega } from '../confluence/anexo'
import { ENDPOINTS_NAO_VERIFICADOS, LIMITACOES_ULTIMO_ACESSO } from '../atlassian/organizacao'
import { temCampoDePrioridade } from '../atlassian/schema-diagnostico'
import { calcularCusto } from '../governanca/custo'
import { obterResumoMetricas } from '../governanca/metricas'
import { lerEntradaDoPainel, montarPainel } from '../governanca/painel'
import { gerarRecomendacoes } from '../governanca/recomendacoes'
import { recomendacoesParaCsv } from '../governanca/csv'
import {
  chaveDoPayload,
  HEADER_WEBHOOK,
  PARAM_WEBHOOK,
  segredoConfere,
} from '../notificacoes/webhook'
import { validarPreferencia } from '../notificacoes/preferencias'
import { verificarCron } from './cron-auth'
import { areasConhecidas, dentroDoPiloto } from '../piloto/areas'
import { resolverArea } from '../teamguide/area'
import { aplicarRetencao, PISO_AUDITORIA_DIAS } from '../retencao'
import { MAX_ANEXOS_POR_ENVIO, validarAnexoEnviado } from './anexo-entrada'
import { extrairCamposDinamicos, filtrarPeloSchema } from './campos-dinamicos'
import { resolverCamposDoSolicitante } from '../tickets/campos-do-solicitante'
import { falhaDefinitivaDeCriacao, type ResultadoCriacao } from '../tickets/servico'
import { paraExibicao } from '../tickets/comentario-exibicao'
import {
  mensagemObrigatoriosFaltando,
  obrigatoriosFaltando,
} from '../tickets/campos-obrigatorios'
import {
  mensagemOpcoesDesconhecidas,
  opcoesDesconhecidas,
  paraValoresDoJira,
} from '../tickets/valores-de-campo'
import {
  exigeDeclaracaoDeAnexo,
  tipoAceitaAnexo,
  validarDeclaracao,
  type SchemaDoTipo,
} from '../tickets/declaracao-anexo'
import {
  chaveDoClienteValida,
  normalizarChaveIdempotencia,
} from '../tickets/chave-idempotencia'
import {
  JANELA_ENVIOS_PENDENTES_MS,
  MAX_ANEXOS_POR_CHAMADO,
  MAX_ENVIOS_PENDENTES_POR_JANELA,
  TTL_ANEXO_PENDENTE_HORAS,
} from '../tickets/anexos-pendentes'
import {
  materializarAnexosDoChamado,
  type ResultadoAnexoNaCriacao,
} from '../tickets/anexo-na-criacao'
import { chaveDeConfigConhecida, validarValorDeConfig } from '../config/validar'
import { buscaConfigurada } from '../config/diagnostico'

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

  // Webhook do Jira — a ÚNICA rota que a Atlassian chama, autenticada por segredo
  // próprio. Fica aqui, ANTES da identidade, porque não existe pessoa logada do outro
  // lado. Ver `notificacoes/webhook.ts` para as três travas que sustentam isso.
  if (caminho === '/api/webhook/jira') {
    return await tratarWebhook(req, ctx, url)
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
    // `modoDemo` vai para a UI porque ela precisa avisar de forma permanente que
    // nada chega ao time de tech (ver `demo.ts`).
    return json({
      email: eu.email,
      nome: eu.nome,
      isAdmin: eu.isAdmin,
      modoDemo: ctx.modoDemo,
      // A UI precisa avisar de forma permanente: sem isso, a pessoa tenta abrir chamado,
      // toma a recusa e conclui que o app está quebrado.
      somenteLeitura: ctx.somenteLeitura,
    })
  }

  // RNF-11 — rate limit por usuário, antes de qualquer trabalho caro.
  //
  // Vale para POST **e** para as leituras de Confluence: cada leitura de página
  // dispara três a quatro chamadas à Atlassian (metadados, espaço, labels,
  // restrição), e um laço sobre IDs consome o orçamento da credencial única (R-02)
  // do mesmo jeito que um POST — só sem criar nada, o que faz parecer inofensivo.
  if (req.method === 'POST' || caminho.startsWith('/api/confluence/')) {
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
      // RF-13 / RN-07 — persiste entre turnos; é dele que a UI tira o caminho de
      // override. `bloqueado` sozinho fazia o botão sumir na mensagem seguinte.
      bloqueioPendente: r.bloqueioPendente,
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
    const serviceDeskId = ctx.valores.service_desk_id
    if (!serviceDeskId) {
      // RNF-25 + Q1: sem service desk configurado não se inventa um.
      return ERROS.dadosInvalidos(
        'A abertura de chamados ainda não foi configurada nesta instalação. Fale com o time de tech.',
      )
    }
    const piloto = await verificarPiloto(ctx, eu, caminho)
    if (piloto) return piloto

    // ⚠️ **RF-62 (T-402) vem ANTES de `registrarConfirmacao`, e a ordem é a trava.**
    //
    // Registrar a confirmação e só então recusar deixaria a conversa marcada como
    // confirmada **sem** chamado: `confirmacao_registrada` apareceria duas ou três
    // vezes na auditoria de `RF-17` para uma única abertura, e o carimbo de
    // `confirmadoEm` passaria a significar "clicou" em vez de "autorizou a criação".
    // Como a pessoa pode responder e confirmar de novo (`SC-03`), o caminho recusado
    // não é raro — é o caminho normal de quem ainda não respondeu.
    const corpoConfirmacao = await lerJson<Record<string, unknown>>(req)
    const schema = await lerSchemaDoTipo(
      ctx,
      eu.email,
      serviceDeskId,
      conversa.proposta.tipoChamadoId,
    )
    const declaracao = await autorizarDeclaracaoDeAnexo(
      ctx,
      eu.email,
      conversa.proposta.tipoChamadoId,
      schema,
      corpoConfirmacao?.declarouAnexo,
    )
    if ('recusa' in declaracao) return declaracao.recusa

    // RF-27 na CONVERSA (T-505b). A tela de confirmação passou a coletar os campos extras
    // do request type, pelo mesmo caminho do formulário: filtro pelo schema, e os do
    // solicitante entrando como padrão.
    //
    // 🚨 E a recusa vem ANTES de `registrarConfirmacao`, pela mesma razão que `RF-62`:
    // registrar a confirmação e só então recusar deixaria a conversa marcada como
    // confirmada **sem** chamado, e `confirmadoEm` passaria a significar "clicou" em vez
    // de "autorizou a criação".
    const camposDaConversa = {
      ...resolverCamposDoSolicitante(conversa.proposta.tipoChamadoId, schema, eu),
      ...((await filtrarCamposComSchema(
        ctx,
        eu.email,
        conversa.proposta.tipoChamadoId,
        extrairCamposDinamicos(corpoConfirmacao?.camposDinamicos),
        schema,
      )) ?? {}),
    }
    const faltandoNaConversa = obrigatoriosFaltando(schema, camposDaConversa)
    if (faltandoNaConversa.length > 0) {
      return ERROS.dadosInvalidos(mensagemObrigatoriosFaltando(faltandoNaConversa))
    }

    // `D-39` — opção fora da lista do schema dá o mesmo 400 definitivo de um obrigatório
    // faltando, com o mesmo desfecho: chamado perdido. Recusa antes de qualquer efeito,
    // e antes de `registrarConfirmacao`, pela razão do bloco acima.
    const opcoesRuinsNaConversa = opcoesDesconhecidas(schema, camposDaConversa)
    if (opcoesRuinsNaConversa.length > 0) {
      return ERROS.dadosInvalidos(mensagemOpcoesDesconhecidas(opcoesRuinsNaConversa))
    }

    await ctx.conversas.registrarConfirmacao(conversa.id)
    await ctx.auditoria.registrar({
      atorEmail: eu.email,
      acao: 'confirmacao_registrada',
      recurso: conversa.id,
      resultado: 'sucesso',
    })

    const atual = await ctx.conversas.obterDoSolicitante(conversa.id, eu.email)

    // A chave de idempotência é derivada da CONVERSA, não gerada por requisição:
    // é o que faz duplo clique e reenvio caírem na mesma submissão (RF-24). E é escrita
    // pela mesma função que a rota de upload usa (T-409b) — se as duas divergirem, o
    // anexo não casa com o chamado e ninguém vê erro nenhum.
    const chaveDaConversa = normalizarChaveIdempotencia({
      via: 'conversa',
      conversaId: conversa.id,
    })
    const areaDoSolicitante = await resolverArea({
      email: eu.email,
      teamguide: ctx.teamguide,
      areasPorEmail: ctx.valores.areas_por_email,
      auditoria: ctx.auditoria,
    })

    // `D-46` — falha DEFINITIVA vira a frase que diz a verdade, em vez do 500 genérico
    // que prometia reprocessamento. Ver `falhaDefinitivaDeCriacao` e `criacaoNaoConcluida`.
    let r: ResultadoCriacao
    try {
      r = await ctx.chamados.abrirPorConversa(
        atual!,
        serviceDeskId,
        chaveDaConversa,
        areaDoSolicitante,
        declaracao.declarouAnexo,
        // RF-21 / `D-36` — os MESMOS campos que o formulário preenche, resolvidos com o
        // `schema` que `RF-62` já leu logo acima. Sem isto, um chamado de um tipo que exige
        // nome e e-mail nasceria vazio quando aberto pela conversa, e só por lá.
        //
        // ⚠️ A conversa não tem formulário dinâmico, então aqui não há valor do cliente para
        // vencer o do login (`FR-3`) — o que chega é sempre a identidade da sessão.
        //
        // ⚠️ Traduzido para o formato do Jira **aqui**, e não no cliente (`D-39`): é este
        // objeto que o outbox persiste, então o reprocessamento de `RNF-17` reenvia o mesmo
        // corpo sem reler o schema.
        paraValoresDoJira(schema, camposDaConversa),
      )
    } catch (e) {
      if (falhaDefinitivaDeCriacao(e)) return ERROS.criacaoNaoConcluida('conversa')
      throw e
    }
    if (r.estado === 'criado') await ctx.conversas.definirEstado(conversa.id, 'criado')
    const anexo = await materializarAnexosDoChamado(ctx, {
      chaveIdempotencia: chaveDaConversa,
      solicitanteEmail: eu.email,
      issueKey: r.issueKey,
    })
    await avisarCriacao(ctx, r, {
      solicitanteEmail: eu.email,
      titulo: atual!.proposta!.titulo,
      prioridade: atual!.proposta!.prioridade,
    })
    return json(respostaCriacao(r, atual!.proposta!.prioridade, anexo), 201)
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
    const piloto = await verificarPiloto(ctx, eu, caminho)
    if (piloto) return piloto

    // T-409b — a MESMA função que a rota de upload usa. Chave ausente ainda é tolerada
    // aqui (o formulário sem anexo não pode regredir), e nesse caso simplesmente não há
    // anexo para casar.
    const chave = normalizarChaveIdempotencia({
      via: 'formulario',
      solicitanteEmail: eu.email,
      chaveDoCliente: chaveDoClienteValida(corpo?.chaveIdempotencia) ?? ctx.novoId(),
    })

    // RF-27 (T-130) — campos adicionais do request type, coletados pelo
    // formulário dinâmico. Ausente/inválido = nenhum, nunca erro: o caminho sem
    // IA não pode regredir por causa de um campo extra malformado.
    //
    // ⚠️ T-401 — e as CHAVES são validadas contra o schema, não aceitas do cliente.
    // Schema indisponível descarta todos (fail-closed no campo) e ainda assim abre o
    // chamado (fail-open no chamado, `RNF-18`): validação que se desliga sob pressão
    // não é validação, mas recusar chamado por causa dela seria a parede que o
    // caminho sem IA existe para não ser.
    const schema = await lerSchemaDoTipo(
      ctx,
      eu.email,
      serviceDeskId,
      validada.proposta.tipoChamadoId,
    )

    // RF-62 (T-402/T-404) — a pergunta é pré-condição da criação, e a recusa vem ANTES
    // de qualquer efeito: nada persistido, nada no JSM.
    const declaracao = await autorizarDeclaracaoDeAnexo(
      ctx,
      eu.email,
      validada.proposta.tipoChamadoId,
      schema,
      corpo?.declarouAnexo,
    )
    if ('recusa' in declaracao) return declaracao.recusa

    const camposDinamicos = await filtrarCamposComSchema(
      ctx,
      eu.email,
      validada.proposta.tipoChamadoId,
      extrairCamposDinamicos(corpo?.camposDinamicos),
      schema,
    )

    // RF-21 / D-36 — nome e e-mail do solicitante, **por request type** e cruzados com
    // o schema. Entram como PADRÃO, não como imposição: o valor que a pessoa mandou
    // vence (`FR-3`), porque o tipo 108 tem a forma de um pedido de acesso que pode ser
    // **para outra pessoa**, e travar na identidade gravaria dado errado em silêncio.
    // A autoria verificável continua no vínculo e no cabeçalho de `D-13`, que o cliente
    // não forja — então isto não enfraquece `RF-30`.
    //
    // ⚠️ Vai por `camposDinamicos` de propósito: é esse objeto que o outbox persiste, e
    // por isso o reprocessamento de `RNF-17` reproduz exatamente os mesmos campos sem
    // precisar reler o schema.
    const camposComSolicitante = {
      ...resolverCamposDoSolicitante(validada.proposta.tipoChamadoId, schema, eu),
      ...(camposDinamicos ?? {}),
    }

    // 🚨 Recusa ANTES de qualquer efeito. Mandar sem obrigatório dá 400, que este projeto
    // classifica como definitivo — a submissão vira `falha` e nunca é reprocessada, ou
    // seja, o chamado da pessoa morre. Aqui vira erro corrigível, com o que falta nomeado.
    const faltando = obrigatoriosFaltando(schema, camposComSolicitante)
    if (faltando.length > 0) {
      return ERROS.dadosInvalidos(mensagemObrigatoriosFaltando(faltando))
    }

    // 🚨 `D-39` — mesma família da recusa acima: valor que não está entre as opções do
    // schema é recusado pela Atlassian com 400, que este projeto trata como definitivo.
    // Recusar aqui é a diferença entre "corrija e reenvie" e "o chamado sumiu".
    const opcoesRuins = opcoesDesconhecidas(schema, camposComSolicitante)
    if (opcoesRuins.length > 0) {
      return ERROS.dadosInvalidos(mensagemOpcoesDesconhecidas(opcoesRuins))
    }

    // 🚨 A tradução para o formato do Jira vem DEPOIS das duas recusas e ANTES de
    // persistir: campo de seleção precisa ir como objeto (`{id}`), nunca como a string
    // crua que a tela mandou — era esse o 400 do `D-39`.
    const camposParaOJira = paraValoresDoJira(schema, camposComSolicitante)

    const area = await resolverArea({
      email: eu.email,
      teamguide: ctx.teamguide,
      areasPorEmail: ctx.valores.areas_por_email,
      auditoria: ctx.auditoria,
    })

    // `D-46` — igual à conversa, e de propósito: a divergência silenciosa entre os dois
    // caminhos de criação é o defeito que a spec 006 §8 nomeia.
    let r: ResultadoCriacao
    try {
      r = await ctx.chamados.abrirPorFormulario({
        solicitanteEmail: eu.email,
        chaveIdempotencia: chave,
        area,
        declarouAnexo: declaracao.declarouAnexo,
        payload: {
          titulo: validada.proposta.titulo,
          descricao: validada.proposta.descricao,
          tipoChamadoId: validada.proposta.tipoChamadoId,
          serviceDeskId,
          prioridade: validada.proposta.prioridade,
          ...(camposParaOJira ? { camposDinamicos: camposParaOJira } : {}),
        },
      })
    } catch (e) {
      if (falhaDefinitivaDeCriacao(e)) return ERROS.criacaoNaoConcluida('formulario')
      throw e
    }
    const anexo = await materializarAnexosDoChamado(ctx, {
      chaveIdempotencia: chave,
      solicitanteEmail: eu.email,
      issueKey: r.issueKey,
    })
    await avisarCriacao(ctx, r, {
      solicitanteEmail: eu.email,
      titulo: validada.proposta.titulo,
      prioridade: validada.proposta.prioridade,
    })
    return json(respostaCriacao(r, validada.proposta.prioridade, anexo), 201)
  }

  // RF-27 (T-130) — schema de campos adicionais do request type, para o
  // formulário sem IA renderizar dinamicamente. Mesma allowlist de RF-28: tipo
  // fora dela responde como inexistente, sem consultar a Atlassian.
  const camposDoTipo = caminho.match(/^\/api\/tipos-chamado\/([^/]+)\/campos$/)
  if (camposDoTipo && req.method === 'GET') {
    const requestTypeId = decodificar(camposDoTipo[1]!)
    if (requestTypeId === null || !ctx.valores.tipos_chamado_permitidos.includes(requestTypeId)) {
      return ERROS.naoEncontrado()
    }
    const serviceDeskId = ctx.valores.service_desk_id
    if (!serviceDeskId) {
      return ERROS.dadosInvalidos(
        'A abertura de chamados ainda não foi configurada nesta instalação. Fale com o time de tech.',
      )
    }
    try {
      const campos = await ctx.atlassian.obterCamposDoTipo(serviceDeskId, requestTypeId)
      return json({
        // ⚠️ **T-406c — o campo de anexo sai da lista.** Quem desenha o seletor de
        // arquivo é a tela de `RF-61`; deixá-lo aqui mostraria os dois lado a lado, e
        // como o desconhecido cai em `'texto'`, o campo "Anexo" apareceria como uma
        // caixa de texto ao lado do seletor de verdade.
        itens: campos.filter((c) => c.tipo !== 'anexo'),
        // ...e a informação de que ele existe continua chegando, porque é ela que faz a
        // pergunta de `RF-62` aparecer (ou não) na tela.
        aceitaAnexo: tipoAceitaAnexo(campos),
      })
    } catch {
      return ERROS.conteudoIndisponivel()
    }
  }

  // --- preferência de notificação (RF-45, T-224) -----------------------------
  if (caminho === '/api/preferencias') {
    if (req.method === 'GET') {
      const p = await ctx.preferencias.obterEfetiva(
        eu.email,
        ctx.valores.canal_notificacao_padrao,
      )
      return json({
        canal: p.canal,
        destino: p.destino,
        escolhidaPelaPessoa: p.escolhidaPelaPessoa,
        // A tela precisa distinguir "escolhi não receber" de "ninguém definiu canal
        // ainda" (Q11): as duas mostram `nenhum`, e só uma é decisão da pessoa.
        canalPadraoDefinido: ctx.valores.canal_notificacao_padrao !== null,
      })
    }
    if (req.method === 'PUT') {
      const corpo = await lerJson<Record<string, unknown>>(req)
      const validada = validarPreferencia(corpo)
      if ('erro' in validada) return ERROS.dadosInvalidos(validada.erro)
      await ctx.preferencias.definir(eu.email, validada.canal, validada.destino)
      await ctx.auditoria.registrar({
        atorEmail: eu.email,
        acao: 'preferencia_alterada',
        recurso: eu.email,
        resultado: 'sucesso',
        // O DESTINO não vai para a auditoria: é endereço pessoal, e o admin lê isto.
        detalhe: { canal: validada.canal, destinoAlternativo: validada.destino !== null },
      })
      return json({ ok: true, canal: validada.canal, destino: validada.destino })
    }
  }

  // Histórico de avisos da PRÓPRIA pessoa (RF-44). O e-mail está no `WHERE`.
  if (caminho === '/api/notificacoes' && req.method === 'GET') {
    const itens = await ctx.notificacoes.listarDoDestinatario(eu.email, 50)
    return json({
      itens: itens.map((n) => ({
        issueKey: n.issueKey,
        tipoEvento: n.tipoEvento,
        titulo: n.titulo,
        estado: n.estado,
        canal: n.canal,
        criadoEm: n.criadoEm,
      })),
    })
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
    /**
     * Um `obterChamado` por vínculo, **em paralelo com teto** (`paralelo.ts`).
     *
     * ⚠️ Este laço era `for … await`: até 100 idas ao Jira **em série** antes de a lista
     * aparecer. Quem tinha 40 chamados esperava dezenas de segundos com tudo funcionando
     * perfeitamente — nada no log parecia errado, porque nada estava errado, só somado. O
     * teto é baixo de propósito (a credencial é única e o burst limit não é publicado,
     * `R-02`); a ordem do resultado é preservada, porque `listarDoSolicitante` já ordena e
     * a lista dançar entre dois carregamentos parece defeito.
     */
    const itens = await mapearComLimite(vinculos, CONCORRENCIA_ATLASSIAN, async (v) => {
      try {
        const chamado = await ctx.atlassian.obterChamado(v.issueKey)
        return {
          issueKey: chamado.issueKey,
          titulo: chamado.titulo,
          status: chamado.status,
          prioridade: chamado.prioridade,
          atualizadoEm: chamado.atualizadoEm,
          via: v.via,
          verificadoRegras: v.verificadoRegras,
        }
      } catch {
        // RNF-19: um chamado ilegível não derruba a lista. E em vez de mostrar
        // "título indisponível", usa o que NÓS gravamos no outbox — o dado já
        // estava lá. A pessoa vê seus chamados com conteúdo mesmo com a Atlassian
        // fora; só o status é que fica honestamente marcado como indisponível.
        const submissao = await ctx.outbox.obterPorIssueKey(v.issueKey)
        return {
          issueKey: v.issueKey,
          titulo: submissao?.payload.titulo ?? null,
          status: 'indisponivel',
          prioridade: submissao?.payload.prioridade ?? null,
          atualizadoEm: null,
          via: v.via,
          verificadoRegras: v.verificadoRegras,
          area: v.area,
        }
      }
    })

    // T-241 / RF-35 — filtro por status e busca textual.
    //
    // ⚠️ Filtra DEPOIS de montar, e é o único jeito honesto: `status` e `titulo` vivem no
    // Jira, não no banco local, então "filtrar antes" significaria filtrar por um dado
    // que ainda não temos. A lista já é limitada a 100 vínculos da pessoa — não é uma
    // varredura, é um recorte do que ela mesma abriu.
    const filtroStatus = (url.searchParams.get('status') ?? '').trim().toLowerCase()
    const termo = normalizarBusca(url.searchParams.get('q') ?? '')
    const filtrados = itens.filter((i) => {
      if (filtroStatus && (i.status ?? '').toLowerCase() !== filtroStatus) return false
      if (!termo) return true
      // O `issueKey` entra na busca de propósito: procurar por "GOATLAS-12" é o caso
      // mais comum de quem tem o número numa conversa de chat.
      return normalizarBusca(`${i.issueKey} ${i.titulo ?? ''}`).includes(termo)
    })

    return json({
      itens: filtrados,
      // A tela monta o seletor a partir do que EXISTE, não de uma lista fixa: os status
      // são do workflow do JSM (configuração do projeto), e chumbar "Aberto/Em
      // andamento/Resolvido" aqui seria hardcode de configuração alheia (RNF-25).
      statusDisponiveis: [...new Set(itens.map((i) => i.status).filter((s): s is string => Boolean(s)))].sort(),
      total: itens.length,
    })
  }

  const detalhe = caminho.match(/^\/api\/chamados\/([^/]+)$/)
  if (detalhe && req.method === 'GET') {
    const r = await ctx.chamados.obterChamadoDoSolicitante(detalhe[1]!, eu.email)
    if (!r) return ERROS.chamadoNaoSeu()
    // ⚠️ Os comentários são uma SEGUNDA chamada à Atlassian, e falhavam com 500 pelo mesmo
    // motivo que o chamado falhava. Aqui a distinção importa mais que na lista: "ainda não
    // há respostas" e "não consegui buscar as respostas" são frases opostas, e mostrar a
    // primeira durante uma queda faz a pessoa achar que ninguém olhou o chamado dela.
    let comentarios: Awaited<ReturnType<typeof ctx.chamados.listarComentariosDoSolicitante>> = []
    let comentariosIndisponiveis = false
    try {
      comentarios = await ctx.chamados.listarComentariosDoSolicitante(detalhe[1]!, eu.email)
    } catch {
      comentariosIndisponiveis = true
    }
    return json({
      chamado: r.chamado,
      via: r.vinculo.via,
      verificadoRegras: r.vinculo.verificadoRegras,
      area: r.vinculo.area,
      // ⚠️ `paraExibicao` é a ÚNICA tradução de "corpo cru" para "o que a tela mostra"
      // (`D-43`): ela classifica pelo mesmo predicado do SLA e tira o prefixo de
      // `D-13`. Devolver o cru daqui obrigaria a tela a remontar a regra, e duas
      // regras para o mesmo fato divergem em silêncio.
      comentarios: paraExibicao(comentarios ?? []),
      // `RNF-19` — a tela precisa distinguir "não há resposta ainda" de "não consegui
      // buscar as respostas". Sem estes campos, uma queda do Jira apareceria como um
      // chamado sem histórico, o que é uma informação falsa.
      degradado: r.degradado,
      comentariosIndisponiveis,
    })
  }

  const comentar = caminho.match(/^\/api\/chamados\/([^/]+)\/comentarios$/)
  if (comentar && req.method === 'POST') {
    const vinculo = await ctx.vinculos.obterDoSolicitante(comentar[1]!, eu.email)
    if (!vinculo) return ERROS.chamadoNaoSeu()
    const corpo = await lerJson<{ texto?: unknown }>(req)
    const texto = typeof corpo?.texto === 'string' ? corpo.texto.trim() : ''
    if (!texto) return ERROS.dadosInvalidos('Escreva o comentário antes de enviar.')

    // RF-33 / D-13 — o nome vem do login corporativo Google, não de entrada do
    // usuário: é o que torna o prefixo confiável no comentário público.
    await ctx.atlassian.comentar(comentar[1]!, texto, eu.email, eu.nome)

    // ⚠️ T-211 / RF-48 — registrado como AÇÃO PRÓPRIA, no momento da ação.
    //
    // Sem isto, o comentário que a pessoa acabou de escrever volta pelo webhook (ou pelo
    // polling) como "novo comentário público no seu chamado" e ela é notificada de si
    // mesma. E não dá para resolver comparando autor: sob proxy total (`D-01`) todo
    // comentário sai da conta de serviço — ver `notificacoes/acoes.ts`.
    //
    // O conteúdo registrado é o TEXTO DA PESSOA, não o corpo com o prefixo de `D-13`: é o
    // texto que a normalização consegue casar quando ele voltar da Atlassian, já que o
    // prefixo é remontado por `prefixarAutoria` e some na normalização de qualquer forma.
    await ctx.acoesProprias.registrar({
      issueKey: comentar[1]!,
      atorEmail: eu.email,
      tipoEvento: 'comentario_publico',
      conteudo: texto,
    })

    await ctx.auditoria.registrar({
      atorEmail: eu.email,
      acao: 'comentario_criado',
      recurso: comentar[1]!,
      resultado: 'sucesso',
    })
    return json({ ok: true }, 201)
  }

  // --- anexo ANTES do chamado existir (RF-61, T-409) -------------------------
  //
  // ## O que esta rota é
  //
  // O primeiro dos dois passos do JSM, isolado: sobe o arquivo como temporário e guarda
  // o id **no servidor**. A materialização acontece na confirmação, depois de o chamado
  // nascer (`plan.md` §2).
  //
  // ⚠️ **Devolve `{ ok, nome }` e nada mais.** O `temporaryAttachmentId` não trafega: com
  // ele no navegador, colar o arquivo de outra pessoa no próprio chamado seria trivial —
  // `RF-30` aplicado a arquivo (`SC-11`).
  if (caminho === '/api/anexos-pendentes' && req.method === 'POST') {
    const serviceDeskId = ctx.valores.service_desk_id
    if (!serviceDeskId) {
      return ERROS.dadosInvalidos(
        'O envio de anexos ainda não foi configurado nesta instalação. Fale com o time de tech.',
      )
    }
    // T-410 — os mesmos gates das rotas de criação. Esta rota gasta a credencial única e
    // escreve na Atlassian; ficar fora do gate de piloto faria dela o caminho aberto.
    const piloto = await verificarPiloto(ctx, eu, caminho)
    if (piloto) return piloto

    let form: FormData
    try {
      form = await req.formData()
    } catch {
      return ERROS.dadosInvalidos('Não consegui ler o arquivo enviado. Tente novamente.')
    }

    // ⚠️ A chave é **obrigatória** (T-409b). Gerar uma aqui produziria um arquivo órfão
    // por construção: a criação procuraria outra chave, nenhuma linha casaria, e a tela
    // teria dito "enviado".
    const chaveDoCliente = chaveDoClienteValida(form.get('chaveIdempotencia'))
    const conversaId = typeof form.get('conversaId') === 'string' ? String(form.get('conversaId')) : null
    if ((chaveDoCliente === null) === (conversaId === null)) {
      return ERROS.dadosInvalidos(
        'Não consegui identificar a que chamado este arquivo pertence. Recarregue a página e tente de novo.',
      )
    }

    let chaveIdempotencia: string
    if (conversaId !== null) {
      // A chave da conversa não embute e-mail, então a posse é verificada aqui — e um id
      // de outra pessoa responde 404 como todo o resto (`RF-30`).
      const conversa = await ctx.conversas.obterDoSolicitante(conversaId, eu.email)
      if (!conversa) return ERROS.naoEncontrado()
      chaveIdempotencia = normalizarChaveIdempotencia({ via: 'conversa', conversaId })
    } else {
      chaveIdempotencia = normalizarChaveIdempotencia({
        via: 'formulario',
        solicitanteEmail: eu.email,
        chaveDoCliente: chaveDoCliente!,
      })
    }

    const validado = await validarAnexoEnviado(form.get('arquivo'))
    if (!validado.ok) return ERROS.dadosInvalidos(validado.mensagem)

    // T-409c — o teto é por CHAMADO e a recusa é mensagem. `.slice()` faria o arquivo
    // excedente desaparecer sem nada na tela (`SC-08`).
    const jaEnviados = await ctx.anexosPendentes.contarDaChave(chaveIdempotencia, eu.email)
    if (jaEnviados >= MAX_ANEXOS_POR_CHAMADO) {
      return ERROS.dadosInvalidos(
        `Você já anexou ${MAX_ANEXOS_POR_CHAMADO} arquivos neste chamado, que é o limite. Abra o chamado e anexe o resto depois, ou junte tudo num arquivo só.`,
      )
    }

    // T-410 / R-02 — teto por pessoa na janela, contra envio que nunca vira chamado.
    const desde = new Date(Date.parse(ctx.agora()) - JANELA_ENVIOS_PENDENTES_MS).toISOString()
    const naJanela = await ctx.anexosPendentes.contarDaPessoaDesde(eu.email, desde)
    if (naJanela >= MAX_ENVIOS_PENDENTES_POR_JANELA) return ERROS.limiteRequisicoes()

    let temporaryAttachmentId: string
    try {
      temporaryAttachmentId = await ctx.atlassian.subirAnexoTemporario(serviceDeskId, {
        nome: validado.nome,
        tipo: validado.tipo,
        bytes: validado.bytes,
      })
    } catch (e) {
      await ctx.auditoria.registrar({
        atorEmail: eu.email,
        acao: 'anexo_enviado',
        recurso: chaveIdempotencia,
        resultado: 'falha',
        detalhe: { etapa: 'temporario', nome: validado.nome },
      })
      // A mensagem do modo somente leitura chega à pessoa (`SC-10`): recusa honesta,
      // nunca sucesso simulado. Indisponibilidade comum cai na frase genérica.
      const mensagem =
        e instanceof ErroAtlassian && !e.detalhe.transitorio
          ? e.message
          : 'Não consegui enviar o arquivo agora. Tente novamente em instantes — você também pode abrir o chamado e anexar depois.'
      return json({ ok: false, mensagem }, 503)
    }

    const { duplicado } = await ctx.anexosPendentes.registrar({
      id: ctx.novoId(),
      solicitanteEmail: eu.email,
      conversaId,
      chaveIdempotencia,
      temporaryAttachmentId,
      nomeArquivo: validado.nome,
    })

    await ctx.auditoria.registrar({
      atorEmail: eu.email,
      acao: 'anexo_enviado',
      recurso: chaveIdempotencia,
      resultado: 'sucesso',
      detalhe: { etapa: 'temporario', nome: validado.nome, duplicado },
    })

    // Duplo clique responde 201 de propósito (`SC-09`): não é erro da pessoa, e a
    // constraint já garantiu que existe uma linha só.
    return json({ ok: true, nome: validado.nome, anexados: duplicado ? jaEnviados : jaEnviados + 1 }, 201)
  }

  // --- anexo enviado pelo solicitante (RF-25, RF-34, T-240) ------------------
  //
  // Dois passos no JSM (ver `atlassian/cliente.ts#anexarArquivo`), um vínculo antes:
  // anexar em chamado que não é seu não é caso de uso, e responde 404 como todo o resto
  // (`RF-30`).
  const anexarNoChamado = caminho.match(/^\/api\/chamados\/([^/]+)\/anexos$/)
  if (anexarNoChamado && req.method === 'POST') {
    const issueKey = anexarNoChamado[1]!
    const vinculo = await ctx.vinculos.obterDoSolicitante(issueKey, eu.email)
    if (!vinculo) return ERROS.chamadoNaoSeu()

    const serviceDeskId = ctx.valores.service_desk_id
    if (!serviceDeskId) {
      return ERROS.dadosInvalidos(
        'O envio de anexos ainda não foi configurado nesta instalação. Fale com o time de tech.',
      )
    }

    let form: FormData
    try {
      form = await req.formData()
    } catch {
      return ERROS.dadosInvalidos('Não consegui ler o arquivo enviado. Tente novamente.')
    }

    const arquivos = form.getAll('arquivo')
    if (arquivos.length === 0) return ERROS.dadosInvalidos('Anexe um arquivo para enviar.')
    // ⚠️ **Recusa, nunca `.slice()`** (`plan.md` §11, T-409c). O truncamento silencioso
    // fazia o quarto arquivo desaparecer sem nada na tela — a pessoa achava que o print
    // decisivo tinha ido. `SC-08` exige dizer o limite.
    if (arquivos.length > MAX_ANEXOS_POR_ENVIO) {
      return ERROS.dadosInvalidos(
        `Envie no máximo ${MAX_ANEXOS_POR_ENVIO} arquivos por vez. Mande os primeiros e repita o envio para os demais.`,
      )
    }

    const enviados: string[] = []
    for (const bruto of arquivos) {
      const validado = await validarAnexoEnviado(bruto)
      if (!validado.ok) return ERROS.dadosInvalidos(validado.mensagem)
      try {
        await ctx.atlassian.anexarArquivo(serviceDeskId, issueKey, {
          nome: validado.nome,
          tipo: validado.tipo,
          bytes: validado.bytes,
        })
        enviados.push(validado.nome)
      } catch {
        await ctx.auditoria.registrar({
          atorEmail: eu.email,
          acao: 'anexo_enviado',
          recurso: issueKey,
          resultado: 'falha',
          detalhe: { nome: validado.nome, enviadosAntes: enviados.length },
        })
        // Parcial é relatado como parcial: dizer "ok" com dois de três arquivos faz a
        // pessoa achar que o time de tech tem o print que faltou.
        return json(
          {
            ok: false,
            enviados,
            mensagem:
              enviados.length > 0
                ? 'Parte dos arquivos foi anexada. Tente enviar os que faltaram em instantes.'
                : 'Não consegui anexar agora. Tente novamente em instantes — seu chamado está a salvo.',
          },
          503,
        )
      }
    }

    await ctx.auditoria.registrar({
      atorEmail: eu.email,
      acao: 'anexo_enviado',
      recurso: issueKey,
      resultado: 'sucesso',
      detalhe: { quantidade: enviados.length },
    })
    return json({ ok: true, enviados }, 201)
  }

  // --- resolver / reabrir (RF-36, T-242) -------------------------------------
  //
  // ⚠️ O app **não inventa transição**. Ele oferece o que o workflow do JSM expõe ao
  // customer, e nada mais: um projeto que não expõe transição ao cliente devolve lista
  // vazia, e a tela simplesmente não mostra botão. Isso é configuração do projeto (a
  // spec marca a tarefa como P2 por isso), não algo que o app possa contornar.
  const transicoes = caminho.match(/^\/api\/chamados\/([^/]+)\/transicoes$/)
  if (transicoes) {
    const issueKey = transicoes[1]!
    const vinculo = await ctx.vinculos.obterDoSolicitante(issueKey, eu.email)
    if (!vinculo) return ERROS.chamadoNaoSeu()

    if (req.method === 'GET') {
      try {
        return json({ itens: await ctx.atlassian.listarTransicoes(issueKey) })
      } catch {
        // Lista indisponível ≠ lista vazia: vazia esconde o botão para sempre, e o
        // 503 deixa a tela dizer "não consegui carregar as ações agora".
        return ERROS.conteudoIndisponivel()
      }
    }

    if (req.method === 'POST') {
      const corpo = await lerJson<{ transicaoId?: unknown }>(req)
      const transicaoId = typeof corpo?.transicaoId === 'string' ? corpo.transicaoId : ''
      if (!transicaoId) return ERROS.dadosInvalidos('Escolha uma ação.')

      // A transição pedida é conferida contra a lista REAL do chamado — o id vem do
      // cliente, e um id arbitrário não pode virar transição no Jira.
      let disponiveis: readonly { id: string; nome: string }[]
      try {
        disponiveis = await ctx.atlassian.listarTransicoes(issueKey)
      } catch {
        return ERROS.conteudoIndisponivel()
      }
      if (!disponiveis.some((t) => t.id === transicaoId)) {
        return ERROS.dadosInvalidos('Essa ação não está disponível para este chamado.')
      }

      try {
        await ctx.atlassian.transicionar(issueKey, transicaoId)
      } catch {
        await ctx.auditoria.registrar({
          atorEmail: eu.email,
          acao: 'chamado_transicionado',
          recurso: issueKey,
          resultado: 'falha',
          detalhe: { transicaoId },
        })
        return ERROS.conteudoIndisponivel()
      }

      // ⚠️ Registrada como AÇÃO PRÓPRIA (RF-48): a mudança de status que a própria pessoa
      // acabou de pedir não deve voltar como notificação. Sob proxy total não há como
      // distinguir isso pelo autor — ver `notificacoes/acoes.ts`.
      //
      // O que se registra é o **status resultante**, não o nome da transição: é o status
      // que a sincronização compara. "Marcar como resolvido" e "Resolvido" são strings
      // diferentes, e registrar a primeira faria a supressão nunca casar — o bug seria
      // silencioso, com a pessoa recebendo aviso do próprio clique.
      const nome = disponiveis.find((t) => t.id === transicaoId)?.nome ?? transicaoId
      let statusResultante = nome
      try {
        statusResultante = (await ctx.atlassian.obterChamado(issueKey)).status || nome
      } catch {
        // Releitura indisponível: fica o nome da transição. Pior caso é um aviso a mais,
        // nunca um chamado sem transicionar — a transição já aconteceu.
      }
      await ctx.acoesProprias.registrar({
        issueKey,
        atorEmail: eu.email,
        tipoEvento: 'status_alterado',
        conteudo: statusResultante,
      })
      await ctx.auditoria.registrar({
        atorEmail: eu.email,
        acao: 'chamado_transicionado',
        recurso: issueKey,
        resultado: 'sucesso',
        detalhe: { transicaoId, nome },
      })
      return json({ ok: true })
    }
  }

  // --- correção manual da área (RF-19, T-305) --------------------------------
  //
  // Mesmo padrão de RF-16 com a prioridade: o mapa de áreas envelhece e pessoa que muda
  // de área é a regra. Sem isso, a métrica por área (T-312) fica errada e o único jeito
  // de corrigir seria um admin editando config.
  const areaDoChamado = caminho.match(/^\/api\/chamados\/([^/]+)\/area$/)
  if (areaDoChamado && req.method === 'PUT') {
    const corpo = await lerJson<{ area?: unknown }>(req)
    const bruta = typeof corpo?.area === 'string' ? corpo.area.trim() : ''
    // Vazio limpa a área — "não sei" é uma resposta válida, e melhor que uma errada.
    const area = bruta.length > 0 ? bruta.slice(0, 60) : null
    const ok = await ctx.vinculos.corrigirArea(areaDoChamado[1]!, eu.email, area)
    if (!ok) return ERROS.chamadoNaoSeu()
    return json({ ok: true, area, areasConhecidas: areasConhecidas(ctx.valores.areas_por_email) })
  }

  // --- Confluence como superfície (RF-37 a RF-40, RN-06) --------------------
  //
  // A busca é a MESMA que a Regra 1 usa (`RF-37`), agora exposta. O que muda ao
  // expor é que o termo e os parâmetros passam a vir do cliente — e a allowlist
  // **não** é um deles. Ela vem da config, sempre: `?espacos=RH` respeitado seria o
  // caminho mais curto para o espaço do RH (`RN-06`, `RNF-07`).
  if (caminho === '/api/confluence/busca' && req.method === 'GET') {
    const termo = (url.searchParams.get('q') ?? '').trim().slice(0, MAX_TERMO_BUSCA)
    if (termo.length < MIN_TERMO_BUSCA) {
      return ERROS.dadosInvalidos(
        'Escreva ao menos duas letras do que você procura.',
      )
    }
    // Allowlist vazia = nada exposto. A camada isolada é que se recusa a montar
    // query aberta; aqui só distinguimos os dois zeros para a tela poder explicar
    // qual dos dois aconteceu.
    const configurada = buscaConfigurada(ctx.valores.espacos_confluence)

    // ⚠️ **`?espaco=` ESTREITA a allowlist; nunca a amplia** — é a única forma segura de
    // aceitar escopo do cliente. A regra do projeto continua valendo ("a allowlist nunca
    // vem do cliente"): o que o cliente manda é filtrado **contra** `ctx.valores`, então
    // `?espaco=RH` num app que não expõe RH resulta em lista vazia, não no espaço do RH.
    //
    // Interseção, e não "ignora se não estiver na lista": ignorar transformaria um pedido
    // de "buscar só aqui" em "buscar em tudo", que é o oposto do que quem clicou pediu.
    const espacoPedido = (url.searchParams.get('espaco') ?? '').trim()
    const espacosDaBusca =
      espacoPedido === ''
        ? ctx.valores.espacos_confluence
        : ctx.valores.espacos_confluence.filter((e) => e === espacoPedido)

    // ⚠️ Escopo pedido que sobrou vazio NÃO é lacuna de documentação. Sem isto, um
    // `?espaco=` fora da allowlist gravaria o termo no mapa de `RF-42` como "procuraram e
    // não existe" — envenenando o backlog de escrita com algo que nunca foi procurável, e
    // mandando alguém escrever página para um espaço que o app não expõe. É a mesma
    // distinção de `buscaConfigurada`: zero por escopo ≠ zero por documentação.
    const escopoValido = espacoPedido === '' || espacosDaBusca.length > 0

    // ⚠️ `buscarComAmpliacao` (`D-41`): quem digita aqui é uma pessoa, e pessoa
    // digita frase. `text ~ "<frase inteira>"` casa quase nada — a caixa de busca
    // tinha o mesmo defeito do tópico do agente, e é por isso que a correção mora
    // na consulta, e não numa instrução ao modelo que esta tela não lê.
    let busca
    try {
      busca = await buscarComAmpliacao(ctx.atlassian, {
        termo,
        espacosPermitidos: espacosDaBusca,
        labelsBloqueadas: ctx.valores.labels_bloqueadas,
        limite: limiteDeBusca(url.searchParams.get('limite')),
      })
    } catch {
      await ctx.auditoria.registrar({
        atorEmail: eu.email,
        acao: 'busca_confluence',
        recurso: termo,
        resultado: 'falha',
        detalhe: { motivo: 'indisponivel', via: 'superficie' },
      })
      // Nunca "nenhum resultado": numa queda isso empurra a pessoa a abrir chamado
      // por algo que está documentado, e registraria uma lacuna que não existe.
      return ERROS.conteudoIndisponivel()
    }

    const paginas = busca.paginas
    // ⚠️ O TERCEIRO zero (`D-41`): termo sem nenhuma palavra significativa ("como
    // faço isso?"). Ele não é lacuna de documentação — não houve o que procurar —
    // e é a mesma família de `buscaConfigurada` (zero por config) e do escopo
    // vazio de `D-30` (zero por escopo).
    const termoPesquisavel = busca.palavras.length > 0
    const procurouDeVerdade = configurada && escopoValido && termoPesquisavel

    await ctx.auditoria.registrar({
      atorEmail: eu.email,
      acao: 'busca_confluence',
      recurso: termo,
      resultado: 'sucesso',
      // `recurso` é o que a pessoa escreveu; `consultado` é o que foi à Atlassian.
      // Ampliação invisível faria a auditoria descrever uma busca que não houve.
      detalhe: {
        encontradas: paginas.length,
        via: 'superficie',
        ampliou: busca.ampliou,
        ...(busca.ampliou ? { consultado: busca.palavras.join(' ') } : {}),
      },
    })
    // Busca sem resultado é o mapa das lacunas de documentação (RF-42) — na MESMA
    // forma que a Regra 1 grava, para T-117 ler uma coisa só. Mas só quando havia
    // onde procurar: sem espaço configurado a lacuna é de configuração, e registrar
    // envenenaria o mapa com termos que ninguém deixou de documentar.
    if (paginas.length === 0 && configurada && escopoValido) {
      await ctx.auditoria.registrar({
        atorEmail: eu.email,
        acao: 'busca_confluence',
        recurso: termo,
        resultado: 'falha',
        detalhe: procurouDeVerdade
          ? { motivo: 'sem_resultado_util', lacunaDocumentacao: true, via: 'superficie' }
          : { motivo: 'termo_sem_palavras_significativas', lacunaDocumentacao: false, via: 'superficie' },
      })
    }

    // T-116 — o registro só acontece quando a busca de fato procurou em algum lugar.
    // Sem espaço configurado ela não é lacuna de documentação, é lacuna de config.
    //
    // ⚠️ Termo não pesquisável que MESMO ASSIM achou página continua registrado: ali
    // o valor é o clique (`houve_clique`), que é o segundo sinal de `RF-42` e não
    // depende de o termo ser bom. O que não pode entrar é o par (não pesquisável, zero).
    const buscaId = configurada && escopoValido && (termoPesquisavel || paginas.length > 0)
      ? await ctx.conhecimento.registrarBusca({
          solicitanteEmail: eu.email,
          termo,
          resultados: paginas.length,
        })
      : null

    return json({
      termo,
      buscaId,
      buscaConfigurada: configurada,
      itens: paginas.map((p) => ({
        id: p.id,
        titulo: p.titulo,
        espaco: p.espaco,
        trecho: p.trecho,
        // O score é o mesmo insumo da Regra 1 (RF-09), não ordenação visual.
        score: p.score,
        urlOriginal: p.url,
      })),
    })
  }

  //
  // As duas rotas passam pelo MESMO gate (`confluence/acesso.ts`), e nenhuma delas
  // toca o cliente Atlassian antes dele. Toda recusa devolve a mesma resposta: um
  // corpo por motivo confirmaria que a página existe e insinuaria por que está
  // fechada (é o mesmo raciocínio do 404-em-vez-de-403 de `RF-30`).
  const paginaConfluence = caminho.match(/^\/api\/confluence\/pagina\/([^/]+)$/)
  if (paginaConfluence && req.method === 'GET') {
    const id = decodificar(paginaConfluence[1]!)
    const r = id === null
      ? ({ ok: false, motivo: 'id_invalido' } as const)
      : await lerPaginaAutorizada(ctx.atlassian, ctx.valores, id)

    if (!r.ok) {
      await ctx.auditoria.registrar({
        atorEmail: eu.email,
        acao: 'pagina_confluence_lida',
        recurso: id,
        resultado: r.motivo === 'indisponivel' ? 'falha' : 'negado',
        detalhe: { motivo: r.motivo },
      })
      return r.motivo === 'indisponivel' ? ERROS.conteudoIndisponivel() : ERROS.naoEncontrado()
    }

    /**
     * O breadcrumb (`RF-41`) começa AQUI, não na montagem da resposta.
     *
     * Ele é uma subida de até cinco níveis, cada um com verificação de exposição — é rede,
     * e é a parte mais lenta da leitura. As três escritas abaixo (clique, leitura,
     * auditoria) são banco. Encadeados, os dois tempos somam; iniciada aqui e esperada no
     * fim, a subida acontece **durante** as escritas.
     *
     * ⚠️ Só depois de o gate ter aprovado (`r.ok`): começar antes seria consultar a
     * hierarquia de uma página que talvez não possa ser exposta, e a ordem
     * "decidir → depois olhar" é o desenho de `confluence/acesso.ts`.
     */
    const ancestrais = ancestraisExpostos(ctx.atlassian, ctx.valores, r.metadados)

    // T-116 — o `?de=` diz de qual busca a pessoa veio. `via` é DERIVADO: só vale
    // `busca` se o id pertencer a quem está lendo (o e-mail está no `WHERE`).
    const veioDaBusca = await ctx.conhecimento.marcarClique(
      decodificar(url.searchParams.get('de') ?? '') ?? '',
      eu.email,
    )
    await ctx.conhecimento.registrarLeitura({
      solicitanteEmail: eu.email,
      paginaId: r.metadados.id,
      titulo: r.metadados.titulo,
      espaco: r.metadados.espaco,
      via: veioDaBusca ? 'busca' : 'direto',
    })

    await ctx.auditoria.registrar({
      atorEmail: eu.email,
      acao: 'pagina_confluence_lida',
      recurso: r.metadados.id,
      resultado: 'sucesso',
      // Contagem de descartes, não a lista: ela nomeia tag e atributo da página, o
      // que é diagnóstico útil no agregado e ruído no registro por leitura.
      detalhe: { espaco: r.metadados.espaco, descartes: r.conteudo.descartes.length },
    })
    // Só a ÁRVORE. Nenhum campo com HTML: se existisse, existiria caminho para o
    // navegador renderizar string (RNF-06).
    return json({
      id: r.metadados.id,
      titulo: r.metadados.titulo,
      espaco: r.metadados.espaco,
      atualizadoEm: r.metadados.atualizadoEm,
      urlOriginal: r.metadados.url,
      // RF-41 — o caminho até aqui, já filtrado por RN-06 (ver `ancestraisExpostos`).
      // Iniciado acima, esperado agora.
      ancestrais: await ancestrais,
      nos: r.conteudo.nos,
      truncado: r.conteudo.truncado,
    })
  }

  // Os espaços que a pessoa pode navegar — o ponto de ENTRADA da árvore (RF-41).
  //
  // Sem isto a árvore só é alcançável por acidente (a partir de uma página que a busca
  // achou). A allowlist não é segredo: ela é exatamente o que a pessoa pode ver, e
  // esconder o nome do espaço não protegeria nada — só deixaria a navegação sem porta.
  if (caminho === '/api/confluence/espacos' && req.method === 'GET') {
    // Em paralelo com teto: é a PRIMEIRA coisa que a aba Documentação pede, e em série
    // custava uma ida à Atlassian por espaço configurado antes de a tela desenhar
    // qualquer coisa (`D-29` deixou 7 espaços — 7 idas). A ordem da config é preservada
    // porque é ela que a tela mostra, e ordem que muda entre cargas parece defeito.
    const resolvidos = await mapearComLimite(
      ctx.valores.espacos_confluence,
      CONCORRENCIA_ATLASSIAN,
      async (chave) => {
        try {
          return await ctx.atlassian.obterEspaco(chave)
        } catch {
          // Espaço configurado que não resolve não vira erro da tela: os outros valem.
          return null
        }
      },
    )
    const itens = resolvidos
      // Espaço sem homepage não tem raiz para navegar; melhor omitir que oferecer um
      // caminho que morre no clique.
      .filter((e): e is NonNullable<typeof e> => Boolean(e?.homepageId))
      .map((e) => ({ chave: e.chave, nome: e.nome, homepageId: e.homepageId as string }))
    return json({ itens })
  }

  // Árvore do espaço, um nível por vez (RF-41).
  //
  // ⚠️ O `pai` vem do cliente, então ele **também** passa pela verificação de
  // exposição: listar os filhos de uma seção restrita entregaria a estrutura de
  // dentro dela, mesmo que cada filho, isolado, fosse legítimo.
  if (caminho === '/api/confluence/arvore' && req.method === 'GET') {
    const chaveEspaco = (url.searchParams.get('espaco') ?? '').trim()
    // Negação por padrão: espaço fora da allowlist responde como inexistente (D-12),
    // e nem chega a consultar a Atlassian.
    if (!chaveEspaco || !ctx.valores.espacos_confluence.includes(chaveEspaco)) {
      await ctx.auditoria.registrar({
        atorEmail: eu.email,
        acao: 'arvore_navegada',
        recurso: chaveEspaco,
        resultado: 'negado',
        detalhe: { motivo: 'espaco_fora_da_allowlist' },
      })
      return ERROS.naoEncontrado()
    }

    const paiPedido = decodificar(url.searchParams.get('pai') ?? '')
    try {
      const espaco = await ctx.atlassian.obterEspaco(chaveEspaco)
      // Sem `pai`, a raiz é a homepage do espaço — é a raiz que o Confluence mesmo usa.
      const idPai = paiPedido !== null && paiPedido !== '' ? paiPedido : espaco.homepageId
      if (idPai === null) return ERROS.naoEncontrado()

      // O nó de partida precisa ser legível por quem pediu.
      const exposicaoPai = await verificarExposicao(ctx.atlassian, ctx.valores, idPai)
      if (!exposicaoPai.ok) {
        await ctx.auditoria.registrar({
          atorEmail: eu.email,
          acao: 'arvore_navegada',
          recurso: idPai,
          resultado: exposicaoPai.motivo === 'indisponivel' ? 'falha' : 'negado',
          detalhe: { motivo: exposicaoPai.motivo },
        })
        return exposicaoPai.motivo === 'indisponivel'
          ? ERROS.conteudoIndisponivel()
          : ERROS.naoEncontrado()
      }

      /**
       * Descer um nível e subir o breadcrumb são **independentes** — as duas só precisam do
       * pai já aprovado — e estavam em série. Somadas, um clique na árvore custava a busca
       * de filhos (com uma verificação de restrição por item) **mais** até cinco níveis de
       * subida. Em paralelo, o clique custa o mais lento dos dois.
       */
      const [filhos, ancestrais] = await Promise.all([
        ctx.atlassian.listarFilhosDaPagina({
          idPai,
          espacosPermitidos: ctx.valores.espacos_confluence,
          labelsBloqueadas: ctx.valores.labels_bloqueadas,
          limite: LIMITE_NIVEL_ARVORE,
        }),
        ancestraisExpostos(ctx.atlassian, ctx.valores, exposicaoPai.metadados),
      ])
      await ctx.auditoria.registrar({
        atorEmail: eu.email,
        acao: 'arvore_navegada',
        recurso: idPai,
        resultado: 'sucesso',
        detalhe: { espaco: chaveEspaco, filhos: filhos.length },
      })
      return json({
        espaco: { chave: espaco.chave, nome: espaco.nome },
        pai: { id: exposicaoPai.metadados.id, titulo: exposicaoPai.metadados.titulo },
        ancestrais,
        itens: filhos.map((f) => ({ id: f.id, titulo: f.titulo })),
      })
    } catch {
      return ERROS.conteudoIndisponivel()
    }
  }

  // Proxy de anexo — RNF-02: o navegador não tem credencial e não fala com a
  // Atlassian. O `(.+)` no nome é intencional: nome de arquivo tem ponto, espaço e
  // acento. Nada de perigoso vem daí, porque o nome é casado contra a lista de
  // anexos DAQUELA página, não usado para montar caminho.
  const anexoConfluence = caminho.match(/^\/api\/confluence\/anexo\/([^/]+)\/(.+)$/)
  if (anexoConfluence && req.method === 'GET') {
    const id = decodificar(anexoConfluence[1]!)
    const nome = decodificar(anexoConfluence[2]!)

    const negar = async (motivo: string, resposta: Response) => {
      await ctx.auditoria.registrar({
        atorEmail: eu.email,
        acao: 'anexo_servido',
        recurso: id,
        resultado: motivo === 'indisponivel' ? 'falha' : 'negado',
        detalhe: { motivo },
      })
      return resposta
    }

    if (id === null || nome === null) return await negar('id_invalido', ERROS.naoEncontrado())

    const exposicao = await verificarExposicao(ctx.atlassian, ctx.valores, id)
    if (!exposicao.ok) {
      return await negar(
        exposicao.motivo,
        exposicao.motivo === 'indisponivel'
          ? ERROS.conteudoIndisponivel()
          : ERROS.naoEncontrado(),
      )
    }

    let resultado
    try {
      resultado = await ctx.atlassian.obterAnexo(id, nome)
    } catch {
      // Indisponibilidade não vira 404: o anexo existe, só não deu para buscar.
      return await negar('indisponivel', ERROS.conteudoIndisponivel())
    }
    if (resultado.estado === 'nao_encontrado') {
      return await negar('anexo_nao_encontrado', ERROS.naoEncontrado())
    }
    if (resultado.estado === 'grande_demais') {
      return await negar('anexo_grande_demais', ERROS.anexoGrandeDemais())
    }

    // ⚠️ O tipo declarado pela Atlassian NÃO é repassado — ele é decidido aqui.
    const entrega = decidirEntrega(resultado.anexo.tipoDeclarado)
    await ctx.auditoria.registrar({
      atorEmail: eu.email,
      acao: 'anexo_servido',
      recurso: id,
      resultado: 'sucesso',
      detalhe: { tipoServido: entrega.contentType, disposicao: entrega.disposicao },
    })
    return new Response(resultado.anexo.bytes, {
      status: 200,
      headers: {
        ...CABECALHOS_ANEXO,
        'Content-Type': entrega.contentType,
        'Content-Disposition': cabecalhoContentDisposition(
          resultado.anexo.nomeArquivo,
          entrega.disposicao,
        ),
      },
    })
  }

  // --- tipos de chamado disponíveis (RF-28) ---------------------------------
  if (caminho === '/api/tipos-chamado' && req.method === 'GET') {
    const permitidos = new Set(ctx.valores.tipos_chamado_permitidos)
    const todos = await ctx.atlassian.listarTiposChamado()
    const desk = ctx.valores.service_desk_id
    // 🐛 **`listarTiposChamado` varre TODOS os service desks do site**, não o
    // configurado (medido em 11/08/2026: com a allowlist ampliada voltaram tipos dos
    // desks 7, 8 e 9 ao lado dos do 4). A allowlist era a única coisa limitando — e ela
    // é lista de ids, então um id de outro desk passa por ela e por `validarProposta`
    // para **falhar só na criação**, quando o corpo leva `serviceDeskId` fixo da config.
    // Filtrar aqui é o que faz a lista dizer a verdade sobre o que dá para abrir.
    //
    // Sem desk configurado a lista é vazia, coerente com a rota de criação, que já
    // recusa nesse estado — oferecer assunto que não se consegue abrir é pior que
    // oferecer nenhum.
    const doDesk = desk === null ? [] : todos.filter((t) => t.serviceDeskId === desk)
    // Negação por padrão: allowlist vazia expõe ZERO tipos (RNF-07, RF-28).
    return json({ itens: doDesk.filter((t) => permitidos.has(t.id)) })
  }

  // --- admin (RF-49, RF-50) -------------------------------------------------
  if (caminho === '/api/admin/config') {
    if (!eu.isAdmin) return ERROS.semPermissao()
    if (req.method === 'GET') return json({ config: ctx.valores })
    if (req.method === 'PUT') {
      const corpo = await lerJson<{ chave?: unknown; valor?: unknown }>(req)
      const chave = typeof corpo?.chave === 'string' ? corpo.chave : ''
      if (!chaveDeConfigConhecida(chave)) {
        return ERROS.dadosInvalidos('Configuração desconhecida.')
      }
      // ⚠️ O tipo é validado AQUI, não só na tela: esta é uma rota HTTP comum, e
      // `Config.carregar` aceita de volta qualquer JSON válido que estiver gravado.
      // Um `"alto"` em `regra1_threshold_score` sobrevive ao boot e chega à Regra 1
      // como string — o default fail-closed não cobre valor corrompido (T-136).
      const validado = validarValorDeConfig(chave, corpo?.valor)
      if (!validado.ok) return ERROS.dadosInvalidos(validado.motivo)
      await ctx.config.definir(chave, validado.valor as never, eu.email, ctx.agora())
      await ctx.auditoria.registrar({
        atorEmail: eu.email,
        acao: 'config_alterada',
        recurso: chave,
        resultado: 'sucesso',
      })
      return json({ ok: true })
    }
  }

  // T-117 / RF-42 — o backlog de documentação. Admin porque é dado agregado de toda a
  // empresa; o método do registro carrega `_apenasAdmin` no nome pelo mesmo motivo.
  if (caminho === '/api/admin/lacunas' && req.method === 'GET') {
    if (!eu.isAdmin) return ERROS.semPermissao()
    return json(await ctx.conhecimento.agregarLacunas_apenasAdmin())
  }

  // T-095 / O1, R-04 — taxa de deflexão, taxa de override, via de abertura e
  // buscas sem resultado, agregado desde o dia 1. É o subconjunto viável de
  // RF-55 na Fase 1 (sem aderência a SLA, que só existe a partir da Fase 3).
  if (caminho === '/api/admin/metricas' && req.method === 'GET') {
    if (!eu.isAdmin) return ERROS.semPermissao()
    const resumo = await obterResumoMetricas(ctx.db)

    // T-232 / RF-55 — o painel completo. É SUPERFÍCIE, não coleta: tudo abaixo já estava
    // no banco. O SLA vem do retrato que o cron gravou (`avaliacoes_sla`), nunca de uma
    // varredura ao vivo — ver o comentário da tabela em `db/schema.ts`.
    const painel = montarPainel(
      await lerEntradaDoPainel(ctx.db, {
        thresholds: {
          regra1_confluence: ctx.valores.regra1_threshold_score,
          regra2_ajuste_operacional: ctx.valores.regra2_threshold_recorrencia,
        },
        notificacoes: await ctx.notificacoes.contarPorEstado(),
        telemetria: ctx.atlassian.telemetria(),
        sla: await ctx.avaliacoesSla.resumir(),
      }),
    )

    return json({
      ...resumo,
      painel,
      // T-311 — baseline da Fase 0. `null` = não coletado; a tela diz "sem baseline" em
      // vez de comparar contra zero, que pareceria economia de 100%.
      baselineAssentos: ctx.valores.baseline_assentos,
      // Q11: sem canal definido, a tela precisa dizer POR QUE nada foi enviado.
      canalNotificacaoDefinido: ctx.valores.canal_notificacao_padrao !== null,
      // R-06: com piloto ligado, os números são de 1–2 áreas, não da empresa.
      piloto: {
        ligado: ctx.valores.emails_piloto.length > 0,
        pessoas: ctx.valores.emails_piloto.length,
      },
    })
  }

  if (caminho === '/api/admin/auditoria' && req.method === 'GET') {
    if (!eu.isAdmin) return ERROS.semPermissao()
    // Sem filtro, o admin vê TUDO. O default anterior era o próprio e-mail, o que
    // fazia o console de auditoria mostrar só as ações de quem estava olhando —
    // inútil para investigar (`RF-56`).
    const alvo = url.searchParams.get('email')?.trim().toLowerCase()
    const itens = alvo
      ? await ctx.auditoria.listarPorAtor(alvo, 200)
      : await ctx.auditoria.listarRecentes(200)
    return json({ itens })
  }

  // --- diagnóstico: o schema do request type COMO A ATLASSIAN O ENTREGA -----
  //
  // Existe porque `GET /api/tipos-chamado/:id/campos` **não consegue** responder a
  // pergunta "este tipo expõe campo de prioridade?": ele serve o formulário de `RF-27` e
  // por isso descarta `summary`/`description`/`priority` antes de qualquer um poder
  // olhar (`camposAdicionais`). Descarte certo para o produto, ponto cego para
  // diagnóstico — e uma conclusão sobre prioridade tirada daquela rota é inválida por
  // construção, não por engano de quem leu.
  //
  // Três limites, os mesmos das rotas vizinhas — não é uma janela para varrer o site:
  //
  // 1. **Admin**, como todo `/api/admin/*`.
  // 2. **Só a allowlist de `RF-28`**, e `?tipo=` só sabe ESTREITAR: tipo fora dela
  //    responde 404 sem consultar a Atlassian, igual à rota de campos.
  // 3. **Só o service desk configurado** — o `serviceDeskId` vem de `ctx.valores`,
  //    nunca da query.
  //
  // ⚠️ A falha é **por tipo**, não da resposta inteira. Um id de outro desk na allowlist
  // (situação real, ver `listarTiposChamado`) derrubaria a leitura dos outros catorze se
  // uma exceção subisse — e o diagnóstico voltaria vazio justamente na instalação em que
  // ele é mais necessário. Tipo não lido sai como `nao_lido` e **fica fora das duas
  // listas de conclusão**: "não tem prioridade" e "não deu para saber" são respostas
  // diferentes, e misturá-las é o erro que esta rota existe para consertar.
  if (caminho === '/api/admin/tipos-chamado/schema' && req.method === 'GET') {
    if (!eu.isAdmin) return ERROS.semPermissao()

    const serviceDeskId = ctx.valores.service_desk_id
    if (!serviceDeskId) {
      return ERROS.dadosInvalidos(
        'A abertura de chamados ainda não foi configurada nesta instalação. Fale com o time de tech.',
      )
    }

    const permitidos = ctx.valores.tipos_chamado_permitidos
    const pedido = url.searchParams.get('tipo')?.trim() ?? ''
    if (pedido !== '' && !permitidos.includes(pedido)) return ERROS.naoEncontrado()
    const alvos = pedido === '' ? permitidos : [pedido]

    const lidos = await mapearComLimite(alvos, CONCORRENCIA_ATLASSIAN, async (requestTypeId) => {
      try {
        const campos = await ctx.atlassian.obterSchemaDoTipo(serviceDeskId, requestTypeId)
        return { requestTypeId, campos }
      } catch {
        // ⚠️ Sem detalhe do erro na resposta (`RNF-01`, `RNF-30`): o corpo devolvido pela
        // Atlassian pode carregar nome de projeto e dado interno, e este JSON é lido —
        // e provavelmente colado em algum lugar — por quem está diagnosticando.
        return { requestTypeId, campos: null }
      }
    })

    return json({
      serviceDeskId,
      // A pergunta destilada, para não depender de ninguém varrer `itens` na mão.
      tiposComPrioridade: lidos
        .filter((i) => i.campos !== null && temCampoDePrioridade(i.campos))
        .map((i) => i.requestTypeId),
      tiposSemPrioridade: lidos
        .filter((i) => i.campos !== null && !temCampoDePrioridade(i.campos))
        .map((i) => i.requestTypeId),
      tiposNaoLidos: lidos.filter((i) => i.campos === null).map((i) => i.requestTypeId),
      itens: lidos.map((i) =>
        i.campos === null
          ? { requestTypeId: i.requestTypeId, estado: 'nao_lido' as const }
          : {
              requestTypeId: i.requestTypeId,
              estado: 'lido' as const,
              temCampoDePrioridade: temCampoDePrioridade(i.campos),
              totalCampos: i.campos.length,
              campos: i.campos,
            },
      ),
    })
  }

  // --- governança de assentos (RF-51 a RF-54, T-124 a T-128) ----------------
  //
  // As duas rotas leem o CACHE (`inventario_assentos`), nunca a Organizations API
  // ao vivo — ela é lenta demais para consulta interativa (ver T-124). "Sem
  // coleta ainda" e "coleta rodou, zero assentos" são respostas 200 iguais na
  // forma; a tela distingue pelo `coletadoEm: null`.
  if (caminho === '/api/admin/assentos' && req.method === 'GET') {
    if (!eu.isAdmin) return ERROS.semPermissao()
    const snapshot = await ctx.inventarioAssentos.obterMaisRecente()
    const custo = calcularCusto(
      snapshot.itens,
      ctx.valores.custo_mensal_por_produto,
      ctx.valores.assentos_ocioso_dias,
      Date.parse(ctx.agora()),
      ctx.valores.curva_preco_por_produto,
    )
    return json({
      coletadoEm: snapshot.coletadoEm,
      ociosoDesdeDias: ctx.valores.assentos_ocioso_dias,
      // RF-52 — a limitação oficial do dado vai NA TELA, não em rodapé de documento.
      limitacoesUltimoAcesso: LIMITACOES_ULTIMO_ACESSO,
      itens: snapshot.itens,
      custo,
      // T-122/T-123/T-131 — o que ainda não foi verificado contra a API real (Q1) vai
      // PARA A TELA. Um console que promete revogar assento e falha no clique é pior
      // que um console que avisa antes.
      organizacaoConfigurada: ctx.organizacao !== null,
      usandoFakes: ctx.usandoFakes,
      endpointsNaoVerificados: ctx.usandoFakes ? ENDPOINTS_NAO_VERIFICADOS : [],
      // O2, T-311 — baseline da Fase 0. Ausente NÃO inventa número.
      baseline: ctx.valores.baseline_assentos,
    })
  }

  // --- T-131 / RF-57 (P2) — revogar produto ----------------------------------
  //
  // A ÚNICA escrita da credencial de Org Admin, e a rota é desenhada em torno disso:
  //
  // - **Dupla confirmação**, e a segunda é o e-mail digitado. Um "tem certeza?" clicável
  //   é um clique a mais; digitar o e-mail obriga a pessoa a olhar QUEM ela está
  //   afetando — o erro que se quer evitar não é clicar sem querer, é revogar a linha
  //   errada de uma tabela ordenada de outro jeito do que se esperava.
  // - **Nunca sucesso otimista.** Erro da Atlassian volta como erro; marcar "revogado"
  //   e seguir faria o admin riscar a economia da lista com o assento ainda ativo.
  // - **Auditada nos dois casos**, porque é ação sobre a conta de outra pessoa.
  if (caminho === '/api/admin/assentos/revogar' && req.method === 'POST') {
    if (!eu.isAdmin) return ERROS.semPermissao()
    const corpo = await lerJson<Record<string, unknown>>(req)
    const accountId = typeof corpo?.accountId === 'string' ? corpo.accountId.trim() : ''
    const produto = typeof corpo?.produto === 'string' ? corpo.produto.trim() : ''
    const emailConfirmado =
      typeof corpo?.emailConfirmado === 'string' ? corpo.emailConfirmado.trim().toLowerCase() : ''
    const emailEsperado =
      typeof corpo?.email === 'string' ? corpo.email.trim().toLowerCase() : ''

    if (!accountId || !produto || !emailEsperado) {
      return ERROS.dadosInvalidos('Escolha a conta e o produto a revogar.')
    }
    if (emailConfirmado !== emailEsperado) {
      // Recusa registrada: confirmação que não casa pode ser engano, e pode ser alguém
      // testando o formulário com o e-mail de outra pessoa.
      await ctx.auditoria.registrar({
        atorEmail: eu.email,
        acao: 'assento_revogado',
        recurso: accountId,
        resultado: 'negado',
        detalhe: { motivo: 'confirmacao_nao_confere', produto },
      })
      return ERROS.dadosInvalidos(
        'Para confirmar, digite exatamente o e-mail da pessoa cujo acesso será revogado.',
      )
    }
    if (!ctx.organizacao || !ctx.valores.org_id) {
      return ERROS.dadosInvalidos(
        'A governança de assentos ainda não foi configurada nesta instalação (falta a credencial de Org Admin).',
      )
    }

    try {
      await ctx.organizacao.revogarProduto(ctx.valores.org_id, accountId, produto)
    } catch {
      await ctx.auditoria.registrar({
        atorEmail: eu.email,
        acao: 'assento_revogado',
        recurso: accountId,
        resultado: 'falha',
        detalhe: { produto, email: emailEsperado },
      })
      return ERROS.conteudoIndisponivel()
    }

    await ctx.auditoria.registrar({
      atorEmail: eu.email,
      acao: 'assento_revogado',
      recurso: accountId,
      resultado: 'sucesso',
      detalhe: { produto, email: emailEsperado },
    })
    return json({
      ok: true,
      // O inventário é um CACHE diário (T-124): o console continua mostrando o assento
      // até a próxima coleta, e dizer isso evita o admin achar que a revogação falhou.
      aviso:
        'Revogado. O inventário desta tela é atualizado uma vez por dia — a linha só desaparece na próxima coleta.',
    })
  }

  if (caminho === '/api/admin/assentos/recomendacoes' && req.method === 'GET') {
    if (!eu.isAdmin) return ERROS.semPermissao()
    const snapshot = await ctx.inventarioAssentos.obterMaisRecente()
    const recomendacoes = gerarRecomendacoes(
      snapshot.itens,
      ctx.valores.assentos_ocioso_dias,
      Date.parse(ctx.agora()),
    )
    if (url.searchParams.get('formato') === 'csv') {
      return new Response(recomendacoesParaCsv(recomendacoes), {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': 'attachment; filename="recomendacoes-assentos.csv"',
          'X-Content-Type-Options': 'nosniff',
        },
      })
    }
    return json({ itens: recomendacoes })
  }

  return ERROS.naoEncontrado()
}

/**
 * Gate do piloto — R-06, T-302.
 *
 * Devolve `null` quando pode seguir, ou a **resposta de encaminhamento** quando não.
 *
 * ⚠️ Não é 403. Quem está fora do piloto não perdeu acesso a nada — o app ainda não
 * chegou na área dele, e a mensagem diz para onde ir no meio-tempo (`RNF-30`). A
 * consulta à documentação continua liberada de propósito: ela não abre chamado, deflete
 * — barrar a leitura seria barrar exatamente o que o projeto quer que aconteça.
 */
async function verificarPiloto(
  ctx: Contexto,
  eu: Identidade,
  caminho: string,
): Promise<Response | null> {
  const decisao = dentroDoPiloto(eu.email, ctx.valores.emails_piloto)
  if (decisao.dentro) return null
  await ctx.auditoria.registrar({
    atorEmail: eu.email,
    acao: 'fora_do_piloto',
    recurso: caminho,
    resultado: 'negado',
    detalhe: { tamanhoDaLista: ctx.valores.emails_piloto.length },
  })
  return json({ erro: 'fora_do_piloto', mensagem: decisao.mensagem }, 403)
}

/**
 * Aviso de criação (RF-44).
 *
 * ⚠️ **Nunca derruba a criação.** O chamado já existe; um canal fora do ar não pode
 * transformar "chamado aberto" em erro na tela de quem abriu (`RNF-18`). O aviso fica na
 * fila e o cron o entrega — e se nem isso der, a pessoa vê o chamado na aba dela, que é
 * o caminho que não depende de canal nenhum.
 *
 * Submissão `pendente` (a Atlassian estava fora e o outbox vai reprocessar) não gera
 * aviso: não há `issueKey` para citar, e "seu chamado foi aberto" sem número é pior que
 * o silêncio de dois minutos até o cron rodar.
 */
async function avisarCriacao(
  ctx: Contexto,
  resultado: { issueKey: string | null; estado: string; duplicada: boolean },
  dados: { solicitanteEmail: string; titulo: string; prioridade: Prioridade },
): Promise<void> {
  if (!resultado.issueKey || resultado.estado !== 'criado' || resultado.duplicada) return
  try {
    await ctx.notificador.avisarCriacao({
      issueKey: resultado.issueKey,
      solicitanteEmail: dados.solicitanteEmail,
      titulo: dados.titulo,
      prioridade: dados.prioridade,
      slaPrimeiraRespostaHoras: SLA_PRIMEIRA_RESPOSTA_HORAS[dados.prioridade],
      criadoEm: ctx.agora(),
      valores: ctx.valoresNotificacao,
    })
  } catch {
    // Silencioso por desenho — ver o aviso acima. A falha de fila aparece na contagem
    // por estado do console (`/api/admin/metricas`), não na cara de quem abriu chamado.
  }
}

/**
 * Descreve a FORMA de um valor opaco, sem revelar o valor.
 *
 * ⚠️ Existe para um problema concreto: a plataforma diz que estampa um header
 * `X-Godeploy-Cron` **assinado**, e não documenta o formato. Medido em 07/08/2026, o que
 * chega tem 81 caracteres contra 64 da chave configurada — ou seja, **não é a chave crua**,
 * e comparar por igualdade nunca vai casar. Para verificar direito é preciso saber se é
 * `timestamp.hmac`, JWT, base64, ou outra coisa.
 *
 * O que sai daqui é **estrutura**: separadores, e por segmento o comprimento e o conjunto
 * de caracteres. Nada de conteúdo — `abc123` e `def456` produzem exatamente a mesma
 * descrição. É a diferença entre "sei que é hex de 64" e "sei qual hex".
 */
function descreverFormato(valor: string): {
  separadores: string
  segmentos: { tamanho: number; conjunto: string }[]
} {
  const conjuntoDe = (s: string): string => {
    if (/^\d+$/.test(s)) return 'digitos'
    if (/^[0-9a-f]+$/.test(s)) return 'hex-minusculo'
    if (/^[0-9A-F]+$/.test(s)) return 'hex-maiusculo'
    if (/^[A-Za-z0-9_-]+$/.test(s)) return 'base64url'
    if (/^[A-Za-z0-9+/=]+$/.test(s)) return 'base64'
    return 'misto'
  }
  return {
    // Só os caracteres que NÃO são de conteúdo: `.`, `,`, `=`, `:` etc.
    separadores: valor.replace(/[A-Za-z0-9_-]/g, ''),
    segmentos: valor
      .split(/[^A-Za-z0-9_-]+/)
      .filter((s) => s.length > 0)
      .map((s) => ({ tamanho: s.length, conjunto: conjuntoDe(s) })),
  }
}

/** Sem acento e em minúsculas — "orçamento" e "orcamento" procuram a mesma coisa. */
function normalizarBusca(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim()
}

/** Tetos das rodadas de cron. Cada item custa chamadas à Atlassian (`R-02`). */
const LIMITE_POLLING = 50
const LIMITE_ENVIO_NOTIFICACOES = 25
const LIMITE_ALERTAS_SLA = 30

/**
 * Limites do termo de busca.
 *
 * O mínimo evita que uma letra vire consulta ao site inteiro; o máximo evita que um
 * termo de 5 KB vire CQL. Os dois protegem a credencial única (`R-02`) de virar
 * amplificador — e nenhum deles é allowlist, então não há decisão de exposição aqui.
 */
const MIN_TERMO_BUSCA = 2
const MAX_TERMO_BUSCA = 200
const LIMITE_BUSCA_PADRAO = 10
const LIMITE_BUSCA_MAXIMO = 25

/**
 * Teto de itens por nível da árvore (`RF-41`).
 *
 * Cada item custa uma consulta de restrição (a terceira condição de `RN-06` não cabe
 * no CQL), então o teto é o que impede um nível gigante de virar dezenas de chamadas
 * com a credencial única (`R-02`). Nível maior que isto aparece truncado — pior que
 * mostrar tudo, melhor que derrubar o orçamento de API de todos.
 */
const LIMITE_NIVEL_ARVORE = 50

/**
 * Quantos resultados pedir. Vem do cliente, então é **clampado**: cada resultado
 * custa uma consulta de restrição de página (`RN-06`), e `?limite=9999` seria uma
 * varredura do site pagando por página.
 */
function limiteDeBusca(bruto: string | null): number {
  const n = Number.parseInt(bruto ?? '', 10)
  if (!Number.isInteger(n) || n < 1) return LIMITE_BUSCA_PADRAO
  return Math.min(n, LIMITE_BUSCA_MAXIMO)
}

/**
 * Decodifica um pedaço de caminho sem explodir com `%` solto.
 *
 * `decodeURIComponent('%zz')` lança, e um `URIError` subindo até o roteador viraria
 * 500 numa entrada que é só malformada. `null` = trate como não encontrado.
 */
function decodificar(bruto: string): string | null {
  try {
    return decodeURIComponent(bruto)
  } catch {
    return null
  }
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
  /**
   * `RF-63` — o resultado do anexo é um dado **separado** do resultado da criação.
   *
   * ⚠️ Separado no tipo, não só no texto: aninhar o anexo dentro do estado da criação
   * (um `estado: 'criado_sem_anexo'`, por exemplo) faria a tela decidir o que mostrar
   * sobre o chamado a partir de algo que aconteceu com um arquivo.
   */
  anexo: ResultadoAnexoNaCriacao,
) {
  return {
    issueKey: r.issueKey,
    estado: r.estado,
    duplicada: r.duplicada,
    verificadoRegras: r.verificadoRegras,
    anexo,
    prioridade,
    // RN-08 — sempre PRIMEIRA RESPOSTA, e o rótulo deixa isso explícito.
    slaPrimeiraRespostaHoras: SLA_PRIMEIRA_RESPOSTA_HORAS[prioridade],
    mensagem:
      r.estado === 'criado'
        ? 'Chamado aberto. Você acompanha tudo por aqui.'
        : 'Recebemos sua solicitação e estamos abrindo o chamado. Nada se perdeu — você verá a chave aqui em instantes.',
  }
}

/**
 * Extrai os valores dos campos adicionais do corpo (RF-27, T-130).
 *
 * Não é um lugar para bloquear a submissão: entrada malformada vira "nenhum
 * campo adicional", não erro — o formulário fixo (título/descrição/tipo/
 * prioridade) não pode deixar de funcionar por causa de um extra torto.
 */
/**
 * Lê o schema do request type **uma vez por criação** — T-401 + T-404.
 *
 * ⚠️ Uma leitura, duas decisões: quais campos adicionais passam (T-401) e se a
 * pergunta de `RF-62` existe (T-404). Duas leituras seriam duas chamadas com a
 * credencial única para responder à mesma pergunta (`R-02`) — e, pior, poderiam
 * **discordar** no meio de uma criação, com o filtro aceitando um campo que o gate
 * decidiu não existir.
 *
 * Indisponibilidade devolve `{ conhecido: false }` e **audita**. O `null` não serve
 * aqui: "o tipo não tem campos" e "não deu para saber quais tem" levam a decisões
 * opostas em `exigeDeclaracaoDeAnexo`.
 */
async function lerSchemaDoTipo(
  ctx: Contexto,
  atorEmail: string,
  serviceDeskId: string,
  tipoChamadoId: string,
): Promise<SchemaDoTipo> {
  try {
    const campos = await ctx.atlassian.obterCamposDoTipo(serviceDeskId, tipoChamadoId)
    return { conhecido: true, campos }
  } catch {
    await ctx.auditoria.registrar({
      atorEmail,
      acao: 'schema_tipo_indisponivel',
      recurso: tipoChamadoId,
      resultado: 'falha',
      detalhe: { tipoChamadoId, consequencia: 'declaracao_de_anexo_nao_exigida' },
    })
    return { conhecido: false }
  }
}

/**
 * Aplica o schema já lido sobre os campos que o cliente mandou — T-401.
 *
 * ⚠️ **Schema indisponível descarta tudo**, e o descarte é auditado. Silêncio aqui
 * esconderia duas coisas diferentes com a mesma cara: "o tipo não tem esse campo" e
 * "não deu para saber quais campos o tipo tem".
 */
async function filtrarCamposComSchema(
  ctx: Contexto,
  atorEmail: string,
  tipoChamadoId: string,
  campos: Record<string, string> | null,
  schema: SchemaDoTipo,
): Promise<Record<string, string> | null> {
  if (!campos) return null
  if (!schema.conhecido) {
    await ctx.auditoria.registrar({
      atorEmail,
      acao: 'campos_dinamicos_descartados',
      recurso: tipoChamadoId,
      resultado: 'negado',
      detalhe: { motivo: 'schema_indisponivel', campos: Object.keys(campos) },
    })
    return null
  }
  const filtrados = filtrarPeloSchema(campos, schema.campos)
  const descartadas = Object.keys(campos).filter((c) => !filtrados || !(c in filtrados))
  if (descartadas.length > 0) {
    await ctx.auditoria.registrar({
      atorEmail,
      acao: 'campos_dinamicos_descartados',
      recurso: tipoChamadoId,
      resultado: 'negado',
      // Só os NOMES dos campos: o valor é conteúdo do chamado e não tem por que
      // ser duplicado na auditoria.
      detalhe: { motivo: 'fora_do_schema', campos: descartadas },
    })
  }
  return filtrados
}

/**
 * O gate de `RF-62`, nas duas rotas de criação — T-402, T-403, T-404.
 *
 * Devolve a declaração já decidida, ou a `Response` de recusa. Uma função só para os
 * dois caminhos porque a trava precisa ser a mesma: um segundo lugar decidindo isto
 * seria um caminho de criação que não pergunta, e "qual dos dois esqueceu" é o tipo de
 * divergência que ninguém vê até alguém abrir chamado sem evidência pelo lado errado.
 */
async function autorizarDeclaracaoDeAnexo(
  ctx: Contexto,
  atorEmail: string,
  tipoChamadoId: string,
  schema: SchemaDoTipo,
  bruto: unknown,
): Promise<{ readonly declarouAnexo: boolean | null } | { readonly recusa: Response }> {
  const r = validarDeclaracao(bruto, exigeDeclaracaoDeAnexo(schema))
  if (r.ok) return { declarouAnexo: r.declarouAnexo }
  await ctx.auditoria.registrar({
    atorEmail,
    acao: 'declaracao_anexo_ausente',
    recurso: tipoChamadoId,
    resultado: 'negado',
  })
  return { recusa: ERROS.dadosInvalidos(r.mensagem) }
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

/**
 * Webhook do Jira — RF-48, T-206. **A trava da Fase 3.**
 *
 * As três decisões estão em `notificacoes/webhook.ts`; aqui está o que elas produzem:
 *
 * - Segredo inválido → **403 sempre igual**, e o registro na auditoria. É a tentativa de
 *   burla, e ela precisa deixar rastro.
 * - Segredo válido → **202 sempre igual**, com ou sem vínculo local. Um 404 para chamado
 *   desconhecido diria "este chamado não passou pelo goatlas", que já é informação sobre
 *   o chamado de outro (mesmo raciocínio do 404-em-vez-de-403 de `RF-30`).
 * - O corpo do evento é **ponteiro**: sai dele uma chave de chamado e nada mais. O que a
 *   pessoa vai ler é relido da Atlassian (`servico.ts`), então evento forjado com texto
 *   de phishing não vira notificação enviada.
 */
async function tratarWebhook(req: Request, ctx: Contexto, url: URL): Promise<Response> {
  if (req.method !== 'POST') return ERROS.naoEncontrado()

  const enviado = req.headers.get(HEADER_WEBHOOK) ?? url.searchParams.get(PARAM_WEBHOOK)
  if (!segredoConfere(enviado, ctx.segredoWebhook)) {
    await ctx.auditoria.registrar({
      atorEmail: '(webhook)',
      acao: 'webhook_recebido',
      recurso: null,
      resultado: 'negado',
      // ⚠️ O segredo enviado NÃO vai para a auditoria: ela é lida por admin, e um
      // segredo quase certo no log é meio caminho andado para quem o vê.
      detalhe: { motivo: ctx.segredoWebhook ? 'segredo_invalido' : 'segredo_nao_configurado' },
    })
    return ERROS.semPermissao()
  }

  const corpo = await lerJson<unknown>(req)
  const issueKey = chaveDoPayload(corpo)
  if (!issueKey) {
    await ctx.auditoria.registrar({
      atorEmail: '(webhook)',
      acao: 'webhook_recebido',
      resultado: 'falha',
      detalhe: { motivo: 'sem_chave_valida' },
    })
    // 202 mesmo aqui: a Atlassian repetiria o evento por dias se recebesse erro, e o
    // problema não é dela.
    return json({ ok: true }, 202)
  }

  const r = await ctx.notificador.sincronizarChamado(issueKey, 'webhook', ctx.valoresNotificacao)
  await ctx.auditoria.registrar({
    atorEmail: '(webhook)',
    acao: 'webhook_recebido',
    recurso: issueKey,
    resultado: r.ok ? 'sucesso' : 'falha',
    detalhe: { eventos: r.eventos },
  })
  return json({ ok: true }, 202)
}

/** RF-59 — health check das dependências, em rota própria e pública. */
async function tratarHealth(ctx: Contexto): Promise<Response> {
  const [atlassian, ia, teamguide] = await Promise.all([
    ctx.atlassian.verificarSaude(),
    ctx.ia.verificarSaude(),
    // `D-40` — a fonte organizacional entra aqui para que medi-la **não custe abrir um
    // chamado numa fila real**: era essa a única evidência que existia dela.
    // Fonte não configurada é estado válido (`FR-13`), não avaria.
    ctx.teamguide?.verificarSaude() ?? Promise.resolve({ ok: true, detalhe: 'não configurada' }),
  ])
  let banco = { ok: true, detalhe: 'ok' }
  try {
    await ctx.db.query('SELECT 1 AS ok', [])
  } catch {
    banco = { ok: false, detalhe: 'indisponível' }
  }
  // 🚨 `teamguide` fica FORA do agregado, de propósito. A área é fail-open por desenho
  // (`D-37`, `RNF-18`): com a fonte no chão os chamados continuam abrindo, então um 503
  // aqui diria "o app caiu" sobre um app inteiro de pé — e ensinaria o time a ignorar o
  // health check, que é o custo que nenhum alarme falso paga.
  const ok = atlassian.ok && ia.ok && banco.ok
  return json(
    {
      ok,
      usandoFakes: ctx.usandoFakes,
      modoDemo: ctx.modoDemo,
      somenteLeitura: ctx.somenteLeitura,
      dependencias: {
        atlassian,
        ia,
        banco,
        teamguide,
        sso: { ok: true, detalhe: 'edge GoDeploy' },
      },
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

  // ⚠️ O header é **assinado**, não é a chave crua — medido no app real em 07/08/2026, e
  // era a razão de as sete rotas de cron devolverem 403 com a chave certa configurada.
  // Toda a lógica (HMAC, janela de tempo, comparação em tempo constante) está em
  // `cron-auth.ts`, com teste próprio: é código de autenticação, não detalhe de roteador.
  //
  // O corpo é lido antes porque uma das construções candidatas o inclui na assinatura. As
  // rotas de cron não têm corpo hoje, e ler string vazia é barato.
  const corpoCron = await req.clone().text().catch(() => '')
  const veredito = await verificarCron({
    headerEnviado: enviado,
    chave: esperado,
    metodo: req.method,
    caminho,
    corpo: corpoCron,
    agoraMs: Date.parse(ctx.agora()),
    // O edge injeta este header quando há PESSOA na requisição. O gateway de cron não —
    // e é o que impede um funcionário logado de disparar cron forjando o header.
    identidadeDeUsuario: req.headers.get(HEADER_EMAIL),
  })

  if (!veredito.ok) {
    await ctx.auditoria.registrar({
      atorEmail: '(cron)',
      acao: 'acesso_negado',
      recurso: caminho,
      resultado: 'negado',
      // ⚠️ **Diagnóstico sem vazar segredo.** A documentação da plataforma diz que o
      // header é "assinado", e não está confirmado se o que chega é a chave crua ou uma
      // assinatura derivada dela — se for assinatura, a comparação por igualdade nunca casa
      // e o sintoma é idêntico a "esqueci de configurar". Estes três campos distinguem os
      // casos na primeira rodada:
      //
      //   headerAusente → o cron não está batendo aqui (rota errada, ou o edge barrou)
      //   chaveAusente  → falta o secret `GODEPLOY_CRON_KEY`
      //   tamanhos diferentes → é OUTRO formato (assinatura, ou a chave errada)
      //   tamanhos iguais e não casou → é a chave errada, mesmo formato
      //
      // O que vai para a auditoria é **comprimento**, nunca valor nem prefixo. Comprimento
      // de segredo é vazamento desprezível; prefixo não é, e é por isso que ele fica fora.
      detalhe: {
        motivo: 'cron_nao_autenticado',
        // O motivo específico é o que separa "esqueci de configurar" de "alguém está
        // tentando" — distinção que precisa existir na auditoria, não só no código.
        detalhe: veredito.motivo,
        tamanhoRecebido: enviado?.length ?? 0,
        tamanhoEsperado: esperado?.length ?? 0,
      },
    })
    // O MESMO diagnóstico vai para o log da plataforma, e não é redundância: a auditoria
    // vive em `env.DB` e só é legível por uma rota de admin atrás do SSO — quem está
    // depurando o cron normalmente está fora do navegador. `getAppLogs` é a superfície que
    // se lê de fora.
    //
    // ⚠️ Os **nomes** dos cabeçalhos entram; os valores, não. É o que revela se a
    // plataforma mudou o nome do header (aí `x-godeploy-cron` some da lista) — a hipótese
    // que nenhum outro campo distingue.
    console.log(
      '[cron] recusado',
      JSON.stringify({
        caminho,
        motivo: veredito.motivo,
        headers: [...req.headers.keys()].sort(),
        tamanhoRecebido: enviado?.length ?? 0,
        tamanhoEsperado: esperado?.length ?? 0,
        formatoRecebido: enviado === null ? null : descreverFormato(enviado),
      }),
    )
    return ERROS.semPermissao()
  }

  // Qual construção casou. É o que permite reduzir a lista de candidatas a uma só depois
  // da primeira rodada — o rótulo não revela assinatura nenhuma.
  console.log('[cron] autenticado', JSON.stringify({ caminho, candidata: veredito.candidata }))

  if (caminho === '/api/cron/reprocessar-submissoes') {
    const r = await ctx.chamados.reprocessarPendentes(25)

    /**
     * T-415 — o expurgo dos anexos pendentes pega carona AQUI, e não na retenção.
     *
     * ⚠️ Duas razões, e as duas valem por si:
     *
     * 1. `aplicarRetencao` **não apaga nada** com política `null`, que é o default do
     *    MVP (`D-20`, e apagar dado pessoal é irreversível). Apoiar-se nela deixaria a
     *    tabela crescer para sempre.
     * 2. `/api/cron/retencao` é a rota **destrutiva**, a única que mantém HMAC
     *    obrigatório — e por isso responde **403** hoje (`CLAUDE.md`). Pendurar o
     *    expurgo lá seria escrever código que nunca roda.
     *
     * Aqui é seguro porque este expurgo não é destrutivo no sentido que importa: a linha
     * já não vale nada (o id expirou do lado da Atlassian horas antes), não é histórico
     * de ninguém, e o chamado — que é o dado real — não é tocado.
     */
    const limite = new Date(
      Date.parse(ctx.agora()) - TTL_ANEXO_PENDENTE_HORAS * 3600 * 1000,
    ).toISOString()
    const anexosPendentesExpurgados = await ctx.anexosPendentes.expurgarAnterioresA(limite)

    await ctx.auditoria.registrar({
      atorEmail: '(cron)',
      acao: 'submissao_reprocessada',
      resultado: 'sucesso',
      detalhe: { ...r, anexosPendentesExpurgados },
    })
    return json({ ...r, anexosPendentesExpurgados })
  }

  if (caminho === '/api/cron/reconciliar-vinculos') {
    const recuperados = await ctx.chamados.reconciliarVinculos(50)
    return json({ recuperados })
  }

  // T-124 — coleta diária do inventário de assentos (RF-51, RF-52). A Organizations
  // API não serve consulta interativa: o cron é o único lugar que a chama, e o
  // console só lê o que ele gravou.
  if (caminho === '/api/cron/coletar-inventario') {
    // Sem credencial de Org Admin (Q1) ou sem `org_id` configurado (RNF-25), a
    // coleta não tem como rodar. Isso não é falha do cron — é ausência de
    // configuração, e ele diz isso em vez de fingir sucesso ou gritar erro.
    if (!ctx.organizacao || !ctx.valores.org_id) {
      return json({ ok: true, registros: 0, motivo: 'organizacao_nao_configurada' })
    }
    const orgId = ctx.valores.org_id
    try {
      const varredura = await ctx.organizacao.listarUsuarios(orgId)
      const entradas = []
      for (const usuario of varredura.usuarios) {
        try {
          entradas.push({
            usuario,
            ultimoAcesso: await ctx.organizacao.ultimoAcesso(orgId, usuario.accountId),
          })
        } catch {
          // RNF-18: uma conta cujo último acesso falhou não derruba a coleta das
          // outras. Ela entra sem o dado, não some do inventário.
          entradas.push({ usuario, ultimoAcesso: null })
        }
      }
      const r = await ctx.inventarioAssentos.registrarColeta(entradas, ctx.agora())
      await ctx.auditoria.registrar({
        atorEmail: '(cron)',
        acao: 'inventario_coletado',
        // ⚠️ Coleta incompleta ou com suspensão desconhecida **não** é `sucesso`. Ela
        // grava o que deu, mas marcá-la como sucesso apagaria o único registro de que
        // o inventário daquele dia não é a organização inteira — e é sobre esse
        // inventário que a tela recomenda revogar assento.
        resultado: varredura.parcial || !varredura.suspensaoConhecida ? 'falha' : 'sucesso',
        detalhe: {
          usuarios: varredura.usuarios.length,
          registros: r.registros,
          suspensas: varredura.suspensas,
          suspensaoConhecida: varredura.suspensaoConhecida,
          parcial: varredura.parcial,
        },
      })
      return json({
        ok: true,
        ...r,
        suspensas: varredura.suspensas,
        suspensaoConhecida: varredura.suspensaoConhecida,
        parcial: varredura.parcial,
      })
    } catch (e) {
      await ctx.auditoria.registrar({
        atorEmail: '(cron)',
        acao: 'inventario_coletado',
        resultado: 'falha',
        detalhe: { erro: e instanceof Error ? e.message : String(e) },
      })
      return ERROS.conteudoIndisponivel()
    }
  }

  // T-212 — polling incremental, SEMPRE ligado (RF-47).
  //
  // ⚠️ Não é redundância do webhook: notificação não pode depender de mecanismo único, e
  // o webhook depende de o time de tech tê-lo registrado no Jira e de a Atlassian
  // entregar. O polling é o que é nosso. A dedupe (`RF-47`) é o que torna os dois
  // conviverem sem a pessoa receber tudo em dobro.
  if (caminho === '/api/cron/polling-jira') {
    const marca = await ctx.marcaAguaPolling.obter()
    let alterados
    try {
      alterados = await ctx.atlassian.buscarChamadosAtualizadosDesde({
        desde: marca,
        limite: LIMITE_POLLING,
      })
    } catch {
      await ctx.auditoria.registrar({
        atorEmail: '(cron)',
        acao: 'polling_executado',
        resultado: 'falha',
        detalhe: { motivo: 'busca_indisponivel' },
      })
      // ⚠️ A marca-d'água NÃO avança. Avançar aqui perderia a janela inteira: os
      // chamados que mudaram durante a queda ficariam atrás da marca e nunca seriam
      // olhados de novo — o erro que `RNF-17` proíbe no outbox, na versão silenciosa.
      return ERROS.conteudoIndisponivel()
    }

    const comVinculo = await ctx.vinculos.filtrarComVinculo(alterados.map((a) => a.issueKey))
    let eventos = 0
    let falhas = 0
    /** Só avança a marca até o último chamado processado COM SUCESSO. */
    let carimboSeguro: string | null = null
    const porChave = new Map(alterados.map((a) => [a.issueKey, a.atualizadoEm]))

    for (const vinculo of comVinculo) {
      const r = await ctx.notificador.sincronizarChamado(
        vinculo.issueKey,
        'polling',
        ctx.valoresNotificacao,
      )
      if (!r.ok) {
        falhas += 1
        // Um chamado ilegível interrompe o AVANÇO da marca, não a rodada: os outros
        // continuam sendo processados, e a próxima janela reveja este.
        break
      }
      eventos += r.eventos
      const carimbo = porChave.get(vinculo.issueKey)
      if (carimbo) carimboSeguro = carimbo
    }

    // Sem nenhum chamado com vínculo, a marca avança para o instante da rodada: não há
    // nada a reprocessar, e deixá-la parada faria a janela crescer para sempre.
    if (comVinculo.length === 0) await ctx.marcaAguaPolling.definir(ctx.agora())
    else if (carimboSeguro) await ctx.marcaAguaPolling.definir(carimboSeguro)

    await ctx.auditoria.registrar({
      atorEmail: '(cron)',
      acao: 'polling_executado',
      resultado: falhas > 0 ? 'falha' : 'sucesso',
      detalhe: { alterados: alterados.length, nossos: comVinculo.length, eventos, falhas },
    })
    return json({ ok: true, alterados: alterados.length, nossos: comVinculo.length, eventos, falhas })
  }

  // T-225 — despacho da fila. Falha de envio não perde a notificação.
  if (caminho === '/api/cron/enviar-notificacoes') {
    const r = await ctx.notificador.despacharPendentes(LIMITE_ENVIO_NOTIFICACOES)
    return json({ ok: true, ...r })
  }

  // T-231 — alerta de SLA de PRIMEIRA RESPOSTA (RF-46, RN-08).
  if (caminho === '/api/cron/alertas-sla') {
    const abertos = await ctx.vinculos.listarParaAvaliacaoSla(LIMITE_ALERTAS_SLA)
    let alertados = 0
    let avaliados = 0
    for (const vinculo of abertos) {
      const r = await ctx.notificador.avaliarESinalizarSla(vinculo, ctx.valoresNotificacao)
      avaliados += 1
      if (r.alertou) alertados += 1
    }
    await ctx.auditoria.registrar({
      atorEmail: '(cron)',
      acao: 'alerta_sla',
      resultado: 'sucesso',
      detalhe: { avaliados, alertados },
    })
    return json({ ok: true, avaliados, alertados })
  }

  // T-243 — retenção (RNF-33). Sem política configurada, não apaga nada.
  if (caminho === '/api/cron/retencao') {
    const r = await aplicarRetencao(
      ctx.db,
      {
        conversasDias: ctx.valores.retencao_conversas_dias,
        auditoriaDias: ctx.valores.retencao_auditoria_dias,
        notificacoesDias: ctx.valores.retencao_notificacoes_dias,
      },
      Date.parse(ctx.agora()),
    )
    // Registrado DEPOIS do expurgo e com contagem, não com conteúdo: a auditoria do
    // apagamento não pode carregar o que foi apagado.
    await ctx.auditoria.registrar({
      atorEmail: '(cron)',
      acao: 'retencao_executada',
      resultado: 'sucesso',
      detalhe: { ...r, pisoAuditoriaDias: PISO_AUDITORIA_DIAS },
    })
    return json({ ok: true, ...r })
  }

  return ERROS.naoEncontrado()
}
