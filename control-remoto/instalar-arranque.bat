@echo off
setlocal
rem ==================================================================
rem  Arranque SILENCIOSO: crea una tarea en el Programador de tareas que
rem  inicia el servidor web sin ninguna ventana cada vez que este usuario
rem  inicia sesion en Windows. Lo arranca tambien en este momento.
rem ==================================================================
rem Pedir permisos de administrador si no se tienen (necesarios para la tarea programada)
net session >nul 2>&1
if errorlevel 1 (
  echo Solicitando permisos de administrador...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0arranque.ps1" -Accion Instalar
echo.
pause
