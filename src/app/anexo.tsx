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

import { useEffect, useRef, useState, type ReactElement } from 'react'
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
  /**
   * `blob:` do arquivo que ESTA aba enviou — spec 007, `FR-11` (achado `F1` do `/analyze`).
   *
   * ⚠️ Antes de o chamado existir **não há rota** que sirva o anexo (`urlDoAnexoNoApp` exige
   * `issueKey` + vínculo), e o servidor não guarda os bytes (`D-26`). Então a pré-visualização
   * na conversa só é possível a partir do `File` local. Recarregar a página perde o blob, e aí
   * o item deixa de ser clicável — nunca uma janela vazia (`FR-12`).
   */
  readonly url?: string
  readonly tipo?: string
}

/**
 * Os arquivos de um `paste` — `D-62`.
 *
 * 🚨 **`files` NÃO é a única fonte, e era a única lida.** Dependendo de como a imagem
 * entrou no clipboard (ferramenta de captura do Windows, "copiar imagem" de uma página,
 * arquivo copiado do Explorer), o Chrome expõe o mesmo print em `items[]` com
 * `kind === 'file'` e **`files` vazio**. Ler só `files` fazia o Ctrl+V não colar nada, sem
 * erro nenhum na tela — o relato que abriu o `D-62`.
 *
 * ⚠️ **Uma fonte OU a outra, nunca as duas:** quando as duas estão preenchidas elas
 * descrevem o mesmo arquivo, e somar produziria o anexo em dobro — que não tem caminho de
 * volta (`RF-63`).
 *
 * ⚠️ Só arquivo. Colar **texto** continua colando texto: interceptar todo `paste` para
 * checar arquivo é o defeito oposto, e pior, porque atinge quem só quer escrever.
 */
export function arquivosDoColar(dados: DataTransfer | null | undefined): readonly File[] {
  if (!dados) return []
  const doFiles = Array.from(dados.files ?? [])
  if (doFiles.length > 0) return doFiles
  const dosItens: File[] = []
  for (const item of Array.from(dados.items ?? [])) {
    if (item.kind !== 'file') continue
    const arquivo = item.getAsFile()
    if (arquivo) dosItens.push(arquivo)
  }
  return dosItens
}

/**
 * Um nome que não colide com o que já subiu — `D-62`.
 *
 * 🚨 **Todo print colado do clipboard chega como `image.png`.** A lista de envios era
 * indexada por **nome**, então o segundo print substituía a linha do primeiro: a tela ficava
 * idêntica e a leitura natural era *"não inseriu nada"* — enquanto o arquivo **subia**. Dois
 * anexos, uma linha; o pior par possível num app que existe para a evidência chegar.
 *
 * O sufixo é ` (2)`, antes da extensão, como o navegador faz na pasta de downloads — e o
 * nome novo é o que vai ao Jira, onde três `image.png` também seriam indistinguíveis.
 */
