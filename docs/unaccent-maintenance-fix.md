# Unaccent maintenance regression

PostgreSQL maintenance can run with a restricted `search_path`. The original
`public.immutable_unaccent(text)` resolves both the `unaccent` function and its
dictionary without a schema, causing automatic analyze/vacuum errors on card
expression indexes when `public` is not in that path.

Migration `Version20260924160000` qualifies both references. It keeps the function
identity, signature, volatility and normalization semantics, so existing indexes
remain attached and do not need rebuilding for this change. The deployment uses
the existing `public.unaccent` extension and dictionary; other extension schemas
are not silently relocated.

Apply through the normal reviewed PR and deployment/migration workflow. Do not
edit the historical migration or replace the function manually in production.
After deployment, verify the function with a restricted search path:

```sql
BEGIN READ ONLY;
SET LOCAL search_path = pg_catalog;
SELECT public.immutable_unaccent('Crème brûlée'); -- Creme brulee
ROLLBACK;
```

If statistics are stale, run the following as a separate approved maintenance
step outside catalog imports and load tests, rather than inside the migration:

```sql
SET lock_timeout = '3s';
SET statement_timeout = '180s';
ANALYZE public.card;
ANALYZE public.card_print_locale;
```

Check subsequent automatic maintenance logs for the previous `function
unaccent(unknown, text) does not exist` error. A successful manual `ANALYZE` is
not proof that a future automatic cycle has completed.

The down migration restores the previous implementation, including its known
restricted-search-path limitation. `ANALYZE` statistics do not have a matching
rollback. Benchmark comparisons must retain warmed Doctrine metadata and exclude
concurrent catalog imports (the September 24 import overlapped both post-warmup
100-user runs from 09:30 to 11:38 UTC).
