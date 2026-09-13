param(
    [ValidateScript({ $_ -in @(50, 100, 280, 500) })]
    [int] $Users = 50,

    [switch] $AllPhases,

    [ValidateSet("navigation", "gameplay")]
    [string] $Scenario = "navigation",

    [string] $ApiBaseUrl = "https://api.commanderzone.com",

    [string] $ProductionHost = "",

    [string] $SshUser = "",

    [string] $ProductionPath = "/opt/commanderZone",

    [string] $RuntimeMetricsUrl = "",

    [string] $UserPassword = $env:LOAD_TEST_USER_PASSWORD,

    [string] $DeckName = "Load Test Deck",

    [int] $DurationMinutes = 10,

    [int] $CommandIntervalMs = 2000,

    [string] $K6Image = "grafana/k6:2.1.0",

    [switch] $ConfirmProduction,

    [switch] $AllowNonProduction,

    [switch] $LocalDryRun,

    [switch] $SkipServerMetrics,

    [string] $SnapshotDir = "",

    [switch] $Help
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Show-Usage {
    Write-Host @"
CommanderZone production load test.

Required for production:
  `$env:LOAD_TEST_USER_PASSWORD = "<seeded-user-password>"
  powershell -ExecutionPolicy Bypass -File .\scripts\run-production-load-test.ps1 `
    -Users 100 `
    -ApiBaseUrl https://api.commanderzone.com `
    -ProductionHost <ssh-host> `
    -ProductionPath /opt/commanderZone `
    -ConfirmProduction

Modes:
  -Users 50|100|280|500     Run one phase.
  -AllPhases             Run 50, 100, 280, then 500.
  -LocalDryRun           Use 4 users for a short local validation while keeping the selected phase metadata.
  -SkipServerMetrics     Do not collect server-side metrics.

Reports:
  reports/load-tests/<run-id>/users-<phase>/
"@
}

if ($Help) {
    Show-Usage
    exit 0
}

function Test-CommandAvailable([string] $Name) {
    return $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

function ShellQuote([string] $Value) {
    $singleQuote = "'"
    return $singleQuote + $Value.Replace($singleQuote, $singleQuote + '"' + $singleQuote + '"' + $singleQuote) + $singleQuote
}

function Invoke-RemoteCommand([string] $Command) {
    if ([string]::IsNullOrWhiteSpace($ProductionHost)) {
        throw "ProductionHost is required for remote server metrics."
    }
    $target = $ProductionHost
    if (-not [string]::IsNullOrWhiteSpace($SshUser)) {
        $target = "$SshUser@$ProductionHost"
    }

    $output = & ssh $target $Command 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "ssh command failed with exit code $LASTEXITCODE. Command: $Command`n$output"
    }

    return $output
}

function ConvertFrom-JsonLines([object[]] $Lines) {
    $items = @()
    foreach ($line in @($Lines)) {
        $text = ([string] $line).Trim()
        if ($text -eq "") {
            continue
        }
        try {
            $items += ($text | ConvertFrom-Json)
        } catch {
            $items += [pscustomobject]@{
                parseError = $_.Exception.Message
                raw = $text
            }
        }
    }

    return $items
}

function Collect-ServerSnapshot([string] $PhaseDir, [string] $Label) {
    $snapshot = [ordered]@{
        capturedAt = (Get-Date).ToUniversalTime().ToString("o")
        label = $Label
        productionHost = $ProductionHost
        dockerStats = @()
        dockerInspect = @()
        runtime = $null
        postgres = $null
        errors = @()
    }

    if ($SkipServerMetrics) {
        $snapshot.errors += "server metrics skipped by -SkipServerMetrics"
        return [pscustomobject] $snapshot
    }

    if (-not [string]::IsNullOrWhiteSpace($ProductionHost)) {
        $quotedPath = ShellQuote $ProductionPath
        $compose = 'docker compose --env-file .env.prod -f docker-compose.yml $(if test -f docker-compose.prod.yml; then printf "%s" "-f docker-compose.prod.yml"; fi)'
        $services = "api websocket game-runtime database"

        try {
            $statsCommand = "cd $quotedPath && $compose ps -q $services | xargs -r docker stats --no-stream --format '{{json .}}'"
            $snapshot.dockerStats = @(ConvertFrom-JsonLines (Invoke-RemoteCommand $statsCommand))
        } catch {
            $snapshot.errors += "docker stats: $($_.Exception.Message)"
        }

        try {
            $inspectCommand = "cd $quotedPath && $compose ps -q $services | xargs -r docker inspect --format '{`"Name`":{{json .Name}},`"RestartCount`":{{.RestartCount}},`"State`":{{json .State}},`"Config`":{`"Labels`":{{json .Config.Labels}}}}'"
            $snapshot.dockerInspect = @(ConvertFrom-JsonLines (Invoke-RemoteCommand $inspectCommand))
        } catch {
            $snapshot.errors += "docker inspect: $($_.Exception.Message)"
        }

        try {
            $runtimeUrl = if ([string]::IsNullOrWhiteSpace($RuntimeMetricsUrl)) { "http://127.0.0.1:8091/metrics" } else { $RuntimeMetricsUrl }
            $runtimeCommand = "curl -fsS $(ShellQuote $runtimeUrl)"
            $runtimePayload = (Invoke-RemoteCommand $runtimeCommand) -join "`n"
            if (-not [string]::IsNullOrWhiteSpace($runtimePayload)) {
                $snapshot.runtime = $runtimePayload | ConvertFrom-Json
            }
        } catch {
            $snapshot.errors += "runtime metrics: $($_.Exception.Message)"
        }

        try {
            $sql = "select json_build_object('capturedAt',now(),'database',(select row_to_json(d) from pg_stat_database d where datname=current_database()),'activity',(select json_agg(a) from (select state,wait_event_type,wait_event,count(*) from pg_stat_activity where datname=current_database() group by 1,2,3) a),'locks',(select json_agg(l) from (select locktype,mode,granted,count(*) from pg_locks group by 1,2,3) l),'pool',json_build_object('used',(select count(*) from pg_stat_activity),'max',(select setting::int from pg_settings where name='max_connections')),'pgStatStatementsAvailable',to_regclass('public.pg_stat_statements') is not null)::text;"
            $inner = "psql -U ""`$POSTGRES_USER"" -d ""`$POSTGRES_DB"" -At -c ""$sql"""
            $dbCommand = "cd $quotedPath && $compose exec -T database sh -lc $(ShellQuote $inner)"
            $dbPayload = (Invoke-RemoteCommand $dbCommand) -join "`n"
            if (-not [string]::IsNullOrWhiteSpace($dbPayload)) {
                $snapshot.postgres = $dbPayload | ConvertFrom-Json
            }
            $statementsSql = "select coalesce(json_agg(x),'[]'::json)::text from (select queryid,calls,total_exec_time,mean_exec_time,rows,left(query,500) query from pg_stat_statements order by total_exec_time desc limit 25) x;"
            $statementsInner = "psql -U ""`$POSTGRES_USER"" -d ""`$POSTGRES_DB"" -At -c ""$statementsSql"""
            try {
                $statementsPayload = (Invoke-RemoteCommand "cd $quotedPath && $compose exec -T database sh -lc $(ShellQuote $statementsInner)") -join "`n"
                $statementsPayload | Set-Content -Path (Join-Path $PhaseDir "pg-stat-statements-$Label.json") -Encoding UTF8
            } catch {
                $snapshot.errors += "pg_stat_statements unavailable: $($_.Exception.Message)"
            }
        } catch {
            $snapshot.errors += "postgres metrics: $($_.Exception.Message)"
        }
    } elseif (-not [string]::IsNullOrWhiteSpace($RuntimeMetricsUrl)) {
        try {
            $snapshot.runtime = Invoke-RestMethod -Uri $RuntimeMetricsUrl -TimeoutSec 10
        } catch {
            $snapshot.errors += "runtime metrics: $($_.Exception.Message)"
        }
    } else {
        $snapshot.errors += "server metrics unavailable: provide -ProductionHost or -RuntimeMetricsUrl, or use -SkipServerMetrics"
    }

    $path = Join-Path $PhaseDir "server-metrics-$Label.json"
    [pscustomobject] $snapshot | ConvertTo-Json -Depth 80 | Set-Content -Path $path -Encoding UTF8

    return [pscustomobject] $snapshot
}

