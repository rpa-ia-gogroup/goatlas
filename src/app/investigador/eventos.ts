/**
 * O tradutor de eventos — spec 013, `FR-22`, `FR-24`.
 *
 * ## Por que este arquivo existe
 *
 * A spec 009 entregou o registro e a tela mostrava, para cada evento, **o `tipo` cru em
 * snake_case** (`ia_extracao_recusada`, `proposta_rederivada`) seguido do **JSON inteiro,
 * sempre aberto**. Um turno registra por volta de catorze eventos, e o maior deles carrega o
 * histórico completo da conversa a cada ciclo: a linha do tempo era uma parede de dados com
 * uma frase por cima. O relato foi literal — *"apenas um conjunto de logs bizarros"*.
 *
 * Aqui cada tipo ganha uma tradução: um **título em português**, um punhado de **linhas**
 * `rótulo → valor` com o que se lê de relance, e **blocos** para o texto longo, que carrega o
 * tamanho antes do conteúdo. O JSON cru continua existindo — dentro de um `<details>`
 * fechado, na tela —, porque a evidência é o produto e ninguém investiga com resumo.
 *
 * ## As três travas
 *
 * 1. 🚨 **`Record<TipoDeEvento, Descritor>`** — tipo novo de evento **sem tradução não
 *    compila**. É o mesmo desenho de `FAMILIA` em `config/validar.ts` e de
 *    `PAINEIS_DO_CONSOLE` (`D-49`): a pergunta "isto tem casa na tela?" acontece na revisão,
 *    não seis meses depois quando alguém repara num rótulo em inglês.
 * 2. ⚠️ **Tipo desconhecido em tempo de execução devolve o rótulo cru**, nunca nada. Dado
 *    gravado por uma versão anterior do app existe, e evento que some é pior que evento feio
 *    — a mesma escolha que `ORIGENS` já fazia.
 * 3. ⚠️ **Nada aqui reescreve o que foi gravado.** As funções só escolhem o que mostrar
 *    primeiro; a coleta já redigiu segredo (`FR-4`) e já truncou (`FR-3`), e a marca de
 *    truncamento tem de sobreviver até a tela.
 *
 * ⚠️ **Puro de propósito.** Nenhum React aqui: é isto que permite a suíte rodar em
 * `environment: 'node'` afirmando sobre o texto que chega, e é o que permitirá a exportação
 * da sessão (Phase 4) reaproveitar exatamente a mesma tradução em vez de escrever a segunda,
 * que divergiria na primeira correção.
 */

import type { TipoDeEvento } from '@/lib/investigador/tipos'

/** Um par que cabe numa linha. O valor já vem formatado e em português. */
export interface LinhaDeEvento {
  readonly rotulo: string
  readonly valor: string
}

/**
 * Texto longo: o que **não** cabe numa linha e não deve ser lido de saída.
 *
 * ⚠️ `bytes` é o tamanho do texto, e ele aparece **antes** do conteúdo — é o que faz a
 * pessoa decidir se abre. Sem isso, "o histórico enviado ao modelo" e "a resposta de duas
 * frases" têm a mesma cara fechados.
 */
export interface BlocoDeEvento {
  readonly rotulo: string
  readonly texto: string
}

export interface EventoDescrito {
  readonly titulo: string
  readonly linhas: readonly LinhaDeEvento[]
  readonly blocos: readonly BlocoDeEvento[]
}

/** O que um descritor recebe: os dados do evento, já parseados (ou vazios). */
type Dados = Readonly<Record<string, unknown>>
type Descritor = (d: Dados) => EventoDescrito

// --- leitores tolerantes -----------------------------------------------------
//
// Todo dado aqui veio de `JSON.parse` de uma coluna gravada por uma versão qualquer do app.
// Nenhum leitor lança, e nenhum inventa: ausência devolve `null`, e `linha()` descarta.

function texto(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t === '' ? null : t
}

