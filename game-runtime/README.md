# CommanderZone Game Runtime

This is the Go gameplay runtime for active CommanderZone gameplay transport.

The service exposes the runtime WebSocket, HTTP command endpoint, metrics, V2 protocol types, actor interfaces, and persistence contracts used while commands are migrated out of legacy PHP paths.

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
- `permissions`
- `protocol`
- `exp`

`GAME_RUNTIME_TICKET_SECRET` must be shared with Symfony when the runtime is activated. If the secret is empty, `/ws` rejects gameplay connections while health endpoints remain available.

Client command messages use `kind` as the active contract. `type: "command"` is accepted only by the explicit compatibility adapter for older clients.

```json
{
  "kind": "command.v2",
  "messageId": "uuid",
  "gameId": "game-id",
  "baseVersion": 1,
  "clientActionId": "uuid",
  "type": "life.changed",
  "payload": {}
}
```

Server patch messages:

```json
{
  "kind": "patch.v2",
  "gameId": "game-id",
  "version": 2,
  "visibility": "public",
  "ops": []
}
```

Reconnect uses the in-memory patch buffer. If patches after `lastAppliedVersion` are unavailable, the runtime emits `resync_required`; that path is exceptional and should trigger bootstrap.

## Persistence

The runtime supports two persistence modes:

- `GAME_RUNTIME_PERSISTENCE=memory`: local fake store for development/tests.
- `GAME_RUNTIME_PERSISTENCE=postgres`: append-only `game_event` plus `game_snapshot_compact`.

Production should use:

```text
GAME_RUNTIME_PERSISTENCE=postgres
DATABASE_URL=postgresql://.../commanderzone?...&sslmode=disable
```

If `sslmode` is missing, the runtime appends `sslmode=disable` for Docker-internal Postgres connections.

The Postgres store uses the existing backend migration tables:

- `game_event(game_id, version, type, payload, created_by_id, client_action_id, created_at, updated_at)`
- `game_snapshot_compact(game_id, version, snapshot, checksum, created_at)`

Recovery loads the latest compact snapshot, verifies its SHA-256 checksum, replays events after that version, rebuilds `loc`, validates invariants, and only then accepts commands. Compact snapshots reject static card payload keys such as `imageUris`, `oracleText`, and `cardFaces`.

Snapshot policy defaults:

- every `100` events
- every `30s`
- on actor stop/shutdown

Integration tests for Postgres are opt-in:

```powershell
$env:GAME_RUNTIME_TEST_DATABASE_URL="postgres://runtime_test:runtime_test@127.0.0.1:55432/runtime_test?sslmode=disable"
docker run --rm -v "${PWD}:/workspace" -w /workspace/game-runtime -e GAME_RUNTIME_TEST_DATABASE_URL=$env:GAME_RUNTIME_TEST_DATABASE_URL commanderzone-go-toolchain:1.22 go test ./internal/persistence -run Postgres -count=1 -v
```

## Expected Validation

Run when Go is installed:

```powershell
cd game-runtime
go test ./...
go test -race ./...
```
