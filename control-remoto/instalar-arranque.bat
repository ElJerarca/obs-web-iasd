@echo off
setlocal
rem ==================================================================
rem  Hace que el servidor web arranque solo al iniciar sesion en Windows.
rem  Crea un acceso directo (minimizado) a iniciar.bat en la carpeta
rem  "Inicio" del usuario actual. No requiere permisos de administrador.
rem ==================================================================

cd /d "%~dp0"
if not exist "iniciar.bat" (
  echo [ERROR] No se encontro iniciar.bat en esta carpeta.
  pause
  exit /b 1
)

set "OBJETIVO=%~dp0iniciar.bat"
set "CARPETA=%~dp0"
set "ACCESO=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\Control remoto OBS.lnk"

rem WindowStyle 7 = ventana minimizada
powershell -NoProfile -ExecutionPolicy Bypass -Command "$s = (New-Object -ComObject WScript.Shell).CreateShortcut($env:ACCESO); $s.TargetPath = $env:OBJETIVO; $s.WorkingDirectory = $env:CARPETA; $s.WindowStyle = 7; $s.Description = 'Servidor web del control remoto de OBS'; $s.Save()"

if exist "%ACCESO%" (
  echo.
  echo  [OK] Listo. El servidor arrancara minimizado cada vez que inicies sesion.
  echo.
  echo  Importante:
  echo   - Si mueves esta carpeta a otro lugar, vuelve a ejecutar este archivo.
  echo   - Para quitar el arranque automatico, ejecuta quitar-arranque.bat
  echo.
) else (
  echo [ERROR] No se pudo crear el acceso directo.
)
pause
