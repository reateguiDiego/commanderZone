# Gameplay Performance Baseline

This baseline measures the current gameplay architecture without changing functional behavior.

It records per-command metrics for both HTTP fallback commands and WebSocket gameplay commands:

- `command.type`
- `gameId`
- `snapshot_load_ms`
- `normalize_ms`
- `command_apply_ms`
- `persist_ms`
- `projection_ms`
- `patch_build_ms`
- `total_server_ms`
- `snapshot_bytes_before`
- `snapshot_bytes_after`
- `patch_bytes`
- `memory_peak_bytes`
- `number_of_players`
- `number_of_instances`
- `number_of_visible_cards`
- `resync_required`
- `clientActionId_duplicate`
- `cpu_user_ms`
- `cpu_system_ms`

## Command

Run the backend test suite first:

```powershell
cd backend
$env:APP_ENV = "test"
php bin/phpunit
```

Run the reproducible baseline:

```powershell
cd backend
$env:APP_ENV = "test"
php bin/console app:gameplay:baseline --iterations=3 --output=..\docs\gameplay-performance-baseline.latest.json --raw-output=var\log\gameplay-performance-baseline.ndjson
```

Run only selected scenarios:

```powershell
cd backend
$env:APP_ENV = "test"
php bin/console app:gameplay:baseline --iterations=1 --scenario=http_draw_1 --scenario=ws_draw_1 --format=json
```

## Scenarios

- `snapshot_bootstrap`
- `http_draw_1`
- `ws_draw_1`
- `ws_draw_7`
- `ws_draw_many_20`
- `ws_reveal_top_1`
- `ws_reveal_top_10`
- `ws_reorder_top_10`
- `ws_zone_move_all`
- `ws_create_20_tokens`
- `ws_drag_positions_repeated`
- `ws_duplicate_client_action`
- `ws_simultaneous_conflict`
- `snapshot_disconnect_reconnect`

## Report shape

The JSON report groups raw metrics by scenario and includes a summary with averages, p95 latency, patch size, memory peak, CPU time, duplicates, and resync counts.

The NDJSON file contains one raw metric line per recorded command so before/after comparisons can use the same command-level dataset across phases.

Sample outputs generated from the current implementation:

- [gameplay-performance-baseline-sample.json](C:/Users/Diego/Dev/commanderZone/docs/gameplay-performance-baseline-sample.json)
- [gameplay-performance-baseline-sample.ndjson](C:/Users/Diego/Dev/commanderZone/backend/var/log/gameplay-performance-baseline-sample.ndjson)
