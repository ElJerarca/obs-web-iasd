/**
 * Panel "Controles": iniciar/detener transmisión y grabación,
 * con el tiempo transcurrido en la barra de estado.
 */

import { reportError } from '../toast.js'

// Valores de outputState en StreamStateChanged / RecordStateChanged.
// VERIFICAR en la documentación si se usan estados adicionales en tu versión.
const OUTPUT_STATE = {
  OBS_WEBSOCKET_OUTPUT_STARTING: 'starting',
  OBS_WEBSOCKET_OUTPUT_STARTED: 'active',
  OBS_WEBSOCKET_OUTPUT_STOPPING: 'stopping',
  OBS_WEBSOCKET_OUTPUT_STOPPED: 'idle',
  OBS_WEBSOCKET_OUTPUT_RECONNECTING: 'reconnecting',
  OBS_WEBSOCKET_OUTPUT_RECONNECTED: 'active',
  OBS_WEBSOCKET_OUTPUT_PAUSED: 'paused',
  OBS_WEBSOCKET_OUTPUT_RESUMED: 'active'
}

const RUNNING = new Set(['active', 'reconnecting', 'paused'])

class OutputControl {
  #client
  #cfg
  #state = 'idle'
  #busy = false

  constructor (client, cfg) {
    this.#client = client
    this.#cfg = cfg
    cfg.button.addEventListener('click', () => this.#onClick())
    client.on(cfg.event, ({ outputActive, outputState }) => {
      this.#apply(OUTPUT_STATE[outputState] ?? (outputActive ? 'active' : 'idle'))
      if (outputState === 'OBS_WEBSOCKET_OUTPUT_STOPPED') this.#setTime(null)
    })
    this.#render()
  }

  async refresh () {
    const s = await this.#client.call(this.#cfg.statusRequest)
    this.#apply(s.outputActive ? (s.outputPaused ? 'paused' : 'active') : 'idle')
    this.#setTime(s.outputActive ? s.outputTimecode : null)
  }

  /** Actualiza el contador; se llama una vez por segundo mientras está activo. */
  async tick () {
    if (!RUNNING.has(this.#state) || this.#busy) return
    this.#busy = true
    try {
      const s = await this.#client.call(this.#cfg.statusRequest)
      this.#setTime(s.outputActive ? s.outputTimecode : null)
    } catch { /* se reintenta en el siguiente segundo */ } finally {
      this.#busy = false
    }
  }

  #apply (state) {
    this.#state = state
    this.#render()
  }

  #render () {
    const { button, labels, timeItem } = this.#cfg
    const running = RUNNING.has(this.#state)
    const transitional = this.#state === 'starting' || this.#state === 'stopping'
    button.querySelector('.btn__text').textContent =
      this.#state === 'starting'
        ? labels.starting
        : this.#state === 'stopping'
          ? labels.stopping
          : running ? labels.stop : labels.start
    button.disabled = transitional
    button.classList.toggle('is-live', running)
    button.setAttribute('aria-pressed', String(running))
    timeItem.classList.toggle('is-live', running)
  }

  #setTime (timecode) {
    // outputTimecode tiene el formato HH:MM:SS.mmm; se muestra sin milisegundos
    this.#cfg.timeEl.textContent = timecode ? String(timecode).split('.')[0] : '00:00:00'
  }

  async #onClick () {
    const { startRequest, stopRequest, confirmStop, labels } = this.#cfg
    const running = RUNNING.has(this.#state)
    if (running && confirmStop && !window.confirm(confirmStop)) return
    this.#apply(running ? 'stopping' : 'starting')
    try {
      await this.#client.call(running ? stopRequest : startRequest)
    } catch (e) {
      reportError(e, running ? `No se pudo ${labels.stop.toLowerCase()}` : `No se pudo ${labels.start.toLowerCase()}`)
      // Volver a leer el estado real para no dejar el botón bloqueado
      this.refresh().catch(() => this.#apply(running ? 'active' : 'idle'))
    }
  }
}

export class Controls {
  constructor (client, els) {
    this.stream = new OutputControl(client, {
      button: els.streamButton,
      timeEl: els.streamTime,
      timeItem: els.streamItem,
      event: 'StreamStateChanged',
      statusRequest: 'GetStreamStatus',
      startRequest: 'StartStream',
      stopRequest: 'StopStream',
      confirmStop: '¿Detener la transmisión en vivo?',
      labels: { start: 'Iniciar transmisión', stop: 'Detener transmisión', starting: 'Iniciando…', stopping: 'Deteniendo…' }
    })
    this.record = new OutputControl(client, {
      button: els.recordButton,
      timeEl: els.recordTime,
      timeItem: els.recordItem,
      event: 'RecordStateChanged',
      statusRequest: 'GetRecordStatus',
      startRequest: 'StartRecord',
      stopRequest: 'StopRecord',
      confirmStop: null,
      labels: { start: 'Iniciar grabación', stop: 'Detener grabación', starting: 'Iniciando…', stopping: 'Deteniendo…' }
    })
  }

  load () {
    return Promise.all([this.stream.refresh(), this.record.refresh()])
  }

  tick () {
    this.stream.tick()
    this.record.tick()
  }
}
