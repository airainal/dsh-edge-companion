# Install (or remove) a Startup shortcut so the bridge starts automatically at login.
# The shortcut runs bridge\start-bridge-hidden.vbs (hidden window, no console).
# Keep this file ASCII-only (Windows PowerShell reads .ps1 without BOM as ANSI).
#   powershell -ExecutionPolicy Bypass -File scripts\install-autostart.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\install-autostart.ps1 -Start
#   powershell -ExecutionPolicy Bypass -File scripts\install-autostart.ps1 -Remove
param([switch]$Remove, [switch]$Start)
$ErrorActionPreference = 'Stop'

$root = Split-Path $PSScriptRoot -Parent
$vbs = Join-Path $root 'bridge\start-bridge-hidden.vbs'
$startup = [Environment]::GetFolderPath('Startup')
$lnk = Join-Path $startup 'DSH-Edge-Bridge.lnk'

if ($Remove) {
    if (Test-Path $lnk) { Remove-Item $lnk -Force; Write-Host "[dsh-edge] autostart removed: $lnk" }
    else { Write-Host "[dsh-edge] no autostart shortcut found" }
    exit 0
}

if (-not (Test-Path $vbs)) { Write-Host "[dsh-edge] missing: $vbs"; exit 1 }

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($lnk)
$shortcut.TargetPath = Join-Path $env:WINDIR 'System32\wscript.exe'
$shortcut.Arguments = '"' + $vbs + '"'
$shortcut.WorkingDirectory = Join-Path $root 'bridge'
$shortcut.WindowStyle = 7   # minimized (the VBS itself is hidden)
$shortcut.Description = 'DSH Edge Bridge - local bridge for the Edge extension (hidden)'
$shortcut.Save()

Write-Host "[dsh-edge] autostart installed: $lnk"
Write-Host "[dsh-edge] the bridge now starts automatically at login (hidden, no console window)."

if ($Start) {
    # explorer.exe launches the shortcut outside of any job object, so it survives this shell.
    Start-Process explorer.exe -ArgumentList ('"' + $lnk + '"')
    Start-Sleep -Seconds 3
    Write-Host "[dsh-edge] start requested."
    try {
        $r = Invoke-WebRequest -Uri 'http://127.0.0.1:8766/status' -UseBasicParsing -TimeoutSec 5
        $j = $r.Content | ConvertFrom-Json
        Write-Host ("[dsh-edge] bridge is up: version {0}, extension connected: {1}" -f $j.version, $j.extension.connected)
    } catch {
        Write-Host "[dsh-edge] bridge not answering yet; it may still be starting (check bridge\bridge.log)."
    }
}
