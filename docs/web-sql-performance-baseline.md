# Web/SQL performance baseline

## Purpose and scope

This baseline covers authenticated browser-like reads, independently from gameplay and websocket traffic. It is a reproducible worksheet: measured values must be copied from `reports/load-tests/<run>/users-<n>` and must never be invented.

## Dataset

* Accounts: `test01@test.com` through `test500@test.com`, prepared by `scripts/seed-load-test-users.sql`; passwords are supplied only through the environment.
* Every account has the existing seeded Commander deck and may already have folders, friends, messages, or room history.
* Record PostgreSQL row counts and database size before each comparison. Keep the same anonymized production snapshot for “before” and “after”.
* Navigation runs do not create rooms or games. Set `CONTROL_USERS` only to reserve the first accounts for a separately executed gameplay control run.

## Navigation mix

Each iteration makes one authenticated `GET` to `/me`, `/rooms`, `/rooms/current`, `/decks`, `/deck-folders`, `/friends`, `/messages`, `/community`, and `/community/decks`, then a concurrent batch of `/friends/search` requests, followed by configurable think time. `FRIEND_SEARCH_TERMS` defaults to `es,test,test01,zznomatchzz` for short, broad, selective, and absent terms. Endpoint and `traffic_type` tags remain stable so throughput, error rate, response bytes, and p50/p95/p99 can be compared independently; searches also carry a `selectivity` index tag. See [friend-search-performance.md](friend-search-performance.md) for query-count and PostgreSQL plan evidence.

## Configuration

Run the controlled ramp and stable hold at 50, 100, 280, and 500 users:

```bash
LOAD_TEST_USER_PASSWORD='<secret>' bash scripts/run-production-load-test.sh \
  --all-phases --scenario navigation --duration-minutes 10 \
  --api-base-url https://api.commanderzone.com --confirm-production
```

The default ramp is one minute up, ten minutes stable, and one minute down. Light reads have initial budgets of p95 < 500 ms, p99 < 1 s, and errors < 1%. Deck-analysis traffic is tagged separately and uses p95 < 1.5 s and p99 < 3 s; it is not part of this navigation mix.

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
