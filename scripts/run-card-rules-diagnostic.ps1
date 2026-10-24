param(
    [string] $ProductionHost = '168.119.116.31',
    [string] $SshUser = 'root',
    [string] $SshIdentityFile = "$env:USERPROFILE\.ssh\hetzner"
)
$ErrorActionPreference = 'Stop'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$repo = Split-Path $PSScriptRoot -Parent
$report = Join-Path $repo "reports/card-rules-$stamp"
$remote = "/tmp/cz-card-rules-$stamp.php"
$target = "$SshUser@$ProductionHost"
$sshOptions = @('-i', $SshIdentityFile, '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-o', 'ServerAliveInterval=10')
New-Item -ItemType Directory -Path $report -Force | Out-Null
try {
    & scp @sshOptions (Join-Path $PSScriptRoot 'explain-card-rules-search.php') "${target}:$remote"
    if ($LASTEXITCODE -ne 0) { throw 'Diagnostic upload failed.' }
    & ssh @sshOptions $target "docker cp $remote commanderzone-api-1:$remote"
    if ($LASTEXITCODE -ne 0) { throw 'Diagnostic container copy failed.' }
    $commit = & ssh @sshOptions $target 'cd /opt/commanderZone && git rev-parse HEAD'
    if ($LASTEXITCODE -ne 0) { throw 'Cannot record deployed commit.' }
    $commit | Set-Content -LiteralPath (Join-Path $report 'deployed-commit.txt') -Encoding UTF8
    foreach ($term in @('aterrizaje', 'landfall')) {
        Write-Host "Capturing $term (read-only; real selection and warmed EXPLAIN ANALYZE)..."
        $output = & ssh @sshOptions $target "docker exec -e APP_ENV=prod commanderzone-api-1 php $remote /app $term"
        if ($LASTEXITCODE -ne 0) { throw "Diagnostic failed for $term. Earlier reports remain at $report" }
        $text = $output -join "`n"
        $parsed = $text | ConvertFrom-Json
        if ($parsed.term -ne $term -or @($parsed.plans).Count -eq 0) { throw "Invalid diagnostic for $term" }
        $text | Set-Content -LiteralPath (Join-Path $report "$term.json") -Encoding UTF8
        Write-Host "$term`: total=$($parsed.total), selectionMs=$($parsed.selectionMs)"
    }
} finally {
    # Only these uniquely named temporary diagnostic files are removed.
    & ssh @sshOptions $target "docker exec commanderzone-api-1 rm -f $remote; rm -f $remote"
    Write-Host "Reports: $report"
}