function Add-NumericMap([hashtable] $Map, [object] $Value, [string] $Prefix) {
    if ($null -eq $Value) {
        return
    }
    if ($Value -is [byte] -or $Value -is [int16] -or $Value -is [int] -or $Value -is [long] -or $Value -is [float] -or $Value -is [double] -or $Value -is [decimal]) {
        $Map[$Prefix] = [double] $Value
        return
    }
    if ($Value -is [System.Collections.IEnumerable] -and -not ($Value -is [string]) -and -not ($Value -is [pscustomobject])) {
        return
    }
    if ($Value -is [pscustomobject]) {
        foreach ($property in $Value.PSObject.Properties) {
            $childPrefix = if ($Prefix -eq "") { $property.Name } else { "$Prefix.$($property.Name)" }
            Add-NumericMap $Map $property.Value $childPrefix
        }
    }
}

function Get-NumericMap([object] $Value) {
    $map = @{}
    Add-NumericMap $map $Value ""
    return $map
}

function New-NumericDelta([object] $Before, [object] $After) {
    $beforeMap = Get-NumericMap $Before
    $afterMap = Get-NumericMap $After
    $keys = @($beforeMap.Keys + $afterMap.Keys | Sort-Object -Unique)
    $delta = [ordered]@{}
    foreach ($key in $keys) {
        $beforeValue = if ($beforeMap.ContainsKey($key)) { $beforeMap[$key] } else { 0.0 }
        $afterValue = if ($afterMap.ContainsKey($key)) { $afterMap[$key] } else { 0.0 }
        $delta[$key] = [math]::Round($afterValue - $beforeValue, 4)
    }

    return [pscustomobject] $delta
}

