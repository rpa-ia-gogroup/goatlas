/**
 * O que está ligado, o que está desligado, e o que isso causa — `RF-49`, `RNF-07`.
 *
 * O app é fail-closed: allowlist vazia **nega**. Isso é correto e é a decisão do
 * projeto, mas tem um efeito colateral na tela — um campo vazio parece exatamente
 * igual a qualquer outro campo vazio. Quem administrava só descobria que a busca
 * estava desligada pelo relato de quem tentou usar.
 *
 * Este módulo transforma a configuração em **afirmações sobre o comportamento
 * atual**: "a busca não devolve nada e a Regra 1 não vai defletir" em vez de
 * "`espacos_confluence: []`".
 *
 * ⚠️ **Aqui não se decide nada — aqui se relata.** Cada predicado abaixo é o mesmo
 * que o servidor já aplica (`regra2Disponivel` vem de `rules/`; `buscaConfigurada` é
 * consumido pela rota de busca; a abertura de chamado exige service desk e tipo
 * exatamente como em `rotas.ts`). Se alguém precisar escrever uma condição **nova**
 * neste arquivo, o lugar certo dela é o módulo de origem: um diagnóstico que
 * raciocina por conta própria vira uma segunda regra que diverge em silêncio, e o
 * console passa a mentir com confiança.
 */

import { regra2Disponivel } from '../rules'
import type { ConfigValores } from './index'

/** Seções do console. `visao` é a primeira e não edita nada. */
export type SecaoDoConsole =
  | 'visao'
  | 'entrada'
  | 'chamados'
  | 'documentacao'
  | 'interrupcao'
  | 'custo'
  | 'assentos'
  | 'auditoria'

/**
 * `parcial` é um estado de verdade, não meio-termo decorativo: a capacidade
 * funciona, mas entrega menos do que deveria (conta assento sem dizer o custo,
 * interrompe por uma regra e não pela outra).
 */
export type EstadoCapacidade = 'ligado' | 'parcial' | 'desligado'

export interface Capacidade {
  readonly id: 'entrada' | 'chamados' | 'documentacao' | 'interrupcao' | 'assentos'
  /** Nome pelo que a capacidade FAZ, nunca pelo nome da chave. */
  readonly nome: string
  readonly estado: EstadoCapacidade
  /** Uma frase, no presente, sobre o que acontece hoje com esta configuração. */
  readonly consequencia: string
  /** Seção que resolve — é para onde o "Configurar" do cartão leva. */
  readonly secao: SecaoDoConsole
}

/* ---------- predicados (a fonte é sempre outro módulo) ------------------ */

/**
 * Sem espaço na allowlist a busca não procura em lugar nenhum — `RN-06`, `RF-37`.
 * A rota de busca usa este mesmo predicado para distinguir "nada documentado" de
 * "nada configurado" (`buscaConfigurada` na resposta).
 */
export function buscaConfigurada(espacos: readonly string[]): boolean {
  return espacos.length > 0
}

/**
 * Abrir chamado exige **os dois**: a fila onde ele nasce (`service_desk_id`,
 * `RNF-25`) e ao menos um tipo na allowlist (`RF-28`). Falta qualquer um e nem a
 * conversa nem o formulário conseguem abrir.
 */
export function aberturaConfigurada(valores: ConfigValores): boolean {
  return valores.service_desk_id !== null && valores.tipos_chamado_permitidos.length > 0
}

/** Sem organização não há o que a Organizations API colete — `RNF-25`, `Q1`. */
export function governancaConfigurada(valores: ConfigValores): boolean {
  return valores.org_id !== null && valores.org_id.trim().length > 0
}

/* ---------- diagnóstico ------------------------------------------------- */

function diagnosticarEntrada(v: ConfigValores): Capacidade {
  const base = { id: 'entrada', nome: 'Entrada no app', secao: 'entrada' } as const
  if (v.dominios_permitidos.length === 0) {
    return {
      ...base,
      estado: 'desligado',
      consequencia:
        'Ninguém consegue entrar: a lista de domínios está vazia, e vazia significa negar todo mundo.',
    }
  }
  const dominios = v.dominios_permitidos.join(', ')
  if (v.admins.length === 0) {
    return {
      ...base,
      estado: 'parcial',
      // Quem está vendo esta frase entrou por `ATLAS_ADMINS` do ambiente
      // (bootstrap do primeiro boot). Dizer isso evita a conclusão errada de que a
      // aba está aberta para todo mundo.
      consequencia: `Entra quem tem e-mail de ${dominios}. Ninguém está na lista de administradores — esta aba só está aberta pelo ambiente.`,
    }
  }
  return {
    ...base,
    estado: 'ligado',
    consequencia: `Entra quem tem e-mail de ${dominios}. ${contar(v.admins.length, 'pessoa administra', 'pessoas administram')} o app.`,
  }
}

function diagnosticarChamados(v: ConfigValores): Capacidade {
  const base = { id: 'chamados', nome: 'Abertura de chamados', secao: 'chamados' } as const
  const semFila = v.service_desk_id === null
  const semTipo = v.tipos_chamado_permitidos.length === 0
  if (semFila && semTipo) {
    return {
      ...base,
      estado: 'desligado',
      consequencia:
        'Nenhum chamado é aberto: falta dizer em qual fila do JSM ele nasce e quais assuntos são oferecidos.',
    }
  }
  if (semFila) {
    return {
      ...base,
      estado: 'desligado',
      consequencia:
        'Nenhum chamado é aberto: falta dizer em qual fila do JSM ele nasce. O agente conversa, mas termina sem conseguir abrir.',
    }
  }
  if (semTipo) {
    return {
      ...base,
      estado: 'desligado',
      consequencia:
        'Nenhum assunto é oferecido: a lista de tipos está vazia, e vazia não oferece nada — nem na conversa, nem no formulário.',
    }
  }
  return {
    ...base,
    estado: 'ligado',
    consequencia: `${contar(v.tipos_chamado_permitidos.length, 'assunto pode ser aberto', 'assuntos podem ser abertos')} na fila ${v.service_desk_id}.`,
  }
}

