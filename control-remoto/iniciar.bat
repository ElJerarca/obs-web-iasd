@echo off
setlocal
rem ==================================================================
rem  Control remoto OBS - servidor web local
rem  Doble clic para iniciar. Para detenerlo, cierra esta ventana.
rem  (Sin tildes a proposito: la consola de Windows no las muestra bien)
rem ==================================================================

set "PUERTO=8080"
title Control remoto OBS - servidor web (puerto %PUERTO%)

rem Trabajar siempre desde la carpeta donde esta este archivo
cd /d "%~dp0"

if not exist "index.html" (
  echo [ERROR] Este archivo debe estar dentro de la carpeta control-remoto,
  echo         junto a index.html y panel.html.
  pause
  exit /b 1
)

rem Buscar Python: primero el lanzador "py", luego "python".
rem Se prueba con --version para no abrir la Microsoft Store por error.
set "PY="
py --version >nul 2>&1 && set "PY=py"
if not defined PY (
  python --version >nul 2>&1 && set "PY=python"
)
if not defined PY (
  echo [ERROR] No se encontro Python.
  echo   Instalalo con:  winget install Python.Python.3.12
  echo   o desde https://www.python.org  ^(marca "Add Python to PATH"^)
  echo   Luego cierra esta ventana y vuelve a abrir este archivo.
  pause
  exit /b 1
)

rem Evitar dos servidores a la vez (p. ej. si ya arranco con Windows)
rem (Get-NetTCPConnection no depende del idioma de Windows, netstat si)
powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort %PUERTO% -State Listen -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }"
if not errorlevel 1 (
  echo [AVISO] El puerto %PUERTO% ya esta en uso.
  echo   Probablemente el servidor ya esta funcionando en otra ventana.
  echo   Si no es asi, cierra el programa que usa ese puerto o cambia PUERTO en este archivo.
  pause
  exit /b 1
)

echo.
echo  ============================================================
echo   Control remoto OBS - servidor web en marcha
echo  ============================================================
echo.
echo   En este PC:     http://localhost:%PUERTO%
echo   Desde la red:
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do (
  for /f "tokens=* delims= " %%b in ("%%a") do echo                   http://%%b:%PUERTO%
)
echo.
echo   Deja esta ventana abierta (puede estar minimizada).
echo   Para detener el servidor: cierra esta ventana o pulsa Ctrl+C.
echo  ============================================================
echo.

%PY% -m http.server %PUERTO% --bind 0.0.0.0

echo.
echo El servidor se detuvo.
pause
