# Environment check for a fresh machine. Read-only.
# PASS/FAIL = required; INFO = optional / runtime state.
# Keep this file ASCII-only.
#   powershell -ExecutionPolicy Bypass -File scripts\verify-install.ps1
$ErrorActionPreference = 'Continue'
$root = Split-Path $PSScriptRoot -Parent
$ok = 0; $bad = 0

function Check($name, $pass, $detail) {
    if ($pass) { $script:ok++; Write-Host ("  [PASS] {0} {1}" -f $name, $detail) }
    else { $script:bad++; Write-Host ("  [FAIL] {0} {1}" -f $name, $detail) }
}
function Info($name, $detail) {
    Write-Host ("  [INFO] {0} {1}" -f $name, $detail)
}

Write-Host "DSH Edge Bridge - environment check"
Write-Host ("  folder: {0}" -f $root)

# 1) files
Check 'extension/manifest.json' (Test-Path (Join-Path $root 'extension\manifest.json')) ''
Check 'bridge/bridge.mjs' (Test-Path (Join-Path $root 'bridge\bridge.mjs')) ''
Check 'bin/edge.cmd' (Test-Path (Join-Path $root 'bin\edge.cmd')) ''

# 2) node runtime
$node = ''
$nodeFile = Join-Path $root 'bridge\node-path.txt'
if (Test-Path $nodeFile) {
    $candidate = (Get-Content $nodeFile -TotalCount 1).Trim()
    if ($candidate -and (Test-Path $candidate)) { $node = $candidate }
}
if (-not $node) {
    $cmd = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($cmd) { $node = $cmd.Source }
}
if (-not $node) {
    $roots = @(
        (Join-Path $env:LOCALAPPDATA 'Programs\DeepSeek Harness'),
        (Join-Path $env:ProgramW6432 'DeepSeek Harness'),
        (Join-Path $env:ProgramFiles 'DeepSeek Harness'),
        'C:\Program Files (x86)\DeepSeek Harness',
        'C:\DeepSeek Harness', 'D:\DeepSeek Harness', 'E:\DeepSeek Harness'
    )
    foreach ($r in $roots) {
        $p = Join-Path $r 'resources\runtime\primary-runtime\dependencies\node\bin\node.exe'
        if (Test-Path $p) { $node = $p; break }
    }
}
Check 'node runtime' ([bool]$node) $node

# 3) DeepSeek Harness install (env -> registry -> common dirs)
$dsh = $env:DSHEDGE_DSH_EXE
if (-not $dsh) {
    $uninstall = Get-ChildItem 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall' -ErrorAction SilentlyContinue |
        ForEach-Object { Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue } |
        Where-Object { $_.DisplayName -like '*DeepSeek Harness*' } | Select-Object -First 1
    if ($uninstall -and $uninstall.InstallLocation) { $dsh = Join-Path $uninstall.InstallLocation 'DeepSeek Harness.exe' }
}
if (-not $dsh) {
    $roots = @(
        (Join-Path $env:LOCALAPPDATA 'Programs\DeepSeek Harness'),
        (Join-Path $env:ProgramW6432 'DeepSeek Harness'),
        (Join-Path $env:ProgramFiles 'DeepSeek Harness'),
        'C:\Program Files (x86)\DeepSeek Harness',
        'C:\DeepSeek Harness', 'D:\DeepSeek Harness', 'E:\DeepSeek Harness'
    )
    foreach ($r in $roots) {
        $p = Join-Path $r 'DeepSeek Harness.exe'
        if (Test-Path $p) { $dsh = $p; break }
    }
}
Check 'DeepSeek Harness' ([bool]$dsh) $dsh

# 4) dshedge:// protocol (optional one-click launcher)
$proto = Get-ItemProperty 'HKCU:\Software\Classes\dshedge\shell\open\command' -ErrorAction SilentlyContinue
if ($proto) { Info 'dshedge:// protocol' 'registered (sidebar "Start bridge" works)' }
else { Info 'dshedge:// protocol' 'not registered (optional; double-click scripts\install-protocol.cmd)' }

# 5) bridge status (runtime, not an install problem)
try {
    $s = Invoke-WebRequest -Uri 'http://127.0.0.1:8766/status' -UseBasicParsing -TimeoutSec 4
    $j = $s.Content | ConvertFrom-Json
    Info 'bridge' ("running, version {0}, extension connected: {1}" -f $j.version, $j.extension.connected)
} catch {
    Info 'bridge' 'not running (that is fine before first use; use the sidebar button or start-bridge.cmd)'
}

Write-Host ""
Write-Host ("Summary: {0} passed, {1} failed" -f $ok, $bad)
if ($bad -gt 0) { exit 1 }
