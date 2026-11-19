/**
 * Utilidades de DOM.
 * Los nombres de escenas y fuentes vienen de OBS: se insertan siempre como
 * texto (textContent), nunca como HTML, para evitar inyección de código.
 */

/**
 * Crea un elemento. props admite: class, text, html (solo iconos propios),
 * dataset, on<evento> (funciones) y cualquier atributo.
 */
export function el (tag, props = {}, ...children) {
  const node = document.createElement(tag)
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue
    if (key === 'class') node.className = value
    else if (key === 'text') node.textContent = value
    else if (key === 'html') node.innerHTML = value
    else if (key === 'dataset') Object.assign(node.dataset, value)
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value)
    else node.setAttribute(key, value === true ? '' : String(value))
  }
  for (const child of children.flat()) {
    if (child != null) node.append(child)
  }
  return node
}

export function debounce (fn, ms) {
  let timer = null
  return (...args) => {
    clearTimeout(timer)
    timer = setTimeout(() => fn(...args), ms)
  }
}
