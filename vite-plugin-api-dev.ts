/**
 * Plugin de desenvolvimento: serve `/api/*` no Vite com o MESMO código do Worker.
 *
 * Por que existe: em produção o **edge do GoDeploy** faz o OAuth e injeta
 * `x-godeploy-user-email` (D-02). O dev server não tem edge, então sem este shim
 * nenhuma rota responde e não há como desenvolver a UI.
 *
 * ⚠️ O e-mail de desenvolvimento é injetado **aqui, no servidor de dev**, e não no
 * navegador — de propósito. Se a UI pudesse mandar o e-mail, existiria um caminho
 * em que a identidade vem do cliente, e RF-04/RNF-05 passariam a depender de
 * ninguém usar esse caminho. O plugin também **não roda em build**: `apply: 'serve'`.
 */

import type { Plugin } from 'vite'
import { SqliteLocal } from './src/lib/db/sqlite-local'
import { montarContexto } from './src/lib/contexto'
import { tratarRequisicao } from './src/lib/http/rotas'
import { Config } from './src/lib/config'
import { migrar } from './src/lib/db/schema'
import { ClienteIAFake } from './src/lib/ia/fake'
import { ClienteOrganizacaoFake } from './src/lib/atlassian/organizacao-fake'

const EMAIL_DEV = process.env.ATLAS_DEV_EMAIL ?? 'dev@gocase.com'
const CRON_KEY_DEV = 'dev-cron'

/**
 * O roteiro do "modelo" em desenvolvimento: verifica e bloqueia no primeiro turno,
 * conclui no segundo.
 *
 * ⚠️ São exatamente DOIS turnos, e é por isso que ele precisa ser reiniciado a cada
 * conversa nova (ver o middleware). O índice do fake é do processo, não da conversa:
 * uma conversa que termina com número ÍMPAR de mensagens deixa o roteiro fora de
 * fase, e a conversa seguinte começa pelo turno 2 — respondendo "montei o chamado"
 * sem ter verificado nada. Nada nasce daí (a ordem de RF-08 continua fechando o
 * caminho, e nenhuma proposta é montada), mas quem está testando vê o agente pular a
 * deflexão e conclui que a Regra 1 quebrou.
 */
const ROTEIRO_DEV = [
  {
    texto: 'Deixa eu ver se isso já está documentado e se já apareceu antes.',
    toolsPropostas: [
      { nome: 'search_confluence', argumentos: { topico: 'relatório de vendas' } },
      { nome: 'check_jira_history', argumentos: { tipoProblema: 'relatorio-vendas' } },
    ],
  },
  {
    texto: 'Entendi o caso. Montei o chamado abaixo — confira e confirme.',
  },
] as const

