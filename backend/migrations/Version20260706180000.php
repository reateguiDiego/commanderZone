<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20260706180000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Create card mana profiles for advanced deck analysis.';
    }

    public function up(Schema $schema): void
    {
        $this->addSql(
            <<<'SQL'
CREATE TABLE IF NOT EXISTS card_mana_profile (
    oracle_id VARCHAR(36) NOT NULL,
    name TEXT NOT NULL,
    type_line TEXT DEFAULT NULL,
    oracle_text TEXT DEFAULT NULL,
    is_land BOOLEAN NOT NULL DEFAULT false,
    is_mdfc_land BOOLEAN NOT NULL DEFAULT false,
    is_basic_land BOOLEAN NOT NULL DEFAULT false,
    is_nonbasic_land BOOLEAN NOT NULL DEFAULT false,
    is_fetchland BOOLEAN NOT NULL DEFAULT false,
    is_typed_land BOOLEAN NOT NULL DEFAULT false,
    basic_land_types JSONB NOT NULL DEFAULT '[]',
    is_utility_land BOOLEAN NOT NULL DEFAULT false,
    is_colorless_utility_land BOOLEAN NOT NULL DEFAULT false,
    is_legendary_land BOOLEAN NOT NULL DEFAULT false,
    produced_mana_colors JSONB NOT NULL DEFAULT '[]',
    produces_colorless BOOLEAN NOT NULL DEFAULT false,
    produces_any_color BOOLEAN NOT NULL DEFAULT false,
    produces_commander_identity BOOLEAN NOT NULL DEFAULT false,
    produced_mana_is_conditional BOOLEAN NOT NULL DEFAULT false,
    produced_mana_condition_type TEXT DEFAULT NULL,
    requires_input_mana BOOLEAN NOT NULL DEFAULT false,
    requires_tap BOOLEAN NOT NULL DEFAULT false,
    requires_life_payment BOOLEAN NOT NULL DEFAULT false,
    requires_sacrifice BOOLEAN NOT NULL DEFAULT false,
    requires_creature_type_choice BOOLEAN NOT NULL DEFAULT false,
    requires_opponent_mana BOOLEAN NOT NULL DEFAULT false,
    requires_existing_source BOOLEAN NOT NULL DEFAULT false,
    is_repeatable_mana BOOLEAN NOT NULL DEFAULT false,
    is_one_shot_mana BOOLEAN NOT NULL DEFAULT false,
    enters_tapped BOOLEAN NOT NULL DEFAULT false,
    enters_tapped_conditionally BOOLEAN NOT NULL DEFAULT false,
    can_enter_untapped BOOLEAN NOT NULL DEFAULT false,
    untapped_condition_type TEXT DEFAULT NULL,
    delayed_until_turn SMALLINT DEFAULT NULL,
    usable_turn_one BOOLEAN NOT NULL DEFAULT false,
    usable_turn_two BOOLEAN NOT NULL DEFAULT false,
    mana_source_category TEXT NOT NULL DEFAULT 'other',
    land_cycle_type TEXT NOT NULL DEFAULT 'other',
    land_cycle_family TEXT DEFAULT NULL,
    land_speed_profile TEXT NOT NULL DEFAULT 'unknown',
    land_fixing_profile TEXT NOT NULL DEFAULT 'unknown',
    land_risk_profile JSONB NOT NULL DEFAULT '[]',
    land_synergy_profile JSONB NOT NULL DEFAULT '[]',
    is_permanent_ramp BOOLEAN NOT NULL DEFAULT false,
    is_fast_mana BOOLEAN NOT NULL DEFAULT false,
    is_burst_mana BOOLEAN NOT NULL DEFAULT false,
    is_ritual BOOLEAN NOT NULL DEFAULT false,
    is_mana_rock BOOLEAN NOT NULL DEFAULT false,
    is_mana_dork BOOLEAN NOT NULL DEFAULT false,
    is_land_ramp BOOLEAN NOT NULL DEFAULT false,
    is_land_search_to_hand BOOLEAN NOT NULL DEFAULT false,
    is_land_search_to_battlefield BOOLEAN NOT NULL DEFAULT false,
    is_land_tutor BOOLEAN NOT NULL DEFAULT false,
    is_fetchland_fixing BOOLEAN NOT NULL DEFAULT false,
    is_color_fixing BOOLEAN NOT NULL DEFAULT false,
    is_cost_reducer BOOLEAN NOT NULL DEFAULT false,
    is_treasure_related BOOLEAN NOT NULL DEFAULT false,
    is_landfall_enabler BOOLEAN NOT NULL DEFAULT false,
    is_domain_support BOOLEAN NOT NULL DEFAULT false,
    is_graveyard_land_synergy BOOLEAN NOT NULL DEFAULT false,
    fetchable_land_types JSONB NOT NULL DEFAULT '[]',
    can_fetch_basic BOOLEAN NOT NULL DEFAULT false,
    can_fetch_typed_nonbasic BOOLEAN NOT NULL DEFAULT false,
    fetch_puts_onto_battlefield BOOLEAN NOT NULL DEFAULT false,
    fetch_requires_sacrifice BOOLEAN NOT NULL DEFAULT false,
    fetch_life_payment BOOLEAN NOT NULL DEFAULT false,
    fetch_timing TEXT DEFAULT NULL,
    fetch_enters_untapped_itself BOOLEAN NOT NULL DEFAULT false,
    classification_status TEXT NOT NULL DEFAULT 'classified',
    needs_manual_review BOOLEAN NOT NULL DEFAULT false,
    updated_at TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL,
    PRIMARY KEY (oracle_id)
)
SQL,
        );

        $this->addSql('CREATE INDEX IF NOT EXISTS idx_card_mana_profile_category ON card_mana_profile (mana_source_category)');
        $this->addSql('CREATE INDEX IF NOT EXISTS idx_card_mana_profile_classification_status ON card_mana_profile (classification_status)');
        $this->addSql('CREATE INDEX IF NOT EXISTS idx_card_mana_profile_land_cycle_type ON card_mana_profile (land_cycle_type)');
        $this->addSql('CREATE INDEX IF NOT EXISTS idx_card_mana_profile_is_fetchland ON card_mana_profile (is_fetchland)');
        $this->addSql('CREATE INDEX IF NOT EXISTS idx_card_mana_profile_produced_colors_gin ON card_mana_profile USING GIN (produced_mana_colors)');
        $this->addSql('CREATE INDEX IF NOT EXISTS idx_card_mana_profile_risks_gin ON card_mana_profile USING GIN (land_risk_profile)');
        $this->addSql('CREATE INDEX IF NOT EXISTS idx_card_mana_profile_synergies_gin ON card_mana_profile USING GIN (land_synergy_profile)');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('DROP TABLE IF EXISTS card_mana_profile');
    }
}
