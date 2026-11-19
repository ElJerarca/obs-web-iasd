/** Notificaciones breves en la esquina inferior derecha. */

import { el } from './dom.js'

export function toast (message, type = 'info', ms = 4500) {
  const host = document.getElementById('toasts')
  if (!host) return
  const node = el('div', {
    class: `toast toast--${type}`,
    role: type === 'error' ? 'alert' : 'status',
    text: message
  })
  host.append(node)
  setTimeout(() => {
    node.classList.add('toast--out')
    setTimeout(() => node.remove(), 300)
  }, ms)
}

/** Muestra un error al usuario y lo deja en la consola para depurar. */
export function reportError (error, context) {
  console.error(context, error)
  // Si no hay conexión, el overlay de reconexión ya informa al usuario
  if (error?.code === 'NOT_CONNECTED') return
  toast(context ? `${context}: ${error.message}` : error.message, 'error', 6000)
}
