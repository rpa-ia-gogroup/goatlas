/**
 * A pergunta do anexo, e o envio — `RF-61`, `RF-62`, `RF-63`, `RN-11`.
 *
 * ## Um componente, duas superfícies
 *
 * A mesma pergunta aparece no formulário direto (`D-04`) e no recibo da conversa. Escrever
 * duas versões faria as duas divergirem na primeira mudança de copy — e a copy aqui **é**
 * o requisito: a opção negativa se chama "não tenho material para anexar", nunca "pular",
 * porque "pular" diz que anexar era o dever e que a pessoa está deixando de fazer algo.
 * Quem legitimamente não tem print precisa de uma saída que não pareça desistência.
 *
 * ## O que a tela trava, e o que ela não trava
 *
 * Trava **responder** (`SC-01`): sem resposta, o botão de abrir não fica disponível. Não
 * trava **anexar** (`SC-03`, `RN-11`): quem diz "tenho", desiste e volta para "não tenho"
 * abre o chamado. Esta é a camada 1 de duas — a camada 2 está no servidor
 * (`tickets/declaracao-anexo.ts`), e ela sozinha basta para a garantia. Esta existe para a
 * pessoa não descobrir a regra levando um erro.
 *
 * ## O estado do envio nunca é só cor (`RNF-28`)
 *
 * Cada arquivo mostra **símbolo + palavra** antes do nome — "✓ Enviado", "… Enviando",
 * "! Não subiu". A palavra vem primeiro de propósito: a coluna passa a se ler como uma
 * lista de resultados, não de nomes de arquivo. Toda esta feature existe para que evidência
 * chegue ao time de tech; um envio que falhou parecendo um que deu certo seria o pior
 * detalhe possível de errar.
 */

import { useRef, useState, type ReactElement } from 'react'
import { api, ErroApi } from './api'

/**
 * A que chamado o arquivo pertence.
 *
 * ⚠️ O cliente manda **a chave crua** (ou o id da conversa) e nunca um identificador de
 * anexo: quem normaliza a chave e guarda o `temporaryAttachmentId` é o servidor
 * (`RF-30` aplicado a arquivo).
 */
export type AlvoDoAnexo =
  | { readonly via: 'formulario'; readonly chaveIdempotencia: string }
  | { readonly via: 'conversa'; readonly conversaId: string }

/** `null` = não respondeu. Nunca há opção pré-marcada (`SC-01`). */
export type Declaracao = boolean | null

export type EstadoEnvio = 'enviando' | 'enviado' | 'falhou'

interface Envio {
  readonly nome: string
  readonly estado: EstadoEnvio
  readonly motivo?: string
}

/**
 * Símbolo **e** palavra para cada estado — exportado para haver o que testar.
 *
 * O estado do envio só existe depois de uma interação, então nenhuma renderização estática
 * o alcança. Deixar a checagem de `RNF-28` para "olhar a tela" é o mesmo que não checar:
 * este mapa é o contrato, e o teste afirma que os três símbolos e as três palavras são
 * distintos. Reduzir qualquer um deles a cor quebra a suíte.
 */
export const ROTULOS_ENVIO: Record<
  EstadoEnvio,
  { readonly simbolo: string; readonly palavra: string }
> = {
  enviando: { simbolo: '…', palavra: 'Enviando' },
  enviado: { simbolo: '✓', palavra: 'Enviado' },
  falhou: { simbolo: '!', palavra: 'Não subiu' },
}

