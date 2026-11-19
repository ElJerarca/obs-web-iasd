/**
 * Mezclador de audio: volumen, silencio y medidores de nivel animados.
 *
 * Los niveles llegan en el evento de alto volumen InputVolumeMeters
 * (cada ~50 ms, hay que suscribirse con EventSubscription.InputVolumeMeters).
 * Formato: inputs[].inputLevelsMul = un arreglo por canal de audio con
 * [magnitud, pico, pico de entrada] en escala lineal (0..1).
 * VERIFICAR: el orden de esos tres valores no está detallado en la documentación
 * generada del protocolo; corresponde a la implementación actual de obs-websocket.
 *
 * El dibujo usa un único bucle requestAnimationFrame para todos los canales:
 * subida instantánea, caída suave y marcador de pico retenido, como en OBS.
 */

import { el, debounce } from '../dom.js'
import { icons } from './icons.js'
import { reportError } from '../toast.js'

const MIN_DB = -60
const DECAY_DB_PER_S = 30 // velocidad de caída de la barra
const PEAK_HOLD_MS = 1200 // tiempo que se sostiene el marcador de pico
const STALE_MS = 500 // sin datos durante este tiempo = silencio
const SEND_INTERVAL_MS = 60 // límite de envíos de volumen mientras se arrastra

export const mulToDb = (mul) => (mul > 0 ? 20 * Math.log10(mul) : -Infinity)
// Curva cúbica para el fader: más resolución en la zona útil, similar a OBS
const faderToMul = (pos) => pos ** 3
const mulToFader = (mul) => Math.cbrt(Math.min(Math.max(mul, 0), 1))
const formatDb = (db) => (Number.isFinite(db) ? `${db.toFixed(1)} dB` : '-∞ dB')

// Zonas de color como OBS: verde < -20 dB, amarillo hasta -9 dB, rojo encima
const PALETTE = {
  green: ['#45c35a', '#1d3a24'],
  yellow: ['#e3c03c', '#3f3a1e'],
  red: ['#e0473f', '#43201f'],
  muted: ['#8a8d98', '#2a2c33']
}
function segmentColor (db, lit, muted) {
  const zone = muted ? 'muted' : db >= -9 ? 'red' : db >= -20 ? 'yellow' : 'green'
  return PALETTE[zone][lit ? 0 : 1]
}

