<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20260706153000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Create denormalized Commander Spellbook combo analysis profiles.';
    }

    public function up(Schema $schema): void
    {
        $this->addSql(
            <<<'SQL'
CREATE TABLE IF NOT EXISTS combo_analysis_profile (
    combo_variant_id VARCHAR(36) NOT NULL,
    external_id TEXT NOT NULL,
    required_oracle_ids JSONB NOT NULL DEFAULT '[]',
    required_count SMALLINT NOT NULL,
    combo_size SMALLINT NOT NULL,
    identity JSONB NOT NULL DEFAULT '[]',
    features JSONB NOT NULL DEFAULT '[]',
    produces_win BOOLEAN NOT NULL DEFAULT false,
    produces_infinite_mana BOOLEAN NOT NULL DEFAULT false,
    produces_infinite_damage BOOLEAN NOT NULL DEFAULT false,
    produces_infinite_tokens BOOLEAN NOT NULL DEFAULT false,
    produces_infinite_draw BOOLEAN NOT NULL DEFAULT false,
    produces_mill BOOLEAN NOT NULL DEFAULT false,
    produces_lock BOOLEAN NOT NULL DEFAULT false,
    requires_commander BOOLEAN NOT NULL DEFAULT false,
    requires_graveyard BOOLEAN NOT NULL DEFAULT false,
    requires_battlefield BOOLEAN NOT NULL DEFAULT false,
    requires_template BOOLEAN NOT NULL DEFAULT false,
    popularity INT DEFAULT NULL,
    bracket_tag TEXT DEFAULT NULL,
    combo_power_score SMALLINT DEFAULT NULL,
    combo_complexity_score SMALLINT DEFAULT NULL,
    analysis_hash TEXT NOT NULL,
    updated_at TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL,
    PRIMARY KEY (combo_variant_id),
    CONSTRAINT fk_combo_analysis_profile_variant FOREIGN KEY (combo_variant_id) REFERENCES spellbook_combo_variant (id) ON DELETE CASCADE
)
SQL,
        );

        $this->addSql('CREATE INDEX IF NOT EXISTS idx_combo_analysis_profile_required_oracle_ids_gin ON combo_analysis_profile USING GIN (required_oracle_ids)');
        $this->addSql('CREATE INDEX IF NOT EXISTS idx_combo_analysis_profile_features_gin ON combo_analysis_profile USING GIN (features)');
        $this->addSql('CREATE INDEX IF NOT EXISTS idx_combo_analysis_profile_produces_win ON combo_analysis_profile (produces_win)');
        $this->addSql('CREATE INDEX IF NOT EXISTS idx_combo_analysis_profile_produces_infinite_mana ON combo_analysis_profile (produces_infinite_mana)');
        $this->addSql('CREATE INDEX IF NOT EXISTS idx_combo_analysis_profile_bracket_tag ON combo_analysis_profile (bracket_tag)');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('DROP TABLE IF EXISTS combo_analysis_profile');
    }
}
