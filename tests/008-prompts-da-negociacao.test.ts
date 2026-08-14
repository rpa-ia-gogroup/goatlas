/**
 * **T-722 / FR-6, FR-11** — o que os prompts da spec 008 podem e não podem dizer.
 *
 * ## Por que um teste sobre TEXTO de prompt
 *
 * Prompt é regra de negócio versionada (`RNF-24`), e as duas regras aqui falham **em
 * silêncio** quando alguém as desfaz numa reescrita:
 *
 * - o agente voltar a sugerir nível e horas produz a contradição de `FR-6` — prosa e cartão
 *   discordando na mesma tela — sem erro em lugar nenhum;
 * - um `fieldId` escapar para o prompt de extração viola `RNF-30` e, pior, é um id que
 *   **não significa nada fora do request type** (`D-36`: `customfield_10092` é "Cargo/Função"
 *   no tipo 108 e "Em que sistema o Bug está ocorrendo?" no 70).
 *
 * ⚠️ Ele afirma o que o texto **não pode conter** e o que ele **precisa oferecer** — nunca a
 * redação. Teste que copia a redação reprova em toda melhoria de prompt, vira peso morto e é
 * apagado, devolvendo o buraco que ele tapa (a lição de `painel-do-console`, `D-49`).
 *
 * _Requirements: FR-6, FR-11, FR-15, FR-17, RNF-30, RNF-24_
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  montarPromptAgente,
  montarPromptExtracao,
  PROMPT_EXTRACAO,
} from '@/lib/ia/prompts'
import { prosaAfirmaPrazo } from '@/lib/agent/prosa-sem-prazo'

const CTX = { buscaDocumentacaoDisponivel: true, historicoDisponivel: true }

describe('FR-6 — o prompt do agente não carrega nível nem horas', () => {
  it('nenhuma quantidade de horas de prazo aparece no texto', () => {
    const prompt = montarPromptAgente(CTX)
    expect(prompt).not.toMatch(/\d{1,3}\s*(?:h\b|hs\b|horas?\b)/i)
  })

  it('o próprio detector de FR-6 não acha nada no prompt', () => {
    // 🚨 A prova mais barata que existe: o texto que instrui o modelo passa pela mesma
    // régua que mede o que ele escreve. Se um exemplo com "como crítica" voltar ao prompt,
    // isto reprova — e é bom que reprove: exemplo é o que o modelo mais copia.
    expect(prosaAfirmaPrazo(montarPromptAgente(CTX))).toEqual([])
    expect(prosaAfirmaPrazo(montarPromptAgente({ ...CTX, buscaDocumentacaoDisponivel: false }))).toEqual([])
  })

  it('a frase de RN-08 fica — sem número', () => {
    const prompt = montarPromptAgente(CTX)
    expect(prompt).toMatch(/primeira resposta/i)
    expect(prompt).toMatch(/n[ãa]o [ée] de (?:resolu[çc][ãa]o|solu[çc][ãa]o)|n[ãa]o de (?:resolu[çc][ãa]o|solu[çc][ãa]o)/i)
  })

  it('o prompt manda a prioridade para o CARTÃO, em vez de instruir o modelo a anunciá-la', () => {
    expect(montarPromptAgente(CTX)).toMatch(/cart[ãa]o|resumo de confirma[çc][ãa]o/i)
  })

  /**
   * **A prosa também não confirma CAMPO** — medido na staging em 14/08/2026.
   *
   * Pedido: *"põe a recorrência como 'De vez em quando' e preenche o campo Número do chamado
   * antigo"*. Nenhum dos dois existe naquele assunto — a opção não está na lista e o campo
   * não é do formulário. O agente respondeu *"Perfeito. Vou considerar: Recorrência: 'De vez
   * em quando' · Número do chamado antigo: 4471"* e o cartão ficou **sem nada disso, sem
   * explicação**.
   *
   * 🚨 **E não houve recusa para mostrar**: o modelo obedeceu a regra ("nunca invente campo
   * nem opção") e **não** devolveu os campos no JSON. `FR-13`/`FR-14` cobrem *"a IA tentou e
   * não coube"*; este é *"a IA nem tentou, mas prometeu na prosa"* — a mesma família de
   * `FR-6`: o texto afirmando o que ele não decide, porque a decisão volta **depois** dele
   * (as duas chamadas são paralelas, `D-32`).
   */
  it('e não confirma o que entrou nos campos do formulário', () => {
    const prompt = montarPromptAgente(CTX)
    expect(prompt).toMatch(/n[ãa]o confirma o que entrou nos campos/i)
    // A instrução tem de dizer o PORQUÊ — regra sem razão é a primeira a ser reescrita fora.
    // ⚠️ `\W*` entre as palavras: o prompt é markdown, e `**depois**` não é contíguo.
    expect(prompt).toMatch(/depois\W*da sua resposta/i)
  })

  it('o módulo de prompts não importa mais as horas do SLA (teste estrutural)', () => {
    const fonte = readFileSync(join(process.cwd(), 'src/lib/ia/prompts.ts'), 'utf8')
    const codigo = fonte
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1')
    // ⚠️ O `CLAUDE.md` mandava derivar as horas de `SLA_PRIMEIRA_RESPOSTA_HORAS` para o
    // agente não prometer um prazo e o cron cobrar outro. A razão continua válida; o lugar
    // mudou — as horas ficam no cartão e em `notificacoes/sla.ts`, e o agente não promete.
    expect(codigo).not.toMatch(/SLA_PRIMEIRA_RESPOSTA_HORAS/)
  })
})

