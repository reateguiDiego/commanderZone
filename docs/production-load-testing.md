# Production Load Testing

Use the seeded `test01@test.com` through `test500@test.com` accounts to run
controlled CommanderZone production load phases.

The load test keeps the product scope as a manual Commander table. It uses the
existing rooms, decks, game start, runtime WebSocket ticket, and runtime command
flows.

## Command From Windows

```powershell
$env:LOAD_TEST_USER_PASSWORD = "<seeded-user-password>"
powershell -ExecutionPolicy Bypass -File .\scripts\run-production-load-test.ps1 `
  -Users 100 `
  -ApiBaseUrl https://api.commanderzone.com `
  -ProductionHost <ssh-host> `
  -ProductionPath /opt/commanderZone `
  -ConfirmProduction
```

## Command Directly On The Linux Server

Run this from the production checkout, for example `/opt/commanderZone`:

```bash
cd /opt/commanderZone
export LOAD_TEST_USER_PASSWORD="<seeded-user-password>"
bash scripts/run-production-load-test.sh \
  --users 100 \
  --api-base-url https://api.commanderzone.com \
  --production-path /opt/commanderZone \
  --confirm-production
```

Run phases manually one by one:

```bash
bash scripts/run-production-load-test.sh --users 100 --api-base-url https://api.commanderzone.com --production-path /opt/commanderZone --confirm-production
bash scripts/run-production-load-test.sh --users 280 --api-base-url https://api.commanderzone.com --production-path /opt/commanderZone --confirm-production
bash scripts/run-production-load-test.sh --users 500 --api-base-url https://api.commanderzone.com --production-path /opt/commanderZone --confirm-production
```

Allowed phases:

- PowerShell: `-Users 100`, `-Users 280`, `-Users 500`, or `-AllPhases`.
- Linux Bash: `--users 100`, `--users 280`, `--users 500`, or `--all-phases`.
- `100`: 25 games with 4 connected users each.
- `280`: 70 games with 4 connected users each.
- `500`: 125 games with 4 connected users each.

Local validation:

```powershell
$env:LOAD_TEST_USER_PASSWORD = "<seeded-user-password>"
powershell -ExecutionPolicy Bypass -File .\scripts\run-production-load-test.ps1 `
  -Users 100 `
  -ApiBaseUrl http://127.0.0.1:8000 `
  -LocalDryRun
```

`-LocalDryRun` uses 4 active users for 30 seconds while preserving selected
phase metadata.

## Server Metrics

The PowerShell runner captures server metrics through SSH when `-ProductionHost`
is provided. The Linux runner captures the same metrics directly on the
production server through `--production-path`.

Both runners capture:

- `docker stats` and `docker inspect` for `api`, `websocket`, `game-runtime`,
  and `database`;
- Go runtime `/metrics`;
- PostgreSQL activity, lock, transaction, deadlock, temp-file, and DB-size
  counters.

Reports are written under:

```text
reports/load-tests/<run-id>/users-<phase>/
```

Important files:

- `summary.md`: operator summary and server gate result.
- `k6-summary.md`: k6 threshold and client-side metrics summary.
- `k6-summary.json`: full k6 summary.
- `server-metrics-before.json`: server snapshot before the phase.
- `server-metrics-after.json`: server snapshot after the phase.
- `server-metrics-delta.json`: numeric deltas and restart deltas.
- `manifest.json`: users, rooms, games, and run metadata produced by k6.

## Critical Gates

The k6 thresholds fail the run when:

- HTTP error rate is at least `1%`;
- WebSocket command error rate is at least `1%`;
- WebSocket command resync rate is at least `0.5%`;
- WebSocket command ack p95 is at least `750ms`;
- WebSocket command ack p99 is at least `2000ms`;
- WebSocket connect p95 is at least `1500ms`;
- setup or cleanup failure rate is non-zero.

The wrapper also fails when server deltas show container restarts, runtime queue
full or unsupported-command counters, runtime ownership rejects, PostgreSQL
deadlocks, or waiting lock growth.
