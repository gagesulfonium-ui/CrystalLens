# CrystalLens Android - assemble the final release bundle
#
# Expects these to have been produced already:
#   dist/preview/                         (python tools/build_web.py)
#   dist/CrystalLens-Android-Preview.html (python tools/build_web.py)
#   dist/CrystalLens-v1.1.0-android.apk   (tools/build_apk.ps1)
#   dist/build-info.json                  (tools/build_apk.ps1)
#
# Produces:
#   dist/SHA256SUMS.txt
#   dist/VERSION.txt
#   dist/CrystalLens-v1.1.0-android/            (unpacked release folder)
#   dist/CrystalLens-v1.1.0-android.zip         (what to hand to users)
#
# NOTE: keep this file ASCII-only (Windows PowerShell 5.1 reads .ps1 as ANSI
# unless it has a UTF-8 BOM). Chinese user facing text lives in docs/ANDROID.md,
# which is copied into the bundle as README-ANDROID.md.
param(
    [switch]$SkipZip,
    [string]$DocsSource = "docs\ANDROID.md"
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$dist = Join-Path $root "dist"
$name = "CrystalLens-v1.1.0-android"
$outDir = Join-Path $dist $name
$zipPath = Join-Path $dist ($name + ".zip")
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function Need([string]$Path, [string]$What) {
    if (-not (Test-Path -LiteralPath $Path)) { throw ("missing " + $What + ": " + $Path) }
}
Need (Join-Path $dist "preview\index.html") "web preview folder"
Need (Join-Path $dist "CrystalLens-Android-Preview.html") "single-file preview"
Need (Join-Path $dist "CrystalLens-v1.1.0-android.apk") "signed APK"
Need (Join-Path $dist "build-info.json") "build-info.json"

Write-Host "=== assemble release folder ===" -ForegroundColor Cyan
if (Test-Path -LiteralPath $outDir) {
    $resolved = (Resolve-Path -LiteralPath $outDir).Path
    if (-not $resolved.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase)) { throw "refusing to delete " + $resolved }
    Remove-Item -LiteralPath $outDir -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $outDir "preview") | Out-Null

Copy-Item -LiteralPath (Join-Path $dist "CrystalLens-v1.1.0-android.apk") -Destination $outDir
Copy-Item -LiteralPath (Join-Path $dist "CrystalLens-Android-Preview.html") -Destination $outDir
Copy-Item -LiteralPath (Join-Path $dist "build-info.json") -Destination $outDir
Copy-Item -Path (Join-Path $dist "preview\*") -Destination (Join-Path $outDir "preview") -Recurse -Force
$licenseCandidates = @(
    (Join-Path $root "reference\CrystalLens\LICENSE"),
    (Join-Path $root "LICENSE"),
    (Join-Path (Split-Path -Parent $root) "LICENSE")
)
$licenseCopied = $false
foreach ($candidate in $licenseCandidates) {
    if (Test-Path -LiteralPath $candidate) {
        Copy-Item -LiteralPath $candidate -Destination $outDir
        $licenseCopied = $true
        break
    }
}
if (-not $licenseCopied) { Write-Host "[warn] LICENSE not found; bundle will have no LICENSE file" -ForegroundColor Yellow }

$readmeDest = Join-Path $outDir "README-ANDROID.md"
if (Test-Path -LiteralPath (Join-Path $root $DocsSource)) {
    Copy-Item -LiteralPath (Join-Path $root $DocsSource) -Destination $readmeDest
} else {
    Write-Host "[warn] $DocsSource missing; README not bundled" -ForegroundColor Yellow
}

# inventory + hashes for the files users actually handle
$files = @(
    "CrystalLens-v1.1.0-android.apk",
    "CrystalLens-Android-Preview.html",
    "build-info.json",
    "README-ANDROID.md",
    "LICENSE"
)
foreach ($f in (Get-ChildItem (Join-Path $outDir "preview") -Recurse -File)) {
    $rel = $f.FullName.Substring($outDir.Length + 1)
    $files += $rel
}
$lines = @()
foreach ($rel in ($files | Sort-Object -Unique)) {
    $full = Join-Path $outDir $rel
    if (-not (Test-Path -LiteralPath $full -PathType Leaf)) { continue }
    $hash = (Get-FileHash -LiteralPath $full -Algorithm SHA256).Hash.ToLowerInvariant()
    $lines += ($hash + "  " + ($rel -replace '\\', '/'))
}
$linesText = $lines -join "`n"
[System.IO.File]::WriteAllText((Join-Path $outDir "SHA256SUMS.txt"), $linesText + "`n", $utf8NoBom)
[System.IO.File]::WriteAllText((Join-Path $dist "SHA256SUMS.txt"), $linesText + "`n", $utf8NoBom)
Write-Host ("[ok] hashes: " + $lines.Count + " files")

$apk = Get-Item (Join-Path $outDir "CrystalLens-v1.1.0-android.apk")
$apkHash = (Get-FileHash -LiteralPath $apk.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
$info = Get-Content -LiteralPath (Join-Path $outDir "build-info.json") -Raw | ConvertFrom-Json
$builtAt = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz')
$versionText = @"
CrystalLens for Android v1.1.0
================================
Ported from CrystalLens v1.1.0 (C++/Win32/OpenGL 3.3, MIT License)
Build time : $builtAt
Platform   : Android (Java WebView shell + WebGL2 core)
Build host : $env:COMPUTERNAME

Files
  CrystalLens-v1.1.0-android.apk      signed APK, sideload with any file manager
  CrystalLens-Android-Preview.html    single-file install-free preview, works offline
  preview\                            preview folder form (serve over local HTTP)
  README-ANDROID.md                   architecture, build, install and usage guide
  SHA256SUMS.txt                      SHA-256 checksums
  build-info.json                     APK build metadata

APK
  package           : com.crystallens.android
  versionName       : 1.1.0 (versionCode 110)
  minSdk / targetSdk: 24 / 36
  permissions       : android.permission.VIBRATE (only; no network, no storage)
  size              : $($apk.Length) bytes
  sha256            : $apkHash

Preview
  single file       : CrystalLens-Android-Preview.html
  size              : $((Get-Item (Join-Path $outDir 'CrystalLens-Android-Preview.html')).Length) bytes
  offline           : yes (crystal library embedded)
"@
[System.IO.File]::WriteAllText((Join-Path $outDir "VERSION.txt"), $versionText + "`n", $utf8NoBom)
[System.IO.File]::WriteAllText((Join-Path $dist "VERSION.txt"), $versionText + "`n", $utf8NoBom)
Write-Host "[ok] VERSION.txt"

if (-not $SkipZip) {
    Write-Host "=== create release zip ===" -ForegroundColor Cyan
    if (Test-Path -LiteralPath $zipPath) { Remove-Item -LiteralPath $zipPath -Force }
    Compress-Archive -Path (Join-Path $outDir "*") -DestinationPath $zipPath -CompressionLevel Optimal
    $zip = Get-Item $zipPath
    $zipHash = (Get-FileHash -LiteralPath $zip.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    Write-Host ("[ok] " + $zip.FullName + "  " + $zip.Length + " bytes  sha256=" + $zipHash)
}

Write-Host ""
Write-Host "=== release contents ===" -ForegroundColor Green
Get-ChildItem -LiteralPath $outDir -Force | Select-Object Mode, Name, Length | Format-Table -AutoSize | Out-String | Write-Host
$total = (Get-ChildItem -LiteralPath $outDir -Recurse -File | Measure-Object Length -Sum).Sum
Write-Host ("folder total: " + $total + " bytes")
