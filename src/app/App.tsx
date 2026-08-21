/**
 * Casca do app.
 *
 * Navegação por **estado**, com a URL acompanhando: cada tela tem caminho próprio
 * (`rotas.ts`) e cada passo empilha uma entrada no histórico, então o ← do navegador volta
 * um passo em vez de sair do app. Continua sem lib de router — são sete telas, e o custo é
 * uma tabela de caminhos (Princípio V).
 */

import { useEffect, useState } from 'react'
import { api, ErroApi, type Identidade } from './api'
import { Aviso } from './componentes'
import { TelaConversa, TelaDetalhe, TelaFormulario, TelaMeusChamados } from './telas'
import { TelaAdmin } from './admin'
import { TelaInvestigador } from './investigador'
import { entradaDaUrl, TelaDocumentacao, type EntradaDocumentacao } from './confluence'
import {
  CAMINHO_CONVERSA,
  caminhoDaTela,
  irPara,
  telaDoCaminho,
  type Tela,
} from './rotas'

// A ORDEM é recomendação: ler a documentação vem antes de acompanhar chamado, e muito
// antes de abrir um direto. É a mesma sequência que a Regra 1 impõe na conversa.
const ABAS: readonly { nome: Tela['nome']; rotulo: string; soAdmin?: boolean }[] = [
  { nome: 'conversa', rotulo: 'Falar com o agente' },
  { nome: 'documentacao', rotulo: 'Documentação' },
  { nome: 'chamados', rotulo: 'Meus chamados' },
  { nome: 'formulario', rotulo: 'Abrir direto' },
  // A aba só aparece para admin — mas quem garante o acesso é o gate do SERVIDOR
  // em cada rota `/api/admin/*`. Esconder no cliente é conveniência, não segurança.
  { nome: 'admin', rotulo: 'Administração', soAdmin: true },
  // Depois de Administração de propósito: o console é onde se **decide**, e o Investigador
  // é onde se **apura**. Quem abre o app com um problema não passa por nenhum dos dois.
  { nome: 'investigador', rotulo: 'Investigador', soAdmin: true },
]

