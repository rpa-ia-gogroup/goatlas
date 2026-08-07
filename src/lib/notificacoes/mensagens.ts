/**
 * Os textos que a pessoa lê — RF-44, RN-08, RNF-30.
 *
 * Funções puras, num arquivo só, por dois motivos concretos:
 *
 * 1. **`RN-08` é testável aqui.** O SLA é de **primeira resposta**, não de resolução,
 *    e a expressão "primeira resposta" é **obrigatória** no texto de criação. Um
 *    "prazo: 24h" solto faz a pessoa esperar o problema resolvido em 24h — e o
 *    projeto ser percebido como piora justamente pelas áreas que hoje respondem em
 *    2h30 (`R-05`). O teste cobra a expressão; se ela sair do texto, a suíte quebra.
 * 2. **`RNF-30` também.** Nenhuma mensagem carrega corpo de resposta da Atlassian,
 *    id interno ou nome de campo customizado: o que vai para um canal externo sai do
 *    domínio do app e pode acabar num log de terceiro.
 */

import type { Prioridade } from '../atlassian/tipos'
import type { Mensagem, TipoEvento } from './tipos'

const ROTULO_PRIORIDADE: Readonly<Record<Prioridade, string>> = {
  critica: 'crítica',
  alta: 'alta',
  normal: 'normal',
}

/** Link para a tela do chamado no PRÓPRIO app (não no Jira). */
export function linkDoChamado(baseApp: string | null, issueKey: string): string | null {
  if (!baseApp) return null
  const base = baseApp.replace(/\/+$/, '')
  return `${base}/?chamado=${encodeURIComponent(issueKey)}`
}

export function mensagemChamadoCriado(dados: {
  issueKey: string
  titulo: string
  prioridade: Prioridade
  slaPrimeiraRespostaHoras: number
  baseApp: string | null
}): Mensagem {
  return {
    titulo: `Chamado ${dados.issueKey} aberto`,
    corpo: [
      `Seu chamado **${dados.issueKey}** foi aberto: ${dados.titulo}`,
      `Prioridade: ${ROTULO_PRIORIDADE[dados.prioridade]}.`,
      // ⚠️ RN-08 — "primeira resposta", nunca "prazo de resolução". E os 24h são
      // PISO GARANTIDO (R-05): muita área responde bem antes.
      `Prazo de **primeira resposta**: até ${dados.slaPrimeiraRespostaHoras}h. Esse é o prazo máximo garantido para alguém te responder — não o prazo de solução, e muita área responde bem antes.`,
    ].join('\n'),
    link: linkDoChamado(dados.baseApp, dados.issueKey),
  }
}

export function mensagemStatusAlterado(dados: {
  issueKey: string
  status: string
  baseApp: string | null
}): Mensagem {
  return {
    titulo: `Chamado ${dados.issueKey}: ${dados.status}`,
    corpo: `O status do seu chamado **${dados.issueKey}** mudou para **${dados.status}**.`,
    link: linkDoChamado(dados.baseApp, dados.issueKey),
  }
}

/**
 * Comentário público.
 *
 * O trecho é **cortado**, não completo: comentário longo virando mensagem inteira num
 * canal externo espalha conteúdo do chamado por onde o app não controla. Quem quer o
 * texto todo abre o chamado — que é o que o link serve.
 */
export const MAX_TRECHO_COMENTARIO = 280

export function mensagemComentarioPublico(dados: {
  issueKey: string
  autorNome: string
  corpo: string
  baseApp: string | null
}): Mensagem {
  const limpo = dados.corpo.replace(/\s+/g, ' ').trim()
  const trecho =
    limpo.length > MAX_TRECHO_COMENTARIO
      ? `${limpo.slice(0, MAX_TRECHO_COMENTARIO)}…`
      : limpo
  return {
    titulo: `Novo comentário em ${dados.issueKey}`,
    corpo: `**${dados.autorNome}** comentou no seu chamado **${dados.issueKey}**:\n\n${trecho}`,
    link: linkDoChamado(dados.baseApp, dados.issueKey),
  }
}

/**
 * Alerta de SLA (RF-46).
 *
 * Também fala **primeira resposta**: um alerta que diga "SLA vencendo" sem dizer de
 * quê treina a pessoa a achar que o chamado deveria estar resolvido.
 */
export function mensagemSlaEmRisco(dados: {
  issueKey: string
  horasRestantes: number
  estourado: boolean
  baseApp: string | null
}): Mensagem {
  return {
    titulo: dados.estourado
      ? `Chamado ${dados.issueKey} sem primeira resposta no prazo`
      : `Chamado ${dados.issueKey} perto do prazo de primeira resposta`,
    corpo: dados.estourado
      ? `O prazo de **primeira resposta** do chamado **${dados.issueKey}** passou e ninguém respondeu ainda.`
      : `Faltam cerca de ${dados.horasRestantes}h para o prazo de **primeira resposta** do chamado **${dados.issueKey}**.`,
    link: linkDoChamado(dados.baseApp, dados.issueKey),
  }
}

/** Rótulo curto do evento, para o console de admin e a auditoria. */
export const ROTULO_EVENTO: Readonly<Record<TipoEvento, string>> = {
  chamado_criado: 'chamado aberto',
  status_alterado: 'status alterado',
  comentario_publico: 'comentário público',
  sla_em_risco: 'SLA de primeira resposta em risco',
}
