/**
 * As opções do console, escritas como **decisão** — `RF-49`, `RF-50`, `RF-53`.
 *
 * A aba antiga listava 14 campos com o nome do campo do banco: *"Regra 2 — campo
 * que delimita 'mesmo tipo'"*, *"score mínimo para bloquear"*. Quem administra não
 * escolhe um `score`; escolhe **o quanto o agente precisa estar convencido para
 * interromper alguém**. O rótulo aqui é sempre a segunda coisa.
 *
 * Três regras que este arquivo existe para manter:
 *
 * 1. **Rótulo é a decisão, ajuda é o que você precisa saber para decidir, efeito é
 *    o que está acontecendo agora.** Cada um faz um trabalho só — a ajuda não
 *    repete o rótulo, e o efeito não explica o campo em abstrato: ele lê o valor
 *    atual.
 * 2. **Nenhuma seção passa de 3 controles.** Se não couber, a seção está misturando
 *    dois assuntos.
 * 3. **A copy mora em dado, não espalhada no JSX** — mudar uma frase é mudar uma
 *    linha, e é o que torna barato acertar o texto depois de ver gente usando.
 *
 * ⚠️ **O que NÃO está aqui é decisão, não esquecimento** (`D-15`): TTL de cache,
 * limite de requisições por minuto e teto de tickets lidos pela Regra 2 continuam
 * em `ConfigValores` e continuam mudáveis sem deploy — mas ninguém os decide sem
 * ler o código, e cada um deles na tela custava atenção de quem precisa achar o
 * que importa.
 */

import { useState, type ReactNode } from 'react'
import type { ConfigValores } from '../api'
import type { EstadoCapacidade, SecaoDoConsole } from '@/lib/config/diagnostico'
import { Selo } from '../componentes'

/** Só as chaves que o console edita. As demais não têm descritor, de propósito. */
export type ChaveEditavel =
  | 'dominios_permitidos'
  | 'admins'
  | 'service_desk_id'
  | 'tipos_chamado_permitidos'
  | 'campo_solicitante_id'
  | 'espacos_confluence'
  | 'labels_bloqueadas'
  | 'regra1_threshold_score'
  | 'regra2_threshold_recorrencia'
  | 'regra2_janela_dias'
  | 'regra2_campo_agrupamento'
  | 'regra2_exemplos_ajuste_operacional'
  | 'teto_custo_conversa_usd'
  | 'org_id'
  | 'assentos_ocioso_dias'

export type TipoCampo =
  /** Itens curtos separados por vírgula, com pré-visualização do que será salvo. */
  | 'lista'
  /** Um item por linha — para frases, onde vírgula é pontuação e não separador. */
  | 'linhas'
  | 'texto'
  | 'numero'
  /** 0–1 no banco, 0–100 na tela. A pessoa pensa em "75% de certeza". */
  | 'porcentagem'
  | 'escolha'

export interface OpcaoDeEscolha {
  readonly valor: string
  readonly rotulo: string
}

export interface DescritorCampo {
  readonly chave: ChaveEditavel
  /** A decisão, em português. Nunca o nome da chave. */
  readonly rotulo: string
  /** O que a pessoa precisa saber para decidir. Não repete o rótulo. */
  readonly ajuda: string
  readonly tipo: TipoCampo
  readonly exemplo?: string
  /** Sufixo do controle numérico — "dias", "US$", "%". */
  readonly unidade?: string
  readonly opcoes?: readonly OpcaoDeEscolha[]
  /** Campo cuja ausência não desliga nada. A tela diz isso; o resto não é opcional. */
  readonly opcional?: boolean
  /** O que acontece **com o valor que está lá agora**. */
  readonly efeito: (c: ConfigValores) => string
}

export interface DescritorSecao {
  readonly id: SecaoDoConsole
  /** Nome curto, para a trilha. */
  readonly rotulo: string
  /** Título da seção aberta. */
  readonly titulo: string
  /** Uma frase dizendo de que a seção trata. */
  readonly resumo: string
  readonly grupo: 'configurar' | 'acompanhar'
  readonly campos: readonly DescritorCampo[]
}

/* ---------- helpers de frase ------------------------------------------- */

function lista(itens: readonly string[]): string {
  return itens.join(', ')
}

