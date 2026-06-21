# CommanderZone Game Runtime

This is a minimal Go skeleton for the future active gameplay runtime.

The service is intentionally not wired into Symfony or CI yet. It exists to pin down package boundaries, V2 protocol types, actor interfaces, and persistence contracts before migrating commands.

## Packages

- `cmd/runtime`: process entrypoint and health checks.
- `internal/protocol`: V2 command, patch, event, and bootstrap-adjacent protocol types.
- `internal/state`: compact game runtime state, locations, zones, visibility, relations.
- `internal/actor`: single-writer game actor, applier interface, patch emitter.
- `internal/persistence`: append-only event and compact snapshot store interfaces.
- `internal/gateway`: runtime ticket validation and command routing interfaces.
- `internal/runtime`: actor registry/service orchestration.

## Current Scope

No production WebSocket server is implemented in this skeleton. The gateway package defines the integration seam so the actual transport can be added without coupling command application to HTTP or a specific WebSocket library.

The first actor implementation supports:

- actor create/load by `gameId`
- per-game bounded queue
- single-writer loop
- graceful shutdown
- heartbeat
- compact `GameState` with `loc`
- `life.changed`
- `turn.changed`
- `dice.rolled`
- `card.tapped`
- `card.counter.changed`
- final `card.position.changed`
- `library.draw`
- `library.draw_many`
- `library.reveal_top`
- `library.reorder_top`
- `library.shuffle`
- `card.moved`
- `cards.moved`
- `zone.reorderedByIds`
- `zone.move_all`
- `battlefield.untap_all`
- public semantic patch emission
- private owner patches for hidden card identity
- group reveal patches for revealed library top windows
- in-memory fake `EventStore` for version/idempotency tests

## Docker Toolchain

Build the local Go toolchain image from the repository root:

```powershell
docker build -f game-runtime/Dockerfile.toolchain -t commanderzone-go-toolchain:1.22 --build-arg GO_VERSION=1.22.12 .
```

Run validation without installing Go on the host:

```powershell
docker run --rm -v "${PWD}:/workspace" -w /workspace/game-runtime commanderzone-go-toolchain:1.22 go test ./...
docker run --rm -v "${PWD}:/workspace" -w /workspace/game-runtime commanderzone-go-toolchain:1.22 go test -race ./...
docker run --rm -v "${PWD}:/workspace" -w /workspace/game-runtime commanderzone-go-toolchain:1.22 go test ./internal/actor ./internal/state -bench .
```

## Production Image

Build the production runtime image from the repository root:

```powershell
docker compose --env-file .env.prod -f docker-compose.prod.yml build game-runtime
```

Run the production service with the rest of the production stack:

```powershell
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d game-runtime
docker compose --env-file .env.prod -f docker-compose.prod.yml ps game-runtime
```

The production image is a static Go binary on `scratch`. It exposes `/healthz` and `/readyz` on `GAME_RUNTIME_LISTEN` and uses the binary itself for Docker healthchecks.

## WebSocket Gateway

The runtime exposes the gameplay gateway on `/ws`.

Clients connect with:

```text
/ws?ticket=<runtime-ticket>&lastAppliedVersion=<optional-version>
```

The runtime ticket is an HMAC-SHA256 signed envelope:

```text
base64url(json-payload).base64url(hmac_sha256(base64url(json-payload), GAME_RUNTIME_TICKET_SECRET))
```

Payload fields:

- `userId`
- `playerId`
- `gameId`
- `roles`
- `viewerKind`
- `protocol`
- `exp`

`GAME_RUNTIME_TICKET_SECRET` must be shared with Symfony when the runtime is activated. If the secret is empty, `/ws` rejects gameplay connections while health endpoints remain available.

Client command messages:

```json
{
  "type": "command",
  "command": {
    "gameId": "game-id",
    "baseVersion": 1,
    "clientActionId": "uuid",
    "type": "life.changed",
    "payload": {}
  }
}
```

Server patch messages:

```json
{
  "type": "patch",
  "patch": {
    "gameId": "game-id",
    "version": 2,
    "visibility": "public",
    "ops": []
  }
}
```

Reconnect uses the in-memory patch buffer. If patches after `lastAppliedVersion` are unavailable, the runtime emits `resync.required`; that path is exceptional and should trigger bootstrap.

## Expected Validation

Run when Go is installed:

```powershell
cd game-runtime
go test ./...
go test -race ./...
```