export function nomeUnicoDeAnexo(nome: string, jaUsados: readonly string[]): string {
  if (!jaUsados.includes(nome)) return nome
  const ponto = nome.lastIndexOf('.')
  const base = ponto > 0 ? nome.slice(0, ponto) : nome
  const extensao = ponto > 0 ? nome.slice(ponto) : ''
  for (let n = 2; n < 100; n++) {
    const tentativa = `${base} (${n})${extensao}`
    if (!jaUsados.includes(tentativa)) return tentativa
  }
  // Teto para não girar: 99 arquivos com o mesmo nome não é caso de uso, e o teto de
  // `MAX_ANEXOS_POR_CHAMADO` recusa muito antes.
  return `${base} (${jaUsados.length + 1})${extensao}`
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

/**
 * A pergunta de `RF-62`/`RN-11` — e o que fazer quando ela já foi respondida por ato.
 *
 * 🚨 **Arquivo já enviado NÃO é perguntado de novo** (`D-70`). Relato de 13/08/2026: a
 * pessoa colou dois prints na conversa e o cartão perguntou se ela tinha material para
 * anexar, *"como se eu já não tivesse enviado duas"* — e a nota dizia *"Até 3 arquivos"*,
 * com dois já gastos e nenhum na tela. Duas causas somadas:
 *
 * 1. `faltaDeclararAnexo` olhava só `declarou === null` (`telas.tsx`), nunca o que subiu;
 * 2. `envios` é estado **local** deste componente, e nasce vazio — o anexo do `D-59` entra
 *    pelo compositor, num componente irmão, e recarregar a página zera até o do cartão.
 *
 * Quem sabe é o servidor: `GET /api/conversas/:id/anexos` (nome, nunca o
 * `temporaryAttachmentId` — `RF-30`). Com a lista em mão a pergunta desaparece e sobra o
 * que a pessoa precisa: **o que já foi**, e **quantos ainda cabem**.
 *
 * ⚠️ O teto vem de fora (`MAX_ANEXOS_POR_CHAMADO`): um `3` escrito na frase divergiria do
 * servidor no dia em que o teto mudasse, e a recusa em cima da hora é o pior lugar para
 * descobrir isso (`SC-08`).
 */
export function PerguntaDeAnexo({
  alvo,
  declarou,
  aoDeclarar,
  jaEnviados = [],
  teto,
}: {
  alvo: AlvoDoAnexo
  declarou: Declaracao
  aoDeclarar: (valor: boolean) => void
  /** `D-70` — nomes que o SERVIDOR já tem para esta chave. Vazio = nada enviado ainda. */
  jaEnviados?: readonly string[]
  teto: number
}) {
  const [envios, setEnvios] = useState<readonly Envio[]>([])
  const entrada = useRef<HTMLInputElement>(null)

  /** Tudo o que conta para o teto: o que o servidor já tem mais o que subiu nesta tela. */
  const nomesOcupados = [
    ...jaEnviados,
    ...envios.filter((e) => e.estado !== 'falhou').map((e) => e.nome),
  ]
  const cabem = Math.max(0, teto - nomesOcupados.length)
  /** `D-70` — já anexou: a pergunta foi respondida pelo ato, e o servidor concorda. */
  const jaRespondeuAnexando = jaEnviados.length > 0

  async function enviar(recebidos: readonly File[]) {
    // O teto é do servidor também (`SC-08`); aqui ele existe para a recusa não custar uma
    // ida de rede — e a mensagem dele continua sendo a que vale.
    const arquivos = recebidos.slice(0, cabem)
    // `D-62` — dois prints se chamam `image.png` os dois. Sem o sufixo ANTES de subir, o
    // segundo ocupa a linha do primeiro na lista e parece não ter acontecido, apesar de
    // existir no chamado. ⚠️ Aqui a comparação inclui o que veio do servidor: o print
    // colado na conversa já gastou o nome.
    const usados = [...nomesOcupados]
    for (const original of arquivos) {
      const nome = nomeUnicoDeAnexo(original.name, usados)
      usados.push(nome)
      const arquivo =
        nome === original.name ? original : new File([original], nome, { type: original.type })
      setEnvios((atuais) => [
        ...atuais.filter((e) => e.nome !== nome),
        { nome, estado: 'enviando' },
      ])
      try {
        await api.anexarAntesDoChamado(alvo, arquivo)
        setEnvios((atuais) =>
          atuais.map((e) => (e.nome === nome ? { nome: e.nome, estado: 'enviado' } : e)),
        )
      } catch (erro) {
        // A mensagem do servidor aparece inteira: ela é que diz se foi tamanho, teto de
        // arquivos ou indisponibilidade — e as três pedem ações diferentes da pessoa.
        const motivo =
          erro instanceof ErroApi ? erro.message : 'Não consegui enviar agora. Tente de novo.'
        setEnvios((atuais) =>
          atuais.map((e) => (e.nome === nome ? { nome: e.nome, estado: 'falhou', motivo } : e)),
        )
      }
    }
    // Sem isto, escolher o mesmo arquivo depois de uma falha não dispara `change`.
    if (entrada.current) entrada.current.value = ''
  }

  /**
   * `D-70` — sem pergunta, porque ela já foi respondida.
   *
   * ⚠️ Continua sendo `fieldset`/`legend`: é ele que nomeia o grupo para leitor de tela, e
   * o bloco segue sendo "a evidência deste chamado". Sem os rádios não há o que declarar.
   */
  if (jaRespondeuAnexando) {
    /**
     * 🚨 **UMA lista, sempre desenhada — e o contador conta as duas origens** (`D-70`,
     * medido no navegador em 13/08).
     *
     * A primeira versão tinha duas listas: `jaEnviados` fora, e os envios desta tela
     * **dentro** de `{cabem > 0 && …}`. Anexar o terceiro arquivo zerava `cabem`, o bloco
     * inteiro desaparecia — e com ele a linha do arquivo que **acabara de subir**. Título
     * dizendo "2 arquivos", lista com 2, frase dizendo "este é o limite de 3": a evidência
     * no chamado e nenhuma na tela, que é exatamente o defeito de `D-62` outra vez.
     *
     * O contador é `nomesOcupados`, não `jaEnviados`: contar só o servidor deixaria o
     * título discordando da lista logo abaixo dele.
     */
    const linhas: readonly Envio[] = [
      ...jaEnviados.map((nome) => ({ nome, estado: 'enviado' as const })),
      ...envios,
    ]
    return (
      <fieldset className="pergunta-anexo">
        <legend>
          <span className="eyebrow">Evidência</span>
          <span className="pergunta-anexo-titulo">
            {nomesOcupados.length === 1
              ? 'Você já anexou 1 arquivo'
              : `Você já anexou ${nomesOcupados.length} arquivos`}
          </span>
        </legend>

        <ul className="lista-envios" aria-live="polite">
          {linhas.map((e) => (
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

        <p className="dica">
          {cabem > 0
            ? `Vão junto com o chamado. Ainda cabem ${cabem} de ${teto} — anexe abaixo se faltar algo.`
            : `Vão junto com o chamado. Este é o limite de ${teto} arquivos.`}
        </p>

        {cabem > 0 && (
          <div className="zona-anexo">
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
                Anexar outro arquivo
              </label>
            </div>
          </div>
        )}
      </fieldset>
    )
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
              Até {teto} arquivos, de 8 MB cada. Sobem na hora que você escolhe.
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
  aoVerArquivo,
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
  /** Abre a visualização rápida do arquivo local — spec 007, `FR-11`. */
  aoVerArquivo?: (anexo: { nome: string; tipo: string | null; url: string; local: true }) => void
}): { readonly enviar: (arquivos: readonly File[]) => Promise<void>; readonly elemento: ReactElement } {
  const [envios, setEnvios] = useState<readonly Envio[]>([])
  const entrada = useRef<HTMLInputElement>(null)
  // ⚠️ `revokeObjectURL` ao desmontar: sem isto cada print colado vaza memória na aba. O
  // `ref` guarda as URLs porque o cleanup não vê o estado atual.
  const urlsVivas = useRef<string[]>([])
  useEffect(
    () => () => {
      for (const url of urlsVivas.current) URL.revokeObjectURL(url)
      urlsVivas.current = []
    },
    [],
  )

  const enviados = envios.filter((e) => e.estado !== 'falhou').length
  const cheio = enviados >= maximo

  async function enviar(recebidos: readonly File[]) {
    // O teto é do servidor também (`SC-08`); aqui ele existe para a recusa não custar
    // uma ida de rede — e a mensagem dele continua sendo a que vale.
    const naFila = recebidos.slice(0, Math.max(0, maximo - enviados))
    if (naFila.length === 0) return
    // `D-62` — nome que já está na lista ganha sufixo ANTES de subir. Sem isto, dois
    // prints colados (os dois `image.png`) ocupam a mesma linha e o segundo parece não
    // ter acontecido, apesar de existir no chamado.
    const usados = envios.map((e) => e.nome)
    const cabem = naFila.map((arquivo) => {
      const nome = nomeUnicoDeAnexo(arquivo.name, usados)
      usados.push(nome)
      // ⚠️ Renomear é criar um `File` novo: `name` é somente-leitura. O tipo e o conteúdo
      // são os mesmos — é só o rótulo que a pessoa e o time de tech vão ler.
      return nome === arquivo.name ? arquivo : new File([arquivo], nome, { type: arquivo.type })
    })

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
        // A URL local nasce só no sucesso: oferecer pré-visualização de arquivo que não subiu
        // diria que ele está no chamado.
        const url = URL.createObjectURL(arquivo)
        urlsVivas.current.push(url)
        setEnvios((atuais) =>
          atuais.map((e) =>
            e.nome === arquivo.name
              ? { nome: e.nome, estado: 'enviado', url, tipo: arquivo.type }
              : e,
          ),
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

        {/* `D-62` — o Ctrl+V é o caminho mais usado (print nasce no clipboard) e era
            **invisível**: quem não soubesse do atalho só tinha o clipe. A frase diz os dois,
            e diz o teto, porque a recusa em cima da hora é pior que o número anunciado. */}
        {!cheio && (
          /*
           * ⚠️ **Uma linha, e curta** (`D-68`). A frase original tinha três linhas e explicava
           * o Ctrl+V com calma — certo enquanto o compositor rolava com a conversa, e caro
           * depois de ele virar fixo: medido em 13/08, o compositor ocupava **39% da tela**, e
           * 49px eram só desta dica. O atalho continua dito; o que saiu foi a explicação.
           */
          <span className="dica dica-anexo">
            ou cole com <kbd>Ctrl</kbd>+<kbd>V</kbd> · até {maximo} arquivos
          </span>
        )}

        {envios.length > 0 && (
          <ul className="anexo-conversa-lista">
            {envios.map((e) => (
              <li key={e.nome} className={`envio envio-${e.estado}`}>
                <span className="envio-estado">
                  <span aria-hidden="true">{ROTULOS_ENVIO[e.estado].simbolo}</span>{' '}
                  {ROTULOS_ENVIO[e.estado].palavra}
                </span>
                {/* `FR-11`/`FR-12` — clicável **só** quando esta aba tem o arquivo. Sem o
                    blob (página recarregada), fica texto: nunca uma janela vazia. */}
                {e.url && aoVerArquivo ? (
                  <button
                    type="button"
                    className="envio-nome envio-nome-clicavel"
                    onClick={() => aoVerArquivo({ nome: e.nome, tipo: e.tipo ?? null, url: e.url!, local: true })}
                  >
                    {e.nome}
                  </button>
                ) : (
                  <span className="envio-nome">{e.nome}</span>
                )}
                {e.motivo && <span className="dica">{e.motivo}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
    ),
  }
}
