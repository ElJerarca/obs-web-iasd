/**
 * Visores de video por capturas periódicas (GetSourceScreenshot).
 * obs-websocket no transmite video continuo: cada captura es una imagen
 * completa en Base64, así que se limitan la frecuencia y el tamaño.
 *
 * Hay un visor por pantalla: "Programa" siempre y "Vista previa" solo en
 * Modo Estudio. Un único controlador las actualiza por turnos:
 * - nunca hay dos capturas en curso a la vez;
 * - se salta los visores ocultos (p. ej. vista previa fuera del Modo Estudio);
 * - se pausa con la pestaña oculta, sin conexión o si el usuario la apaga;
 * - ante errores repetidos espera cada vez más (hasta 15 s).
 */

import { reportError } from '../toast.js'
import { icons } from './icons.js'

const PREF_KEY = 'obsctl.preview'
const MAX_WIDTH = 1280
const QUALITY = 60 // 0..100, solo afecta a formatos con compresión (jpg/webp)

function readPrefs () {
  try { return JSON.parse(localStorage.getItem(PREF_KEY)) ?? {} } catch { return {} }
}
function savePrefs (prefs) {
  try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)) } catch { /* sin almacenamiento */ }
}

/** Una pantalla (programa o vista previa). */
export class ScreenshotView {
  constructor ({ stage, img, placeholder }) {
    this.stage = stage
    this.img = img
    this.placeholder = placeholder
    this.source = null
    placeholder.querySelector('.preview__icon').innerHTML = icons.image
  }

  get shown () {
    return this.stage.getClientRects().length > 0 // false si está con display:none
  }

  setMessage (text) {
    this.placeholder.querySelector('.preview__msg').textContent = text
  }

  show (dataUri) {
    this.img.src = dataUri // data URI: "data:image/jpg;base64,..."
    this.stage.classList.add('has-image')
  }

  clear () {
    this.img.removeAttribute('src')
    this.stage.classList.remove('has-image')
  }
}

export class PreviewController {
  #client
  #views
  #els
  #enabled = true
  #visible = true
  #interval = 2000
  #timer = null
  #busy = false
  #again = false // se pidió refrescar mientras había una captura en curso
  #errors = 0
  #format = 'png'
  #aspect = 16 / 9

  constructor (client, views, els) {
    this.#client = client
    this.#views = views
    this.#els = els

    const prefs = readPrefs()
    if (typeof prefs.enabled === 'boolean') this.#enabled = prefs.enabled
    if ([1000, 2000, 5000].includes(prefs.interval)) this.#interval = prefs.interval
    els.interval.value = String(this.#interval)

    els.toggle.addEventListener('click', () => this.setEnabled(!this.#enabled))
    els.interval.addEventListener('change', () => {
      this.#interval = Number(els.interval.value)
      this.#save()
      this.refresh()
    })
    this.#renderState()
  }

  /** Se llama tras cada conexión: formato de imagen y relación de aspecto. */
  async init () {
    const [version, video] = await Promise.all([
      this.#client.call('GetVersion'),
      this.#client.call('GetVideoSettings')
    ])
    const formats = version.supportedImageFormats ?? []
    this.#format = ['jpg', 'jpeg', 'webp', 'png'].find((f) => formats.includes(f)) ?? formats[0] ?? 'png'
    if (video.baseWidth && video.baseHeight) this.#aspect = video.baseWidth / video.baseHeight
    this.#errors = 0
    this.refresh()
  }

  /** Asigna la escena de un visor y pide una captura inmediata si cambió. */
  setSource (view, name) {
    if (view.source === name) return
    view.source = name
    if (!name) view.clear()
    this.refresh()
  }

  setVisible (visible) {
    this.#visible = visible
    this.refresh()
  }

  setEnabled (enabled) {
    this.#enabled = enabled
    this.#save()
    this.#renderState()
    if (!enabled) this.#views.forEach((v) => v.clear())
    this.refresh()
  }

  /** Programa una captura lo antes posible. */
  refresh () {
    this.#schedule(0)
  }

  #save () {
    savePrefs({ enabled: this.#enabled, interval: this.#interval })
  }

  #renderState () {
    const { toggle } = this.#els
    toggle.setAttribute('aria-pressed', String(this.#enabled))
    toggle.querySelector('.btn__text').textContent = this.#enabled ? 'Pausar' : 'Activar'
    toggle.title = this.#enabled ? 'Pausar las capturas' : 'Activar las capturas'
    for (const v of this.#views) v.setMessage(this.#enabled ? 'Cargando imagen…' : 'Vista desactivada')
  }

  #active () {
    return this.#enabled && this.#visible && this.#client.connected
  }

  #schedule (delay) {
    clearTimeout(this.#timer)
    this.#timer = null
    if (this.#busy) {
      if (delay === 0) this.#again = true // la captura en curso programará la siguiente
      return
    }
    if (!this.#active()) return
    this.#timer = setTimeout(() => this.#captureAll(), delay)
  }

  #targetSize (view) {
    const { width, height } = view.stage.getBoundingClientRect()
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    // Ajustar al área disponible manteniendo la relación de aspecto del lienzo de OBS
    let w = Math.min(width, height * this.#aspect) * dpr
    w = Math.max(64, Math.min(MAX_WIDTH, Math.round(w / 2) * 2))
    return { width: w, height: Math.max(8, Math.round(w / this.#aspect)) }
  }

  async #captureAll () {
    if (!this.#active() || this.#busy) return
    this.#busy = true
    let failed = null
    try {
      // Una captura por visor, en secuencia (nunca en paralelo)
      for (const view of this.#views) {
        if (!view.source || !view.shown || !this.#active()) continue
        const source = view.source
        try {
          const { width, height } = this.#targetSize(view)
          const { imageData } = await this.#client.call('GetSourceScreenshot', {
            sourceName: source,
            imageFormat: this.#format,
            imageWidth: width,
            imageHeight: height,
            imageCompressionQuality: QUALITY
          })
          // Descartar si la escena del visor cambió mientras se capturaba
          if (this.#enabled && imageData && view.source === source) view.show(imageData)
        } catch (e) {
          failed = e
        }
      }
    } finally {
      this.#busy = false
      if (failed) {
        this.#errors++
        if (this.#errors === 3) reportError(failed, 'La vista previa falló')
      } else {
        this.#errors = 0
      }
      const again = this.#again
      this.#again = false
      const delay = this.#errors ? Math.min(this.#interval * 2 ** this.#errors, 15000) : this.#interval
      this.#schedule(again ? 0 : delay)
    }
  }
}
