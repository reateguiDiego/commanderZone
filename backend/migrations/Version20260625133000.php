<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20260625133000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Create materialized card search entries for fast paginated catalog search.';
    }

    public function up(Schema $schema): void
    {
        $this->addSql(
            <<<'SQL'
CREATE TABLE IF NOT EXISTS card_search_entry (
    lang VARCHAR(8) NOT NULL,
    dedupe_key VARCHAR(32) NOT NULL,
    card_id VARCHAR(36) NOT NULL,
    name VARCHAR(255) NOT NULL,
    sort_name VARCHAR(255) NOT NULL,
    normalized_name VARCHAR(255) NOT NULL,
    mana_value DOUBLE PRECISION DEFAULT NULL,
    rarity VARCHAR(24) DEFAULT NULL,
    set_code VARCHAR(16) DEFAULT NULL,
    set_name VARCHAR(255) DEFAULT NULL,
    legal_standard BOOLEAN NOT NULL DEFAULT false,
    legal_pioneer BOOLEAN NOT NULL DEFAULT false,
    legal_modern BOOLEAN NOT NULL DEFAULT false,
    legal_legacy BOOLEAN NOT NULL DEFAULT false,
    legal_vintage BOOLEAN NOT NULL DEFAULT false,
    legal_commander BOOLEAN NOT NULL DEFAULT false,
    legal_brawl BOOLEAN NOT NULL DEFAULT false,
    legal_pauper BOOLEAN NOT NULL DEFAULT false,
    updated_at TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL,
    PRIMARY KEY (lang, dedupe_key)
)
SQL,
        );
        $this->addSql('CREATE INDEX IF NOT EXISTS idx_card_search_entry_card ON card_search_entry (card_id)');
        $this->addSql('CREATE INDEX IF NOT EXISTS idx_card_search_entry_lang_name ON card_search_entry (lang, sort_name, card_id)');
        $this->addSql('CREATE INDEX IF NOT EXISTS idx_card_search_entry_lang_mana ON card_search_entry (lang, mana_value, sort_name, card_id)');
        foreach (['standard', 'pioneer', 'modern', 'legacy', 'vintage', 'commander', 'brawl', 'pauper'] as $format) {
            $this->addSql(sprintf(
                'CREATE INDEX IF NOT EXISTS idx_card_search_entry_%1$s_name ON card_search_entry (lang, sort_name, card_id) WHERE legal_%1$s',
                $format,
            ));
            $this->addSql(sprintf(
                'CREATE INDEX IF NOT EXISTS idx_card_search_entry_%1$s_mana ON card_search_entry (lang, mana_value, sort_name, card_id) WHERE legal_%1$s',
                $format,
            ));
        }
        $this->addSql(
            'ALTER TABLE card_search_entry ADD CONSTRAINT fk_card_search_entry_card FOREIGN KEY (card_id) REFERENCES card (id) ON DELETE CASCADE',
        );
    }

    public function down(Schema $schema): void
    {
        $this->addSql('DROP TABLE IF EXISTS card_search_entry');
    }
}
