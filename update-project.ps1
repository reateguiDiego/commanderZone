param(
    [switch]$SkipFrontend,
    [switch]$SkipBackend,
    [switch]$SkipDocker,
    [switch]$SkipMigrations,
    [switch]$SkipChecks,
    [switch]$BuildApi
)

$ErrorActionPreference = 'Stop'

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Backend = Join-Path $Root 'backend'
$Frontend = Join-Path $Root 'frontend'

function Invoke-Step {
    param(
        [string]$Title,
        [scriptblock]$Command
    )

    Write-Host ""
    Write-Host "==> $Title" -ForegroundColor Cyan
    & $Command
}

function Assert-Command {
    param([string]$Name)

    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Required command '$Name' was not found in PATH."
    }
}

Set-Location $Root

if (-not $SkipFrontend) {
    Assert-Command npm
    Invoke-Step 'Installing frontend dependencies' {
        Set-Location $Frontend
        npm install
        Set-Location $Root
    }
}

if (-not $SkipBackend) {
    Assert-Command composer
    Assert-Command php
    Invoke-Step 'Installing backend dependencies' {
        Set-Location $Backend
        composer install
        Set-Location $Root
    }
}

if (-not $SkipDocker) {
    Assert-Command docker
    if ($BuildApi) {
        Invoke-Step 'Starting Docker stack and rebuilding API image' {
            Set-Location $Root
            docker compose up -d --build
        }
    } else {
        Invoke-Step 'Starting database and Mercure services' {
            Set-Location $Root
            docker compose up -d database mercure
        }
    }
}

if (-not $SkipBackend -and -not $SkipMigrations) {
    Invoke-Step 'Running Doctrine migrations' {
        Set-Location $Backend
        php bin/console doctrine:migrations:migrate --no-interaction
        Set-Location $Root
    }
}

if (-not $SkipBackend -and -not $SkipChecks) {
    Invoke-Step 'Validating backend' {
        Set-Location $Backend
        php bin/console lint:container
        php bin/console doctrine:schema:validate
        php bin/console lint:yaml config ..\docs\openapi.yaml
        php bin/phpunit
        Set-Location $Root
    }
}

if (-not $SkipFrontend -and -not $SkipChecks) {
    Invoke-Step 'Validating frontend build' {
        Set-Location $Frontend
        npm run build
        Set-Location $Root
    }
}

Write-Host ""
Write-Host 'Project update completed.' -ForegroundColor Green
