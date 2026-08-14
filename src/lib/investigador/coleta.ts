/**
 * A coleta de **uma** requisição — spec 009, `FR-1`, `FR-3`, `FR-4`, `FR-10c`.
 *
 * ## Por que acumular em memória
 *
 * Cada `db.exec` do GoDeploy é uma ida de rede (`RNF-36`, `D-35`). Um `INSERT` por evento
 * faria uma rodada de polling com 100 chamados custar **centenas** de idas — o mesmo tipo de
 * custo invisível que a migração por requisição cobrava, e que nenhum teste de comportamento
 * pega, porque o app responde certo enquanto paga. Aqui a requisição inteira vira **uma**
 * linha de requisição mais **um lote** de eventos: duas idas, independentemente de o turno
 * ter gerado 3 eventos ou 60.
 *
 * ⚠️ O custo aceito está declarado no `plan.md` §11: uma requisição que morra **antes** do
 * `finally` perde o próprio rastro. Crash duro continua aparecendo em `getAppLogs`; o que se
 * ganha é não transformar o instrumento de investigação na próxima causa de lentidão.
 *
 * ## Por que truncar com marca, e não `.slice()`
 *
 * Corte silencioso é o defeito que o projeto já pagou com o quarto anexo desaparecendo sem
 * nada na tela (`SC-08` da spec 005). Aqui o prejuízo é o mesmo com outra roupa: quem lê um
 * JSON cortado no meio conclui que o app mandou aquilo. A marca `…[truncado, N caracteres]`
 * é o que faz a diferença entre "o corpo era esse" e "o corpo era maior que o teto".
 */

import { redigirSensiveis } from '../audit'
import type { Banco } from '../db/tipos'
import type { Investigador } from './registro'
import type {
  ChamadaExterna,
  EventoInvestigador,
  ObservadorDeChamadas,
  OrigemDeEvento,
  TipoDeEvento,
} from './tipos'

/**
 * Teto de cada corpo guardado, em caracteres.
 *
 * Generoso o bastante para caber o payload de criação inteiro (o dado mais caro de perder) e
 * pequeno o bastante para não transformar a tabela num espelho do tráfego.
 */
export const MAX_CORPO = 16_000

/** Teto do JSON de um evento. Menor: são muitos por requisição. */
export const MAX_DADOS_EVENTO = 8_000

/**
 * Quantos eventos por `INSERT`.
 *
 * O limite de parâmetros do SQLite é o teto real; 40 linhas × 12 colunas = 480 parâmetros,
 * com folga confortável mesmo no limite antigo de 999.
 */
export const EVENTOS_POR_LOTE = 40

/** Quantos eventos uma requisição pode registrar antes de o registro parar de crescer. */
export const MAX_EVENTOS_POR_REQUISICAO = 400

/**
 * Padrões de credencial em texto que **não** é JSON — `RNF-01`.
 *
 * O caminho normal é `redigirSensiveis`, que age por **chave** de objeto. Corpo que não
 * parseia (formulário urlencoded, texto solto, JSON malformado) não tem chave nenhuma, e
 * deixá-lo passar cru seria o furo exato que `RNF-01` fecha em todo o resto do app.
 */
