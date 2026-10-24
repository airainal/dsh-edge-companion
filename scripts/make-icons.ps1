# DSH Edge Bridge icon: a big fat blue fish (DeepSeek blue body + tail + fin + eye).
# Keep this file ASCII-only: Windows PowerShell decodes .ps1 without BOM using the ANSI code page.
param([string]$OutDir)
Add-Type -AssemblyName System.Drawing

if (-not $OutDir) { $OutDir = Join-Path (Split-Path $PSScriptRoot -Parent) "extension\icons" }
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

$blue = [System.Drawing.Color]::FromArgb(255, 77, 107, 254)
$blueDark = [System.Drawing.Color]::FromArgb(255, 47, 72, 214)
$belly = [System.Drawing.Color]::FromArgb(255, 137, 160, 255)

function New-FishIcon([int]$size) {
    $bmp = New-Object System.Drawing.Bitmap($size, $size)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.Clear([System.Drawing.Color]::Transparent)

    $s = [double]$size

    # tail (right side, darker blue)
    $tail = New-Object System.Drawing.Drawing2D.GraphicsPath
    $tail.AddPolygon(@(
        [System.Drawing.PointF]::new([single]($s * 0.66), [single]($s * 0.50)),
        [System.Drawing.PointF]::new([single]($s * 0.97), [single]($s * 0.24)),
        [System.Drawing.PointF]::new([single]($s * 0.93), [single]($s * 0.50)),
        [System.Drawing.PointF]::new([single]($s * 0.97), [single]($s * 0.76))
    ))
    $g.FillPath((New-Object System.Drawing.SolidBrush($blueDark)), $tail)

    # dorsal fin
    $fin = New-Object System.Drawing.Drawing2D.GraphicsPath
    $fin.AddPolygon(@(
        [System.Drawing.PointF]::new([single]($s * 0.30), [single]($s * 0.30)),
        [System.Drawing.PointF]::new([single]($s * 0.44), [single]($s * 0.05)),
        [System.Drawing.PointF]::new([single]($s * 0.57), [single]($s * 0.27))
    ))
    $g.FillPath((New-Object System.Drawing.SolidBrush($blueDark)), $fin)

    # fat body
    $body = New-Object System.Drawing.Drawing2D.GraphicsPath
    $body.AddEllipse([single]($s * 0.05), [single]($s * 0.21), [single]($s * 0.70), [single]($s * 0.58))
    $g.FillPath((New-Object System.Drawing.SolidBrush($blue)), $body)

    # belly highlight
    $g.SetClip($body)
    $bellyBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(120, $belly))
    $g.FillEllipse($bellyBrush, [single]($s * 0.14), [single]($s * 0.47), [single]($s * 0.46), [single]($s * 0.29))
    $g.ResetClip()

    # eye
    $eyeW = [Math]::Max(1.2, $s * 0.13)
    $ex = [single]($s * 0.24); $ey = [single]($s * 0.39)
    $g.FillEllipse([System.Drawing.Brushes]::White, $ex, $ey, [single]$eyeW, [single]$eyeW)
    $pupil = [Math]::Max(0.8, $s * 0.065)
    $g.FillEllipse([System.Drawing.Brushes]::Black, [single]($ex + $eyeW * 0.32), [single]($ey + $eyeW * 0.32), [single]$pupil, [single]$pupil)

    # mouth
    if ($size -ge 32) {
        $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(170, 255, 255, 255), [Math]::Max(0.8, $s * 0.035))
        $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
        $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
        $g.DrawArc($pen, [single]($s * 0.09), [single]($s * 0.42), [single]($s * 0.17), [single]($s * 0.13), 20, 120)
        $pen.Dispose()
    }

    # bubbles (only for larger sizes)
    if ($size -ge 32) {
        $bub = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(150, 120, 145, 255))
        $r1 = [single]([Math]::Max(1, $s * 0.07))
        $r2 = [single]([Math]::Max(1, $s * 0.05))
        $g.FillEllipse($bub, [single]($s * 0.80), [single]($s * 0.10), $r1, $r1)
        $g.FillEllipse($bub, [single]($s * 0.89), [single]($s * 0.02), $r2, $r2)
        $bub.Dispose()
    }

    $out = Join-Path $OutDir "icon$size.png"
    $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose(); $bmp.Dispose()
    Write-Host "wrote $out"
}

foreach ($s in 16, 32, 48, 128) { New-FishIcon $s }
