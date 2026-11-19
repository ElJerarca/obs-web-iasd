/**
 * Panel principal: une la conexión con los módulos de la interfaz.
 * Cada módulo se ocupa de un panel; este archivo solo coordina:
 *   - conexión y reconexión (ConnectionManager)
 *   - resincronización completa tras cada (re)conexión
 *   - pausa de medidores y vista previa cuando la pestaña está oculta
 */

import { ObsClient, EventSubscription } from './obs-client.js'
import { ConnectionManager } from './connection.js'
import { loadSession, clearSession, setFlash } from './session.js'
import { injectIcons } from './ui/icons.js'
import { ScenesPanel } from './ui/scenes.js'
import { SourcesPanel } from './ui/sources.js'
import { AudioMixer } from './ui/audio.js'
import { Controls } from './ui/controls.js'
import { Preview } from './ui/preview.js'
import { StatusBar } from './ui/status.js'
import { toast, reportError } from './toast.js'

// Eventos normales + niveles de audio (alto volumen, ~20 mensajes/s)
const SUBS_VISIBLE = EventSubscription.All | EventSubscription.InputVolumeMeters
// Con la pestaña oculta no se piden los niveles: se ahorra red y CPU
const SUBS_HIDDEN = EventSubscription.All

const session = loadSession()
if (!session) {
  location.replace('index.html')
} else {
  main(session)
}

function main (session) {
  const $ = (id) => document.getElementById(id)
  injectIcons()

  $('server-url').textContent = session.url.replace(/\/$/, '')
  $('server-url').title = session.url

  const client = new ObsClient()
  const conn = new ConnectionManager(client, {
    url: session.url,
    secret: session.secret,
    eventSubscriptions: SUBS_VISIBLE
  })

  // ---- Módulos de la interfaz ----
  const status = new StatusBar(client, {
    connItem: $('conn-state'),
    connText: $('conn-text'),
    cpu: $('stat-cpu'),
    fps: $('stat-fps')
  })
  const sources = new SourcesPanel(client, $('source-list'), $('sources-scene'))
  const preview = new Preview(client, {
    stage: $('preview-stage'),
    img: $('preview-img'),
    placeholder: $('preview-placeholder'),
    toggle: $('preview-toggle'),
    interval: $('preview-interval')
  })
  const scenes = new ScenesPanel(client, $('scene-list'), {
    onSceneChange: (name) => {
      $('current-scene').textContent = name ?? '—'
      preview.setSource(name)
      sources.load(name).catch((e) => reportError(e, 'No se pudieron cargar las fuentes'))
    }
  })
  const mixer = new AudioMixer(client, $('mixer'))
  const controls = new Controls(client, {
    streamButton: $('btn-stream'),
    recordButton: $('btn-record'),
    streamTime: $('stream-time'),
    recordTime: $('record-time'),
    streamItem: $('stream-item'),
    recordItem: $('record-item')
  })

  // ---- Botones de actualización manual ----
  $('scenes-refresh').addEventListener('click', () =>
    scenes.load().catch((e) => reportError(e, 'No se pudieron cargar las escenas')))
  $('mixer-refresh').addEventListener('click', () =>
    mixer.load().catch((e) => reportError(e, 'No se pudo cargar el mezclador')))

  // ---- Sincronización completa tras conectar o reconectar ----
  conn.addEventListener('ready', async () => {
    applyVisibility()
    const results = await Promise.allSettled([
      scenes.load(),
      mixer.load(),
      controls.load(),
      preview.init(),
      status.load()
    ])
    for (const r of results) {
      if (r.status === 'rejected') reportError(r.reason, 'Error al sincronizar con OBS')
    }
  })

  // ---- Estado de la conexión: overlay + barra de estado ----
  const overlay = {
    root: $('overlay'),
    spinner: $('overlay-spinner'),
    title: $('overlay-title'),
    text: $('overlay-text'),
    actions: $('overlay-actions')
  }
  let countdown = null
  let wasConnected = false

  conn.addEventListener('state', (e) => {
    const { state, error, attempt, retryAt } = e.detail
    clearInterval(countdown)
    document.body.classList.toggle('is-offline', state !== 'connected')

    switch (state) {
      case 'connecting':
        status.setConnection(state, 'Conectando…')
        showOverlay('Conectando con OBS…', session.url, { spinner: true })
        break

      case 'connected':
        status.setConnection(state, 'Conectado')
        overlay.root.hidden = true
        if (wasConnected) toast('Conexión restablecida.', 'success')
        wasConnected = true
        break

      case 'reconnecting': {
        status.setConnection(state, 'Reconectando…')
        const base = error?.message ?? 'Conexión perdida.'
        if (!retryAt) {
          showOverlay('Reconectando…', `${base} Intento ${attempt}…`, { spinner: true, actions: true })
          break
        }
        const paint = () => {
          const secs = Math.max(0, Math.ceil((retryAt - Date.now()) / 1000))
          showOverlay('Conexión perdida', `${base} Reintento ${attempt} en ${secs} s.`, { spinner: true, actions: true })
        }
        paint()
        countdown = setInterval(paint, 500)
        break
      }

      case 'failed':
        status.setConnection(state, 'Desconectado')
        // Contraseña cambiada u OBS reiniciado con otra configuración: volver al login
        if (error?.code === 'AUTH_FAILED' || error?.code === 'AUTH_REQUIRED') {
          backToLogin('No se pudo restablecer la sesión: la contraseña de OBS cambió o el servidor se reinició con otra configuración. Ingresa de nuevo.')
          return
        }
        showOverlay('No se pudo conectar', error?.message ?? 'Error desconocido.', { actions: true })
        break
    }
  })

  function showOverlay (title, text, { spinner = false, actions = false } = {}) {
    overlay.title.textContent = title
    overlay.text.textContent = text
    overlay.spinner.hidden = !spinner
    overlay.actions.hidden = !actions
    overlay.root.hidden = false
  }

  function backToLogin (message) {
    conn.stop()
    clearSession()
    if (message) setFlash(message)
    location.replace('index.html')
  }

  $('overlay-retry').addEventListener('click', () => {
    if (conn.state === 'failed') conn.start()
    else conn.retryNow()
  })
  $('overlay-home').addEventListener('click', () => backToLogin())
  $('btn-logout').addEventListener('click', () => backToLogin())

  // ---- Pestaña oculta: sin medidores ni capturas ----
  function applyVisibility () {
    const hidden = document.hidden
    client.reidentify(hidden ? SUBS_HIDDEN : SUBS_VISIBLE)
    preview.setVisible(!hidden)
  }
  document.addEventListener('visibilitychange', applyVisibility)

  // OBS avisa antes de cerrarse; la reconexión automática se encarga del resto
  client.on('ExitStarted', () => toast('OBS se está cerrando.', 'warn'))

  // ---- Sondeos periódicos (tiempos y estadísticas) ----
  setInterval(() => { if (client.connected) controls.tick() }, 1000)
  setInterval(() => { if (client.connected && !document.hidden) status.tick() }, 2000)

  conn.start()
}
