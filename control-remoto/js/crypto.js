/**
 * Hash para la autenticación de obs-websocket v5.
 *
 * El protocolo define:
 *   secret = base64(sha256(contraseña + salt))
 *   auth   = base64(sha256(secret + challenge))
 *
 * crypto.subtle solo existe en "contextos seguros" (HTTPS o localhost).
 * Si la app se abre por HTTP desde una IP de la red local
 * (p. ej. http://192.168.1.10:8080) no está disponible, así que se usa
 * la implementación propia de SHA-256 de este archivo como respaldo.
 */

const encoder = new TextEncoder()

/** Devuelve base64(sha256(texto)) */
export async function sha256Base64 (text) {
  const data = encoder.encode(text)
  const digest = globalThis.crypto?.subtle
    ? new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', data))
    : sha256(data)
  let bin = ''
  for (const b of digest) bin += String.fromCharCode(b)
  return btoa(bin)
}

// Constantes de SHA-256 (FIPS 180-4): primeros 32 bits de la parte
// fraccionaria de las raíces cuadradas (H0) y cúbicas (K) de los primeros
// números primos. Se calculan en vez de escribirse a mano para evitar erratas.
const { H0, K } = (() => {
  const primes = []
  for (let n = 2; primes.length < 64; n++) {
    if (primes.every((p) => n % p !== 0)) primes.push(n)
  }
  const frac = (x) => ((x - Math.floor(x)) * 0x100000000) >>> 0
  return {
    H0: Uint32Array.from(primes.slice(0, 8), (p) => frac(Math.sqrt(p))),
    K: Uint32Array.from(primes, (p) => frac(Math.cbrt(p)))
  }
})()

const rotr = (x, n) => (x >>> n) | (x << (32 - n))

/** SHA-256 en JavaScript puro. Recibe y devuelve Uint8Array. */
export function sha256 (bytes) {
  const len = bytes.length
  const total = Math.ceil((len + 9) / 64) * 64
  const buf = new Uint8Array(total)
  buf.set(bytes)
  buf[len] = 0x80
  const view = new DataView(buf.buffer)
  const bits = len * 8
  view.setUint32(total - 8, Math.floor(bits / 0x100000000))
  view.setUint32(total - 4, bits >>> 0)

  const h = Uint32Array.from(H0)
  const w = new Uint32Array(64)

  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4)
    for (let i = 16; i < 64; i++) {
      const x = w[i - 15]
      const y = w[i - 2]
      const s0 = rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3)
      const s1 = rotr(y, 17) ^ rotr(y, 19) ^ (y >>> 10)
      w[i] = w[i - 16] + s0 + w[i - 7] + s1 // Uint32Array aplica el módulo 2^32
    }

    let [a, b, c, d, e, f, g, hh] = h
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)
      const ch = (e & f) ^ (~e & g)
      const t1 = (hh + S1 + ch + K[i] + w[i]) | 0
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)
      const maj = (a & b) ^ (a & c) ^ (b & c)
      const t2 = (S0 + maj) | 0
      hh = g
      g = f
      f = e
      e = (d + t1) | 0
      d = c
      c = b
      b = a
      a = (t1 + t2) | 0
    }
    h[0] += a
    h[1] += b
    h[2] += c
    h[3] += d
    h[4] += e
    h[5] += f
    h[6] += g
    h[7] += hh
  }

  const out = new Uint8Array(32)
  const ov = new DataView(out.buffer)
  for (let i = 0; i < 8; i++) ov.setUint32(i * 4, h[i])
  return out
}