export function PerguntaDeAnexo({
  alvo,
  declarou,
  aoDeclarar,
}: {
  alvo: AlvoDoAnexo
  declarou: Declaracao
  aoDeclarar: (valor: boolean) => void
}) {
  const [envios, setEnvios] = useState<readonly Envio[]>([])
  const entrada = useRef<HTMLInputElement>(null)

  async function enviar(arquivos: readonly File[]) {
    for (const arquivo of arquivos) {
      setEnvios((atuais) => [
        ...atuais.filter((e) => e.nome !== arquivo.name),
        { nome: arquivo.name, estado: 'enviando' },
      ])
      try {
        await api.anexarAntesDoChamado(alvo, arquivo)
        setEnvios((atuais) =>
          atuais.map((e) => (e.nome === arquivo.name ? { nome: e.nome, estado: 'enviado' } : e)),
        )
      } catch (erro) {
        // A mensagem do servidor aparece inteira: ela é que diz se foi tamanho, teto de
        // arquivos ou indisponibilidade — e as três pedem ações diferentes da pessoa.
        const motivo =
          erro instanceof ErroApi ? erro.message : 'Não consegui enviar agora. Tente de novo.'
        setEnvios((atuais) =>
          atuais.map((e) =>
            e.nome === arquivo.name ? { nome: e.nome, estado: 'falhou', motivo } : e,
          ),
        )
      }
    }
    // Sem isto, escolher o mesmo arquivo depois de uma falha não dispara `change`.
    if (entrada.current) entrada.current.value = ''
  }

  return (
    <fieldset className="pergunta-anexo">
      <legend>
        <span className="eyebrow">Evidência</span>
        <span className="pergunta-anexo-titulo">Você tem algo para anexar?</span>
      </legend>

      <p className="dica">
        Print, planilha ou log fazem a primeira resposta chegar resolvendo, em vez de
        perguntando.
      </p>

      <div className="opcoes-cartao">
        {/* Rádio nativo de propósito: teclado, leitor de tela e foco visível vêm de graça,
            e nenhum deles vem de graça num `div` com `role="radio"`. */}
        <label className="opcao-cartao">
          <input
            type="radio"
            name="declarou-anexo"
            checked={declarou === true}
            onChange={() => aoDeclarar(true)}
          />
          <span className="opcao-cartao-texto">
            <span className="opcao-cartao-titulo">Tenho — quero anexar agora</span>
            <span className="opcao-cartao-nota">
              Até 3 arquivos, de 8 MB cada. Sobem na hora que você escolhe.
            </span>
          </span>
        </label>

        <label className="opcao-cartao">
          <input
            type="radio"
            name="declarou-anexo"
            checked={declarou === false}
            onChange={() => aoDeclarar(false)}
          />
          <span className="opcao-cartao-texto">
            <span className="opcao-cartao-titulo">Não tenho material para anexar</span>
            <span className="opcao-cartao-nota">
              Resposta legítima. O chamado abre igual, e o time sabe que não havia o que
              mandar.
            </span>
          </span>
        </label>
      </div>

      {declarou === true && (
        <div className="zona-anexo">
          {/* ⚠️ **O `input[type=file]` cru não é do app** (`D-46`). O navegador desenha
              ali um botão cinza de sistema com "Nenhum arquivo escolhido" ao lado — em
              inglês em boa parte das instalações, o que atropela a regra 4 do projeto na
              única superfície onde a pessoa está prestes a mandar a evidência do chamado.

              O padrão aqui é o clássico: o `input` continua sendo o `input` (é ele que
              recebe foco, teclado e o `change`), só sai da tela por `clip`; quem aparece
              é o `label`, que já era o nome acessível do campo e agora também é o alvo do
              clique. ⚠️ **`clip`, nunca `display: none`** — escondido de verdade, o campo
              sai da ordem de tabulação e a pergunta fica inalcançável pelo teclado.
              O anel de foco é reemitido no `label` por `:focus-visible +` (ver
              `estilos.css`): sem isso, quem navega por teclado perde o único sinal de
              onde está.

              E não se perde nada com a saída do texto nativo: o que a pessoa precisa
              saber sobre cada arquivo — nome e estado do envio — já está na lista abaixo,
              com símbolo e palavra (`RNF-28`), que é mais do que o controle dizia. */}
          <div className="escolher-arquivo">
            <input
              ref={entrada}
              id="anexo-na-criacao"
              className="entrada-arquivo"
              type="file"
              multiple
              onChange={(e) => void enviar(Array.from(e.target.files ?? []))}
            />
            <label htmlFor="anexo-na-criacao" className="botao botao-contorno rotulo-arquivo">
              Escolher arquivo
            </label>
          </div>
          <span className="dica">
            Você pode abrir o chamado mesmo sem escolher arquivo — a pergunta é que era
            obrigatória.
          </span>

          {envios.length > 0 && (
            <ul className="lista-envios" aria-live="polite">
              {envios.map((e) => (
                <li key={e.nome} className={`envio envio-${e.estado}`}>
                  <span className="envio-estado">
                    <span aria-hidden="true">{ROTULOS_ENVIO[e.estado].simbolo}</span>{' '}
                    {ROTULOS_ENVIO[e.estado].palavra}
                  </span>
                  <span className="envio-nome">{e.nome}</span>
                  {e.motivo && <span className="envio-motivo">{e.motivo}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </fieldset>
  )
}

/**
 * O que aconteceu com o anexo, depois de o chamado nascer — `RF-63`.
 *
 * ⚠️ Separado do bloco do chamado de propósito: quem abriu precisa ler "chamado aberto"
 * primeiro e "o anexo não subiu" depois, nessa ordem. Misturar os dois numa frase só
 * ("não consegui abrir com o anexo") é o que faz a pessoa abrir um segundo chamado.
 *
 * `anexado` e `sem_anexo` não rendem nada: nada aconteceu que a pessoa precise saber.
 */
export function ResultadoDoAnexo({
  anexo,
}: {
  anexo: { readonly estado: string; readonly mensagem: string; readonly anexados: readonly string[] }
}) {
  if (anexo.estado === 'sem_anexo') return null
  if (anexo.estado === 'anexado') {
    return (
      <p className="dica" aria-live="polite">
        <span aria-hidden="true">✓</span> Anexado: {anexo.anexados.join(', ')}.
      </p>
    )
  }
  // `role="status"` e não `alert`: o chamado ABRIU. Interromper o leitor de tela aqui
  // daria à falha do anexo a urgência que ela não tem.
  return (
    <p className="aviso aviso-atencao" role="status">
      <span aria-hidden="true">!</span> {anexo.mensagem}
    </p>
  )
}

/* ---------- anexo DURANTE a conversa (D-59) ------------------------------ */

/**
 * O anexo na conversa — sempre disponível, e sem ocupar a tela.
 *
 * ## O defeito que este componente conserta
 *
 * Relatado por uma pessoa usando o app de verdade: **o agente pediu um print e não havia
 * onde anexar**. Estava certa — o único controle de anexo vivia dentro do cartão de
 * confirmação, que só existe depois das duas verificações e da proposta montada. Quem lia
 * "manda o print" no meio da conversa procurava um clipe e não achava nada.
 *
 * E havia uma segunda metade: em **4 dos 15** tipos do `GN` (93, 108, 143, 144) o cartão
 * condiciona a pergunta a `aceitaAnexo`, então o controle **nunca** aparecia. ⚠️ Pior:
 * `aceitaAnexo` mede se o **formulário do request type** expõe um campo de anexo, **não**
 * se o chamado aceita arquivo. O `GN-6903` é do tipo 144 e tem a transcrição de `D-54`
 * anexada — prova de que anexar funciona ali. O app era mais restritivo que a Atlassian.
 *
 * Este controle **não** consulta `aceitaAnexo`, de propósito: o caminho de upload
 * (`attachTemporaryFile` + materialização) não depende do campo do formulário.
 *
 * ## Três formas de entregar o arquivo, uma só de subir
 *
 * Clicar no clipe, **soltar** em qualquer lugar da conversa e **colar** (`Ctrl+V`) chamam
 * a mesma função. Colar é o que mais importa: "print da tela" quase sempre nasce no
 * clipboard, e obrigar a pessoa a salvar em disco antes é a fricção que faz a evidência
 * não chegar — que é o problema inteiro que `RF-61` existe para resolver.
 *
 * ## O que ele NÃO faz
 *
 * Não pergunta nada. A pergunta de `RF-62` continua no cartão, com a copy de `RN-11`, e
 * este componente não a substitui — ele é o **meio**, ela é a **decisão**. E o agente
 * deixou de pedir arquivo no prompt (`D-59`): pedir o que a tela não oferece foi
 * exatamente o defeito.
 *
 * ⚠️ **É hook, e o nome diz isso.** Ele devolve `elemento` **e** `enviar`, porque quem
 * solta o arquivo (a área da conversa) e quem o cola (a caixa de mensagem) não são este
 * componente — e um `ref` para disparar o input escondido daria o mesmo resultado por um
 * caminho que ninguém entende ao ler. Chamado de `TelaConversa`, que é quem tem as três
 * superfícies na mão.
 *
 * _Requirements: RF-61, RF-63, RN-11, RNF-02, RNF-28_
 */
export function useAnexoNaConversa({
  garantirConversa,
  maximo,
}: {
  /**
   * 🚨 **Resolve o id, e CRIA a conversa se ela ainda não existir.**
   *
   * O clipe recebia `conversaId: string` e a tela o escondia enquanto fosse `null` — ou
   * seja, ele **não aparecia antes da primeira mensagem**, exatamente contra o pedido
   * ("um campo sempre presente"). E o caso escondido era o mais natural de todos: abrir o
   * app com o print já no clipboard e colar antes de escrever qualquer coisa.
   *
   * A conversa nasce sob demanda (`api.iniciarConversa`), do mesmo jeito que nasce ao
   * enviar a primeira mensagem — e a promessa é **memoizada por quem chama**, senão dois
   * arquivos soltos juntos criariam duas conversas e o segundo anexo iria para uma que
   * ninguém vê.
   */
  garantirConversa: () => Promise<string>
  maximo: number
}): { readonly enviar: (arquivos: readonly File[]) => Promise<void>; readonly elemento: ReactElement } {
  const [envios, setEnvios] = useState<readonly Envio[]>([])
  const entrada = useRef<HTMLInputElement>(null)

  const enviados = envios.filter((e) => e.estado !== 'falhou').length
  const cheio = enviados >= maximo

  async function enviar(arquivos: readonly File[]) {
    // O teto é do servidor também (`SC-08`); aqui ele existe para a recusa não custar
    // uma ida de rede — e a mensagem dele continua sendo a que vale.
    const cabem = arquivos.slice(0, Math.max(0, maximo - enviados))
    if (cabem.length === 0) return

    let conversaId: string
    try {
      conversaId = await garantirConversa()
    } catch {
      // Sem conversa não há onde pendurar o arquivo. A falha é por arquivo, com a mesma
      // forma das outras: nada some calado.
      setEnvios((atuais) => [
        ...atuais.filter((e) => !cabem.some((a) => a.name === e.nome)),
        ...cabem.map((a) => ({
          nome: a.name,
          estado: 'falhou' as const,
          motivo: 'Não consegui iniciar a conversa para anexar. Tente de novo.',
        })),
      ])
      return
    }

    for (const arquivo of cabem) {
      setEnvios((atuais) => [
        ...atuais.filter((e) => e.nome !== arquivo.name),
        { nome: arquivo.name, estado: 'enviando' },
      ])
      try {
        await api.anexarAntesDoChamado({ via: 'conversa', conversaId }, arquivo)
        setEnvios((atuais) =>
          atuais.map((e) => (e.nome === arquivo.name ? { nome: e.nome, estado: 'enviado' } : e)),
        )
      } catch (erro) {
        const motivo =
          erro instanceof ErroApi ? erro.message : 'Não consegui enviar agora. Tente de novo.'
        setEnvios((atuais) =>
          atuais.map((e) =>
            e.nome === arquivo.name ? { nome: e.nome, estado: 'falhou', motivo } : e,
          ),
        )
      }
    }
    if (entrada.current) entrada.current.value = ''
  }

  return {
    enviar,
    elemento: (
      <div className="anexo-conversa">
        {/* ⚠️ O input sai da tela por `clip`, **nunca** `display:none` — que o tiraria da
            ordem de tabulação e deixaria o anexo inalcançável pelo teclado (`D-46`). O anel
            de foco é reemitido no `label`, que já é o nome acessível. */}
        <input
          ref={entrada}
          id="anexo-conversa"
          className="entrada-arquivo"
          type="file"
          multiple
          disabled={cheio}
          onChange={(e) => {
            const arquivos = Array.from(e.target.files ?? [])
            if (arquivos.length > 0) void enviar(arquivos)
          }}
        />
        <label
          className="rotulo-arquivo rotulo-clipe"
          htmlFor="anexo-conversa"
          aria-disabled={cheio || undefined}
        >
          {/* Símbolo **e** palavra: o clipe sozinho é ícone sem nome acessível. */}
          <span aria-hidden="true">📎</span>
          {cheio ? `Máximo de ${maximo} arquivos` : 'Anexar arquivo'}
        </label>

        {envios.length > 0 && (
          <ul className="anexo-conversa-lista">
            {envios.map((e) => (
              <li key={e.nome} className={`envio envio-${e.estado}`}>
                <span className="envio-estado">
                  <span aria-hidden="true">{ROTULOS_ENVIO[e.estado].simbolo}</span>{' '}
                  {ROTULOS_ENVIO[e.estado].palavra}
                </span>
                <span className="envio-nome">{e.nome}</span>
                {e.motivo && <span className="dica">{e.motivo}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
    ),
  }
}
