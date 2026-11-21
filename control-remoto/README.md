# Control remoto OBS (HTML + CSS + JS puro)

Aplicación web para controlar OBS Studio a distancia a través de su servidor
WebSocket (obs-websocket v5, incluido en OBS 28 o superior). No tiene
dependencias ni paso de compilación: son archivos estáticos.

- **Inicio de sesión** con la URL del servidor y la contraseña.
- **Disposición tipo OBS**: arriba las pantallas y abajo Escenas, Fuentes,
  Mezclador de audio y Controles.
- **Modo Estudio** (se activa y desactiva desde la app): *Vista previa* a la
  izquierda y *Programa* a la derecha. En el centro, el botón **Transición** y
  los selectores de tipo y duración. Al hacer clic en una escena, va a la vista
  previa; la escena al aire lleva la marca **PGM**.
- **Escenas**: lista y cambio de escena (de programa, o de vista previa en Modo Estudio).
- **Fuentes**: elementos de la escena seleccionada, con botones para mostrar u
  ocultar (ojo) y bloquear (candado).
- **Mezclador de audio**: volumen, silencio y medidores animados en tiempo real.
- **Controles**: transmisión, grabación (con cronómetro), cámara virtual y Modo Estudio.
- **Pantallas**: capturas periódicas de programa y de vista previa (1, 2 o 5 s),
  que se pueden pausar.
- **Errores y reconexión**: contraseña incorrecta, servidor caído o reiniciado,
  pérdida de red y reconexión automática con espera exponencial.

## Estructura

```
control-remoto/
├── iniciar.bat           Windows: levanta el servidor web con doble clic
├── instalar-arranque.bat Windows: arranque automático al iniciar sesión
├── quitar-arranque.bat   Windows: quita el arranque automático
├── index.html            Página de inicio de sesión
├── panel.html            Panel principal (disposición tipo OBS)
├── css/
│   ├── base.css          Variables del tema oscuro, botones, campos, notificaciones
│   ├── login.css         Estilos del inicio de sesión
│   └── panel.css         Rejilla de paneles, mezclador, barra de estado, responsive
└── js/
    ├── crypto.js         SHA-256 + Base64 para la autenticación (con respaldo sin crypto.subtle)
    ├── obs-client.js     Cliente del protocolo: Hello/Identify, peticiones, eventos, Reidentify
    ├── connection.js     Reconexión automática con espera exponencial
    ├── session.js        Validación de la URL, contenido mixto, sessionStorage
    ├── dom.js            Utilidades de DOM (siempre textContent para datos de OBS)
    ├── toast.js          Notificaciones
    ├── login.js          Lógica de la página de inicio
    ├── panel.js          Orquestación del panel
    └── ui/
        ├── icons.js      Iconos SVG propios
        ├── scenes.js     Panel Escenas y estado del Modo Estudio
        ├── sources.js    Panel Fuentes
        ├── audio.js      Mezclador y medidores (canvas + requestAnimationFrame)
        ├── controls.js   Transmisión, grabación y cámara virtual
        ├── confirm.js    Modal de confirmación (p. ej. al detener la transmisión)
        ├── transitions.js Botón Transición, tipo y duración (Modo Estudio)
        ├── preview.js    Pantallas de programa y vista previa por capturas
        └── status.js     Barra de estado (conexión, CPU, FPS)
```

## 1. Habilitar el servidor WebSocket en OBS

1. En OBS: **Herramientas → Ajustes del servidor WebSocket**.
2. Marca **Habilitar servidor WebSocket**. El puerto por defecto es **4455**.
3. Deja activada **Habilitar autenticación** y define una contraseña.
4. Con **Mostrar información de conexión** ves la IP, el puerto y la contraseña.
5. Si te conectas desde otro equipo, permite el puerto **TCP 4455** en el
   firewall del PC donde corre OBS. En Windows lo pide la primera vez; si no,
   agrega una regla de entrada en *Firewall de Windows Defender*.

## 2. Ejecutar la aplicación

Los módulos ES (`<script type="module">`) **no funcionan abriendo el archivo
con doble clic** (`file://`). Hay que servir la carpeta con cualquier servidor
estático:

```bash
cd control-remoto
python3 -m http.server 8080        # o: npx serve -l 8080
```

- En el mismo PC que OBS: abre `http://localhost:8080` y usa `ws://localhost:4455`.
- Desde otro dispositivo de la red (tablet, celular): abre
  `http://IP-DEL-SERVIDOR:8080` y usa `ws://IP-DEL-PC-CON-OBS:4455`.

En el campo URL puedes escribir solo `192.168.1.50`: se completa a
`ws://192.168.1.50:4455`.

### En Windows con doble clic (PC donde está OBS)

En la carpeta hay tres scripts:

