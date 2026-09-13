# Room browser query, 2026-09-11

`RoomListQuery` uses DBAL scalar rows. `active` means waiting without a game;
`all` additionally includes the viewer's owned/joined started rooms with an active
game. Archived rooms, finished games and unrelated started rooms are excluded.
Finished means the durable `game.status` after lifecycle projection; the query
does not inspect gameplay snapshots or infer closure from conceded players.
Private waiting cards remain discoverable, with the host and other players masked
for non-owners. Full decks, logs, game snapshots and account data are not loaded.

The response retains `data`, room settings and the player array, with compact
profiles and an additional `nextCursor`. Deck payloads, logs and timestamps are
omitted. Clients needing room details must use `GET /rooms/{id}`. Limits are 1–100
(default 50). Cursor keys are version, viewer, status, rank, name and ID. Ordering
uses PostgreSQL C collation, avoiding locale-dependent pagination boundaries.
The browser retains server order, deduplicates appended pages and periodically
refreshes the first page. Local browser filters/counts apply to loaded cards.
Concurrent name/occupancy/status changes can move rows across a cursor; this is
live keyset pagination, not snapshot isolation.

## Measurement

Run from `backend` with `APP_ENV=test`:

```powershell
$env:APP_ENV = 'test'
$env:ROOM_LIST_EXPLAIN_OUTPUT = 'var/room-list-explain.json'
php bin/phpunit --filter RoomListQueryLoadTest
```

The test uses PostgreSQL session-local tables and the actual `pageSql()`;
it never inserts load fixtures into persistent application tables. The synthetic
fixture has 1,000 waiting rooms, 3,000 players, public/private and full/open rooms,
plus 100,000 and 1,000,000 historical rooms (80% archived, 20% unrelated started,
linked to finished games).
This is an explicit workload assumption, not a claim about measured production
traffic or distribution. It uses the local PostgreSQL 16 database.

Recorded `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)`:

| Historical rooms | Filter | Index | Execution ms | Local hit + read blocks |
| ---: | --- | --- | ---: | ---: |
| 100,000 | active | before | 20.70 | 7,347 |
| 100,000 | active | partial waiting | 5.42 | 5,034 |
| 100,000 | all | partial waiting | 7.05 | 5,060 |
| 1,000,000 | active | partial waiting | 7.21 | 5,056 |
| 1,000,000 | all | partial waiting | 5.99 | 5,083 |

Full plans are in `room-list-explain.json`. The load test checks actual index use,
less buffer work than the unindexed plan, 51 output rows (50 + lookahead), and
less than 3x buffer growth with 10x history. Buffer checks are more stable than
wall-clock thresholds under shared CPU and cache conditions.

The migration adds `(visibility, name COLLATE "C", id)` only for waiting rooms
without games. The plan uses it to restrict the eligible set before occupancy
probes. Existing owner and room-player indexes service membership and counts.
No additional owner/status index was justified by these measured plans.
The partial index does **not** eliminate sorting: occupancy changes the rank and
cannot be an ordinary index expression across tables. Work remains proportional
to eligible waiting rooms (and the viewer's memberships in `all`), not constant
under arbitrary growth in active rooms or one user's own history. A persisted
occupancy/rank would require a separate write-side consistency design.

## Validation environment

The migration was exercised up/down/up in the local test database. The full
frontend suite passed (271 files, 2,622 tests), and `npm run build` succeeded
with existing stylesheet budget warnings. OpenAPI parses successfully.

The full backend run completed 1,295 tests / 13,842 assertions with one failure
in the former list expectation, 13 PHPUnit deprecations and 79 PHPUnit notices.
After updating that expectation to the explicit active/all contract, the final
focused run passed all 5 tests / 282 assertions, including that scenario and
the new query coverage. The separate load regression passed 6 assertions.
The complete backend suite was not repeated after the test expectation update.

The three existing public/private room browser E2Es were attempted, but the
Docker API on port 8000 failed at user registration, before reaching rooms:
its SQL still references the removed `app_user.roles` column. This E2E run
therefore does not validate the changed list. Local PHP integration tests use
the current checkout. Two missing user preference columns were added only in
the test database; the ordinary pending migration sequence already encounters
a duplicate `game_runtime_stop_queue` table.
