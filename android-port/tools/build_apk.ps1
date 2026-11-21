<#
.SYNOPSIS
    Build dist/CrystalLens-v1.1.0-android.apk with the plain Android SDK toolchain
    (aapt2 + javac + d8 + zipalign + apksigner). No Gradle, no AndroidX, no network.

.DESCRIPTION
    Pipeline:
      1. locate .toolchain via .toolchain/TOOLCHAIN_READY.json
      2. sync dist/preview -> android/app/src/main/assets/www (or keep the placeholder page)
      3. aapt2 compile  res/ -> .build/res.zip
      4. aapt2 link     manifest + res + assets -> .build/app-unsigned.apk
      5. javac          sources + generated R.java -> .build/classes (Java 8 bytecode)
      6. d8             classes (packed into classes.jar) -> .build/dex/classes.dex
      7. append classes.dex into the APK with System.IO.Compression.ZipArchive
      8. zipalign -p -f 4
      9. apksigner sign (debug keystore, auto-created in .toolchain/debug.keystore)
     10. verify: apksigner verify, aapt2 dump badging, aapt2 dump permissions, zip entries
     11. write dist/build-info.json (size, sha256, timings, toolchain, assets count)

    Requires Windows PowerShell 5.1+. The toolchain must be fetched first:
        powershell -ExecutionPolicy Bypass -File tools\fetch_toolchain.ps1

.PARAMETER WebSource
    auto        (default) use dist/preview when it contains index.html, else the placeholder page
    preview     fail unless dist/preview/index.html exists
    placeholder ignore dist/preview and bundle android/placeholder/index.html

.PARAMETER KeepBuild
    Do not delete android/.build before building.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File tools\build_apk.ps1

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File tools\build_apk.ps1 -WebSource placeholder -KeepBuild
#>
[CmdletBinding()]
param(
    [ValidateSet('auto', 'preview', 'placeholder')]
    [string]$WebSource = 'auto',
    [switch]$KeepBuild
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

# ================================================================ constants ======
$script:VersionName = '1.1.0'
$script:VersionCode = 110
$script:MinSdk = 24
$script:TargetSdk = 36
$script:CompileSdk = 36
$script:PackageName = 'com.crystallens.android'
$script:OutApkName = 'CrystalLens-v1.1.0-android.apk'

# ================================================================ helpers ========
$script:StepIndex = 0
$script:BuildStarted = Get-Date

function Write-Step([string]$text) {
    $script:StepIndex++
    Write-Host ''
    Write-Host ('=== [{0}] {1} ===' -f $script:StepIndex, $text) -ForegroundColor Cyan
}

function Write-Info([string]$text) {
    Write-Host ('[info] ' + $text)
}

function Write-Warn2([string]$text) {
    Write-Host ('[warn] ' + $text) -ForegroundColor Yellow
}

function Write-Ok([string]$text) {
    Write-Host ('[ok]   ' + $text) -ForegroundColor Green
}

function Fail([string]$text) {
    Write-Host ('[FAIL] ' + $text) -ForegroundColor Red
    throw $text
}

function Format-Seconds([double]$seconds) {
    return ('{0:N1}s' -f $seconds)
}

# Runs a native tool, streams its stdout/stderr to the console, checks the exit code.
# NOTE: stderr is intentionally not redirected; under $ErrorActionPreference='Stop'
# redirecting native stderr with 2>&1 in Windows PowerShell 5.1 creates
# NativeCommandError records that abort the build for perfectly normal warnings.
function Invoke-Tool {
    param(
        [Parameter(Mandatory = $true)][string]$Exe,
        [Parameter(Mandatory = $true)][string[]]$ToolArgs,
        [Parameter(Mandatory = $true)][string]$Label
    )
    Write-Host ('[run]  ' + (Split-Path -Leaf $Exe) + ' ' + ($ToolArgs -join ' '))
    $watch = [System.Diagnostics.Stopwatch]::StartNew()
    & $Exe @ToolArgs
    $exitCode = $LASTEXITCODE
    $watch.Stop()
    if ($exitCode -ne 0) {
        Fail ('{0} failed with exit code {1} ({2})' -f $Label, $exitCode, (Format-Seconds $watch.Elapsed.TotalSeconds))
    }
    Write-Ok ('{0} ({1})' -f $Label, (Format-Seconds $watch.Elapsed.TotalSeconds))
}

# Runs a native tool and captures its output; used for parse/verify steps only.
function Invoke-ToolCapture {
    param(
        [Parameter(Mandatory = $true)][string]$Exe,
        [Parameter(Mandatory = $true)][string[]]$ToolArgs,
        [Parameter(Mandatory = $true)][string]$Label,
        [switch]$AllowFailure
    )
    Write-Host ('[run]  ' + (Split-Path -Leaf $Exe) + ' ' + ($ToolArgs -join ' '))
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $raw = & $Exe @ToolArgs 2>&1
        $exitCode = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previous
    }
    $lines = @()
    foreach ($item in @($raw)) {
        if ($null -eq $item) { continue }
        $lines += [string]$item
    }
    $text = ($lines -join "`n")
    if ($exitCode -ne 0 -and -not $AllowFailure) {
        Fail ('{0} failed with exit code {1}:{2}{3}' -f $Label, $exitCode, "`n", $text)
    }
    return [pscustomobject]@{
        ExitCode = $exitCode
        Lines    = $lines
        Text     = $text
    }
}

