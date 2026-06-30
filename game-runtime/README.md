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
- `internal/runtime`: actor registry/service orchestration and ownership guardrails.

## Current Scope

The runtime exposes `/ws`, `/commands`, `/metrics`, `/healthz`, and `/readyz` for the migrated gameplay hot path. It remains a manual Commander table runtime, not a complete Magic rules engine.

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
- explicit single-node runtime ownership mode

## Docker Toolchain

Build the local Go toolchain image from the repository root:

```powershell
docker build -f game-runtime/Dockerfile.toolchain -t commanderzone-go-toolchain:1.22 --build-arg GO_VERSION=1.22.12 .
```

Run validation without installing Go on the host:

```powershell
docker run --rm -v "${PWD}:/workspace" -w /workspace/game-runtime commanderzone-go-toolchain:1.22 go test ./...
docker run --rm -v "${PWD}:/workspace" -w /workspace/game-runtime commanderzone-go-toolchain:1.22 go test -race ./...
docker run --rm -v "${PWD}:/workspace" -w /workspace/game-runtime commanderzone-go-toolchain:1.22 go vet ./...
docker run --rm -v "${PWD}:/workspace" -w /workspace/game-runtime commanderzone-go-toolchain:1.22 go test -run '^$' -bench 'BenchmarkRuntimeGameplaySmoke|BenchmarkApplyOnlyRuntimeCommands4Players100' -benchtime=1x -benchmem ./internal/perf ./internal/actor
docker run --rm -v "${PWD}:/workspace" -w /workspace/game-runtime commanderzone-go-toolchain:1.22 go run ./cmd/runtime-bench -games=10 -iterations=1 -transport=actor -fail-on-gate -output=runtime-bench-smoke.json
```

These are the Go runtime checks that CI requires before merge. `runtime-bench`
separates critical failures from advisory latency/payload targets; `-fail-on-gate`
exits non-zero only for critical failures. See `docs/ci-required-checks.md` for
the repository-level PR and main-release gates.

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

Reconnect patch replay policy:

- The WebSocket gateway first replays from the in-memory per-game patch buffer.
- The buffer keeps the latest `256` versions by default, retaining all patch envelopes for a version together.
- If memory history misses but recent persisted `game_event` rows contain `_runtimePatchReceipt`, the gateway rebuilds replay from those durable receipts without loading a snapshot or actor.
- Replay always applies patch `visibility` filtering per viewer; unauthorized private patches are skipped and private-only commands still rely on their public `version.advance` carrier.
- If the requested gap exceeds the configured replay window, the event stream is not contiguous, or any legacy event lacks `_runtimePatchReceipt`, the gateway emits explicit `resync_required`.
- Gateway replay metrics distinguish source: `PatchReplayMemoryCount`, `PatchReplayDurableCount`, and `PatchReplayResyncCount`.

## Ownership and Fencing

The runtime supports two explicit ownership modes:

Supported configuration:

```text
GAME_RUNTIME_OWNERSHIP_MODE=single-node|postgres-lease
GAME_RUNTIME_INSTANCE_ID=<optional-stable-runtime-process-id>
GAME_RUNTIME_OWNERSHIP_LEASE_TTL=15s
GAME_RUNTIME_OWNERSHIP_RENEW_BEFORE=5s
```

If `GAME_RUNTIME_OWNERSHIP_MODE` is unset, the runtime uses `single-node`. Any unsupported value fails startup.

`single-node` is for local development, tests, or a controlled deployment with exactly one runtime process:

- one runtime process owns active gameplay writes for a `gameId`;
- `runtime.Service` acquires an in-memory owner token before actor recovery or creation;
- `/commands` and `/ws` reject commands with `OWNERSHIP_NOT_HELD` / `ownership_not_held` when the process cannot prove it owns the actor;
- every actor command checks the owner token again before applying state or appending an event, so a stale in-process actor cannot continue after its token is invalidated.

`postgres-lease` is the minimum production-ready ownership mode for more than one possible runtime process:

