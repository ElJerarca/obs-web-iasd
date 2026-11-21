/** Panel "Fuentes": elementos de la escena actual y su visibilidad. */

import { el, debounce } from '../dom.js'
import { icons } from './icons.js'
import { reportError } from '../toast.js'

export class SourcesPanel {
  #client
  #list
  #sceneLabel
  #scene = null
  #items = []
  #token = 0

  constructor (client, listEl, sceneLabelEl) {
    this.#client = client
    this.#list = listEl
    this.#sceneLabel = sceneLabelEl

    const reload = debounce(() => this.#reload(), 150)
    // Solo interesan los eventos de la escena que se está mostrando
    const forCurrent = (fn) => (data) => { if (data.sceneName === this.#scene) fn(data) }

    client.on('SceneItemEnableStateChanged', forCurrent(({ sceneItemId, sceneItemEnabled }) =>
      this.#updateItem(sceneItemId, { enabled: sceneItemEnabled })))
    client.on('SceneItemLockStateChanged', forCurrent(({ sceneItemId, sceneItemLocked }) =>
      this.#updateItem(sceneItemId, { locked: sceneItemLocked })))
    client.on('SceneItemCreated', forCurrent(reload))
    client.on('SceneItemRemoved', forCurrent(reload))
    client.on('SceneItemListReindexed', forCurrent(reload))
    client.on('InputNameChanged', reload)
  }

  async load (sceneName) {
    this.#scene = sceneName
    this.#sceneLabel.textContent = sceneName ?? ''
    const token = ++this.#token
    if (!sceneName) {
      this.#items = []
      this.#render()
      return
    }
    const { sceneItems = [] } = await this.#client.call('GetSceneItemList', { sceneName })
    if (token !== this.#token) return // llegó otra escena mientras tanto: respuesta obsoleta

    // sceneItemIndex 0 = el elemento más abajo; OBS muestra primero el de arriba
    this.#items = sceneItems.map((i) => ({
      id: i.sceneItemId,
      name: i.sourceName,
      enabled: i.sceneItemEnabled,
      locked: Boolean(i.sceneItemLocked),
      isGroup: Boolean(i.isGroup)
    })).reverse()
    this.#render()
  }

  #reload () {
    if (!this.#scene) return
    this.load(this.#scene).catch((e) => reportError(e, 'No se pudo actualizar la lista de fuentes'))
  }

  #render () {
    if (!this.#items.length) {
      this.#list.replaceChildren(el('li', { class: 'list__empty' },
        el('span', { class: 'list__empty-icon', html: icons.empty }),
        el('span', { text: this.#scene ? 'Esta escena no tiene fuentes.' : 'Selecciona una escena.' })
      ))
      return
    }
    this.#list.replaceChildren(...this.#items.map((item) => this.#row(item)))
  }

  #row (item) {
    const eye = el('button', {
      type: 'button',
      class: 'btn btn--icon eye',
      onclick: () => this.#toggle(item, eye)
    })
    const lock = el('button', {
      type: 'button',
      class: 'btn btn--icon lock',
      onclick: () => this.#toggleLock(item, lock)
    })
    const row = el('li', { dataset: { id: item.id } },
      el('div', { class: 'list__item source' },
        el('span', { class: 'source__icon', html: item.isGroup ? icons.group : icons.sources }),
        el('span', { class: 'list__label', text: item.name, title: item.name }),
        eye,
        lock
      )
    )
    this.#paint(row, item)
    return row
  }

  #paint (row, item) {
    const eye = row.querySelector('.eye')
    row.firstElementChild.classList.toggle('is-hidden', !item.enabled)
    eye.innerHTML = item.enabled ? icons.eye : icons.eyeOff
    eye.setAttribute('aria-pressed', String(item.enabled))
    const action = item.enabled ? 'Ocultar' : 'Mostrar'
    eye.setAttribute('aria-label', `${action} ${item.name}`)
    eye.title = action

    const lock = row.querySelector('.lock')
    lock.innerHTML = item.locked ? icons.lock : icons.unlock
    lock.setAttribute('aria-pressed', String(item.locked))
    const lockAction = item.locked ? 'Desbloquear' : 'Bloquear'
    lock.setAttribute('aria-label', `${lockAction} ${item.name}`)
    lock.title = lockAction
  }

  #updateItem (id, changes) {
    const item = this.#items.find((i) => i.id === id)
    if (!item) return
    Object.assign(item, changes)
    const row = this.#list.querySelector(`li[data-id="${Number(id)}"]`)
    if (row) this.#paint(row, item)
  }

  async #toggle (item, button) {
    button.disabled = true
    try {
      // El cambio visual llega con el evento SceneItemEnableStateChanged
      await this.#client.call('SetSceneItemEnabled', {
        sceneName: this.#scene,
        sceneItemId: item.id,
        sceneItemEnabled: !item.enabled
      })
    } catch (e) {
      reportError(e, `No se pudo cambiar la visibilidad de "${item.name}"`)
    } finally {
      button.disabled = false
    }
  }

  async #toggleLock (item, button) {
    button.disabled = true
    try {
      // El cambio visual llega con el evento SceneItemLockStateChanged
      await this.#client.call('SetSceneItemLocked', {
        sceneName: this.#scene,
        sceneItemId: item.id,
        sceneItemLocked: !item.locked
      })
    } catch (e) {
      reportError(e, `No se pudo bloquear/desbloquear "${item.name}"`)
    } finally {
      button.disabled = false
    }
  }
}
