param([ValidateSet('dev', 'check', 'test', 'build')][string]$Action = 'dev')
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$toolchainRoot = Join-Path $projectRoot '.toolchains'
$localCargoBin = Join-Path $toolchainRoot 'cargo\bin'
if (Test-Path -LiteralPath (Join-Path $localCargoBin 'cargo.exe')) {
    $env:CARGO_HOME = Join-Path $toolchainRoot 'cargo'
    $env:RUSTUP_HOME = Join-Path $toolchainRoot 'rustup'
    $env:Path = "$localCargoBin;$env:Path"
}
if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
    throw 'Rust/Cargo is required. See docs/桌面开发.md.'
}
Push-Location $projectRoot
try {
    if ($Action -eq 'dev') { & npm.cmd run tauri -- dev }
    elseif ($Action -eq 'build') { & npm.cmd run tauri -- build --no-bundle }
    else { & cargo $Action --manifest-path src-tauri/Cargo.toml }
    exit $LASTEXITCODE
} finally { Pop-Location }
