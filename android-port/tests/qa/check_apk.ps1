# CrystalLens Android - APK acceptance check (docs/QA-ACCEPTANCE.md §6)
#
# Verifies (read-only, extracts the APK to a temp folder):
#   1. apksigner verify (v2/v3 schemes + cert)
#   2. aapt2 dump badging   -> package / versionCode / versionName / sdk / launchable activity
#   3. aapt2 dump permissions -> no INTERNET / storage permissions, VIBRATE allowed
#   4. zip required entries: AndroidManifest.xml, resources.arsc, classes.dex, assets/www/index.html
#   5. assets/www file list + SHA256 equals dist/preview (single source of truth)
#   6. dist/build-info.json fields complete + sha256/size match the APK
#   7. headless Edge loads the *extracted APK* assets/www/index.html?selftest=1
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File tests\qa\check_apk.ps1
#   powershell ... -SkipAssetSelftest
# Exit code: 0 all pass, 1 failures, 2 setup error.
param(
    [string]$Apk = "dist\CrystalLens-v1.1.0-android.apk",
    [string]$PreviewDir = "dist\preview",
    [string]$BuildInfo = "dist\build-info.json",
    [switch]$SkipAssetSelftest,
    [string]$JsonOut = "tests\headless\out\qa-apk-report.json",
    [int]$SelftestBudgetMs = 15000
)

$ErrorActionPreference = "Continue"
$ProgressPreference = "SilentlyContinue"
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $root

$node = $env:CRYSTAL_NODE
if (-not $node -or -not (Test-Path $node)) { $cmd = Get-Command node -ErrorAction SilentlyContinue; if ($cmd) { $node = $cmd.Source } }
if (-not (Test-Path $node)) { $node = "node" }
$buildTools = ".toolchain\android-sdk\build-tools\36.0.0"
$apksigner = Join-Path $buildTools "apksigner.bat"
$aapt2 = Join-Path $buildTools "aapt2.exe"

$results = New-Object System.Collections.ArrayList
function Add-Result([string]$Id, [bool]$Ok, [string]$Detail) {
    [void]$results.Add([pscustomobject]@{ id = $Id; ok = $Ok; detail = $Detail })
    if ($Ok) { Write-Host ("[pass] " + $Id) -ForegroundColor DarkGreen }
    else { Write-Host ("[FAIL] " + $Id + " :: " + $Detail) -ForegroundColor Red }
}
function Expect([string]$Id, [bool]$Condition, [string]$Detail) { Add-Result $Id $Condition $Detail }
function Get-Sha256([string]$Path) { (Get-FileHash -Algorithm SHA256 -Path $Path).Hash.ToLowerInvariant() }

function Set-Fail([string]$Id, [string]$Detail) { Add-Result $Id $false $Detail }

# ------------------------------------------------------------------ setup --
Add-Type -AssemblyName System.IO.Compression.FileSystem | Out-Null

# apksigner.bat needs a JDK: use the bundled toolchain (same one build_apk.ps1 uses).
$jdk = ".toolchain\jdk"
if ((Test-Path (Join-Path $jdk "bin\java.exe")) -and -not $env:JAVA_HOME) {
    $env:JAVA_HOME = (Resolve-Path $jdk).Path
    $env:PATH = (Resolve-Path (Join-Path $jdk "bin")).Path + ";" + $env:PATH
}

if (-not (Test-Path $Apk)) { Set-Fail "apk.exists" "missing $Apk"; Write-Host "cannot continue"; exit 2 }
if (-not (Test-Path $apksigner)) { Set-Fail "toolchain.apksigner" "missing $apksigner"; exit 2 }
if (-not (Test-Path $aapt2)) { Set-Fail "toolchain.aapt2" "missing $aapt2"; exit 2 }
$apkPath = (Resolve-Path $Apk).Path
Add-Result "apk.exists" $true $apkPath

# -------------------------------------------------------- 1. apksigner -----
$signerOut = & $apksigner verify --verbose --print-certs $apkPath 2>&1 | Out-String
$signerExit = $LASTEXITCODE
if ($signerExit -eq 0 -and $signerOut -match "Verifies") {
    Add-Result "apksigner.verify" $true ("exit 0, " + (($signerOut -split "`n" | Select-String "Verifies") -join ";"))
} else {
    Set-Fail "apksigner.verify" ("exit " + $signerExit + " :: " + ($signerOut.Substring(0, [Math]::Min(600, $signerOut.Length))))
}
$v2 = $signerOut -match "Verified using v2 scheme[^:]*:\s*true"
$v3 = $signerOut -match "Verified using v3 scheme[^:]*:\s*true"
Add-Result "apksigner.v2" $v2 "v2 scheme"
Add-Result "apksigner.v3" $v3 "v3 scheme"
$cert = ""
$m = [regex]::Match($signerOut, "Signer #1 certificate DN:\s*(.+)")
if ($m.Success) { $cert = $m.Groups[1].Value.Trim() }
Add-Result "apksigner.cert" ($cert.Length -gt 0) $cert

