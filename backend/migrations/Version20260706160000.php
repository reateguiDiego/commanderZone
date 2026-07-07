<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20260706160000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Add source tracking to card analysis conditions.';
    }

    public function up(Schema $schema): void
    {
        $this->addSql("ALTER TABLE card_condition ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'rule'");
        $this->addSql('DROP INDEX IF EXISTS uniq_card_condition_oracle_condition');
        $this->addSql('CREATE INDEX IF NOT EXISTS idx_card_condition_source ON card_condition (source)');
        $this->addSql('CREATE UNIQUE INDEX IF NOT EXISTS uniq_card_condition_oracle_condition_source ON card_condition (oracle_id, condition_key, source)');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('DROP INDEX IF EXISTS uniq_card_condition_oracle_condition_source');
        $this->addSql('DROP INDEX IF EXISTS idx_card_condition_source');
        $this->addSql('CREATE UNIQUE INDEX IF NOT EXISTS uniq_card_condition_oracle_condition ON card_condition (oracle_id, condition_key)');
        $this->addSql('ALTER TABLE card_condition DROP COLUMN IF EXISTS source');
    }
}