class Channel {
  constructor ({ inputName, mul, muted }, client) {
    this.name = inputName
    this.client = client
    this.mul = mul
    this.muted = muted
    this.levels = [] // por canal: { target, value, peak, peakAt }
    this.lastUpdate = 0
    this.dragging = false
    this.dragTimer = null
    this.sendTimer = null
    this.sendPending = false

    this.dbLabel = el('div', { class: 'channel__db' })
    // El canvas va posicionado en absoluto dentro de un contenedor para que su
    // tamaño interno no afecte al layout (evita que crezca en bucle al redimensionar)
    this.canvas = el('canvas', { 'aria-hidden': 'true' })
    this.meterBox = el('div', { class: 'meter' }, this.canvas)
    this.ctx = this.canvas.getContext('2d')
    this.fader = el('input', {
      type: 'range',
      class: 'fader',
      min: 0,
      max: 1000,
      step: 1,
      'aria-label': `Volumen de ${inputName}`
    })
    this.muteBtn = el('button', {
      type: 'button',
      class: 'btn btn--icon channel__mute',
      onclick: () => this.#toggleMute()
    })
    this.root = el('div', { class: 'channel' },
      el('div', { class: 'channel__name', text: inputName, title: inputName }),
      this.dbLabel,
      el('div', { class: 'channel__body' }, this.meterBox, this.fader),
      this.muteBtn
    )

    this.fader.addEventListener('input', () => {
      this.dragging = true
      clearTimeout(this.dragTimer)
      this.mul = faderToMul(this.fader.value / 1000)
      this.#paintVolume(false)
      this.#queueSend()
    })
    this.fader.addEventListener('change', () => {
      this.#queueSend()
      // Ignorar ecos de InputVolumeChanged un instante tras soltar
      this.dragTimer = setTimeout(() => { this.dragging = false }, 400)
    })

    // Ajustar la resolución del canvas a su tamaño real (y a la densidad de píxeles)
    this.resizeObserver = new ResizeObserver(() => this.#resize())
    this.resizeObserver.observe(this.meterBox)

    this.#paintVolume(true)
    this.#paintMute()
  }

  setVolume (mul) {
    if (this.dragging) return
    this.mul = mul
    this.#paintVolume(true)
  }

  setMuted (muted) {
    this.muted = muted
    this.#paintMute()
  }

  setLevels (levelsMul, now) {
    this.lastUpdate = now
    const count = Math.max(levelsMul.length, 1)
    if (this.levels.length !== count) {
      this.levels = Array.from({ length: count }, (_, i) => this.levels[i] ?? { target: MIN_DB, value: MIN_DB, peak: MIN_DB, peakAt: 0 })
    }
    levelsMul.forEach((ch, i) => {
      // ch = [magnitud, pico, pico de entrada]; la barra muestra el pico
      this.levels[i].target = mulToDb(ch[1] ?? ch[0] ?? 0)
    })
  }

  draw (now, dt) {
    const { canvas, ctx } = this
    const dpr = this.dpr || 1
    const W = canvas.width / dpr
    const H = canvas.height / dpr
    if (!W || !H) return

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, W, H)

    if (!this.levels.length) {
      this.levels = [0, 1].map(() => ({ target: MIN_DB, value: MIN_DB, peak: MIN_DB, peakAt: 0 }))
    }
    const stale = now - this.lastUpdate > STALE_MS
    const n = this.levels.length
    const scaleW = 22
    const gap = 2
    const barW = Math.max(3, Math.min(9, (W - scaleW - gap * (n - 1)) / n))
    const seg = 2
    const step = 3
    const segments = Math.floor(H / step)
    const dbToY = (db) => H - ((db - MIN_DB) / -MIN_DB) * H

    this.levels.forEach((lv, i) => {
      const target = stale ? MIN_DB : Math.max(lv.target, MIN_DB)
      // Subida instantánea, caída progresiva
      lv.value = target >= lv.value ? target : Math.max(target, lv.value - DECAY_DB_PER_S * dt)
      if (lv.value >= lv.peak) {
        lv.peak = lv.value
        lv.peakAt = now
      } else if (now - lv.peakAt > PEAK_HOLD_MS) {
        lv.peak = Math.max(lv.value, lv.peak - DECAY_DB_PER_S * dt)
      }

      const x = i * (barW + gap)
      for (let s = 0; s < segments; s++) {
        const segDb = MIN_DB + ((s + 0.5) / segments) * -MIN_DB
        ctx.fillStyle = segmentColor(segDb, segDb <= lv.value, this.muted)
        ctx.fillRect(x, H - (s + 1) * step, barW, seg)
      }
      if (lv.peak > MIN_DB + 0.5) {
        ctx.fillStyle = segmentColor(lv.peak, true, this.muted)
        ctx.fillRect(x, Math.max(0, dbToY(lv.peak) - 1), barW, 2)
      }
    })

    // Escala en dB
    const sx = n * (barW + gap) + 2
    const stepDb = H < 150 ? 12 : 6
    ctx.fillStyle = '#7d8091'
    ctx.font = '9px system-ui, sans-serif'
    ctx.textBaseline = 'middle'
    for (let db = 0; db >= MIN_DB; db -= stepDb) {
      const y = Math.min(Math.max(dbToY(db), 0.5), H - 0.5)
      ctx.fillText(String(db), sx, Math.min(Math.max(y, 5), H - 5))
    }
  }

  destroy () {
    this.resizeObserver.disconnect()
    clearTimeout(this.sendTimer)
    clearTimeout(this.dragTimer)
  }