function contar(n: number, singular: string, plural: string): string {
  return `${n} ${n === 1 ? singular : plural}`
}

const AGRUPAMENTO: readonly OpcaoDeEscolha[] = [
  { valor: 'labels', rotulo: 'A etiqueta do chamado' },
  { valor: 'components', rotulo: 'O componente' },
  { valor: 'issuetype', rotulo: 'O tipo do item' },
]

/* ---------- as seções --------------------------------------------------- */

export const SECOES: readonly DescritorSecao[] = [
  {
    id: 'visao',
    rotulo: 'Visão geral',
    titulo: 'O que está no ar',
    resumo:
      'O estado de cada parte do app, a partir da configuração atual. Vazio aqui significa negar — então "desligado" é um estado normal, não um defeito.',
    grupo: 'configurar',
    campos: [],
  },
  {
    id: 'entrada',
    rotulo: 'Quem entra',
    titulo: 'Quem entra no goatlas',
    resumo: 'O login é do Google corporativo; aqui se decide de quem ele é aceito.',
    grupo: 'configurar',
    campos: [
      {
        chave: 'dominios_permitidos',
        rotulo: 'Domínios de e-mail aceitos',
        ajuda:
          'Só entra quem tem e-mail de um destes domínios. Lista vazia nega todo mundo — não é "todos liberados".',
        tipo: 'lista',
        exemplo: 'gocase.com, gobeaute.com.br',
        efeito: (c) =>
          c.dominios_permitidos.length === 0
            ? 'Hoje ninguém entra: a lista está vazia.'
            : `Hoje entra quem tem e-mail de ${lista(c.dominios_permitidos)}.`,
      },
      {
        chave: 'admins',
        rotulo: 'Quem administra',
        ajuda:
          'Vê esta aba e muda estas opções. Ninguém vira administrador por cargo ou por ser o primeiro a entrar — só por estar aqui.',
        tipo: 'lista',
        exemplo: 'joao@gocase.com',
        efeito: (c) =>
          c.admins.length === 0
            ? 'Hoje ninguém está na lista — esta aba só está aberta pela configuração do ambiente.'
            : `Hoje ${contar(c.admins.length, 'pessoa administra', 'pessoas administram')}: ${lista(c.admins)}.`,
      },
    ],
  },
  {
    id: 'chamados',
    rotulo: 'Chamados',
    titulo: 'Abertura de chamados',
    resumo:
      'Onde os chamados nascem no Jira Service Management e quais assuntos o app oferece.',
    grupo: 'configurar',
    campos: [
      {
        chave: 'service_desk_id',
        rotulo: 'Fila onde o chamado nasce',
        ajuda:
          'O identificador da fila no Jira Service Management. Sem ele, o agente conversa mas termina sem conseguir abrir nada.',
        tipo: 'texto',
        exemplo: '12',
        efeito: (c) =>
          c.service_desk_id === null
            ? 'Hoje nenhum chamado é aberto — nem pela conversa, nem pelo formulário.'
            : `Hoje todo chamado nasce na fila ${c.service_desk_id}.`,
      },
      {
        chave: 'tipos_chamado_permitidos',
        rotulo: 'Assuntos que podem ser abertos',
        ajuda:
          'Os tipos de solicitação do portal que o app oferece. Nada fora desta lista é criado, mesmo que o agente sugira.',
        tipo: 'lista',
        exemplo: 'rt-10, rt-11',
        efeito: (c) =>
          c.tipos_chamado_permitidos.length === 0
            ? 'Hoje nenhum assunto é oferecido — a lista vazia não libera todos, não oferece nenhum.'
            : `Hoje ${contar(c.tipos_chamado_permitidos.length, 'assunto está disponível', 'assuntos estão disponíveis')}.`,
      },
      {
        chave: 'campo_solicitante_id',
        rotulo: 'Campo do Jira que recebe quem pediu',
        ajuda:
          'Todo chamado nasce pela conta de serviço, então o Jira não sabe de quem ele é. Este campo devolve essa informação. Peça ao time de tech o identificador do campo "Solicitante" no projeto do portal.',
        tipo: 'texto',
        exemplo: 'customfield_10050',
        opcional: true,
        efeito: (c) =>
          c.campo_solicitante_id === null
            ? 'Hoje o nome de quem pediu vai só na descrição do chamado — que é o suficiente para ler, mas não dá para filtrar por ele no Jira.'
            : 'Hoje o nome de quem pediu vai na descrição e também no campo estruturado, dá para filtrar por ele no Jira.',
      },
    ],
  },
  {
    id: 'documentacao',
    rotulo: 'Documentação',
    titulo: 'O que o app pode ler do Confluence',
    resumo:
      'A mesma lista serve a busca da aba Documentação e à página que o agente oferece antes de abrir chamado.',
    grupo: 'configurar',
    campos: [
      {
        chave: 'espacos_confluence',
        rotulo: 'Espaços que o app pode ler',
        ajuda:
          'Use a chave do espaço, aquela que aparece na URL do Confluence. A busca só procura aqui — e página com restrição de leitura fica fora mesmo assim.',
        tipo: 'lista',
        exemplo: 'TECH, RH, FIN',
        efeito: (c) =>
          c.espacos_confluence.length === 0
            ? 'Hoje a busca não procura em lugar nenhum e avisa que não está configurada.'
            : `Hoje a busca procura em ${lista(c.espacos_confluence)}.`,
      },
      {
        chave: 'labels_bloqueadas',
        rotulo: 'Etiquetas que escondem a página',
        ajuda:
          'Página com qualquer uma destas etiquetas não aparece na busca nem é oferecida pelo agente, mesmo estando num espaço liberado.',
        tipo: 'lista',
        exemplo: 'confidencial, rascunho',
        efeito: (c) =>
          c.labels_bloqueadas.length === 0
            ? 'Hoje nenhuma etiqueta esconde página.'
            : `Hoje a etiqueta ${lista(c.labels_bloqueadas)} esconde a página.`,
      },
    ],
  },
  {
    id: 'interrupcao',
    rotulo: 'Interrupções',
    titulo: 'Quando o agente interrompe',
    resumo:
      'Antes de abrir chamado o agente faz duas verificações: procura a resposta na documentação e olha o histórico de chamados parecidos. Interromper não é barrar — quem insiste sempre passa, e o motivo fica registrado logo abaixo.',
    grupo: 'configurar',
    campos: [
      {
        chave: 'regra1_threshold_score',
        rotulo: 'Certeza para mandar ler a documentação antes',
        ajuda:
          'Quanto o agente precisa estar convencido de que a página responde. Mais alto interrompe menos gente e erra menos; mais baixo interrompe mais e incomoda quem já sabia.',
        tipo: 'porcentagem',
        unidade: '%',
        efeito: (c) =>
          `Hoje o agente só interrompe quando está pelo menos ${Math.round(c.regra1_threshold_score * 100)}% convencido de que achou a resposta.`,
      },
      {
        chave: 'regra2_campo_agrupamento',
        rotulo: 'O que faz dois chamados serem parecidos',
        ajuda:
          'O campo do Jira usado para agrupar o histórico. Combine com o time de tech: é o que decide se "parecido" quer dizer mesmo assunto ou mesmo sistema.',
        tipo: 'escolha',
        opcoes: AGRUPAMENTO,
        efeito: (c) => {
          const o = AGRUPAMENTO.find((x) => x.valor === c.regra2_campo_agrupamento)
          return o
            ? `Hoje dois chamados são "parecidos" quando compartilham: ${o.rotulo.toLowerCase()}.`
            : 'Hoje o agrupamento usa um campo que esta tela não conhece — confirme com o time de tech.'
        },
      },
      {
        chave: 'regra2_exemplos_ajuste_operacional',
        rotulo: 'Exemplos reais de ajuste operacional',
        ajuda:
          'Um por linha, com as palavras que a Gocase usa de verdade. É com eles que o agente reconhece o pedido repetido que deveria virar processo — sem exemplos do nosso contexto ele erra, e errar aqui é interromper quem não devia. Lista vazia desliga esta verificação, de propósito.',
        tipo: 'linhas',
        exemplo: 'trocar o CEP de um pedido já faturado',
        efeito: (c) =>
          c.regra2_exemplos_ajuste_operacional.length === 0
            ? 'Hoje a verificação de histórico não roda: sem exemplos, o agente não tem como reconhecer o pedido repetido.'
            : `Hoje o agente reconhece o padrão a partir de ${contar(c.regra2_exemplos_ajuste_operacional.length, 'exemplo', 'exemplos')}.`,
      },
    ],
  },
  {
    id: 'custo',
    rotulo: 'Custo da IA',
    titulo: 'Quanto a IA pode gastar',
    resumo: 'O teto existe para uma conversa longa não consumir o orçamento de todos.',
    grupo: 'configurar',
    campos: [
      {
        chave: 'teto_custo_conversa_usd',
        rotulo: 'Teto por conversa',
        ajuda:
          'Vale por conversa, não por dia nem por pessoa. Ao atingir o teto a conversa encerra e aponta o formulário — ninguém fica sem abrir chamado.',
        tipo: 'numero',
        unidade: 'US$',
        efeito: (c) =>
          `Hoje uma conversa encerra ao passar de US$ ${c.teto_custo_conversa_usd.toFixed(2)} em IA.`,
      },
    ],
  },
  {
    id: 'assentos',
    rotulo: 'Assentos',
    titulo: 'Assentos da Atlassian',
    resumo:
      'Quem consome licença, há quanto tempo não acessa e quanto isso custa. O inventário é coletado uma vez por dia — não dá para consultar ao vivo.',
    grupo: 'acompanhar',
    campos: [
      {
        chave: 'org_id',
        rotulo: 'Organização da Atlassian',
        ajuda:
          'O identificador da organização em admin.atlassian.com. Não é o mesmo que o identificador do site (o cloudId) — trocar um pelo outro faz a coleta devolver vazio sem erro.',
        tipo: 'texto',
        efeito: (c) =>
          c.org_id === null
            ? 'Hoje nenhum inventário é coletado.'
            : 'Hoje a coleta diária olha esta organização.',
      },
      {
        chave: 'assentos_ocioso_dias',
        rotulo: 'Dias sem acesso para considerar ocioso',
        ajuda:
          'O dado de último acesso pode atrasar até 24h e conta como acesso quem só abriu uma página. Um número curto demais acusa gente que estava de férias.',
        tipo: 'numero',
        unidade: 'dias',
        efeito: (c) =>
          `Hoje entra na lista quem não acessa há ${c.assentos_ocioso_dias} dias ou mais.`,
      },
    ],
  },
  {
    id: 'auditoria',
    rotulo: 'Auditoria',
    titulo: 'Tudo que o app fez',
    resumo:
      'Registro que só cresce, de toda ação que toca a Atlassian ou a IA — inclusive as que falharam e as que foram negadas.',
    grupo: 'acompanhar',
    campos: [],
  },
]