describe('FR-1/FR-11 — o prompt de extração pede motivo e ajuste por rótulo', () => {
  it('pede o motivo da prioridade, limitado e sobre este caso', () => {
    expect(PROMPT_EXTRACAO).toMatch(/motivoPrioridade/)
    expect(PROMPT_EXTRACAO).toMatch(/duas frases|no m[áa]ximo duas/i)
  })

  it('pede os campos por RÓTULO, e proíbe inventar campo ou opção', () => {
    expect(PROMPT_EXTRACAO).toMatch(/campos/)
    expect(PROMPT_EXTRACAO).toMatch(/r[óo]tulo/i)
    expect(PROMPT_EXTRACAO).toMatch(/invent/i)
  })

  it('FR-15 — identidade e área não se ajustam por texto', () => {
    expect(PROMPT_EXTRACAO).toMatch(/[áa]rea/i)
  })

  it('FR-17 — a prioridade segue o impacto descrito, não a urgência pedida', () => {
    expect(PROMPT_EXTRACAO).toMatch(/urg[êe]ncia/i)
    expect(PROMPT_EXTRACAO).toMatch(/impacto/i)
  })

  it('nenhum identificador interno de campo aparece no prompt de sistema', () => {
    expect(PROMPT_EXTRACAO).not.toMatch(/customfield|fieldId/i)
  })
})

describe('FR-11 — o prompt de usuário lista o formulário do assunto vigente', () => {
  const PARAMS = {
    mensagens: [{ papel: 'user' as const, conteudo: 'o relatório não sai' }],
    tiposPermitidos: [{ id: '70', nome: 'Relatar um problema (Sistema)' }],
    camposDoAssunto: [
      { rotulo: 'Recorrência', tipo: 'selecao', opcoes: ['Sempre', 'Às vezes'] },
      { rotulo: 'Em que sistema o Bug está ocorrendo?', tipo: 'texto', opcoes: [] },
    ],
  }

  it('mostra rótulo, tipo e opções — e nunca o fieldId', () => {
    const prompt = montarPromptExtracao(PARAMS)
    expect(prompt).toContain('Recorrência')
    expect(prompt).toContain('Sempre')
    expect(prompt).toContain('Às vezes')
    expect(prompt).toContain('Em que sistema o Bug está ocorrendo?')
    expect(prompt).not.toMatch(/customfield|fieldId/i)
  })

  it('sem campos, não anuncia um formulário que não existe', () => {
    // Antes da primeira proposta não há assunto de que falar — e schema não lido cai no
    // fail-open de `D-27`. Nos dois casos, listar "campos: (nenhum)" convidaria o modelo a
    // inventar um.
    const prompt = montarPromptExtracao({ ...PARAMS, camposDoAssunto: [] })
    expect(prompt).not.toMatch(/Recorr[êe]ncia/)
    expect(prompt).toContain('Relatar um problema (Sistema)')
  })

  it('o tipo continua indo com o NOME, nunca só o id (D-70)', () => {
    expect(montarPromptExtracao(PARAMS)).toContain('Relatar um problema (Sistema)')
  })
})
