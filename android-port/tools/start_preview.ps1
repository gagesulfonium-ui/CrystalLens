# Start the install-free CrystalLens preview on this PC (and over the LAN)
# Usage: powershell -ExecutionPolicy Bypass -File tools\start_preview.ps1 [-Port 8000] [-NoBrowser]
param(
    [int]$Port = 8000,
    [switch]$NoBrowser
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

$python = $env:CRYSTAL_PYTHON
if (-not $python -or -not (Test-Path $python)) { $python = "python" }

$preview = Join-Path $root "dist\preview\index.html"
if (-not (Test-Path $preview)) {
    Write-Host "[build] dist\preview missing, running build..."
    & $python (Join-Path $root "tools\build_web.py")
}

$argsList = @((Join-Path $root "tools\serve_preview.py"), "--port", "$Port")
if ($NoBrowser) { $argsList += "--no-browser" }
& $python @argsList
