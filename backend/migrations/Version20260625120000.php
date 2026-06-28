<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20260625120000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Create localized card search option catalogs.';
    }

    public function up(Schema $schema): void
    {
        $this->addSql('ALTER TABLE card_print ADD COLUMN IF NOT EXISTS default_set_name VARCHAR(255) DEFAULT NULL');
        $this->addSql('ALTER TABLE card_print_locale ADD COLUMN IF NOT EXISTS set_name VARCHAR(255) DEFAULT NULL');

        $this->addSql(
            <<<'SQL'
CREATE TABLE IF NOT EXISTS card_search_option (
    kind VARCHAR(24) NOT NULL,
    code VARCHAR(120) NOT NULL,
    lang VARCHAR(8) NOT NULL,
    label VARCHAR(255) NOT NULL,
    card_count INT DEFAULT NULL,
    sort_order INT NOT NULL DEFAULT 0,
    updated_at TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL,
    PRIMARY KEY (kind, code, lang)
)
SQL,
        );
        $this->addSql('CREATE INDEX IF NOT EXISTS idx_card_search_option_lang_kind_label ON card_search_option (lang, kind, label)');
        $this->addSql('CREATE INDEX IF NOT EXISTS idx_card_search_option_kind_code ON card_search_option (kind, code)');

        $this->addSql(
            <<<'SQL'
CREATE TABLE IF NOT EXISTS card_search_set_option (
    code VARCHAR(16) NOT NULL,
    lang VARCHAR(8) NOT NULL,
    label VARCHAR(255) NOT NULL,
    card_count INT NOT NULL DEFAULT 0,
    updated_at TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL,
    PRIMARY KEY (code, lang)
)
SQL,
        );
        $this->addSql('CREATE INDEX IF NOT EXISTS idx_card_search_set_option_lang_label ON card_search_set_option (lang, label)');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('DROP TABLE IF EXISTS card_search_set_option');
        $this->addSql('DROP TABLE IF EXISTS card_search_option');
        $this->addSql('ALTER TABLE card_print_locale DROP COLUMN IF EXISTS set_name');
        $this->addSql('ALTER TABLE card_print DROP COLUMN IF EXISTS default_set_name');
    }
}
