#Requires -Version 5.1
<#
.SYNOPSIS
    Build CrystalLens and create a portable win64 release zip.
.PARAMETER SkipBuild
    Reuse the existing build/Release output.
#>
[CmdletBinding()]
param(
    [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$BuildDir = Join-Path $Root 'build'
$Version = '1.4.0'
$StageName = "CrystalLens-v$Version-win64"
$DistDir = Join-Path $Root 'dist'
$StageDir = Join-Path $DistDir $StageName

if (-not $SkipBuild) {
    & (Join-Path $Root 'build.ps1')
    if ($LASTEXITCODE -ne 0) { throw "build.ps1 failed (exit $LASTEXITCODE)." }
}

$exe = Join-Path $BuildDir 'Release\CrystalLens.exe'
if (-not (Test-Path -LiteralPath $exe)) {
    throw "Executable not found: $exe. Run .\build.ps1 first."
}

if (Test-Path -LiteralPath $StageDir) {
    Remove-Item -LiteralPath $StageDir -Recurse -Force
}
if (Test-Path -LiteralPath "$StageDir.zip") {
    Remove-Item -LiteralPath "$StageDir.zip" -Force
}
New-Item -ItemType Directory -Path $StageDir -Force | Out-Null

Copy-Item -LiteralPath $exe -Destination $StageDir
Copy-Item -LiteralPath (Join-Path $Root 'README.md') -Destination $StageDir
Copy-Item -LiteralPath (Join-Path $Root 'LICENSE') -Destination $StageDir

Copy-Item -LiteralPath (Join-Path $Root 'library') -Destination $StageDir -Recurse

$examplesDir = Join-Path $StageDir 'examples'
New-Item -ItemType Directory -Path $examplesDir -Force | Out-Null
Copy-Item -Path (Join-Path $Root 'examples\*.cif') -Destination $examplesDir -ErrorAction SilentlyContinue
Copy-Item -Path (Join-Path $Root 'examples\*.xyz') -Destination $examplesDir -ErrorAction SilentlyContinue
Copy-Item -Path (Join-Path $Root 'examples\*.vesta') -Destination $examplesDir -ErrorAction SilentlyContinue

$docsDest = Join-Path $StageDir 'docs'
New-Item -ItemType Directory -Path $docsDest -Force | Out-Null
foreach ($name in @('polyhedron-editor-v14.png', 'halite-polyhedra-v11.png', 'polyhedra-v09.png', 'screenshot-v08-srtio3.png', 'screenshot-main.png', 'screenshot-supercell.png', 'screenshot-polyhedral.png', 'screenshot-bi2te3.png', 'screenshot-crcobr3.png', 'screenshot-appearance.png', 'screenshot-help.png', 'screenshot-editcell.png', 'screenshot-editatom.png')) {
    $source = Join-Path $Root "docs\$name"
    if (Test-Path -LiteralPath $source) {
        Copy-Item -LiteralPath $source -Destination $docsDest
    }
}

$hash = Get-FileHash -LiteralPath (Join-Path $StageDir 'CrystalLens.exe') -Algorithm SHA256
"$($hash.Hash)  CrystalLens.exe" | Set-Content -LiteralPath (Join-Path $StageDir 'SHA256SUMS.txt') -Encoding ascii
Set-Content -LiteralPath (Join-Path $StageDir 'VERSION.txt') -Value "CrystalLens $Version (win64)" -Encoding ascii

$zip = "$StageDir.zip"
Compress-Archive -Path (Join-Path $StageDir '*') -DestinationPath $zip -CompressionLevel Optimal -Force

Write-Host ''
Write-Host "Package: $zip" -ForegroundColor Green
Write-Host ("Size: {0:N0} bytes" -f (Get-Item -LiteralPath $zip).Length)
