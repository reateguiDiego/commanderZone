Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$backendDir = Join-Path $repoRoot "backend"
$docsDir = Join-Path $repoRoot "docs"
$reportPath = Join-Path $docsDir "gameplay-performance-baseline.latest.json"
$rawPath = Join-Path $backendDir "var\log\gameplay-performance-baseline.ndjson"

Push-Location $backendDir
try {
    $env:APP_ENV = "test"
    php bin/phpunit
    php bin/console app:gameplay:baseline --iterations=3 --output=$reportPath --raw-output=$rawPath
} finally {
    Pop-Location
}