/* ---------- conversão valor ↔ rascunho ---------------------------------- */

export function paraRascunho(valor: unknown, tipo: TipoCampo): string {
  if (tipo === 'lista') return Array.isArray(valor) ? valor.join(', ') : ''
  if (tipo === 'linhas') return Array.isArray(valor) ? valor.join('\n') : ''
  if (tipo === 'porcentagem') {
    return typeof valor === 'number' ? String(Math.round(valor * 100)) : ''
  }
  return valor === null || valor === undefined ? '' : String(valor)
}

export function doRascunho(texto: string, tipo: TipoCampo): unknown {
  if (tipo === 'lista' || tipo === 'linhas') {
    return texto
      .split(tipo === 'lista' ? ',' : '\n')
      .map((v) => v.trim())
      .filter((v) => v.length > 0)
  }
  if (tipo === 'porcentagem') {
    const n = Number(texto)
    // `Math.round` antes de dividir: 70 vira 0.7 e não 0.7000000000000001, que
    // apareceria de volta na tela como um número que ninguém digitou.
    return Number.isFinite(n) ? Math.round(n) / 100 : 0
  }
  if (tipo === 'numero') {
    const n = Number(texto)
    return Number.isFinite(n) ? n : 0
  }
  const limpo = texto.trim()
  return limpo.length > 0 ? limpo : null
}