function Get-ComposeServiceName([object] $Inspect) {
    $labels = $Inspect.Config.Labels
    if ($null -ne $labels) {
        $property = $labels.PSObject.Properties["com.docker.compose.service"]
        if ($null -ne $property -and -not [string]::IsNullOrWhiteSpace([string] $property.Value)) {
            return [string] $property.Value
        }
    }
    return ([string] $Inspect.Name).Trim("/")
}

function Get-RestartCounts([object[]] $Inspects) {
    $counts = @{}
    foreach ($inspect in @($Inspects)) {
        if ($null -eq $inspect -or $null -eq $inspect.RestartCount) {
            continue
        }
        $counts[(Get-ComposeServiceName $inspect)] = [int] $inspect.RestartCount
    }

    return $counts
}

function New-ServerDelta([object] $Before, [object] $After, [string] $PhaseDir) {
    $beforeRestarts = Get-RestartCounts @($Before.dockerInspect)
    $afterRestarts = Get-RestartCounts @($After.dockerInspect)
    $restartDelta = [ordered]@{}
    foreach ($service in @($beforeRestarts.Keys + $afterRestarts.Keys | Sort-Object -Unique)) {
        $beforeValue = if ($beforeRestarts.ContainsKey($service)) { $beforeRestarts[$service] } else { 0 }
        $afterValue = if ($afterRestarts.ContainsKey($service)) { $afterRestarts[$service] } else { 0 }
        $restartDelta[$service] = $afterValue - $beforeValue
    }

    $delta = [ordered]@{
        generatedAt = (Get-Date).ToUniversalTime().ToString("o")
        runtime = New-NumericDelta $Before.runtime $After.runtime
        postgres = New-NumericDelta $Before.postgres $After.postgres
        restartDelta = [pscustomobject] $restartDelta
        errors = @($Before.errors) + @($After.errors)
    }
    $path = Join-Path $PhaseDir "server-metrics-delta.json"
    [pscustomobject] $delta | ConvertTo-Json -Depth 80 | Set-Content -Path $path -Encoding UTF8

    return [pscustomobject] $delta
}

function Test-ServerGate([object] $Delta) {
    $failures = @()
    foreach ($property in $Delta.restartDelta.PSObject.Properties) {
        if ([int] $property.Value -ne 0) {
            $failures += "container restart delta for $($property.Name) is $($property.Value)"
        }
    }

    $runtime = $Delta.runtime
    foreach ($key in @(
        "totals.actor.queue_full_count",
        "totals.command.unsupported_count",
        "runtime.runtime.ownership_reject_count"
    )) {
        $property = $runtime.PSObject.Properties[$key]
        if ($null -ne $property -and [double] $property.Value -gt 0.0) {
            $failures += "$key delta is $($property.Value)"
        }
    }

    $postgres = $Delta.postgres
    foreach ($key in @("database.deadlocks")) {
        $property = $postgres.PSObject.Properties[$key]
        if ($null -ne $property -and [double] $property.Value -gt 0.0) {
            $failures += "postgres $key delta is $($property.Value)"
        }
    }

    return $failures
}

