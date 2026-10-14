# Web responsiveness at low load

Start with one user, then ten, before returning to the 50/100-user capacity runs.
Run the generator outside production. Keep the deployment, fixture accounts,
language and test duration unchanged between comparisons. Avoid overlapping
catalog imports, profiling sessions or other load tests.

Set `NAVIGATION_MIX=web` in the existing navigation runner. This profile reads
owned decks, summaries, folders, deck detail, deck sections, card search options,
languages and five search cases: prefix, name, Spanish name, filtered page 2,
and no results. Every account must already have a deck; setup fails otherwise.
It logs in but does not modify decks, create rooms or issue gameplay commands.
It pauses one second between actions. This is a synthetic HTTP journey, not a
measurement of browser rendering or an exact reproduction of SPA requests.

The existing runners now accept `-Users 1` / `-Users 10` (PowerShell) and
`--users 1` / `--users 10` (Bash). `AllPhases` is unchanged: do not use it for
this baseline. Keep the server metrics watchdog enabled. The Bash runner's
server snapshot collection is local; do not run it unchanged on an external
laptop against production. Use the external SSH collector or the PowerShell
runner with `ProductionHost` as documented in production-load-testing.md.

Initial acceptance budgets per endpoint remain p95 < 500 ms, p99 < 1000 ms and
HTTP/application error rate < 1%. Missing stable endpoint samples fail the run.
Report p50, p95, p99, max, sample count and error count; investigate failures at
one or ten users before increasing concurrency. These are targets, not results.

Raw points also carry `visit=first|repeat`. First visits are retained during
ramp-up but are NOT proof of cold server caches: the API may already be warm.
Fixed search cases repeat and can hit cache. Do not purge shared production
caches to simulate cold traffic. Test naturally expired entries or isolated
fixtures separately, and correlate cache state with application logs. The
existing `basic`/`advanced` analysis mixes remain separate experiments.

Alongside the HTTP baseline, inspect a real browser with cache disabled at the
browser level: open the deck list, a full decklist, switch text/spoiler, and search
cards. Record click-to-usable time, API waterfall, downloaded bytes/images and
long tasks. Run the same sequence while the ten-user test is active. The existing
navigation-browser script audits request counts but does not yet measure all of
these deck/search interactions. Fast API responses alone do not establish good UX.

Archive the deployed commit and resource limits, client latency summary, server
samples and request-correlated PHP/SQL timings. Compare timings of matching
requests; do not subtract unrelated p95 values or derive complete SQL deltas
from truncated top-25 snapshots. Optimize the slow path identified by evidence,
preserving pagination, deck cursor contracts and waiting-room behavior.

## First baseline and language coverage correction

Run `czlt-20261005-204604`, deployed commit `8b61faed`, completed with one user,
470 HTTP requests and no HTTP errors. Server gates passed. Stable p95 was
1459 ms for languages, 1243 ms for deck sections, 856 ms for filtered search,
684 ms for deck detail and 601 ms for prefix search. The deck list was 149 ms.

The language coverage cache computed a catalog fingerprint using COUNT/MAX
before every lookup. Its SQL delta recorded 39 calls, averaging 912 ms each.
The local correction caches this fingerprint for 60 seconds in the shared
application cache. Coverage still uses the fingerprint as its key, so catalog
changes refresh coverage when the fingerprint expires. Language coverage may
lag catalog changes by up to one minute. The first request after expiry still
pays for the fingerprint query; this is not a removal of all latency spikes.

After deployment, repeat the same one-user profile and compare both endpoint
percentiles and fingerprint query calls/time. Do not treat unit-test query
elimination as a measured production speedup. Deck sections and search remain
separate investigations.

## Deck detail and sections: repeated card reads

The next one-user run (`czlt-external-2026-10-06T11-11-43Z`, commit
`3ac3e180`) recorded a sections median of 645 ms and p95 of 798 ms. The HTTP
performance logs for its time window averaged 124 queries per sections request
and 107 per deck detail request. These server averages include the whole window;
they are not directly comparable to stable-phase client percentiles.

