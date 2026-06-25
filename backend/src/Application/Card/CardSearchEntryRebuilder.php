<?php

namespace App\Application\Card;

use App\Domain\Localization\LanguageCatalog;
use Doctrine\DBAL\Connection;

final class CardSearchEntryRebuilder
{
    public function __construct(private readonly Connection $connection)
    {
    }

    public function rebuild(): void
    {
        $this->connection->executeStatement('DELETE FROM card_search_entry');

        foreach (LanguageCatalog::SUPPORTED_CARD_LANGUAGES as $language) {
            $this->rebuildLanguage($language);
        }
    }

    private function rebuildLanguage(string $language): void
    {
        $sql = sprintf(
            <<<'SQL'
INSERT INTO card_search_entry (
    lang,
    dedupe_key,
    card_id,
    name,
    sort_name,
    normalized_name,
    mana_value,
    rarity,
    set_code,
    set_name,
    legal_standard,
    legal_pioneer,
    legal_modern,
    legal_legacy,
    legal_vintage,
    legal_commander,
    legal_brawl,
    legal_pauper,
    updated_at
)
SELECT
    :entry_lang,
    ranked.dedupe_key,
    ranked.id,
    ranked.display_name,
    ranked.sort_name,
    ranked.normalized_name,
    ranked.mana_value,
    ranked.rarity,
    ranked.set_code,
    ranked.set_name,
    ranked.legal_standard,
    ranked.legal_pioneer,
    ranked.legal_modern,
    ranked.legal_legacy,
    ranked.legal_vintage,
    ranked.legal_commander,
    ranked.legal_brawl,
    ranked.legal_pauper,
    NOW()
FROM (
    SELECT
        c.id,
        md5(c.normalized_name || '|' || LOWER(COALESCE(c.type_line, '')) || '|' || LOWER(COALESCE(c.mana_cost, ''))) AS dedupe_key,
        COALESCE(NULLIF(c.printed_name, ''), c.name) AS display_name,
        LOWER(immutable_unaccent(COALESCE(NULLIF(c.printed_name, ''), c.name))) AS sort_name,
        c.normalized_name,
        c.mana_value,
        c.rarity,
        LOWER(c.set_code) AS set_code,
        c.set_name,
        COALESCE((c.legalities::jsonb ->> 'standard') = 'legal', false) AS legal_standard,
        COALESCE((c.legalities::jsonb ->> 'pioneer') = 'legal', false) AS legal_pioneer,
        COALESCE((c.legalities::jsonb ->> 'modern') = 'legal', false) AS legal_modern,
        COALESCE((c.legalities::jsonb ->> 'legacy') = 'legal', false) AS legal_legacy,
        COALESCE((c.legalities::jsonb ->> 'vintage') = 'legal', false) AS legal_vintage,
        COALESCE((c.legalities::jsonb ->> 'commander') = 'legal', false) AS legal_commander,
        COALESCE((c.legalities::jsonb ->> 'brawl') = 'legal', false) AS legal_brawl,
        COALESCE((c.legalities::jsonb ->> 'pauper') = 'legal', false) AS legal_pauper,
        ROW_NUMBER() OVER (
            PARTITION BY c.normalized_name, LOWER(COALESCE(c.type_line, '')), LOWER(COALESCE(c.mana_cost, ''))
            ORDER BY
                CASE
                    WHEN c.lang = :entry_lang THEN 0
                    WHEN c.lang = :default_lang THEN 1
                    WHEN c.lang IS NULL THEN 2
                    ELSE 3
                END ASC,
                c.scryfall_id ASC,
                c.name ASC
        ) AS row_number
    FROM card c
    WHERE %s
      AND (c.lang = :entry_lang OR c.lang = :default_lang OR c.lang IS NULL)
) ranked
WHERE ranked.row_number = 1
SQL,
            PlayableCardCatalogSql::condition('c'),
        );

        $params = array_replace(
            PlayableCardCatalogSql::parameters(),
            [
                'entry_lang' => $language,
                'default_lang' => LanguageCatalog::DEFAULT_LANGUAGE,
            ],
        );

        $this->connection->executeStatement(
            $sql,
            $params,
            PlayableCardCatalogSql::parameterTypes(),
        );
    }
}
