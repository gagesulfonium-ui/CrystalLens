# CrystalLens Android - QA acceptance runner (one command, reproducible evidence)
#
# Runs the whole acceptance matrix from docs/QA-ACCEPTANCE.md and stores every
# log/report under tests/headless/out/:
#
#   1. Node unit tests (all agents' tests/node/test_*.js, incl. test_acceptance.js)
#   2. Camera numerical cases (tests/qa/check_camera.cjs, QA-ACCEPTANCE §3)
#   3. Web build (gen_library + build_web)                    [unless -SkipBuild]
#   4. Single-file preview self-containment (tests/qa/check_preview.cjs)   §5
#   5. Headless visual suite, single-file + folder builds      §4
#   6. ?selftest=1 on single-file + folder preview             §4
#   7. APK build + verification (tools/build_apk.ps1 + tests/qa/check_apk.ps1)  §6
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File tests\qa\run_all.ps1
#   powershell ... -SkipBuild -SkipApkBuild -SkipVisual   # fast re-check of existing artifacts
# Exit code: 0 all steps pass, 1 failures, 2 setup error.
param(
    [switch]$SkipBuild,
    [switch]$SkipApk,
    [switch]$SkipApkBuild,
    [switch]$SkipVisual,
    [switch]$SkipSelftest,
    [switch]$FolderVisualOnly
)

$ErrorActionPreference = "Continue"
$ProgressPreference = "SilentlyContinue"
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $root

$node = $env:CRYSTAL_NODE
if (-not $node -or -not (Test-Path $node)) { $cmd = Get-Command node -ErrorAction SilentlyContinue; if ($cmd) { $node = $cmd.Source } }
if (-not $node) { throw "node not found (set CRYSTAL_NODE or add node to PATH)" }
if (-not (Test-Path $node)) { $node = "node" }
$python = $env:CRYSTAL_PYTHON
if (-not $python -or -not (Test-Path $python)) { $cmd = Get-Command python -ErrorAction SilentlyContinue; if ($cmd) { $python = $cmd.Source } }
if (-not $python) { throw "python not found (set CRYSTAL_PYTHON or add python to PATH)" }
if (-not (Test-Path $python)) { $python = "python" }

$OUT = "tests\headless\out"
if (-not (Test-Path $OUT)) { New-Item -ItemType Directory -Path $OUT -Force | Out-Null }
$SINGLE = "dist\CrystalLens-Android-Preview.html"
$FOLDER = "dist\preview\index.html"

$steps = New-Object System.Collections.ArrayList
function Run-Step([string]$Name, [scriptblock]$Action) {
    Write-Host ""
    Write-Host ("=== " + $Name + " ===") -ForegroundColor Cyan
    $sw = [Diagnostics.Stopwatch]::StartNew()
    $code = 0
    try { & $Action; $code = $LASTEXITCODE } catch { Write-Host ("[error] " + $_.Exception.Message) -ForegroundColor Red; $code = 1 }
    if ($null -eq $code) { $code = 0 }
    $sw.Stop()
    $ok = ($code -eq 0)
    [void]$steps.Add([pscustomobject]@{ step = $Name; ok = $ok; exit = $code; seconds = [math]::Round($sw.Elapsed.TotalSeconds, 1) })
    if ($ok) { Write-Host ("[pass] " + $Name + " (" + [math]::Round($sw.Elapsed.TotalSeconds, 1) + "s)") -ForegroundColor Green }
    else { Write-Host ("[FAIL] " + $Name + " (exit " + $code + ", " + [math]::Round($sw.Elapsed.TotalSeconds, 1) + "s)") -ForegroundColor Red }
}

# ------------------------------------------------------- 1. node tests -----
Run-Step "node unit + acceptance tests" {
    & $node "tests\node\run.js" *> (Join-Path $OUT "qa-node-tests.log")
    Write-Host ("  log: " + (Join-Path $OUT "qa-node-tests.log"))
    $tail = Get-Content (Join-Path $OUT "qa-node-tests.log") | Select-Object -Last 3
    $tail | ForEach-Object { Write-Host ("  " + $_) }
    $LASTEXITCODE
}

# ------------------------------------------------------- 2. camera math ----
Run-Step "camera numerical cases (A1-A7)" {
    & $node "tests\qa\check_camera.cjs" --json (Join-Path $OUT "qa-camera-report.json") *> (Join-Path $OUT "qa-camera.log")
    Get-Content (Join-Path $OUT "qa-camera.log") | Select-Object -Last 2 | ForEach-Object { Write-Host ("  " + $_) }
    $LASTEXITCODE
}

# ------------------------------------------------------- 3. web build ------
if (-not $SkipBuild) {
    Run-Step "embed library (tools/gen_library.py)" {
        & $python "tools\gen_library.py" *> (Join-Path $OUT "qa-gen-library.log")
        $LASTEXITCODE
    }
    Run-Step "build preview (tools/build_web.py)" {
        & $python "tools\build_web.py" *> (Join-Path $OUT "qa-build-web.log")
        Get-Content (Join-Path $OUT "qa-build-web.log") | Select-Object -Last 3 | ForEach-Object { Write-Host ("  " + $_) }
        $LASTEXITCODE
    }
}