| Archivo | Qué hace |
|---|---|
| `iniciar.bat` | Busca Python, comprueba que el puerto 8080 esté libre, muestra las direcciones para entrar desde la red y levanta el servidor. Se detiene cerrando la ventana. |
| `instalar-arranque.bat` | Crea un acceso directo minimizado en la carpeta *Inicio* de Windows. El servidor arranca solo al iniciar sesión. No pide administrador. |
| `quitar-arranque.bat` | Quita ese arranque automático. |

Requisitos: Python instalado (`winget install Python.Python.3.12`) y el puerto
8080 permitido en el firewall (red de perfil *Privada*):

```powershell
New-NetFirewallRule -DisplayName "Control remoto OBS - Web" -Direction Inbound -Protocol TCP -LocalPort 8080 -Action Allow -Profile Private
```

Si mueves la carpeta, vuelve a ejecutar `instalar-arranque.bat`.

### Publicarlo bajo HTTPS (opcional)

Una página HTTPS solo puede conectarse a `wss://`. obs-websocket no ofrece TLS
propio, así que se pone un proxy inverso delante. Ejemplo con nginx:

```nginx
server {
    listen 443 ssl;
    server_name obs.midominio.local;
    ssl_certificate     /etc/ssl/obs.crt;
    ssl_certificate_key /etc/ssl/obs.key;

    root /var/www/control-remoto;          # archivos de esta carpeta

    location /ws {                          # en la app: wss://obs.midominio.local/ws
        proxy_pass http://IP-DEL-PC-CON-OBS:4455;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 1h;
    }
}
```

## 3. Seguridad y limitaciones

### Contraseña

- La contraseña **nunca** va en la URL. Los campos del formulario no tienen
  `name`, así que ni un fallo de JavaScript puede enviarla en un GET. Tampoco se
  guarda en `localStorage`.
- **Uso justificado de sessionStorage.** El login y el panel son páginas
  distintas y la conexión no sobrevive a la navegación, así que el panel debe
  volver a autenticarse. Por eso se guarda solo el *secret* derivado
  `base64(sha256(contraseña + salt))`, no la contraseña en texto plano (que el
  usuario podría reutilizar en otros servicios). Además:
  - `sessionStorage` se borra al cerrar la pestaña y no se comparte con otras pestañas;
  - **Salir** la borra al instante y caduca a las 12 h.
- Consecuencia: obs-websocket genera un *salt* nuevo cuando el servidor se
  reinicia (al reiniciar OBS o cambiar la contraseña). En ese caso el secret
  guardado deja de servir y la app vuelve al login con un mensaje. *Verificar*
  este comportamiento en tu versión; en cualquier caso, la app lo maneja.
- El secret también da acceso a OBS mientras el servidor no se reinicie: trátalo
  como una credencial. Un script inyectado en la página podría leerlo. Para
  mitigarlo, la página tiene una CSP estricta (`script-src 'self'`, sin scripts
  externos) y los nombres que llegan de OBS se insertan siempre como texto.
- Si prefieres no guardar nada, conviértela en SPA (ver sección 4): el secret
  queda solo en memoria.
- **No expongas el puerto 4455 a Internet.** Quien tenga la contraseña controla
  OBS por completo. Para acceso remoto usa una VPN (WireGuard, Tailscale) o el
  proxy HTTPS anterior con restricción por IP.

### Contenido mixto (HTTPS → ws://)

- Si la página se sirve por HTTPS, el navegador **bloquea** `ws://` hacia otros
  equipos. La app lo detecta antes de conectar y lo explica. Hay dos salidas:
  usar `wss://` (proxy con TLS) o servir la app por HTTP dentro de la red local.
- Chrome y Firefox permiten `ws://localhost` desde HTTPS; Safari puede no hacerlo.
- Por HTTP desde una IP de la red, `crypto.subtle` no existe (no es un *contexto
  seguro*). Por eso `crypto.js` incluye un SHA-256 propio, verificado contra el
  de Node.js.

### Vista previa

- El protocolo **no transmite video**. La vista previa son capturas JPEG
  (`GetSourceScreenshot`) enviadas en Base64 por el mismo WebSocket, a 1, 2 o 5 s
  por imagen.
- Intervalos de 0,25 s a 5 s. Cuanto más rápido, más pequeña y comprimida es
  la imagen (0,25 s: 640 px, calidad 35; 0,5 s: 800 px; 1 s: 960 px; 2–5 s:
  hasta 1280 px). El intervalo cuenta desde el inicio de cada captura, y la barra
  muestra las **img/s** reales. Con 0,25 s se logran unas 3–4 img/s si OBS
  responde rápido.
- Cada captura obliga a OBS a renderizar y codificar una imagen. En Modo Estudio
  son dos por ciclo. Si el CPU de la barra de estado sube mucho o la transmisión
  pierde fotogramas, usa 1 s o más; el ajuste se recuerda en el navegador.
- No hay audio, y la imagen tiene uno o más segundos de retraso.
- Se pausa sola si la pestaña está oculta o no hay conexión. Nunca se piden dos
  capturas a la vez.

### Otras limitaciones conocidas

