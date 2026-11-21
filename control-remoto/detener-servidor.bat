@echo off
setlocal
rem Detiene el servidor que corre en segundo plano (sin ventana).
rem Volvera a arrancar en el proximo inicio de sesion si la tarea esta instalada.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0arranque.ps1" -Accion Detener
echo.
pause
