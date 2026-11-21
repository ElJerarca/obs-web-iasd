/**
 * Panel "Escenas" y estado del Modo Estudio.
 *
 * - Modo normal: clic en una escena = cambia la escena de PROGRAMA.
 * - Modo Estudio: clic en una escena = cambia la escena de VISTA PREVIA;
 *   el paso a programa se hace con el botón "Transición" (como en OBS).
 *
 * Este módulo es la fuente de verdad de { studio, program, preview } y avisa
 * de cada cambio con onChange(estado).
 */

import { el, debounce } from '../dom.js'
import { reportError } from '../toast.js'

export class ScenesPanel {
  #client
  #list
  #onChange
  #scenes = []
  #studio = false
  #program = null
  #preview = null

  constructor (client, listEl, { onChange }) {
    this.#client = client
    this.#list = listEl
    this.#onChange = onChange

    const reload = debounce(() => {
      this.load().catch((e) => reportError(e, 'No se pudo actualizar la lista de escenas'))
    }, 150)

    client.on('CurrentProgramSceneChanged', ({ sceneName }) => {
      this.#program = sceneName
      this.#emit()
    })
    client.on('CurrentPreviewSceneChanged', ({ sceneName }) => {
      this.#preview = sceneName
      this.#emit()
    })
    client.on('StudioModeStateChanged', ({ studioModeEnabled }) => this.#setStudio(studioModeEnabled))
    client.on('SceneListChanged', reload)
    client.on('SceneCreated', reload)
    client.on('SceneRemoved', reload)
    client.on('SceneNameChanged', reload)
  }

  /** Escena "seleccionada": la de vista previa en Modo Estudio, si no la de programa. */
  get state () {
    return {
      studio: this.#studio,
      program: this.#program,
      preview: this.#studio ? this.#preview : null,
      selected: this.#studio ? (this.#preview ?? this.#program) : this.#program
    }
  }

  async load () {
    const [list, studio] = await Promise.all([
      this.#client.call('GetSceneList'),
      this.#client.call('GetStudioModeEnabled')
    ])
    // obs-websocket entrega las escenas en orden inverso al que muestra OBS
    this.#scenes = (list.scenes ?? []).map((s) => s.sceneName).reverse()
    this.#studio = Boolean(studio.studioModeEnabled)
    this.#program = list.currentProgramSceneName ?? null
    this.#preview = this.#studio ? (list.currentPreviewSceneName ?? null) : null
    this.#render()
    this.#emit()
  }

  /** Activa o desactiva el Modo Estudio en OBS. */
  async toggleStudio () {
    try {
      await this.#client.call('SetStudioModeEnabled', { studioModeEnabled: !this.#studio })
      // La interfaz cambia al recibir StudioModeStateChanged
    } catch (e) {
      reportError(e, 'No se pudo cambiar el Modo Estudio')
    }
  }

  async #setStudio (enabled) {
    this.#studio = Boolean(enabled)
    this.#preview = null
    if (this.#studio) {
      try {
        const { currentPreviewSceneName } = await this.#client.call('GetCurrentPreviewScene')
        this.#preview = currentPreviewSceneName ?? null
      } catch { /* llegará con CurrentPreviewSceneChanged */ }
    }
    this.#emit()
  }

  #render () {
    if (!this.#scenes.length) {
      this.#list.replaceChildren(el('li', { class: 'list__empty', text: 'No hay escenas.' }))
      return
    }
    this.#list.replaceChildren(...this.#scenes.map((name) =>
      el('li', {},
        el('button', {
          type: 'button',
          class: 'list__item scene',
          title: name,
          dataset: { name },
          onclick: () => this.#select(name)
        },
        el('span', { class: 'list__label', text: name }),
        el('span', { class: 'scene__badge', text: 'PGM', 'aria-hidden': 'true' }))
      )
    ))
  }

  #emit () {
    const state = this.state
    for (const btn of this.#list.querySelectorAll('.list__item')) {
      const name = btn.dataset.name
      const selected = name === state.selected
      btn.classList.toggle('is-active', selected)
      btn.classList.remove('is-pending')
      // En Modo Estudio se marca además cuál está al aire
      btn.classList.toggle('is-program', state.studio && name === state.program)
      btn.setAttribute('aria-current', selected ? 'true' : 'false')
    }
    this.#onChange(state)
  }

  async #select (name) {
    const studio = this.#studio
    if (name === this.state.selected) return
    const btn = [...this.#list.querySelectorAll('.list__item')].find((b) => b.dataset.name === name)
    btn?.classList.add('is-pending')
    try {
      await this.#client.call(studio ? 'SetCurrentPreviewScene' : 'SetCurrentProgramScene', { sceneName: name })
    } catch (e) {
      btn?.classList.remove('is-pending')
      reportError(e, 'No se pudo cambiar de escena')
    }
  }
}
