/**
 * Campo obrigatório que não foi preenchido — a trava contra **perder o chamado**.
 *
 * ## O que acontecia sem isto
 *
 * O request type 70 ("Relatar um bug") exige *"Em que sistema o Bug está ocorrendo?"* e
 * *"Recorrência"*; o 108 exige seis campos; o 93 exige data limite e responsável (medido
 * em 11/08/2026). Mandar a criação sem eles faz o JSM responder **400** — e neste projeto
 * 400 é **definitivo**: a submissão vira `falha` e **nunca é reprocessada** (`RNF-17`).
 *
 * 🚨 O caminho da conversa não coletava campo extra nenhum. Ou seja: agente ajuda a
 * pessoa, ela confirma, e o chamado morre no 400 — com o pior desfecho possível, porque
 * não há segunda tentativa automática.
 *
 * Esta função transforma isso num **erro corrigível**: a criação é recusada **antes** de
 * qualquer efeito, com os rótulos do que falta, e a pessoa completa.
 *
 * ## Fail-OPEN quando o schema é desconhecido
 *
 * Mesma decisão de `RF-62`/`D-27`, pelo mesmo motivo: schema que não pôde ser lido não é
 * evidência de que falta campo. Recusar aí seria transformar indisponibilidade de leitura
 * em parede, que é o que `RNF-18` proíbe. Sem schema, segue e deixa o JSM decidir.
 *
 * ## Vale para os DOIS caminhos de criação
 *
 * A tela do formulário já marca `required` nos inputs, mas isso é a camada 1 — vale para
 * quem usa a tela. Quem chama a rota direto nunca viu input nenhum. É o mesmo desenho de
 * duas camadas de `agent/gate.ts`.
 *
 * _Requirements: RF-27, RF-62, RNF-17, RNF-18_
 */

import type { SchemaDoTipo } from './declaracao-anexo'

/**
 * Os RÓTULOS dos campos obrigatórios que ficaram sem valor.
 *
 * Rótulo, não `fieldId`: a mensagem é lida por quem abre o chamado, e
 * `customfield_10071` não diz nada a ninguém (`RNF-30` também pede isso — id de campo
 * descreve estrutura interna).
 *
 * ⚠️ O campo de **anexo** fica de fora: quem governa arquivo é `RF-62`/`RN-11`, e ali a
 * regra é explícita — a declaração trava responder, nunca anexar. Incluí-lo aqui
 * transformaria "responda se tem evidência" em "anexe um arquivo", que é a parede que a
 * spec 005 recusa.
 */
export function obrigatoriosFaltando(
  schema: SchemaDoTipo,
  valores: Readonly<Record<string, string>> | null,
): readonly string[] {
  if (!schema.conhecido) return []
  const preenchidos = valores ?? {}
  return schema.campos
    .filter((c) => c.obrigatorio && c.tipo !== 'anexo')
    .filter((c) => (preenchidos[c.fieldId] ?? '').trim().length === 0)
    .map((c) => c.rotulo)
}

/** A mensagem, em português e nomeando o que falta. */
export function mensagemObrigatoriosFaltando(rotulos: readonly string[]): string {
  const lista = rotulos.join(', ')
  return rotulos.length === 1
    ? `Falta preencher "${lista}" — o Jira exige esse campo para este tipo de chamado.`
    : `Faltam preencher: ${lista}. O Jira exige esses campos para este tipo de chamado.`
}
