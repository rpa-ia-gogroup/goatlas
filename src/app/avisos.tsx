/**
 * Tela "Avisos" — RF-44, RF-45, T-224.
 *
 * ## O que esta tela precisa dizer, e quase nenhuma tela de notificação diz
 *
 * Existem **dois** jeitos de não receber aviso, e eles são de pessoas diferentes:
 *
 * 1. **"Eu escolhi não receber."** Decisão de quem está lendo.
 * 2. **"Ninguém definiu por onde avisar ainda."** Decisão que falta ser tomada por
 *    outra pessoa (Q11, com o time de tech) — e nesse caso o aviso *existe*, ficou
 *    guardado, e a pessoa não perdeu nada além de não ter sido avisada na hora.
 *
 * Uma tela que mostrasse só "notificações: desativadas" achataria os dois. A primeira
 * frase da página é o que distingue.
 *
 * A lista abaixo mostra os avisos que **existiram**, com o estado real de cada um —
 * inclusive os suprimidos. Esconder os suprimidos deixaria a tela mais limpa e mentiria:
 * o fato aconteceu, o aviso não saiu, e a pessoa merece poder ver isso.
 */

import { useEffect, useState } from 'react'
import {
  api,
  ErroApi,
  type AvisoRecebido,
  type CanalNotificacao,
  type Preferencia,
  type TipoEventoNotificacao,
} from './api'
import { Aviso, Selo, Vazio } from './componentes'

const OPCOES: readonly {
  valor: CanalNotificacao
  titulo: string
  nota: string
}[] = [
  {
    valor: 'chat',
    titulo: 'Google Chat',
    nota: 'O aviso chega no chat, com o número do chamado e o link para abrir aqui.',
  },
  {
    valor: 'email',
    titulo: 'E-mail',
    nota: 'Vai para o seu e-mail corporativo. Você pode indicar outro endereço abaixo.',
  },
  {
    valor: 'nenhum',
    titulo: 'Não quero receber aviso',
    nota: 'Seus chamados continuam nesta aba, com status e respostas — só não te avisamos.',
  },
]

const ROTULO_EVENTO: Readonly<Record<TipoEventoNotificacao, string>> = {
  chamado_criado: 'Chamado aberto',
  status_alterado: 'Status mudou',
  comentario_publico: 'Nova resposta',
  sla_em_risco: 'Prazo de primeira resposta',
}