function Assert-File([string]$Path, [string]$What) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        Fail ('missing {0}: {1}' -f $What, $Path)
    }
}

function Assert-Dir([string]$Path, [string]$What) {
    if (-not (Test-Path -LiteralPath $Path -PathType Container)) {
        Fail ('missing {0}: {1}' -f $What, $Path)
    }
}

# Appends (or replaces) entries inside an existing zip/apk using .NET, so the aapt2-produced
# archive layout is not disturbed (unlike Compress-Archive). The entries are added with
# forward-slash names, which Android's AssetManager requires.
function Add-FilesToZip {
    param(
        [Parameter(Mandatory = $true)][string]$ZipPath,
        [Parameter(Mandatory = $true)][System.Collections.IDictionary]$Entries
    )
    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [System.IO.Compression.ZipFile]::Open(
        $ZipPath, [System.IO.Compression.ZipArchiveMode]::Update)
    try {
        foreach ($entryName in $Entries.Keys) {
            $sourcePath = [string]$Entries[$entryName]
            $existing = $archive.GetEntry([string]$entryName)
            if ($null -ne $existing) {
                $existing.Delete()
            }
            $entry = $archive.CreateEntry(
                [string]$entryName, [System.IO.Compression.CompressionLevel]::Optimal)
            $entryStream = $entry.Open()
            try {
                $sourceStream = [System.IO.File]::OpenRead($sourcePath)
                try {
                    $sourceStream.CopyTo($entryStream)
                } finally {
                    $sourceStream.Dispose()
                }
            } finally {
                $entryStream.Dispose()
            }
        }
    } finally {
        $archive.Dispose()
    }
}

# ================================================================ paths ==========
$script:Root = Split-Path -Parent $PSScriptRoot
$script:AndroidDir = Join-Path $script:Root 'android'
$script:AppMain = Join-Path $script:AndroidDir 'app\src\main'
$script:ResDir = Join-Path $script:AppMain 'res'
$script:JavaDir = Join-Path $script:AppMain 'java'
$script:AssetsDir = Join-Path $script:AppMain 'assets'
$script:WwwDir = Join-Path $script:AssetsDir 'www'
$script:Manifest = Join-Path $script:AppMain 'AndroidManifest.xml'
$script:PlaceholderPage = Join-Path $script:AndroidDir 'placeholder\index.html'
$script:PreviewDir = Join-Path $script:Root 'dist\preview'
$script:BuildDir = Join-Path $script:AndroidDir '.build'
$script:DistDir = Join-Path $script:Root 'dist'
$script:OutApk = Join-Path $script:DistDir $script:OutApkName
$script:BuildInfoPath = Join-Path $script:DistDir 'build-info.json'
$script:ToolchainDir = Join-Path $script:Root '.toolchain'

