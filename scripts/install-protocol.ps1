# Register the dshedge:// URL protocol for the CURRENT USER (no admin required).
# Once registered, clicking "启动桥接" in the Edge sidebar opens dshedge://start,
# which runs bridge\start-bridge-hidden.vbs and starts the bridge hidden.
# This is NOT an autostart entry: nothing runs until you click.
# Keep this file ASCII-only (Windows PowerShell reads .ps1 without BOM as ANSI).
#   powershell -ExecutionPolicy Bypass -File scripts\install-protocol.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\install-protocol.ps1 -Remove
param([switch]$Remove)
$ErrorActionPreference = 'Stop'

$root = Split-Path $PSScriptRoot -Parent
$vbs = Join-Path $root 'bridge\start-bridge-hidden.vbs'
$key = 'HKCU:\Software\Classes\dshedge'

if ($Remove) {
    if (Test-Path $key) { Remove-Item $key -Recurse -Force; Write-Host "[dsh-edge] dshedge:// removed" }
    else { Write-Host "[dsh-edge] dshedge:// was not registered" }
    exit 0
}

if (-not (Test-Path $vbs)) { Write-Host "[dsh-edge] missing launcher: $vbs"; exit 1 }

$wscript = Join-Path $env:WINDIR 'System32\wscript.exe'
$cmd = '"' + $wscript + '" "' + $vbs + '" "%1"'

New-Item -Path $key -Force | Out-Null
Set-Item -Path $key -Value 'URL:DSH Edge Bridge'
New-ItemProperty -Path $key -Name 'URL Protocol' -Value '' -PropertyType String -Force | Out-Null
New-Item -Path "$key\DefaultIcon" -Force | Out-Null
Set-Item -Path "$key\DefaultIcon" -Value (Join-Path $root 'extension\icons\icon32.png')
New-Item -Path "$key\shell\open\command" -Force | Out-Null
Set-Item -Path "$key\shell\open\command" -Value $cmd

$check = (Get-ItemProperty -Path "$key\shell\open\command").'(default)'
if ($check -eq $cmd) {
    Write-Host "[dsh-edge] OK: dshedge:// is registered for the current user."
    Write-Host "[dsh-edge]   handler: $cmd"
    Write-Host "[dsh-edge] Now use the 'Start bridge' button in the Edge sidebar."
    Write-Host "[dsh-edge] To undo:  powershell -ExecutionPolicy Bypass -File scripts\install-protocol.ps1 -Remove"
} else {
    Write-Host "[dsh-edge] registration failed: got '$check'"
    exit 1
}