export function apiDev(): Plugin {
  return {
    name: 'atlas-api-dev',
    apply: 'serve',
    async configureServer(server) {
      // Banco em arquivo, para o estado sobreviver ao hot reload.
      const db = new SqliteLocal('.atlas-dev.db')

      // ⚠️ A config é semeada ANTES de montar o contexto: `montarContexto` lê os
      // valores uma vez, e semear depois deixaria o app fechado até reiniciar.
      // (Foi exatamente o bug que este comentário existe para não repetir.)
      const config = new Config(db)
      await migrar(db)
      const dominio = EMAIL_DEV.split('@')[1] ?? 'gocase.com'
      if ((await config.obter('dominios_permitidos')).length === 0) {
        await config.definir('dominios_permitidos', [dominio], EMAIL_DEV, new Date().toISOString())
        await config.definir('admins', [EMAIL_DEV], EMAIL_DEV, new Date().toISOString())
        await config.definir(
          'tipos_chamado_permitidos',
          // `rt-dev` continua porque é o tipo que o fake de IA propõe na conversa; os
          // demais são os 15 reais do `GN` (`D-23`, medidos em 11/08/2026).
          ['rt-dev', '68', '70', '71', '89', '90', '91', '92', '93', '94', '95', '96', '108', '134', '143', '144'],
          EMAIL_DEV,
          new Date().toISOString(),
        )
        await config.definir('service_desk_id', 'sd-dev', EMAIL_DEV, new Date().toISOString())
        await config.definir('espacos_confluence', ['TECH'], EMAIL_DEV, new Date().toISOString())
        await config.definir('org_id', 'org-dev', EMAIL_DEV, new Date().toISOString())
        await config.definir(
          'regra2_exemplos_ajuste_operacional',
          ['Rodei o pipeline manualmente', 'Reparticionei a tabela'],
          EMAIL_DEV,
          new Date().toISOString(),
        )
        server.config.logger.info(
          `[atlas] config de dev semeada · domínio ${dominio} · usuário ${EMAIL_DEV}`,
        )
      }

      // O fake de IA precisa de ROTEIRO, senão o agente responde "(fim do roteiro)"
      // e o fluxo não anda — dev sem roteiro não exercita nada.
      const iaDev = new ClienteIAFake([...ROTEIRO_DEV])
      iaDev.repetirRoteiro = true
      iaDev.propostaSugerida = {
        titulo: 'Relatório de vendas não atualizou',
        descricao:
          'O relatório diário de vendas não trouxe os dados do dia anterior. Sem atualização desde a manhã.',
        prioridade: 'alta',
        tipoChamadoId: 'rt-dev',
        area: 'Growth',
        motivoPrioridade:
          'O relatório de vendas do dia não carregou e há contorno manual. Nenhuma parada de venda foi relatada.',
        campos: [],
      }

      // Organizations API fake — para o console de governança (T-128) ter o que
      // mostrar em dev sem esperar a credencial de Org Admin (Q1).
      const organizacaoDev = new ClienteOrganizacaoFake({
        usuarios: [
          {
            accountId: 'acc-dev-1',
            email: 'ana@gocase.com',
            nome: 'Ana',
            produtos: [
              { chave: 'confluence', nome: 'Confluence' },
              { chave: 'jira-software', nome: 'Jira Software' },
            ],
          },
          {
            // Só abre chamado — é o caso central de RF-54 (rebaixar para customer).
            accountId: 'acc-dev-2',
            email: 'bruno@gocase.com',
            nome: 'Bruno',
            produtos: [{ chave: 'jira-servicedesk', nome: 'Jira Service Management' }],
          },
          {
            // Ocioso em tudo — candidato a remoção.
            accountId: 'acc-dev-3',
            email: 'carla@gocase.com',
            nome: 'Carla',
            produtos: [{ chave: 'confluence', nome: 'Confluence' }],
          },
        ],
        ultimoAcesso: new Map([
          ['acc-dev-1', [{ produto: 'confluence', ultimoAcessoEm: new Date().toISOString() }]],
          // Bruno e Carla: sem entrada = "nunca visto" (o caso mais ocioso que existe).
        ]),
      })

      // Um contexto inicial só para instanciar os fakes, que são REAPROVEITADOS
      // entre requisições — o contexto em si é remontado a cada uma, como o Worker
      // faz, para que config alterada pelo console valha na requisição seguinte.
      const inicial = await montarContexto(
        { DB: db, ATLAS_USAR_FAKES: '1' },
        undefined,
        undefined,
        { ia: iaDev, organizacao: organizacaoDev },
      )
      const clientes = { atlassian: inicial.atlassian, ia: iaDev, organizacao: organizacaoDev }

      // Uma coleta já rodada, para a tela de governança não nascer vazia — em
      // produção isso é o cron diário (`POST /api/cron/coletar-inventario`).
      if ((await inicial.inventarioAssentos.obterMaisRecente()).coletadoEm === null) {
        const { usuarios } = await organizacaoDev.listarUsuarios('org-dev')
        const entradas = []
        for (const usuario of usuarios) {
          entradas.push({
            usuario,
            ultimoAcesso: await organizacaoDev.ultimoAcesso('org-dev', usuario.accountId),
          })
        }
        await inicial.inventarioAssentos.registrarColeta(entradas, new Date().toISOString())
      }

      // Dados de fake para a UI ter o que mostrar.
      const fake = inicial.atlassian as unknown as {
        estado: {
          tiposChamado: unknown[]
          camposPorTipo: Map<string, unknown[]>
          paginas: unknown[]
          conteudoPaginas: Map<string, unknown>
          anexos: Map<string, unknown>
          idsRestritos: Set<string>
          espacos: Map<string, { nome: string; homepageId: string | null }>
        }
      }
      fake.estado.tiposChamado = [
        { id: 'rt-dev', serviceDeskId: 'sd-dev', nome: 'Suporte de tecnologia', descricao: null },
        // Os 15 tipos REAIS do `GN`, medidos em 11/08/2026 contra a Atlassian.
        //
        // ⚠️ Os ids são os de verdade **de propósito**. O mapa de
        // `campos-do-solicitante.ts` é por request type: com ids inventados o dev
        // exercitaria o formulário sem exercitar o agrupamento, que é justamente o que
        // precisa ser olhado. E uma lista de um item só fazia o dev não se parecer com
        // produção no ponto em que a decisão é tomada — escolher o assunto.
        //
        // O `69` ("Solicitação enviada por e-mail") fica fora aqui pelo mesmo motivo que
        // fica fora da allowlist real (`D-23`): é o canal de entrada por e-mail do próprio
        // JSM, não um formulário para alguém escolher.
        { id: '68', serviceDeskId: 'sd-dev', nome: 'Outras questões / dúvidas', descricao: 'Não encontrou o que estava procurando? Selecione essa opção e iremos ajudá-lo.' },
        { id: '70', serviceDeskId: 'sd-dev', nome: 'Relatar um bug', descricao: 'Conte-nos sobre o problema que você está tendo' },
        { id: '71', serviceDeskId: 'sd-dev', nome: 'Sugira uma nova funcionalidade / melhoria', descricao: 'Conte-nos sua ideia sobre uma nova função' },
        { id: '89', serviceDeskId: 'sd-dev', nome: 'Produção parada', descricao: 'A produção está totalmente parada? Nos avise imediatamente.' },
        { id: '90', serviceDeskId: 'sd-dev', nome: 'Solicitação/problema no Site ou Checkout', descricao: 'O site está fora do ar? Nos avise agora mesmo.' },
        { id: '91', serviceDeskId: 'sd-dev', nome: 'Problema com pedido de cliente', descricao: 'Utilize esta opção para problemas com pagamentos, reembolso, edição de pedidos' },
        { id: '92', serviceDeskId: 'sd-dev', nome: 'Problema com Nota Fiscal específica ou grupo de Notas', descricao: 'Alguma NF não está sendo gerada? Vamos verificar o que está acontecendo.' },
        { id: '93', serviceDeskId: 'sd-dev', nome: 'Lançamento de produto', descricao: 'Faça solicitações para o lançamento de novos produtos' },
        { id: '94', serviceDeskId: 'sd-dev', nome: 'Lote não gera', descricao: 'Utilize esta opção quando não conseguir destravar lotes' },
        { id: '95', serviceDeskId: 'sd-dev', nome: 'Problemas com configuração do Totem, Webgex ou Meu Atendimento', descricao: 'Utilize esta função para solicitar, perguntar ou alinhar problemas com os softwares utilizados na loja' },
        { id: '96', serviceDeskId: 'sd-dev', nome: 'Problemas com grid', descricao: 'Utilize esta opção para problemas com grid' },
        { id: '108', serviceDeskId: 'sd-dev', nome: 'Solicitar acesso/permissão a um Sistema', descricao: 'Utilize esse formulário para solicitar acesso a um sistema interno da Gocase' },
        { id: '134', serviceDeskId: 'sd-dev', nome: 'Relatar um problema (Sistema)', descricao: 'Utilize esta opção para problemas com pagamentos, reembolso, edição de pedidos' },
        { id: '143', serviceDeskId: 'sd-dev', nome: 'Solicitação de nova Question/Dashboard', descricao: null },
        { id: '144', serviceDeskId: 'sd-dev', nome: 'Edição de Question/Dashboard', descricao: 'Solicitação para modificar uma Question/Dashboard existente' },
      ]
      // Os schemas reais dos tipos que têm campo — os outros não têm nenhum, e é assim
      // mesmo (medido). Aceitam anexo: **68, 70 e 134**; o 108 e os de dashboard, não.
      // É o que faz a pergunta de `RF-62` aparecer em três dos quinze.
      fake.estado.camposPorTipo.set('68', [
        {
          fieldId: 'components',
          rotulo: 'Componentes',
          obrigatorio: false,
          tipo: 'selecao',
          opcoes: [
            { id: '10070', rotulo: 'Chaplin' },
            { id: '10066', rotulo: 'Factory' },
            { id: '10073', rotulo: 'Influencers' },
            { id: '10069', rotulo: 'Printing Room' },
            { id: '10067', rotulo: 'V4 - Site' },
          ],
        },
        { fieldId: 'customfield_anexo', rotulo: 'Anexo', obrigatorio: false, tipo: 'anexo', opcoes: [] },
      ])
      // ⚠️ `customfield_10092` aqui é "Em que sistema o Bug está ocorrendo?" — o MESMO id
      // que no 108 é "Cargo/Função". É o bug de `D-36` reproduzível na tela: se o mapa
      // voltasse a ser um id global, o cargo da pessoa apareceria neste campo.
      fake.estado.camposPorTipo.set('70', [
        { fieldId: 'customfield_10092', rotulo: 'Em que sistema o Bug está ocorrendo?', obrigatorio: true, tipo: 'texto', opcoes: [] },
        {
          fieldId: 'customfield_10071',
          rotulo: 'Recorrência',
          obrigatorio: true,
          tipo: 'selecao',
          opcoes: [
            { id: '10124', rotulo: '0' },
            { id: '10127', rotulo: '3' },
            { id: '10129', rotulo: '5' },
          ],
        },
        { fieldId: 'customfield_anexo', rotulo: 'Anexo', obrigatorio: false, tipo: 'anexo', opcoes: [] },
      ])
      // `134` — mesmo caso do 70: aceita anexo, e o `customfield_10093` aqui é "Em que
      // sistema o erro está acontecendo?", enquanto no 108 o mesmo id é "Sistema que
      // solicita acesso". O segundo par de ids reusados de `D-36`.
      fake.estado.camposPorTipo.set('134', [
        { fieldId: 'customfield_10093', rotulo: 'Em que sistema o erro está acontecendo?', obrigatorio: true, tipo: 'texto', opcoes: [] },
        {
          fieldId: 'customfield_10071',
          rotulo: 'Recorrência',
          obrigatorio: true,
          tipo: 'selecao',
          opcoes: [
            { id: '10124', rotulo: '0' },
            { id: '10127', rotulo: '3' },
            { id: '10129', rotulo: '5' },
          ],
        },
        { fieldId: 'customfield_anexo', rotulo: 'Anexo', obrigatorio: false, tipo: 'anexo', opcoes: [] },
      ])
      // Os seis campos obrigatórios do 108, na ordem em que o portal os devolve. Os dois
      // primeiros são os que o app preenche; os quatro seguintes continuam sendo perguntas
      // que só quem pede sabe responder — é o contraste que a tela precisa mostrar.
      fake.estado.camposPorTipo.set('108', [
        { fieldId: 'customfield_10089', rotulo: 'Nome do Colaborador', obrigatorio: true, tipo: 'texto', opcoes: [] },
        { fieldId: 'customfield_10091', rotulo: 'E-mail', obrigatorio: true, tipo: 'texto', opcoes: [] },
        {
          fieldId: 'customfield_10092',
          rotulo: 'Cargo/Função que exercerá dentro do time',
          obrigatorio: true,
          tipo: 'texto',
          opcoes: [],
        },
        { fieldId: 'customfield_10093', rotulo: 'Sistema que solicita acesso', obrigatorio: true, tipo: 'texto', opcoes: [] },
        {
          fieldId: 'customfield_10094',
          rotulo: 'Breve descrição do que irá fazer',
          obrigatorio: true,
          tipo: 'texto_longo',
          opcoes: [],
        },
        {
          fieldId: 'customfield_10095',
          rotulo: 'Email da pessoa referência para copiar permissões',
          obrigatorio: true,
          tipo: 'texto_longo',
          opcoes: [],
        },
      ])
      // RF-27 (T-130) — schema de campos adicionais, para exercitar o formulário
      // dinâmico em dev sem esperar a credencial real (Q1).
      fake.estado.camposPorTipo.set('rt-dev', [
        {
          fieldId: 'customfield_sistema',
          rotulo: 'Sistema afetado',
          obrigatorio: true,
          tipo: 'texto',
          opcoes: [],
        },
        {
          fieldId: 'customfield_detalhes',
          rotulo: 'Detalhes técnicos (opcional)',
          obrigatorio: false,
          tipo: 'texto_longo',
          opcoes: [],
        },
        {
          fieldId: 'customfield_ambiente',
          rotulo: 'Ambiente',
          obrigatorio: true,
          tipo: 'selecao',
          opcoes: [
            { id: 'prod', rotulo: 'Produção' },
            { id: 'homolog', rotulo: 'Homologação' },
          ],
        },
        // RF-61/RF-62 (T-417) — o campo de anexo. Sem ele a pergunta obrigatória não
        // aparece em dev e a feature só existiria nos testes.
        //
        // ⚠️ Ele **não** é renderizado como campo: a rota o filtra (T-406c) e devolve
        // `aceitaAnexo: true`. Quem desenha o seletor é `PerguntaDeAnexo`.
        { fieldId: 'customfield_20031', rotulo: 'Anexo', obrigatorio: false, tipo: 'anexo', opcoes: [] },
      ])
      fake.estado.paginas = [
        {
          id: 'p1',
          titulo: 'Como reprocessar o relatório de vendas',
          espaco: 'TECH',
          url: 'https://goengenharia.atlassian.net/wiki/spaces/TECH/pages/1',
          score: 0.92,
          trecho: 'Quando o relatório de vendas não atualiza, rode a tarefa manual no painel.',
          labels: [],
        },
        {
          id: 'p2',
          titulo: 'Padrão de nomes das lojas no sistema',
          espaco: 'TECH',
          url: 'https://goengenharia.atlassian.net/wiki/spaces/TECH/pages/2',
          score: 0.38,
          trecho: 'As lojas seguem o padrão SIGLA-CIDADE em todos os relatórios.',
          labels: [],
        },
        // Página RESTRITA: some da busca e da leitura (RN-06). Está aqui para o dev
        // ver a trava funcionando, não só passar nos testes.
        {
          id: 'p3',
          titulo: 'Somente diretoria — planejamento',
          espaco: 'TECH',
          url: 'https://goengenharia.atlassian.net/wiki/spaces/TECH/pages/3',
          score: 0.99,
          trecho: 'não deveria aparecer',
          labels: [],
        },
      ]
      fake.estado.idsRestritos = new Set(['p3'])
      // Espaço com homepage: é dela que a árvore parte (RF-41).
      fake.estado.espacos.set('TECH', { nome: 'Tecnologia', homepageId: 'home' })
      // Busca que devolve tudo para qualquer termo faz a tela parecer quebrada — em dev
      // o fake imita o `text ~` do CQL (ver `filtrarPorTermo` no fake).
      ;(fake.estado as unknown as { filtrarPorTermo: boolean }).filtrarPorTermo = true

      // Corpo das páginas — sem isso a leitura em dev responde "não encontramos", e a
      // tela de leitura não é exercitada. Storage format de verdade, com macro não
      // suportada e tabela, para ver `RF-43` e a rolagem de tabela no celular.
      fake.estado.conteudoPaginas.set('home', {
        titulo: 'Documentação de tecnologia',
        espaco: 'TECH',
        labels: [],
        atualizadoEm: '2026-05-02T08:00:00.000Z',
        storage: '<p>Escolha um assunto abaixo.</p>',
      })
      fake.estado.conteudoPaginas.set('p1', {
        titulo: 'Como reprocessar o relatório de vendas',
        espaco: 'TECH',
        idPai: 'home',
        labels: [],
        atualizadoEm: '2026-07-28T13:20:00.000Z',
        storage: [
          '<h2>Quando usar</h2>',
          '<p>Use este procedimento quando o <strong>relatório de vendas</strong> não atualizar até as 9h.</p>',
          '<ol><li>Abra o painel de tarefas</li><li>Procure a rotina <code>vendas_diario</code></li><li>Execute o reprocessamento manual</li></ol>',
          '<ac:structured-macro ac:name="info"><ac:rich-text-body><p>O reprocessamento leva cerca de 10 minutos.</p></ac:rich-text-body></ac:structured-macro>',
          '<h2>Se não resolver</h2>',
          '<p>Abra chamado pelo atlas com o horário da última execução.</p>',
          '<ac:structured-macro ac:name="jira-chart"><ac:parameter ac:name="jql">project = EXEMPLO</ac:parameter></ac:structured-macro>',
        ].join(''),
      })
      fake.estado.conteudoPaginas.set('p2', {
        titulo: 'Padrão de nomes das lojas no sistema',
        espaco: 'TECH',
        idPai: 'home',
        labels: [],
        atualizadoEm: '2026-06-11T09:00:00.000Z',
        storage: [
          '<p>As lojas seguem o padrão <code>SIGLA-CIDADE</code>.</p>',
          '<table><thead><tr><th>Sigla</th><th>Cidade</th><th>Responsável</th></tr></thead>',
          '<tbody><tr><td>GC</td><td>Fortaleza</td><td>Operações</td></tr>',
          '<tr><td>GB</td><td>São Paulo</td><td>Expansão</td></tr></tbody></table>',
          '<p>Dúvida sobre uma sigla nova? Veja <ac:link><ri:page ri:content-title="Como reprocessar o relatório de vendas" /></ac:link>.</p>',
        ].join(''),
      })

      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/api/')) return next()

        // Conversa nova = roteiro do zero. `definirRoteiro` zera o índice; sem isto
        // a fase escorrega entre conversas (ver o comentário de `ROTEIRO_DEV`).
        if (req.url === '/api/conversas' && req.method === 'POST') {
          iaDev.definirRoteiro([...ROTEIRO_DEV])
        }

        const corpo: Buffer[] = []
        for await (const pedaco of req) corpo.push(pedaco as Buffer)

        const requisicao = new Request(`http://localhost${req.url}`, {
          method: req.method ?? 'GET',
          headers: {
            ...(req.headers as Record<string, string>),
            'x-godeploy-user-email': EMAIL_DEV,
            'x-godeploy-user-name': 'Dev Local',
          },
          ...(corpo.length > 0 ? { body: Buffer.concat(corpo) } : {}),
        })

        try {
          const ctx = await montarContexto(
            { DB: db, ATLAS_USAR_FAKES: '1' },
            undefined,
            undefined,
            clientes,
          )
          const resposta = await tratarRequisicao(requisicao, ctx, {
            GODEPLOY_CRON_KEY: CRON_KEY_DEV,
          })
          res.statusCode = resposta.status
          resposta.headers.forEach((valor, chave) => res.setHeader(chave, valor))
          res.end(await resposta.text())
        } catch (erro) {
          server.config.logger.error(`[atlas] erro em ${req.url}: ${String(erro)}`)
          res.statusCode = 500
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ erro: 'Erro no servidor de desenvolvimento.', codigo: 'dev' }))
        }
      })
    },
  }
}
