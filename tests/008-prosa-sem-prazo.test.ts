/**
 * **T-720 / FR-6** — a prosa do agente cala nível de prioridade e quantidade de horas.
 *
 * ## O que este arquivo protege
 *
 * Medido em 13/08/2026: a prosa dizia *"vou abrir como Crítica, primeira resposta em 4h"*
 * enquanto o cartão logo abaixo mostrava **Alta / 12h**. As duas saem de chamadas
 * **paralelas** (`D-32`) — a prosa é escrita **antes** de a extração voltar —, então o texto
 * não tem como saber o que o cartão vai dizer. Ele afirma o que não decidiu, e a pessoa lê
 * duas verdades diferentes na mesma tela.
 *
 * ⚠️ **Isto MEDE, não trava.** `FR-6` é qualidade de produto, não gate de segurança — a
 * mesma distinção de `D-27` para `RF-62`: quem "burla" produz uma frase feia no próprio
 * chamado, sem exposição e sem chamado perdido. Por isso o detector **nunca reescreve**:
 * recortar a frase proibida mutila o parágrafo em volta e o defeito volta com outra
 * redação. Se a auditoria mostrar vazamento recorrente, aí a escalada é recortar — com
 * dado, não com receio.
 *
 * _Requirements: FR-6, ScC-2, RF-68_
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { prosaAfirmaPrazo } from '@/lib/agent/prosa-sem-prazo'

describe('FR-6 — o nível de prioridade não sai na prosa', () => {
  it('acha "prioridade Alta"', () => {
    expect(prosaAfirmaPrazo('Vou registrar isso com prioridade Alta.')).toContain('nivel')
  })

  it('acha a classificação escrita de outras formas', () => {
    for (const texto of [
      'Classifiquei como crítica, porque a operação parou.',
      'Prioridade: Normal.',
      'Isso entra como Crítica na fila do time.',
      'Sugeri prioridade normal para este caso.',
    ]) {
      expect(prosaAfirmaPrazo(texto), texto).toContain('nivel')
    }
  })

  it('a palavra solta NÃO condena — "alta" é adjetivo comum em português', () => {
    for (const texto of [
      'A carga do servidor está muito alta desde ontem.',
      'O volume de pedidos é normal para esta época.',
      'Entendi: a fila do checkout está alta e ninguém consegue fechar a compra.',
    ]) {
      expect(prosaAfirmaPrazo(texto), texto).not.toContain('nivel')
    }
  })
})

describe('FR-6 — as horas de prazo não saem na prosa', () => {
  it('acha "em 12h"', () => {
    expect(prosaAfirmaPrazo('Alguém te responde em 12h.')).toContain('horas')
  })

  it('acha "primeira resposta em 4 horas"', () => {
    expect(prosaAfirmaPrazo('A primeira resposta em 4 horas está garantida.')).toContain(
      'horas',
    )
  })

  it('acha a promessa sem preposição, quando o assunto é prazo', () => {
    for (const texto of [
      'O prazo de primeira resposta é de 24 horas.',
      'O SLA aqui é 4h.',
      'O time retorna dentro de 12 horas.',
    ]) {
      expect(prosaAfirmaPrazo(texto), texto).toContain('horas')
    }
  })

  it('hora que a PESSOA relatou não é promessa — não condena', () => {
    for (const texto of [
      'Entendi: o sistema caiu há 3 horas e ninguém consegue faturar.',
      'Você disse que o relatório demorou 2 horas para sair.',
      'Isso começou depois de 5 horas de processamento.',
    ]) {
      expect(prosaAfirmaPrazo(texto), texto).not.toContain('horas')
    }
  })
})

describe('FR-6 — a frase de RN-08 FICA, e é o caso que mais importa', () => {
  it('"o prazo é de primeira resposta, não de solução" passa limpo', () => {
    // 🚨 Sem número e sem nível, ela é exatamente o que o agente DEVE dizer (`RN-08`): o
    // compromisso é de primeira resposta. Um detector que a condenasse tiraria do texto a
    // única frase que impede a pessoa de entender "resolvido em 24h".
    const rn08 =
      'O prazo é de primeira resposta, não de solução — alguém do time te retorna antes de resolver.'
    expect(prosaAfirmaPrazo(rn08)).toEqual([])
  })

  it('texto normal do agente não produz achado nenhum', () => {
    const texto =
      'Entendi o que aconteceu. Procurei na documentação interna e não achei nada que cubra ' +
      'esse caso, então montei o chamado abaixo — confira e ajuste o que quiser antes de confirmar.'
    expect(prosaAfirmaPrazo(texto)).toEqual([])
  })

  it('os dois achados convivem, sem repetir', () => {
    const texto = 'Vou abrir como Crítica e alguém te responde em 4h.'
    expect([...prosaAfirmaPrazo(texto)].sort()).toEqual(['horas', 'nivel'])
  })

  it('texto vazio não é achado', () => {
    expect(prosaAfirmaPrazo('')).toEqual([])
    expect(prosaAfirmaPrazo('   ')).toEqual([])
  })
})

describe('FR-6 — o texto NUNCA é reescrito (teste estrutural)', () => {
  it('o módulo só lê a prosa: não recorta, não substitui, não devolve texto', () => {
    const fonte = readFileSync(
      join(process.cwd(), 'src/lib/agent/prosa-sem-prazo.ts'),
      'utf8',
    )
    // Sem comentários: o que vale é o CÓDIGO — a explicação pode (e deve) citar a decisão.
    const codigo = fonte
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1')
    // ⚠️ Nenhuma mutilação do texto gerado: `FR-6` mede, não corta (§3.6 do plano).
    expect(codigo).not.toMatch(/\.replace\s*\(/)
    expect(codigo).not.toMatch(/\.slice\s*\(|\.substring\s*\(|\.substr\s*\(/)
  })
})
