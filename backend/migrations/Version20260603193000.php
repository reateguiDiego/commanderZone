<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20260603193000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Add trigram and language-scoped indexes for card search and localized card-print lookups.';
    }

    public function up(Schema $schema): void
    {
        $this->addSql('CREATE EXTENSION IF NOT EXISTS pg_trgm');
        $this->addSql('CREATE INDEX IF NOT EXISTS idx_card_lang_normalized_name ON card (lang, normalized_name)');
        $this->addSql('CREATE INDEX IF NOT EXISTS idx_card_normalized_name_trgm ON card USING GIN (normalized_name gin_trgm_ops)');
        $this->addSql("CREATE INDEX IF NOT EXISTS idx_card_printed_name_trgm ON card USING GIN ((LOWER(COALESCE(printed_name, ''))) gin_trgm_ops)");
        $this->addSql("CREATE INDEX IF NOT EXISTS idx_card_flavor_name_trgm ON card USING GIN ((LOWER(COALESCE(flavor_name, ''))) gin_trgm_ops)");
        $this->addSql('CREATE INDEX IF NOT EXISTS idx_card_print_normalized_name_trgm ON card_print USING GIN (normalized_name gin_trgm_ops)');
        $this->addSql('CREATE INDEX IF NOT EXISTS idx_card_print_locale_lang_print ON card_print_locale (lang, print_scryfall_id)');
        $this->addSql("CREATE INDEX IF NOT EXISTS idx_card_print_locale_name_trgm ON card_print_locale USING GIN ((LOWER(COALESCE(name, ''))) gin_trgm_ops)");
        $this->addSql("CREATE INDEX IF NOT EXISTS idx_card_print_locale_printed_name_trgm ON card_print_locale USING GIN ((LOWER(COALESCE(printed_name, ''))) gin_trgm_ops)");
    }

    public function down(Schema $schema): void
    {
        $this->addSql('DROP INDEX IF EXISTS idx_card_print_locale_printed_name_trgm');
        $this->addSql('DROP INDEX IF EXISTS idx_card_print_locale_name_trgm');
        $this->addSql('DROP INDEX IF EXISTS idx_card_print_locale_lang_print');
        $this->addSql('DROP INDEX IF EXISTS idx_card_print_normalized_name_trgm');
        $this->addSql('DROP INDEX IF EXISTS idx_card_flavor_name_trgm');
        $this->addSql('DROP INDEX IF EXISTS idx_card_printed_name_trgm');
        $this->addSql('DROP INDEX IF EXISTS idx_card_normalized_name_trgm');
        $this->addSql('DROP INDEX IF EXISTS idx_card_lang_normalized_name');
    }
}
