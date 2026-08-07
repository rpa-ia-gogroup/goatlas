/**
 * O tipo de cada chave de configuração, validado no SERVIDOR — `RF-49`.
 *
 * `PUT /api/admin/config` checava só se a chave existe e gravava o valor como
 * viesse. `Config.carregar` faz `JSON.parse` e confia no que voltou, porque quem
 * grava é `definir()` — mas a rota é HTTP comum: qualquer admin com sessão pode
 * chamá-la sem passar pela tela, e a tela era a única coisa garantindo o tipo.
 *
 * ⚠️ **O default fail-closed não cobre isto.** Ele protege contra ausência
 * (`CONFIG_PADRAO` nega) e contra JSON corrompido (`carregar` cai no default). Um
 * `"alto"` gravado em `regra1_threshold_score` não é nenhum dos dois: é JSON válido,
 * sobrevive ao boot e chega à comparação da Regra 1 como string.
 *
 * ⚠️ **Recusa, nunca conserta.** `"0.9"` não vira `0.9`. Coerção esconde de quem
 * chamou que mandou a coisa errada — e o dia em que a string for `"alto"`, a mesma
 * coerção produz `NaN` e ninguém é avisado.
 *
 * A mensagem diz o que era esperado e **não repete o valor recusado**: ele vem de
 * fora e sobe para o log junto com a resposta (`RNF-01`, `RNF-30`).
 */

import { CONFIG_PADRAO, type ChaveConfig } from './index'

export type ResultadoValidacao =
  | { readonly ok: true; readonly valor: unknown }
  | { readonly ok: false; readonly motivo: string }

/**
 * As famílias de valor. São poucas de propósito: chave que não caiba em nenhuma
 * delas é sinal de que o formato ficou complicado demais para um console.
 */
type Familia =
  | 'lista_de_texto'
  | 'texto'
  | 'texto_ou_vazio'
  | 'fracao'
  | 'inteiro_positivo'
  | 'inteiro_ou_zero'
  | 'dinheiro'
  | 'preco_por_produto'

/**
 * ⚠️ `Record<ChaveConfig, …>` de propósito: chave nova em `ConfigValores` sem
 * família aqui **não compila**. Sem isso, a chave nova nasceria sem validação e o
 * furo voltaria em silêncio.
 */
const FAMILIA: Record<ChaveConfig, Familia> = {
  dominios_permitidos: 'lista_de_texto',
  admins: 'lista_de_texto',
  espacos_confluence: 'lista_de_texto',
  labels_bloqueadas: 'lista_de_texto',
  tipos_chamado_permitidos: 'lista_de_texto',
  regra2_exemplos_ajuste_operacional: 'lista_de_texto',

  // `null` é uma resposta legítima: "ainda não sabemos" (Q1, Q4). Diferente de
  // string vazia, que seria um id inventado.
  service_desk_id: 'texto_ou_vazio',
  campo_solicitante_id: 'texto_ou_vazio',
  org_id: 'texto_ou_vazio',

  regra2_campo_agrupamento: 'texto',

  regra1_threshold_score: 'fracao',
  regra2_threshold_recorrencia: 'inteiro_positivo',
  regra2_janela_dias: 'inteiro_positivo',
  regra2_limite_tickets: 'inteiro_positivo',
  assentos_ocioso_dias: 'inteiro_positivo',
  limite_requisicoes_por_minuto: 'inteiro_positivo',

  // TTL zero é uma escolha válida: significa não cachear.
  ttl_metadados_seg: 'inteiro_ou_zero',
  ttl_conteudo_seg: 'inteiro_ou_zero',

  teto_custo_conversa_usd: 'dinheiro',
  custo_mensal_por_produto: 'preco_por_produto',
}

function numeroReal(valor: unknown): valor is number {
  // `Number.isFinite` recusa NaN e Infinity — os dois passariam por `typeof`.
  return typeof valor === 'number' && Number.isFinite(valor)
}

function validarFamilia(familia: Familia, valor: unknown): ResultadoValidacao {
  switch (familia) {
    case 'lista_de_texto':
      if (!Array.isArray(valor) || valor.some((v) => typeof v !== 'string')) {
        return { ok: false, motivo: 'Esperado uma lista de textos.' }
      }
      // Normaliza o que a tela poderia ter deixado passar: espaço nas pontas e
      // item vazio. Não é coerção de tipo — é a mesma limpeza de `valoresDoBootstrap`.
      return { ok: true, valor: valor.map((v) => v.trim()).filter((v) => v.length > 0) }

    case 'texto':
      if (typeof valor !== 'string' || valor.trim().length === 0) {
        return { ok: false, motivo: 'Esperado um texto não vazio.' }
      }
      return { ok: true, valor: valor.trim() }

    case 'texto_ou_vazio': {
      if (valor === null) return { ok: true, valor: null }
      if (typeof valor !== 'string') {
        return { ok: false, motivo: 'Esperado um texto, ou nada.' }
      }
      const limpo = valor.trim()
      // Vazio vira `null`: é o mesmo estado ("não configurado"), e deixar `''` no
      // banco criaria dois jeitos de dizer a mesma coisa — um deles passando por
      // checagens de `!== null`.
      return { ok: true, valor: limpo.length > 0 ? limpo : null }
    }

    case 'fracao':
      if (!numeroReal(valor) || valor < 0 || valor > 1) {
        return { ok: false, motivo: 'Esperado um número entre 0 e 1.' }
      }
      return { ok: true, valor }

    case 'inteiro_positivo':
      if (!numeroReal(valor) || !Number.isInteger(valor) || valor < 1) {
        return { ok: false, motivo: 'Esperado um número inteiro de 1 para cima.' }
      }
      return { ok: true, valor }

    case 'inteiro_ou_zero':
      if (!numeroReal(valor) || !Number.isInteger(valor) || valor < 0) {
        return { ok: false, motivo: 'Esperado um número inteiro de 0 para cima.' }
      }
      return { ok: true, valor }

    case 'dinheiro':
      if (!numeroReal(valor) || valor < 0) {
        return { ok: false, motivo: 'Esperado um número de 0 para cima.' }
      }
      return { ok: true, valor }

    case 'preco_por_produto': {
      if (typeof valor !== 'object' || valor === null || Array.isArray(valor)) {
        return { ok: false, motivo: 'Esperado um preço para cada produto.' }
      }
      for (const preco of Object.values(valor as Record<string, unknown>)) {
        if (!numeroReal(preco) || preco < 0) {
          // Zero é aceito: produto incluído no plano custa zero, e isso é
          // diferente de produto **sem preço** — `custo.ts` só mostra dinheiro
          // quando TODOS os produtos do inventário têm preço.
          return { ok: false, motivo: 'Esperado um preço de 0 para cima em cada produto.' }
        }
      }
      return { ok: true, valor }
    }
  }
}

/**
 * `{ ok: false }` quando o valor não serve. Quem chama devolve 400 e **não** grava —
 * o parcialmente salvo seria pior que o recusado.
 */
export function validarValorDeConfig(chave: ChaveConfig, valor: unknown): ResultadoValidacao {
  const familia = FAMILIA[chave]
  if (!familia) return { ok: false, motivo: 'Configuração desconhecida.' }
  return validarFamilia(familia, valor)
}

/** Guarda de tipo para a rota, que recebe a chave como string crua. */
export function chaveDeConfigConhecida(chave: string): chave is ChaveConfig {
  return chave in CONFIG_PADRAO
}
