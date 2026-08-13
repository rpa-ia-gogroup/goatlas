/**
 * **T-417 a T-420** — as duas telas do anexo, nas partes que dá para checar sem navegador.
 *
 * O foco não é aparência: é **o que a tela diz e o que ela oferece**. Cinco coisas que só o
 * teste garante, porque as cinco voltam sozinhas na primeira pressa:
 *
 * 1. **Nenhuma opção pré-marcada** (`SC-01`). Um `defaultChecked` em "não tenho" faria a
 *    pergunta obrigatória virar campo opcional com resposta padrão — e o dado que ela
 *    produz (quem declarou não ter × quem não pensou no assunto) deixaria de existir.
 * 2. **A copy da opção negativa.** "Pular" sugere que anexar era o dever; é o texto que a
 *    spec §1 recusa por nome.
 * 3. **O botão desabilitado DIZ o que falta.** Botão morto sem explicação é
 *    indistinguível de app quebrado.
 * 4. **Estado do envio nunca só por cor** (`RNF-28`): símbolo e palavra nos três casos.
 * 5. **Rádio nativo, dentro de `fieldset`/`legend`.** Teclado, foco visível e leitor de
 *    tela vêm de graça daí, e não vêm de graça de um `div` com `role="radio"`.
 *
 * _Requirements: RF-61, RF-62, RF-63, RN-11, RF-17, RNF-28, RNF-30_
 */

import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { PerguntaDeAnexo, ResultadoDoAnexo, ROTULOS_ENVIO, type Declaracao } from '@/app/anexo'
import { mensagemDePendencias, pendenciasParaAbrir } from '@/app/pendencias'
import { MAX_ANEXOS_POR_CHAMADO } from '@/lib/tickets/anexos-pendentes'
import type { ResultadoAnexo } from '@/app/api'

function pergunta(declarou: Declaracao, jaEnviados: readonly string[] = []): string {
  return renderToStaticMarkup(
    createElement(PerguntaDeAnexo, {
      alvo: { via: 'formulario', chaveIdempotencia: 'k1' },
      declarou,
      aoDeclarar: () => {},
      jaEnviados,
      teto: MAX_ANEXOS_POR_CHAMADO,
    }),
  )
}

function resultado(anexo: Partial<ResultadoAnexo>): string {
  return renderToStaticMarkup(
    createElement(ResultadoDoAnexo, {
      anexo: {
        estado: 'sem_anexo',
        anexados: [],
        falharam: [],
        mensagem: '',
        ...anexo,
      } as ResultadoAnexo,
    }),
  )
}

describe('SC-01 — a pergunta existe, e nenhuma opção vem marcada', () => {
  it('as duas opções aparecem, e nenhum rádio está marcado', () => {
    const saida = pergunta(null)
    expect(saida).toContain('Você tem algo para anexar?')
    expect(saida).toContain('type="radio"')
    // `checked` no HTML estático seria a opção pré-marcada.
    expect(saida).not.toContain('checked')
  })

  it('a opção negativa se chama "não tenho material para anexar", nunca "pular"', () => {
    const saida = pergunta(null)
    expect(saida).toContain('Não tenho material para anexar')
    expect(saida.toLowerCase()).not.toContain('pular')
    // E ela é declarada legítima na própria tela: sem isso, a resposta honesta vira a
    // resposta que ninguém escolhe.
    expect(saida).toContain('Resposta legítima')
  })

  it('a pergunta é um `fieldset` com `legend` — é de onde vem a semântica de grupo', () => {
    const saida = pergunta(null)
    expect(saida).toContain('<fieldset')
    expect(saida).toContain('<legend')
  })
})

describe('SC-03 / RN-11 — a trava é responder, não anexar', () => {
  it('"tenho" abre o seletor de arquivo', () => {
    const saida = pergunta(true)
    expect(saida).toContain('type="file"')
  })

  it('"não tenho" NÃO abre seletor nenhum', () => {
    expect(pergunta(false)).not.toContain('type="file"')
  })

  it('com o seletor aberto, a tela diz que dá para abrir sem escolher arquivo', () => {
    // É a frase que impede a pessoa de achar que precisa ter um print para abrir chamado.
    expect(pergunta(true)).toContain('mesmo sem escolher arquivo')
  })

  it('a mensagem do botão travado nomeia o que falta, e só isso', () => {
    // ⚠️ `D-46` — a frase deixou de ser constante. Ela afirmava "É a única coisa que
    // falta", e essa afirmação depende do resto da tela, que uma constante não vê.
    const frase = mensagemDePendencias(
      pendenciasParaAbrir({ campos: [], valores: {}, faltaDeclararAnexo: true }),
    )
    expect(frase).toMatch(/responder/i)
    expect(frase).not.toMatch(/erro|inválid|obrigat/i)
  })
})

describe('T-419 / RNF-28 — o estado do envio nunca é só cor', () => {
  it('cada estado tem símbolo E palavra, e os três são distintos entre si', () => {
    // Renderizar o estado do envio exige interação (o `useState` interno), então o que se
    // trava aqui é o CONTRATO. Cor sozinha reprova em monocromático e em daltonismo.
    const estados = ['enviando', 'enviado', 'falhou'] as const
    const palavras = estados.map((e) => ROTULOS_ENVIO[e].palavra)
    const simbolos = estados.map((e) => ROTULOS_ENVIO[e].simbolo)
    expect(new Set(palavras).size).toBe(3)
    expect(new Set(simbolos).size).toBe(3)
    expect(palavras.every((p) => p.trim().length > 0)).toBe(true)
    // E "não subiu" precisa dizer que não subiu: "Erro" contaria o que aconteceu com o
    // sistema, não com o arquivo da pessoa.
    expect(ROTULOS_ENVIO.falhou.palavra.toLowerCase()).toContain('não subiu')
  })

  it('o resultado do anexo que falhou aparece como aviso, com a mensagem do servidor', () => {
    const saida = resultado({
      estado: 'falhou',
      falharam: ['print.png'],
      mensagem: 'Seu chamado está aberto. O anexo (print.png) não subiu — abra o chamado…',
    })
    expect(saida).toContain('aviso-atencao')
    expect(saida).toContain('não subiu')
    // `status`, não `alert`: o chamado ABRIU, e interromper o leitor de tela daria à
    // falha do anexo uma urgência que ela não tem.
    expect(saida).toContain('role="status"')
  })

  it('anexo que deu certo diz o nome do arquivo; sem anexo não diz nada', () => {
    expect(resultado({ estado: 'anexado', anexados: ['print.png'] })).toContain('print.png')
    expect(resultado({ estado: 'sem_anexo' })).toBe('')
  })

  it('SC-07b — o caso adiado usa a mensagem do servidor, não uma inventada na tela', () => {
    const saida = resultado({
      estado: 'adiado',
      mensagem: 'Seu chamado entrou na fila e será aberto em instantes.',
    })
    expect(saida).toContain('entrou na fila')
  })
})
