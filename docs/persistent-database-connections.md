# Persistent PostgreSQL connections

## Production reference: 50 navigation users, 2026-09-14

Both runs used two PHP threads and the same approximately one-CPU API/database
limits. The card table had already been vacuumed/analyzed. These results were
reported from production; no 100-user or deck-analysis capacity claim follows.

| Metric | Non-persistent | Temporary persistent PDO |
| --- | --- | --- |
| Report | `czlt-20260914-063030/users-50` | `czlt-20260914-072245/users-50` |
| Duration | 12 minutes | 12 minutes |
| Completed iterations | 3,635 | 12,002 |
| Interrupted iterations | 0 | 0 |
| Gates | failed, exit 99 | passed, exit 0 |
| HTTP p95 by endpoint, stable phase | 1,141–1,216 ms | 273.0–291.7 ms |
| New database sessions between two live samples | 14,015 / 270.19 s | 145 / 279.42 s |
| Database CPU in those samples | 98.27%, 99.94% | 32.65%, 31.91% |
| API CPU in those samples | 56.78%, 49.97% | 101.98%, 98.92% |
| New deadlocks / container restarts | 0 / 0 | 0 / 0 |

Session counts include diagnostics and background services. CPU values are
individual samples, not whole-run averages. Closed-loop iterations increased
3.30 times; this does not establish a 3.30-fold increase in maximum capacity.
The API now reaches its configured CPU budget in the supplied samples.

Stable-phase percentiles extracted read-only from the persistent run's raw
`k6-points.ndjson` (nearest-rank, rounded to 0.1 ms):

| Endpoint | Samples | p50 ms | p95 ms | p99 ms |
| --- | ---: | ---: | ---: | ---: |
| messages_summary | 10,401 | 186.9 | 273.0 | 329.0 |
| me | 10,411 | 182.6 | 280.4 | 335.0 |
| community | 10,400 | 185.9 | 276.2 | 327.0 |
| deck_folders | 10,402 | 188.6 | 277.9 | 330.0 |
| friends_summary | 10,400 | 190.8 | 279.5 | 330.0 |
| decks | 10,411 | 195.6 | 291.7 | 349.2 |
| rooms | 10,408 | 185.3 | 283.1 | 339.5 |
| decks_summary | 10,406 | 187.7 | 279.1 | 337.3 |
| community_decks | 10,400 | 183.4 | 275.8 | 329.3 |
| rooms_current | 10,408 | 188.1 | 283.4 | 339.8 |

## Configuration

The base Compose file enables `DATABASE_PERSISTENT=1` by default for the `api`
service. An explicit `DATABASE_PERSISTENT=0` in the deployment environment
disables it. Doctrine retains a fallback of `0` outside Compose; runtime and
background services retain their existing configuration. Do not enable it for
those services without separate validation.

The production overlay is not tracked in this checkout. Verify that it preserves
the API environment mapping. Merely changing `.env.prod` does not update an
existing container: apply the setting through the normal deployment process.

The earlier experimental file
`config/packages/prod/zz_cz_persistent_trial.yaml` forces persistence on and must
be absent from the final container. Otherwise it overrides the feature flag and
prevents rollback with `DATABASE_PERSISTENT=0`. The deployed image should contain
the repository configuration, not that temporary override.

Rollback: set `DATABASE_PERSISTENT=0`, remove any experimental override, and
recreate the API through the normal deployment process. This closes its pooled
sessions. No migration or PostgreSQL restart is required.

## Session isolation and measurements

`PersistentSessionMiddleware` resets only persistent `pdo_pgsql` connections.
On acquisition it rolls back an outstanding native transaction, executes
`DISCARD ALL`, and restores the configured client encoding. Cleanup failure
fails the acquisition instead of returning a potentially dirty session. The
reset clears session settings, temporary objects, advisory locks and prepared
statements ([PostgreSQL DISCARD documentation](https://www.postgresql.org/docs/16/sql-discard.html)).
It runs before application queries and is included in connection
timing by the outer SQL metrics middleware.

This is per DBAL acquisition, not per SQL statement. The application must not
open two simultaneously active DBAL connections using the same persistent pool:
PDO can return the same native session, and the second acquisition would reset
the first. The current HTTP application uses one default Doctrine connection.
This patch does not enable Symfony/FrankenPHP worker mode.

`db_connection_count` counts DBAL driver acquisitions. It can remain one per
request even when PostgreSQL sessions are reused. Use database session deltas
and acquisition duration to assess reuse; `SET NAMES` counts also do not measure
new physical connections.

The temporary production trial did not include `DISCARD ALL`. Repeat the 50-user
baseline with this final configuration before advancing to 100 users. Keep two
threads, CPU limits, dataset, durations and gates unchanged. Preserve raw k6
points, watchdog, server samples, SQL deltas and API logs. Record exact stable
p50/p95/p99 and check errors, idle transactions, locks and connection reuse.
Then run 100 users as a separate phase; deck and advanced analysis require their
own scenarios. Do not extrapolate navigation results to those calculations.

The load-gate scripts also remove the `Object.groupBy` dependency that caused an
early supervisor abort under Node 18. Continue using the installed Node 22 for
the production load tools.

## Validation — 2026-09-14

- Full backend suite: 1,324 tests, 14,834 assertions, exit 0. The existing 13
  PHPUnit deprecations and 79 notices remain; no test failures or errors.
- Final focused run: five tests and 44 assertions pass without notices. This
  covers the legacy-option test added after the full suite started.
- The PostgreSQL integration test confirms the same backend PID is reused,
  uncommitted work is rolled back, session settings and temporary tables are
  cleared, advisory locks are released and UTF8 encoding is restored.
- HTTP integration covers alternating authenticated users and an anonymous
  request with persistence enabled. Middleware tests cover disabled persistence,
  rollback-before-reset ordering, legacy options and cleanup failure propagation.
- Eight Node tests pass. The updated gate code also passed a read-only stdin
  smoke check on production's Node 18.19.1 without `Object.groupBy`.
- Compose validation and Symfony YAML parsing pass. Five local production-mode
  HTTP requests to the database-backed display-name availability route returned
  200, with connection acquisition/cleanup measured at 1.1–1.6 ms. These local
  timings are not a production load benchmark.
- No deployment, infrastructure change or new load test was executed as part of
  implementing this patch. The successful production reference above used the
  earlier temporary configuration; the final cleanup must be remeasured.
