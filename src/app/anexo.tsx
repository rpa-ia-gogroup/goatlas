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

import { useRef, useState } from 'react'
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

export const AVISO_DECLARACAO_PENDENTE =
  'Responda acima se você tem algo para anexar. É a única coisa que falta.'

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
          <label htmlFor="anexo-na-criacao">Escolher arquivo</label>
          <input
            ref={entrada}
            id="anexo-na-criacao"
            type="file"
            multiple
            onChange={(e) => void enviar(Array.from(e.target.files ?? []))}
          />
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
