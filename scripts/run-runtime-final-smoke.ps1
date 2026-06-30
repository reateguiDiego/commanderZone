Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$reportPath = "/tmp/commanderzone-runtime-final-smoke.json"
$rawPath = "/tmp/commanderzone-runtime-final-smoke.ndjson"
$hotPathCounters = @(
    "runtime.snapshot_load_count",
    "runtime.snapshot_write_count",
    "runtime.db_lock_count",
    "runtime.legacy_handler_count",
    "runtime.previous_next_projection_count",
    "runtime.emergency_fallback_count"
)
$criticalRuntimeCounters = @(
    "gameplay.runtime_fallback_count",
    "gameplay.runtime_error_count",
    "gameplay.runtime_patch_contract_error",
    "command.legacy_fallback_count",
    "runtime.initial_state_per_command_count",
    "command.unsupported_count"
) + $hotPathCounters
$criticalZeroCounters = @(
    "gameplay.runtime_patch_contract_error",
    "runtime.initial_state_per_command_count",
    "command.unsupported_count"
) + $hotPathCounters

function MetricNumber($metric, [string] $key) {
    $property = $metric.PSObject.Properties[$key]
    if ($null -eq $property -or $null -eq $property.Value) {
        return 0.0
    }

    return [double] $property.Value
}

function MetricString($metric, [string] $key) {
    $property = $metric.PSObject.Properties[$key]
    if ($null -eq $property -or $null -eq $property.Value) {
        return ""
    }

    return [string] $property.Value
}

function Invoke-Checked([scriptblock] $Command, [string] $Description) {
    & $Command
    if ($LASTEXITCODE -ne 0) {
        throw "$Description failed with exit code $LASTEXITCODE."
    }
}

Push-Location $repoRoot
try {
    Invoke-Checked { docker compose build api game-runtime } "docker compose build"
    Invoke-Checked { docker compose up -d database mercure mailpit game-runtime api } "docker compose up"
    Invoke-Checked { docker compose exec -T api php bin/console doctrine:migrations:migrate --no-interaction } "database migration"
    Invoke-Checked { docker compose exec -T api php bin/console app:gameplay:baseline --iterations=1 --suite=smoke --format=json --output=$reportPath --raw-output=$rawPath --fail-on-regression --require-runtime-route } "runtime baseline"

    $json = docker compose exec -T api php -r "echo file_get_contents('$reportPath');"
    if ($LASTEXITCODE -ne 0) {
        throw "Reading runtime final smoke report failed with exit code $LASTEXITCODE."
    }
    if ([string]::IsNullOrWhiteSpace($json)) {
        throw "Runtime final smoke did not produce a JSON report."
    }

    $report = $json | ConvertFrom-Json
    $commandMetrics = @()
    foreach ($scenario in @($report.scenarios)) {
        foreach ($metric in @($scenario.commandMetrics)) {
            $commandMetrics += $metric
        }
    }

    if ($commandMetrics.Count -eq 0) {
        throw "Runtime final smoke produced zero command metrics; runtime-final is NOT VERIFIABLE."
    }

    $runtimeMetrics = @($commandMetrics | Where-Object { (MetricNumber $_ "gameplay.runtime_route") -gt 0.0 })
    if ($runtimeMetrics.Count -eq 0) {
        throw "Runtime final smoke produced runtimeRouteRecords=0; runtime-final is NOT VERIFIABLE."
    }

    $violations = @()
    foreach ($metric in $runtimeMetrics) {
        $status = MetricString $metric "status"
        if ($status -eq "runtime_failed" -or (MetricNumber $metric "gameplay.runtime_error_count") -gt 0.0) {
            $violations += "runtime_failed metric: $($metric | ConvertTo-Json -Compress -Depth 32)"
        }
        if ($status -eq "runtime_fallback" -or (MetricNumber $metric "gameplay.runtime_fallback_count") -gt 0.0 -or (MetricNumber $metric "command.legacy_fallback_count") -gt 0.0) {
            $violations += "runtime/legacy fallback metric: $($metric | ConvertTo-Json -Compress -Depth 32)"
        }

        foreach ($counter in $criticalRuntimeCounters) {
            $property = $metric.PSObject.Properties[$counter]
            if ($null -eq $property) {
                $violations += "missing $counter metric: $($metric | ConvertTo-Json -Compress -Depth 32)"
            }
        }

        foreach ($counter in $criticalZeroCounters) {
            if ((MetricNumber $metric $counter) -ne 0.0) {
                $violations += "$counter is non-zero: $($metric | ConvertTo-Json -Compress -Depth 32)"
            }
        }
    }

    if ($violations.Count -gt 0) {
        throw ($violations -join [Environment]::NewLine)
    }

    Write-Host "Runtime final smoke PASS"
    Write-Host "runtimeRouteRecords=$($runtimeMetrics.Count)"
    Write-Host "commandMetrics=$($commandMetrics.Count)"
    Write-Host "report=$reportPath"
    Write-Host "raw=$rawPath"
} finally {
    Pop-Location
}
