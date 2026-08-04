/**
 * Casca do app.
 *
 * Navegação por estado, sem lib de router: são quatro telas e nenhuma precisa de
 * URL profunda na Fase 1. Instalar TanStack Router antes de existir rota que o
 * exija seria abstração prematura (Princípio V) — quando a Fase 2 trouxer
 * Confluence e o console de governança, entra.
 */

import { useEffect, useState } from 'react'
import { api, ErroApi, type Identidade } from './api'
import { Aviso } from './componentes'
import { TelaConversa, TelaDetalhe, TelaFormulario, TelaMeusChamados } from './telas'

type Tela =
  | { nome: 'conversa' }
  | { nome: 'chamados' }
  | { nome: 'formulario' }
  | { nome: 'detalhe'; issueKey: string }

const ABAS: readonly { nome: Tela['nome']; rotulo: string }[] = [
  { nome: 'conversa', rotulo: 'Falar com o agente' },
  { nome: 'chamados', rotulo: 'Meus chamados' },
  { nome: 'formulario', rotulo: 'Abrir direto' },
]

export function App() {
  const [tela, setTela] = useState<Tela>({ nome: 'conversa' })
  const [eu, setEu] = useState<Identidade | null>(null)
  const [erroAuth, setErroAuth] = useState<string | null>(null)

  useEffect(() => {
    api
      .eu()
      .then(setEu)
      .catch((e) =>
        setErroAuth(
          e instanceof ErroApi ? e.message : 'Não conseguimos identificar sua conta.',
        ),
      )
  }, [])

  return (
    <div className="app">
      <header className="cabecalho">
        <span className="marca">
          go<span>atlas</span>
        </span>
        {eu && (
          <div className="conta">
            <span className="identidade">
              {eu.nome}
              <br />
              {eu.email}
            </span>
            {eu.urlLogout && (
              <a
                className="botao-sair"
                href={eu.urlLogout}
                title="Encerra sua sessão. Você volta para o painel do GoDeploy e precisa entrar de novo para usar o goatlas."
              >
                Sair
              </a>
            )}
          </div>
        )}
      </header>

      {eu?.modoDemo && (
        <p className="tarja-demo" role="status">
          <strong>Modo demonstração.</strong> Os dados são fictícios e nada é criado no Jira —
          chamados abertos aqui <strong>não chegam ao time de tech</strong>.
        </p>
      )}

      <main className="painel">
        {erroAuth ? (
          <Aviso atencao>{erroAuth}</Aviso>
        ) : (
          <>
            {tela.nome !== 'detalhe' && (
              <nav className="abas" aria-label="Seções do app">
                {ABAS.map((a) => (
                  <button
                    key={a.nome}
                    type="button"
                    className="aba"
                    aria-current={tela.nome === a.nome ? 'page' : undefined}
                    onClick={() => setTela({ nome: a.nome } as Tela)}
                  >
                    {a.rotulo}
                  </button>
                ))}
              </nav>
            )}

            {tela.nome === 'conversa' && (
              <TelaConversa aoAbrirChamado={() => setTela({ nome: 'chamados' })} />
            )}
            {tela.nome === 'chamados' && (
              <TelaMeusChamados
                aoAbrirDetalhe={(issueKey) => setTela({ nome: 'detalhe', issueKey })}
                aoConversar={() => setTela({ nome: 'conversa' })}
              />
            )}
            {tela.nome === 'formulario' && (
              <TelaFormulario aoAbrirChamado={() => setTela({ nome: 'chamados' })} />
            )}
            {tela.nome === 'detalhe' && (
              <TelaDetalhe
                issueKey={tela.issueKey}
                aoVoltar={() => setTela({ nome: 'chamados' })}
              />
            )}
          </>
        )}
      </main>
    </div>
  )
}
