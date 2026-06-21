# CommanderZone Game Runtime

This is a minimal Go skeleton for the future active gameplay runtime.

The service is intentionally not wired into Docker, Symfony, or CI yet. It exists to pin down package boundaries, V2 protocol types, actor interfaces, and persistence contracts before migrating commands.

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

## Expected Validation

Run when Go is installed:

```powershell
cd game-runtime
go test ./...
```
