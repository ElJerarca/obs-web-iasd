/**
 * Gestor de conexión: conecta, detecta caídas y reconecta automáticamente
 * con espera exponencial (1 s, 2 s, 4 s… hasta 15 s).
 *
 * Emite:
 *   'state' -> detail { state, error?, attempt?, retryAt? }
 *              state: 'connecting' | 'connected' | 'reconnecting' | 'failed' | 'idle'
 *   'ready' -> cada vez que la sesión queda identificada (al inicio y tras
 *              cada reconexión); la interfaz debe volver a sincronizarse.
 */

const MAX_DELAY_MS = 15000

export class ConnectionManager extends EventTarget {
  #client
  #options
  #state = 'idle'
  #attempt = 0
  #timer = null
  #stopped = true

  constructor (client, options) {
    super()
    this.#client = client
    this.#options = options
    client.addEventListener('close', (e) => {
      const { intentional, error } = e.detail
      if (intentional || this.#stopped) return
      this.#handleFailure(error)
    })
    // Si vuelve la red, no esperar al siguiente intento programado
    window.addEventListener('online', () => {
      if (this.#state === 'reconnecting') this.retryNow()
    })
  }

  get state () { return this.#state }

  start () {
    this.#stopped = false
    this.#attempt = 0
    this.#connect()
  }

  stop () {
    this.#stopped = true
    clearTimeout(this.#timer)
    this.#client.disconnect()
    this.#set('idle')
  }

  retryNow () {
    if (this.#stopped) return
    clearTimeout(this.#timer)
    this.#connect()
  }

  async #connect () {
    this.#set(this.#attempt === 0 ? 'connecting' : 'reconnecting', { attempt: this.#attempt, retryAt: null })
    try {
      const info = await this.#client.connect(this.#options)
      if (this.#stopped) {
        this.#client.disconnect()
        return
      }
      this.#attempt = 0
      this.#set('connected', { info })
      this.dispatchEvent(new CustomEvent('ready', { detail: info }))
    } catch (error) {
      if (!this.#stopped) this.#handleFailure(error)
    }
  }

  #handleFailure (error) {
    if (error?.fatal) {
      this.#set('failed', { error })
      return
    }
    const delay = Math.min(MAX_DELAY_MS, 1000 * 2 ** this.#attempt) + Math.random() * 300
    this.#attempt++
    this.#set('reconnecting', { error, attempt: this.#attempt, retryAt: Date.now() + delay })
    clearTimeout(this.#timer)
    this.#timer = setTimeout(() => this.#connect(), delay)
  }

  #set (state, extra = {}) {
    this.#state = state
    this.dispatchEvent(new CustomEvent('state', { detail: { state, ...extra } }))
  }
}
