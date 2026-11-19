/**
 * Validación de la URL y manejo de la sesión entre la página de login y el panel.
 *
 * Por qué sessionStorage: el login y el panel son dos páginas distintas y la
 * conexión WebSocket no sobrevive a la navegación, así que el panel necesita
 * volver a autenticarse. Para no guardar la contraseña:
 *   - se guarda solo el "secret" derivado = base64(sha256(contraseña + salt)),
 *     nunca la contraseña en texto plano (que podría reutilizarse en otros sitios);
 *   - sessionStorage se borra al cerrar la pestaña y no se comparte entre pestañas;
 *   - "Salir" la borra al momento y caduca a las 12 h.
 * Opcionalmente se recuerda solo la URL (localStorage), nunca la contraseña.
 */

const SESSION_KEY = 'obsctl.session'
const FLASH_KEY = 'obsctl.flash'
const URL_KEY = 'obsctl.lastUrl'
const MAX_AGE_MS = 12 * 60 * 60 * 1000
const DEFAULT_PORT = '4455'

// El almacenamiento puede estar bloqueado (modo privado, políticas): nunca romper la app.
function safe (fn, fallback = null) {
  try { return fn() } catch { return fallback }
}

/** Normaliza lo que escribe el usuario a una URL ws:// o wss:// válida. */
export function normalizeUrl (raw) {
  let text = String(raw ?? '').trim()
  if (!text) throw new Error('Ingresa la URL del servidor WebSocket.')

  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text)
  if (!hasScheme) text = `ws://${text}`

  let url
  try {
    url = new URL(text)
  } catch {
    throw new Error('La URL no es válida. Ejemplo: ws://192.168.1.50:4455')
  }
  if (url.protocol === 'http:') url.protocol = 'ws:'
  if (url.protocol === 'https:') url.protocol = 'wss:'
  if (url.protocol !== 'ws:' && url.protocol !== 'wss:') {
    throw new Error('La URL debe empezar con ws:// o wss://')
  }
  if (url.username || url.password) {
    throw new Error('No incluyas usuario ni contraseña dentro de la URL.')
  }
  // Sin esquema ni puerto: se asume el puerto por defecto de obs-websocket
  if (!hasScheme && !url.port) url.port = DEFAULT_PORT
  url.hash = ''
  return url
}

export function isLoopback (hostname) {
  return hostname === 'localhost' || hostname.endsWith('.localhost') ||
    hostname === '[::1]' || /^127\./.test(hostname)
}

/**
 * Contenido mixto: una página HTTPS no puede abrir ws:// (sin cifrar).
 * Chrome y Firefox hacen una excepción con localhost; Safari no siempre.
 */
export function checkMixedContent (url) {
  if (location.protocol !== 'https:' || url.protocol !== 'ws:') return null
  if (isLoopback(url.hostname)) {
    return { level: 'warn', message: 'Página HTTPS conectando a ws:// local: Chrome y Firefox lo permiten para localhost; Safari podría bloquearlo.' }
  }
  return {
    level: 'error',
    message: 'Esta página se abrió por HTTPS y el navegador bloquea conexiones ws:// sin cifrar (contenido mixto). Usa wss:// (proxy inverso con TLS) o abre la app por HTTP dentro de tu red local.'
  }
}

/** Guarda la sesión. Devuelve false si el navegador bloquea sessionStorage. */
export function saveSession ({ url, secret }) {
  return safe(() => {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ url, secret, savedAt: Date.now() }))
    return true
  }, false)
}

export function loadSession () {
  const data = safe(() => JSON.parse(sessionStorage.getItem(SESSION_KEY)))
  if (!data?.url) return null
  if (Date.now() - (data.savedAt ?? 0) > MAX_AGE_MS) {
    clearSession()
    return null
  }
  return data
}

export function clearSession () {
  safe(() => sessionStorage.removeItem(SESSION_KEY))
}

/** Mensaje de una sola lectura para mostrar en el login tras una redirección. */
export function setFlash (message) {
  safe(() => sessionStorage.setItem(FLASH_KEY, message))
}

export function takeFlash () {
  const message = safe(() => sessionStorage.getItem(FLASH_KEY))
  safe(() => sessionStorage.removeItem(FLASH_KEY))
  return message
}

/** Recordar solo la URL (opcional). Pasar null para olvidarla. */
export function rememberUrl (url) {
  safe(() => (url ? localStorage.setItem(URL_KEY, url) : localStorage.removeItem(URL_KEY)))
}

export function getRememberedUrl () {
  return safe(() => localStorage.getItem(URL_KEY))
}