# ================================================================ main ===========
function Invoke-Build {

    Write-Host ''
    Write-Host 'CrystalLens - Android APK build (aapt2/javac/d8/apksigner, no Gradle)' -ForegroundColor Cyan
    Write-Host ('root      : ' + $script:Root)
    Write-Host ('web source: ' + $WebSource)

    # ---------------------------------------------------------- 1. toolchain -----
    Write-Step 'Locate toolchain'

    $marker = Join-Path $script:ToolchainDir 'TOOLCHAIN_READY.json'
    if (-not (Test-Path -LiteralPath $marker -PathType Leaf)) {
        Fail ('toolchain marker not found: {0}{1}run first: powershell -ExecutionPolicy Bypass -File tools\fetch_toolchain.ps1' -f $marker, "`n")
    }
    $tc = Get-Content -LiteralPath $marker -Raw | ConvertFrom-Json
    if ($null -eq $tc) {
        Fail ('could not parse ' + $marker)
    }

    $jdk = $tc.jdk
    if (-not $jdk) { $jdk = Join-Path $script:ToolchainDir 'jdk' }
    $sdk = $tc.sdk
    if (-not $sdk) { $sdk = Join-Path $script:ToolchainDir 'android-sdk' }
    $buildTools = $tc.buildTools
    if (-not $buildTools) { $buildTools = Join-Path $sdk 'build-tools\36.0.0' }
    $platform = $tc.platform
    if (-not $platform) { $platform = Join-Path $sdk 'platforms\android-36' }

    $script:JavaExe = Join-Path $jdk 'bin\java.exe'
    $script:JavacExe = Join-Path $jdk 'bin\javac.exe'
    $script:JarExe = Join-Path $jdk 'bin\jar.exe'
    $script:KeytoolExe = Join-Path $jdk 'bin\keytool.exe'
    $script:Aapt2 = Join-Path $buildTools 'aapt2.exe'
    $script:D8Bat = Join-Path $buildTools 'd8.bat'
    $script:ZipAlign = Join-Path $buildTools 'zipalign.exe'
    $script:ApkSigner = Join-Path $buildTools 'apksigner.bat'
    $script:AndroidJar = Join-Path $platform 'android.jar'
    # javac needs this stub jar to compile lambdas against android.jar (java.lang.invoke
    # does not exist in android.jar itself; d8 performs the actual desugaring).
    $script:LambdaStubs = Join-Path $buildTools 'core-lambda-stubs.jar'
    $script:JdkDir = $jdk
    $script:BuildToolsDir = $buildTools
    $script:PlatformDir = $platform

    $toolPaths = @(
        @{ Path = $script:JavaExe; Name = 'java.exe' },
        @{ Path = $script:JavacExe; Name = 'javac.exe' },
        @{ Path = $script:JarExe; Name = 'jar.exe' },
        @{ Path = $script:KeytoolExe; Name = 'keytool.exe' },
        @{ Path = $script:Aapt2; Name = 'aapt2.exe' },
        @{ Path = $script:D8Bat; Name = 'd8.bat' },
        @{ Path = $script:ZipAlign; Name = 'zipalign.exe' },
        @{ Path = $script:ApkSigner; Name = 'apksigner.bat' },
        @{ Path = $script:AndroidJar; Name = 'android.jar' },
        @{ Path = $script:LambdaStubs; Name = 'core-lambda-stubs.jar' }
    )
    $missing = @()
    foreach ($tool in $toolPaths) {
        if (-not (Test-Path -LiteralPath $tool.Path -PathType Leaf)) {
            $missing += ('{0}: {1}' -f $tool.Name, $tool.Path)
        }
    }
    if ($missing.Count -gt 0) {
        Fail ("toolchain incomplete:`n  " + ($missing -join "`n  ") + "`n" +
            'run: powershell -ExecutionPolicy Bypass -File tools\fetch_toolchain.ps1')
    }

    # The .bat wrappers (d8, apksigner) and javac all need JAVA_HOME / java on PATH.
    $env:JAVA_HOME = $jdk
    $env:Path = (Join-Path $jdk 'bin') + ';' + $buildTools + ';' + $env:Path
    Write-Ok ('JDK        : ' + $jdk)
    Write-Ok ('build-tools: ' + $buildTools)
    Write-Ok ('platform   : ' + $platform)

    $jdkVersionInfo = Invoke-ToolCapture -Exe $script:JavaExe -ToolArgs @('-version') -Label 'java -version' -AllowFailure
    $jdkVersion = 'unknown'
    if ($jdkVersionInfo.Lines.Count -gt 0) {
        $jdkVersion = $jdkVersionInfo.Lines[0]
    }

    # ---------------------------------------------------------- 2. clean/build ---
    Write-Step 'Prepare build directories'

    if (-not $KeepBuild -and (Test-Path -LiteralPath $script:BuildDir)) {
        $resolvedBuild = (Resolve-Path -LiteralPath $script:BuildDir).Path
        if (-not $resolvedBuild.StartsWith($script:Root, [System.StringComparison]::OrdinalIgnoreCase)) {
            Fail ('refusing to delete unexpected build path: ' + $resolvedBuild)
        }
        Remove-Item -LiteralPath $script:BuildDir -Recurse -Force
    }
    $script:GenDir = Join-Path $script:BuildDir 'gen'
    $script:ClassesDir = Join-Path $script:BuildDir 'classes'
    $script:DexDir = Join-Path $script:BuildDir 'dex'
    foreach ($dir in @($script:BuildDir, $script:GenDir, $script:ClassesDir, $script:DexDir)) {
        New-Item -ItemType Directory -Force -Path $dir | Out-Null
    }
    Write-Ok ('build dir: ' + $script:BuildDir)

    # ---------------------------------------------------------- 3. web assets ----
    Write-Step 'Sync web assets into assets/www'

    $usedWebSource = Sync-WebAssets
    Write-Ok ('web source used: ' + $usedWebSource)

    # ---------------------------------------------------------- 4. icons ---------
    Write-Step 'Check launcher icons'

    $iconDirs = @('mipmap-mdpi', 'mipmap-hdpi', 'mipmap-xhdpi', 'mipmap-xxhdpi', 'mipmap-xxxhdpi')
    foreach ($dirName in $iconDirs) {
        Assert-File (Join-Path $script:ResDir ($dirName + '\ic_launcher.png')) ('legacy icon ' + $dirName)
        Assert-File (Join-Path $script:ResDir ($dirName + '\ic_launcher_foreground.png')) ('adaptive foreground ' + $dirName)
    }
    Assert-File (Join-Path $script:ResDir 'mipmap-anydpi-v26\ic_launcher.xml') 'adaptive icon xml'
    Write-Ok 'launcher icons present (legacy PNG per density + adaptive foreground)'

    # ---------------------------------------------------------- 5. aapt2 compile --
    Write-Step 'aapt2 compile resources'

    Assert-File $script:Manifest 'AndroidManifest.xml'
    Assert-Dir $script:ResDir 'res directory'
    Assert-Dir $script:AssetsDir 'assets directory'

    $resZip = Join-Path $script:BuildDir 'res.zip'
    Invoke-Tool -Exe $script:Aapt2 -ToolArgs @(
        'compile', '--dir', $script:ResDir, '-o', $resZip
    ) -Label 'aapt2 compile'

    # ---------------------------------------------------------- 6. aapt2 link ----
    Write-Step 'aapt2 link (manifest + resources + assets)'

    $unsignedApk = Join-Path $script:BuildDir 'app-unsigned.apk'
    # NOTE: assets are NOT passed through aapt2's -A on purpose: aapt2 2.20 on Windows
    # records directory assets with backslash separators ("assets/www\index.html"), which
    # Android's AssetManager cannot resolve. Assets are added later with correct "/" names.
    Invoke-Tool -Exe $script:Aapt2 -ToolArgs @(
        'link',
        '-o', $unsignedApk,
        '-I', $script:AndroidJar,
        '--manifest', $script:Manifest,
        '--java', $script:GenDir,
        '-R', $resZip,
        '--auto-add-overlay',
        '--min-sdk-version', [string]$script:MinSdk,
        '--target-sdk-version', [string]$script:TargetSdk
    ) -Label 'aapt2 link'
    Assert-File $unsignedApk 'aapt2 link output'

    # ---------------------------------------------------------- 7. javac ---------
    Write-Step 'javac (Java 8 bytecode against android.jar)'

    $javaSources = @(Get-ChildItem -LiteralPath $script:JavaDir -Recurse -Filter '*.java' -File |
        Sort-Object -Property FullName | ForEach-Object { $_.FullName })
    $rJavaSources = @(Get-ChildItem -LiteralPath $script:GenDir -Recurse -Filter '*.java' -File |
        Sort-Object -Property FullName | ForEach-Object { $_.FullName })
    if ($javaSources.Count -eq 0) {
        Fail ('no Java sources under ' + $script:JavaDir)
    }
    if ($rJavaSources.Count -eq 0) {
        Fail ('aapt2 --java did not generate R.java under ' + $script:GenDir)
    }
    Write-Info ('javac inputs: ' + $javaSources.Count + ' app source(s) + ' + $rJavaSources.Count + ' generated R.java')

    $javacArgs = @(
        '-source', '8', '-target', '8',
        '-encoding', 'UTF-8',
        '-bootclasspath', ($script:AndroidJar + ';' + $script:LambdaStubs),
        '-d', $script:ClassesDir,
        '-Xlint:-options'
    ) + $javaSources + $rJavaSources

    $javacOk = $false
    try {
        Invoke-Tool -Exe $script:JavacExe -ToolArgs $javacArgs -Label 'javac'
        $javacOk = $true
    } catch {
        Write-Warn2 ('javac with -bootclasspath failed, retrying with -classpath: ' + $_.Exception.Message)
    }
    if (-not $javacOk) {
        $javacArgs2 = @(
            '-source', '8', '-target', '8',
            '-encoding', 'UTF-8',
            '-classpath', $script:AndroidJar,
            '-d', $script:ClassesDir,
            '-Xlint:-options'
        ) + $javaSources + $rJavaSources
        Invoke-Tool -Exe $script:JavacExe -ToolArgs $javacArgs2 -Label 'javac (retry)'
    }

    $classFiles = @(Get-ChildItem -LiteralPath $script:ClassesDir -Recurse -Filter '*.class' -File)
    if ($classFiles.Count -eq 0) {
        Fail 'javac produced no class files'
    }
    Write-Ok ('classes: ' + $classFiles.Count)

    # ---------------------------------------------------------- 8. d8 ------------
    Write-Step 'd8: classes -> classes.dex'

    $classesJar = Join-Path $script:BuildDir 'classes.jar'
    Push-Location -LiteralPath $script:ClassesDir
    try {
        Invoke-Tool -Exe $script:JarExe -ToolArgs @('cf', $classesJar, '.') -Label 'jar cf classes.jar'
    } finally {
        Pop-Location
    }
    Assert-File $classesJar 'classes.jar'

    Invoke-Tool -Exe $script:D8Bat -ToolArgs @(
        '--release',
        '--min-api', [string]$script:MinSdk,
        '--lib', $script:AndroidJar,
        '--output', $script:DexDir,
        $classesJar
    ) -Label 'd8'

    $dexFile = Join-Path $script:DexDir 'classes.dex'
    Assert-File $dexFile 'classes.dex'
    $dexSize = (Get-Item -LiteralPath $dexFile).Length
    Write-Ok ('classes.dex: ' + $dexSize + ' bytes')

    # ---------------------------------------------------------- 9. add dex -------
    Write-Step 'Append assets + classes.dex into the APK'

    $assetRoot = (Resolve-Path -LiteralPath $script:AssetsDir).Path
    $entries = [ordered]@{}
    $assetFiles = @(Get-ChildItem -LiteralPath $assetRoot -Recurse -File |
        Sort-Object -Property FullName)
    foreach ($assetFile in $assetFiles) {
        $relative = $assetFile.FullName.Substring($assetRoot.Length)
        $relative = $relative.TrimStart([char[]]@('\', '/'))
        $entryName = 'assets/' + ($relative -replace '\\', '/')
        $entries[$entryName] = $assetFile.FullName
    }
    $entries['classes.dex'] = $dexFile
    $entries['assets/www/index.html'] = (Join-Path $script:WwwDir 'index.html')
    if ($assetFiles.Count -eq 0) {
        Fail ('no assets found under ' + $assetRoot)
    }
    Add-FilesToZip -ZipPath $unsignedApk -Entries $entries
    Write-Ok ('added ' + $entries.Count + ' archive entries (' + $assetFiles.Count + ' asset files + classes.dex)')

    # ---------------------------------------------------------- 10. zipalign -----
    Write-Step 'zipalign'

    $alignedApk = Join-Path $script:BuildDir 'app-aligned.apk'
    if (Test-Path -LiteralPath $alignedApk) {
        Remove-Item -LiteralPath $alignedApk -Force
    }
    Invoke-Tool -Exe $script:ZipAlign -ToolArgs @(
        '-p', '-f', '4', $unsignedApk, $alignedApk
    ) -Label 'zipalign'
    Assert-File $alignedApk 'aligned apk'

    # ---------------------------------------------------------- 11. keystore -----
    Write-Step 'Debug keystore + apksigner'

    $keystore = Join-Path $script:ToolchainDir 'debug.keystore'
    if (-not (Test-Path -LiteralPath $keystore -PathType Leaf)) {
        Write-Info ('creating debug keystore: ' + $keystore)
        Invoke-Tool -Exe $script:KeytoolExe -ToolArgs @(
            '-genkeypair',
            '-keystore', $keystore,
            '-alias', 'androiddebugkey',
            '-storepass', 'android',
            '-keypass', 'android',
            '-keyalg', 'RSA',
            '-keysize', '2048',
            '-validity', '10000',
            '-dname', 'CN=CrystalLens Debug,O=Android,C=US'
        ) -Label 'keytool -genkeypair'
    } else {
        Write-Ok ('reusing keystore: ' + $keystore)
    }

    if (-not (Test-Path -LiteralPath $script:DistDir -PathType Container)) {
        New-Item -ItemType Directory -Force -Path $script:DistDir | Out-Null
    }
    if (Test-Path -LiteralPath $script:OutApk) {
        Remove-Item -LiteralPath $script:OutApk -Force
    }
    Invoke-Tool -Exe $script:ApkSigner -ToolArgs @(
        'sign',
        '--ks', $keystore,
        '--ks-key-alias', 'androiddebugkey',
        '--ks-pass', 'pass:android',
        '--key-pass', 'pass:android',
        '--out', $script:OutApk,
        $alignedApk
    ) -Label 'apksigner sign'
    Assert-File $script:OutApk 'signed apk'

    # ---------------------------------------------------------- 12. verify ------
    Write-Step 'Verify the signed APK'

    $verify = Invoke-ToolCapture -Exe $script:ApkSigner -ToolArgs @(
        'verify', '--verbose', '--print-certs', $script:OutApk
    ) -Label 'apksigner verify' -AllowFailure
    if ($verify.ExitCode -ne 0) {
        Fail ("apksigner verify failed:`n" + $verify.Text)
    }
    foreach ($line in $verify.Lines) {
        Write-Host ('  ' + $line)
    }

    $verifySummary = 'passed'
    $certDn = ''
    foreach ($line in $verify.Lines) {
        if ($line -match 'Verifies') { $verifySummary = $line.Trim() }
        if ($line -match 'Signer #1 certificate DN:\s*(.+)$') { $certDn = $Matches[1].Trim() }
    }

    $badging = Invoke-ToolCapture -Exe $script:Aapt2 -ToolArgs @(
        'dump', 'badging', $script:OutApk
    ) -Label 'aapt2 dump badging'
    $badgingText = $badging.Text

    $expected = @(
        @{ Pattern = ("package: name='" + $script:PackageName + "'"); What = 'package name' },
        @{ Pattern = ("versionCode='" + $script:VersionCode + "'"); What = 'versionCode' },
        @{ Pattern = ("versionName='" + $script:VersionName + "'"); What = 'versionName' },
        @{ Pattern = ("sdkVersion:'" + $script:MinSdk + "'"); What = 'minSdkVersion' },
        @{ Pattern = ("targetSdkVersion:'" + $script:TargetSdk + "'"); What = 'targetSdkVersion' },
        @{ Pattern = ('launchable-activity: name=' + "'" + $script:PackageName + ".MainActivity'"); What = 'launchable activity' }
    )
    foreach ($check in $expected) {
        if ($badgingText -notmatch [regex]::Escape($check.Pattern)) {
            Fail ('aapt2 badging does not contain expected ' + $check.What + ': ' + $check.Pattern + "`n" + $badgingText)
        }
    }
    $badgingLines = @()
    foreach ($line in $badging.Lines) {
        if ($line -match '^(package:|sdkVersion:|targetSdkVersion:|application-label:|application-label-zh|launchable-activity:|native-code:|uses-feature:|uses-permission:)') {
            $badgingLines += $line
        }
    }
    Write-Ok 'badging package/version/sdk/launchable-activity verified'

    $permissions = Invoke-ToolCapture -Exe $script:Aapt2 -ToolArgs @(
        'dump', 'permissions', $script:OutApk
    ) -Label 'aapt2 dump permissions' -AllowFailure
    $permissionNames = @()
    foreach ($line in $permissions.Lines) {
        if ($line -match "name='([^']+)'") { $permissionNames += $Matches[1] }
    }
    foreach ($permission in $permissionNames) {
        Write-Info ('permission: ' + $permission)
        if ($permission -eq 'android.permission.INTERNET' -or
            $permission -eq 'android.permission.WRITE_EXTERNAL_STORAGE' -or
            $permission -eq 'android.permission.READ_EXTERNAL_STORAGE') {
            Fail ('forbidden permission present: ' + $permission)
        }
    }
    if ($permissionNames.Count -eq 0) {
        Write-Warn2 'APK declares no permissions at all'
    } else {
        Write-Ok ('permissions: ' + ($permissionNames -join ', '))
    }

    # ------------------------------------------------- 13. archive sanity --------
    Write-Step 'APK archive sanity checks'

    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [System.IO.Compression.ZipFile]::OpenRead($script:OutApk)
    try {
        $entryNames = @($archive.Entries | ForEach-Object { $_.FullName })
    } finally {
        $archive.Dispose()
    }
    $requiredEntries = @('AndroidManifest.xml', 'resources.arsc', 'classes.dex', 'assets/www/index.html')
    foreach ($required in $requiredEntries) {
        if ($entryNames -notcontains $required) {
            Fail ('APK is missing required entry: ' + $required)
        }
    }
    $backslashEntries = @($entryNames | Where-Object { $_ -like '*\*' })
    if ($backslashEntries.Count -gt 0) {
        Fail ('APK contains zip entry names with backslashes (Android cannot resolve them): ' + ($backslashEntries -join ', '))
    }
    $assetEntries = @($entryNames | Where-Object { $_ -like 'assets/*' })
    $wwwEntries = @($entryNames | Where-Object { $_ -like 'assets/www/*' })
    Write-Ok ('zip entries: ' + $entryNames.Count + ' total, ' + $assetEntries.Count + ' assets, ' + $wwwEntries.Count + ' under assets/www')

    # ------------------------------------------------- 14. hash + build info -----
    Write-Step 'hash + build-info.json'

    $apkFile = Get-Item -LiteralPath $script:OutApk
    $sha256 = (Get-FileHash -LiteralPath $script:OutApk -Algorithm SHA256).Hash.ToLowerInvariant()
    $builtAt = (Get-Date).ToString('o')
    $duration = ((Get-Date) - $script:BuildStarted).TotalSeconds
    $relativeApk = 'dist/' + $apkFile.Name

    $buildToolsVersion = (Split-Path -Leaf $script:BuildToolsDir)
    $platformName = (Split-Path -Leaf $script:PlatformDir)

    $info = [ordered]@{
        app               = 'CrystalLens'
        platform          = 'android'
        package           = $script:PackageName
        versionName       = $script:VersionName
        versionCode       = $script:VersionCode
        minSdk            = $script:MinSdk
        targetSdk         = $script:TargetSdk
        compileSdk        = $script:CompileSdk
        apk               = $relativeApk
        apkPath           = $script:OutApk
        apkSizeBytes      = $apkFile.Length
        sha256            = $sha256
        builtAt           = $builtAt
        buildDurationSec  = [math]::Round($duration, 1)
        webSource         = $script:UsedWebSource
        webMissingFiles   = @($script:WebMissingFiles)
        assetsFileCount   = $assetEntries.Count
        wwwFileCount      = $wwwEntries.Count
        toolchain         = [ordered]@{
            jdk        = $jdkVersion
            buildTools = $buildToolsVersion
            platform   = $platformName
            root       = '.toolchain'
        }
        signature         = [ordered]@{
            verified = ($verify.ExitCode -eq 0)
            summary  = $verifySummary
            certDn   = $certDn
            keystore = '.toolchain/debug.keystore (debug key: android/android)'
        }
        verified          = [ordered]@{
            apksigner       = 'passed'
            requiredEntries = $requiredEntries
            badging         = $badgingLines
            permissions     = $permissionNames
        }
    }
    $json = $info | ConvertTo-Json -Depth 8
    # Windows PowerShell 5.1 escapes apostrophes as \u0027 in ConvertTo-Json output; keep
    # build-info.json human-readable (the escape is still valid JSON, just noisy).
    $json = $json.Replace('\u0027', "'")
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($script:BuildInfoPath, $json + "`n", $utf8NoBom)
    Write-Ok ('wrote ' + $script:BuildInfoPath)

    # ------------------------------------------------- 15. summary --------------
    $sizeMb = [math]::Round($apkFile.Length / 1MB, 3)
    Write-Host ''
    Write-Host '================= BUILD SUMMARY =================' -ForegroundColor Cyan
    Write-Host ('APK          : ' + $relativeApk)
    Write-Host ('APK path     : ' + $script:OutApk)
    Write-Host ('Size         : ' + $apkFile.Length + ' bytes (' + $sizeMb + ' MB)')
    Write-Host ('SHA-256      : ' + $sha256)
    Write-Host ('Package      : ' + $script:PackageName)
    Write-Host ('Version      : ' + $script:VersionName + ' (' + $script:VersionCode + ')')
    Write-Host ('SDK          : min ' + $script:MinSdk + ', target ' + $script:TargetSdk + ', compile ' + $script:CompileSdk)
    Write-Host ('Web source   : ' + $script:UsedWebSource)
    Write-Host ('assets/www   : ' + $wwwEntries.Count + ' file(s)')
    Write-Host ('Signature    : ' + $verifySummary + ' | ' + $certDn)
    Write-Host ('Permissions  : ' + (($permissionNames -join ', ')))
    Write-Host ('Duration     : ' + (Format-Seconds $duration))
    Write-Host '=================================================' -ForegroundColor Cyan
    Write-Host ''
    Write-Ok 'BUILD SUCCEEDED'
}

function Sync-WebAssets {
    if (-not (Test-Path -LiteralPath $script:WwwDir -PathType Container)) {
        New-Item -ItemType Directory -Force -Path $script:WwwDir | Out-Null
    }

    $previewIndex = Join-Path $script:PreviewDir 'index.html'
    $source = $WebSource
    if ($source -eq 'auto') {
        if (Test-Path -LiteralPath $previewIndex -PathType Leaf) {
            $source = 'preview'
        } else {
            $source = 'placeholder'
            Write-Warn2 ('dist/preview/index.html not found; bundling the placeholder page')
        }
    }
    if ($source -eq 'preview' -and -not (Test-Path -LiteralPath $previewIndex -PathType Leaf)) {
        Fail ('WebSource=preview but dist\preview\index.html is missing')
    }

    # Always clear assets/www first: stale files from an earlier web build must not leak in.
    $existing = @(Get-ChildItem -LiteralPath $script:WwwDir -Force)
    foreach ($item in $existing) {
        Remove-Item -LiteralPath $item.FullName -Recurse -Force
    }

    $script:WebMissingFiles = @()
    if ($source -eq 'preview') {
        Copy-Item -Path (Join-Path $script:PreviewDir '*') -Destination $script:WwwDir -Recurse -Force
        Write-Ok ('copied dist\preview -> assets\www')
    } else {
        Assert-File $script:PlaceholderPage 'placeholder page'
        Copy-Item -LiteralPath $script:PlaceholderPage -Destination (Join-Path $script:WwwDir 'index.html') -Force
        Write-Ok 'bundled placeholder page (real web core pending)'
    }

    $indexPath = Join-Path $script:WwwDir 'index.html'
    Assert-File $indexPath 'assets\www\index.html'

    if ($source -eq 'preview') {
        # Diagnostics only: the web core may still be mid-build, so list missing local refs
        # instead of failing the APK build.
        $indexText = [System.IO.File]::ReadAllText($indexPath)
        $refs = [regex]::Matches($indexText, '(?:src|href)="([^"]+)"')
        $missing = @()
        foreach ($match in $refs) {
            $ref = $match.Groups[1].Value
            if ($ref -match '^(?:[a-zA-Z][a-zA-Z0-9+.-]*:|#)') { continue }
            $candidate = Join-Path $script:WwwDir ($ref -replace '/', '\')
            if (-not (Test-Path -LiteralPath $candidate)) {
                $missing += $ref
            }
        }
        if ($missing.Count -gt 0) {
            $script:WebMissingFiles = @($missing)
            Write-Warn2 ('dist/preview references ' + $missing.Count + ' file(s) that do not exist yet:')
            foreach ($missingRef in $missing) {
                Write-Warn2 ('  missing: ' + $missingRef)
            }
            Write-Warn2 'the APK will be built, but the web app may be incomplete until those files are generated'
        } else {
            Write-Ok 'every local script/stylesheet referenced by index.html exists'
        }
    }

    $script:UsedWebSource = $source
    return $source
}

# ================================================================ entry ==========
try {
    Invoke-Build
    exit 0
} catch {
    Write-Host ''
    Write-Host '================= BUILD FAILED ==================' -ForegroundColor Red
    Write-Host ('reason: ' + $_.Exception.Message) -ForegroundColor Red
    if ($_.InvocationInfo -and $_.InvocationInfo.PositionMessage) {
        Write-Host $_.InvocationInfo.PositionMessage
    }
    Write-Host 'diagnostics:'
    Write-Host ('  build dir : ' + $script:BuildDir)
    Write-Host ('  toolchain : ' + $script:ToolchainDir)
    Write-Host '=================================================' -ForegroundColor Red
    exit 1
}
