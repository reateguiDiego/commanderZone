<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20260528110000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Create normalized card_print and card_print_locale tables for progressive language-model migration.';
    }

    public function up(Schema $schema): void
    {
        $this->addSql(
            <<<'SQL'
CREATE TABLE IF NOT EXISTS card_print (
    scryfall_id VARCHAR(36) NOT NULL PRIMARY KEY,
    normalized_name VARCHAR(255) NOT NULL,
    set_code VARCHAR(16) DEFAULT NULL,
    collector_number VARCHAR(32) DEFAULT NULL,
    default_name VARCHAR(255) NOT NULL,
    default_lang VARCHAR(8) DEFAULT NULL,
    default_mana_cost VARCHAR(255) DEFAULT NULL,
    default_type_line TEXT DEFAULT NULL,
    default_oracle_text TEXT DEFAULT NULL,
    default_image_uris JSON NOT NULL,
    default_card_faces JSON NOT NULL,
    layout VARCHAR(80) NOT NULL,
    commander_legal BOOLEAN NOT NULL,
    updated_at TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL
)
SQL,
        );
        $this->addSql('CREATE INDEX IF NOT EXISTS idx_card_print_normalized_name ON card_print (normalized_name)');
        $this->addSql('CREATE INDEX IF NOT EXISTS idx_card_print_set_collector ON card_print (set_code, collector_number)');

        $this->addSql(
            <<<'SQL'
CREATE TABLE IF NOT EXISTS card_print_locale (
    print_scryfall_id VARCHAR(36) NOT NULL,
    lang VARCHAR(8) NOT NULL,
    name VARCHAR(255) NOT NULL,
    printed_name VARCHAR(255) DEFAULT NULL,
    mana_cost VARCHAR(255) DEFAULT NULL,
    type_line TEXT DEFAULT NULL,
    oracle_text TEXT DEFAULT NULL,
    image_uris JSON NOT NULL,
    card_faces JSON NOT NULL,
    image_status VARCHAR(32) DEFAULT NULL,
    updated_at TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL,
    PRIMARY KEY (print_scryfall_id, lang),
    CONSTRAINT fk_card_print_locale_print FOREIGN KEY (print_scryfall_id) REFERENCES card_print (scryfall_id) ON DELETE CASCADE
)
SQL,
        );
        $this->addSql('CREATE INDEX IF NOT EXISTS idx_card_print_locale_lang ON card_print_locale (lang)');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('DROP TABLE IF EXISTS card_print_locale');
        $this->addSql('DROP TABLE IF EXISTS card_print');
    }
}

