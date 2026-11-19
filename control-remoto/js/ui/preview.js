/**
 * Vista previa por capturas periódicas (GetSourceScreenshot).
 * obs-websocket no transmite video continuo: cada captura es una imagen
 * completa codificada en Base64, así que se limita la frecuencia y el tamaño.
 *
 * - Nunca hay dos capturas en curso a la vez (la siguiente se programa al terminar).
 * - Se pausa si la pestaña está oculta, si no hay conexión o si el usuario la apaga.
 * - Ante errores repetidos espera cada vez más (hasta 15 s).
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

export class Preview {
  #client
  #els
  #source = null
  #enabled = true
  #visible = true
  #interval = 2000
  #timer = null
  #busy = false
  #errors = 0
  #format = 'png'
  #aspect = 16 / 9

  constructor (client, els) {
    this.#client = client
    this.#els = els

    const prefs = readPrefs()
    if (typeof prefs.enabled === 'boolean') this.#enabled = prefs.enabled
    if ([1000, 2000, 5000].includes(prefs.interval)) this.#interval = prefs.interval
    els.interval.value = String(this.#interval)

    els.toggle.addEventListener('click', () => this.setEnabled(!this.#enabled))
    els.interval.addEventListener('change', () => {
      this.#interval = Number(els.interval.value)
      this.#save()
      this.#schedule(0)
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
    this.#schedule(0)
  }

  setSource (name) {
    this.#source = name
    this.#schedule(0)
  }

  setVisible (visible) {
    this.#visible = visible
    this.#schedule(0)
  }

  setEnabled (enabled) {
    this.#enabled = enabled
    this.#save()
    this.#renderState()
    if (!enabled) {
      this.#els.img.removeAttribute('src')
      this.#els.stage.classList.remove('has-image')
    }
    this.#schedule(0)
  }

  #save () {
    savePrefs({ enabled: this.#enabled, interval: this.#interval })
  }

  #renderState () {
    const { toggle, placeholder } = this.#els
    toggle.setAttribute('aria-pressed', String(this.#enabled))
    toggle.querySelector('.btn__text').textContent = this.#enabled ? 'Pausar vista previa' : 'Activar vista previa'
    placeholder.querySelector('.preview__msg').textContent = this.#enabled
      ? 'Cargando vista previa…'
      : 'Vista previa desactivada'
    placeholder.querySelector('.preview__icon').innerHTML = icons.image
  }

  #active () {
    return this.#enabled && this.#visible && Boolean(this.#source) && this.#client.connected
  }

  #schedule (delay) {
    clearTimeout(this.#timer)
    this.#timer = null
    if (!this.#active() || this.#busy) return // si hay una captura en curso, ella programa la siguiente
    this.#timer = setTimeout(() => this.#capture(), delay)
  }

  #targetSize () {
    const { width, height } = this.#els.stage.getBoundingClientRect()
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    // Ajustar al área disponible manteniendo la relación de aspecto del lienzo de OBS
    let w = Math.min(width, height * this.#aspect) * dpr
    w = Math.max(64, Math.min(MAX_WIDTH, Math.round(w / 2) * 2))
    return { width: w, height: Math.max(8, Math.round(w / this.#aspect)) }
  }

  async #capture () {
    if (!this.#active() || this.#busy) return
    this.#busy = true
    try {
      const { width, height } = this.#targetSize()
      const { imageData } = await this.#client.call('GetSourceScreenshot', {
        sourceName: this.#source,
        imageFormat: this.#format,
        imageWidth: width,
        imageHeight: height,
        imageCompressionQuality: QUALITY
      })
      if (this.#enabled && imageData) {
        this.#els.img.src = imageData // data URI: "data:image/jpg;base64,..."
        this.#els.stage.classList.add('has-image')
      }
      this.#errors = 0
    } catch (e) {
      this.#errors++
      if (this.#errors === 3) reportError(e, 'La vista previa falló')
    } finally {
      this.#busy = false
      const delay = this.#errors ? Math.min(this.#interval * 2 ** this.#errors, 15000) : this.#interval
      this.#schedule(delay)
    }
  }
}
