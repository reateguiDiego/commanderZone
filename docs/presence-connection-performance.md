# Presence, connections and community diagnostics — 2026-09-13

Follow-up: card maintenance and the persistent-connection trial completed on
2026-09-14. The trial passed the 50-user gates; see
[the current results and configurable implementation](persistent-database-connections.md).
The pending actions below describe the original diagnostic patch.

## Production findings

The 50-user navigation run `czlt-20260913-165245` completed but failed its
latency thresholds. The supplied SQL snapshots show 31,014 additional activity
updates, 62,036 room-presence lookups in the final cumulative snapshot and
31,071 `SET NAMES` executions. The old activity subscriber ran two presence
lookups and an ORM flush per authenticated request. Repeated `SET NAMES` is
consistent with per-request connection initialization, but is not a direct
measurement of connection establishment time or PostgreSQL CPU.

## Code changes

Activity refreshes are spaced by 30 seconds per user. Fresh requests already
inside that interval do no activity SQL. A due refresh uses a compare-and-set
UPDATE against the timestamp loaded by authentication, so a stale request
cannot overwrite a concurrent refresh or explicit offline action. Doctrine is
refreshed after the attempt before the controller runs; no unrelated pending
controller changes are flushed by the activity subscriber.

An offline or expired user reconnects immediately. Only that transition needs
the current room status and a friend event. An online heartbeat does not query
rooms. Existing room lifecycle events continue to handle game transitions.
Subrequests and the existing explicit offline/room-presence exclusions do not
write activity. No cross-process in-memory cache is used as the authority.

The five-minute presence threshold is unchanged. Because the persisted
timestamp can lag activity by up to 30 seconds, inactivity classification may
occur up to 30 seconds earlier than with per-request writes. Explicit offline
and reconnect remain immediate. Other consumers of `last_seen_at`, including
room inactivity processing, share this bounded timestamp granularity.

Connection attempts now produce `db_connection_count`,
`db_connection_duration_ms` and `db_failed_connections`, separate from SQL
execution metrics, including failed attempts. Parameters and exception text are
not logged by this instrumentation. Metrics reset between main requests.

The classic PHP entry point also records `php_bootstrap_ms` (entry to
`kernel.request`) and `php_to_response_ms` (entry to `kernel.response`). These
exclude waiting for a PHP thread, network time, body transmission and terminate
listeners. They are null when no entry timestamp is available. A future worker
runtime must set the entry marker separately for each handled request.

## Load-test measurements

Both runners capture PHP thread occupancy from the local admin endpoint inside
the API container. Only aggregate counts are retained, never current request
URIs. `queueDepth` is null when Prometheus metrics are unavailable: busy threads
alone must not be reported as measured queue duration. No metrics listener or
thread setting is enabled by these changes.

Linux normalized samples now retain Docker statistics instead of an empty
array. PostgreSQL session counts and reset timestamps are captured alongside
existing counters. Session deltas include the collector's own connections and
background services; they are not exclusively application requests.

SQL before/after snapshots contain all statement entries for the target
database, complete query text and string query IDs to preserve 64-bit precision.
Live snapshots keep only the top 25 entries and are marked incomplete. The new
object format replaces the old bare array; read its `statements` field.

`node scripts/sql-load-delta.mjs REPORT_DIRECTORY` writes
`pg-stat-statements-delta.json` and prints a ranking by additional execution
time. Both runners also write `sql-delta-summary.txt` automatically. The tool
rejects incomplete/legacy snapshots, global resets, changed eviction counts,
disappearing entries and decreasing counters. Do not selectively reset SQL
statistics during a run. New queries get a zero baseline only when full,
compatible snapshots establish their absence. SQL execution time is not CPU
time, and setup/ramp/background/collector work remains included in this delta.

## Actual production community plans

Read-only SSH diagnostics against deployed commit `16df31d9` found:

- Both community indexes valid.
- Cards: sequential scan, 445,522 eligible rows, 194,610 shared blocks read and
  5,038 ms execution in that diagnostic run.
- Commanders: index-only scan but 27,749 heap fetches, 23,894 shared blocks read
  and 2,369 ms execution.
- `pg_class`: 457,178 estimated tuples, 208,865 pages, 138,686 all-visible pages
  (66.40%). `pg_stat_user_tables` reported approximately 60,170 dead tuples.

These are individual diagnostic measurements without cache flushing, not load
p95 figures. Local diagnostics used index-only scans and took approximately
289/28 ms while the backend test suite was running. The production evidence
supports reviewing vacuum/analyze maintenance rather than adding another index
or globally disabling sequential scans. No production configuration or data
was changed by these diagnostics.

The next operational check is a standard `VACUUM (ANALYZE) public.card` in an
appropriate maintenance window, then repeat the plans. This is **not**
`VACUUM FULL`; it needs no restart but consumes I/O and CPU. Long-running
transactions may prevent complete cleanup. This maintenance has not been
executed as part of the code patch.

After deployment, export the exact current query plans with:

```bash
docker compose --env-file .env.prod \
  -f docker-compose.yml -f docker-compose.prod.yml \
  exec -T api php bin/console app:community:explain-previews --analyze --no-debug \
  > reports/community-preview-plans.json
```

Without `--analyze`, the command only explains the queries. With it, each query
has a 10-second statement timeout and one-second lock timeout. All diagnostics
run in a read-only transaction which is rolled back. A timeout fails the command
instead of pretending that a partial report is complete.

Retain two PHP threads for the next comparison. Deploy this code through the
normal release process, collect the plans, then repeat only the 50-user
navigation phase with the existing gates. Compare activity writes, room checks,
connection duration/count, PHP execution time, thread occupancy, SQL deltas and
client latency before deciding on persistent connections or more threads.

## Validation — 2026-09-14

- Full backend suite: 1,318 tests, 14,746 assertions, no failures or errors.
  PHPUnit reported 13 deprecations and 79 notices, matching the previous suite.
- Final focused backend run: seven tests and 71 assertions passed, covering
  presence concurrency and SQL budget, connection metrics, the double inclusion
  of the PHP entry point and read-only community diagnostics. This includes the
  tests added after the full suite started.
- Node load gates and SQL delta tests: seven passing tests, including missing
  metrics, PostgreSQL resets/evictions and preservation of 64-bit query IDs.
- Bash syntax, PowerShell parsing and PHP collector syntax checks passed.
- A local production-mode HTTP request returned 200 and emitted separate
  connection, SQL, bootstrap and PHP-to-response timings. This verifies the
  instrumentation, not production capacity.
- Production diagnostics were read-only. Deployment, card maintenance and the
  next 50-user comparison remain operational follow-ups; no latency improvement
  under production load is claimed for this patch yet.