/* ---------- componentes ------------------------------------------------- */

/**
 * O estado de uma capacidade — **nunca só por cor** (regra 9 do CLAUDE.md): há
 * símbolo, palavra e texto para leitor de tela nos três casos.
 */
export function MarcaDeEstado({ estado }: { estado: EstadoCapacidade }) {
  const marca = estado === 'ligado' ? '✓' : estado === 'parcial' ? '~' : '!'
  const palavra = estado === 'ligado' ? 'Ligado' : estado === 'parcial' ? 'Parcial' : 'Desligado'
  return (
    <span className="estado" data-estado={estado}>
      <span className="estado-marca" aria-hidden="true">
        {marca}
      </span>
      {palavra}
    </span>
  )
}

export interface CampoProps {
  readonly descritor: DescritorCampo
  readonly config: ConfigValores
  readonly rascunho: string
  readonly aoMudar: (texto: string) => void
  readonly aoSalvar: () => void
  readonly aoDesfazer: () => void
  readonly salvando: boolean
}

/**
 * A moldura de todo campo: rótulo (a decisão) → controle → ajuda → **efeito**.
 *
 * O efeito fica **abaixo** do controle e depois da ajuda de propósito: ele é a
 * resposta a "e agora, como está?", que é a pergunta que se faz depois de ver o
 * campo, não antes.
 */