export function TelaAvisos() {
  const [preferencia, setPreferencia] = useState<Preferencia | null>(null)
  const [canal, setCanal] = useState<CanalNotificacao>('nenhum')
  const [destino, setDestino] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [salvo, setSalvo] = useState(false)
  const [avisos, setAvisos] = useState<readonly AvisoRecebido[] | null>(null)

  useEffect(() => {
    api
      .preferencia()
      .then((p) => {
        setPreferencia(p)
        setCanal(p.canal)
        setDestino(p.destino ?? '')
      })
      .catch((e) =>
        setErro(e instanceof ErroApi ? e.message : 'Não conseguimos carregar sua preferência.'),
      )
    // A lista de avisos não bloqueia a preferência: são coisas independentes, e uma
    // falha numa não pode deixar a outra sem tela.
    api
      .meusAvisos()
      .then((r) => setAvisos(r.itens))
      .catch(() => setAvisos([]))
  }, [])

  async function salvar() {
    setSalvando(true)
    setErro(null)
    setSalvo(false)
    try {
      const limpo = destino.trim()
      const r = await api.salvarPreferencia(canal, canal === 'email' && limpo ? limpo : null)
      setPreferencia((p) =>
        p ? { ...p, canal: r.canal, destino: r.destino, escolhidaPelaPessoa: true } : p,
      )
      setSalvo(true)
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : 'Não conseguimos salvar sua preferência.')
    } finally {
      setSalvando(false)
    }
  }

  if (erro && !preferencia) return <Aviso atencao>{erro}</Aviso>
  if (!preferencia) return <p className="carregando">Carregando suas preferências…</p>

  const mudou =
    canal !== preferencia.canal || (destino.trim() || null) !== (preferencia.destino ?? null)

  return (
    <div className="pilha">
      <div>
        <span className="eyebrow">Avisos</span>
        <h1 className="titulo-secao">Como você quer ser avisado</h1>
      </div>

      {/* ⚠️ A frase muda conforme QUEM ainda não decidiu. É a única coisa nesta tela que
          não pode ser genérica: as duas situações mostram "nenhum" e são diferentes. */}
      {!preferencia.canalPadraoDefinido && !preferencia.escolhidaPelaPessoa ? (
        <Aviso atencao>
          O canal de aviso ainda não foi definido nesta instalação. Seus chamados
          continuam aparecendo em <strong>Meus chamados</strong>, com status e respostas —
          e os avisos ficam guardados aqui até alguém escolher por onde enviá-los.
        </Aviso>
      ) : (
        <Aviso>
          Avisamos quando o chamado é aberto, quando o status muda e quando alguém do time
          responde publicamente. Você <strong>não</strong> recebe aviso do que você mesmo
          fez.
        </Aviso>
      )}

      {salvo && <Aviso>Preferência salva.</Aviso>}
      {erro && <Aviso atencao>{erro}</Aviso>}

      <fieldset className="opcoes-canal" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="sr-apenas">Canal de aviso</legend>
        {OPCOES.map((o) => (
          <label className="opcao-canal" key={o.valor}>
            <input
              type="radio"
              name="canal"
              value={o.valor}
              checked={canal === o.valor}
              onChange={() => setCanal(o.valor)}
            />
            <span className="opcao-canal-texto">
              <span className="opcao-canal-titulo">{o.titulo}</span>
              <span className="opcao-canal-nota">{o.nota}</span>
            </span>
          </label>
        ))}
      </fieldset>

      {canal === 'email' && (
        <div className="campo">
          <label htmlFor="destino-email">Outro endereço de e-mail (opcional)</label>
          <input
            id="destino-email"
            type="email"
            value={destino}
            onChange={(e) => setDestino(e.target.value)}
            placeholder="voce@gocase.com"
          />
          <span className="dica">
            Deixe vazio para usar o e-mail com que você entrou. Só endereço de e-mail — não
            aceitamos webhook ou URL aqui.
          </span>
        </div>
      )}

      {mudou && (
        <div className="acoes">
          <button
            type="button"
            className="botao botao-primario"
            onClick={() => void salvar()}
            disabled={salvando}
          >
            {salvando ? 'Salvando…' : 'Salvar preferência'}
          </button>
          <button
            type="button"
            className="botao botao-discreto"
            onClick={() => {
              setCanal(preferencia.canal)
              setDestino(preferencia.destino ?? '')
            }}
          >
            Desfazer
          </button>
        </div>
      )}

      <h2 className="titulo-secao" style={{ fontSize: 'var(--fs-h3)' }}>
        Avisos dos seus chamados
      </h2>

      {avisos === null ? (
        <p className="carregando">Carregando seus avisos…</p>
      ) : avisos.length === 0 ? (
        <Vazio
          titulo="Nenhum aviso ainda"
          texto="Quando algo acontecer nos seus chamados, o registro aparece aqui — mesmo que o envio não tenha saído."
        />
      ) : (
        <ul className="chamados">
          {avisos.map((a, i) => (
            <li key={`${a.issueKey}-${a.tipoEvento}-${i}`} className="chamado" style={{ cursor: 'default' }}>
              <span className="chamado-topo">
                <span className="chamado-chave">{a.issueKey}</span>
                <Selo variante={a.estado === 'enviada' ? 'lime' : 'contorno'}>
                  {rotuloEstado(a.estado)}
                </Selo>
              </span>
              <span className="chamado-titulo">{a.titulo}</span>
              <span className="chamado-meta">
                <Selo variante="contorno">{ROTULO_EVENTO[a.tipoEvento]}</Selo>
                <span className="dica">{a.criadoEm}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * O estado, em palavras de quem lê.
 *
 * `suprimida` cobre dois casos e a frase escolhida vale para os dois: aviso da própria
 * ação da pessoa (`RF-48`) e aviso sem canal definido (Q11). Nos dois, o que importa para
 * ela é a mesma coisa — o fato foi registrado e nada foi enviado.
 */
function rotuloEstado(estado: AvisoRecebido['estado']): string {
  if (estado === 'enviada') return 'Enviado'
  if (estado === 'pendente') return 'Na fila'
  if (estado === 'falha') return 'Não conseguimos enviar'
  return 'Não enviado'
}
