<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20260610113000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Add immutable unaccent helper and accent-insensitive trigram indexes for card search.';
    }

    public function up(Schema $schema): void
    {
        $this->addSql('CREATE EXTENSION IF NOT EXISTS unaccent');
        $this->addSql(<<<'SQL'
CREATE OR REPLACE FUNCTION immutable_unaccent(text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
    SELECT unaccent('unaccent', $1)
$$
SQL);
        $this->addSql('CREATE INDEX IF NOT EXISTS idx_card_normalized_name_unaccent_trgm ON card USING GIN ((LOWER(immutable_unaccent(normalized_name))) gin_trgm_ops)');
        $this->addSql("CREATE INDEX IF NOT EXISTS idx_card_printed_name_unaccent_trgm ON card USING GIN ((LOWER(immutable_unaccent(COALESCE(printed_name, '')))) gin_trgm_ops)");
        $this->addSql("CREATE INDEX IF NOT EXISTS idx_card_flavor_name_unaccent_trgm ON card USING GIN ((LOWER(immutable_unaccent(COALESCE(flavor_name, '')))) gin_trgm_ops)");
        $this->addSql("CREATE INDEX IF NOT EXISTS idx_card_print_locale_name_unaccent_trgm ON card_print_locale USING GIN ((LOWER(immutable_unaccent(COALESCE(name, '')))) gin_trgm_ops)");
        $this->addSql("CREATE INDEX IF NOT EXISTS idx_card_print_locale_printed_name_unaccent_trgm ON card_print_locale USING GIN ((LOWER(immutable_unaccent(COALESCE(printed_name, '')))) gin_trgm_ops)");
    }

    public function down(Schema $schema): void
    {
        $this->addSql('DROP INDEX IF EXISTS idx_card_print_locale_printed_name_unaccent_trgm');
        $this->addSql('DROP INDEX IF EXISTS idx_card_print_locale_name_unaccent_trgm');
        $this->addSql('DROP INDEX IF EXISTS idx_card_flavor_name_unaccent_trgm');
        $this->addSql('DROP INDEX IF EXISTS idx_card_printed_name_unaccent_trgm');
        $this->addSql('DROP INDEX IF EXISTS idx_card_normalized_name_unaccent_trgm');
        $this->addSql('DROP FUNCTION IF EXISTS immutable_unaccent(text)');
    }
}
