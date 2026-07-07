<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20260706120000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Add Scryfall deck analysis catalog fields.';
    }

    public function up(Schema $schema): void
    {
        $this->addSql("ALTER TABLE card ADD COLUMN IF NOT EXISTS keywords JSON NOT NULL DEFAULT '[]'");
        $this->addSql('ALTER TABLE card ADD COLUMN IF NOT EXISTS edhrec_rank INT DEFAULT NULL');
        $this->addSql('ALTER TABLE card ADD COLUMN IF NOT EXISTS is_game_changer BOOLEAN NOT NULL DEFAULT false');
        $this->addSql('ALTER TABLE card ADD COLUMN IF NOT EXISTS defense TEXT DEFAULT NULL');
        $this->addSql('ALTER TABLE card ADD COLUMN IF NOT EXISTS loyalty TEXT DEFAULT NULL');
        $this->addSql('ALTER TABLE card ADD COLUMN IF NOT EXISTS mana_value NUMERIC(4,1) DEFAULT NULL');
        $this->addSql("ALTER TABLE card ADD COLUMN IF NOT EXISTS produced_mana JSON NOT NULL DEFAULT '[]'");
        $this->addSql("ALTER TABLE card ADD COLUMN IF NOT EXISTS card_faces JSON NOT NULL DEFAULT '[]'");
        $this->addSql('ALTER TABLE card ADD COLUMN IF NOT EXISTS oracle_id VARCHAR(36) DEFAULT NULL');
        $this->addSql('ALTER TABLE card ADD COLUMN IF NOT EXISTS power TEXT DEFAULT NULL');
        $this->addSql('ALTER TABLE card ADD COLUMN IF NOT EXISTS toughness TEXT DEFAULT NULL');

        $this->addSql('CREATE INDEX IF NOT EXISTS idx_card_oracle_id ON card (oracle_id)');
        $this->addSql('CREATE INDEX IF NOT EXISTS idx_card_edhrec_rank_commander_legal ON card (edhrec_rank) WHERE commander_legal = true');
        $this->addSql('CREATE INDEX IF NOT EXISTS idx_card_is_game_changer_true ON card (is_game_changer) WHERE is_game_changer = true');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('DROP INDEX IF EXISTS idx_card_is_game_changer_true');
        $this->addSql('DROP INDEX IF EXISTS idx_card_edhrec_rank_commander_legal');
        $this->addSql('ALTER TABLE card DROP COLUMN IF EXISTS defense');
        $this->addSql('ALTER TABLE card DROP COLUMN IF EXISTS is_game_changer');
        $this->addSql('ALTER TABLE card DROP COLUMN IF EXISTS edhrec_rank');
        $this->addSql('ALTER TABLE card DROP COLUMN IF EXISTS keywords');
    }
}
