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

const EMAIL_DEV = process.env.GOATLAS_DEV_EMAIL ?? 'dev@gocase.com'
const CRON_KEY_DEV = 'dev-cron'

export function apiDev(): Plugin {
  return {
    name: 'goatlas-api-dev',
    apply: 'serve',
    async configureServer(server) {
      // Banco em arquivo, para o estado sobreviver ao hot reload.
      const db = new SqliteLocal('.goatlas-dev.db')

      // ⚠️ A config é semeada ANTES de montar o contexto: `montarContexto` lê os
      // valores uma vez, e semear depois deixaria o app fechado até reiniciar.
      // (Foi exatamente o bug que este comentário existe para não repetir.)
      const config = new Config(db)
      await migrar(db)
      const dominio = EMAIL_DEV.split('@')[1] ?? 'gocase.com'
      if ((await config.obter('dominios_permitidos')).length === 0) {
        await config.definir('dominios_permitidos', [dominio], EMAIL_DEV, new Date().toISOString())
        await config.definir('admins', [EMAIL_DEV], EMAIL_DEV, new Date().toISOString())
        await config.definir('tipos_chamado_permitidos', ['rt-dev'], EMAIL_DEV, new Date().toISOString())
        await config.definir('service_desk_id', 'sd-dev', EMAIL_DEV, new Date().toISOString())
        await config.definir('espacos_confluence', ['TECH'], EMAIL_DEV, new Date().toISOString())
        await config.definir(
          'regra2_exemplos_ajuste_operacional',
          ['Rodei o pipeline manualmente', 'Reparticionei a tabela'],
          EMAIL_DEV,
          new Date().toISOString(),
        )
        server.config.logger.info(
          `[goatlas] config de dev semeada · domínio ${dominio} · usuário ${EMAIL_DEV}`,
        )
      }

      // O fake de IA precisa de ROTEIRO, senão o agente responde "(fim do roteiro)"
      // e o fluxo não anda — dev sem roteiro não exercita nada.
      const iaDev = new ClienteIAFake([
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
      ])
      iaDev.repetirRoteiro = true
      iaDev.propostaSugerida = {
        titulo: 'Relatório de vendas não atualizou',
        descricao:
          'O relatório diário de vendas não trouxe os dados do dia anterior. Sem atualização desde a manhã.',
        prioridade: 'alta',
        tipoChamadoId: 'rt-dev',
        area: 'Growth',
      }

      // Um contexto inicial só para instanciar os fakes, que são REAPROVEITADOS
      // entre requisições — o contexto em si é remontado a cada uma, como o Worker
      // faz, para que config alterada pelo console valha na requisição seguinte.
      const inicial = await montarContexto(
        { DB: db, GOATLAS_USAR_FAKES: '1' },
        undefined,
        undefined,
        { ia: iaDev },
      )
      const clientes = { atlassian: inicial.atlassian, ia: iaDev }

      // Dados de fake para a UI ter o que mostrar.
      const fake = inicial.atlassian as unknown as {
        estado: { tiposChamado: unknown[]; paginas: unknown[] }
      }
      fake.estado.tiposChamado = [
        { id: 'rt-dev', serviceDeskId: 'sd-dev', nome: 'Suporte de tecnologia', descricao: null },
      ]
      fake.estado.paginas = [
        {
          id: 'p1',
          titulo: 'Como reprocessar o pipeline de vendas',
          espaco: 'TECH',
          url: 'https://goengenharia.atlassian.net/wiki/spaces/TECH/pages/1',
          score: 0.92,
          trecho: 'Para reprocessar, acesse o painel e rode a tarefa manual.',
          labels: [],
        },
      ]

      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/api/')) return next()

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
            { DB: db, GOATLAS_USAR_FAKES: '1' },
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
          server.config.logger.error(`[goatlas] erro em ${req.url}: ${String(erro)}`)
          res.statusCode = 500
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ erro: 'Erro no servidor de desenvolvimento.', codigo: 'dev' }))
        }
      })
    },
  }
}
