/**
 * Entidades HTML **acentuadas** na leitura do Confluence — regra 4 (acentuação em todo
 * texto visível), `RF-39`, `RF-43`.
 *
 * ## O bug, medido no app real em 07/08/2026 (`version 22`)
 *
 * Uma página do Confluence aparecia na aba Documentação assim:
 *
 * ```
 * Pr&eacute;-requisitos:
 * &Eacute; preciso criar pelo menos uma Fam&iacute;lia de Caixas...
 * ```
 *
 * `ENTIDADES_NOMEADAS` tinha 32 entradas — `rsquo`, `ldquo`, `copy`, `trade`, setas — e
 * **nenhuma letra do Latin-1**. `decodificarEntidades` caía no `?? todo` e devolvia o texto
 * cru. Entidade **numérica** (`&#233;`) sempre funcionou, porque `doPontoDeCodigo` resolve
 * qualquer código: o sintoma dependia de como o autor da página digitou, o que é
 * exatamente o tipo de bug que passa por revisão.
 *
 * ## 🚨 A armadilha, e por que ela é o coração deste arquivo
 *
 * O lookup era `ENTIDADES_NOMEADAS[nome.toLowerCase()]`. Forçar minúscula é inofensivo em
 * símbolo (`&COPY;` e `&copy;` são o mesmo ©) e **destrutivo em letra**: `&Eacute;` é **É**
 * e `&eacute;` é **é**.
 *
 * O conserto "óbvio" — só acrescentar as entradas em minúscula — faria `&Eacute; preciso`
 * virar `é preciso`. Acento certo, **caixa errada**, em silêncio: pior que o bug original,
 * porque parece consertado. O texto do bug real tem as duas formas, e é por isso que ele
 * está aqui como fixture.
 *
 * ## O que NÃO pode ser afrouxado ao mexer nessa função
 *
 * Três invariantes moram nela e o `CLAUDE.md` as registra. Os testes finais deste arquivo
 * as reafirmam, porque quem mexe em tabela de entidade passa perto das três:
 *
 * - **uma passagem só** (`&amp;lt;` para em `&lt;`);
 * - **nomeada exige o `;`**, numérica aceita sem (é por `&#106;avascript` sem `;` que o
 *   vetor chega, e é por exigir o `;` que `AT&T` sobrevive);
 * - a ordem de `urlSegura`: decodificar → limpar → verificar esquema.
 *
 * _Requirements: RF-39, RF-43, RNF-06, RNF-30_
 */

import { describe, expect, it } from 'vitest'
import {
  decodificarEntidades,
  sanitizarStorage,
  textoDe,
  urlSegura,
} from '@/lib/confluence/sanitizar'

/** O texto exato da página que revelou o bug. */
const PAGINA_REAL =
  'Pr&eacute;-requisitos: &Eacute; preciso criar pelo menos uma Fam&iacute;lia de Caixas ' +
  'antes da revis&atilde;o. Al&eacute;m disso, &eacute; preciso habilitar a integra&ccedil;&atilde;o.'

describe('o bug: entidade acentuada nomeada aparecia crua', () => {
  it('o texto real da página sai com acento — e com a CAIXA certa', () => {
    expect(decodificarEntidades(PAGINA_REAL)).toBe(
      'Pré-requisitos: É preciso criar pelo menos uma Família de Caixas ' +
        'antes da revisão. Além disso, é preciso habilitar a integração.',
    )
  })

  it('🚨 `&Eacute;` e `&eacute;` são letras DIFERENTES', () => {
    // O teste que trava a regressão de caixa. Com `toLowerCase()` no caminho das letras,
    // os dois lados desta comparação seriam `é`.
    expect(decodificarEntidades('&Eacute;')).toBe('É')
    expect(decodificarEntidades('&eacute;')).toBe('é')
    expect(decodificarEntidades('&Eacute;')).not.toBe(decodificarEntidades('&eacute;'))
  })

  it('as letras do português todas, nas duas caixas', () => {
    const casos: readonly [string, string][] = [
      ['&aacute;', 'á'], ['&Aacute;', 'Á'],
      ['&acirc;', 'â'], ['&Acirc;', 'Â'],
      ['&atilde;', 'ã'], ['&Atilde;', 'Ã'],
      ['&agrave;', 'à'], ['&Agrave;', 'À'],
      ['&eacute;', 'é'], ['&Eacute;', 'É'],
      ['&ecirc;', 'ê'], ['&Ecirc;', 'Ê'],
      ['&iacute;', 'í'], ['&Iacute;', 'Í'],
      ['&oacute;', 'ó'], ['&Oacute;', 'Ó'],
      ['&ocirc;', 'ô'], ['&Ocirc;', 'Ô'],
      ['&otilde;', 'õ'], ['&Otilde;', 'Õ'],
      ['&uacute;', 'ú'], ['&Uacute;', 'Ú'],
      ['&uuml;', 'ü'], ['&Uuml;', 'Ü'],
      ['&ccedil;', 'ç'], ['&Ccedil;', 'Ç'],
    ]
    for (const [entrada, esperado] of casos) {
      expect(decodificarEntidades(entrada), entrada).toBe(esperado)
    }
  })

  it('e as vizinhas que aparecem em documentação técnica (es, fr, de, it)', () => {
    expect(decodificarEntidades('&ntilde; &Ntilde;')).toBe('ñ Ñ')
    expect(decodificarEntidades('&egrave; &Egrave;')).toBe('è È')
    expect(decodificarEntidades('&ouml; &Ouml; &auml; &Auml;')).toBe('ö Ö ä Ä')
    expect(decodificarEntidades('&iuml; &Iuml;')).toBe('ï Ï')
    // `ß` não tem forma maiúscula em Latin-1: existe só `&szlig;`.
    expect(decodificarEntidades('&szlig;')).toBe('ß')
  })

  it('a numérica continua funcionando — ela nunca esteve quebrada', () => {
    expect(decodificarEntidades('&#233; &#201; &#xe9; &#xC9;')).toBe('é É é É')
  })

  it('caixa inválida (`&EACUTE;`) fica CRUA, como no navegador', () => {
    // `&EACUTE;` não é entidade HTML. Decodificá-la "por gentileza" seria inventar
    // comportamento que o navegador não tem — e para uma página que qualquer pessoa
    // edita, divergir do navegador é como um sanitizador começa a errar.
    expect(decodificarEntidades('&EACUTE;')).toBe('&EACUTE;')
  })

  it('símbolo continua tolerando caixa: `&COPY;` e `&copy;` são o mesmo ©', () => {
    expect(decodificarEntidades('&copy; &COPY; &Copy;')).toBe('© © ©')
  })

  it('entidade desconhecida continua saindo crua, sem inventar', () => {
    expect(decodificarEntidades('&naoexiste; &zzz;')).toBe('&naoexiste; &zzz;')
  })
})