# ---------------------------------------------------------- 2. badging -----
$badging = & $aapt2 dump badging $apkPath 2>&1 | Out-String
$pkgLine = ($badging -split "`n" | Select-String "^package:" | Select-Object -First 1)
$packageOk = $pkgLine -and ($pkgLine -match "name='com\.crystallens\.android'") -and
    ($pkgLine -match "versionCode='110'") -and ($pkgLine -match "versionName='1\.1\.0'")
Add-Result "badging.package" $packageOk ($(if ($pkgLine) { $pkgLine.ToString().Trim() } else { "no package: line" }))
$aaptVersionCode = if ($pkgLine -match "versionCode='(\d+)'") { $Matches[1] } else { "" }
$aaptVersionName = if ($pkgLine -match "versionName='([^']+)'") { $Matches[1] } else { "" }
$minSdk = ([regex]::Match($badging, "(?:minSdkVersion|sdkVersion):'(\d+)'")).Groups[1].Value
$targetSdk = ([regex]::Match($badging, "targetSdkVersion:'(\d+)'")).Groups[1].Value
Add-Result "badging.minSdk" ($minSdk -eq "24") ("minSdkVersion=" + $minSdk)
Add-Result "badging.targetSdk" ($targetSdk -eq "36") ("targetSdkVersion=" + $targetSdk)
$activity = ([regex]::Match($badging, "launchable-activity:\s*name='([^']+)'")).Groups[1].Value
Add-Result "badging.launchable-activity" ([bool]$activity) $activity
$label = ([regex]::Match($badging, "application-label:'([^']*)'")).Groups[1].Value
Add-Result "badging.label" ([bool]$label) $label

# ------------------------------------------------------ 3. permissions -----
$permsOut = & $aapt2 dump permissions $apkPath 2>&1 | Out-String
$permNames = [regex]::Matches($permsOut, "uses-permission:\s*name='([^']+)'") | ForEach-Object { $_.Groups[1].Value }
$permNames = @($permNames | Sort-Object -Unique)
Add-Result "permissions.vibrate" ($permNames -contains "android.permission.VIBRATE") ($permNames -join ", ")
$forbidden = @("android.permission.INTERNET", "android.permission.READ_EXTERNAL_STORAGE",
    "android.permission.WRITE_EXTERNAL_STORAGE", "android.permission.MANAGE_EXTERNAL_STORAGE")
$bad = @($permNames | Where-Object { $forbidden -contains $_ })
Add-Result "permissions.no-forbidden" ($bad.Count -eq 0) ($(if ($bad.Count -eq 0) { "only: " + ($permNames -join ", ") } else { "forbidden: " + ($bad -join ", ") }))

