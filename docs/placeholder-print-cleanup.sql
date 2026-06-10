-- Audit deck cards currently pointing at placeholder or missing prints.
SELECT
    u.email,
    u.card_language,
    d.id AS deck_id,
    d.name AS deck_name,
    dc.id AS deck_card_id,
    dc.quantity,
    dc.section,
    c.name AS canonical_name,
    c.printed_name,
    c.lang,
    c.set_code,
    c.collector_number,
    c.image_status
FROM deck_card dc
INNER JOIN deck d ON d.id = dc.deck_id
INNER JOIN app_user u ON u.id = d.owner_id
INNER JOIN card c ON c.id = dc.card_id
WHERE LOWER(COALESCE(c.image_status, '')) IN ('missing', 'placeholder')
ORDER BY u.email, d.name, c.name, c.set_code, c.collector_number;

-- Replace bad deck-card pointers with a usable English sibling print when one exists.
WITH replacement AS (
    SELECT DISTINCT ON (dc.id)
        dc.id AS deck_card_id,
        replacement_card.id AS replacement_card_id
    FROM deck_card dc
    INNER JOIN card bad ON bad.id = dc.card_id
    INNER JOIN card replacement_card
        ON replacement_card.normalized_name = bad.normalized_name
       AND LOWER(COALESCE(replacement_card.lang, 'en')) = 'en'
       AND LOWER(COALESCE(replacement_card.image_status, '')) NOT IN ('missing', 'placeholder')
    WHERE LOWER(COALESCE(bad.image_status, '')) IN ('missing', 'placeholder')
    ORDER BY
        dc.id,
        replacement_card.set_code ASC NULLS LAST,
        replacement_card.collector_number ASC NULLS LAST
)
UPDATE deck_card dc
SET
    card_id = replacement.replacement_card_id,
    updated_at = NOW()
FROM replacement
WHERE dc.id = replacement.deck_card_id;

-- Audit any remaining deck cards that still have no usable replacement.
SELECT
    u.email,
    u.card_language,
    d.id AS deck_id,
    d.name AS deck_name,
    dc.id AS deck_card_id,
    dc.quantity,
    dc.section,
    c.name AS canonical_name,
    c.printed_name,
    c.lang,
    c.set_code,
    c.collector_number,
    c.image_status
FROM deck_card dc
INNER JOIN deck d ON d.id = dc.deck_id
INNER JOIN app_user u ON u.id = d.owner_id
INNER JOIN card c ON c.id = dc.card_id
WHERE LOWER(COALESCE(c.image_status, '')) IN ('missing', 'placeholder')
ORDER BY u.email, d.name, c.name, c.set_code, c.collector_number;

-- Optional: delete the remaining deck cards only if you explicitly want to purge unresolved bad prints.
-- DELETE FROM deck_card dc
-- USING card c
-- WHERE dc.card_id = c.id
--   AND LOWER(COALESCE(c.image_status, '')) IN ('missing', 'placeholder');

-- Audit translation rows that are currently unusable.
SELECT
    locale.lang,
    COUNT(*) AS rows,
    COUNT(DISTINCT locale.print_scryfall_id) AS distinct_prints
FROM card_print_locale locale
WHERE LOWER(COALESCE(locale.image_status, '')) IN ('missing', 'placeholder')
GROUP BY locale.lang
ORDER BY locale.lang;

-- Sample the worst offenders by normalized card name.
SELECT
    print.normalized_name,
    locale.lang,
    COUNT(*) AS rows
FROM card_print_locale locale
INNER JOIN card_print print ON print.scryfall_id = locale.print_scryfall_id
WHERE LOWER(COALESCE(locale.image_status, '')) IN ('missing', 'placeholder')
GROUP BY print.normalized_name, locale.lang
ORDER BY rows DESC, print.normalized_name ASC, locale.lang ASC
LIMIT 100;

-- Delete unusable translation rows from card_print_locale.
-- This is safe because card_print is the parent inventory table and can stay intact.
DELETE FROM card_print_locale locale
WHERE LOWER(COALESCE(locale.image_status, '')) IN ('missing', 'placeholder');

-- Audit legacy card rows that still carry unusable localized prints.
-- deck_card must be cleaned first, otherwise these rows may still be referenced.
SELECT
    c.lang,
    COUNT(*) AS rows
FROM card c
LEFT JOIN deck_card dc ON dc.card_id = c.id
WHERE LOWER(COALESCE(c.image_status, '')) IN ('missing', 'placeholder')
GROUP BY c.lang
ORDER BY c.lang;

-- Delete legacy card rows with unusable images once they are no longer referenced by deck_card.
-- This keeps the legacy card table from re-surfacing placeholder localized prints.
DELETE FROM card c
WHERE LOWER(COALESCE(c.image_status, '')) IN ('missing', 'placeholder')
  AND NOT EXISTS (
      SELECT 1
      FROM deck_card dc
      WHERE dc.card_id = c.id
  );

-- Audit remaining non-English gaps where card_print_locale is still missing
-- and the resolver would be tempted to fall back to legacy card rows.
SELECT
    requested.lang,
    COUNT(*) AS missing_print_locale_rows,
    COUNT(legacy.id) AS legacy_fallback_rows
FROM (
    SELECT DISTINCT
        print.scryfall_id AS print_scryfall_id,
        print.normalized_name,
        lang.lang
    FROM card_print print
    CROSS JOIN (
        SELECT DISTINCT lang
        FROM card_print_locale
        WHERE TRIM(COALESCE(lang, '')) <> ''
        UNION
        SELECT DISTINCT lang
        FROM card
        WHERE TRIM(COALESCE(lang, '')) <> ''
    ) lang
    WHERE LOWER(lang.lang) <> 'en'
) requested
LEFT JOIN card_print_locale locale
    ON locale.print_scryfall_id = requested.print_scryfall_id
   AND LOWER(COALESCE(locale.lang, '')) = LOWER(requested.lang)
   AND LOWER(COALESCE(locale.image_status, '')) NOT IN ('missing', 'placeholder')
LEFT JOIN card legacy
    ON legacy.normalized_name = requested.normalized_name
   AND LOWER(COALESCE(legacy.lang, '')) = LOWER(requested.lang)
   AND LOWER(COALESCE(legacy.image_status, '')) NOT IN ('missing', 'placeholder')
WHERE locale.print_scryfall_id IS NULL
GROUP BY requested.lang
ORDER BY requested.lang;

-- Optional audit of what remains after cleanup.
SELECT
    'card_print_locale' AS table_name,
    COUNT(*) AS remaining_bad_rows
FROM card_print_locale locale
WHERE LOWER(COALESCE(locale.image_status, '')) IN ('missing', 'placeholder')
UNION ALL
SELECT
    'card' AS table_name,
    COUNT(*) AS remaining_bad_rows
FROM card c
WHERE LOWER(COALESCE(c.image_status, '')) IN ('missing', 'placeholder');
