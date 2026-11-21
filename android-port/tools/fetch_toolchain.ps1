# Fetch a self-contained JDK + Android SDK subset needed to build the APK
# without installing Android Studio / Gradle.
#
# Output layout:
#   .toolchain/jdk/bin/{java,javac,keytool}.exe
#   .toolchain/android-sdk/build-tools/36.0.0/{aapt2,d8,zipalign,apksigner}.{exe,bat,jar}
#   .toolchain/android-sdk/platforms/android-36/android.jar
#   .toolchain/android-sdk/platform-tools/adb.exe   (optional, for device testing)
#
# Usage: powershell -ExecutionPolicy Bypass -File tools\fetch_toolchain.ps1
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
# Native commands (java -version, tar) may write to stderr; never treat that as fatal.
$PSNativeCommandUseErrorActionPreference = $false

$root = Split-Path -Parent $PSScriptRoot
$tc = Join-Path $root ".toolchain"
$dl = Join-Path $tc "downloads"
$sdk = Join-Path $tc "android-sdk"
New-Item -ItemType Directory -Force -Path $dl, $sdk | Out-Null

function Get-RemoteFile([string]$Url, [string]$Out) {
    if ((Test-Path $Out) -and ((Get-Item $Out).Length -gt 1024)) {
        Write-Host ("[cached] {0} ({1:N1} MB)" -f (Split-Path $Out -Leaf), ((Get-Item $Out).Length / 1MB))
        return
    }
    Write-Host ("[download] {0}" -f $Url)
    $sw = [Diagnostics.Stopwatch]::StartNew()
    $attempt = 0
    while ($true) {
        try {
            Invoke-WebRequest -Uri $Url -OutFile $Out -UseBasicParsing -TimeoutSec 1800
            break
        } catch {
            $attempt++
            if ($attempt -ge 3) { throw }
            Write-Host ("  retry {0}: {1}" -f $attempt, $_.Exception.Message)
            Start-Sleep -Seconds (3 * $attempt)
        }
    }
    $sw.Stop()
    Write-Host ("[ok] {0:N1} MB in {1:N1}s -> {2}" -f ((Get-Item $Out).Length / 1MB), $sw.Elapsed.TotalSeconds, $Out)
}

function Expand-ZipArchive([string]$Zip, [string]$Dest) {
    New-Item -ItemType Directory -Force -Path $Dest | Out-Null
    # bsdtar ships with Windows 10+, much faster than Expand-Archive for large jars
    tar -xf $Zip -C $Dest
    if ($LASTEXITCODE -ne 0) { throw "tar extraction failed for $Zip" }
}

function Move-FirstChild([string]$Src, [string]$Dest) {
    $child = Get-ChildItem $Src -Directory | Select-Object -First 1
    if (-not $child) { throw "no directory inside $Src" }
    if (Test-Path $Dest) { Remove-Item -Recurse -Force $Dest }
    Move-Item -LiteralPath $child.FullName -Destination $Dest
}

# ---------------------------------------------------------------- JDK 17 ----
$jdkDir = Join-Path $tc "jdk"
if (-not (Test-Path (Join-Path $jdkDir "bin\javac.exe"))) {
    $jdkZip = Join-Path $dl "jdk17-windows-x64.zip"
    $sources = @(
        "https://api.adoptium.net/v3/binary/latest/17/ga/windows/x64/jdk/hotspot/normal/eclipse",
        "https://mirrors.tuna.tsinghua.edu.cn/Adoptium/17/jdk/x64/windows/OpenJDK17U-jdk_x64_windows_hotspot_17.0.13_11.zip"
    )
    $got = $false
    foreach ($url in $sources) {
        try { Get-RemoteFile $url $jdkZip; $got = (Test-Path $jdkZip); if ($got) { break } } catch { Write-Host ("  failed: {0}" -f $_.Exception.Message) }
    }
    if (-not $got) { throw "could not download a JDK 17 build" }
    $tmp = Join-Path $dl "jdk-extract"
    Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
    Expand-ZipArchive $jdkZip $tmp
    Move-FirstChild $tmp $jdkDir
    Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}
