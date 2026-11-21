/**
 * Columna central de transición (como OBS en Modo Estudio):
 * botón "Transición", selector de transición y duración.
 *
 * Nota: las "transiciones rápidas" y la barra T de OBS no se incluyen.
 * Las transiciones rápidas son una configuración de la interfaz de OBS que el
 * protocolo no expone; la barra T existe (SetTBarPosition) pero no se usa aquí.
 */

import { el } from '../dom.js'
import { reportError } from '../toast.js'

const MIN_MS = 50
const MAX_MS = 20000

export class TransitionsPanel {
  #client
  #els
  #studio = false
  #fixed = false

  constructor (client, els) {
    this.#client = client
    this.#els = els

    els.trigger.addEventListener('click', () => this.#trigger())
    els.select.addEventListener('change', () => this.#setTransition(els.select.value))
    els.duration.addEventListener('change', () => this.#setDuration())

    client.on('CurrentSceneTransitionChanged', () => {
      this.#refreshCurrent().catch((e) => reportError(e, 'No se pudo leer la transición'))
    })
    client.on('CurrentSceneTransitionDurationChanged', ({ transitionDuration }) => {
      els.duration.value = String(transitionDuration)
    })
    this.#render()
  }

  async load () {
    const { transitions = [] } = await this.#client.call('GetSceneTransitionList')
    this.#els.select.replaceChildren(...transitions.map((t) =>
      el('option', { value: t.transitionName, text: t.transitionName })))
    await this.#refreshCurrent()
  }

  setStudio (enabled) {
    this.#studio = enabled
    this.#render()
  }

  async #refreshCurrent () {
    const t = await this.#client.call('GetCurrentSceneTransition')
    this.#els.select.value = t.transitionName
    this.#fixed = Boolean(t.transitionFixed) // p. ej. "Corte" no tiene duración
    if (t.transitionDuration != null) this.#els.duration.value = String(t.transitionDuration)
    this.#render()
  }

  #render () {
    this.#els.trigger.disabled = !this.#studio
    this.#els.duration.disabled = this.#fixed
  }

  async #trigger () {
    const btn = this.#els.trigger
    btn.disabled = true
    try {
      // Pasa la escena de vista previa a programa con la transición actual
      await this.#client.call('TriggerStudioModeTransition')
    } catch (e) {
      reportError(e, 'No se pudo ejecutar la transición')
    } finally {
      // Breve bloqueo para evitar dobles clics durante la transición
      setTimeout(() => this.#render(), 300)
    }
  }

  async #setTransition (name) {
    try {
      await this.#client.call('SetCurrentSceneTransition', { transitionName: name })
    } catch (e) {
      reportError(e, 'No se pudo cambiar la transición')
      this.#refreshCurrent().catch(() => {})
    }
  }

  async #setDuration () {
    const input = this.#els.duration
    const value = Math.round(Math.min(MAX_MS, Math.max(MIN_MS, Number(input.value) || 300)))
    input.value = String(value)
    try {
      await this.#client.call('SetCurrentSceneTransitionDuration', { transitionDuration: value })
    } catch (e) {
      reportError(e, 'No se pudo cambiar la duración')
    }
  }
}
