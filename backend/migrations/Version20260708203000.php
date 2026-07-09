<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20260708203000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Create explicit board wipe read model for advanced deck analysis.';
    }

    public function up(Schema $schema): void
    {
        $this->addSql(
            <<<'SQL'
CREATE TABLE IF NOT EXISTS card_board_wipe_profile (
    oracle_id VARCHAR(36) NOT NULL,
    name TEXT NOT NULL,
    type_line TEXT DEFAULT NULL,
    oracle_text TEXT DEFAULT NULL,
    mana_value NUMERIC(4,1) DEFAULT NULL,
    colors JSONB NOT NULL DEFAULT '[]',
    color_identity JSONB NOT NULL DEFAULT '[]',
    is_board_wipe BOOLEAN NOT NULL DEFAULT false,
    is_creature_wipe BOOLEAN NOT NULL DEFAULT false,
    is_noncreature_wipe BOOLEAN NOT NULL DEFAULT false,
    is_permanent_wipe BOOLEAN NOT NULL DEFAULT false,
    is_pseudo_wipe BOOLEAN NOT NULL DEFAULT false,
    is_mass_removal BOOLEAN NOT NULL DEFAULT false,
    is_spot_removal_with_mass_mode BOOLEAN NOT NULL DEFAULT false,
    board_wipe_type TEXT NOT NULL DEFAULT 'other',
    wipe_method JSONB NOT NULL DEFAULT '[]',
    wipe_scope JSONB NOT NULL DEFAULT '[]',
    symmetry_profile TEXT NOT NULL DEFAULT 'unknown',
    is_instant_speed BOOLEAN NOT NULL DEFAULT false,
    is_sorcery_speed BOOLEAN NOT NULL DEFAULT false,
    is_permanent_activated BOOLEAN NOT NULL DEFAULT false,
    is_triggered_wipe BOOLEAN NOT NULL DEFAULT false,
    is_repeatable BOOLEAN NOT NULL DEFAULT false,
    is_delayed BOOLEAN NOT NULL DEFAULT false,
    printed_mana_value NUMERIC(4,1) DEFAULT NULL,
    effective_cost_min NUMERIC(4,1) DEFAULT NULL,
    has_cost_reduction BOOLEAN NOT NULL DEFAULT false,
    cost_reduction_condition TEXT DEFAULT NULL,
    is_scalable BOOLEAN NOT NULL DEFAULT false,
    x_spell BOOLEAN NOT NULL DEFAULT false,
    has_modes BOOLEAN NOT NULL DEFAULT false,
    modal_choices_count SMALLINT DEFAULT NULL,
    has_alternative_mass_mode BOOLEAN NOT NULL DEFAULT false,
    alternative_cost_type TEXT DEFAULT NULL,
    alternative_mass_cost TEXT DEFAULT NULL,
    base_mode_type TEXT NOT NULL DEFAULT 'none',
    mass_mode_type TEXT NOT NULL DEFAULT 'other',
    answers_indestructible BOOLEAN NOT NULL DEFAULT false,
    answers_regeneration BOOLEAN NOT NULL DEFAULT false,
    gets_around_hexproof_shroud BOOLEAN NOT NULL DEFAULT false,
    gets_around_ward BOOLEAN NOT NULL DEFAULT false,
    exiles_graveyards BOOLEAN NOT NULL DEFAULT false,
    prevents_rebuild BOOLEAN NOT NULL DEFAULT false,
    prevents_graveyard_recursion BOOLEAN NOT NULL DEFAULT false,
    leaves_own_board BOOLEAN NOT NULL DEFAULT false,
    protects_own_board BOOLEAN NOT NULL DEFAULT false,
    can_be_built_around BOOLEAN NOT NULL DEFAULT false,
    harms_own_board BOOLEAN NOT NULL DEFAULT false,
    rebuild_advantage BOOLEAN NOT NULL DEFAULT false,
    opponent_compensation TEXT NOT NULL DEFAULT 'none',
    commander_playability_band TEXT NOT NULL DEFAULT 'unknown',
    high_power_viable BOOLEAN NOT NULL DEFAULT false,
    cedh_viable BOOLEAN NOT NULL DEFAULT false,
    token_deck_risk BOOLEAN NOT NULL DEFAULT false,
    creature_deck_risk BOOLEAN NOT NULL DEFAULT false,
    artifact_deck_risk BOOLEAN NOT NULL DEFAULT false,
    enchantment_deck_risk BOOLEAN NOT NULL DEFAULT false,
    graveyard_deck_risk BOOLEAN NOT NULL DEFAULT false,
    needs_manual_review BOOLEAN NOT NULL DEFAULT false,
    analysis_hash TEXT NOT NULL,
    updated_at TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL,
    PRIMARY KEY (oracle_id)
)
SQL,
        );

        $this->addSql('CREATE INDEX IF NOT EXISTS idx_card_board_wipe_profile_is_board_wipe ON card_board_wipe_profile (is_board_wipe)');
        $this->addSql('CREATE INDEX IF NOT EXISTS idx_card_board_wipe_profile_type ON card_board_wipe_profile (board_wipe_type)');
        $this->addSql('CREATE INDEX IF NOT EXISTS idx_card_board_wipe_profile_symmetry ON card_board_wipe_profile (symmetry_profile)');
        $this->addSql('CREATE INDEX IF NOT EXISTS idx_card_board_wipe_profile_method_gin ON card_board_wipe_profile USING GIN (wipe_method)');
        $this->addSql('CREATE INDEX IF NOT EXISTS idx_card_board_wipe_profile_scope_gin ON card_board_wipe_profile USING GIN (wipe_scope)');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('DROP TABLE IF EXISTS card_board_wipe_profile');
    }
}