const CREDENCIAL_EM_TEXTO =
  /((?:token|senha|password|secret|api[_-]?key|authorization|bearer)\s*[":=]+\s*)("?)([^\s",}]+)/gi

/** Trunca **com marca**. Nunca corta em silêncio. */
export function truncar(texto: string, teto: number): string {
  if (texto.length <= teto) return texto
  return `${texto.slice(0, teto)}…[truncado, ${texto.length} caracteres]`
}

/**
 * Redige e trunca um corpo, na ordem que importa: **redigir primeiro**.
 *
 * ⚠️ Truncar antes deixaria um segredo intacto sempre que ele estivesse nos primeiros 16 mil
 * caracteres — que é onde os cabeçalhos e o começo do corpo costumam estar. A ordem inversa
 * "funciona" em todo teste de caminho feliz.
 */
export function corpoSeguro(bruto: string | null | undefined, teto = MAX_CORPO): string | null {
  if (bruto === null || bruto === undefined || bruto.length === 0) return null
  let texto = bruto
  try {
    const v: unknown = JSON.parse(bruto)
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      texto = JSON.stringify(redigirSensiveis(v as Record<string, unknown>))
    }
  } catch {
    // Não era JSON de objeto: cai na redação por padrão de texto, logo abaixo.
  }
  return truncar(texto.replace(CREDENCIAL_EM_TEXTO, '$1$2[REDIGIDO]'), teto)
}

/** Uma linha pronta para o `INSERT` em lote. */
interface LinhaEvento {
  readonly id: string
  readonly conversaId: string | null
  readonly tipo: TipoDeEvento
  readonly origem: OrigemDeEvento
  readonly resumo: string
  readonly dadosJson: string | null
  readonly custoUsd: number | null
  readonly duracaoMs: number | null
  readonly ordem: number
}

/**
 * O que o envelope da rota sabe só no fim.
 *
 * ⚠️ **Método, caminho e e-mail entram aqui, não no construtor.** A coleta nasce dentro de
 * `montarContexto` — que precisa dela **antes** de construir os transportes, para poder
 * injetar o observador — e naquele ponto o roteador ainda não decidiu nada. Exigi-los na
 * construção obrigaria `montarContexto` a receber a `Request`, e o único lugar que lê a
 * requisição continuaria sendo o roteador só por convenção.
 */
export interface DesfechoDaRequisicao {
  readonly atorEmail: string
  readonly metodo: string
  readonly caminho: string
  readonly status: number
  readonly duracaoMs: number
  readonly reqBytes?: number | null
  readonly respBytes?: number | null
  readonly reqBruto?: string | null
  readonly respBruto?: string | null
  readonly erro?: string | null
}

export class ColetaDeRequisicao implements Investigador {
  private linhas: LinhaEvento[] = []
  private conversaId: string | null = null
  private descartados = 0
  /**
   * O id da requisição **corrente**. Muda a cada `gravar`.
   *
   * 🚨 **Isto não é zelo — foi um defeito medido.** Em produção `montarContexto` roda por
   * requisição, mas o shim de desenvolvimento e a suíte reaproveitam o mesmo `Contexto` em
   * várias chamadas (é como todo teste de rota deste projeto é escrito). Com um id fixo, a
   * **segunda** gravação colidia com a `PRIMARY KEY`, o `catch` de `FR-20` engolia o erro e
   * o registro parava para sempre — sem exceção, sem log, e com a primeira linha lá para
   * fazer parecer que funcionava. A mesma família de `{}` silencioso de `linhasComoObjetos`.
   */
  private idAtual: string

  constructor(
    id: string,
    private readonly agora: () => string,
    private readonly novoId: () => string,
  ) {
    this.idAtual = id
  }

  /** O id da requisição corrente — é ele que os eventos carregam em `requisicao_id`. */
  get id(): string {
    return this.idAtual
  }

  /** A conversa só é conhecida depois do roteamento; o detalhe do painel agrupa por ela. */
  emConversa(id: string | null | undefined): void {
    if (id) this.conversaId = id
  }

  registrar(evento: EventoInvestigador): void {
    if (this.linhas.length >= MAX_EVENTOS_POR_REQUISICAO) {
      this.descartados += 1
      return
    }
    if (evento.conversaId) this.conversaId = evento.conversaId
    this.linhas.push({
      id: this.novoId(),
      conversaId: evento.conversaId ?? this.conversaId,
      tipo: evento.tipo,
      origem: evento.origem,
      resumo: evento.resumo,
      dadosJson: evento.dados ? corpoSeguro(seguroStringify(evento.dados), MAX_DADOS_EVENTO) : null,
      custoUsd: evento.custoUsd ?? null,
      duracaoMs: evento.duracaoMs ?? null,
      ordem: this.linhas.length,
    })
  }

  /** O observador que os cinco transportes externos recebem — `FR-10b`. */
  observador(): ObservadorDeChamadas {
    return (c: ChamadaExterna) => {
      this.registrar({
        tipo: 'chamada_externa',
        origem: c.alvo === 'organizacao' ? 'atlassian' : c.alvo,
        resumo: `${c.alvo} ${c.metodo} ${c.caminho} → ${c.falha ?? c.status ?? 'sem resposta'}`,
        dados: {
          alvo: c.alvo,
          metodo: c.metodo,
          caminho: c.caminho,
          status: c.status,
          falha: c.falha ?? null,
        },
        duracaoMs: c.duracaoMs,
      })
    }
  }

  get totalEventos(): number {
    return this.linhas.length
  }

  /**
   * Grava tudo. **Nunca lança** (`FR-20`): o registro é acessório, e derrubar a rota que se
   * queria investigar seria trocar o problema por um pior.
   */
  async gravar(db: Banco, desfecho: DesfechoDaRequisicao): Promise<void> {
    const criadoEm = this.agora()
    // A fila é esvaziada ANTES de qualquer `await`: a próxima requisição que compartilhe
    // esta coleta começa limpa mesmo se a gravação abaixo falhar. Sem isto, uma falha do
    // banco faria os eventos de hoje reaparecerem no registro de amanhã.
    const linhas = this.linhas
    const descartados = this.descartados
    const conversaId = this.conversaId
    const id = this.idAtual
    this.linhas = []
    this.descartados = 0
    this.conversaId = null
    this.idAtual = this.novoId()

    try {
      await db.exec(
        `INSERT INTO investigador_requisicoes
           (id, ator_email, conversa_id, metodo, caminho, status, duracao_ms,
            req_bytes, resp_bytes, req_json, resp_json, erro, criado_em)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          desfecho.atorEmail,
          conversaId,
          desfecho.metodo,
          desfecho.caminho,
          desfecho.status,
          desfecho.duracaoMs,
          desfecho.reqBytes ?? null,
          desfecho.respBytes ?? null,
          corpoSeguro(desfecho.reqBruto),
          corpoSeguro(desfecho.respBruto),
          desfecho.erro ? truncar(desfecho.erro, 500) : null,
          criadoEm,
        ],
      )
    } catch (e) {
      aviso('requisicao', e)
      return
    }

    if (descartados > 0) {
      linhas.push({
        id: this.novoId(),
        conversaId,
        tipo: 'erro_de_rota',
        origem: 'servidor',
        // ⚠️ Teto atingido é DITO, nunca silencioso: registro que some sem avisar faz quem
        // investiga concluir que o app parou onde na verdade o registro parou.
        resumo: `Teto de eventos atingido — ${descartados} evento(s) não registrado(s).`,
        dadosJson: null,
        custoUsd: null,
        duracaoMs: null,
        ordem: linhas.length,
      })
    }

    for (let i = 0; i < linhas.length; i += EVENTOS_POR_LOTE) {
      const lote = linhas.slice(i, i + EVENTOS_POR_LOTE)
      const params: unknown[] = []
      for (const l of lote) {
        params.push(
          l.id,
          id,
          l.conversaId,
          desfecho.atorEmail,
          l.tipo,
          l.origem,
          truncar(l.resumo, 400),
          l.dadosJson,
          l.custoUsd,
          l.duracaoMs,
          l.ordem,
          criadoEm,
        )
      }
      try {
        await db.exec(
          `INSERT INTO investigador_eventos
             (id, requisicao_id, conversa_id, ator_email, tipo, origem, resumo,
              dados_json, custo_usd, duracao_ms, ordem, criado_em)
           VALUES ${lote.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ')}`,
          params,
        )
      } catch (e) {
        aviso('eventos', e)
        return
      }
    }
  }
}

/**
 * `JSON.stringify` que não derruba a requisição.
 *
 * Estrutura cíclica e `BigInt` lançam, e um evento malformado não pode custar a resposta de
 * quem está esperando (`RNF-18`).
 */
function seguroStringify(v: unknown): string {
  try {
    return JSON.stringify(v) ?? ''
  } catch {
    return '"[não foi possível serializar este evento]"'
  }
}

/**
 * A falha do registro vai para o `console`, que é o que aparece em `getAppLogs`.
 *
 * ⚠️ Sem mensagem de erro do banco: ela pode carregar trecho do parâmetro, e o parâmetro
 * aqui é conteúdo de requisição (`RNF-01`, `RNF-30`).
 */
function aviso(etapa: string, e: unknown): void {
  const classe = e instanceof Error ? e.name : typeof e
  console.warn(`[investigador] falha ao gravar ${etapa} (${classe})`)
}
