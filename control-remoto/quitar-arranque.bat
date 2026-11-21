@echo off
setlocal
rem Quita el arranque automatico creado por instalar-arranque.bat
set "ACCESO=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\Control remoto OBS.lnk"

if exist "%ACCESO%" (
  del "%ACCESO%"
  echo [OK] Arranque automatico quitado. El servidor ya no iniciara con Windows.
) else (
  echo El arranque automatico no estaba activado.
)
pause
