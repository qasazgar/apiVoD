$ErrorActionPreference = 'Stop'

$env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' +
    [Environment]::GetEnvironmentVariable('Path', 'User')

$k6 = Get-Command k6 -ErrorAction SilentlyContinue
if (-not $k6) {
    $k6Path = 'C:\Program Files\k6\k6.exe'
    if (-not (Test-Path $k6Path)) {
        throw 'k6 was not found. Install it with: winget install --id GrafanaLabs.k6 --exact'
    }
    $k6 = Get-Item $k6Path
}

$scriptPath = Join-Path $PSScriptRoot 'k6-stage.js'
if (-not (Test-Path $scriptPath)) {
    throw "k6 script was not found: $scriptPath"
}

Write-Host "Using k6: $($k6.Source)"
& $k6.Source run $scriptPath
exit $LASTEXITCODE