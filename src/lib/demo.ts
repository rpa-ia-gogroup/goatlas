/**
 * Modo demonstração — app publicado e clicável **antes** de existir credencial (Q1).
 *
 * Serve para mostrar o produto funcionando: login pelo edge, conversa, deflexão,
 * override, recibo, acompanhamento. Nada toca a Atlassian nem uma API de IA real.
 *
 * ⚠️ **A tarja de aviso é obrigatória, não cosmética.** Sem ela alguém abre um
 * "chamado" aqui, vê a chave `GOATLAS-3` na tela e acredita que o pedido chegou ao
 * time de tech. Isso é pior que o app não existir: a pessoa espera uma resposta que
 * nunca vem, e o problema dela fica sem tratamento. Por isso `modoDemo` é exposto em
 * `/api/auth/me` e em `/api/health`, e a UI o mostra de forma persistente.
 *
 * Ativação: secret `GOATLAS_MODO_DEMO=1`. Em produção de verdade, o secret sai.
 */

import type { ClienteAtlassianFake } from './atlassian/fake'
import type { ClienteIAFake } from './ia/fake'
import type { ConfigValores } from './config'

export const AVISO_DEMO =
  'Modo demonstração: os dados são fictícios e nada é criado no Jira. Chamados abertos aqui não chegam ao time de tech.'

export const TIPO_CHAMADO_DEMO = 'rt-demo'
export const SERVICE_DESK_DEMO = 'sd-demo'

/** Config mínima para o app funcionar na demonstração. */
export function configDemo(): Partial<ConfigValores> {
  return {
    tipos_chamado_permitidos: [TIPO_CHAMADO_DEMO],
    service_desk_id: SERVICE_DESK_DEMO,
    espacos_confluence: ['TECH'],
    // Exemplos EXPLICITAMENTE fictícios. Em produção esta lista nasce vazia e a
    // Regra 2 se declara indisponível (RF-14, Q3) — é o comportamento certo, e não
    // deve ser "resolvido" copiando estes exemplos para lá.
    regra2_exemplos_ajuste_operacional: [
      '[EXEMPLO FICTÍCIO] Rodei o pipeline manualmente',
      '[EXEMPLO FICTÍCIO] Reparticionei a tabela para destravar',
    ],
    /**
     * Canal de aviso na demonstração: `chat`, contra o `CanalFake`.
     *
     * ⚠️ Não é a resposta de Q11 — é o oposto. Em produção este campo nasce `null`, os
     * avisos ficam `suprimida` e o console mostra quantos ("havia 40 avisos e nenhum
     * canal"). Aqui ele é preenchido porque a demonstração precisa mostrar a fila
     * **funcionando**: com `null`, a tela de avisos ficaria vazia e o visitante concluiria
     * que a notificação não foi construída.
     *
     * O que sustenta a distinção é `contexto.ts`: fora dos fakes, canal sem configuração
     * vira `CanalIndisponivel`, nunca o dublê. Preencher aqui não abre caminho nenhum lá.
     */
    canal_notificacao_padrao: 'chat',
    /**
     * Mapa de áreas fictício, para a métrica por área (`T-312`) ter o que mostrar.
     *
     * O e-mail é intencionalmente genérico: quem visita a demonstração entra com a própria
     * conta Google, então ninguém casa com este mapa — e o painel mostra "Sem área", que é
     * exatamente o comportamento de `T-303` (o app não chuta área).
     */
    areas_por_email: { 'demonstracao@gocase.com': 'CX' },
  }
}

