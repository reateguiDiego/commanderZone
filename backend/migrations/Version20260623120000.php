<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20260623120000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Persist card rarity and set name for advanced card search filters.';
    }

    public function up(Schema $schema): void
    {
        $this->addSql('ALTER TABLE card ADD COLUMN IF NOT EXISTS rarity VARCHAR(24) DEFAULT NULL');
        $this->addSql('ALTER TABLE card ADD COLUMN IF NOT EXISTS set_name VARCHAR(255) DEFAULT NULL');
        $this->addSql('CREATE INDEX IF NOT EXISTS idx_card_rarity ON card (rarity)');
        $this->addSql('CREATE INDEX IF NOT EXISTS idx_card_set_code ON card (set_code)');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('DROP INDEX IF EXISTS idx_card_set_code');
        $this->addSql('DROP INDEX IF EXISTS idx_card_rarity');
        $this->addSql('ALTER TABLE card DROP COLUMN IF EXISTS set_name');
        $this->addSql('ALTER TABLE card DROP COLUMN IF EXISTS rarity');
    }
}
