-- Run through psql; read-only diagnostic, not a migration.
-- All measurements warm buffers. Reverse their order in a separate session
-- before treating timing differences as an A/B comparison.
\set ON_ERROR_STOP on
BEGIN READ ONLY;
SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '1s';

SELECT now() AS captured_at, version();
SELECT name, setting, unit FROM pg_settings
WHERE name IN ('work_mem', 'random_page_cost', 'seq_page_cost', 'jit', 'effective_cache_size',
               'enable_seqscan', 'enable_bitmapscan', 'enable_indexscan', 'enable_indexonlyscan');
SELECT c.relpages, c.relallvisible, c.reltuples,
       pg_size_pretty(pg_relation_size(c.oid)) AS heap_size
FROM pg_class c WHERE c.oid = 'public.card_print_locale'::regclass;
SELECT indexrelid::regclass AS index_name, indisvalid, indisready,
       pg_size_pretty(pg_relation_size(indexrelid)) AS index_size,
       pg_get_indexdef(indexrelid) AS definition
FROM pg_index WHERE indexrelid = to_regclass('public.idx_card_print_locale_coverage');

SELECT $query$
SELECT lang, COUNT(coverage_name) AS distinct_card_names
FROM (
  SELECT DISTINCT lang,
    COALESCE(NULLIF(BTRIM(printed_name), ''), BTRIM(name)) AS coverage_name
  FROM card_print_locale
  WHERE lang IS NOT NULL AND lang NOT IN ('ph', 'la', 'qya', 'grc', 'he', 'sa', 'ar')
) AS names_by_language
GROUP BY lang ORDER BY distinct_card_names DESC, lang ASC
$query$ AS coverage_query \gset

\echo DEFAULT_PLAN
EXPLAIN (ANALYZE, BUFFERS, SETTINGS, FORMAT TEXT) :coverage_query;
SET LOCAL enable_seqscan = off;
\echo SEQUENTIAL_SCAN_DISCOURAGED
EXPLAIN (ANALYZE, BUFFERS, SETTINGS, FORMAT TEXT) :coverage_query;
-- Disabling seqscan alone can select a bitmap scan on the primary key.
-- This does not force a particular index: inspect the actual Index Name.
SET LOCAL enable_bitmapscan = off;
\echo SEQUENTIAL_AND_BITMAP_SCANS_DISCOURAGED
EXPLAIN (ANALYZE, BUFFERS, SETTINGS, FORMAT TEXT) :coverage_query;
ROLLBACK;