function numero(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/** Booleano vira palavra. `false` **é** informação — por isso não cai no `null`. */
function simNao(v: unknown): string | null {
  return typeof v === 'boolean' ? (v ? 'sim' : 'não') : null
}

function lista(v: unknown): string | null {
  if (!Array.isArray(v) || v.length === 0) return null
  return v.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(', ')
}

function objeto(v: unknown): Dados | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Dados) : null
}

/** JSON legível para o que não é texto nem escalar (evidência, payload, argumentos). */
function comoJson(v: unknown): string | null {
  if (v === null || v === undefined) return null
  if (Array.isArray(v) && v.length === 0) return null
  if (typeof v === 'object' && Object.keys(v as object).length === 0) return null
  try {
    return JSON.stringify(v, null, 2)
  } catch {
    return null
  }
}

function linha(rotulo: string, valor: string | number | null): LinhaDeEvento[] {
  if (valor === null || valor === '') return []
  return [{ rotulo, valor: String(valor) }]
}

function bloco(rotulo: string, texto: string | null): BlocoDeEvento[] {
  return texto === null ? [] : [{ rotulo, texto }]
}

/** `2 ferramentas` × `1 ferramenta` — regra 4, e o defeito que já apareceu na staging. */
export function contagem(n: number, singular: string, plural: string): string {
  return `${n} ${n === 1 ? singular : plural}`
}

// --- vocabulários ------------------------------------------------------------

/**
 * Os motivos de "não houve proposta", em português.
 *
 * 🚨 **É a frase que responde ao caso de 14/08/2026.** Deixar o rótulo técnico na tela
 * devolveria metade do problema: quem lê o console precisa saber **o que fazer**, e cada um
 * destes pede uma ação diferente. Mora aqui, e não na tela, porque a lista de sessões **e** o
 * evento `ia_extracao_recusada` mostram o mesmo motivo — duas cópias divergiriam.
 */
export const MOTIVOS_SEM_PROPOSTA: Readonly<Record<string, string>> = {
  allowlist_de_tipos_vazia:
    'Nenhum assunto liberado na configuração — o cartão não tinha como nascer.',
  nenhum_tipo_com_nome:
    'Os assuntos liberados não vieram com nome do service desk configurado — o app se recusa a propor no escuro.',
  extracao_sem_proposta:
    'O modelo respondeu e a proposta foi recusada na leitura. Abra o registro cru para ver a resposta.',
  bloqueio_pendente_na_gravacao:
    'A proposta ficou pronta e foi descartada: nasceu um bloqueio enquanto ela estava sendo montada.',
  excecao_na_extracao: 'A montagem da proposta lançou um erro. Abra o registro cru para ver a classe.',
}

/** O estado da conversa, como se fala. Desconhecido volta cru (trava 2). */
const ESTADOS: Readonly<Record<string, string>> = {
  coletando: 'coletando informação',
  bloqueado: 'bloqueada por uma regra',
  aguardando_confirmacao: 'esperando a confirmação',
  criado: 'chamado aberto',
  encerrado: 'encerrada',
}

/**
 * As duas regras de deflexão, como se fala.
 *
 * 🚨 **Medido no navegador em 20/08/2026:** o título do evento saía
 * *"Bloqueio pela regra1_confluence"* — o `regra` vem do dado (`rules/index.ts#Regra`), e
 * interpolá-lo cru reabre o defeito de `D-63` **pelo valor**, não pelo rótulo. A varredura de
 * `snake_case` do teste olhava só os rótulos e passou verde.
 *
 * ⚠️ **Nome de FERRAMENTA continua cru de propósito** (`search_confluence`,
 * `check_jira_history`): ali o identificador é a coisa investigada — é ele que se casa com
 * `toolsPermitidas` em `agent/gate.ts` —, e traduzi-lo obrigaria a tradução de volta na cabeça
 * de quem lê o código.
 */
const REGRAS: Readonly<Record<string, string>> = {
  regra1_confluence: 'Regra 1 — a documentação parece resolver',
  regra2_ajuste_operacional: 'Regra 2 — o histórico do Jira parece resolver',
}

