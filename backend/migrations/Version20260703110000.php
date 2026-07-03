<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20260703110000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Rebuild community deck public slugs with commander and deck names.';
    }

    public function up(Schema $schema): void
    {
        $this->addSql('ALTER TABLE deck ALTER public_slug TYPE VARCHAR(220)');

        $this->addSql(<<<'SQL'
WITH public_deck_slug_source AS (
    SELECT
        d.id AS deck_id,
        d.name AS deck_name,
        COALESCE((
            SELECT c.name
            FROM deck_card dc
            JOIN card c ON c.id = dc.card_id
            WHERE dc.deck_id = d.id
              AND dc.section = 'commander'
            ORDER BY dc.id ASC
            LIMIT 1
        ), 'deck') AS commander_name
    FROM deck d
    WHERE d.visibility = 'public'
)
UPDATE deck d
SET public_slug = CONCAT(
    COALESCE(NULLIF(TRIM(BOTH '-' FROM REGEXP_REPLACE(LOWER(public_deck_slug_source.commander_name), '[^a-z0-9]+', '-', 'g')), ''), 'deck'),
    '-',
    COALESCE(NULLIF(TRIM(BOTH '-' FROM REGEXP_REPLACE(LOWER(public_deck_slug_source.deck_name), '[^a-z0-9]+', '-', 'g')), ''), 'deck'),
    '-',
    RIGHT(REPLACE(d.id, '-', ''), 8)
)
FROM public_deck_slug_source
WHERE d.id = public_deck_slug_source.deck_id
SQL);
    }

    public function down(Schema $schema): void
    {
        $this->addSql(<<<'SQL'
UPDATE deck
SET public_slug = CONCAT(
    COALESCE(NULLIF(TRIM(BOTH '-' FROM REGEXP_REPLACE(LOWER(name), '[^a-z0-9]+', '-', 'g')), ''), 'deck'),
    '-',
    RIGHT(REPLACE(id, '-', ''), 8)
)
WHERE visibility = 'public'
  AND public_slug IS NOT NULL
SQL);

        $this->addSql('ALTER TABLE deck ALTER public_slug TYPE VARCHAR(180)');
    }
}
