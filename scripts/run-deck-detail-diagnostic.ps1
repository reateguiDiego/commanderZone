param(
    [ValidatePattern('^[a-z0-9][a-z0-9-]{0,219}$')]
    [string] $Slug = 'deck-panoramix-commander-10e95bda',
    [string] $ProductionHost = '168.119.116.31',
    [string] $SshUser = 'root',
    [string] $SshIdentityFile = "$env:USERPROFILE\.ssh\hetzner"
)
$ErrorActionPreference = 'Stop'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$repo = Split-Path $PSScriptRoot -Parent
$report = Join-Path $repo "reports/deck-detail-$stamp"
$remote = '/tmp/cz-deck-detail-' + [guid]::NewGuid().ToString('N') + '.php'
$target = "$SshUser@$ProductionHost"
$sshOptions = @('-i', $SshIdentityFile, '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-o', 'ServerAliveInterval=10')
New-Item -ItemType Directory -Path $report -Force | Out-Null
try {
    & scp @sshOptions (Join-Path $PSScriptRoot 'explain-deck-detail.php') "${target}:$remote"
    if ($LASTEXITCODE -ne 0) { throw 'Diagnostic upload failed.' }
    & ssh @sshOptions $target "docker cp $remote commanderzone-api-1:$remote"
    if ($LASTEXITCODE -ne 0) { throw 'Diagnostic container copy failed.' }
    $commit = & ssh @sshOptions $target 'cd /opt/commanderZone && git rev-parse HEAD'
    if ($LASTEXITCODE -ne 0) { throw 'Cannot record deployed commit.' }
    $commit | Set-Content -LiteralPath (Join-Path $report 'deployed-commit.txt') -Encoding UTF8
    Write-Host 'Capturing selected deck detail, then replaying read-only EXPLAIN plans...'
    $output = & ssh @sshOptions $target "docker exec -e APP_ENV=prod commanderzone-api-1 php $remote /app $Slug"
    if ($LASTEXITCODE -ne 0) { throw 'Deck diagnostic failed.' }
    $text = $output -join "`n"
    $parsed = $text | ConvertFrom-Json
    if ($parsed.slug -ne $Slug -or @($parsed.plans).Count -eq 0) { throw 'Invalid diagnostic response.' }
    $text | Set-Content -LiteralPath (Join-Path $report 'deck-detail.json') -Encoding UTF8
    $parsed.stages | Format-List
    $parsed.plans | Sort-Object executionMs -Descending | Select-Object -First 5 number,stage,executionMs | Format-Table
} finally {
    & ssh @sshOptions $target "docker exec commanderzone-api-1 rm -f $remote; rm -f $remote"
    Write-Host "Reports: $report"
}