Deck cards reference lazily loaded card entities. Serializing every line caused
one SELECT per distinct card. The local correction preloads those entities with
one query after the existing ownership check, for detail by ID, detail by slug
and sections only. It leaves the deck collection and its ordering intact, and
does not change listing cursors, rooms, localization or token selection.

The integration regression uses 30 distinct cards across all four sections.
Before the correction it recorded 42 queries for either detail route and 62 for
sections. After the correction, sections uses 33 total queries and two queries
in the card loading/serialization stage; both detail routes stay below 20.
Coverage also checks line IDs, quantities, sections, card identities, empty
decks and rejection of another user's requests.

Existing HTTP logs now expose `deck.sections.load`, `deck.sections.cards`,
`deck.sections.tokens`, `deck.sections.localization` and
`deck.sections.response` stages. Each includes time, query count and row count.
After deployment, repeat the one-user web profile and inspect these stages to
identify remaining costs. Query-count reduction alone is not proof that the
production latency budgets pass.

## Token print loading and language revision (October 8)

Run `czlt-external-2026-10-08T06-42-32Z` still failed the one-user web
latency budgets. In the supplied HTTP samples, card serialization used two
queries and 8–13 ms, while token resolution took 198–424 ms and localization
51–145 ms. One language request spent 1329 ms in SQL. These are individual
requests, not aggregate stage percentiles.

Token print selection now reads scalar identity/image data for the pool and
hydrates complete Card entities only for selected prints. It also serializes
only the selected token relation per source. The regression fixture with 30
prints permits at most two hydrated token entities (the relation target and
the chosen print), instead of 30. This adds a bounded batch query in exchange
for avoiding full payload loading for unused prints. Random selection, image
eligibility including face images, source deduplication, unresolved fallbacks
and the full table token payload remain unchanged.

Language freshness now reads `card_locale_revision`, a single-row revision
maintained transactionally by a statement-level PostgreSQL trigger on locale
INSERT/UPDATE/DELETE/TRUNCATE. This removes the recurring COUNT/MAX scan. The
60-second signature cache and coverage calculation are retained: a cold cache
or a catalog change still requires the coverage GROUP BY. Concurrent catalog
writers serialize their revision updates until transaction commit; the change
does not write a revision on HTTP reads.

Migration `Version20261008120000` must run before serving the new language
service. It creates the revision table, function and trigger; rollback removes
them. Existing import/backfill/reset paths need no separate invalidation hook.
The coverage cache namespace changes, so the first request after deployment
rebuilds coverage. After deployment, repeat the same one-user profile and
compare `deck.sections.tokens`, query time and language cold/warm requests.
These changes do not establish a measured production latency improvement yet.

Local validation: full backend suite passed (1376 tests, 15550 assertions,
exit 0; existing 13 PHPUnit deprecations and 80 notices). The isolated,
disposable PostgreSQL 16 test container used `fsync=off` for the latter part
of the run to reduce table-reset IO; this does not test crash durability.
Migration down/up and restricted-search-path trigger execution passed, followed
by all six language cache/revision tests. No production changes were applied.

## Search counting and section localization (October 13)

Production run `czlt-external-2026-10-08T13-32-15Z`, deployed commit
`96f155a0`, reduced languages p95 to 67 ms and sections p95 to 519 ms.
Sections, prefix search and filtered page search still failed their thresholds.
The two supplied slow search samples spent 1147/1181 ms and 2177/2191 ms
in SQL/request handling respectively. They do not identify individual query
plans, and the HTTP log alone cannot map either sample to a specific search
variant. Sections still performed 24 localization queries in these samples.

The local changes remove redundant work without changing the API contract:

- Search counts distinct name/type/mana groups without ranking and sorting
  representative prints. The result page keeps its existing ranking.
- Localized matching uses the existing all-language branch once; the additional
  requested-language branch was a subset of that same match. Card-language
  buckets, fallback priority, filters and representative selection are retained.
