# Rules-text search: diagnostic before optimization

The 24 October browser/API correlation identified selection costs of 17 seconds
for `aterrizaje`, 6.85 seconds for `landfall`, and 2 seconds for a filtered search.
Warm repeated selections execute zero SQL statements. Do not increase cache TTL
as a substitute for investigating the uncached plan.

The confirmed request is `/cards/search?q=&page=1&limit=20&lang=es&sort=name_asc&oracleTextA=aterrizaje&oracleTextMode=and`.
The second diagnostic changes only `oracleTextA` to `landfall`. These cases do not
represent other filters or pagination until those parameters are reproduced.

Run from Windows:

```powershell
Set-Location C:\Users\Diego\Dev\commanderZone
.\scripts\run-card-rules-diagnostic.ps1
```

This copies a uniquely named PHP diagnostic into `/tmp` on the host and API
container, invokes it sequentially for each term, saves local JSON reports and
removes the temporary scripts. It does not modify the deployed checkout, schema,
data, service configuration or result cache. No migration or restart is needed.
Use a quiet window without k6: EXPLAIN ANALYZE executes queries and consumes CPU/IO.

The diagnostic invokes the deployed controller's actual selection method and
filter builder. A separate DBAL connection records expanded SQL and parameters,
then EXPLAIN ANALYZE repeats those reads. Each statement has a 30-second timeout
and a 1-second lock timeout, in a read-only transaction, with JIT off as in search.
The transaction is rolled back even on failure. The plan is warmed by the initial
selection; it is not a cold-cache benchmark. A timeout is a diagnostic failure,
not proof that the query is absent or fast. Private method changes can break this
developer tool; failure must not lead to guessing SQL.

Review selection plans, loops in the correlated locale subquery, row estimates,
buffer reads, sorting and index expressions before changing the query. Preserve
accent folding, exact-word matching, AND/OR, language fallback, deduplication,
sort order and pagination. The helper does not exercise payload localization.

Local validation: PHP syntax passes; runtime capture and EXPLAIN replay pass on
isolated PostgreSQL 16 with PHP 8.4.27, both without search entries and after
rebuilding them from synthetic fixtures. Two existing API regression tests pass
(15 assertions): exact oracle-text words and localized oracle-text across languages.
These small fixtures do not establish production performance.

Separate correctness finding: the Scryfall locale import writes oracle text via
`oracleText()` (English canonical fields), while the localized-search test inserts
translated rules text directly. Investigate import/backfill coverage before
claiming that a faster query resolves missing Spanish results. No import or
application query behavior is changed by this diagnostic.

## Candidate-first rules search

The local implementation replaces each correlated rules-text predicate with a
set of matching card IDs: canonical text matches UNION localized text matches
joined by print ID. Membership tests preserve one output row per card, even when
several languages match. Each term has its own candidate set, preserving AND
across canonical text and translations, and OR between terms. Existing catalog,
filters, ordering, counts and pagination stay outside those sets.

Migration `Version20261024190000` adds two GIN trigram expression indexes matching
the existing folded rules-text/JSON-face expression exactly. It uses concurrent
index creation outside a transaction; it does not rewrite catalog data or change
translation imports. Builds consume CPU, IO and disk, and subsequent imports
maintain both indexes. If a concurrent build fails, inspect index validity and
which statements completed before retrying: this nontransactional migration can
leave a completed or invalid index behind. Do not hide that with IF NOT EXISTS.

The API regression covers accents, exact words, face text, cross-language AND,
OR, rarity filtering, duplicate translations, ordering and pagination both with
and without rebuilt search entries. An isolated PostgreSQL 16 fixture with 10,004
cards and more than 10,000 locales uses both new trigram indexes, then card and
catalog ID indexes, with normal planner settings and JIT off. The local plan is
saved in `reports/rules-candidate-plan-local.json`; synthetic timings are not a
production speedup measurement. After an authorized deployment, rerun the same
read-only diagnostic to compare uncached selection, results and buffer accesses.