# ------------------------------------------- 4. single-file self-contain ---
Run-Step "single-file / folder preview structure" {
    & $node "tests\qa\check_preview.cjs" --json (Join-Path $OUT "qa-preview-report.json") *> (Join-Path $OUT "qa-preview.log")
    Get-Content (Join-Path $OUT "qa-preview.log") | Select-Object -Last 2 | ForEach-Object { Write-Host ("  " + $_) }
    $LASTEXITCODE
}

# --------------------------------------------------- 5. headless visual ----
function Run-Visual([string]$target, [string]$logSuffix) {
    & $node "tests\headless\run_suite.cjs" --target $target *> (Join-Path $OUT ("qa-visual-" + $logSuffix + ".log"))
    $code = $LASTEXITCODE
    $rep = "tests\headless\visual-report.json"
    if (Test-Path $rep) { Copy-Item $rep (Join-Path $OUT ("qa-visual-" + $logSuffix + "-report.json")) -Force }
    Get-Content (Join-Path $OUT ("qa-visual-" + $logSuffix + ".log")) | Select-Object -Last 2 | ForEach-Object { Write-Host ("  " + $_) }
    return $code
}
if (-not $SkipVisual) {
    if (-not $FolderVisualOnly) {
        Run-Step "headless visual suite (single-file)" { Run-Visual "single" "single" }
    }
    Run-Step "headless visual suite (folder)" { Run-Visual "folder" "folder" }
}

# ----------------------------------------------------- 6. selftest mode ----
function Run-Selftest([string]$page, [string]$outPng, [string]$logName) {
    $uri = "file:///" + ((Resolve-Path $page).Path -replace '\\', '/') + "?selftest=1"
    $log = Join-Path $OUT $logName
    & $node "tests\headless\shot.cjs" --url $uri --selftest --out $outPng --budget 20000 *> $log
    $code = $LASTEXITCODE
    $text = Get-Content $log -Raw
    $st = $null
    $m = [regex]::Match($text, '"selftest":\s*(\{[\s\S]*?\n  \})')
    if ($m.Success) { try { $st = $m.Groups[1].Value | ConvertFrom-Json } catch { } }
    if ($st) { Write-Host ("  selftest: pass=" + $st.pass + " fail=" + $st.fail + " failures=" + (($st.failures) -join " | ")) }
    if ($st -and $st.info) { Write-Host ("  info: renderer=" + $st.info.renderer + " supported=" + $st.info.rendererSupported + " lang=" + $st.info.language) }
    return $code
}
if (-not $SkipSelftest) {
    if (Test-Path $SINGLE) {
        Run-Step "selftest=1 single-file preview" { Run-Selftest $SINGLE (Join-Path $OUT "qa-selftest-single.png") "qa-selftest-single.log" }
    }
    if (Test-Path $FOLDER) {
        Run-Step "selftest=1 folder preview" { Run-Selftest $FOLDER (Join-Path $OUT "qa-selftest-folder.png") "qa-selftest-folder.log" }
    }
}

# ------------------------------------------------------------- 7. APK ------
if (-not $SkipApk) {
    if (-not $SkipApkBuild) {
        Run-Step "build signed APK (tools/build_apk.ps1)" {
            & powershell -ExecutionPolicy Bypass -NoProfile -File "tools\build_apk.ps1" *> (Join-Path $OUT "qa-build-apk.log")
            $code = $LASTEXITCODE
            Get-Content (Join-Path $OUT "qa-build-apk.log") -ErrorAction SilentlyContinue | Select-Object -Last 4 | ForEach-Object { Write-Host ("  " + $_) }
            $code
        }
    }
    Run-Step "APK verification (tests/qa/check_apk.ps1)" {
        & powershell -ExecutionPolicy Bypass -NoProfile -File "tests\qa\check_apk.ps1" -JsonOut (Join-Path $OUT "qa-apk-report.json") *> (Join-Path $OUT "qa-apk.log")
        $code = $LASTEXITCODE
        Get-Content (Join-Path $OUT "qa-apk.log") -ErrorAction SilentlyContinue | Select-Object -Last 3 | ForEach-Object { Write-Host ("  " + $_) }
        $code
    }
}

# ------------------------------------------------------------- summary -----
$failed = @($steps | Where-Object { -not $_.ok })
Write-Host ""
Write-Host "=== QA matrix summary ===" -ForegroundColor Cyan
$steps | Format-Table -AutoSize | Out-String | Write-Host
$summary = [pscustomobject]@{
    generatedAt = (Get-Date).ToString("o")
    steps       = $steps
    failed      = $failed.Count
    artifacts   = @{
        singleFile = $SINGLE
        folder     = "dist\preview\"
        apk        = "dist\CrystalLens-v1.1.0-android.apk"
        logs       = "tests\headless\out\qa-*.log"
    }
}
$summary | ConvertTo-Json -Depth 6 | Set-Content -Path (Join-Path $OUT "qa-summary.json") -Encoding UTF8
Write-Host ("steps: " + ($steps.Count - $failed.Count) + "/" + $steps.Count + " passed, " + $failed.Count + " failed")
Write-Host ("summary: " + (Join-Path $OUT "qa-summary.json"))
if ($failed.Count) { exit 1 } else { exit 0 }