$java = Join-Path $jdkDir "bin\java.exe"
$javac = Join-Path $jdkDir "bin\javac.exe"
if (-not (Test-Path $java)) { throw "JDK extraction incomplete: $java missing" }
$savedEap = $ErrorActionPreference
$ErrorActionPreference = "Continue"
$jdkVersionLine = (& $java -version 2>&1 | Select-Object -First 1)
$ErrorActionPreference = $savedEap
Write-Host ("[jdk] " + $jdkVersionLine)

# ------------------------------------------------------- Android build-tools ----
$btDir = Join-Path $sdk "build-tools\36.0.0"
if (-not (Test-Path (Join-Path $btDir "aapt2.exe"))) {
    $btZip = Join-Path $dl "build-tools_r36_windows.zip"
    Get-RemoteFile "https://dl.google.com/android/repository/build-tools_r36_windows.zip" $btZip
    $tmp = Join-Path $dl "build-tools-extract"
    Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
    Expand-ZipArchive $btZip $tmp
    New-Item -ItemType Directory -Force -Path (Split-Path $btDir) | Out-Null
    Move-FirstChild $tmp $btDir
    Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}

# ------------------------------------------------------------- SDK platform ----
$platformDir = Join-Path $sdk "platforms\android-36"
if (-not (Test-Path (Join-Path $platformDir "android.jar"))) {
    $platZip = Join-Path $dl "platform-36_r02.zip"
    Get-RemoteFile "https://dl.google.com/android/repository/platform-36_r02.zip" $platZip
    $tmp = Join-Path $dl "platform-extract"
    Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
    Expand-ZipArchive $platZip $tmp
    New-Item -ItemType Directory -Force -Path (Split-Path $platformDir) | Out-Null
    Move-FirstChild $tmp $platformDir
    Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}

# ------------------------------------------------------------ platform-tools ----
$ptDir = Join-Path $sdk "platform-tools"
if (-not (Test-Path (Join-Path $ptDir "adb.exe"))) {
    $ptZip = Join-Path $dl "platform-tools_r37.0.3-win.zip"
    try {
        Get-RemoteFile "https://dl.google.com/android/repository/platform-tools_r37.0.3-win.zip" $ptZip
        $tmp = Join-Path $dl "platform-tools-extract"
        Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
        Expand-ZipArchive $ptZip $tmp
        Move-FirstChild $tmp $ptDir
        Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
    } catch {
        Write-Host ("[warn] platform-tools skipped: " + $_.Exception.Message)
    }
}

# ---------------------------------------------------------------- validate ----
$checks = @(
    @{ Path = (Join-Path $jdkDir "bin\java.exe"); Name = "java" },
    @{ Path = (Join-Path $jdkDir "bin\javac.exe"); Name = "javac" },
    @{ Path = (Join-Path $jdkDir "bin\keytool.exe"); Name = "keytool" },
    @{ Path = (Join-Path $btDir "aapt2.exe"); Name = "aapt2" },
    @{ Path = (Join-Path $btDir "d8.bat"); Name = "d8" },
    @{ Path = (Join-Path $btDir "zipalign.exe"); Name = "zipalign" },
    @{ Path = (Join-Path $btDir "apksigner.bat"); Name = "apksigner" },
    @{ Path = (Join-Path $platformDir "android.jar"); Name = "android.jar" }
)
$missing = @()
foreach ($c in $checks) {
    if (Test-Path $c.Path) { Write-Host ("[ok] {0}: {1}" -f $c.Name, $c.Path) } else { $missing += $c.Name; Write-Host ("[MISSING] {0}: {1}" -f $c.Name, $c.Path) }
}
$marker = Join-Path $tc "TOOLCHAIN_READY.json"
@{
    jdk       = $jdkDir
    sdk       = $sdk
    buildTools = $btDir
    platform  = $platformDir
    fetchedAt = (Get-Date).ToString("o")
    missing   = $missing
} | ConvertTo-Json | Set-Content -Path $marker -Encoding UTF8
if ($missing.Count -gt 0) { throw ("toolchain incomplete, missing: " + ($missing -join ", ")) }
Write-Host "[done] toolchain ready -> $marker"
