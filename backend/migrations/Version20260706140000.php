<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20260706140000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Create denormalized card analysis profiles for deck analysis reads.';
    }

    public function up(Schema $schema): void
    {
        $this->addSql(
            <<<'SQL'
CREATE TABLE IF NOT EXISTS card_analysis_profile (
    oracle_id VARCHAR(36) NOT NULL,
    name TEXT NOT NULL,
    normalized_name TEXT NOT NULL,
    mana_cost TEXT DEFAULT NULL,
    mana_value NUMERIC(4,1) DEFAULT NULL,
    type_line TEXT DEFAULT NULL,
    colors JSONB NOT NULL DEFAULT '[]',
    color_identity JSONB NOT NULL DEFAULT '[]',
    produced_mana JSONB NOT NULL DEFAULT '[]',
    keywords JSONB NOT NULL DEFAULT '[]',
    commander_legal BOOLEAN NOT NULL DEFAULT false,
    commander_banned BOOLEAN NOT NULL DEFAULT false,
    can_be_commander BOOLEAN NOT NULL DEFAULT false,
    is_land BOOLEAN NOT NULL DEFAULT false,
    is_creature BOOLEAN NOT NULL DEFAULT false,
    is_artifact BOOLEAN NOT NULL DEFAULT false,
    is_enchantment BOOLEAN NOT NULL DEFAULT false,
    is_instant BOOLEAN NOT NULL DEFAULT false,
    is_sorcery BOOLEAN NOT NULL DEFAULT false,
    is_planeswalker BOOLEAN NOT NULL DEFAULT false,
    is_battle BOOLEAN NOT NULL DEFAULT false,
    is_legendary BOOLEAN NOT NULL DEFAULT false,
    edhrec_rank INT DEFAULT NULL,
    is_game_changer BOOLEAN NOT NULL DEFAULT false,
    roles JSONB NOT NULL DEFAULT '[]',
    subroles JSONB NOT NULL DEFAULT '[]',
    role_scores JSONB NOT NULL DEFAULT '{}',
    condition_keys JSONB NOT NULL DEFAULT '[]',
    archetype_weights JSONB NOT NULL DEFAULT '{}',
    power_flags JSONB NOT NULL DEFAULT '[]',
    is_fast_mana BOOLEAN NOT NULL DEFAULT false,
    is_free_interaction BOOLEAN NOT NULL DEFAULT false,
    is_efficient_tutor BOOLEAN NOT NULL DEFAULT false,
    is_cedh_staple BOOLEAN NOT NULL DEFAULT false,
    analysis_hash TEXT NOT NULL,
    updated_at TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL,
    PRIMARY KEY (oracle_id)
)
SQL,
        );

        $this->addSql('CREATE INDEX IF NOT EXISTS idx_card_analysis_profile_commander_legal ON card_analysis_profile (commander_legal)');
        $this->addSql('CREATE INDEX IF NOT EXISTS idx_card_analysis_profile_edhrec_rank_commander_legal ON card_analysis_profile (edhrec_rank) WHERE commander_legal = true');
        $this->addSql('CREATE INDEX IF NOT EXISTS idx_card_analysis_profile_roles_gin ON card_analysis_profile USING GIN (roles)');
        $this->addSql('CREATE INDEX IF NOT EXISTS idx_card_analysis_profile_color_identity_gin ON card_analysis_profile USING GIN (color_identity)');
        $this->addSql('CREATE INDEX IF NOT EXISTS idx_card_analysis_profile_condition_keys_gin ON card_analysis_profile USING GIN (condition_keys)');
        $this->addSql('CREATE INDEX IF NOT EXISTS idx_card_analysis_profile_power_flags_gin ON card_analysis_profile USING GIN (power_flags)');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('DROP TABLE IF EXISTS card_analysis_profile');
    }
}