/** Os seis estados da leitura de anexo (spec 007). `irrelevante` é sucesso (`D-64`). */
const ESTADOS_DE_ANEXO: Readonly<Record<string, string>> = {
  analisando: 'ainda lendo',
  pronta: 'lida, e o conteúdo entrou no turno',
  irrelevante: 'lida, e não acrescentava nada',
  tipo_nao_suportado: 'tipo de arquivo que o app não lê',
  sem_conteudo: 'o arquivo não tinha texto legível',
  falhou: 'a leitura falhou',
}

function traduzir(mapa: Readonly<Record<string, string>>, v: unknown): string | null {
  const t = texto(v)
  return t === null ? null : (mapa[t] ?? t)
}

/**
 * As linhas de uma proposta de chamado.
 *
 * ⚠️ **Nunca o `tipoChamadoId` sozinho como se fosse o assunto** — id não é nome (`RNF-30`,
 * `D-53`). Ele aparece rotulado como id, que é o que ele é: aqui, ao contrário do cartão da
 * pessoa, o número é justamente o que se quer conferir.
 */
function linhasDaProposta(prefixo: string, v: unknown): LinhaDeEvento[] {
  const p = objeto(v)
  if (p === null) return []
  return [
    ...linha(`${prefixo}título`, texto(p.titulo)),
    ...linha(`${prefixo}assunto (id do request type)`, texto(p.tipoChamadoId)),
    ...linha(`${prefixo}prioridade`, texto(p.prioridade)),
    ...linha(`${prefixo}área`, texto(p.area) ?? (p.area === null ? 'nenhuma' : null)),
    ...linha(`${prefixo}componente`, texto(p.componente)),
    ...linha(`${prefixo}motivo da prioridade`, texto(p.motivoPrioridade)),
  ]
}

// --- os descritores ----------------------------------------------------------
//
// 🚨 `Record<TipoDeEvento, Descritor>`: tipo novo sem tradução não compila.