# ----------------------------------------------------- 4/5. zip contents ---
$zip = $null
try { $zip = [System.IO.Compression.ZipFile]::OpenRead($apkPath) } catch { }
if (-not $zip) { Set-Fail "zip.open" "cannot open APK as zip" }
else {
    $names = @($zip.Entries | ForEach-Object { $_.FullName.Replace('/', '\') })
    $dupCount = ($names.Count - ($names | Sort-Object -Unique).Count)
    Add-Result "zip.no-duplicates" ($dupCount -eq 0) ("$dupCount duplicate entries")
    $required = @("AndroidManifest.xml", "resources.arsc", "classes.dex", "assets\www\index.html")
    foreach ($req in $required) {
        $norm = $req.Replace('/', '\')
        Add-Result ("zip.required." + $norm) ($names -contains $norm) $req
    }
    # classes.dex non-empty
    $dexEntry = $zip.Entries | Where-Object { $_.FullName -eq "classes.dex" } | Select-Object -First 1
    Add-Result "zip.classes.dex-size" ($dexEntry -and $dexEntry.Length -gt 1000) ($(if ($dexEntry) { $dexEntry.Length } else { 0 }))

    # collect APK assets/www entries (path relative to www + sha256)
    $apkAssets = @{}
    foreach ($entry in $zip.Entries) {
        if ($entry.FullName -like "assets/www/*" -and -not $entry.FullName.EndsWith("/")) {
            $rel = $entry.FullName.Substring("assets/www/".Length)
            $stream = $entry.Open()
            $sha = [System.Security.Cryptography.SHA256]::Create()
            $hashBytes = $sha.ComputeHash($stream)
            $stream.Close(); $sha.Dispose()
            $hex = -join ($hashBytes | ForEach-Object { $_.ToString("x2") })
            $apkAssets[$rel] = @{ sha = $hex; size = $entry.Length }
        }
    }
    Add-Result "zip.assets.www-count" ($apkAssets.Count -ge 20) ($apkAssets.Count.ToString() + " files under assets/www/")

    # compare with dist/preview
    $previewRoot = (Resolve-Path $PreviewDir -ErrorAction SilentlyContinue)
    if (-not $previewRoot) {
        Set-Fail "assets.preview-dir" "missing $PreviewDir"
    } else {
        $previewFiles = @{}
        Get-ChildItem -Path $previewRoot -Recurse -File | ForEach-Object {
            $rel = $_.FullName.Substring($previewRoot.Path.Length + 1).Replace('\', '/')
            $previewFiles[$rel] = $_
        }
        $missingInApk = @($previewFiles.Keys | Where-Object { -not $apkAssets.ContainsKey($_) })
        $extraInApk = @($apkAssets.Keys | Where-Object { -not $previewFiles.ContainsKey($_) })
        Add-Result "assets.same-file-list" (($missingInApk.Count -eq 0) -and ($extraInApk.Count -eq 0)) `
            ("missing in APK: [" + (($missingInApk | Select-Object -First 6) -join ", ") + "] extra in APK: [" + (($extraInApk | Select-Object -First 6) -join ", ") + "]")
        $shaDiff = @()
        foreach ($rel in $previewFiles.Keys) {
            if (-not $apkAssets.ContainsKey($rel)) { continue }
            $want = Get-Sha256 $previewFiles[$rel].FullName
            if ($apkAssets[$rel].sha -ne $want) { $shaDiff += $rel }
        }
        Add-Result "assets.same-sha256" ($shaDiff.Count -eq 0) `
            ("differing: " + (($shaDiff | Select-Object -First 6) -join ", "))
    }
    $zip.Dispose()
}

# -------------------------------------------------------- 6. build-info ----
if (-not (Test-Path $BuildInfo)) {
    Set-Fail "build-info.exists" "missing $BuildInfo"
} else {
    try { $bi = Get-Content $BuildInfo -Raw -Encoding UTF8 | ConvertFrom-Json } catch { $bi = $null }
    if (-not $bi) {
        Set-Fail "build-info.parse" "invalid JSON"
    } else {
        $fields = @("app", "package", "versionName", "versionCode", "minSdk", "targetSdk",
            "apk", "apkSizeBytes", "sha256", "builtAt", "toolchain", "signature", "verified")
        $missing = @($fields | Where-Object { -not ($bi.PSObject.Properties.Name -contains $_) })
        Add-Result "build-info.fields" ($missing.Count -eq 0) ("missing: " + ($missing -join ", "))
        Expect "build-info.package" ($bi.package -eq "com.crystallens.android") $bi.package
        Expect "build-info.version" (($bi.versionName -eq "1.1.0") -and ([int]$bi.versionCode -eq 110)) `
            ($bi.versionName + "/" + $bi.versionCode)
        $actualSize = (Get-Item $apkPath).Length
        Expect "build-info.size" ([long]$bi.apkSizeBytes -eq $actualSize) ("json=" + $bi.apkSizeBytes + " actual=" + $actualSize)
        $actualSha = Get-Sha256 $apkPath
        Expect "build-info.sha256" ($bi.sha256.ToLowerInvariant() -eq $actualSha) ("json=" + $bi.sha256 + " actual=" + $actualSha)
        $tc = $bi.toolchain
        Expect "build-info.toolchain" ($tc -and $tc.jdk -and $tc.buildTools -eq "36.0.0" -and $tc.platform -eq "android-36") `
            ($(if ($tc) { "jdk=" + $tc.jdk + " bt=" + $tc.buildTools + " platform=" + $tc.platform } else { "absent" }))
        Expect "build-info.signature" ($bi.signature -and $bi.signature.verified -eq $true) `
            ($(if ($bi.signature) { $bi.signature.summary } else { "absent" }))
        Expect "build-info.verification" ($bi.verified -and $bi.verified.apksigner -eq "passed") `
            ($(if ($bi.verified) { $bi.verified.apksigner } else { "absent" }))
        $wwwCount = if ($bi.PSObject.Properties.Name -contains "wwwFileCount") { [int]$bi.wwwFileCount } else { -1 }
        Add-Result "build-info.www-count" ($wwwCount -ge 20) ("wwwFileCount=" + $wwwCount)
    }
}

# --------------------------------------- 7. selftest on extracted assets ---
if ($SkipAssetSelftest) {
    Write-Host "[skip] APK assets selftest (-SkipAssetSelftest)"
} elseif (-not (Test-Path $apksigner)) {
    Set-Fail "apk-assets.selftest" "toolchain missing"
} else {
    $tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("cl-apk-assets-" + [guid]::NewGuid().ToString("N"))
    try {
        New-Item -ItemType Directory -Path $tmp -Force | Out-Null
        [System.IO.Compression.ZipFile]::ExtractToDirectory($apkPath, $tmp)
        $wwwIndex = Join-Path $tmp "assets\www\index.html"
        if (-not (Test-Path $wwwIndex)) {
            Set-Fail "apk-assets.selftest" "assets/www/index.html not found after extraction"
        } else {
            $uri = "file:///" + ($wwwIndex.Replace('\', '/')) + "?selftest=1"
            $shot = "tests\headless\shot.cjs"
            $selftestOut = & $node $shot --url $uri --selftest --budget $SelftestBudgetMs 2>$null | Out-String
            $selftestExit = $LASTEXITCODE
            $jsonStart = $selftestOut.IndexOf("{")
            $parsed = $null
            if ($jsonStart -ge 0) {
                try { $parsed = $selftestOut.Substring($jsonStart) | ConvertFrom-Json } catch { $parsed = $null }
            }
            if (-not $parsed) {
                Set-Fail "apk-assets.selftest" ("no JSON report from headless browser (exit " + $selftestExit + "): " + $selftestOut.Substring(0, [Math]::Min(400, $selftestOut.Length)))
            } else {
                $st = $parsed.selftest
                $ok = $st -and ($st.fail -eq 0) -and ($parsed.pageErrors.Count -eq 0)
                Add-Result "apk-assets.selftest" $ok `
                    ("exit=" + $selftestExit + " pass=" + $(if ($st) { $st.pass } else { "?" }) +
                     " fail=" + $(if ($st) { $st.fail } else { "?" }) +
                     " pageErrors=" + $parsed.pageErrors.Count +
                     " screenshot=" + $(if ($parsed.screenshotBytes) { $parsed.screenshotBytes + "B" } else { "none" }))
                if ($st -and $st.failures -and $st.failures.Count -gt 0) {
                    Write-Host ("       selftest failures: " + (($st.failures | Select-Object -First 5) -join " | ")) -ForegroundColor Yellow
                }
                if ($st -and $st.info) {
                    Write-Host ("       selftest info: " + ($st.info | ConvertTo-Json -Compress -Depth 4)) -ForegroundColor DarkGray
                }
            }
        }
    } finally {
        if (Test-Path $tmp) { Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue }
    }
}

# ------------------------------------------------------------- summary -----
$failed = @($results | Where-Object { -not $_.ok })
Write-Host ""
Write-Host ("APK checks: " + ($results.Count - $failed.Count) + "/" + $results.Count + " passed, " + $failed.Count + " failed") `
    -ForegroundColor $(if ($failed.Count) { "Red" } else { "Green" })
if ($failed.Count) {
    Write-Host "failed checks:" -ForegroundColor Red
    $failed | ForEach-Object { Write-Host ("  - " + $_.id + " :: " + $_.detail) -ForegroundColor Red }
}
try {
    $report = [pscustomobject]@{
        generatedAt = (Get-Date).ToString("o")
        apk         = $apkPath
        checks      = $results
        failed      = $failed.Count
    }
    $outDir = Split-Path -Parent $JsonOut
    if ($outDir -and -not (Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir -Force | Out-Null }
    $report | ConvertTo-Json -Depth 6 | Set-Content -Path $JsonOut -Encoding UTF8
    Write-Host ("report: " + $JsonOut)
} catch {
    Write-Host ("[warn] could not write report: " + $_.Exception.Message) -ForegroundColor Yellow
}
if ($failed.Count) { exit 1 } else { exit 0 }
