<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20260625134500 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Add covering sort indexes for materialized card search entries.';
    }

    public function up(Schema $schema): void
    {
        $this->addSql('CREATE INDEX IF NOT EXISTS idx_card_search_entry_lang_name_full ON card_search_entry (lang, sort_name, name, card_id)');
        $this->addSql('CREATE INDEX IF NOT EXISTS idx_card_search_entry_lang_mana_full ON card_search_entry (lang, mana_value, sort_name, name, card_id)');
        foreach (['standard', 'pioneer', 'modern', 'legacy', 'vintage', 'commander', 'brawl', 'pauper'] as $format) {
            $this->addSql(sprintf(
                'CREATE INDEX IF NOT EXISTS idx_card_search_entry_%1$s_name_full ON card_search_entry (lang, sort_name, name, card_id) WHERE legal_%1$s',
                $format,
            ));
            $this->addSql(sprintf(
                'CREATE INDEX IF NOT EXISTS idx_card_search_entry_%1$s_mana_full ON card_search_entry (lang, mana_value, sort_name, name, card_id) WHERE legal_%1$s',
                $format,
            ));
        }
    }

    public function down(Schema $schema): void
    {
        foreach (['standard', 'pioneer', 'modern', 'legacy', 'vintage', 'commander', 'brawl', 'pauper'] as $format) {
            $this->addSql(sprintf('DROP INDEX IF EXISTS idx_card_search_entry_%s_mana_full', $format));
            $this->addSql(sprintf('DROP INDEX IF EXISTS idx_card_search_entry_%s_name_full', $format));
        }
        $this->addSql('DROP INDEX IF EXISTS idx_card_search_entry_lang_mana_full');
        $this->addSql('DROP INDEX IF EXISTS idx_card_search_entry_lang_name_full');
    }
}