const DESCRITORES: Readonly<Record<TipoDeEvento, Descritor>> = {
  // ---------------------------------------------------------------- a pessoa
  mensagem_usuario: (d) => ({
    titulo: 'Mensagem da pessoa',
    linhas: linha('estado da conversa', traduzir(ESTADOS, d.estadoDaConversa)),
    blocos: bloco('O que ela escreveu', texto(d.texto)),
  }),

  proposta_editada: (d) => ({
    titulo: 'A pessoa editou o cartão',
    linhas: [...linhasDaProposta('depois · ', d.depois), ...linhasDaProposta('antes · ', d.antes)],
    blocos: [],
  }),

  formulario_alterado: (d) => ({
    titulo: `Campo do formulário alterado${texto(d.campo) ? `: ${texto(d.campo)}` : ''}`,
    linhas: [
      ...linha('tela', texto(d.tela)),
      ...linha('de', texto(d.de) ?? '(vazio)'),
      ...linha('para', texto(d.para) ?? '(vazio)'),
    ],
    blocos: [],
  }),

  override: (d) => ({
    titulo: 'A pessoa insistiu — override do bloqueio',
    linhas: [
      ...linha('bloqueios sobrepostos', numero(d.bloqueiosSobrepostos)),
      // ⚠️ O motivo é o insumo do mapa de lacunas (`RF-42`): é ele que diz qual página
      // faltava. Mostrá-lo aqui é o ponto do evento, não um detalhe.
      ...linha('motivo que ela deu', texto(d.motivo) ?? '(não informou)'),
    ],
    blocos: [],
  }),

  declaracao_anexo: (d) => ({
    titulo: 'Declaração de anexo',
    linhas: [
      ...linha('disse ter material', simNao(d.declarouAnexo)),
      ...linha('arquivos já enviados', numero(d.anexosPendentes)),
    ],
    blocos: [],
  }),

  anexo_recebido: (d) => ({
    titulo: `Anexo recebido${texto(d.nome) ? `: ${texto(d.nome)}` : ''}`,
    linhas: [
      ...linha('tipo declarado pelo navegador', texto(d.tipo)),
      ...linha('tamanho', tamanho(numero(d.bytes))),
      ...linha('nome repetido (renomeado antes de subir)', simNao(d.duplicado)),
    ],
    blocos: [],
  }),

  confirmacao: (d) => ({
    titulo: 'A pessoa confirmou a abertura',
    linhas: [
      ...linhasDaProposta('', d.proposta),
      ...linha('declarou ter anexo', simNao(d.declarouAnexo)),
    ],
    blocos: [
      ...bloco('Campos do formulário enviados junto', comoJson(d.camposDaConversa)),
      ...bloco('Prioridade, como ela vai ao Jira', comoJson(d.prioridadeParaOJira)),
    ],
  }),

  // ---------------------------------------------------------------------- a IA
  ia_chat: (d) => ({
    titulo: `Ida ao modelo${numero(d.ciclo) !== null ? ` · ciclo ${numero(d.ciclo)}` : ''}`,
    linhas: [
      // 🚨 A lista de tools permitidas é a **primeira** camada de `RF-08`. Ver que ela estava
      // vazia explica, sozinha, um turno em que o modelo "não fez nada".
      ...linha('ferramentas oferecidas', lista(d.toolsPermitidas) ?? 'nenhuma'),
      ...linha(
        'ferramentas que ele pediu',
        Array.isArray(d.toolsPropostas)
          ? d.toolsPropostas
              .map((t) => (objeto(t) ? (texto((t as Dados).nome) ?? '?') : String(t)))
              .join(', ') || 'nenhuma'
          : null,
      ),
    ],
    blocos: [
      ...bloco('O que o modelo respondeu', texto(d.textoDoModelo)),
      ...bloco('O histórico que foi enviado a ele', historicoLegivel(d.historicoEnviado)),
    ],
  }),

  ia_extracao: (d) => ({
    titulo: 'Extração da proposta',
    linhas: linhasDaProposta('', d.proposta),
    blocos: bloco('Resposta crua do modelo', texto(d.respostaBrutaDoModelo)),
  }),

  ia_extracao_recusada: (d) => {
    const motivo = texto(d.motivo)
    return {
      titulo: 'Não houve cartão',
      linhas: linha('por quê', motivo === null ? null : (MOTIVOS_SEM_PROPOSTA[motivo] ?? motivo)),
      blocos: bloco('Resposta crua do modelo', texto(d.respostaBrutaDoModelo)),
    }
  },

  ia_classificacao: (d) => ({
    titulo: 'Classificação pela IA',
    linhas: [...linha('resultado', texto(d.resultado)), ...linha('chamado', texto(d.issueKey))],
    blocos: bloco('Resposta crua do modelo', texto(d.respostaBrutaDoModelo)),
  }),

  anexo_analisado: (d) => ({
    titulo: `Leitura do anexo${texto(d.nome) ? `: ${texto(d.nome)}` : ''}`,
    linhas: [
      ...linha('estado', traduzir(ESTADOS_DE_ANEXO, d.estado)),
      ...linha('tipo declarado', texto(d.tipoDeclarado)),
    ],
    blocos: bloco('O que a leitura entendeu', texto(d.descricao)),
  }),

  // ----------------------------------------------------------------- o servidor
  resposta_agente: (d) => {
    const descartado = d.textoDoModeloDescartado === true
    return {
      titulo: descartado
        ? 'Resposta do turno — o texto do modelo foi DESCARTADO'
        : 'Resposta do turno',
      linhas: [
        ...linha('ferramentas executadas', lista(d.toolsExecutadas) ?? 'nenhuma'),
        ...linha('ferramentas recusadas', lista(d.toolsRecusadas)),
        ...linha('havia bloqueio de pé', simNao(d.bloqueioPendente)),
        ...linha('a conversa já tinha cartão', simNao(d.temProposta)),
      ],
      blocos: [
        ...bloco('O que a pessoa leu', texto(d.textoExibido)),
        // ⚠️ Os DOIS textos, e só quando divergem (`D-21`): com bloqueio, quem fala é o
        // servidor e o texto do modelo nunca chega à tela dela. Sem ver os dois lado a lado,
        // "o agente disse X" e "a pessoa leu Y" são indistinguíveis depois do fato.
        ...(descartado ? bloco('O que o modelo tinha escrito (jogado fora)', texto(d.textoDoModelo)) : []),
      ],
    }
  },

  tool_executada: (d) => ({
    titulo: `Ferramenta executada: ${texto(d.tool) ?? '(sem nome)'}${d.falhou === true ? ' — e FALHOU' : ''}`,
    linhas: [
      // ⚠️ "Falhou" não é o mesmo que "não rodou" (`RNF-18`): falha satisfaz a ordem de
      // `RF-08` e marca o chamado como não verificado. A distinção precisa estar na tela.
      ...linha('falhou', simNao(d.falhou)),
      ...linha('disparou bloqueio', simNao(d.bloqueou)),
      ...linha('argumentos', comoJson(d.argumentos)),
    ],
    blocos: bloco('O que voltou ao modelo', texto(d.paraModelo)),
  }),

  tool_recusada: (d) => ({
    titulo: `Ferramenta recusada: ${texto(d.toolProposta) ?? '(sem nome)'}`,
    linhas: [...linha('o que estava permitido no momento', lista(d.permitidas) ?? 'nada')],
    blocos: bloco('Argumentos que ele mandou', comoJson(d.argumentos)),
  }),

  bloqueio: (d) => ({
    titulo: `Bloqueio · ${traduzir(REGRAS, d.regra) ?? 'regra não identificada'} — a conversa fica parada até o override`,
    linhas: linha('motivo', texto(d.motivo)),
    blocos: bloco('A evidência que o app usou', comoJson(d.evidencia)),
  }),

  proposta_rederivada: (d) => {
    // Dois eventos com o mesmo tipo: a rederivação normal do turno e o botão "montar agora"
    // (`D-76`). Confundi-los faria a tela dizer "a IA mudou de opinião" sobre um clique.
    if (d.forcado === true) {
      return {
        titulo:
          d.montou === true
            ? 'A pessoa pediu para montar o chamado agora — e saiu'
            : 'A pessoa pediu para montar o chamado agora — e NÃO saiu',
        linhas: linhasDaProposta('', d.proposta),
        blocos: [],
      }
    }
    const alterados = lista(d.alterados)
    return {
      titulo: alterados === null ? 'Cartão rederivado — a IA não mudou nada' : 'Cartão rederivado',
      linhas: [
        ...linha('a IA mudou', alterados),
        ...linha('mudou o assunto', simNao(d.assuntoMudou)),
        ...linha('campos que ela sugeriu', comoJson(d.camposSugeridos)),
        // Recusa de ajuste é o par de `FR-13`/`FR-14` da spec 008: a prosa não pode dizê-la.
        ...linha('ajustes recusados', comoJson(d.recusasDeAjuste)),
      ],
      blocos: [],
    }
  },

  payload_final: (d) => {
    const p = objeto(d.payload)
    return {
      titulo: 'Entregando ao Jira',
      linhas: [
        ...linha('via', texto(d.via)),
        ...linha('assunto (id do request type)', p ? texto(p.tipoChamadoId) : null),
        ...linha('prioridade', (p ? texto(p.prioridade) : null) ?? 'nenhuma'),
        ...linha('as duas verificações rodaram', simNao(d.verificadoRegras)),
        ...linha('área do solicitante', texto(d.area) ?? 'nenhuma'),
        ...linha('chave de idempotência', texto(d.chaveIdempotencia)),
      ],
      // 🚨 O corpo exato entregue à Atlassian. É ele que responde "faltou campo obrigatório?"
      // — a pergunta que custou três chamados em `D-74`.
      blocos: bloco('O corpo, como foi entregue', comoJson(d.payload)),
    }
  },

  desfecho_criacao: (d) => {
    const chave = texto(d.issueKey)
    if (chave !== null) {
      return { titulo: `Chamado criado: ${chave}`, linhas: [], blocos: [] }
    }
    const transitorio = d.transitorio === true
    return {
      titulo: transitorio
        ? 'A criação falhou de forma TRANSITÓRIA — o cron tenta de novo'
        : 'A criação falhou de forma DEFINITIVA — esta submissão não será reprocessada',
      linhas: linha('erro', texto(d.erro)),
      blocos: [],
    }
  },

  erro_de_rota: (d) => ({
    titulo: 'A rota lançou',
    linhas: [...linha('classe', texto(d.classe)), ...linha('mensagem', texto(d.mensagem))],
    blocos: bloco('Pilha', texto(d.pilha)),
  }),

  // ------------------------------------------------------------ o que sai daqui
  chamada_externa: (d) => ({
    titulo: `${texto(d.alvo) ?? 'externo'} · ${texto(d.metodo) ?? '?'} ${texto(d.caminho) ?? ''}`.trim(),
    linhas: [
      ...linha('status', numero(d.status)),
      ...linha('falha', texto(d.falha)),
    ],
    blocos: [],
  }),
}

