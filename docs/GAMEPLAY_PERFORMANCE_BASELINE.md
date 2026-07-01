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
- `io.write_bytes`
- `io.write_ops`
- `full_scan_count`
- `actor.queue_depth`
- `position.commands_per_drag`
- `coalesced_position_events`
- `dropped_ephemeral_events`

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

Run the CI-sized smoke gate:

```powershell
cd backend
$env:APP_ENV = "test"
php bin/console app:gameplay:baseline --suite=smoke --iterations=1 --fail-on-regression --output=var\perf\gameplay-smoke.json --raw-output=var\perf\gameplay-smoke.ndjson
```

Run a before/after comparison:

```powershell
cd backend
$env:APP_ENV = "test"
php bin/console app:gameplay:baseline --suite=manual --iterations=3 --compare-to=..\docs\gameplay-performance-baseline.previous.json --output=..\docs\gameplay-performance-baseline.latest.json
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
- `ws_card_tapped`
- `ws_draw_1`
- `ws_draw_7`
- `ws_draw_many_20`
- `ws_reveal_top_1`
- `ws_reveal_top_10`
- `ws_reorder_top_10`
- `ws_cards_moved`
- `ws_zone_move_all`
- `ws_create_20_tokens`
- `ws_drag_final_batch`
- `ws_drag_positions_repeated`
- `ws_duplicate_client_action`
- `ws_simultaneous_conflict`
- `snapshot_disconnect_reconnect`

## Suites

- `smoke`: short CI gate covering a simple card command, draw, reveal, batch move, final drag batch, and reconnect bootstrap.
- `manual`: full scenario suite for local before/after phase comparisons.
- `nightly`: reserved alias for the full suite when wired to a scheduled workflow.

## Gates

The report includes `performanceTargets`, `gate.checks`, `gate.failures`,
`gate.criticalFailures`, and `gate.advisoryFailures`.

Critical gates:

- `resync.rate` < 0.5%.
- `position.commands_per_drag` max <= 1 for the final drag batch scenario.
- `snapshot_full_write_count` max <= 0 when the metric is emitted by V2 paths.
- runtime failure count = 0, including `runtime_failed`.
- runtime fallback count = 0, including `gameplay.runtime_fallback_count`.
- legacy fallback count = 0, including `command.legacy_fallback_count`.
- runtime route records > 0 when `--require-runtime-route` is passed.
- zero `total_server_ms` samples = 0.
- required runtime counters must be present for runtime-routed samples.
- `runtime.initial_state_per_command_count` = 0.
- `command.unsupported_count` = 0.
- `gameplay.runtime_patch_contract_error` = 0.
- runtime hot-path counters = 0 for snapshot load/write, DB lock, legacy handler, emergency fallback, and previous/next projection.

Advisory targets:

- `command.apply_ms` simple p95 < 2 ms.
- `command.total_server_ms` simple p95 < 15 ms.
- `patch.bytes` simple max < 1 KB.
- `event.append_ms` p95 < 8 ms, currently measured from `event_append_ms` when present and `persist_ms` as fallback.
- `full_scan_count` max <= 0, currently advisory until all smoke commands are migrated to V2.

`--fail-on-regression` returns a non-zero exit code only for critical failures.
`--strict-targets` also fails advisory latency/payload targets.

## Report shape

The JSON report groups raw metrics by scenario and includes a summary with averages, p95 latency, patch size, memory peak, CPU time, IO write proxy, queue depth, duplicates, and resync counts.

The NDJSON file contains one raw metric line per recorded command so before/after comparisons can use the same command-level dataset across phases.

The JSON report also includes `comparison` when `--compare-to` is provided. Deltas cover p95 server time, patch size, memory peak, IO write bytes, and resync count.

Sample outputs generated from the current implementation:

- [gameplay-performance-baseline-sample.json](C:/Users/Diego/Dev/commanderZone/docs/gameplay-performance-baseline-sample.json)
- [gameplay-performance-baseline-sample.ndjson](C:/Users/Diego/Dev/commanderZone/backend/var/log/gameplay-performance-baseline-sample.ndjson)