- requires `GAME_RUNTIME_PERSISTENCE=postgres`;
- requires the `game_runtime_lease` table from the backend migration;
- acquires a lease per `gameId` when no lease exists or the previous lease expired;
- rejects a second owner while the current lease is valid;
- renews active leases before command processing when they approach expiry;
- validates the owner instance and `fencing_token` before applying commands;
- validates the same token again in the Postgres event append statement, so a stale owner cannot append `game_event` rows with an old token.

Metrics expose ownership acquire, renew, reject, release, lost, stolen, and expired counts under `runtime.ownership_*`.

Postgres unique indexes on `(game_id, version)` and `(game_id, client_action_id)` still protect duplicate appends and durable idempotency. The lease table is the ownership policy; unique event constraints alone are not sufficient.

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
- `game_runtime_lease(game_id, owner_instance_id, fencing_token, expires_at, updated_at)` when `GAME_RUNTIME_OWNERSHIP_MODE=postgres-lease`

Recovery loads the latest compact snapshot, verifies its SHA-256 checksum, replays events after that version, rebuilds `loc`, validates invariants, and only then accepts commands. Compact snapshots reject static card payload keys such as `imageUris`, `oracleText`, and `cardFaces`.

Snapshot policy defaults:

- every `100` events
- every `30s`
- on actor stop/shutdown

Integration tests for Postgres are opt-in:

```powershell
$env:GAME_RUNTIME_TEST_DATABASE_URL="postgres://runtime_test:runtime_test@127.0.0.1:55432/runtime_test?sslmode=disable"
docker run --rm -v "${PWD}:/workspace" -w /workspace/game-runtime -e GAME_RUNTIME_TEST_DATABASE_URL=$env:GAME_RUNTIME_TEST_DATABASE_URL commanderzone-go-toolchain:1.22 go test ./internal/persistence -run Postgres -count=1 -v
docker run --rm -v "${PWD}:/workspace" -w /workspace/game-runtime -e GAME_RUNTIME_TEST_DATABASE_URL=$env:GAME_RUNTIME_TEST_DATABASE_URL commanderzone-go-toolchain:1.22 go test ./internal/actor -run PostgresActor -count=1 -v
```

Run the Postgres packages separately when sharing one DSN; each package resets the runtime test tables.

With the repository Docker Compose Postgres, the local DSN is:

```powershell
docker compose up -d database
docker compose exec -T database psql -U commanderzone -d postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'commanderzone_runtime_test' AND pid <> pg_backend_pid();"
docker compose exec -T database psql -U commanderzone -d postgres -c "DROP DATABASE IF EXISTS commanderzone_runtime_test;"
docker compose exec -T database psql -U commanderzone -d postgres -c "CREATE DATABASE commanderzone_runtime_test OWNER commanderzone;"
$env:GAME_RUNTIME_TEST_DATABASE_URL="postgresql://commanderzone:commanderzone@host.docker.internal:5433/commanderzone_runtime_test?sslmode=disable"
docker run --rm -v "${PWD}:/workspace" -w /workspace/game-runtime -e GAME_RUNTIME_TEST_DATABASE_URL=$env:GAME_RUNTIME_TEST_DATABASE_URL golang:1.22.12-bookworm go test ./internal/actor -run PostgresActor -count=1 -v
docker run --rm -v "${PWD}:/workspace" -w /workspace/game-runtime -e GAME_RUNTIME_TEST_DATABASE_URL=$env:GAME_RUNTIME_TEST_DATABASE_URL golang:1.22.12-bookworm go test ./internal/persistence -run Postgres -count=1 -v
```

## Expected Validation

Run when Go is installed:

```powershell
cd game-runtime
go test ./...
go test -race ./...
go vet ./...
go test -run '^$' -bench 'BenchmarkRuntimeGameplaySmoke|BenchmarkApplyOnlyRuntimeCommands4Players100' -benchtime=1x -benchmem ./internal/perf ./internal/actor
go run ./cmd/runtime-bench -games=10 -iterations=1 -transport=actor -fail-on-gate -output=runtime-bench-smoke.json
```
