<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20260703100000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Add stable editor slugs for private deck URLs.';
    }

    public function up(Schema $schema): void
    {
        $this->addSql('ALTER TABLE deck ADD slug VARCHAR(220) DEFAULT NULL');

        $this->addSql(<<<'SQL'
WITH deck_slug_source AS (
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
    WHERE d.slug IS NULL
)
UPDATE deck d
SET slug = CONCAT(
    COALESCE(NULLIF(TRIM(BOTH '-' FROM REGEXP_REPLACE(LOWER(deck_slug_source.commander_name), '[^a-z0-9]+', '-', 'g')), ''), 'deck'),
    '-',
    COALESCE(NULLIF(TRIM(BOTH '-' FROM REGEXP_REPLACE(LOWER(deck_slug_source.deck_name), '[^a-z0-9]+', '-', 'g')), ''), 'deck'),
    '-',
    RIGHT(REPLACE(d.id, '-', ''), 8)
)
FROM deck_slug_source
WHERE d.id = deck_slug_source.deck_id
SQL);

        $this->addSql('CREATE UNIQUE INDEX uniq_deck_slug ON deck (slug) WHERE slug IS NOT NULL');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('DROP INDEX IF EXISTS uniq_deck_slug');
        $this->addSql('ALTER TABLE deck DROP slug');
    }
}
