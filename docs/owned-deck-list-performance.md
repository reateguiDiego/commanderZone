# Owned deck list: bounded reads

`GET /decks` uses `OwnedDeckListQuery` and returns `{data, nextCursor}`. The default page size is 50, maximum 100. Ordering is `updated_at DESC, id DESC`; the cursor uses both values and is scoped to the owner and folder filter. Omit `folderId` for all decks, or use `folderId=null` / an empty value for unfiled decks. A missing or foreign folder returns 404. Invalid limits and cursors return 400. Concurrent updates may move a deck ahead of a cursor; pagination is not a snapshot.

The page is selected before enrichment. Commander cards are selected in one scalar query restricted to page IDs and the commander section. There is no `Deck::toArray()` call, no full deck collection loading, and no entity hydration. Card face normalization is shared with the existing card serializer. Commander localization and canonical type lookup each run once for the whole page.

`DeckBracketLabelProvider::labelsByDeckIds()` receives only page IDs with `calculateMissing=false`. Its single `IN` query picks the latest fresh snapshot per deck. Missing or stale brackets are `null`; the existing analysis endpoint still calculates them. Tests cover populated and stale snapshots and constrain both queries and returned SQL rows.

The frontend exposes `listPage()` for explicit cursor use. Existing `list()` consumers follow cursors sequentially and still receive the complete collection, preserving deck/folder and room selectors. Thus each HTTP response is bounded, while the total work of those existing selectors remains proportional to the user's collection.

## Reproducible local benchmark

From `backend`:

```powershell
php bin/benchmark-owned-deck-list.php --decks=1000 --iterations=30 --output=../docs/owned-deck-list-benchmark.json
```

The benchmark creates an isolated account representation with 1,000 decks and 100,000 deck-card rows in PostgreSQL session-local temporary tables. Half the decks have commanders; commanders include shared and distinct cards. Fixture tables are dropped in `finally`. It measures the real controller, localization, SQL and JSON serialization, excluding authentication and network transport. One warm-up precedes 30 samples per page size. No real user data is modified.

Measured locally on 2026-09-11, PostgreSQL 16 / PHP 8.4, debug test kernel:

| Page size | p95 ms | Max queries | SQL rows returned | ORM entities hydrated | Payload bytes |
|---:|---:|---:|---:|---:|---:|
| 1 | 5.49 | 3 | 2 | 0 | 561 |
| 50 | 33.51 | 19 | 226 | 0 | 33,634 |
| 100 | 49.61 | 19 | 451 | 0 | 67,055 |

The one-deck page happens to contain a deck without a commander and skips localization. The core summary query has exactly three queries for nonempty pages, independent of page size. The controller regression budget is at most 21 queries including cold localization/schema checks; subsequent measured pages use 19. SQL rows and payload size scale with the page, not all cards in the account. Raw plans and measurements are in [owned-deck-list-benchmark.json](owned-deck-list-benchmark.json). These measurements are not an HTTP concurrency or production p95 claim.

## Index evidence

Migration `Version20260911130000` adds `(owner_id, folder_id, updated_at, id)` and `(owner_id, updated_at, id)`, mirrored in ORM metadata. The first supports a fixed folder, including `IS NULL`; the second is necessary when the folder filter is absent because ordering cannot skip the folder index key. PostgreSQL scans both indexes backwards for descending pagination.

The saved `EXPLAIN (ANALYZE, BUFFERS)` plans compare both reads before/after indexing. Before: sequential scan and top-N sort. After: backward index scans using the corresponding composite index, with only 51 rows returned for a 50-row page plus lookahead. Migrations are supplied for the normal migration workflow; no deployment is performed.

Regression coverage includes 100,000 deck-card rows, page sizes 1/10/100, timestamp ties, complete cursor traversal, empty/foreign folders, unfiled decks, missing/shared commanders, stale brackets and bounded controller localization queries.

## Validation on 2026-09-11

* Final fresh run, `APP_ENV=test php bin/phpunit --filter 'OwnedDeckList|DeckbuildingApiTest'`: 40 tests / 1,541 assertions passed.
* `npm test`: 272 files / 2,623 tests passed. `npm run build`: passed with existing CSS size-budget warnings. OpenAPI YAML lint passed.
* Full backend run: 1,299 tests / 14,286 assertions, one error and one failure, plus 13 PHPUnit deprecations and 79 notices. The cursor error came from the old query class already loaded in the long-running process while the fixture changed to legacy MD5 identifiers; the final fresh run above verifies the correction. The other failure is `RoomsGamesApiTest::testRoomGameCommandEventsAndAccessControl`, which expects a finished room to disappear from `/rooms?status=all`; room/game behavior was not changed here.
* The existing deck-import and room-deck-selection E2E tests could not reach deck listing: the API on port 8000 returns 500 during registration because its SQL expects a missing `app_user.roles` column. No infrastructure or unrelated room/auth fixes were made as part of this change.

Local raw test outputs are retained under `backend/var/owned-deck-final-tests.txt`, `backend/var/owned-deck-full-suite.txt` and `backend/var/owned-deck-e2e-results.txt` (ignored artifacts).