export function semearAtlassianDemo(fake: ClienteAtlassianFake): void {
  fake.estado.tiposChamado = [
    {
      id: TIPO_CHAMADO_DEMO,
      serviceDeskId: SERVICE_DESK_DEMO,
      nome: 'Suporte de tecnologia',
      descricao: 'Problemas em sistemas, relatórios e integrações',
    },
  ]
  fake.estado.paginas = [
    {
      id: 'demo-1',
      titulo: 'Como reprocessar o relatório de vendas',
      espaco: 'TECH',
      url: 'https://goengenharia.atlassian.net/wiki/spaces/TECH/pages/1',
      score: 0.93,
      trecho:
        'Quando o relatório diário não atualiza, abra o painel de tarefas e execute a rotina de reprocessamento manual.',
      labels: [],
    },
    {
      id: 'demo-2',
      titulo: 'Padrão de nomes das lojas no sistema',
      espaco: 'TECH',
      url: 'https://goengenharia.atlassian.net/wiki/spaces/TECH/pages/2',
      score: 0.42,
      trecho: 'As lojas seguem o padrão SIGLA-CIDADE.',
      labels: [],
    },
  ]
  // Na demonstração a busca precisa REAGIR ao termo: devolver tudo para qualquer
  // palavra faria a tela parecer quebrada justamente para quem está vendo o produto.
  fake.estado.filtrarPorTermo = true

  // Conteúdo das mesmas páginas, para a leitura direta (RF-39) responder na
  // demonstração em vez de dar "não encontramos". Storage format de verdade,
  // inclusive uma macro que o renderizador não suporta — é assim que a degradação
  // visível de RF-43 aparece na demo em vez de só no teste.
  fake.estado.espacos.set('TECH', { nome: 'Tecnologia', homepageId: 'demo-home' })
  fake.estado.conteudoPaginas.set('demo-home', {
    titulo: 'Documentação de tecnologia',
    espaco: 'TECH',
    labels: [],
    storage: '<p>Escolha um assunto abaixo.</p>',
  })
  fake.estado.conteudoPaginas.set('demo-1', {
    titulo: 'Como reprocessar o relatório de vendas',
    espaco: 'TECH',
    idPai: 'demo-home',
    labels: [],
    storage: [
      '<h2>Quando usar</h2>',
      '<p>Use este procedimento quando o relatório diário <strong>não atualizar</strong> até as 9h.</p>',
      '<ol><li>Abra o painel de tarefas</li><li>Procure a rotina <code>vendas_diario</code></li>',
      '<li>Execute o reprocessamento manual</li></ol>',
      '<ac:structured-macro ac:name="info"><ac:rich-text-body><p>O reprocessamento leva cerca de 10 minutos.</p></ac:rich-text-body></ac:structured-macro>',
      '<ac:structured-macro ac:name="jira-chart"><ac:parameter ac:name="jql">project = EXEMPLO</ac:parameter></ac:structured-macro>',
    ].join(''),
  })
  fake.estado.conteudoPaginas.set('demo-2', {
    titulo: 'Padrão de nomes das lojas no sistema',
    espaco: 'TECH',
    idPai: 'demo-home',
    labels: [],
    storage: [
      '<p>As lojas seguem o padrão <code>SIGLA-CIDADE</code>.</p>',
      '<table><thead><tr><th>Sigla</th><th>Cidade</th></tr></thead>',
      '<tbody><tr><td>GC</td><td>Fortaleza</td></tr><tr><td>GB</td><td>São Paulo</td></tr></tbody></table>',
    ].join(''),
  })
  fake.estado.historico = [
    {
      issueKey: 'DEMO-101',
      titulo: 'Relatório de vendas não atualizou',
      criadoEm: '2026-06-02T10:00:00.000Z',
      resolvidoEm: '2026-06-02T14:00:00.000Z',
      chaveAgrupamento: 'relatorio-vendas',
      comentariosResolucao: ['[FICTÍCIO] Reprocessei manualmente e voltou.'],
    },
    {
      issueKey: 'DEMO-118',
      titulo: 'Relatório de vendas sem dados do dia',
      criadoEm: '2026-07-04T09:00:00.000Z',
      resolvidoEm: '2026-07-04T11:30:00.000Z',
      chaveAgrupamento: 'relatorio-vendas',
      comentariosResolucao: ['[FICTÍCIO] Rodei a rotina na mão de novo.'],
    },
  ]
}

/**
 * Roteiro do "modelo" na demonstração.
 *
 * Com roteiro fixo a demonstração é previsível — quem estiver mostrando o produto
 * sabe o que vai acontecer. `repetirRoteiro` evita que a segunda conversa caia em
 * "(fim do roteiro)".
 */
export function semearIaDemo(fake: ClienteIAFake): void {
  fake.definirRoteiro([
    {
      texto: 'Entendi. Deixa eu ver se isso já está documentado e se já apareceu antes.',
      toolsPropostas: [
        { nome: 'search_confluence', argumentos: { topico: 'relatório de vendas' } },
        { nome: 'check_jira_history', argumentos: { tipoProblema: 'relatorio-vendas' } },
      ],
    },
    { texto: 'Montei o chamado com o que você contou. Confira e confirme.' },
  ])
  fake.repetirRoteiro = true
  fake.classePadrao = 'ajuste_operacional'
  fake.propostaSugerida = {
    titulo: 'Relatório de vendas não atualizou',
    descricao:
      'O relatório diário de vendas não trouxe os dados do dia anterior. Sem atualização desde a manhã.',
    prioridade: 'alta',
    tipoChamadoId: TIPO_CHAMADO_DEMO,
    area: null,
  }
}
