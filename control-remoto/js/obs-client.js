/**
 * Cliente mínimo de obs-websocket v5 (OBS 28+, RPC versión 1), sin dependencias.
 * Referencia del protocolo:
 * https://github.com/obsproject/obs-websocket/blob/master/docs/generated/protocol.md
 *
 * Flujo de conexión:
 *   1. El servidor envía Hello (op 0), con `authentication: { challenge, salt }`
 *      si tiene contraseña.
 *   2. El cliente responde Identify (op 1) con rpcVersion, el hash de
 *      autenticación y la máscara de eventos a los que se suscribe.
 *   3. El servidor confirma con Identified (op 2) o cierra el socket con un
 *      código 4xxx (p. ej. 4009 = autenticación fallida).
 */

import { sha256Base64 } from './crypto.js'

export const OpCode = Object.freeze({
  Hello: 0,
  Identify: 1,
  Identified: 2,
  Reidentify: 3,
  Event: 5,
  Request: 6,
  RequestResponse: 7
})

/** Máscara de suscripción a eventos (EventSubscription en el protocolo). */
export const EventSubscription = Object.freeze({
  None: 0,
  General: 1 << 0,
  Config: 1 << 1,
  Scenes: 1 << 2,
  Inputs: 1 << 3,
  Transitions: 1 << 4,
  Filters: 1 << 5,
  Outputs: 1 << 6,
  SceneItems: 1 << 7,
  MediaInputs: 1 << 8,
  Vendors: 1 << 9,
  Ui: 1 << 10,
  /** Todos los eventos de bajo volumen (no incluye los de alto volumen) */
  All: (1 << 11) - 1,
  // Eventos de alto volumen: hay que pedirlos explícitamente
  /** Niveles de audio de todas las entradas activas, cada ~50 ms */
  InputVolumeMeters: 1 << 16,
  InputActiveStateChanged: 1 << 17,
  InputShowStateChanged: 1 << 18,
  SceneItemTransformChanged: 1 << 19
})

/** Códigos de cierre WebSocket propios de obs-websocket (WebSocketCloseCode). */
export const CloseCode = Object.freeze({
  UnknownReason: 4000,
  MessageDecodeError: 4002,
  MissingDataField: 4003,
  InvalidDataFieldType: 4004,
  InvalidDataFieldValue: 4005,
  UnknownOpCode: 4006,
  NotIdentified: 4007,
  AlreadyIdentified: 4008,
  AuthenticationFailed: 4009,
  UnsupportedRpcVersion: 4010,
  SessionInvalidated: 4011,
  UnsupportedFeature: 4012
})

const RPC_VERSION = 1
const CONNECT_TIMEOUT_MS = 8000
const REQUEST_TIMEOUT_MS = 10000

/** Error con información para decidir si conviene reintentar. */
export class ObsError extends Error {
  constructor (message, { code = null, closeCode = null, fatal = false } = {}) {
    super(message)
    this.name = 'ObsError'
    this.code = code // código de la petición o identificador propio (AUTH_FAILED…)
    this.closeCode = closeCode // código de cierre del WebSocket, si aplica
    this.fatal = fatal // true = reintentar no sirve (contraseña, versión, etc.)
  }
}

/** Traduce un cierre del socket a un mensaje claro para el usuario. */
function closeToError (ev, wasIdentified) {
  const reason = ev.reason ? ` (${ev.reason})` : ''
  switch (ev.code) {
    case CloseCode.AuthenticationFailed:
      return new ObsError('Contraseña incorrecta.', { code: 'AUTH_FAILED', closeCode: ev.code, fatal: true })
    case CloseCode.UnsupportedRpcVersion:
      return new ObsError('Versión de protocolo no soportada. Se requiere OBS 28 o superior (obs-websocket v5).', { closeCode: ev.code, fatal: true })
    case CloseCode.SessionInvalidated:
      return new ObsError('OBS cerró esta sesión (sesión invalidada).', { closeCode: ev.code, fatal: true })
    case 1000:
    case 1001:
      return new ObsError(wasIdentified ? 'OBS cerró la conexión.' : `El servidor cerró la conexión${reason}.`, { closeCode: ev.code })
    case 1006:
      return new ObsError(wasIdentified
        ? 'Se perdió la conexión con OBS.'
        : 'No se pudo conectar. Verifica la URL y el puerto, que OBS esté abierto con el servidor WebSocket habilitado y que el firewall permita la conexión.',
      { closeCode: ev.code })
    default:
      return new ObsError(`Conexión cerrada (código ${ev.code})${reason}.`, { closeCode: ev.code, fatal: ev.code >= 4000 && ev.code < 4009 })
  }
}

export class ObsClient extends EventTarget {
  #ws = null
  #identified = false
  #subs = EventSubscription.None
  #nextId = 1
  #pending = new Map() // requestId -> { resolve, reject, timer, ws }
  #intentional = new WeakSet() // sockets cerrados a propósito

  /** Datos del Hello recibido (versión de obs-websocket, etc.) */
  helloInfo = null

  get connected () {
    return this.#identified && this.#ws?.readyState === WebSocket.OPEN
  }