function diagnosticarDocumentacao(v: ConfigValores): Capacidade {
  const base = {
    id: 'documentacao',
    nome: 'Busca na documentação',
    secao: 'documentacao',
  } as const
  if (!buscaConfigurada(v.espacos_confluence)) {
    return {
      ...base,
      estado: 'desligado',
      consequencia:
        'A busca não devolve nada e diz que não está configurada. Sem espaço liberado, o agente nunca oferece uma página antes do chamado.',
    }
  }
  const espacos = v.espacos_confluence.join(', ')
  const labels =
    v.labels_bloqueadas.length === 0
      ? 'Nenhuma etiqueta esconde página.'
      : `Página com a etiqueta ${v.labels_bloqueadas.join(' ou ')} continua fora.`
  return {
    ...base,
    estado: 'ligado',
    consequencia: `A busca procura em ${espacos}. ${labels}`,
  }
}

function diagnosticarInterrupcao(v: ConfigValores): Capacidade {
  const base = {
    id: 'interrupcao',
    nome: 'Interrupção antes do chamado',
    secao: 'interrupcao',
  } as const
  // A Regra 1 depende da MESMA allowlist da busca: sem página para oferecer, não
  // há deflexão possível — mesmo com o threshold configurado.
  const regra1 = buscaConfigurada(v.espacos_confluence)
  // Continua sendo o predicado de `rules/`, nunca uma condição escrita aqui — o que
  // mudou em `D-60` é só a FRASE: sem campo na tela (a Regra 2 está desligada por
  // decisão), "sem exemplos reais" descreveria uma pendência a resolver e mandaria
  // a pessoa procurar um controle que não existe.
  const regra2 = regra2Disponivel(v.regra2_exemplos_ajuste_operacional)
  // Só o CRITÉRIO, sem o sujeito — quem chama põe o sujeito uma vez. Guardar a
  // frase inteira aqui produzia "Só o histórico interrompe — o histórico
  // interrompe a partir de…".
  const criterio1 = `a partir de ${porcentagem(v.regra1_threshold_score)} de confiança`
  const criterio2 = `a partir de ${contar(v.regra2_threshold_recorrencia, 'chamado parecido', 'chamados parecidos')} em ${v.regra2_janela_dias} dias`

  if (!regra1 && !regra2) {
    return {
      ...base,
      estado: 'desligado',
      consequencia:
        'O agente não interrompe ninguém: sem espaço do Confluence não há página a oferecer, e a verificação de histórico está desligada por decisão.',
    }
  }
  if (!regra1) {
    return {
      ...base,
      estado: 'parcial',
      consequencia: `Só o histórico interrompe, ${criterio2}. Sem espaço do Confluence, não há página a oferecer antes.`,
    }
  }
  if (!regra2) {
    return {
      ...base,
      estado: 'parcial',
      consequencia: `Só a documentação interrompe, ${criterio1}. A verificação de histórico está desligada por decisão, e não tem campo nesta tela.`,
    }
  }
  return {
    ...base,
    estado: 'ligado',
    consequencia: `As duas verificações rodam: a documentação interrompe ${criterio1}, e o histórico ${criterio2}.`,
  }
}

function diagnosticarAssentos(v: ConfigValores): Capacidade {
  const base = { id: 'assentos', nome: 'Governança de assentos', secao: 'assentos' } as const
  if (!governancaConfigurada(v)) {
    return {
      ...base,
      estado: 'desligado',
      consequencia:
        'Nenhum inventário é coletado: falta apontar qual organização da Atlassian olhar.',
    }
  }
  if (Object.keys(v.custo_mensal_por_produto).length === 0) {
    return {
      ...base,
      estado: 'parcial',
      // Mesmo raciocínio de `custo.ts`: contagem sim, dinheiro inventado não.
      consequencia:
        'O console conta assentos, mas não mostra dinheiro: falta o preço mensal de cada produto.',
    }
  }
  return {
    ...base,
    estado: 'ligado',
    consequencia: `Assento sem uso há ${v.assentos_ocioso_dias} dias entra na lista de recomendações, com o custo somado.`,
  }
}

/**
 * As cinco capacidades, na ordem em que uma instalação nova precisa delas: sem
 * entrada nada mais importa; sem abertura o app não substitui o chat; documentação
 * e interrupção são a deflexão; assentos é o console de governança.
 */
export function diagnosticar(valores: ConfigValores): readonly Capacidade[] {
  return [
    diagnosticarEntrada(valores),
    diagnosticarChamados(valores),
    diagnosticarDocumentacao(valores),
    diagnosticarInterrupcao(valores),
    diagnosticarAssentos(valores),
  ]
}

/** O estado de uma seção do console, para a trilha de navegação. */
export function estadoDaSecao(
  secao: SecaoDoConsole,
  valores: ConfigValores,
): EstadoCapacidade | null {
  return diagnosticar(valores).find((c) => c.secao === secao)?.estado ?? null
}

/* ---------- formatação ------------------------------------------------- */

function contar(n: number, singular: string, plural: string): string {
  return `${n} ${n === 1 ? singular : plural}`
}

/**
 * O threshold é 0–1 no banco e continua sendo — mas "0,75" não diz nada a quem
 * administra, e "75% de confiança" diz. A tela traduz; a chave não muda.
 */
function porcentagem(fracao: number): string {
  return `${Math.round(fracao * 100)}%`
}
