/**
 * Página de inicio: valida la URL, prueba la autenticación contra OBS y,
 * si es correcta, guarda la sesión (solo el secret derivado) y abre el panel.
 */

import { ObsClient, EventSubscription } from './obs-client.js'
import {
  normalizeUrl, checkMixedContent, saveSession, loadSession,
  takeFlash, rememberUrl, getRememberedUrl
} from './session.js'
import { injectIcons, icons } from './ui/icons.js'

// Si ya hay una sesión activa en esta pestaña, ir directo al panel
if (loadSession()) location.replace('panel.html')

injectIcons()

const form = document.getElementById('login-form')
const urlInput = document.getElementById('url')
const passInput = document.getElementById('password')
const remember = document.getElementById('remember-url')
const toggle = document.getElementById('toggle-password')
const submit = document.getElementById('submit')
const msg = document.getElementById('login-msg')
const hint = document.getElementById('context-hint')

function showMessage (text, level = 'error') {
  msg.textContent = text
  msg.className = `msg msg--${level}`
  msg.hidden = false
}

function hideMessage () {
  msg.hidden = true
}

function setBusy (busy) {
  submit.disabled = busy
  urlInput.disabled = busy
  passInput.disabled = busy
  submit.querySelector('.btn__text').textContent = busy ? 'Conectando…' : 'Conectar'
  submit.classList.toggle('is-busy', busy)
}

// Estado inicial
const savedUrl = getRememberedUrl()
if (savedUrl) {
  urlInput.value = savedUrl
  remember.checked = true
  passInput.focus()
} else {
  urlInput.focus()
}

const flash = takeFlash()
if (flash) showMessage(flash, 'warn')

if (location.protocol === 'https:') {
  hint.textContent = 'Página servida por HTTPS: para un OBS remoto necesitas una URL wss://.'
}

// Mostrar / ocultar contraseña
toggle.addEventListener('click', () => {
  const show = passInput.type === 'password'
  passInput.type = show ? 'text' : 'password'
  toggle.innerHTML = show ? icons.eyeOff : icons.eye
  toggle.setAttribute('aria-label', show ? 'Ocultar contraseña' : 'Mostrar contraseña')
  toggle.setAttribute('aria-pressed', String(show))
})

form.addEventListener('submit', async (event) => {
  event.preventDefault()
  hideMessage()

  let url
  try {
    url = normalizeUrl(urlInput.value)
  } catch (err) {
    showMessage(err.message)
    urlInput.focus()
    return
  }
  urlInput.value = url.href

  const mixed = checkMixedContent(url)
  if (mixed?.level === 'error') {
    showMessage(mixed.message)
    return
  }

  setBusy(true)
  const client = new ObsClient()
  try {
    // Solo se valida la autenticación: sin suscripción a eventos
    const info = await client.connect({
      url: url.href,
      password: passInput.value || null,
      eventSubscriptions: EventSubscription.None
    })
    client.disconnect()

    if (!saveSession({ url: url.href, secret: info.secret })) {
      throw new Error('El navegador bloquea el almacenamiento de sesión (sessionStorage). Habilítalo para continuar.')
    }
    rememberUrl(remember.checked ? url.href : null)
    passInput.value = '' // no dejar la contraseña en el DOM
    location.replace('panel.html')
  } catch (err) {
    client.disconnect()
    showMessage(err.message, 'error')
    setBusy(false)
    if (err.code === 'AUTH_FAILED' || err.code === 'AUTH_REQUIRED') {
      passInput.focus()
      passInput.select()
    }
    if (mixed?.level === 'warn') showMessage(`${err.message} ${mixed.message}`, 'error')
  }
})