- Search checks print-table availability once per request, resetting the cached
  result at the start of every search even in long-lived workers.
- Sections localize all four card sections and tokens together, then restore
  each payload to its original position. Card IDs, line metadata, token metadata
  and canonical English type lines are preserved.
- Search logs expose `cards.search.selection` (including the existing page cache),
  `cards.search.payloads` and `cards.search.localization`, without logging query
  text or user input. Empty result pages only execute selection.

Regression coverage checks filtered prefix/substring searches with duplicate
prints, distinct mana costs, forbidden cards, multiple pages and a page beyond
the end. The query budget is at most 12 per search. The 30-card/four-section
fixture now requires fewer than 20 total queries and at most eight localization
queries. Localization also checks the same card in all four sections.

No migration, frontend, deck cursor, room or game command changes are needed.
Repeat the one-user web profile after deployment before increasing load. Local
query budgets do not establish production p95/p99 improvements; no production
EXPLAIN plans have yet been collected for the remaining search spikes.

Validation: full backend suite passed with exit 0 (1377 tests, 15640 assertions;
13 existing PHPUnit deprecations and 80 notices). The run used a disposable
PostgreSQL 16 database with `fsync=off` for test setup speed, not crash-durability
validation. Log: `reports/backend-search-localization-tests.log` (local artifact).
Production was not modified.

## Scoped search JIT setting (October 13)

Production diagnostic `reports/jit-ab-20261013-133815` alternated JIT on/off
after warm-up, with four samples per setting. For the filtered English search,
count medians were 293.9 ms on / 226.4 ms off, and page medians were
345.7 ms on / 223.6 ms off. Compilation medians were about 83.5 ms per
statement with JIT on. The sum of those query medians improved by about
190 ms; this is not an HTTP request median. Prefix queries did not compile
with JIT and remained around 44 ms for count and 54 ms for page.

`CardSearchSelection` now runs uncached search selection inside a transaction
with `SET LOCAL jit = off`. Commit or rollback restores the previous setting
before payload loading and localization. With an existing transaction, DBAL
uses a savepoint: success explicitly restores the prior value before release,
and failure rolls back to the savepoint, including after an SQL error. This
prevents the setting leaking into later work on persistent connections.
Cache hits bypass this scope. A cache miss adds transaction boundaries and
one setting statement; no global PostgreSQL configuration or migration changes.

Regression coverage exercises initial JIT on/off, standalone/nested scopes,
success/PHP errors/SQL errors, same-connection reuse and a cached controller
response that executes no SQL. Repeat the one-user production web profile
after deployment. This change does not explain the prefix spikes or resolve
the remaining deck latency; production endpoint improvement remains unverified.

Validation: full backend suite passed with exit 0 (1390 tests, 15751 assertions;
13 existing PHPUnit deprecations and 80 notices). The isolated PostgreSQL 16
test database used `fsync=off` for fixture setup speed. Log:
`reports/backend-search-jit-tests.log`. The 13 new tests include same-connection
setting restoration and cache-hit coverage. No production changes were applied.

## Shared search candidates and relevance (October 14)

The production JIT-off diagnostic captured at 08:32:45 +02:00 measured prefix
count/page at 54.560/54.617 ms and filtered count/page at 259.901/215.101 ms.
The filtered queries each repeated 5019 locale-to-card index lookups; page
ranking also scanned locale exact/prefix matches for 85.738/27.390 ms.
These diagnostic timings do not reproduce the 1.3–1.7 second selection spikes
from HTTP logs, and the diagnostic warms data before measuring each statement.

Nonempty bucketed searches now return page IDs and total in one SQL statement.
Matching name/printed-name/flavor-name branches carry their relevance into a
grouped candidate set. Matching translations are ranked and grouped by print
before joining cards, retaining all-language matching. The representative-card
set is materialized once and reused by the total and page. A left join retains
the total when the requested page is empty, so language fallback still depends
on total matches, not the presence of IDs on that page.

