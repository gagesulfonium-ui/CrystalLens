# CrystalLens Android - one-click build pipeline
#
#   1. embed the offline crystal library      (tools/gen_library.py)
#   2. build the install-free web preview     (tools/build_web.py)
#   3. run the Node unit tests                (tests/node/run.js)
#   4. run the headless self-test             (tests/headless/shot.cjs --selftest)
#   5. build the signed APK                   (tools/build_apk.ps1)
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File tools\build_all.ps1
#   powershell ... -SkipApk            # web only
#   powershell ... -SkipTests          # build only
param(
    [switch]$SkipApk,
    [switch]$SkipTests,
    [switch]$SkipWeb
)
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Find-Tool([string]$Name, [string[]]$Candidates) {
    foreach ($c in $Candidates) {
        if ($c -and (Test-Path $c)) { return $c }
    }
    $cmd = Get-Command $Name -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    throw "cannot find $Name (looked at: $($Candidates -join ', '))"
}

$python = Find-Tool "python" @($env:CRYSTAL_PYTHON)
$node = Find-Tool "node" @($env:CRYSTAL_NODE)

$steps = @()
function Step([string]$Name, [scriptblock]$Action) {
    Write-Host ""
    Write-Host ("=== " + $Name + " ===") -ForegroundColor Cyan
    $sw = [Diagnostics.Stopwatch]::StartNew()
    & $Action
    if ($LASTEXITCODE -ne 0) { throw ("step failed: " + $Name + " (exit " + $LASTEXITCODE + ")") }
    $sw.Stop()
    $script:steps += [pscustomobject]@{ step = $Name; seconds = [math]::Round($sw.Elapsed.TotalSeconds, 1) }
}

if (-not $SkipWeb) {
    Step "embed crystal library" { & $python "tools\gen_library.py" }
    Step "build web preview" { & $python "tools\build_web.py" }
}

if (-not $SkipTests) {
    Step "node unit tests" { & $node "tests\node\run.js" }
    $single = Join-Path $root "dist\CrystalLens-Android-Preview.html"
    if (Test-Path $single) {
        $uri = "file:///" + ($single -replace '\\', '/')
        Step "headless self-test" { & $node "tests\headless\shot.cjs" --url ($uri + "?selftest=1") --selftest --budget 15000 }
    } else {
        Write-Host "[skip] single-file preview missing" -ForegroundColor Yellow
    }
}

if (-not $SkipApk) {
    Step "build signed APK" { & powershell -ExecutionPolicy Bypass -NoProfile -File "tools\build_apk.ps1" }
}

Write-Host ""
Write-Host "=== summary ===" -ForegroundColor Green
$steps | Format-Table -AutoSize | Out-String | Write-Host
Write-Host "artifacts:"
Get-ChildItem "dist" -File -ErrorAction SilentlyContinue | Select-Object Name, Length, LastWriteTime | Format-Table -AutoSize | Out-String | Write-Host
Write-Host ("total: " + [math]::Round(($steps | Measure-Object seconds -Sum).Sum, 1) + "s")
