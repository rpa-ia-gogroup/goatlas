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
import { TelaAdmin } from './admin'
import { TelaAvisos } from './avisos'
import { entradaDaUrl, TelaDocumentacao, type EntradaDocumentacao } from './confluence'

type Tela =
  | { nome: 'conversa' }
  | { nome: 'documentacao' }
  | { nome: 'chamados' }
  | { nome: 'formulario' }
  | { nome: 'avisos' }
  | { nome: 'admin' }
  | { nome: 'detalhe'; issueKey: string }

// A ORDEM é recomendação: ler a documentação vem antes de acompanhar chamado, e muito
// antes de abrir um direto. É a mesma sequência que a Regra 1 impõe na conversa.
const ABAS: readonly { nome: Tela['nome']; rotulo: string; soAdmin?: boolean }[] = [
  { nome: 'conversa', rotulo: 'Falar com o agente' },
  { nome: 'documentacao', rotulo: 'Documentação' },
  { nome: 'chamados', rotulo: 'Meus chamados' },
  { nome: 'formulario', rotulo: 'Abrir direto' },
  // Depois de "Meus chamados" de propósito: a aba de avisos é ajuste de preferência,
  // não caminho para resolver nada. Quem chega no app tem um problema, não uma
  // configuração a mexer.
  { nome: 'avisos', rotulo: 'Avisos' },
  // A aba só aparece para admin — mas quem garante o acesso é o gate do SERVIDOR
  // em cada rota `/api/admin/*`. Esconder no cliente é conveniência, não segurança.
  { nome: 'admin', rotulo: 'Administração', soAdmin: true },
]

export function App() {
  // A URL pode pedir a documentação direto (`?q=` ou `?pagina=`): é como um colega
  // compartilha uma página, e é como o link `ri:page` do próprio Confluence chega.
  // Não é router — é leitura única no boot, ver `confluence.tsx`.
  const [entrada] = useState<EntradaDocumentacao>(() =>
    typeof window === 'undefined' ? {} : entradaDaUrl(window.location.search),
  )
  const [tela, setTela] = useState<Tela>(() =>
    entrada.pagina || entrada.termo ? { nome: 'documentacao' } : { nome: 'conversa' },
  )
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
        {/*
          A identidade no canto existe só para a pessoa saber COM QUAL CONTA está
          logada. Não há botão de sair — decisão D-08: trocar de conta não é caso de
          uso desta ferramenta, e quem tem duas contas limpa os cookies.
        */}
        {eu && (
          <span className="identidade">
            {eu.nome}
            {eu.isAdmin && <span className="selo-admin">admin</span>}
            <br />
            {eu.email}
          </span>
        )}
      </header>

      {eu?.modoDemo && (
        <p className="tarja-demo" role="status">
          <strong>Modo demonstração.</strong> Os dados são fictícios e nada é criado no Jira —
          chamados abertos aqui <strong>não chegam ao time de tech</strong>.
        </p>
      )}

      {/* ⚠️ Tarja diferente da de demonstração, porque o estado é OUTRO: aqui o que se lê
          é real. Achatar os dois numa frase só faria alguém duvidar da documentação que
          está lendo — que é justamente a parte que funciona. */}
      {eu?.somenteLeitura && !eu.modoDemo && (
        <p className="tarja-demo" role="status">
          <strong>Somente leitura.</strong> A documentação e os chamados que você vê são
          reais, mas o app <strong>ainda não abre chamado</strong> — está em implantação.
        </p>
      )}

      <main className="painel">
        {erroAuth ? (
          <Aviso atencao>{erroAuth}</Aviso>
        ) : (
          <>
            {tela.nome !== 'detalhe' && (
              <nav className="abas" aria-label="Seções do app">
                {ABAS.filter((a) => !a.soAdmin || eu?.isAdmin).map((a) => (
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
            {tela.nome === 'documentacao' && (
              <TelaDocumentacao
                inicial={entrada}
                aoConversar={() => setTela({ nome: 'conversa' })}
              />
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
            {tela.nome === 'avisos' && <TelaAvisos />}
            {tela.nome === 'admin' && <TelaAdmin />}
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
