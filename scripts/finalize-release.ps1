# Finalize a plugin release in one step.
#
# Builds the npm tarball (unless -Tgz / -SkipPack), creates the git tag (with
# -CreateTag), waits for the tag workflow to publish the portable zip, then:
#   - uploads the npm tarball when the workflow did not,
#   - rewrites SHA256SUMS.txt so it covers every *.zip / *.tgz asset,
#   - renders the release body from the CHANGELOG section + scripts/release-template.md.
#
#   powershell -ExecutionPolicy Bypass -File scripts\finalize-release.ps1 -Tag v1.6.0 -CreateTag
#   powershell -ExecutionPolicy Bypass -File scripts\finalize-release.ps1 -Tag v1.6.0 -Tgz dist\app.tgz
#
# Keep this file ASCII-only: Windows PowerShell 5.1 reads BOM-less UTF-8 as ANSI
# and a Chinese comment can break parsing.
param(
    [Parameter(Mandatory = $true)][string]$Tag,
    [string]$Repo = '',
    [string]$Tgz = '',
    [string]$Token = '',
    [int]$WaitSeconds = 900,
    [switch]$CreateTag,
    [switch]$SkipPack
)

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent

function Get-CredManToken([string]$Target = 'git:https://github.com') {
    if (-not ('DshEdgeCredMan' -as [type])) {
        Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class DshEdgeCredMan {
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool CredReadW(string target, int type, int flags, out IntPtr credPtr);
    [DllImport("advapi32.dll")]
    static extern void CredFree(IntPtr cred);
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct CREDENTIAL {
        public int Flags;
        public int Type;
        public string TargetName;
        public string Comment;
        public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
        public int CredentialBlobSize;
        public IntPtr CredentialBlob;
        public int Persist;
        public int AttributeCount;
        public IntPtr Attributes;
        public string TargetAlias;
        public string UserName;
    }
    public static string Read(string target) {
        IntPtr p = IntPtr.Zero;
        if (!CredReadW(target, 1, 0, out p)) return null;
        try {
            CREDENTIAL c = (CREDENTIAL)Marshal.PtrToStructure(p, typeof(CREDENTIAL));
            byte[] b = new byte[c.CredentialBlobSize];
            Marshal.Copy(c.CredentialBlob, b, 0, b.Length);
            return System.Text.Encoding.Unicode.GetString(b);
        } finally {
            CredFree(p);
        }
    }
}
'@
    }
    return [DshEdgeCredMan]::Read($Target)
}

$resolvedToken = $Token
if (-not $resolvedToken) { $resolvedToken = $env:GITHUB_TOKEN }
if (-not $resolvedToken) { $resolvedToken = $env:GH_TOKEN }
if (-not $resolvedToken) { $resolvedToken = Get-CredManToken }
if (-not $resolvedToken) { throw 'no GitHub token: pass -Token, set GH_TOKEN, or store git:https://github.com in Credential Manager' }

if (-not $Repo) {
    $pkg = Get-Content (Join-Path $root 'package.json') -Raw | ConvertFrom-Json
    $url = "$($pkg.repository.url)"
    if ($url -match 'github\.com[/:]([^/]+)/([^/.]+)') { $Repo = "$($Matches[1])/$($Matches[2])" }
}
if (-not $Repo) { throw 'cannot resolve owner/repo: pass -Repo owner/name' }

$node = $env:GITHUB_PUSH_NODE
if (-not $node) {
    $cands = @(
        'C:\Users\a\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe',
        "$env:ProgramFiles\nodejs\node.exe"
    )
    foreach ($c in $cands) { if (Test-Path -LiteralPath $c) { $node = $c; break } }
}
if (-not $node) {
    $cmd = Get-Command node -ErrorAction SilentlyContinue
    if ($cmd) { $node = $cmd.Source }
}
if (-not $node) { throw 'node not found: set GITHUB_PUSH_NODE to node.exe' }

# 1) Build the npm tarball first so the release always has an installable tgz.
if (-not $Tgz -and -not $SkipPack) {
    $dist = Join-Path $root 'dist'
    New-Item -ItemType Directory -Force -Path $dist | Out-Null
    $packed = $null

    $npmCmd = Get-Command npm -ErrorAction SilentlyContinue
    if ($npmCmd) {
        Push-Location $root
        try {
            $line = & $npmCmd.Source pack --pack-destination $dist 2>&1 | Select-Object -Last 1
        } finally {
            Pop-Location
        }
        if ($line) {
            $cand = Join-Path $dist ("$line").Trim()
            if (Test-Path -LiteralPath $cand) { $packed = $cand }
        }
    }

    if (-not $packed) {
        $pnpm = 'C:\Users\a\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\pnpm\bin\pnpm.mjs'
        if (Test-Path -LiteralPath $pnpm) {
            Push-Location $root
            try {
                $line = & $node $pnpm pack --pack-destination $dist 2>&1 | Select-Object -Last 1
            } finally {
                Pop-Location
            }
            if ($line) {
                $cand = Join-Path $dist ("$line").Trim()
                if (Test-Path -LiteralPath $cand) { $packed = $cand }
            }
        }
    }

    if (-not $packed) {
        $packed = Get-ChildItem -Path $dist -Filter '*.tgz' -File |
            Sort-Object LastWriteTime -Descending |
            Select-Object -First 1 -ExpandProperty FullName
    }
    if (-not $packed) { throw 'cannot build the npm tarball: pass -Tgz <file>, or install npm/pnpm' }

    $Tgz = $packed
    Write-Host "packed: $Tgz"
}
if ($Tgz -and -not (Test-Path -LiteralPath $Tgz)) { throw "tarball not found: $Tgz" }

$env:GH_TOKEN = $resolvedToken
$env:FRC_TAG = $Tag
$env:FRC_REPO = $Repo
$env:FRC_ROOT = $root
$env:FRC_WAIT_MS = [string]($WaitSeconds * 1000)
if ($Tgz) {
    $env:FRC_TGZ = (Resolve-Path -LiteralPath $Tgz).Path
} else {
    Remove-Item Env:FRC_TGZ -ErrorAction SilentlyContinue
}
if ($CreateTag) {
    $env:FRC_CREATE_TAG = '1'
} else {
    Remove-Item Env:FRC_CREATE_TAG -ErrorAction SilentlyContinue
}

$tgzLabel = if ($Tgz) { Split-Path $Tgz -Leaf } else { 'none' }
Write-Host "finalize: $Repo @ $Tag (create tag: $([bool]$CreateTag), tarball: $tgzLabel)"
& $node (Join-Path $root 'scripts\finalize-release.cjs')
exit $LASTEXITCODE