  #resize () {
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const { width, height } = this.meterBox.getBoundingClientRect()
    this.dpr = dpr
    this.canvas.width = Math.round(width * dpr)
    this.canvas.height = Math.round(height * dpr)
  }

  #paintVolume (moveFader) {
    if (moveFader) this.fader.value = String(Math.round(mulToFader(this.mul) * 1000))
    const text = formatDb(mulToDb(this.mul))
    this.dbLabel.textContent = text
    this.fader.setAttribute('aria-valuetext', text)
  }

  #paintMute () {
    this.root.classList.toggle('is-muted', this.muted)
    this.muteBtn.innerHTML = this.muted ? icons.volumeOff : icons.volume
    this.muteBtn.setAttribute('aria-pressed', String(this.muted))
    const label = this.muted ? `Activar audio de ${this.name}` : `Silenciar ${this.name}`
    this.muteBtn.setAttribute('aria-label', label)
    this.muteBtn.title = this.muted ? 'Activar audio' : 'Silenciar'
  }

  // Limita los envíos mientras se arrastra: como máximo uno cada SEND_INTERVAL_MS,
  // y siempre se envía el último valor.
  #queueSend () {
    if (this.sendTimer) {
      this.sendPending = true
      return
    }
    this.client.call('SetInputVolume', { inputName: this.name, inputVolumeMul: this.mul })
      .catch((e) => reportError(e, `No se pudo ajustar el volumen de "${this.name}"`))
    this.sendTimer = setTimeout(() => {
      this.sendTimer = null
      if (this.sendPending) {
        this.sendPending = false
        this.#queueSend()
      }
    }, SEND_INTERVAL_MS)
  }

  async #toggleMute () {
    this.muteBtn.disabled = true
    try {
      await this.client.call('SetInputMute', { inputName: this.name, inputMuted: !this.muted })
    } catch (e) {
      reportError(e, `No se pudo cambiar el silencio de "${this.name}"`)
    } finally {
      this.muteBtn.disabled = false
    }
  }
}

export class AudioMixer {
  #client
  #host
  #channels = new Map()
  #token = 0
  #raf = 0
  #last = 0

  constructor (client, hostEl) {
    this.#client = client
    this.#host = hostEl

    const reload = debounce(() => {
      this.load().catch((e) => reportError(e, 'No se pudo actualizar el mezclador'))
    }, 250)

    client.on('InputVolumeChanged', ({ inputName, inputVolumeMul }) =>
      this.#channels.get(inputName)?.setVolume(inputVolumeMul))
    client.on('InputMuteStateChanged', ({ inputName, inputMuted }) =>
      this.#channels.get(inputName)?.setMuted(inputMuted))
    client.on('InputVolumeMeters', ({ inputs = [] }) => {
      const now = performance.now()
      for (const input of inputs) {
        this.#channels.get(input.inputName)?.setLevels(input.inputLevelsMul ?? [], now)
      }
    })
    client.on('InputCreated', reload)
    client.on('InputRemoved', reload)
    client.on('InputNameChanged', reload)
  }

  async load () {
    const token = ++this.#token
    const { inputs = [] } = await this.#client.call('GetInputList')

    // GetInputList devuelve todas las entradas (también de video). Las que no
    // tienen audio responden con error a GetInputVolume y se descartan.
    const results = await Promise.all(inputs.map(async ({ inputName }) => {
      try {
        const [volume, mute] = await Promise.all([
          this.#client.call('GetInputVolume', { inputName }),
          this.#client.call('GetInputMute', { inputName })
        ])
        return { inputName, mul: volume.inputVolumeMul, muted: mute.inputMuted }
      } catch {
        return null
      }
    }))
    if (token !== this.#token) return

    for (const channel of this.#channels.values()) channel.destroy()
    this.#channels.clear()
    for (const data of results.filter(Boolean)) {
      this.#channels.set(data.inputName, new Channel(data, this.#client))
    }

    if (this.#channels.size) {
      this.#host.replaceChildren(...[...this.#channels.values()].map((c) => c.root))
    } else {
      this.#host.replaceChildren(el('p', { class: 'mixer__empty', text: 'No hay fuentes de audio.' }))
    }
    this.#start()
  }

  #start () {
    if (this.#raf) return
    const loop = (now) => {
      const dt = this.#last ? Math.min((now - this.#last) / 1000, 0.1) : 0
      this.#last = now
      for (const channel of this.#channels.values()) channel.draw(now, dt)
      this.#raf = requestAnimationFrame(loop)
    }
    this.#raf = requestAnimationFrame(loop)
  }
}
