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
  /**
   * T-401 — campo adicional do formulário recusado por não estar no schema do
   * request type, ou por não ter sido possível ler o schema. Registrado porque as
   * duas causas somem com a mesma cara na tela ("o campo não foi"), e só a auditoria
   * distingue "esse tipo não tem esse campo" de "não deu para saber quais tem".
   */
  | 'campos_dinamicos_descartados'
  /**
   * T-402 / RF-62 — criação recusada por falta da declaração de anexo.
   *
   * Auditada porque o **volume** dela é o sinal que importa, e não é sobre segurança:
   * muita recusa significa tela confusa (a pergunta não está onde a pessoa olha, ou a
   * opção negativa parece uma punição), não gente teimosa. Sem o registro, a única
   * evidência de uma pergunta mal desenhada seria alguém reclamando.
   */
  | 'declaracao_anexo_ausente'
  /**
   * Spec 007 — o que aconteceu com a leitura de um anexo da conversa (`FR-10`).
   *
   * São **três**, derivadas dos seis estados por `acaoDeAuditoriaDaAnalise` (achado `F3` do
   * `/analyze`), e as três são perguntas diferentes para quem investiga: *leu* ·
   * *não sei ler este formato / o serviço caiu* · *não deu para saber*. Uma ação só com
   * `motivo` no detalhe faria a contagem que importa — "quantos anexos o app conseguiu
   * ler?" — exigir ler o detalhe linha por linha.
   *
   * ⚠️ **Nenhuma delas carrega a descrição nem o nome do arquivo:** o admin lê esta tabela, e
   * o arquivo é conteúdo pessoal de quem o enviou (`RNF-01`, `RNF-30`) — o mesmo raciocínio
   * que mantém o nome fora de `anexo_servido`.
   */
  | 'anexo_analisado'
  | 'anexo_nao_lido'
  | 'anexo_leitura_indefinida'
  /**
   * T-404 / SC-05b — o schema do request type não pôde ser lido, então a pergunta de
   * `RF-62` não foi feita e o chamado abriu (fail-open declarado em `plan.md` §9).
   *
   * ⚠️ Existe **exatamente** para separar duas coisas que na tela são idênticas: "este
   * tipo de chamado não aceita anexo" e "não deu para saber se aceita". Sem esta linha,
   * uma indisponibilidade prolongada de leitura de schema apareceria como uma feature
   * que ninguém usa.
   */
  | 'schema_tipo_indisponivel'
  /**
   * `RF-79` (spec 010) — a criação foi recusada porque o assunto exige arquivo e não havia
   * nenhum. **Antes** de qualquer efeito: nada foi para a Atlassian.
   *
   * ⚠️ Vale medir: se aparecer muito, o problema não é a trava — é o agente escolhendo um
   * assunto que exige evidência para quem não tem nenhuma, e aí o conserto é de roteamento.
   */
  | 'anexo_obrigatorio_ausente'
  /**
   * `RF-81` (spec 011) — a pessoa clicou em "montar o chamado agora".
   *
   * ⚠️ O `resultado` distingue o que importa: `falha` significa que nem forçando saiu
   * proposta, e é esse número que diz se o botão resolve ou só adia o silêncio.
   */
  | 'proposta_forcada'
  /**
   * `T-1000` (spec 010) — alguém rodou o diagnóstico de criação, que **pode criar chamado
   * real**. Fica auditado justamente por isso: é a única rota do app cujo efeito colateral
   * bem-sucedido dá trabalho a outra pessoa.
   */
  | 'diagnostico_criacao'
  /**
   * `RF-19` — a área do solicitante não veio da fonte organizacional.
   *
   * ⚠️ **São duas ações, não uma com um campo `motivo`.** As duas produzem o mesmo
   * resultado para quem abre o chamado (área ausente, chamado aberto — `RNF-18`) e pedem
   * trabalho oposto de quem administra: `area_nao_encontrada` é cadastro faltando na
   * TeamGuide; `area_indisponivel` é a fonte fora do ar. Colapsá-las apagaria a distinção
   * no único lugar onde ela ainda é recuperável — mesmo raciocínio de
   * `buscaConfigurada` e de `schema_tipo_indisponivel`.
   */
  | 'area_nao_encontrada'
  | 'area_indisponivel'
  /**
   * Spec 008 — a IA **mudou** a proposta depois de a pessoa argumentar (`FR-23`, `ScC-9`).
   *
   * ⚠️ **O detalhe carrega QUAIS campos mudaram, nunca os valores** (`RN-10`, `RNF-30`): o
   * admin lê esta tabela, e título e descrição são o relato da pessoa. `{campos: ['prioridade']}`
   * responde "em quais campos a argumentação pega?" sem expor uma linha do que ela escreveu.
   *
   * ⚠️ **Motivo reescrito sozinho NÃO entra aqui.** O motivo muda de redação a cada
   * rederivação; contá-lo faria toda mensagem virar "proposta ajustada" e a resposta de
   * `ScC-9` perderia sentido — mede-se argumentação que mudou o chamado, não variação de
   * texto.
   */
  | 'proposta_ajustada'
  /**
   * Spec 008 — um ajuste pedido em texto **não foi aplicado** (`FR-13`, `FR-14`).
   *
   * ⚠️ Registrado porque as duas causas são invisíveis na tela depois do fato e pedem
   * trabalho oposto: `campo_inexistente` em volume significa que as pessoas esperam um campo
   * que aquele request type não tem (é assunto de formulário no Jira); `opcao_inexistente`
   * significa que o vocabulário da opção não é o que a pessoa usa. Mesma família de
   * `area_nao_encontrada` × `area_indisponivel`.
   *
   * O detalhe leva o **rótulo** — texto que já está na tela dela —, nunca `fieldId`.
   */
  | 'ajuste_recusado'
  /**
   * Spec 008 — o aviso de que conversar pode reescrever o formulário (`FR-18`, `FR-23`).
   *
   * ⚠️ O desfecho é o dado que importa: muita gente **voltando ao formulário** significa que
   * o aviso está assustando quem só queria conversar, e aí o texto dele é que está errado —
   * não as pessoas. Sem o registro, a única evidência de um aviso mal escrito seria alguém
   * reclamando (mesmo raciocínio de `declaracao_anexo_ausente`).
   */
  | 'aviso_negociacao'
  /**
   * Spec 008 / `FR-6` — a prosa do agente afirmou nível de prioridade ou prazo em horas.
   *
   * 🚨 **Isto MEDE, não impede** — e a escolha é deliberada (`plan.md` §3.6). Quem previne é o
   * prompt; recortar a frase de um texto gerado estraga o parágrafo e o defeito volta com
   * outra redação. `FR-6` é qualidade de produto, não gate de segurança: quem "burla" produz
   * uma frase feia no próprio chamado — nenhuma exposição, nenhum chamado perdido (a mesma
   * distinção de `D-27`). Se a medição mostrar vazamento recorrente, a escalada é recortar, e
   * aí com dado.
   *
   * ⚠️ O detalhe diz **o que** foi achado (`nivel` · `horas`), nunca a frase: ela contém o
   * relato da pessoa.
   */
  | 'prosa_afirmou_prazo'
  /** Coleta diária da Organizations API (RF-51, RF-52, T-124) — toca a Atlassian,
   * então é auditada mesmo quando falha. */
  | 'inventario_coletado'
  /**
   * RF-57 (T-131) — a ÚNICA escrita da credencial de Org Admin. Auditada sempre, e
   * também quando falha: revogação de assento é ação sobre a conta de outra pessoa, e
   * "quem revogou o quê" precisa ter resposta seis meses depois.
   */
  | 'assento_revogado'
  /**
   * RF-44/RF-45 (T-225) — envio de notificação. Registrado sem o CORPO da mensagem: ele
   * carrega trecho de comentário de chamado, e a auditoria é lida por admin (`RF-30`).
   */
  | 'notificacao_enviada'
  /** RF-47 (T-212) — rodada de polling: quantos chamados olhou, quantos eventos gerou. */
  | 'polling_executado'
  /** RF-48 (T-206) — evento de webhook, inclusive o recusado por segredo inválido. */
  | 'webhook_recebido'
  /** RF-46 (T-231) — rodada do alerta de SLA de primeira resposta. */
  | 'alerta_sla'
  /** RF-25/RF-34 (T-240) — anexo enviado pelo solicitante ao próprio chamado. */
  | 'anexo_enviado'
  /**
   * `RF-23` (T-098) — a transcrição da conversa anexada ao chamado que ela originou.
   *
   * ⚠️ É a **única** evidência de que ela chegou ou não. A anexação é silenciosa na tela
   * de propósito (`transcricao.ts`): dizer "não consegui anexar a transcrição" num recibo
   * de chamado recém-aberto ensina a pessoa a duvidar de um chamado que está de pé, e
   * quem duvida abre o segundo. Sem esta linha, "a transcrição nunca chega" e "a
   * transcrição não existe" ficariam indistinguíveis — a mesma família de
   * `schema_tipo_indisponivel` e `area_indisponivel`.
   */
  | 'transcricao_anexada'
  /** RF-36 (T-242) — transição pedida pelo solicitante (resolver/reabrir). */
  | 'chamado_transicionado'
  /** RF-45 (T-224) — a pessoa mudou o próprio canal de notificação. */
  | 'preferencia_alterada'
  /** RNF-33 (T-243) — expurgo por retenção. Conta o que apagou, nunca o conteúdo. */
  | 'retencao_executada'
  /** R-06 (T-302) — pedido de quem está fora do escopo do piloto. */
  | 'fora_do_piloto'

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