- Las fuentes dentro de un **grupo** no se listan; el grupo aparece como un solo elemento.
- No incluye las **transiciones rápidas** ni la **barra T** de OBS. Las
  transiciones rápidas son una configuración de la interfaz de OBS que el
  protocolo no expone. Se usa la transición elegida en el selector.
- Con dos pantallas en Modo Estudio se piden dos capturas por ciclo. Si OBS va
  justo, sube el intervalo a 5 s.
- La cámara virtual queda deshabilitada si OBS no la tiene disponible.
- El fader vertical usa `writing-mode` en el `input range` (Chrome 124+,
  Firefox, Safari 17.4+). En navegadores más antiguos se ve horizontal, pero
  funciona.

### Elementos del protocolo a verificar

Todo lo usado figura en la documentación oficial
(<https://github.com/obsproject/obs-websocket/blob/master/docs/generated/protocol.md>),
pero conviene confirmar estos detalles en tu versión:

| Elemento | Supuesto en el código |
|---|---|
| `InputVolumeMeters.inputs[].inputLevelsMul` | Un arreglo por canal `[magnitud, pico, pico de entrada]`; la barra usa el pico |
| Orden de `GetSceneList.scenes` y `GetSceneItemList.sceneItems` | Índice 0 = el de abajo; se invierten para igualar la vista de OBS |
| `GetInputList` | Incluye las entradas de audio globales (Audio del escritorio, Mic/Aux) |
| `outputState` de `StreamStateChanged` / `RecordStateChanged` | Valores `OBS_WEBSOCKET_OUTPUT_STARTING/STARTED/STOPPING/STOPPED…` |
| `GetSceneItemList.sceneItems[].sceneItemLocked` | Indica si el elemento está bloqueado |
| `GetSourceScreenshot.imageFormat` | Se elige de `GetVersion.supportedImageFormats` (jpg → png) |

Peticiones usadas: `GetSceneList`, `SetCurrentProgramScene`, `GetSceneItemList`,
`SetSceneItemEnabled`, `SetSceneItemLocked`, `GetStudioModeEnabled`,
`SetStudioModeEnabled`, `GetCurrentPreviewScene`, `SetCurrentPreviewScene`,
`TriggerStudioModeTransition`, `GetSceneTransitionList`, `GetCurrentSceneTransition`,
`SetCurrentSceneTransition`, `SetCurrentSceneTransitionDuration`,
`GetVirtualCamStatus`, `StartVirtualCam`, `StopVirtualCam`, `GetInputList`, `GetInputVolume`, `SetInputVolume`,
`GetInputMute`, `SetInputMute`, `GetStreamStatus`, `StartStream`, `StopStream`,
`GetRecordStatus`, `StartRecord`, `StopRecord`, `GetVersion`, `GetVideoSettings`,
`GetStats`, `GetSourceScreenshot`.

Suscripción: `All` (bits 0–10) más `InputVolumeMeters` (bit 16, alto volumen,
unos 20 mensajes/s). Con la pestaña oculta se envía `Reidentify` sin los
medidores para ahorrar red y CPU.

## 4. Adaptarlo a React o Angular

La lógica sin interfaz ya es independiente del framework y se reutiliza tal
cual: `crypto.js`, `obs-client.js`, `connection.js` y `session.js`. Solo se
reescriben los módulos de `ui/` como componentes.

**React (Vite):**

- Crea un `ObsProvider` (Context) que instancie `ObsClient` y `ConnectionManager`
  una sola vez y exponga `client`, `state` y `call`. Con un hook
  `useObsEvent(tipo, handler)` envuelves `client.on(...)` en un `useEffect`; el
  `on` ya devuelve la función de limpieza.
- Con React Router (`/login` y `/panel`) y una ruta protegida es una SPA: el
  secret puede quedar **solo en memoria**, sin sessionStorage.
- Medidores: no guardes los niveles en estado de React (serían unos 20 renders
  por segundo). Mantén el `<canvas>` con `useRef` y reutiliza la clase `Channel`
  de `audio.js` dentro de un `useEffect`; su bucle `requestAnimationFrame` sigue
  igual.
- Componentes: `ScenesPanel`, `SourcesPanel`, `AudioMixer` / `ChannelStrip`,
  `Controls`, `Preview` y `StatusBar`, uno por archivo de `ui/`.

**Angular:**

- Un `ObsService` (`providedIn: 'root'`) que envuelva `ObsClient` y exponga
  `state$` y `event$(tipo)` como Observables (`fromEvent` sobre el EventTarget),
  más `call()` como Promise u Observable.
- Un `AuthGuard` en la ruta `/panel`. Igual que en React, el secret puede vivir
  en el servicio, en memoria.
- Ejecuta el bucle de los medidores y la suscripción a `InputVolumeMeters` con
  `NgZone.runOutsideAngular()` para no disparar la detección de cambios 20 veces
  por segundo.
- Los estilos de `base.css` pasan a `styles.css` global. Cada sección de
  `panel.css` pasa al componente correspondiente.
