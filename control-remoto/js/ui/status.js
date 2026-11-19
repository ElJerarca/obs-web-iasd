/** Barra de estado: estado de la conexión, uso de CPU y FPS de OBS. */

export class StatusBar {
  #client
  #els
  #targetFps = 0
  #busy = false

  constructor (client, els) {
    this.#client = client
    this.#els = els
  }

  /** state: connecting | connected | reconnecting | failed | idle */
  setConnection (state, text) {
    const item = this.#els.connItem
    item.classList.remove('is-connected', 'is-reconnecting', 'is-failed')
    if (state === 'connected') item.classList.add('is-connected')
    if (state === 'connecting' || state === 'reconnecting') item.classList.add('is-reconnecting')
    if (state === 'failed') item.classList.add('is-failed')
    this.#els.connText.textContent = text
  }

  async load () {
    const video = await this.#client.call('GetVideoSettings')
    this.#targetFps = video.fpsDenominator ? video.fpsNumerator / video.fpsDenominator : 0
    await this.tick()
  }

  async tick () {
    if (this.#busy || !this.#client.connected) return
    this.#busy = true
    try {
      const stats = await this.#client.call('GetStats')
      this.#els.cpu.textContent = `CPU: ${Number(stats.cpuUsage ?? 0).toFixed(1)}%`
      const target = this.#targetFps ? ` / ${this.#targetFps.toFixed(2)}` : ''
      this.#els.fps.textContent = `${Number(stats.activeFps ?? 0).toFixed(2)}${target} FPS`
    } catch { /* las estadísticas no son críticas */ } finally {
      this.#busy = false
    }
  }
}
