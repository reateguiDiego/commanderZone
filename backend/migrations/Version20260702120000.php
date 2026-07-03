<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20260702120000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Add stable public slugs for community decks and minimal public profile handles.';
    }

    public function up(Schema $schema): void
    {
        $this->addSql('ALTER TABLE deck ADD public_slug VARCHAR(220) DEFAULT NULL');
        $this->addSql('ALTER TABLE app_user ADD public_handle VARCHAR(180) DEFAULT NULL');

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
      AND d.public_slug IS NULL
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

        $this->addSql(<<<'SQL'
UPDATE app_user
SET public_handle = CONCAT(
    COALESCE(NULLIF(TRIM(BOTH '-' FROM REGEXP_REPLACE(LOWER(display_name), '[^a-z0-9]+', '-', 'g')), ''), 'player'),
    '-',
    RIGHT(REPLACE(id, '-', ''), 8)
)
WHERE public_handle IS NULL
SQL);

        $this->addSql('CREATE UNIQUE INDEX uniq_deck_public_slug ON deck (public_slug) WHERE public_slug IS NOT NULL');
        $this->addSql('CREATE UNIQUE INDEX uniq_user_public_handle ON app_user (public_handle) WHERE public_handle IS NOT NULL');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('DROP INDEX IF EXISTS uniq_user_public_handle');
        $this->addSql('DROP INDEX IF EXISTS uniq_deck_public_slug');
        $this->addSql('ALTER TABLE app_user DROP public_handle');
        $this->addSql('ALTER TABLE deck DROP public_slug');
    }
}
