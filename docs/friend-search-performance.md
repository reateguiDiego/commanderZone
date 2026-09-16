# Friend search and presence

`GET /friends/search` uses one scalar DQL query with a left join on the unique
normalized `friendship.relation_key`. It retains the existing public response,
alphabetical ordering, eight-result limit, and viewer/reserved-account exclusions.
`GET /friends` fetches both friendship users eagerly and resolves presence in one
batch. The activity subscriber also performs two fixed presence queries for the
viewer; these are not per-friend queries.

`FriendsApiTest::testSearchAndPresenceHaveBoundedQueries` clears the identity map
and records real DBAL queries for authenticated requests with ten matches and
four active accepted friends. It caps total request queries at eight for search
and nine for listing, and checks that search has one friendship left join and
listing has exactly three room presence queries (two viewer, one friend batch).

## PostgreSQL plan verification

Migration `Version20260911120000` adds a functional GIN index on
`LOWER(app_user.display_name)`, reusing `pg_trgm`. Rollback removes only the index.
`FriendSearchPlanTest` uses 100,000 session-local synthetic users and runs
`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` without disabling sequential scans.
Set `FRIEND_SEARCH_EXPLAIN_OUTPUT` to retain the complete plans.

Local PostgreSQL 16 verification on 2026-09-11:

| Pattern | Execution time | Observation |
| --- | ---: | --- |
| `%ab%` | 53.26 ms | Two-character pattern |
| `%player%` | 58.45 ms | Matches every fixture row |
| `%abc123%` | 0.19 ms | Trigram index used |
| `%zznomatchzz%` | 0.06 ms | Trigram index used; no matches |

These are single local plan measurements, not HTTP latency guarantees. Short or
broad patterns can still require scanning many rows. The test asserts index use
only for selective patterns, without assuming every substring benefits equally.

## Concurrent navigation benchmark

`load-tests/commanderzone-navigation.k6.js` now sends a parallel `http.batch` of
four friend searches per navigation iteration, concurrently across VUs. Defaults
`es,test,test01,zznomatchzz` exercise short, broad, selective and absent terms
against the existing `test01`–`test500` fixture. Override with comma-separated
`FRIEND_SEARCH_TERMS` for another dataset. Metrics carry `endpoint=friends_search`
and `selectivity=0..3` tags and remain subject to the light-read latency budget.
Each response is checked for success and the eight-result cap.

Run using the existing navigation benchmark workflow in
[web-sql-performance-baseline.md](web-sql-performance-baseline.md). Script syntax
was verified; the concurrent HTTP load run was not executed in this task.

## Validation result

All seven friend API / search-plan tests pass on the final changes. The full
backend run completed 1,297 tests with 13,897 assertions, one failure, 13 PHPUnit
deprecations and 79 PHPUnit notices. The failure is
`RoomsGamesApiTest::testRoomGameCommandEventsAndAccessControl` at line 3374: a
finished room remains in `/rooms?status=all`. It reproduces in an isolated rerun;
the seven friend tests still pass in that same rerun. Room-list code was not
changed by this task. The migration was applied successfully in the test database.
