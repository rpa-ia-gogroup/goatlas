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
import { ancestraisExpostos, lerPaginaAutorizada, verificarExposicao } from '../confluence/acesso'
import { CABECALHOS_ANEXO, cabecalhoContentDisposition, decidirEntrega } from '../confluence/anexo'
import { LIMITACOES_ULTIMO_ACESSO } from '../atlassian/organizacao'
import { calcularCusto } from '../governanca/custo'
import { obterResumoMetricas } from '../governanca/metricas'
import { gerarRecomendacoes } from '../governanca/recomendacoes'
import { recomendacoesParaCsv } from '../governanca/csv'
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

    // RF-27 (T-130) — campos adicionais do request type, coletados pelo
    // formulário dinâmico. Ausente/inválido = nenhum, nunca erro: o caminho sem
    // IA não pode regredir por causa de um campo extra malformado.
    const camposDinamicos = extrairCamposDinamicos(corpo?.camposDinamicos)

    const r = await ctx.chamados.abrirPorFormulario({
      solicitanteEmail: eu.email,
      chaveIdempotencia: chave,
      payload: {
        titulo: validada.proposta.titulo,
        descricao: validada.proposta.descricao,
        tipoChamadoId: validada.proposta.tipoChamadoId,
        serviceDeskId,
        prioridade: validada.proposta.prioridade,
        ...(camposDinamicos ? { camposDinamicos } : {}),
      },
    })
    return json(respostaCriacao(r, validada.proposta.prioridade), 201)
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
      const itens = await ctx.atlassian.obterCamposDoTipo(serviceDeskId, requestTypeId)
      return json({ itens })
    } catch {
      return ERROS.conteudoIndisponivel()
    }
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
        // RNF-19: um chamado ilegível não derruba a lista. E em vez de mostrar
        // "título indisponível", usa o que NÓS gravamos no outbox — o dado já
        // estava lá. A pessoa vê seus chamados com conteúdo mesmo com a Atlassian
        // fora; só o status é que fica honestamente marcado como indisponível.
        const submissao = await ctx.outbox.obterPorIssueKey(v.issueKey)
        itens.push({
          issueKey: v.issueKey,
          titulo: submissao?.payload.titulo ?? null,
          status: 'indisponivel',
          prioridade: submissao?.payload.prioridade ?? null,
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

    // RF-33 / D-13 — o nome vem do login corporativo Google, não de entrada do
    // usuário: é o que torna o prefixo confiável no comentário público.
    await ctx.atlassian.comentar(comentar[1]!, texto, eu.email, eu.nome)
    await ctx.auditoria.registrar({
      atorEmail: eu.email,
      acao: 'comentario_criado',
      recurso: comentar[1]!,
      resultado: 'sucesso',
    })
    return json({ ok: true }, 201)
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

    let paginas
    try {
      paginas = await ctx.atlassian.buscarConfluence({
        termo,
        espacosPermitidos: ctx.valores.espacos_confluence,
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

    await ctx.auditoria.registrar({
      atorEmail: eu.email,
      acao: 'busca_confluence',
      recurso: termo,
      resultado: 'sucesso',
      detalhe: { encontradas: paginas.length, via: 'superficie' },
    })
    // Busca sem resultado é o mapa das lacunas de documentação (RF-42) — na MESMA
    // forma que a Regra 1 grava, para T-117 ler uma coisa só. Mas só quando havia
    // onde procurar: sem espaço configurado a lacuna é de configuração, e registrar
    // envenenaria o mapa com termos que ninguém deixou de documentar.
    if (configurada && paginas.length === 0) {
      await ctx.auditoria.registrar({
        atorEmail: eu.email,
        acao: 'busca_confluence',
        recurso: termo,
        resultado: 'falha',
        detalhe: { motivo: 'sem_resultado_util', lacunaDocumentacao: true, via: 'superficie' },
      })
    }

    // T-116 — o registro só acontece quando a busca de fato procurou em algum lugar.
    // Sem espaço configurado ela não é lacuna de documentação, é lacuna de config.
    const buscaId = configurada
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
      ancestrais: await ancestraisExpostos(ctx.atlassian, ctx.valores, r.metadados),
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
    const itens: { chave: string; nome: string; homepageId: string }[] = []
    for (const chave of ctx.valores.espacos_confluence) {
      try {
        const espaco = await ctx.atlassian.obterEspaco(chave)
        // Espaço sem homepage não tem raiz para navegar; melhor omitir que oferecer um
        // caminho que morre no clique.
        if (espaco.homepageId) {
          itens.push({ chave: espaco.chave, nome: espaco.nome, homepageId: espaco.homepageId })
        }
      } catch {
        // Espaço configurado que não resolve não vira erro da tela: os outros valem.
      }
    }
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

      const filhos = await ctx.atlassian.listarFilhosDaPagina({
        idPai,
        espacosPermitidos: ctx.valores.espacos_confluence,
        labelsBloqueadas: ctx.valores.labels_bloqueadas,
        limite: LIMITE_NIVEL_ARVORE,
      })
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
        ancestrais: await ancestraisExpostos(ctx.atlassian, ctx.valores, exposicaoPai.metadados),
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
    return json(await obterResumoMetricas(ctx.db))
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
    )
    return json({
      coletadoEm: snapshot.coletadoEm,
      ociosoDesdeDias: ctx.valores.assentos_ocioso_dias,
      // RF-52 — a limitação oficial do dado vai NA TELA, não em rodapé de documento.
      limitacoesUltimoAcesso: LIMITACOES_ULTIMO_ACESSO,
      itens: snapshot.itens,
      custo,
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

/**
 * Extrai os valores dos campos adicionais do corpo (RF-27, T-130).
 *
 * Não é um lugar para bloquear a submissão: entrada malformada vira "nenhum
 * campo adicional", não erro — o formulário fixo (título/descrição/tipo/
 * prioridade) não pode deixar de funcionar por causa de um extra torto.
 */
function extrairCamposDinamicos(bruto: unknown): Record<string, string> | null {
  if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto)) return null
  const saida: Record<string, string> = {}
  for (const [chave, valor] of Object.entries(bruto as Record<string, unknown>)) {
    if (typeof valor !== 'string') continue
    const limpo = valor.trim()
    if (limpo.length === 0) continue
    saida[chave] = limpo
  }
  return Object.keys(saida).length > 0 ? saida : null
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
      modoDemo: ctx.modoDemo,
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
      const usuarios = await ctx.organizacao.listarUsuarios(orgId)
      const entradas = []
      for (const usuario of usuarios) {
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
        resultado: 'sucesso',
        detalhe: { usuarios: usuarios.length, registros: r.registros },
      })
      return json({ ok: true, ...r })
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

  return ERROS.naoEncontrado()
}
