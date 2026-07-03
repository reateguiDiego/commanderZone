<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20260703120000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Rebuild deck slugs with all commanders and deck format.';
    }

    public function up(Schema $schema): void
    {
        $this->addSql(<<<'SQL'
WITH deck_slug_source AS (
    SELECT
        d.id AS deck_id,
        d.name AS deck_name,
        COALESCE(d.format, 'commander') AS deck_format,
        COALESCE((
            SELECT STRING_AGG(c.name, '-' ORDER BY dc.id ASC)
            FROM deck_card dc
            JOIN card c ON c.id = dc.card_id
            WHERE dc.deck_id = d.id
              AND dc.section = 'commander'
        ), 'deck') AS commander_names,
        LOWER(COALESCE(NULLIF(SUBSTRING(d.slug FROM '[^-]+$'), ''), RIGHT(REPLACE(d.id, '-', ''), 8))) AS editor_suffix,
        LOWER(COALESCE(NULLIF(SUBSTRING(d.public_slug FROM '[^-]+$'), ''), RIGHT(REPLACE(d.id, '-', ''), 8))) AS public_suffix
    FROM deck d
)
UPDATE deck d
SET slug = CONCAT(
    COALESCE(NULLIF(TRIM(BOTH '-' FROM LEFT(TRIM(BOTH '-' FROM REGEXP_REPLACE(LOWER(deck_slug_source.commander_names), '[^a-z0-9]+', '-', 'g')), 96)), ''), 'deck'),
    '-',
    COALESCE(NULLIF(TRIM(BOTH '-' FROM LEFT(TRIM(BOTH '-' FROM REGEXP_REPLACE(LOWER(deck_slug_source.deck_name), '[^a-z0-9]+', '-', 'g')), 72)), ''), 'deck'),
    '-',
    COALESCE(NULLIF(TRIM(BOTH '-' FROM LEFT(TRIM(BOTH '-' FROM REGEXP_REPLACE(LOWER(deck_slug_source.deck_format), '[^a-z0-9]+', '-', 'g')), 32)), ''), 'deck'),
    '-',
    deck_slug_source.editor_suffix
)
FROM deck_slug_source
WHERE d.id = deck_slug_source.deck_id
SQL);

        $this->addSql(<<<'SQL'
WITH deck_slug_source AS (
    SELECT
        d.id AS deck_id,
        d.name AS deck_name,
        COALESCE(d.format, 'commander') AS deck_format,
        COALESCE((
            SELECT STRING_AGG(c.name, '-' ORDER BY dc.id ASC)
            FROM deck_card dc
            JOIN card c ON c.id = dc.card_id
            WHERE dc.deck_id = d.id
              AND dc.section = 'commander'
        ), 'deck') AS commander_names,
        LOWER(COALESCE(NULLIF(SUBSTRING(d.public_slug FROM '[^-]+$'), ''), RIGHT(REPLACE(d.id, '-', ''), 8))) AS public_suffix
    FROM deck d
    WHERE d.visibility = 'public'
)
UPDATE deck d
SET public_slug = CONCAT(
    COALESCE(NULLIF(TRIM(BOTH '-' FROM LEFT(TRIM(BOTH '-' FROM REGEXP_REPLACE(LOWER(deck_slug_source.commander_names), '[^a-z0-9]+', '-', 'g')), 96)), ''), 'deck'),
    '-',
    COALESCE(NULLIF(TRIM(BOTH '-' FROM LEFT(TRIM(BOTH '-' FROM REGEXP_REPLACE(LOWER(deck_slug_source.deck_name), '[^a-z0-9]+', '-', 'g')), 72)), ''), 'deck'),
    '-',
    COALESCE(NULLIF(TRIM(BOTH '-' FROM LEFT(TRIM(BOTH '-' FROM REGEXP_REPLACE(LOWER(deck_slug_source.deck_format), '[^a-z0-9]+', '-', 'g')), 32)), ''), 'deck'),
    '-',
    deck_slug_source.public_suffix
)
FROM deck_slug_source
WHERE d.id = deck_slug_source.deck_id
SQL);
    }

    public function down(Schema $schema): void
    {
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
        ), 'deck') AS commander_name,
        LOWER(COALESCE(NULLIF(SUBSTRING(d.slug FROM '[^-]+$'), ''), RIGHT(REPLACE(d.id, '-', ''), 8))) AS editor_suffix
    FROM deck d
)
UPDATE deck d
SET slug = CONCAT(
    COALESCE(NULLIF(TRIM(BOTH '-' FROM LEFT(TRIM(BOTH '-' FROM REGEXP_REPLACE(LOWER(deck_slug_source.commander_name), '[^a-z0-9]+', '-', 'g')), 140)), ''), 'deck'),
    '-',
    COALESCE(NULLIF(TRIM(BOTH '-' FROM LEFT(TRIM(BOTH '-' FROM REGEXP_REPLACE(LOWER(deck_slug_source.deck_name), '[^a-z0-9]+', '-', 'g')), 140)), ''), 'deck'),
    '-',
    deck_slug_source.editor_suffix
)
FROM deck_slug_source
WHERE d.id = deck_slug_source.deck_id
SQL);

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
        ), 'deck') AS commander_name,
        LOWER(COALESCE(NULLIF(SUBSTRING(d.public_slug FROM '[^-]+$'), ''), RIGHT(REPLACE(d.id, '-', ''), 8))) AS public_suffix
    FROM deck d
    WHERE d.visibility = 'public'
)
UPDATE deck d
SET public_slug = CONCAT(
    COALESCE(NULLIF(TRIM(BOTH '-' FROM LEFT(TRIM(BOTH '-' FROM REGEXP_REPLACE(LOWER(deck_slug_source.commander_name), '[^a-z0-9]+', '-', 'g')), 140)), ''), 'deck'),
    '-',
    COALESCE(NULLIF(TRIM(BOTH '-' FROM LEFT(TRIM(BOTH '-' FROM REGEXP_REPLACE(LOWER(deck_slug_source.deck_name), '[^a-z0-9]+', '-', 'g')), 140)), ''), 'deck'),
    '-',
    deck_slug_source.public_suffix
)
FROM deck_slug_source
WHERE d.id = deck_slug_source.deck_id
SQL);
    }
}