  /**
   * Abre la conexión y completa Hello/Identify.
   * Se puede pasar la contraseña o el `secret` ya derivado (ver README, seguridad).
   * Resuelve con { secret, negotiatedRpcVersion, obsWebSocketVersion }.
   */
  connect ({ url, password = null, secret = null, eventSubscriptions = EventSubscription.All, timeoutMs = CONNECT_TIMEOUT_MS }) {
    this.disconnect()

    return new Promise((resolve, reject) => {
      let ws
      try {
        ws = new WebSocket(url)
      } catch (err) {
        // SecurityError: contenido mixto (página HTTPS -> ws://). SyntaxError: URL inválida.
        const message = err?.name === 'SecurityError'
          ? 'El navegador bloqueó la conexión: una página HTTPS no puede abrir un ws:// sin cifrar. Usa wss://.'
          : `URL de WebSocket no válida: ${err.message}`
        reject(new ObsError(message, { code: 'BAD_URL', fatal: true }))
        return
      }

      this.#ws = ws
      let settled = false
      let identified = false
      let derivedSecret = secret

      const fail = (error) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        reject(error)
      }

      const timer = setTimeout(() => {
        fail(new ObsError('Tiempo de espera agotado al conectar con OBS. Verifica la URL y que el servidor esté accesible.', { code: 'TIMEOUT' }))
        this.#intentional.add(ws)
        ws.close()
      }, timeoutMs)

      ws.onmessage = async (ev) => {
        let msg
        try {
          msg = JSON.parse(ev.data)
        } catch {
          return // mensaje no JSON: se ignora
        }
        const d = msg.d ?? {}

        switch (msg.op) {
          case OpCode.Hello: {
            this.helloInfo = d
            const identify = { rpcVersion: RPC_VERSION, eventSubscriptions }
            try {
              if (d.authentication) {
                if (!derivedSecret) {
                  if (!password) {
                    fail(new ObsError('El servidor requiere contraseña.', { code: 'AUTH_REQUIRED', fatal: true }))
                    this.#intentional.add(ws)
                    ws.close()
                    return
                  }
                  derivedSecret = await sha256Base64(password + d.authentication.salt)
                }
                identify.authentication = await sha256Base64(derivedSecret + d.authentication.challenge)
              } else {
                derivedSecret = null // servidor sin contraseña
              }
            } catch (err) {
              fail(new ObsError(`No se pudo calcular la autenticación: ${err.message}`, { fatal: true }))
              this.#intentional.add(ws)
              ws.close()
              return
            }
            this.#subs = eventSubscriptions
            this.#send(ws, OpCode.Identify, identify)
            break
          }

          case OpCode.Identified:
            // También llega tras un Reidentify: solo cuenta la primera vez
            if (settled) break
            settled = true
            identified = true
            clearTimeout(timer)
            if (this.#ws === ws) this.#identified = true
            resolve({
              secret: derivedSecret,
              negotiatedRpcVersion: d.negotiatedRpcVersion,
              obsWebSocketVersion: this.helloInfo?.obsWebSocketVersion
            })
            break

          case OpCode.Event:
            this.dispatchEvent(new CustomEvent(`obs:${d.eventType}`, { detail: d.eventData ?? {} }))
            break

          case OpCode.RequestResponse: {
            const entry = this.#pending.get(d.requestId)
            if (!entry) break
            this.#pending.delete(d.requestId)
            clearTimeout(entry.timer)
            const status = d.requestStatus ?? {}
            if (status.result) {
              entry.resolve(d.responseData ?? {})
            } else {
              const detail = status.comment || `código ${status.code}`
              entry.reject(new ObsError(`${d.requestType}: ${detail}`, { code: status.code }))
            }
            break
          }
        }
      }

      ws.onclose = (ev) => {
        const intentional = this.#intentional.has(ws)
        if (this.#ws === ws) {
          this.#ws = null
          this.#identified = false
        }
        this.#rejectPending(ws, new ObsError('Conexión cerrada antes de recibir respuesta.', { code: 'NOT_CONNECTED' }))
        const error = closeToError(ev, identified)
        fail(error)
        if (identified) {
          this.dispatchEvent(new CustomEvent('close', { detail: { code: ev.code, reason: ev.reason, error, intentional } }))
        }
      }

      // onerror no da detalles por seguridad; siempre le sigue onclose.
      ws.onerror = () => {}
    })
  }

  /** Cierra la conexión actual de forma intencional (sin reconexión). */
  disconnect () {
    const ws = this.#ws
    if (!ws) return
    this.#intentional.add(ws)
    this.#ws = null
    this.#identified = false
    try { ws.close(1000) } catch { /* ya cerrado */ }
  }

  /** Cambia la suscripción de eventos sin reconectar (op 3 Reidentify). */
  reidentify (eventSubscriptions) {
    if (!this.connected || eventSubscriptions === this.#subs) return
    this.#subs = eventSubscriptions
    this.#send(this.#ws, OpCode.Reidentify, { eventSubscriptions })
  }

  /** Envía una petición (op 6) y resuelve con su responseData. */
  call (requestType, requestData) {
    if (!this.connected) {
      return Promise.reject(new ObsError('No hay conexión con OBS.', { code: 'NOT_CONNECTED' }))
    }
    const ws = this.#ws
    const requestId = String(this.#nextId++)
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(requestId)
        reject(new ObsError(`${requestType}: OBS no respondió a tiempo.`, { code: 'TIMEOUT' }))
      }, REQUEST_TIMEOUT_MS)
      this.#pending.set(requestId, { resolve, reject, timer, ws })
      const d = { requestType, requestId }
      if (requestData) d.requestData = requestData
      this.#send(ws, OpCode.Request, d)
    })
  }

  /** Escucha un evento de OBS. Devuelve una función para dejar de escuchar. */
  on (eventType, handler) {
    const listener = (e) => handler(e.detail)
    this.addEventListener(`obs:${eventType}`, listener)
    return () => this.removeEventListener(`obs:${eventType}`, listener)
  }

  #send (ws, op, d) {
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ op, d }))
  }

  #rejectPending (ws, error) {
    for (const [id, entry] of this.#pending) {
      if (entry.ws !== ws) continue
      clearTimeout(entry.timer)
      this.#pending.delete(id)
      entry.reject(error)
    }
  }
}
