# Community preview performance correction — 2026-09-13

The controlled production navigation run stopped at 50 users. Two cold
`community.home.compute` samples took 8,659 and 7,474 ms, almost entirely SQL.
A cache hit took 5,487 ms overall but only 39 ms SQL. The old hit marker did not
measure the cache lookup, so it could not establish how much time was spent
waiting for another process. Other routes had much higher client latency than
their measured application duration; this correction does not by itself prove
that all request queuing is resolved.

## Change

`CommunityCardPreviewSql` materializes the randomly selected IDs before joining
the card payload. Both home previews and top-card/commander previews use it.
The selection remains random across eligible printings, with the existing
filters, limits, localization and response fields. No approximate sampling or
change in commander eligibility is introduced.

Migration `Version20260913130000` creates two partial indexes on `card(id)`:
Commander-legal printings, and the narrower commander-candidate predicate.
The latter freezes the current predicate in the migration. A future eligibility
change must review that index as well as `CommanderCandidateSql`.

The migration is nontransactional and uses `CREATE INDEX CONCURRENTLY`. It must
not be wrapped in an all-or-nothing migration transaction. Apply it through the
normal release migration process before evaluating performance. If interrupted,
inspect the two indexes and their `indisvalid` state before retrying; an existing
or invalid index must not be silently treated as a successful migration.

`community.<family>.lookup` now measures the complete cache get, including
waiting, deserialization and any computation. `compute` remains nested inside
that stage. Do not add the two durations together. `hit`/`miss` are outcome
markers, not measurements of cache access time. Failed calculations also retain
lookup and compute timing.

## Local measurement

PostgreSQL 16 in local Docker, 445,178 card rows, 434,035 legal printings and
44,850 commander candidates. `EXPLAIN (ANALYZE, BUFFERS)` used default planner
settings. The initial old queries took 13,082 ms (cards) and 726 ms (commanders)
and scanned the wide card table. This first run is not used as a fair warm-cache
speedup comparison.

After migration, three interleaved runs of each old/new query on the same
database, with `LIMIT 3`, gave the following execution times. The old queries
also had access to the new indexes during this comparison.

| Query | Old runs (ms) | New runs (ms) | Median old → new |
| --- | --- | --- | --- |
| Legal cards | 1,061 / 638 / 665 | 133 / 149 / 118 | 665 → 133 ms |
| Commanders | 306 / 135 / 127 | 14 / 20 / 12 | 135 → 14 ms |

The new plans use `Index Only Scan` for candidate IDs and three primary-key
lookups for payloads. Candidate sort width drops from 798 to 45 bytes. The first
new plans had 13 and 2 heap fetches respectively; visibility-map maintenance
and catalog churn can affect index-only scan performance. Random selection
still visits all eligible index entries, so its cost is not constant as the
catalog grows. Cache reuse remains necessary.

Both indexes were valid after applying, reverting and reapplying the migration
locally. Their sizes were 24 MB (legal cards) and 2,608 kB (commanders).

These are local single-query measurements, not production p95 figures. Raw local
plans are in ignored `reports/community-preview-before.txt`,
`reports/community-preview-after.txt` and `reports/community-preview-comparison.txt`.

## Validation and next controlled run

Backend integration coverage checks eligibility, distinct IDs, limits, bound
filters, payload hydration, localization and the existing API response. Cache
tests cover a delayed hit, failed calculation timing and sharing one cold
calculation across independent processes.

Validation completed: `APP_ENV=test php bin/phpunit` ran 1,313 tests and 14,681
assertions in 22m11s with no failures or errors (exit 0). PHPUnit reported 13
deprecations and 79 notices, matching the previously recorded totals. The five
load-test gate tests also passed. Local migration up/down/up succeeded.

After deploying the code and migration, repeat the same 50-user navigation
phase with its existing stop gates. Compare cold `compute`, complete `lookup`,
HTTP p95/p99 and application duration over the same time window. Inspect the
new query plans with `EXPLAIN (ANALYZE, BUFFERS)` during a quiet period. Do not
raise the latency gates to make the run pass. Progress to 100/280/500 only after
the previous phase passes. Basic and advanced deck-analysis scenarios remain
separate checks; faster community previews do not establish their capacity.