function Write-OperatorSummary([string] $PhaseDir, [int] $PhaseUsers, [int] $K6ExitCode, [object] $ServerDelta, [string[]] $ServerGateFailures) {
    $summaryPath = Join-Path $PhaseDir "summary.md"
    $k6SummaryPath = Join-Path $PhaseDir "k6-summary.json"
    $k6Status = if ($K6ExitCode -eq 0) { "pass" } else { "fail" }
    $serverStatus = if ($ServerGateFailures.Count -eq 0) { "pass" } else { "fail" }
    $lines = @()
    $lines += "# CommanderZone Production Load Test"
    $lines += ""
    $lines += "- Phase users: $PhaseUsers"
    $lines += "- API base URL: $ApiBaseUrl"
    $lines += "- k6 status: $k6Status"
    $lines += "- server status: $serverStatus"
    $lines += "- k6 summary JSON: $k6SummaryPath"
    $lines += "- server delta JSON: $(Join-Path $PhaseDir "server-metrics-delta.json")"
    $lines += ""
    $lines += "## Server Gate"
    $lines += ""
    if ($ServerGateFailures.Count -eq 0) {
        $lines += "- No critical server gate failures detected."
    } else {
        foreach ($failure in $ServerGateFailures) {
            $lines += "- $failure"
        }
    }
    $lines += ""
    $lines += "## Notes"
    $lines += ""
    $lines += "- Generated at: $((Get-Date).ToUniversalTime().ToString("o"))"
    $lines += "- Server metric collection errors: $(@($ServerDelta.errors).Count)"
    foreach ($errorMessage in @($ServerDelta.errors)) {
        $lines += "  - $errorMessage"
    }

    $lines -join [Environment]::NewLine | Set-Content -Path $summaryPath -Encoding UTF8
}

function Assert-Safety {
    if (-not (Test-CommandAvailable "docker")) {
        throw "Docker is required to run k6."
    }
    if (-not [string]::IsNullOrWhiteSpace($ProductionHost) -and -not (Test-CommandAvailable "ssh")) {
        throw "ssh is required when -ProductionHost is provided."
    }
    if ([string]::IsNullOrWhiteSpace($UserPassword)) {
        throw "Set LOAD_TEST_USER_PASSWORD or pass -UserPassword. Do not commit seeded user credentials."
    }

    if (-not (Test-CommandAvailable "node")) { throw "Node.js 22+ is required for load supervision." }
    $uri = [Uri] $ApiBaseUrl
    $isProductionApi = $uri.Host -eq "api.commanderzone.com"
    if ($isProductionApi -and $SkipServerMetrics) { throw "Production requires server metrics." }
    if ($isProductionApi -and -not $ConfirmProduction) {
        throw "Production target requires -ConfirmProduction."
    }
    if (-not $isProductionApi -and -not $AllowNonProduction -and -not $LocalDryRun) {
        throw "Non-production target requires -AllowNonProduction or -LocalDryRun."
    }
    if ($isProductionApi -and -not $SkipServerMetrics -and [string]::IsNullOrWhiteSpace($ProductionHost)) {
        throw "Production load tests must collect API/PHP, websocket, runtime, and database metrics. Provide -ProductionHost or explicit -SkipServerMetrics."
    }
}

