#Requires -Version 5.1
<#
.SYNOPSIS
    Configure, build and test CrystalLens with the Visual Studio x64 toolchain.
.PARAMETER Clean
    Remove the build directory first.
.PARAMETER SkipTests
    Do not run the test suite.
#>
[CmdletBinding()]
param(
    [switch]$Clean,
    [switch]$SkipTests
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$BuildDir = Join-Path $Root 'build'
$BuildConfig = 'Release'

Write-Host '== CrystalLens build ==' -ForegroundColor Cyan

if ($Clean -and (Test-Path -LiteralPath $BuildDir)) {
    Write-Host 'Removing existing build directory...'
    Remove-Item -LiteralPath $BuildDir -Recurse -Force
}

$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
if (-not (Test-Path -LiteralPath $vswhere)) {
    throw 'Visual Studio was not found. Install Visual Studio 2022/2026 with the Desktop C++ workload.'
}

$vsPath = (& $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath | Select-Object -First 1)
$vsVersion = (& $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationVersion | Select-Object -First 1)
if (-not $vsPath) {
    throw 'No Visual Studio installation with the MSVC x64 toolchain was found.'
}

$major = [int](($vsVersion -split '\.')[0])
switch ($major) {
    18 { $generator = 'Visual Studio 18 2026' }
    17 { $generator = 'Visual Studio 17 2022' }
    16 { $generator = 'Visual Studio 16 2019' }
    default { throw "Unsupported Visual Studio version: $vsVersion" }
}
Write-Host "Visual Studio: $vsPath ($vsVersion, $generator)"

$cmake = Join-Path $vsPath 'Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe'
if (-not (Test-Path -LiteralPath $cmake)) {
    $command = Get-Command cmake.exe -ErrorAction SilentlyContinue
    if (-not $command) {
        throw 'cmake.exe was not found. Install the CMake component in Visual Studio or put CMake on PATH.'
    }
    $cmake = $command.Source
}
$ctest = Join-Path (Split-Path -Parent $cmake) 'ctest.exe'
Write-Host "CMake: $cmake"

Write-Host 'Configuring (x64)...'
& $cmake -S $Root -B $BuildDir -G $generator -A x64 -DCRYSTALLENS_BUILD_TESTS=ON
if ($LASTEXITCODE -ne 0) { throw "CMake configure failed (exit $LASTEXITCODE)." }

Write-Host 'Building...' -ForegroundColor Cyan
& $cmake --build $BuildDir --config $BuildConfig --parallel
if ($LASTEXITCODE -ne 0) { throw "Build failed (exit $LASTEXITCODE)." }

$exe = Join-Path $BuildDir "$BuildConfig\CrystalLens.exe"
if (-not (Test-Path -LiteralPath $exe)) {
    throw "Expected executable was not produced: $exe"
}

if (-not $SkipTests) {
    if (-not (Test-Path -LiteralPath $ctest)) {
        throw "ctest.exe was not found next to cmake (looked for $ctest)."
    }
    Write-Host 'Running tests...' -ForegroundColor Cyan
    & $ctest --test-dir $BuildDir -C $BuildConfig --output-on-failure
    if ($LASTEXITCODE -ne 0) { throw "Tests failed (exit $LASTEXITCODE)." }
}

Write-Host ''
Write-Host "Build complete: $exe" -ForegroundColor Green
