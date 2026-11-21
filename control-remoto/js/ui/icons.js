/**
 * Iconografía propia (SVG en línea), inspirada en el estilo plano de OBS
 * pero sin usar logotipos ni recursos oficiales.
 * Trazos de 2 px sobre una cuadrícula de 24×24, color = currentColor.
 */

const svg = (body, size = 16) =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`

export const icons = {
  logo: `<svg viewBox="0 0 48 48" width="40" height="40" aria-hidden="true" focusable="false">
    <rect x="3" y="3" width="42" height="42" rx="11" fill="#2a4fc9"/>
    <rect x="3.5" y="3.5" width="41" height="41" rx="10.5" fill="none" stroke="#5277f0"/>
    <path d="M19 15.5v17l13.5-8.5z" fill="#fff"/>
    <path d="M36 12.5a16 16 0 0 1 0 23" fill="none" stroke="#bcd0ff" stroke-width="2.5" stroke-linecap="round"/>
  </svg>`,
  logoSmall: `<svg viewBox="0 0 48 48" width="22" height="22" aria-hidden="true" focusable="false">
    <rect x="3" y="3" width="42" height="42" rx="11" fill="#2a4fc9"/>
    <path d="M19 15.5v17l13.5-8.5z" fill="#fff"/>
  </svg>`,
  scenes: svg('<rect x="3" y="8" width="14" height="12" rx="1.5"/><path d="M7 4h12.5A1.5 1.5 0 0 1 21 5.5V16"/>'),
  sources: svg('<rect x="3" y="4" width="18" height="12" rx="1.5"/><path d="M8 20h8M12 16v4"/>'),
  mixer: svg('<path d="M6 4v16M12 4v16M18 4v16"/><path d="M4 14h4M10 8h4M16 12h4"/>'),
  controls: svg('<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/>'),
  eye: svg('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
  eyeOff: svg('<path d="M3 3l18 18"/><path d="M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.1 6.1C3.4 7.9 2 12 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.9-2.1"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>'),
  volume: svg('<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/>'),
  volumeOff: svg('<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M17 9l5 6M22 9l-5 6"/>'),
  stream: svg('<circle cx="12" cy="12" r="2"/><path d="M8.5 8.5a5 5 0 0 0 0 7M15.5 8.5a5 5 0 0 1 0 7M5.6 5.6a9 9 0 0 0 0 12.8M18.4 5.6a9 9 0 0 1 0 12.8"/>'),
  record: svg('<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.5" fill="currentColor"/>'),
  logout: svg('<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l-5-5 5-5M5 12h11"/>'),
  image: svg('<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="1.5"/><path d="M21 16l-5-5-8 8"/>'),
  refresh: svg('<path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/>'),
  group: svg('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
  empty: svg('<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5v.2M12 16.5v.01"/>', 40),
  lock: svg('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>'),
  unlock: svg('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 7.5-2"/>'),
  transition: svg('<path d="M4 12h13M13 7l5 5-5 5"/><path d="M20 5v14"/>'),
  studio: svg('<rect x="2" y="6" width="9" height="9" rx="1.5"/><rect x="13" y="6" width="9" height="9" rx="1.5"/><path d="M6.5 19h11"/>'),
  camera: svg('<rect x="3" y="7" width="13" height="10" rx="2"/><path d="M16 11l5-3v8l-5-3"/>'),
  plug: svg('<path d="M9 3v5M15 3v5M7 8h10v4a5 5 0 0 1-10 0zM12 17v4"/>')
}

/** Rellena los elementos con data-icon="nombre" con el SVG correspondiente. */
export function injectIcons (root = document) {
  for (const node of root.querySelectorAll('[data-icon]')) {
    node.innerHTML = icons[node.dataset.icon] ?? ''
  }
}