export function Campo({
  descritor,
  config,
  rascunho,
  aoMudar,
  aoSalvar,
  aoDesfazer,
  salvando,
}: CampoProps) {
  const id = `cfg-${descritor.chave}`
  const atual = paraRascunho(config[descritor.chave as keyof ConfigValores], descritor.tipo)
  const mudou = rascunho !== atual
  const itens =
    descritor.tipo === 'lista' || descritor.tipo === 'linhas'
      ? (doRascunho(rascunho, descritor.tipo) as string[])
      : []

  return (
    <div className="campo-console">
      <label htmlFor={id}>
        {descritor.rotulo}
        {descritor.opcional && <span className="campo-opcional"> · opcional</span>}
      </label>
      <p className="campo-ajuda" id={`${id}-ajuda`}>
        {descritor.ajuda}
      </p>

      <Controle id={id} descritor={descritor} rascunho={rascunho} aoMudar={aoMudar} />

      {itens.length > 0 && (
        <ul className="campo-pilulas" aria-label="O que será salvo">
          {itens.map((v, i) => (
            <li key={`${v}-${i}`}>
              <Selo variante="contorno">{v}</Selo>
            </li>
          ))}
        </ul>
      )}

      <p className="campo-efeito" aria-live="polite">
        {descritor.efeito(config)}
      </p>

      {mudou && (
        <div className="acoes">
          <button
            type="button"
            className="botao botao-primario"
            onClick={aoSalvar}
            disabled={salvando}
          >
            {salvando ? 'Salvando…' : 'Salvar'}
          </button>
          <button type="button" className="botao botao-discreto" onClick={aoDesfazer}>
            Desfazer
          </button>
        </div>
      )}
    </div>
  )
}

function Controle({
  id,
  descritor,
  rascunho,
  aoMudar,
}: {
  id: string
  descritor: DescritorCampo
  rascunho: string
  aoMudar: (texto: string) => void
}) {
  const descrito = `${id}-ajuda`

  if (descritor.tipo === 'escolha') {
    return (
      <select
        id={id}
        aria-describedby={descrito}
        value={rascunho}
        onChange={(e) => aoMudar(e.target.value)}
      >
        {(descritor.opcoes ?? []).map((o) => (
          <option key={o.valor} value={o.valor}>
            {o.rotulo}
          </option>
        ))}
        {/* Valor vindo do banco que a tela não conhece continua selecionável —
            some-lo faria a tela propor uma mudança que ninguém pediu. */}
        {!(descritor.opcoes ?? []).some((o) => o.valor === rascunho) && (
          <option value={rascunho}>{rascunho}</option>
        )}
      </select>
    )
  }

  if (descritor.tipo === 'linhas') {
    return (
      <textarea
        id={id}
        aria-describedby={descrito}
        value={rascunho}
        rows={4}
        placeholder={descritor.exemplo}
        onChange={(e) => aoMudar(e.target.value)}
      />
    )
  }

  const numerico = descritor.tipo === 'numero' || descritor.tipo === 'porcentagem'
  const entrada = (
    <input
      id={id}
      aria-describedby={descrito}
      type={numerico ? 'number' : 'text'}
      inputMode={numerico ? 'decimal' : undefined}
      step={descritor.tipo === 'porcentagem' ? 1 : 'any'}
      min={numerico ? 0 : undefined}
      max={descritor.tipo === 'porcentagem' ? 100 : undefined}
      value={rascunho}
      placeholder={descritor.exemplo}
      onChange={(e) => aoMudar(e.target.value)}
    />
  )

  if (!descritor.unidade) return entrada
  return (
    <span className="campo-com-unidade">
      {entrada}
      <span className="campo-unidade" aria-hidden="true">
        {descritor.unidade}
      </span>
    </span>
  )
}

