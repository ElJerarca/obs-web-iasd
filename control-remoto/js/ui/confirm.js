/**
 * Modal de confirmación propio (reemplaza a window.confirm, que el navegador
 * puede bloquear y que no sigue el estilo de la app).
 * Devuelve una Promise<boolean>: true si el usuario confirma.
 *
 * Accesibilidad: role="alertdialog", foco inicial en "Cancelar" (la opción
 * segura), Esc cancela, el foco queda atrapado dentro del modal y vuelve al
 * botón de origen al cerrar.
 */

import { el } from '../dom.js'

let counter = 0

export function confirmDialog ({ title, message, confirmText = 'Aceptar', cancelText = 'Cancelar', danger = false }) {
  return new Promise((resolve) => {
    const previousFocus = document.activeElement
    const id = `confirm-${++counter}`

    const cancelBtn = el('button', { type: 'button', class: 'btn', text: cancelText })
    const okBtn = el('button', { type: 'button', class: `btn ${danger ? 'btn--danger' : 'btn--primary'}`, text: confirmText })
    const card = el('div', {
      class: 'modal__card',
      role: 'alertdialog',
      'aria-modal': 'true',
      'aria-labelledby': `${id}-title`,
      'aria-describedby': `${id}-msg`
    },
    el('h2', { id: `${id}-title`, text: title }),
    el('p', { id: `${id}-msg`, text: message }),
    el('div', { class: 'modal__actions' }, cancelBtn, okBtn)
    )
    const root = el('div', { class: 'modal' }, card)

    const close = (result) => {
      document.removeEventListener('keydown', onKey, true)
      root.remove()
      previousFocus?.focus?.()
      resolve(result)
    }

    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        close(false)
      } else if (e.key === 'Tab') {
        // Mantener el foco entre los dos botones
        e.preventDefault()
        ;(document.activeElement === cancelBtn ? okBtn : cancelBtn).focus()
      }
    }

    cancelBtn.addEventListener('click', () => close(false))
    okBtn.addEventListener('click', () => close(true))
    root.addEventListener('click', (e) => { if (e.target === root) close(false) })
    document.addEventListener('keydown', onKey, true)

    document.body.append(root)
    cancelBtn.focus()
  })
}
