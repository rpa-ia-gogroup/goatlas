/**
 * O prefixo antigo das variáveis do app, e o prefixo antigo da autoria.
 *
 * 🚨 O app chamou-se `goatlas` até 19/08/2026. Duas coisas atravessam essa fronteira e
 * **não podem ser reescritas por nós**: os nove secrets `GOATLAS_*` no GoDeploy (cujo
 * valor ninguém consegue ler de volta) e o prefixo `via goatlas:` gravado dentro de todo
 * comentário que já existe no Jira.
 *
 * Este arquivo é o que reprova uma remoção feita pela metade. Sem ele, tirar o `(?:go)?`
 * do regex ou o fallback do módulo de env passa em toda a suíte — porque nenhum outro
 * teste parte de dado escrito pela versão antiga do app.
 */
import { describe, expect, it } from 'vitest'
import { nomeLegado, valorDoApp } from '../src/lib/env-do-app'
import {
  ehComentarioDoSolicitante,
  prefixarAutoria,
  removerPrefixoAutoria,
} from '../src/lib/atlassian/comentarios'

describe('variáveis do app: lê os dois prefixos, escreve um', () => {
  it('o nome novo ganha do antigo', () => {
    const env = { ATLAS_DOMINIOS: 'gocase.com', GOATLAS_DOMINIOS: 'antigo.com' }
    expect(valorDoApp(env, 'ATLAS_DOMINIOS')).toBe('gocase.com')
  })

  it('🚨 só o secret antigo existe → o app continua configurado', () => {
    // O caso REAL de prod em 19/08/2026: os nove secrets ainda se chamam `GOATLAS_*`.
    // Sem o fallback, `dominios_permitidos` viria vazio — e vazio NEGA (`RNF-07`), então
    // o app negaria o acesso de todo mundo com HTTP 200 e nada no log.
    const env = { GOATLAS_DOMINIOS: 'gocase.com', GOATLAS_ADMINS: 'kaique.breno@gocase.com' }
    expect(valorDoApp(env, 'ATLAS_DOMINIOS')).toBe('gocase.com')
    expect(valorDoApp(env, 'ATLAS_ADMINS')).toBe('kaique.breno@gocase.com')
  })

  it('secret novo em BRANCO não mascara o antigo que funciona', () => {
    const env = { ATLAS_DOMINIOS: '', GOATLAS_DOMINIOS: 'gocase.com' }
    expect(valorDoApp(env, 'ATLAS_DOMINIOS')).toBe('gocase.com')
  })

  it('nenhum dos dois → undefined, e o fail-closed de sempre decide', () => {
    expect(valorDoApp({}, 'ATLAS_DOMINIOS')).toBeUndefined()
  })

  it('⚠️ NÃO alcança as credenciais da Atlassian', () => {
    // `ATLASSIAN_API_TOKEN` começa com as letras de `ATLAS` e nunca teve prefixo do app.
    // Um `replace('ATLAS', 'GOATLAS')` frouxo inventaria `GOATLASSIAN_API_TOKEN` e faria
    // este módulo virar um segundo lugar lendo credencial (`RNF-01`).
    expect(nomeLegado('ATLASSIAN_API_TOKEN')).toBeNull()
    expect(nomeLegado('LLM_API_KEY')).toBeNull()
    expect(nomeLegado('TG_API_TOKEN')).toBeNull()
    expect(nomeLegado('ATLAS_DOMINIOS')).toBe('GOATLAS_DOMINIOS')
  })
})

describe('autoria: o comentário escrito pelo app ANTIGO continua sendo do solicitante', () => {
  const corpoAntigo = '**Kaique Breno** (kaique.breno@gocase.com) via goatlas:\n\nnão consigo emitir nota'

  it('🚨 prefixo antigo é reconhecido como comentário do solicitante', () => {
    // Sem o `(?:go)?`, este comentário passaria a contar como PRIMEIRA RESPOSTA DO TIME
    // no SLA de `RF-46` — aderência inflada e alerta que nunca dispara (`D-56`) — e na
    // tela apareceria assinado pela conta de serviço (`D-43`).
    expect(ehComentarioDoSolicitante(corpoAntigo)).toBe(true)
  })

  it('🚨 prefixo antigo é removido do corpo exibido e da impressão digital', () => {
    // `RF-48`: a supressão de ação própria normaliza o texto SEM o prefixo. Prefixo que
    // não é removido gera hash diferente, a supressão nunca casa, e cada pessoa é
    // notificada do próprio comentário.
    expect(removerPrefixoAutoria(corpoAntigo)).toBe('não consigo emitir nota')
  })

  it('a escrita nova é `via atlas:`, e também é reconhecida', () => {
    const novo = prefixarAutoria('não consigo emitir nota', 'Kaique Breno', 'kaique.breno@gocase.com')
    expect(novo).toContain('via atlas:')
    expect(novo).not.toContain('goatlas')
    expect(ehComentarioDoSolicitante(novo)).toBe(true)
    expect(removerPrefixoAutoria(novo)).toBe('não consigo emitir nota')
  })

  it('comentário do time de tech não é confundido com nenhum dos dois', () => {
    const doTime = 'Oi! Já estamos olhando isso, o Protheus voltou às 14h.'
    expect(ehComentarioDoSolicitante(doTime)).toBe(false)
    expect(removerPrefixoAutoria(doTime)).toBe(doTime)
  })
})