export function App() {
  // A URL pode pedir a documentação direto (`?q=` ou `?pagina=`): é como um colega
  // compartilha uma página, e é como o link `ri:page` do próprio Confluence chega.
  const [entrada] = useState<EntradaDocumentacao>(() =>
    typeof window === 'undefined' ? {} : entradaDaUrl(window.location.search),
  )
  // ⚠️ O parâmetro GANHA do caminho na entrada: um link antigo é `/?pagina=…`, sem caminho
  // nenhum, e mandá-lo para a conversa faria a deflexão de `RF-13` cair na tela errada. O
  // par `urlDeLeituraNoApp`/`entradaDaUrl` continua sendo o contrato.
  const [tela, setTela] = useState<Tela>(() => {
    if (entrada.pagina || entrada.termo) return { nome: 'documentacao' }
    return typeof window === 'undefined'
      ? { nome: 'conversa' }
      : telaDoCaminho(window.location.pathname)
  })
  const [eu, setEu] = useState<Identidade | null>(null)
  const [erroAuth, setErroAuth] = useState<string | null>(null)

  /**
   * Troca de tela **e** empilha a entrada. Todo caminho de navegação passa por aqui — um
   * `setTela` solto voltaria a deixar a URL mentindo sobre onde a pessoa está, que é
   * exatamente o estado que este PR desfaz.
   */
  function navegar(destino: Tela) {
    setTela(destino)
    irPara(caminhoDaTela(destino))
  }

  /**
   * Quem chega em `/` passa a ver `/chat` — pedido do mantenedor ("tudo tem que ser
   * paginado").
   *
   * 🚨 **`substituir`, nunca `empilhar`.** Empilhar aqui poria duas entradas na mesma tela na
   * abertura, e o primeiro ← da sessão pareceria travado: voltaria de `/chat` para `/`, que é
   * a mesma tela, e só o segundo sairia do app.
   *
   * ⚠️ **Só quando o destino é a conversa E não há deep link de documentação.** Um link
   * antigo (`/?pagina=X`, escrito por `urlDeLeituraNoApp` antes do `D-65`) abre a
   * Documentação, e reescrever para `/chat` ali apagaria o parâmetro **e** contradiria a tela
   * que está aberta — a URL passaria a mentir, que é exatamente o defeito que `D-65` desfez.
   */
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (tela.nome !== 'conversa') return
    if (entrada.pagina || entrada.termo) return
    if (window.location.pathname === CAMINHO_CONVERSA) return
    irPara(CAMINHO_CONVERSA, 'substituir')
    // Só na abertura: depois disso quem escreve a URL é `navegar`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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

  /**
   * O ← do navegador. Sem este ouvinte o `pushState` só enfeitaria a barra de endereço: a
   * URL voltaria e a tela ficaria onde estava — pior que não ter histórico, porque as duas
   * passariam a discordar.
   *
   * ⚠️ A aba Documentação se remonta pela `key`, e é de propósito: ela guarda página aberta,
   * busca e termo em estado próprio, e voltar para `/documentacao?pagina=X` tem de reabrir
   * `X`. Remontar é o mesmo mecanismo de `D-46` — uma sequência de `setState` funcionaria
   * hoje e esqueceria um campo no próximo estado que a tela ganhar.
   */
  const [entradaAtual, setEntradaAtual] = useState<EntradaDocumentacao>(entrada)
  const [geracao, setGeracao] = useState(0)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const aoVoltar = () => {
      const doCaminho = telaDoCaminho(window.location.pathname)
      const daQuery = entradaDaUrl(window.location.search)
      setEntradaAtual(daQuery)
      setGeracao((g) => g + 1)
      setTela(daQuery.pagina || daQuery.termo ? { nome: 'documentacao' } : doCaminho)
    }
    window.addEventListener('popstate', aoVoltar)
    return () => window.removeEventListener('popstate', aoVoltar)
  }, [])

  return (
    <div className="app">
      <header className="cabecalho">
        {/*
          ⚠️ **O acento marca a INICIAL, e isso não é o mesmo split de antes.** Até
          19/08/2026 a marca era `go` em branco + `atlas` em lime, e o corte separava o
          prefixo da família GoGroup do nome do app. Sem o `go`, esse corte não diz mais
          nada — e `atlas` todo em lime contraria a identidade (§1 regra 3: lime é acento
          pontual, ~10% da página, "mais poderoso quando escasso"). O `a` é a mesma letra
          que o favicon recorta dentro do balão, então as duas marcas passam a apontar
          para o mesmo lugar em vez de cada uma inventar o seu destaque.
        */}
        <span className="marca">
          <span>a</span>tlas
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
                    onClick={() => navegar({ nome: a.nome } as Tela)}
                  >
                    {a.rotulo}
                  </button>
                ))}
              </nav>
            )}

            {/* ⚠️ `eu &&` pelo mesmo motivo do formulário: sem identidade não há com que
                preencher os campos do solicitante (`RF-21`). */}
            {tela.nome === 'conversa' && eu && (
              <TelaConversa eu={eu} aoAbrirChamado={() => navegar({ nome: 'chamados' })} />
            )}
            {tela.nome === 'documentacao' && (
              <TelaDocumentacao
                key={geracao}
                inicial={entradaAtual}
                aoConversar={() => navegar({ nome: 'conversa' })}
              />
            )}
            {tela.nome === 'chamados' && (
              <TelaMeusChamados
                aoAbrirDetalhe={(issueKey) => navegar({ nome: 'detalhe', issueKey })}
                aoConversar={() => navegar({ nome: 'conversa' })}
              />
            )}
            {/* ⚠️ `eu &&` não é defensividade à toa: sem identidade o formulário não teria
                com que preencher os campos do solicitante (`RF-21`), e renderizá-lo com
                string vazia gravaria campo obrigatório em branco no chamado. Enquanto a
                identidade carrega, a aba fica sem conteúdo — que é o mesmo instante em que
                a tela inteira ainda não sabe quem é a pessoa. */}
            {tela.nome === 'formulario' && eu && (
              <TelaFormulario eu={eu} aoAbrirChamado={() => navegar({ nome: 'chamados' })} />
            )}
            {tela.nome === 'admin' && <TelaAdmin />}
            {/* Esconder no cliente é conveniência; quem garante é o gate de cada rota
                `/api/investigador/*` no servidor. */}
            {tela.nome === 'investigador' && (
              /*
                ⚠️ A sessão aberta vive na URL (`FR-29`), e por isso a tela **remonta** pela
                `key` quando ela muda — mesmo mecanismo da Documentação, e pelo mesmo motivo
                de `D-46`: uma sequência de `setState` funcionaria hoje e esqueceria um campo
                no próximo estado que a tela ganhar.
              */
              <TelaInvestigador
                key={tela.conversaId ?? 'lista'}
                sessaoAberta={tela.conversaId ?? null}
                aoAbrirSessao={(id) =>
                  navegar(id === null ? { nome: 'investigador' } : { nome: 'investigador', conversaId: id })
                }
              />
            )}
            {tela.nome === 'detalhe' && (
              <TelaDetalhe
                issueKey={tela.issueKey}
                aoVoltar={() => navegar({ nome: 'chamados' })}
              />
            )}
          </>
        )}
      </main>
    </div>
  )
}