/** Tamanho em bytes, dito como se fala. */
export function tamanho(bytes: number | null): string | null {
  if (bytes === null) return null
  if (bytes < 1024) return `${bytes} bytes`
  return `${(bytes / 1024).toFixed(1).replace('.', ',')} kB`
}

/**
 * O histórico enviado ao modelo, como texto.
 *
 * ⚠️ **Vira texto, não JSON.** É a conversa; lida como JSON, ela some dentro das aspas
 * escapadas — que é exatamente o que a tela fazia antes. O papel vai em português porque é
 * rótulo, não dado: `user`/`assistant`/`tool` são vocabulário do provedor.
 */
function historicoLegivel(v: unknown): string | null {
  if (!Array.isArray(v) || v.length === 0) return null
  const papeis: Readonly<Record<string, string>> = {
    user: 'pessoa',
    assistant: 'agente',
    tool: 'ferramenta',
    system: 'sistema',
  }
  return v
    .map((m) => {
      const o = objeto(m)
      if (o === null) return String(m)
      const papel = texto(o.papel) ?? '?'
      const nome = texto(o.toolNome)
      const cabeca = `${papeis[papel] ?? papel}${nome ? ` · ${nome}` : ''}`
      return `[${cabeca}]\n${texto(o.conteudo) ?? ''}`
    })
    .join('\n\n')
}

