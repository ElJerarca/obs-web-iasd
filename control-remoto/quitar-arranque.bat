@echo off
setlocal
rem Detiene el servidor y elimina la tarea programada de arranque silencioso.
rem Pedir permisos de administrador si no se tienen (necesarios para la tarea programada)
net session >nul 2>&1
if errorlevel 1 (
  echo Solicitando permisos de administrador...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0arranque.ps1" -Accion Quitar
echo.
pause
