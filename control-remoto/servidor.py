"""
Servidor web estático para "Control remoto OBS".

Sirve únicamente la carpeta donde está este archivo. Se usa en lugar de
`python -m http.server` porque:

- funciona sin ventana (pythonw.exe): los registros van a `servidor.log`
  en vez de a una consola que no existe;
- fija el tipo MIME de .js y .css: en algunos Windows el registro asocia
  .js a "text/plain" y el navegador se niega a cargar los módulos de la app;
- no entrega los scripts ni el registro (.py, .bat, .ps1, .log);
- envía Cache-Control: no-cache para que, al actualizar los archivos, los
  navegadores tomen la versión nueva.

Uso:
    python servidor.py [--puerto 8080] [--host 0.0.0.0]
"""

import argparse
import logging
import os
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from logging.handlers import RotatingFileHandler

BASE = os.path.dirname(os.path.abspath(__file__))
LOG_FILE = os.path.join(BASE, 'servidor.log')
BLOQUEADOS = ('.py', '.pyc', '.bat', '.ps1', '.log')

log = logging.getLogger('control-remoto')


def configurar_registro():
    log.setLevel(logging.INFO)
    formato = logging.Formatter('%(asctime)s %(levelname)s %(message)s')
    # Archivo rotativo: máximo ~1 MB entre el actual y una copia
    archivo = RotatingFileHandler(LOG_FILE, maxBytes=512 * 1024, backupCount=1, encoding='utf-8')
    archivo.setFormatter(formato)
    log.addHandler(archivo)
    # Con pythonw.exe no hay consola (sys.stderr es None)
    if sys.stderr is not None:
        consola = logging.StreamHandler(sys.stderr)
        consola.setFormatter(formato)
        log.addHandler(consola)


class Manejador(SimpleHTTPRequestHandler):
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        '.html': 'text/html; charset=utf-8',
        '.js': 'text/javascript; charset=utf-8',
        '.mjs': 'text/javascript; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.svg': 'image/svg+xml',
        '.json': 'application/json',
        '.md': 'text/plain; charset=utf-8',
    }

    def send_head(self):
        # translate_path decodifica la URL (%2E, etc.) antes de comprobar la extensión
        if self.translate_path(self.path).lower().endswith(BLOQUEADOS):
            self.send_error(404, 'No encontrado')
            return None
        return super().send_head()

    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')
        self.send_header('X-Content-Type-Options', 'nosniff')
        super().end_headers()

    def log_message(self, fmt, *args):
        # La implementación original escribe en sys.stderr, que no existe con pythonw.exe
        log.info('%s %s', self.address_string(), fmt % args)


def main():
    parser = argparse.ArgumentParser(description='Servidor web de Control remoto OBS')
    parser.add_argument('--puerto', type=int, default=8080)
    parser.add_argument('--host', default='0.0.0.0', help='0.0.0.0 = accesible desde la red local')
    args = parser.parse_args()

    configurar_registro()
    manejador = partial(Manejador, directory=BASE)
    try:
        servidor = ThreadingHTTPServer((args.host, args.puerto), manejador)
    except OSError as error:
        log.error('No se pudo abrir el puerto %s: %s (¿ya hay otro servidor en marcha?)', args.puerto, error)
        sys.exit(1)

    log.info('Sirviendo %s en http://%s:%s', BASE, args.host, args.puerto)
    try:
        servidor.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        servidor.server_close()
        log.info('Servidor detenido')


if __name__ == '__main__':
    main()