/**
 * A tradução de um evento.
 *
 * ⚠️ **Tipo desconhecido não some** — devolve o rótulo cru como título, que é feio e correto.
 * Dado gravado por uma versão anterior do app é o caso normal numa tabela com trinta dias de
 * retenção e deploys semanais.
 */
export function descreverEvento(
  tipo: string,
  dadosJson: string | null,
  resumoGravado: string | null,
): EventoDescrito {
  let dados: Dados = {}
  if (dadosJson !== null) {
    try {
      const parseado = JSON.parse(dadosJson) as unknown
      dados = objeto(parseado) ?? {}
    } catch {
      // Corpo truncado (`FR-3`) não é JSON válido de propósito. O bloco cru na tela continua
      // mostrando o texto inteiro com a marca; aqui a tradução simplesmente não tem campos.
    }
  }
  const descritor = DESCRITORES[tipo as TipoDeEvento] as Descritor | undefined
  if (descritor === undefined) {
    // ⚠️ O resumo gravado é a melhor frase disponível para um tipo que esta versão não
    // conhece — ele foi escrito em português por quem emitiu o evento.
    return { titulo: texto(resumoGravado) ?? tipo, linhas: [], blocos: [] }
  }
  return descritor(dados)
}

/** Exportado para a suíte afirmar que a união está coberta (`SC-2`). */
export const TIPOS_TRADUZIDOS = Object.keys(DESCRITORES) as readonly TipoDeEvento[]
