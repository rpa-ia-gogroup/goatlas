/**
 * O inventário de assentos visto por PESSOA — `RF-51`, `RF-52`.
 *
 * ## O que faltava
 *
 * `GET /api/admin/assentos` devolve `itens` desde a T-124, e **nada em `src/app/` os
 * consumia**: o console mostrava "N assentos parados" e nunca **quem**. Foi o achado da
 * auditoria de `D-47` (T-128 rebaixada de `[x]`), e é o formato dominante daquela
 * varredura — servidor pronto, tela ausente, suíte verde, porque comportamento **ausente**
 * não quebra teste.
 *
 * Sem esta lista a recomendação de `RF-54` não é conferível: ela nomeia uma pessoa, e quem
 * lê o console não tem como olhar os assentos dessa pessoa antes de agir.
 *
 * ## Por que agrupar, e por que aqui
 *
 * O payload é **uma linha por (pessoa, produto)** — é a forma que `registrarColeta` grava,
 * iterando a união das duas fontes (`D-23`). Renderizado cru, o mesmo colega aparece três
 * vezes e a tela vira uma tabela de linhas, não de gente; e a decisão que se toma ali é
 * sobre **uma pessoa** ("esta ainda precisa de acesso?"), nunca sobre uma célula.
 *
 * O agrupamento é função pura e mora no `lib` pelo motivo de sempre: dá para testá-lo sem
 * React, e a tela fica sendo só desenho.
 *
 * ⚠️ **Quem decide "está parado" é `assentoOcioso`, o MESMO predicado de `custo.ts`.**
 * Escrever a condição de novo aqui criaria duas regras para o mesmo fato, e elas
 * divergiriam em silêncio — o console diria "3 parados" no resumo e destacaria 4 na lista.
 * É o raciocínio de `config/diagnostico.ts`: o console **relata** o estado, não o recalcula.
 *
 * _Requirements: RF-51, RF-52, RF-53, RF-54_
 */

import { assentoOcioso } from './custo'

/** Uma linha do inventário como a rota a devolve. */
export interface ItemInventario {
  readonly accountId: string
  readonly email: string
  readonly nome: string
  readonly produto: string
  readonly ultimoAcessoEm: string | null
}

export interface ProdutoDaPessoa {
  readonly produto: string
  readonly ultimoAcessoEm: string | null
  readonly ocioso: boolean
  /**
   * Dias inteiros desde o último acesso.
   *
   * ⚠️ **`null` significa "sem registro de acesso", nunca zero e nunca um número grande
   * inventado.** `assentoOcioso` trata ausência como ocioso — decisão certa e já tomada em
   * `custo.ts` —, mas o **texto** da tela não pode transformar isso em "parado há N dias":
   * seria afirmar uma medição que ninguém fez. Mesma família de `area_indisponivel` ×
   * `area_nao_encontrada` e de `tiposNaoLidos` (`D-44`).
   */
  readonly diasParado: number | null
}

export interface PessoaComAssentos {
  readonly accountId: string
  readonly email: string
  readonly nome: string
  readonly produtos: readonly ProdutoDaPessoa[]
  /** Nenhum produto usado dentro da janela — é o caso que `RF-54` recomenda remover. */
  readonly todosParados: boolean
  /** O acesso mais recente entre todos os produtos. `null` = nenhum registro em nenhum. */
  readonly diasDesdeUltimoAcesso: number | null
}

const DIA_MS = 1000 * 60 * 60 * 24

function diasDesde(ultimoAcessoEm: string | null, agoraMs: number): number | null {
  if (ultimoAcessoEm === null) return null
  const ms = Date.parse(ultimoAcessoEm)
  if (Number.isNaN(ms)) return null
  return Math.max(0, Math.floor((agoraMs - ms) / DIA_MS))
}

/**
 * Agrupa por conta e ordena **mais parado primeiro**.
 *
 * ⚠️ A ordem é parte da resposta. O console é onde alguém decide cortar acesso, e a
 * pergunta que leva a pessoa até ali é "quem está sobrando?" — deixar isso para quem sabe
 * rolar a lista é entregar o dado sem entregar a leitura. Quem não tem registro nenhum vem
 * primeiro, pela mesma razão que `assentoOcioso` o considera o mais ocioso: **nunca visto**
 * é o extremo da escala, não um buraco nela.
 *
 * Empate desfeito pelo e-mail, para que duas cargas da mesma tela mostrem a mesma ordem —
 * ordem instável se lê como defeito (é o motivo de `mapearComLimite` preservar a ordem).
 */
export function inventarioPorPessoa(
  itens: readonly ItemInventario[],
  ociosoDesdeDias: number,
  agoraMs: number,
): readonly PessoaComAssentos[] {
  const porConta = new Map<string, { base: ItemInventario; produtos: ProdutoDaPessoa[] }>()

  for (const item of itens) {
    const atual = porConta.get(item.accountId) ?? { base: item, produtos: [] }
    atual.produtos.push({
      produto: item.produto,
      ultimoAcessoEm: item.ultimoAcessoEm,
      ocioso: assentoOcioso(item.ultimoAcessoEm, ociosoDesdeDias, agoraMs),
      diasParado: diasDesde(item.ultimoAcessoEm, agoraMs),
    })
    porConta.set(item.accountId, atual)
  }

  const pessoas: PessoaComAssentos[] = [...porConta.values()].map(({ base, produtos }) => {
    const medidos = produtos
      .map((p) => p.diasParado)
      .filter((d): d is number => d !== null)
    return {
      accountId: base.accountId,
      email: base.email,
      nome: base.nome,
      // Produto também ordenado por nome: a lista é lida de cima a baixo por gente que
      // procura um produto específico.
      produtos: [...produtos].sort((a, b) => a.produto.localeCompare(b.produto)),
      todosParados: produtos.length > 0 && produtos.every((p) => p.ocioso),
      diasDesdeUltimoAcesso: medidos.length === 0 ? null : Math.min(...medidos),
    }
  })

  return pessoas.sort((a, b) => {
    const da = a.diasDesdeUltimoAcesso ?? Number.POSITIVE_INFINITY
    const db = b.diasDesdeUltimoAcesso ?? Number.POSITIVE_INFINITY
    if (da !== db) return db - da
    return a.email.localeCompare(b.email)
  })
}
