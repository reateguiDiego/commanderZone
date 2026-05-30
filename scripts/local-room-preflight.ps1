param(
    [string]$ApiBaseUrl = 'http://localhost:8000',
    [string[]]$Origins = @('http://localhost:4200', 'http://127.0.0.1:4200')
)

$ErrorActionPreference = 'Stop'

function Assert-Command {
    param([string]$Name)

    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Required command '$Name' was not found in PATH."
    }
}

function Assert-HeaderEquals {
    param(
        [string]$Name,
        [string]$Expected,
        $Headers
    )

    $actual = $Headers[$Name]
    if ($actual -is [System.Array]) {
        $actual = $actual[0]
    }

    if ([string]::IsNullOrWhiteSpace([string]$actual) -or [string]$actual -ne $Expected) {
        throw "Expected header '${Name}: $Expected' but got '$actual'."
    }
}

function Assert-HttpStatus {
    param(
        [string]$ResponseHeaders,
        [int]$ExpectedStatus
    )

    $statusMatch = [regex]::Match($ResponseHeaders, 'HTTP/\d\.\d\s+(\d{3})')
    if (-not $statusMatch.Success) {
        throw "Could not parse HTTP status from curl response headers."
    }

    $actualStatus = [int]$statusMatch.Groups[1].Value
    if ($actualStatus -ne $ExpectedStatus) {
        throw "Expected HTTP status $ExpectedStatus but got $actualStatus."
    }
}

function HeaderMapFromRaw {
    param([string]$ResponseHeaders)

    $headers = @{}
    foreach ($line in ($ResponseHeaders -split "`r?`n")) {
        if ($line -notmatch ':') {
            continue
        }

        $parts = $line -split ':', 2
        $name = $parts[0].Trim()
        $value = $parts[1].Trim()
        if ($name -eq '') {
            continue
        }

        $headers[$name] = $value
    }

    return $headers
}

Assert-Command docker

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

Write-Host ""
Write-Host "==> Checking backend migrations are up-to-date" -ForegroundColor Cyan
docker compose exec api php bin/console doctrine:migrations:up-to-date
if ($LASTEXITCODE -ne 0) {
    throw "Doctrine migrations are not up-to-date."
}

$primaryOrigin = $Origins[0]
$nonce = [Guid]::NewGuid().ToString('N').Substring(0, 12)
$email = "preflight$nonce@example.com"
$displayName = "Preflight$($nonce.Substring(0, 6))"
$password = "Password123"

Write-Host ""
Write-Host "==> Registering preflight user" -ForegroundColor Cyan
$registerPayload = @{
    email = $email
    displayName = $displayName
    password = $password
} | ConvertTo-Json -Compress

$null = Invoke-RestMethod `
    -Method Post `
    -Uri "$ApiBaseUrl/auth/register" `
    -Headers @{ Origin = $primaryOrigin; Accept = 'application/json' } `
    -ContentType 'application/json' `
    -Body $registerPayload

Write-Host "==> Marking preflight user as verified in local DB" -ForegroundColor Cyan
$escapedEmail = $email.Replace("'", "''")
docker compose exec -T database psql -U commanderzone -d commanderzone -c "UPDATE app_user SET email_verified_at = NOW() WHERE LOWER(email) = LOWER('$escapedEmail');" | Out-Null
if ($LASTEXITCODE -ne 0) {
    throw "Could not mark preflight user as verified."
}

Write-Host ""
Write-Host "==> Logging in preflight user" -ForegroundColor Cyan
$loginPayload = @{
    email = $email
    password = $password
} | ConvertTo-Json -Compress

$loginResponse = Invoke-RestMethod `
    -Method Post `
    -Uri "$ApiBaseUrl/auth/login" `
    -Headers @{ Origin = $primaryOrigin; Accept = 'application/json' } `
    -ContentType 'application/json' `
    -Body $loginPayload

$token = [string]$loginResponse.token
if ([string]::IsNullOrWhiteSpace($token)) {
    throw "Could not obtain JWT token from /auth/login."
}

foreach ($origin in $Origins) {
    Write-Host ""
    Write-Host "==> Verifying CORS preflight for $origin" -ForegroundColor Cyan
    $optionsHeaderFile = New-TemporaryFile
    try {
        curl.exe -sS --dump-header $optionsHeaderFile.FullName -o NUL -X OPTIONS "$ApiBaseUrl/rooms" `
            -H "Origin: $origin" `
            -H "Access-Control-Request-Method: POST" `
            -H "Access-Control-Request-Headers: content-type,authorization"
        if ($LASTEXITCODE -ne 0) {
            throw "curl failed while checking OPTIONS /rooms for origin '$origin'."
        }

        $optionsHeaders = Get-Content -Raw $optionsHeaderFile.FullName
    } finally {
        Remove-Item $optionsHeaderFile.FullName -ErrorAction SilentlyContinue
    }

    Assert-HttpStatus -ResponseHeaders $optionsHeaders -ExpectedStatus 200
    $optionsHeaderMap = HeaderMapFromRaw -ResponseHeaders $optionsHeaders
    Assert-HeaderEquals -Name 'Access-Control-Allow-Origin' -Expected $origin -Headers $optionsHeaderMap

    Write-Host "==> Creating room smoke request for $origin" -ForegroundColor Cyan
    $createPayload = @{
        visibility = 'private'
        maxPlayers = 2
    } | ConvertTo-Json -Compress

    $createHeaderFile = New-TemporaryFile
    try {
        curl.exe -sS --dump-header $createHeaderFile.FullName -o NUL -X POST "$ApiBaseUrl/rooms" `
            -H "Origin: $origin" `
            -H "Authorization: Bearer $token" `
            -H "Accept: application/json" `
            -H "Content-Type: application/json" `
            --data $createPayload
        if ($LASTEXITCODE -ne 0) {
            throw "curl failed while creating room for origin '$origin'."
        }

        $createHeaders = Get-Content -Raw $createHeaderFile.FullName
    } finally {
        Remove-Item $createHeaderFile.FullName -ErrorAction SilentlyContinue
    }

    Assert-HttpStatus -ResponseHeaders $createHeaders -ExpectedStatus 201
    $createHeaderMap = HeaderMapFromRaw -ResponseHeaders $createHeaders
    Assert-HeaderEquals -Name 'Access-Control-Allow-Origin' -Expected $origin -Headers $createHeaderMap
}

Write-Host ""
Write-Host "Local room preflight passed." -ForegroundColor Green
