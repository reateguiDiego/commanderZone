param([string]$Allowlist)

if ([string]::IsNullOrWhiteSpace($Allowlist)) {
  $Allowlist = @(
    'mulligan.take','mulligan.keep','mulligan.scry.confirm',
    'library.draw','library.draw_many','library.shuffle','library.reveal_top','library.reorder_top','library.move_top','library.view',
    'card.moved','cards.moved','zone.move_all','zone.reorderedByIds',
    'card.tapped','battlefield.untap_all','card.position.changed','cards.position.changed','card.counter.changed','counter.changed','commander.damage.changed','card.power_toughness.changed','life.changed','turn.changed','dice.rolled',
    'stack.card_added','stack.item_removed','arrow.created','arrow.removed','attachment.created','attachment.removed','helper.created','helper.updated','helper.removed',
    'card.face_down.changed','card.revealed','card.controller.changed','library.reveal','library.play_top_revealed',
    'card.token.created','card.token_copy.created','zone.random_card.selected','card.dungeon_marker.changed','card.face.changed','library.put_top','library.put_bottom',
    'game.concede','game.close'
  ) -join ','
}

docker rm -f commanderzone-api-e2e commanderzone-websocket-e2e 2>$null | Out-Null

docker run -d --name commanderzone-api-e2e --network commanderzone_default -p 127.0.0.1:8000:80 `
  -e APP_ENV=dev `
  -e APP_DEBUG=1 `
  -e APP_SECRET=commanderzone-dev-secret-change-me `
  -e "DATABASE_URL=postgresql://commanderzone:commanderzone@database:5432/commanderzone?serverVersion=16&charset=utf8" `
  -e MAILER_DSN=smtp://mailpit:1025 `
  -e MAILER_FROM_ADDRESS=no-reply@commanderzone.com `
  -e MAILER_FROM_NAME=CommanderZone `
  -e AUTH_PUBLIC_APP_URL=http://localhost:4200 `
  -e JWT_SECRET_KEY=change-this-jwt-dev-secret-with-at-least-32-chars `
  -e JWT_PUBLIC_KEY=change-this-jwt-dev-secret-with-at-least-32-chars `
  -e JWT_PASSPHRASE= `
  -e AUTH_ACCESS_TOKEN_TTL=900 `
  -e AUTH_REFRESH_TOKEN_TTL=604800 `
  -e AUTH_REFRESH_REPLAY_GRACE_SECONDS=20 `
  -e AUTH_REFRESH_COOKIE_SAMESITE=lax `
  -e AUTH_REFRESH_COOKIE_DOMAIN= `
  -e MERCURE_URL=http://mercure/.well-known/mercure `
  -e MERCURE_PUBLIC_URL=http://127.0.0.1:3000/.well-known/mercure `
  -e MERCURE_JWT_SECRET=change-this-mercure-dev-secret-with-at-least-32-chars `
  -e GAME_WEBSOCKET_PUBLIC_URL=ws://127.0.0.1:8081 `
  -e GAMEPLAY_V2_ENABLED=1 `
  -e GAMEPLAY_V2_COMMAND_ENABLED=1 `
  -e GAMEPLAY_V2_PATCH_ENABLED=1 `
  -e GAMEPLAY_V2_EVENT_ENABLED=1 `
  -e GAMEPLAY_V2_VISIBILITY_ENABLED=1 `
  -e SEMANTIC_PATCHES_ENABLED=1 `
  -e RUNTIME_SERVICE_ENABLED=1 `
  -e GAME_RUNTIME_ENABLED=1 `
  -e SHADOW_COMPARE_ENABLED=0 `
  -e GAME_RUNTIME_INTERNAL_URL=http://game-runtime:8091 `
  -e GAMEPLAY_V2_BOOTSTRAP_ENABLED=1 `
  -e COMPACT_BOOTSTRAP_ENABLED=1 `
  -e GAMEPLAY_V2_COMMANDS_ALLOWLIST=$Allowlist `
  commanderzone-api | Out-Null

$websocketArgs = @(
  'run', '-d',
  '--name', 'commanderzone-websocket-e2e',
  '--network', 'commanderzone_default',
  '-p', '127.0.0.1:8081:8081',
  '--health-cmd', 'php bin/ws-healthcheck.php',
  '--health-interval', '5s',
  '--health-timeout', '3s',
  '--health-retries', '12',
  '-e', 'APP_ENV=dev',
  '-e', 'APP_DEBUG=1',
  '-e', 'APP_SECRET=commanderzone-dev-secret-change-me',
  '-e', 'DATABASE_URL=postgresql://commanderzone:commanderzone@database:5432/commanderzone?serverVersion=16&charset=utf8',
  '-e', 'JWT_SECRET_KEY=change-this-jwt-dev-secret-with-at-least-32-chars',
  '-e', 'JWT_PUBLIC_KEY=change-this-jwt-dev-secret-with-at-least-32-chars',
  '-e', 'JWT_PASSPHRASE=',
  '-e', 'GAME_WEBSOCKET_LISTEN=0.0.0.0:8081',
  '-e', 'GAME_WEBSOCKET_PUBLIC_URL=ws://127.0.0.1:8081',
  '-e', 'GAME_WEBSOCKET_CONNECTION_LIMIT=1000',
  '-e', 'GAME_WEBSOCKET_CONNECTION_LIMIT_PER_IP=100',
  '-e', 'GAMEPLAY_V2_ENABLED=1',
  '-e', 'GAMEPLAY_V2_COMMAND_ENABLED=1',
  '-e', 'GAMEPLAY_V2_PATCH_ENABLED=1',
  '-e', 'GAMEPLAY_V2_EVENT_ENABLED=1',
  '-e', 'GAMEPLAY_V2_VISIBILITY_ENABLED=1',
  '-e', 'SEMANTIC_PATCHES_ENABLED=1',
  '-e', 'RUNTIME_SERVICE_ENABLED=1',
  '-e', 'GAME_RUNTIME_ENABLED=1',
  '-e', 'SHADOW_COMPARE_ENABLED=0',
  '-e', 'GAME_RUNTIME_INTERNAL_URL=http://game-runtime:8091',
  '-e', 'GAMEPLAY_V2_BOOTSTRAP_ENABLED=1',
  '-e', 'COMPACT_BOOTSTRAP_ENABLED=1',
  '-e', "GAMEPLAY_V2_COMMANDS_ALLOWLIST=$Allowlist",
  'commanderzone-api',
  'php', 'bin/console', 'app:game-websocket-server'
)
docker @websocketArgs | Out-Null

$deadline = (Get-Date).AddMinutes(2)
do {
  try {
    $api = Test-NetConnection -ComputerName 127.0.0.1 -Port 8000 -WarningAction SilentlyContinue
    $ws = Invoke-WebRequest -UseBasicParsing -Uri http://127.0.0.1:8081/healthz -TimeoutSec 3
    if ($api.TcpTestSucceeded -and $ws.StatusCode -eq 200 -and $ws.Content -eq 'ok') {
      Write-Output "ready:$Allowlist"
      exit 0
    }
  } catch {}
  Start-Sleep -Seconds 2
} while ((Get-Date) -lt $deadline)

Write-Error "Services not ready for allowlist $Allowlist"
exit 1