Existing filters, grouping keys, representative ordering, sort modes and the
limit-plus-one pagination contract remain in use. Backslash patterns retain the
previous ranking expression because LIKE escaping can make a literal exact
match fall outside the pattern's matches. Set-printing and empty-query search
paths retain their existing SQL. JIT remains scoped to uncached selection.
No migration, index, API response, frontend, deck or room changes are included.

Local comparison against the previous committed builders matched counts and
ordered IDs in 756 combinations on a multilingual duplicate-print fixture
(seven query patterns, three languages, six sorts, three pages, including
fallback buckets). The local EXPLAIN confirmed that the candidate and
representative sets each execute once, with two scans of the materialized
representatives for total/page. This small fixture validates reuse, not
production latency or planner choices. Ranking/materialization may have
different costs for broad searches and still needs production measurement.

Regression tests additionally require one combined selection statement per
bucket, preserve exact/prefix relevance across multiple translations and check
out-of-range totals without switching language buckets. The local, untracked
`scripts/explain-card-search.php` diagnostic now measures `selection` rather
than separate `count`/`page`; refresh that script before collecting new plans
after deployment. Its previous count-builder reflection no longer applies.

Validation: full backend suite passed with exit 0 (1392 tests, 15791 assertions;
13 existing PHPUnit deprecations and 80 notices). Log:
`reports/backend-search-candidates-tests.log`. Tests used an isolated disposable
PostgreSQL 16 database with `fsync=off` for fixture setup speed. No production
configuration or data was modified. Production performance remains unmeasured.

## Language coverage and section payload reads (October 14)

The following 1-VU production run passed the search gates but still failed
languages and sections. Languages had one 3395 ms sample (next slowest 153 ms);
its matching backend log spent 3204.661 ms in SQL. Sections returned roughly
1.4 MB of JSON, with 23 SQL queries and 1262 rows in the supplied logs. The
backend samples and endpoint percentiles are not paired measurements, so their
difference cannot be assigned entirely to network transfer.

Language coverage now deduplicates `(lang, effective name)` before counting
non-null names. Trimming, printed-name preference, excluded languages, cache
lifetime and revision invalidation stay unchanged. Migration
`Version20261014120000` creates a concurrent covering index on the language and
effective name, including the raw name fields for index-only reads. Deployment
must apply this migration. The index adds storage and catalog-write overhead;
its usefulness depends on the planner and visibility map. Application and
rollback were checked locally. A synthetic 460,000-row probe used an index-only
scan without heap fetches or temporary sorting; this is not a production speed
guarantee or a controlled cold-cache A/B benchmark.

Token print selection now filters image eligibility and chooses one random print
per oracle in PostgreSQL. PHP receives the selected IDs and hydrates only those
cards, instead of decoding every candidate's image/face JSON. The source-token
fallback and one-token-per-source selection remain unchanged. Random choices
remain random but are no longer drawn by PHP for the print pool. Selection still
examines all prints in each oracle pool; this change reduces transfer/hydration,
not the number of eligible candidates examined by the database.

Localized payload reads now restrict both print-table and legacy queries to the
selected `(scryfall ID, language)` pairs, avoiding the cross product of all IDs
and languages. Candidate precedence, unavailable-image handling, English
fallback, source identity and returned fields remain unchanged. This does not
change HTTP response size or cache deck responses. A mixed Spanish/English
fixture verifies two payload rows instead of four, including placeholder
fallback; a 30-print token fixture verifies fewer than ten total fetched rows.

Validation: full backend suite passed with exit 0 (1394 tests, 15815 assertions;
13 existing PHPUnit deprecations and 80 notices). Log:
`reports/backend-coverage-sections-tests.log`. Tests used the disposable local
PostgreSQL 16 database; migration application and rollback also passed. After deployment,
repeat the same 1-VU web scenario and compare coverage cache misses, token and
localization stages, fetched rows and endpoint percentiles before increasing
load. No production changes or Git publication are performed by this task.
