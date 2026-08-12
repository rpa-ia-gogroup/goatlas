/**
 * A área do solicitante — `RF-19`, `FR-13` da spec 006.
 *
 * Uma função só, para os dois caminhos de criação. Um segundo lugar resolvendo isto
 * seria um caminho que grava área de um jeito e outro de outro — a divergência que a
 * spec §8 nomeia como o defeito.
 *
 * ## A ordem é fonte viva → mapa de configuração
 *
 * A TeamGuide sabe de quem mudou de time ontem; `areas_por_email` é uma tabela mantida à
 * mão, que ninguém atualiza. Por isso ela vem primeiro. Mas o mapa **não** sai de cena:
 * ele é o que mantém instalações sem a credencial funcionando exatamente como antes
 * (`FR-13`), e é a saída quando a fonte não conhece alguém.
 *
 * ## `nao_encontrada` cai no mapa; `indisponivel` também — e mesmo assim são auditados
 *   diferente
 *
 * O resultado é o mesmo (tenta o mapa, e sem ele fica sem área), mas o **motivo** é o
 * que diz o que fazer: "esta pessoa não está no cadastro" é trabalho de RH; "a fonte
 * caiu" é trabalho de plantão. Colapsar os dois num `null` apagaria isso no único lugar
 * onde ainda dá para recuperar.
 *
 * 🚨 **A área NUNCA é enviada à Atlassian** (`FR-7`). Ela vive no vínculo. Há teste
 * estrutural cobrando isso — sem ele, um dia alguém a acrescenta a `requestFieldValues`
 * "porque estava ali" e ela vaza para um campo do Jira que ninguém pediu.
 *
 * _Requirements: RF-19, RF-58, RNF-18, FR-7, FR-13_
 */

import type { Auditoria } from '../audit'
import type { ClienteTeamGuide } from './contrato'
import { areaDoEmail } from '../piloto/areas'

export interface ResolverAreaParams {
  readonly email: string
  readonly teamguide: ClienteTeamGuide | null
  readonly areasPorEmail: Readonly<Record<string, string>>
  readonly auditoria: Auditoria
}

/**
 * A área a gravar no vínculo. **Nunca lança** — o pior caso é `null`.
 */
export async function resolverArea(p: ResolverAreaParams): Promise<string | null> {
  const doMapa = areaDoEmail(p.email, p.areasPorEmail)

  if (!p.teamguide) return doMapa

  const r = await p.teamguide.areaDe(p.email)

  if (r.estado === 'encontrada') return r.area

  await p.auditoria.registrar({
    atorEmail: p.email,
    // 🚨 Continuam sendo DUAS ações, e `D-40` não mexeu nisso: `fase`/`classe` detalham
    // **por que** a fonte caiu, dentro de `area_indisponivel`. Promovê-las a uma terceira
    // ação diria que existe um terceiro trabalho a fazer — e não existe: é o mesmo
    // plantão, com uma pista a mais.
    acao: r.estado === 'indisponivel' ? 'area_indisponivel' : 'area_nao_encontrada',
    recurso: 'teamguide',
    resultado: r.estado === 'indisponivel' ? 'falha' : 'negado',
    detalhe: {
      ...(r.estado === 'indisponivel'
        ? {
            motivo: r.motivo,
            // Ausentes quando `motivo` se explica sozinho (`http_401`, `formato_inesperado`)
            // — ver `FalhaTeamGuide`. Gravar `null` ali sugeriria que não deu para saber.
            ...(r.fase ? { fase: r.fase } : {}),
            ...(r.classe ? { classe: r.classe } : {}),
          }
        : {}),
      // Diz se a pessoa fica sem área ou se o mapa cobriu — é a diferença entre "temos um
      // buraco" e "temos um buraco que a configuração está tapando".
      caiuNoMapa: doMapa !== null,
    },
  })

  return doMapa
}
