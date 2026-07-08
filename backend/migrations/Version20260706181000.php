<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20260706181000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Track mana analysis data version for advanced deck analysis snapshots.';
    }

    public function up(Schema $schema): void
    {
        $this->addSql(
            <<<'SQL'
INSERT INTO deck_analysis_data_version (key, version, updated_at)
VALUES ('mana', 'initial', NOW())
ON CONFLICT (key) DO NOTHING
SQL,
        );

        $this->addSql("ALTER TABLE deck_advanced_analysis_snapshot ADD COLUMN IF NOT EXISTS mana_data_version TEXT NOT NULL DEFAULT 'initial'");
        $this->addSql('ALTER TABLE deck_advanced_analysis_snapshot ALTER COLUMN mana_data_version DROP DEFAULT');
        $this->addSql('CREATE INDEX IF NOT EXISTS idx_deck_advanced_analysis_snapshot_mana_data_version ON deck_advanced_analysis_snapshot (mana_data_version)');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('DROP INDEX IF EXISTS idx_deck_advanced_analysis_snapshot_mana_data_version');
        $this->addSql('ALTER TABLE deck_advanced_analysis_snapshot DROP COLUMN IF EXISTS mana_data_version');
        $this->addSql("DELETE FROM deck_analysis_data_version WHERE key = 'mana'");
    }
}
