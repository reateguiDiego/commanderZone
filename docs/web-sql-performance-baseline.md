# Web/SQL performance baseline

## Purpose and scope

This baseline covers authenticated browser-like reads, independently from gameplay and websocket traffic. It is a reproducible worksheet: measured values must be copied from `reports/load-tests/<run>/users-<n>` and must never be invented.

## Dataset

* Accounts: `test01@test.com` through `test500@test.com`, prepared by `scripts/seed-load-test-users.sql`; passwords are supplied only through the environment.
* Every account has the existing seeded Commander deck and may already have folders, friends, messages, or room history.
* The dedicated [owned-deck volume benchmark](owned-deck-list-performance.md) adds an isolated 1,000-deck / 100,000-card account fixture and records controller p95, query count, SQL rows, ORM hydration, payload bytes and before/after index plans. Run it alongside the navigation baseline; its timings exclude HTTP transport/authentication.
* Record PostgreSQL row counts and database size before each comparison. Keep the same anonymized production snapshot for “before” and “after”.
* Navigation runs do not create rooms or games. Set `CONTROL_USERS` only to reserve the first accounts for a separately executed gameplay control run.

## Navigation mix

`NAVIGATION_MIX=navigation` reads `/me`, `/rooms`, `/rooms/current`, `/decks`, `/decks/summary`, `/deck-folders`, `/friends/summary`, `/messages/summary`, `/community` and `/community/decks`. `panels` additionally opens friend/message bodies and searches friends. `basic`, `advanced` and `bracket` isolate the analysis endpoints; `mixed` assigns 80% navigation, 10% basic and 10% advanced users. Use at least ten users for this mix so every traffic type is exercised.

`ANALYSIS_STATE=warm` precomputes analysis snapshots in setup. `cold` requires `ANALYSIS_FIXTURES`, a JSON array in account order with `{ "deckIds": ["uuid", ...] }` per account. Each cold iteration consumes one distinct, unanalysed deck. Missing fixtures or unexpected snapshot hits fail the run. Cold runs use one analysis kind and bounded iterations; they do not model mixed traffic.

Metrics distinguish endpoint, traffic type, ramp/stable phase and snapshot state. Every expected stable endpoint must have samples. Warm snapshot budgets are p95 < 500 ms and p99 < 1 s; cold calculations have p95 < 1.5 s and p99 < 3 s. These are acceptance targets, not measured capacity.

## Configuration

Run the controlled ramp and stable hold at 50, 100, 280, and 500 users:

```bash
LOAD_TEST_USER_PASSWORD='<secret>' bash scripts/run-production-load-test.sh \
  --all-phases --scenario navigation --duration-minutes 10 \
  --api-base-url https://api.commanderzone.com --confirm-production
```

The default ramp is one minute up, ten minutes stable, and one minute down. Light reads have initial budgets of p95 < 500 ms, p99 < 1 s, and errors < 1%. Select the analysis or mixed profiles explicitly with `NAVIGATION_MIX`.

The deterministic CI smoke uses five users and two iterations:

```bash
USER_PASSWORD='<ci-secret>' API_BASE_URL=http://127.0.0.1:8000 scripts/run-navigation-load-smoke.sh
```

The 500-user phase is manual/scheduled only and must not run in per-change CI.

## Database and application evidence

The runners capture before/after Docker resource data, `pg_stat_database` (including temporary files/bytes), grouped `pg_stat_activity`, wait events, pool use versus `max_connections`, locks, and the top 25 `pg_stat_statements` entries when the extension is available. Symfony emits `http_request_completed` with request ID, route, total duration, accumulated SQL fields, response rows, and serialized bytes; query strings, request bodies, authentication headers, and SQL parameters are excluded.

## Dominant queries and results

Fill one row from each k6 summary and PostgreSQL snapshot. Rank dominant SQL by `total_exec_time`, then validate high-call/mean-time outliers with `EXPLAIN (ANALYZE, BUFFERS)` only on a safe clone.

| Version | Users | Endpoint / query ID | req/s or calls | errors | p50 | p95 | p99 | response bytes / SQL rows | temp bytes | notes |
|---|---:|---|---:|---:|---:|---:|---:|---:|---:|---|
| before | 50 | _pending measurement_ | — | — | — | — | — | — | — | — |
| before | 100 | _pending measurement_ | — | — | — | — | — | — | — | — |
| before | 280 | _pending measurement_ | — | — | — | — | — | — | — | — |
| before | 500 | _pending manual run_ | — | — | — | — | — | — | — | — |
| after | 50/100/280/500 | _pending measurement_ | — | — | — | — | — | — | — | compare identical dataset/config |

A change is accepted only when all light-read budgets pass, errors stay below 1%, no deadlocks or container restarts appear, and throughput does not regress materially at the same concurrency. Preserve raw reports with the commit identifiers for both runs.

## Implementation and local validation, September 2026

The continuation adds bounded frontend deck pagination, server-side filters and catalog summary counts; analysis request deduplication; PostgreSQL advisory locks around cold analysis; snapshot rechecks after calculation; optional-section hashing; batched version reads; and analysis-stage/SQL-error/peak-memory metrics. Public community lists no longer compute missing bracket labels during reads. The dedicated tag-aware cache invalidates after deck edits, likes, copies and basic snapshot writes.

The advanced simulator precomputes card flags and avoids constructing gameplay visibility state for internal draws. An unchanged 10,000-run reference fixture produced exactly the same result before/after. A local single-process comparison measured 2255.3651 ms before and 1342.6341 ms after (about 40% less time). This is one simulator fixture, not endpoint p95 or a production guarantee.

The production runners use k6 2.1.0 and a Node 22 supervisor. Missing critical database/runtime/restart metrics fail preflight; new deadlocks, runtime saturation and restarts stop the run. Sustained HTTP errors/latency, connection pressure and waiting locks stop subsequent phases. Raw HTTP samples, periodic server snapshots and watchdog decisions are preserved. PHP worker/queue metrics remain explicitly unavailable where the collector cannot obtain them; a complete PHP capacity assessment is still pending.

Local validation completed: frontend 275 files / 2635 tests; production build (existing stylesheet budget warnings); backend 1309 tests / 14661 assertions, no failures, with 13 PHPUnit deprecations and 79 notices. The follow-up backend selection passed 46 tests / 572 assertions, including post-calculation mutation and social cache invalidation. The header navigation E2E passed against the current source API on an isolated test database; an earlier attempt timed out waiting for the cold community page, so this is not evidence of cold-page latency compliance. The local five-user navigation smoke completed all ten iterations but failed latency budgets using the Windows single-process PHP development server and an isolated database containing 445,076 public card records. This result must not be presented as passing capacity validation. Local k6 used the already available image reporting version 2.1.0; fetching the pinned tag failed at the registry.

## Remaining acceptance work

* Execute the CI smoke on the Linux multiworker test server and retain its report.
* Run equal-dataset before/after profiles at 50, 100, 280 and 500 users, including cold/warm basic, advanced, bracket, mixed traffic and a gameplay control. Record deployed commits explicitly.
* Capture dominant query plans, PHP workers/queue, connection budgets and cache topology from the target environment. Validate shared cache/locking across replicas; filesystem cache only provides sharing within the filesystem actually mounted. Analysis advisory locks require PostgreSQL session affinity (direct connections or session pooling); transaction pooling has not been validated.
* Validate cold-analysis waiting/retry behavior and budgets with real concurrent HTTP requests. The integration lock test alone does not establish production throughput.
* No deployment, production load run or infrastructure tuning was performed in this implementation phase.