describe('a página inteira, passando pela sanitização de verdade', () => {
  it('o texto do nó sai acentuado (é isto que a tela mostra)', () => {
    const r = sanitizarStorage(`<p>${PAGINA_REAL}</p>`)
    const texto = textoDe(r.nos)
    expect(texto).toContain('Pré-requisitos')
    expect(texto).toContain('É preciso')
    expect(texto).toContain('Família')
    expect(texto).toContain('revisão')
    expect(texto).toContain('integração')
    // O sintoma que o usuário viu não pode sobrar em lugar nenhum.
    expect(texto).not.toContain('&eacute;')
    expect(texto).not.toContain('&Eacute;')
  })

  it('acento em atributo também decodifica — o `alt` da imagem é texto visível', () => {
    const r = sanitizarStorage('<p><em>Configura&ccedil;&atilde;o</em></p>')
    expect(textoDe(r.nos)).toContain('Configuração')
  })
})

describe('as três invariantes que este conserto não podia afrouxar', () => {
  it('UMA passagem só: `&amp;lt;` para em `&lt;` e não vira tag', () => {
    // Um laço "decodifica até não mudar" transformaria dupla codificação em tag — o bug
    // clássico de sanitizador, e o mais fácil de reintroduzir mexendo aqui.
    expect(decodificarEntidades('&amp;lt;script&amp;gt;')).toBe('&lt;script&gt;')
    expect(decodificarEntidades('&amp;eacute;')).toBe('&eacute;')
  })

  it('nomeada EXIGE o `;`; numérica aceita sem', () => {
    // Sem a distinção, `AT&T` viraria outra coisa — e é por `&#106;avascript` sem `;` que
    // o vetor chega.
    expect(decodificarEntidades('AT&T')).toBe('AT&T')
    expect(decodificarEntidades('Pr&eacute-requisitos')).toBe('Pr&eacute-requisitos')
    expect(decodificarEntidades('&#233 sim')).toBe('é sim')
  })

  it('nenhuma letra nova produz caractere que possa abrir tag ou entidade', () => {
    // Guarda estrutural: a tabela cresceu, e o que a mantém segura é nenhuma entrada
    // devolver `<`, `>` ou `&`. Só `amp`/`lt`/`gt` fazem isso, e são símbolos antigos.
    for (const nome of ['eacute', 'Eacute', 'ccedil', 'Ccedil', 'atilde', 'Atilde', 'szlig']) {
      const saida = decodificarEntidades(`&${nome};`)
      expect(saida).not.toMatch(/[<>&]/)
      expect(saida).toHaveLength(1)
    }
  })

  it('`urlSegura` continua decodificando ANTES de verificar o esquema', () => {
    // A ordem não mudou: entidade no esquema não reconstrói `javascript:`.
    expect(urlSegura('&#106;avascript:alert(1)')).toBeNull()
    expect(urlSegura('java&Tab;script:alert(1)')).toBeNull()
    // E uma URL legítima com acento continua passando.
    expect(urlSegura('https://exemplo.com/p&aacute;gina')).toBe('https://exemplo.com/página')
  })
})
