/** Panel "Escenas": lista las escenas y cambia la escena de programa. */

import { el, debounce } from '../dom.js'
import { reportError } from '../toast.js'

export class ScenesPanel {
  #client
  #list
  #onSceneChange
  #scenes = []
  #current = null

  constructor (client, listEl, { onSceneChange }) {
    this.#client = client
    this.#list = listEl
    this.#onSceneChange = onSceneChange

    const reload = debounce(() => {
      this.load().catch((e) => reportError(e, 'No se pudo actualizar la lista de escenas'))
    }, 150)

    client.on('CurrentProgramSceneChanged', ({ sceneName }) => this.#setCurrent(sceneName))
    client.on('SceneListChanged', reload)
    client.on('SceneCreated', reload)
    client.on('SceneRemoved', reload)
    client.on('SceneNameChanged', reload)
  }

  get current () { return this.#current }

  async load () {
    const { scenes = [], currentProgramSceneName } = await this.#client.call('GetSceneList')
    // obs-websocket entrega las escenas en orden inverso al que muestra OBS
    // (índice 0 = la de abajo). Se invierten para mostrar el mismo orden.
    this.#scenes = scenes.map((s) => s.sceneName).reverse()
    this.#render()
    this.#setCurrent(currentProgramSceneName, true)
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
          class: 'list__item',
          title: name,
          dataset: { name },
          onclick: () => this.#select(name)
        }, el('span', { class: 'list__label', text: name }))
      )
    ))
  }

  #buttonFor (name) {
    return [...this.#list.querySelectorAll('.list__item')].find((b) => b.dataset.name === name)
  }

  #setCurrent (name, force = false) {
    const changed = name !== this.#current
    this.#current = name
    for (const btn of this.#list.querySelectorAll('.list__item')) {
      const active = btn.dataset.name === name
      btn.classList.toggle('is-active', active)
      btn.classList.remove('is-pending')
      btn.setAttribute('aria-current', active ? 'true' : 'false')
    }
    if (changed || force) this.#onSceneChange(name)
  }

  async #select (name) {
    if (name === this.#current) return
    const btn = this.#buttonFor(name)
    btn?.classList.add('is-pending')
    try {
      // La interfaz se actualiza al llegar el evento CurrentProgramSceneChanged
      await this.#client.call('SetCurrentProgramScene', { sceneName: name })
    } catch (e) {
      btn?.classList.remove('is-pending')
      reportError(e, 'No se pudo cambiar de escena')
    }
  }
}
