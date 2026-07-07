<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20260706170000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Create deck advanced analysis snapshots and data version tracking.';
    }

    public function up(Schema $schema): void
    {
        $this->addSql(
            <<<'SQL'
CREATE TABLE IF NOT EXISTS deck_analysis_data_version (
    key TEXT NOT NULL,
    version TEXT NOT NULL,
    updated_at TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL,
    PRIMARY KEY (key)
)
SQL,
        );

        $this->addSql(
            <<<'SQL'
INSERT INTO deck_analysis_data_version (key, version, updated_at)
VALUES
    ('semantic', 'initial', NOW()),
    ('combo', 'initial', NOW()),
    ('rules', 'initial', NOW())
ON CONFLICT (key) DO NOTHING
SQL,
        );

        $this->addSql(
            <<<'SQL'
CREATE TABLE IF NOT EXISTS deck_advanced_analysis_snapshot (
    id VARCHAR(36) NOT NULL,
    deck_id VARCHAR(36) NOT NULL,
    deck_hash TEXT NOT NULL,
    analyzer_version TEXT NOT NULL,
    semantic_data_version TEXT NOT NULL,
    combo_data_version TEXT NOT NULL,
    rules_version TEXT NOT NULL,
    monte_carlo_version TEXT NOT NULL,
    monte_carlo_runs INT NOT NULL,
    monte_carlo_seed TEXT NOT NULL,
    result_json JSONB NOT NULL,
    calculated_at TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL,
    created_at TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL,
    updated_at TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL,
    PRIMARY KEY (id),
    CONSTRAINT fk_deck_advanced_analysis_snapshot_deck FOREIGN KEY (deck_id) REFERENCES deck (id) ON DELETE CASCADE
)
SQL,
        );

        $this->addSql('CREATE UNIQUE INDEX IF NOT EXISTS uniq_deck_advanced_analysis_snapshot_deck_id ON deck_advanced_analysis_snapshot (deck_id)');
        $this->addSql('CREATE INDEX IF NOT EXISTS idx_deck_advanced_analysis_snapshot_deck_hash ON deck_advanced_analysis_snapshot (deck_hash)');
        $this->addSql('CREATE INDEX IF NOT EXISTS idx_deck_advanced_analysis_snapshot_analyzer_version ON deck_advanced_analysis_snapshot (analyzer_version)');
        $this->addSql('CREATE INDEX IF NOT EXISTS idx_deck_advanced_analysis_snapshot_semantic_data_version ON deck_advanced_analysis_snapshot (semantic_data_version)');
        $this->addSql('CREATE INDEX IF NOT EXISTS idx_deck_advanced_analysis_snapshot_combo_data_version ON deck_advanced_analysis_snapshot (combo_data_version)');
        $this->addSql('CREATE INDEX IF NOT EXISTS idx_deck_advanced_analysis_snapshot_rules_version ON deck_advanced_analysis_snapshot (rules_version)');
        $this->addSql('CREATE INDEX IF NOT EXISTS idx_deck_advanced_analysis_snapshot_monte_carlo_version ON deck_advanced_analysis_snapshot (monte_carlo_version)');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('DROP TABLE IF EXISTS deck_advanced_analysis_snapshot');
        $this->addSql('DROP TABLE IF EXISTS deck_analysis_data_version');
    }
}
