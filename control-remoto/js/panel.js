/**
 * Panel principal: une la conexión con los módulos de la interfaz.
 * Cada módulo se ocupa de un panel; este archivo solo coordina:
 *   - conexión y reconexión (ConnectionManager)
 *   - resincronización completa tras cada (re)conexión
 *   - Modo Estudio: disposición de pantallas y escena de las fuentes
 *   - pausa de medidores y capturas cuando la pestaña está oculta
 */

import { ObsClient, EventSubscription } from './obs-client.js'
import { ConnectionManager } from './connection.js'
import { loadSession, clearSession, setFlash } from './session.js'
import { injectIcons } from './ui/icons.js'
import { ScenesPanel } from './ui/scenes.js'
import { SourcesPanel } from './ui/sources.js'
import { AudioMixer } from './ui/audio.js'
import { Controls } from './ui/controls.js'
import { TransitionsPanel } from './ui/transitions.js'
import { ScreenshotView, PreviewController } from './ui/preview.js'
import { StatusBar } from './ui/status.js'
import { toast, reportError } from './toast.js'

// Eventos normales (incluye Ui: StudioModeStateChanged) + niveles de audio
// (InputVolumeMeters es de alto volumen, ~20 mensajes/s)
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
  const programView = new ScreenshotView({ stage: $('program-stage'), img: $('program-img'), placeholder: $('program-placeholder') })
  const previewView = new ScreenshotView({ stage: $('preview-stage'), img: $('preview-img'), placeholder: $('preview-placeholder') })
  const screenshots = new PreviewController(client, [programView, previewView], {
    toggle: $('preview-toggle'),
    interval: $('preview-interval'),
    rate: $('preview-rate')
  })
  const transitions = new TransitionsPanel(client, {
    trigger: $('btn-transition'),
    select: $('transition-select'),
    duration: $('transition-duration')
  })
  const mixer = new AudioMixer(client, $('mixer'))
  const controls = new Controls(client, {
    streamButton: $('btn-stream'),
    recordButton: $('btn-record'),
    virtualCamButton: $('btn-virtualcam'),
    streamTime: $('stream-time'),
    recordTime: $('record-time'),
    streamItem: $('stream-item'),
    recordItem: $('record-item')
  })

  // ---- Estado de escenas y Modo Estudio ----
  let selectedScene // escena cuyas fuentes se muestran
  const studioBtn = $('btn-studio')

  const scenes = new ScenesPanel(client, $('scene-list'), {
    onChange: ({ studio, program, preview, selected }) => {
      document.body.classList.toggle('is-studio', studio)
      studioBtn.classList.toggle('is-on', studio)
      studioBtn.setAttribute('aria-pressed', String(studio))
      transitions.setStudio(studio)

      $('label-program').textContent = program ?? '—'
      $('label-preview').textContent = preview ?? '—'
      screenshots.setSource(programView, program)
      screenshots.setSource(previewView, studio ? preview : null)

      // En Modo Estudio las fuentes son las de la escena en vista previa (como OBS)
      if (selected !== selectedScene) {
        selectedScene = selected
        sources.load(selected).catch((e) => reportError(e, 'No se pudieron cargar las fuentes'))
      }
    }
  })

  studioBtn.addEventListener('click', async () => {
    studioBtn.disabled = true
    await scenes.toggleStudio()
    studioBtn.disabled = false
  })

  // ---- Botones de actualización manual ----
  $('scenes-refresh').addEventListener('click', () =>
    scenes.load().catch((e) => reportError(e, 'No se pudieron cargar las escenas')))
  $('mixer-refresh').addEventListener('click', () =>
    mixer.load().catch((e) => reportError(e, 'No se pudo cargar el mezclador')))

  // ---- Sincronización completa tras conectar o reconectar ----
  conn.addEventListener('ready', async () => {
    selectedScene = undefined // forzar recarga de fuentes
    applyVisibility()
    const results = await Promise.allSettled([
      scenes.load(),
      transitions.load(),
      mixer.load(),
      controls.load(),
      screenshots.init(),
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
    screenshots.setVisible(!hidden)
  }
  document.addEventListener('visibilitychange', applyVisibility)

  // Al cambiar el tamaño (p. ej. Modo Estudio muestra otra pantalla) pedir capturas nuevas
  let resizeTimer = null
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer)
    resizeTimer = setTimeout(() => screenshots.refresh(), 300)
  })

  // OBS avisa antes de cerrarse; la reconexión automática se encarga del resto
  client.on('ExitStarted', () => toast('OBS se está cerrando.', 'warn'))

  // ---- Sondeos periódicos (tiempos y estadísticas) ----
  setInterval(() => { if (client.connected) controls.tick() }, 1000)
  setInterval(() => { if (client.connected && !document.hidden) status.tick() }, 2000)

  conn.start()
}
