param(
    [switch]$SkipFrontend,
    [switch]$SkipBackend,
    [switch]$SkipDocker,
    [switch]$SkipMigrations,
    [switch]$SkipChecks,
    [switch]$BuildApi,
    [switch]$AllowNpmLifecycleScripts,
    [switch]$SkipNpmSignatureAudit,
    [switch]$AllowRiskyTanStackPackages
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

function Invoke-CommandOrThrow {
    param(
        [scriptblock]$Command,
        [string]$ErrorMessage
    )

    & $Command
    if ($LASTEXITCODE -ne 0) {
        throw "$ErrorMessage (exit code: $LASTEXITCODE)"
    }
}

function Get-PackageLockDependencies {
    param([string]$PackageLockPath)

    if (-not (Test-Path $PackageLockPath)) {
        return @{}
    }

    $result = @{}
    Assert-Command node

    $nodeScript = @'
const fs = require('fs');
const lockPath = process.argv[1];
const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));

const lines = [];
const add = (name, version) => {
  if (!name || !version) return;
  lines.push(`${name}\t${version}`);
};

if (lock && lock.packages && typeof lock.packages === 'object') {
  for (const [pathKey, meta] of Object.entries(lock.packages)) {
    if (!pathKey.startsWith('node_modules/')) continue;
    const name = pathKey.slice('node_modules/'.length);
    if (!name) continue;
    add(name, meta && meta.version ? String(meta.version) : '');
  }
} else if (lock && lock.dependencies && typeof lock.dependencies === 'object') {
  const walk = (deps) => {
    for (const [name, meta] of Object.entries(deps || {})) {
      add(name, meta && meta.version ? String(meta.version) : '');
      if (meta && meta.dependencies && typeof meta.dependencies === 'object') {
        walk(meta.dependencies);
      }
    }
  };
  walk(lock.dependencies);
}

process.stdout.write(lines.join('\n'));
'@

    $rows = @()
    Invoke-CommandOrThrow -ErrorMessage 'Failed to parse package-lock.json with node' -Command {
        $script:rows = & node -e $nodeScript $PackageLockPath
    }
    foreach ($row in $rows) {
        if ([string]::IsNullOrWhiteSpace($row)) {
            continue
        }

        $parts = $row -split "`t", 2
        if ($parts.Count -ne 2) {
            continue
        }

        $name = [string]$parts[0]
        $version = [string]$parts[1]
        if (-not $result.ContainsKey($name)) {
            $result[$name] = New-Object System.Collections.Generic.List[string]
        }
        if (-not $result[$name].Contains($version)) {
            $result[$name].Add($version)
        }
    }

    return $result
}

function Assert-TanStackDependencyGuard {
    param(
        [string]$PackageLockPath,
        [switch]$AllowRiskyPackages
    )

    $deps = Get-PackageLockDependencies -PackageLockPath $PackageLockPath
    $risky = @()

    foreach ($name in $deps.Keys) {
        if ($name -notlike '@tanstack/*') {
            continue
        }

        $safeFamily =
            $name -like '@tanstack/query*' -or
            $name -like '@tanstack/table*' -or
            $name -like '@tanstack/form*' -or
            $name -like '@tanstack/virtual*' -or
            $name -eq '@tanstack/store' -or
            $name -eq '@tanstack/start'

        if (-not $safeFamily) {
            $versions = ($deps[$name] | Sort-Object) -join ', '
            $risky += "$name@$versions"
        }
    }

    if ($risky.Count -gt 0 -and -not $AllowRiskyPackages) {
        $joined = $risky -join '; '
        throw @"
Detected @tanstack packages outside TanStack's confirmed-clean families in package-lock.json:
$joined

Given the May 11, 2026 @tanstack npm compromise (CVE-2026-45321 / GHSA-g7cv-rxg3-hmpx), the script blocks by default.
Review and pin to patched versions from the advisory, then rerun.
Use -AllowRiskyTanStackPackages to bypass intentionally.
"@
    }
}

function Invoke-NpmInstallSecure {
    param(
        [string]$FrontendPath,
        [switch]$AllowLifecycleScripts,
        [switch]$SkipSignatureAudit,
        [switch]$AllowRiskyPackages
    )

    $lockfile = Join-Path $FrontendPath 'package-lock.json'
    if (-not (Test-Path $lockfile)) {
        throw "Missing frontend/package-lock.json. Refusing to run non-deterministic npm install."
    }

    Assert-TanStackDependencyGuard -PackageLockPath $lockfile -AllowRiskyPackages:$AllowRiskyPackages

    $previousIgnoreScripts = $env:npm_config_ignore_scripts
    try {
        if (-not $AllowLifecycleScripts) {
            $env:npm_config_ignore_scripts = 'true'
        }

        Invoke-CommandOrThrow -ErrorMessage 'npm ci failed' -Command {
            npm ci --no-audit --no-fund
        }
    } finally {
        if ($null -eq $previousIgnoreScripts) {
            Remove-Item Env:\npm_config_ignore_scripts -ErrorAction SilentlyContinue
        } else {
            $env:npm_config_ignore_scripts = $previousIgnoreScripts
        }
    }

    if (-not $SkipSignatureAudit) {
        Invoke-CommandOrThrow -ErrorMessage 'npm signature audit failed. Use -SkipNpmSignatureAudit only if you have a justified exception.' -Command {
            npm audit signatures | Out-Host
        }
    }
}

Set-Location $Root

if (-not $SkipFrontend) {
    Assert-Command npm
    Invoke-Step 'Installing frontend dependencies' {
        Set-Location $Frontend
        Invoke-NpmInstallSecure `
            -FrontendPath $Frontend `
            -AllowLifecycleScripts:$AllowNpmLifecycleScripts `
            -SkipSignatureAudit:$SkipNpmSignatureAudit `
            -AllowRiskyPackages:$AllowRiskyTanStackPackages
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
        php bin/console doctrine:database:create --env=test --if-not-exists
        php bin/console doctrine:migrations:migrate --env=test --no-interaction
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