/**
 * Preço mensal por produto — `RF-53`, `Q8`.
 *
 * As linhas vêm do **inventário coletado**, não de uma lista fixa: o console não
 * sabe quais produtos a organização assina, e inventar "Jira, Confluence, Jira
 * Service Management" produziria três campos que talvez não existam e esconderia o
 * quarto que existe. Sem coleta ainda, a seção diz isso em vez de mostrar formulário
 * vazio.
 */
export function PrecoPorProduto({
  produtos,
  precos,
  rascunhos,
  aoMudar,
  aoSalvar,
  salvando,
}: {
  produtos: readonly string[]
  precos: Readonly<Record<string, number>>
  rascunhos: Readonly<Record<string, string>>
  aoMudar: (produto: string, texto: string) => void
  aoSalvar: () => void
  salvando: boolean
}) {
  if (produtos.length === 0) {
    return (
      <p className="dica">
        Os produtos aparecem aqui depois da primeira coleta — o console não inventa a
        lista de produtos que a organização assina.
      </p>
    )
  }

  const mudou = produtos.some(
    (p) => (rascunhos[p] ?? '') !== (precos[p] === undefined ? '' : String(precos[p])),
  )

  return (
    <div className="pilha">
      <ul className="precos">
        {produtos.map((produto) => (
          <li key={produto} className="preco-linha">
            <label htmlFor={`preco-${produto}`}>{produto}</label>
            <span className="campo-com-unidade">
              <input
                id={`preco-${produto}`}
                type="number"
                inputMode="decimal"
                min={0}
                step="any"
                value={rascunhos[produto] ?? ''}
                placeholder="sem preço"
                onChange={(e) => aoMudar(produto, e.target.value)}
              />
              <span className="campo-unidade" aria-hidden="true">
                US$/mês
              </span>
            </span>
          </li>
        ))}
      </ul>
      <p className="campo-efeito">
        O custo só aparece em dinheiro quando <strong>todos</strong> os produtos do
        inventário têm preço. Faltando um, o console mostra contagem — é melhor que um
        total que parece completo e não é.
      </p>
      {mudou && (
        <div className="acoes">
          <button
            type="button"
            className="botao botao-primario"
            onClick={aoSalvar}
            disabled={salvando}
          >
            {salvando ? 'Salvando…' : 'Salvar preços'}
          </button>
        </div>
      )}
    </div>
  )
}

/**
 * Bloco de acompanhamento dentro de uma seção de configuração — é o que põe a taxa
 * de override ao lado do controle que se calibra com ela (`R-04`).
 */
export function BlocoDeDado({
  titulo,
  explicacao,
  children,
}: {
  titulo: string
  explicacao: string
  children: ReactNode
}) {
  return (
    <section className="bloco-dado">
      <h3 className="titulo-filhos">{titulo}</h3>
      <p className="dica">{explicacao}</p>
      {children}
    </section>
  )
}

/** Detalhe recolhido — para o que é verdade mas não é o assunto principal. */
export function Detalhe({ resumo, children }: { resumo: string; children: ReactNode }) {
  const [aberto, setAberto] = useState(false)
  return (
    <div className="detalhe">
      <button
        type="button"
        className="detalhe-botao"
        aria-expanded={aberto}
        onClick={() => setAberto((a) => !a)}
      >
        <span aria-hidden="true">{aberto ? '−' : '+'}</span> {resumo}
      </button>
      {aberto && <div className="detalhe-corpo">{children}</div>}
    </div>
  )
}
