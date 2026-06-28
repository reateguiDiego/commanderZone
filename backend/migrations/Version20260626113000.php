<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20260626113000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Adds Community endpoint support indexes for deck visibility/validity lookups and commander filters.';
    }

    public function up(Schema $schema): void
    {
        $this->addSql('CREATE INDEX IF NOT EXISTS idx_deck_visibility_valid_updated_at ON deck (visibility, is_valid, updated_at)');
        $this->addSql('CREATE INDEX IF NOT EXISTS idx_deck_card_deck_section ON deck_card (deck_id, section)');
        $this->addSql('CREATE INDEX IF NOT EXISTS idx_card_commander_legal ON card (commander_legal)');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('DROP INDEX IF EXISTS idx_deck_visibility_valid_updated_at');
        $this->addSql('DROP INDEX IF EXISTS idx_deck_card_deck_section');
        $this->addSql('DROP INDEX IF EXISTS idx_card_commander_legal');
    }
}
