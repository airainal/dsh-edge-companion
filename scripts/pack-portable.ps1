# Build the portable zip for end users: runtime folders + Word guide only.
# Markdown docs stay in the repository but are not shipped in the zip.
# Keep this file ASCII-only.
#   powershell -ExecutionPolicy Bypass -File scripts\pack-portable.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\pack-portable.ps1 -Version 1.4.1
param([string]$Version = '1.4.1', [string]$OutDir = 'dist')
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
if ([System.IO.Path]::IsPathRooted($OutDir)) { $dist = $OutDir } else { $dist = Join-Path $root $OutDir }
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

# Only the Word installation guide is shipped with the package.
Get-ChildItem $root -Filter '*.docx' -File | ForEach-Object { Copy-Item $_.FullName $stage -Force }
if (Test-Path (Join-Path $root 'LICENSE')) { Copy-Item (Join-Path $root 'LICENSE') $stage -Force }

# Markdown is repository documentation only.
Get-ChildItem $stage -Recurse -Filter '*.md' -File | Remove-Item -Force

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
