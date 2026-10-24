# Build the portable zip (clean source only, no runtime files) plus SHA256SUMS.
# Keep this file ASCII-only.
#   powershell -ExecutionPolicy Bypass -File scripts\pack-portable.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\pack-portable.ps1 -Version 1.4.0
param([string]$Version = '1.3.0')
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$dist = Join-Path $root 'dist'
$stage = Join-Path $dist 'stage\dsh-edge-companion'

if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Force -Path $stage | Out-Null

foreach ($d in @('extension', 'bin', 'client', 'dsh-plugin', 'scripts')) {
    Copy-Item (Join-Path $root $d) (Join-Path $stage $d) -Recurse -Force
}

# bridge: source files only (bridge.log/node-path/active-session/session-log/.dsh-overlay are runtime)
New-Item -ItemType Directory -Force -Path (Join-Path $stage 'bridge') | Out-Null
foreach ($f in @('bridge.mjs', 'engines.json', 'start-bridge.cmd', 'start-bridge-hidden.vbs')) {
    Copy-Item (Join-Path $root (Join-Path 'bridge' $f)) (Join-Path $stage (Join-Path 'bridge' $f)) -Force
}

# docs images are referenced by README.md
Copy-Item (Join-Path $root 'docs') (Join-Path $stage 'docs') -Recurse -Force

# root markdown guides + license
Get-ChildItem $root -Filter '*.md' -File | ForEach-Object { Copy-Item $_.FullName $stage -Force }
if (Test-Path (Join-Path $root 'LICENSE')) { Copy-Item (Join-Path $root 'LICENSE') $stage -Force }

$zip = Join-Path $dist ("dsh-edge-companion-{0}.zip" -f $Version)
if (Test-Path $zip) { Remove-Item $zip -Force }
Compress-Archive -Path $stage -DestinationPath $zip -Force
Remove-Item $stage -Recurse -Force

$hash = (Get-FileHash $zip -Algorithm SHA256).Hash
$sums = Join-Path $dist 'SHA256SUMS.txt'
"{0}  {1}" -f $hash, (Split-Path $zip -Leaf) | Set-Content $sums -Encoding ascii

$item = Get-Item $zip
Write-Host ("packed: {0} ({1:N1} KB)" -f $item.FullName, ($item.Length / 1KB))
Write-Host ("sha256: {0}" -f $hash)