function Invoke-Phase([int] $PhaseUsers, [string] $RunId, [string] $ReportRoot) {
    $repoRoot = Split-Path -Parent $PSScriptRoot
    $loadTestsDir = Join-Path $repoRoot "load-tests"
    $phaseDir = Join-Path $ReportRoot "users-$PhaseUsers"
    New-Item -ItemType Directory -Path $phaseDir -Force | Out-Null

    Write-Host "Starting CommanderZone load phase: users=$PhaseUsers report=$phaseDir"
    $before = Collect-ServerSnapshot $phaseDir "before"

    $duration = if ($LocalDryRun) { "30s" } else { "$($DurationMinutes)m" }
    $dryRunValue = if ($LocalDryRun) { "1" } else { "0" }
    $k6LogPath = Join-Path $phaseDir "k6-output.log"
    $k6Script = if ($Scenario -eq "navigation") { "/scripts/commanderzone-navigation.k6.js" } else { "/scripts/commanderzone-production.k6.js" }
    $containerName = "$RunId-$PhaseUsers"
    $dockerArgs = @(
        "run",
        "--rm",
        "--name", $containerName,
        "--pull=missing",
        "-e", "K6_NO_USAGE_REPORT=true",
        "-e", "API_BASE_URL=$ApiBaseUrl",
        "-e", "USERS=$PhaseUsers",
        "-e", "USER_PASSWORD",
        "-e", "FRIEND_SEARCH_TERMS",
        "-e", "NAVIGATION_MIX",
        "-e", "ANALYSIS_STATE",
        "-e", "ANALYSIS_FIXTURES",
        "-e", "DEPLOYED_COMMIT",
        "-e", "RUN_ID=$RunId",
        "-e", "PHASE_NAME=users-$PhaseUsers",
        "-e", "DECK_NAME=$DeckName",
        "-e", "DURATION=$duration",
        "-e", "DRY_RUN=$dryRunValue",
        "-e", "COMMAND_INTERVAL_MS=$CommandIntervalMs",
        "-v", "$((Resolve-Path $loadTestsDir).Path):/scripts:ro",
        "-v", "$((Resolve-Path $phaseDir).Path):/reports",
        $K6Image,
        "run",
        "--out", "json=/reports/k6-points.ndjson",
        $k6Script
    )

    $previousDockerPassword = $env:USER_PASSWORD
    $env:USER_PASSWORD = $UserPassword
    try {
        $configPath = Join-Path $phaseDir "supervisor-config.json"
        $shellExe = (Get-Process -Id $PID).Path
        @{
            reportDir = $phaseDir; containerName = $containerName; requireMetrics = -not [bool]$SkipServerMetrics
            command = @("docker") + $dockerArgs
            snapshotCommand = @($shellExe, "-NoProfile", "-File", $PSCommandPath, "-SnapshotDir", $phaseDir,
                "-ProductionHost", $ProductionHost, "-ProductionPath", $ProductionPath, "-SshUser", $SshUser,
                "-RuntimeMetricsUrl", $RuntimeMetricsUrl)
        } | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $configPath -Encoding UTF8
        & node (Join-Path $PSScriptRoot "supervise-load.mjs") $configPath
        $k6ExitCode = $LASTEXITCODE
    } finally {
        if ($null -eq $previousDockerPassword) {
            Remove-Item Env:\USER_PASSWORD -ErrorAction SilentlyContinue
        } else {
            $env:USER_PASSWORD = $previousDockerPassword
        }
    }

    $after = Collect-ServerSnapshot $phaseDir "after"
    $serverDelta = New-ServerDelta $before $after $phaseDir
    $serverGateFailures = @(Test-ServerGate $serverDelta)
    Write-OperatorSummary $phaseDir $PhaseUsers $k6ExitCode $serverDelta $serverGateFailures

    if ($k6ExitCode -ne 0) {
        Write-Host "k6 phase users=$PhaseUsers failed with exit code $k6ExitCode"
    }
    if ($serverGateFailures.Count -gt 0) {
        Write-Host "Server gate failures for users=$PhaseUsers"
        foreach ($failure in $serverGateFailures) {
            Write-Host "- $failure"
        }
    }

    return ($k6ExitCode -eq 0 -and $serverGateFailures.Count -eq 0)
}

if ($SnapshotDir) {
    $null = Collect-ServerSnapshot $SnapshotDir "live"
    exit 0
}

Assert-Safety

$phases = if ($AllPhases) { @(50, 100, 280, 500) } else { @($Users) }
$runId = "czlt-" + (Get-Date -Format "yyyyMMdd-HHmmss")
if ($LocalDryRun) {
    $runId += "-dryrun"
}
$repoRoot = Split-Path -Parent $PSScriptRoot
$reportRoot = Join-Path $repoRoot "reports\load-tests\$runId"
New-Item -ItemType Directory -Path $reportRoot -Force | Out-Null

$allPassed = $true
foreach ($phase in $phases) {
    $passed = Invoke-Phase $phase $runId $reportRoot
    if (-not $passed) {
        $allPassed = $false
        break
    }
}

Write-Host "Load test report root: $reportRoot"
if (-not $allPassed) {
    exit 1
}
