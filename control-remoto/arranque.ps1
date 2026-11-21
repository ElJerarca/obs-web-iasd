# ====================================================================
#  Arranque silencioso de "Control remoto OBS" con el Programador de
#  tareas de Windows. Lo usan instalar-arranque.bat, quitar-arranque.bat
#  y detener-servidor.bat (no hace falta ejecutarlo directamente).
#
#  La tarea ejecuta pythonw.exe (Python sin ventana) con servidor.py al
#  iniciar sesion el usuario actual, sin limite de tiempo y con reintentos.
#  (Texto sin tildes a proposito: PowerShell 5.1 lee los .ps1 como ANSI)
# ====================================================================
param(
  [ValidateSet('Instalar', 'Quitar', 'Detener')]
  [string]$Accion = 'Instalar',
  [int]$Puerto = 8080
)

$ErrorActionPreference = 'Stop'
$Nombre = 'Control remoto OBS'
$Carpeta = $PSScriptRoot
$Servidor = Join-Path $Carpeta 'servidor.py'
# Acceso directo de la version anterior (carpeta Inicio): se elimina para no duplicar
$AccesoViejo = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup\Control remoto OBS.lnk'

function Get-Escucha {
  Get-NetTCPConnection -LocalPort $Puerto -State Listen -ErrorAction SilentlyContinue
}

function Stop-Servidor {
  Stop-ScheduledTask -TaskName $Nombre -ErrorAction SilentlyContinue
  foreach ($c in @(Get-Escucha)) {
    $p = Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue
    # Solo se detienen procesos de Python, nunca otro programa que use el puerto
    if ($p -and $p.ProcessName -match '^(python|pythonw|py)$') {
      Stop-Process -Id $p.Id -Force
      Write-Host "Servidor detenido (proceso $($p.Id))."
    } elseif ($p) {
      Write-Host "[AVISO] El puerto $Puerto lo usa otro programa: $($p.ProcessName). No se toco." -ForegroundColor Yellow
    }
  }
}

function Find-Pythonw {
  foreach ($cmd in 'py', 'python') {
    if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) { continue }
    try {
      $exe = & $cmd -c "import sys; print(sys.executable)" 2>$null
      if ($LASTEXITCODE -eq 0 -and $exe) {
        $pythonw = Join-Path (Split-Path $exe.Trim()) 'pythonw.exe'
        if (Test-Path $pythonw) { return $pythonw }
      }
    } catch { }
  }
  return $null
}

function Show-Direcciones {
  Write-Host ''
  Write-Host "  En este PC:    http://localhost:$Puerto"
  Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
    ForEach-Object { Write-Host "  Desde la red:  http://$($_.IPAddress):$Puerto" }
  Write-Host ''
}

try {
  switch ($Accion) {
    'Instalar' {
      if (-not (Test-Path $Servidor)) { throw "No se encontro servidor.py en $Carpeta" }
      $pythonw = Find-Pythonw
      if (-not $pythonw) { throw 'No se encontro Python. Instalalo con: winget install Python.Python.3.12' }

      $usuario = "$env:USERDOMAIN\$env:USERNAME"
      $accionTarea = New-ScheduledTaskAction -Execute $pythonw `
        -Argument "`"$Servidor`" --puerto $Puerto" -WorkingDirectory $Carpeta
      $disparador = New-ScheduledTaskTrigger -AtLogOn -User $usuario
      $principal = New-ScheduledTaskPrincipal -UserId $usuario -LogonType Interactive -RunLevel Limited
      # Sin limite de tiempo (por defecto Windows detiene las tareas a los 3 dias),
      # funciona con bateria y reintenta si falla al arrancar
      $ajustes = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) `
        -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
        -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew

      Register-ScheduledTask -TaskName $Nombre -Action $accionTarea -Trigger $disparador `
        -Principal $principal -Settings $ajustes -Force `
        -Description 'Servidor web silencioso del control remoto de OBS (servidor.py)' | Out-Null

      if (Test-Path $AccesoViejo) {
        Remove-Item $AccesoViejo -Force
        Write-Host 'Se quito el acceso directo anterior de la carpeta Inicio.'
      }

      # Detener una instancia previa (p. ej. iniciar.bat abierto) y arrancar la tarea ya
      Stop-Servidor
      Start-ScheduledTask -TaskName $Nombre
      Start-Sleep -Seconds 3

      if (Get-Escucha) {
        Write-Host ''
        Write-Host '[OK] Tarea creada y servidor funcionando en segundo plano, sin ventanas.' -ForegroundColor Green
        Write-Host "     Arrancara solo cada vez que $env:USERNAME inicie sesion."
        Show-Direcciones
        Write-Host '  Para detenerlo ahora:        detener-servidor.bat'
        Write-Host '  Para quitar el arranque:     quitar-arranque.bat'
        Write-Host "  Registro de errores:         $(Join-Path $Carpeta 'servidor.log')"
      } else {
        Write-Host '[AVISO] La tarea se creo, pero el servidor no responde todavia.' -ForegroundColor Yellow
        Write-Host "        Revisa $(Join-Path $Carpeta 'servidor.log')"
      }
    }

    'Quitar' {
      Stop-Servidor
      if (Get-ScheduledTask -TaskName $Nombre -ErrorAction SilentlyContinue) {
        Unregister-ScheduledTask -TaskName $Nombre -Confirm:$false
        Write-Host '[OK] Tarea eliminada. El servidor ya no arrancara con Windows.' -ForegroundColor Green
      } else {
        Write-Host 'La tarea programada no existia.'
      }
      if (Test-Path $AccesoViejo) { Remove-Item $AccesoViejo -Force }
    }

    'Detener' {
      if (-not (Get-Escucha)) {
        Write-Host "No hay ningun servidor escuchando en el puerto $Puerto."
      } else {
        Stop-Servidor
        Write-Host 'Volvera a arrancar en el proximo inicio de sesion (o con iniciar.bat).'
      }
    }
  }
} catch {
  Write-Host "[ERROR] $($_.Exception.Message)" -ForegroundColor Red
  exit 1
}
