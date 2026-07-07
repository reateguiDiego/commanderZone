<?php

namespace App\Tests\Integration\Support;

use Doctrine\DBAL\Connection;

final class DeckAnalysisTestSchema
{
    public static function ensure(Connection $connection): void
    {
        self::ensureCardOracleProfileTable($connection);
        self::ensureExternalSyncRunTable($connection);
        self::ensureExternalCardTagTable($connection);
        self::ensureInternalCardAnalysisTables($connection);
        self::ensureCardAnalysisProfileTable($connection);
        self::ensureAnalysisRuleTable($connection);
        self::ensureSpellbookTables($connection);
        self::ensureComboAnalysisProfileTable($connection);
        self::ensureDeckAnalysisDataVersionTable($connection);
        self::ensureDeckAdvancedAnalysisSnapshotTable($connection);
    }

    /**
     * @return list<string>
     */
    public static function tableNames(): array
    {
        return [
            'spellbook_combo_feature',
            'spellbook_combo_requirement',
            'spellbook_combo_card',
            'combo_analysis_profile',
            'spellbook_template',
            'spellbook_feature',
            'spellbook_combo_variant',
            'analysis_rule',
            'card_analysis_profile',
            'card_oracle_profile',
            'external_card_tag',
            'external_sync_run',
            'card_power_flag',
            'card_archetype_signal',
            'card_condition',
            'card_role_quality',
            'card_role',
            'deck_advanced_analysis_snapshot',
            'deck_analysis_data_version',
        ];
    }

    private static function ensureCardOracleProfileTable(Connection $connection): void
    {
        $schemaManager = $connection->createSchemaManager();
        if ($schemaManager->tablesExist(['card_oracle_profile'])) {
            return;
        }

        $connection->executeStatement(
            <<<'SQL'
CREATE TABLE card_oracle_profile (
    oracle_id VARCHAR(36) NOT NULL,
    default_scryfall_id VARCHAR(36) DEFAULT NULL,
    name TEXT NOT NULL,
    normalized_name TEXT NOT NULL,
    mana_cost TEXT DEFAULT NULL,
    mana_value NUMERIC(4,1) DEFAULT NULL,
    type_line TEXT DEFAULT NULL,
    oracle_text TEXT DEFAULT NULL,
    colors JSON NOT NULL DEFAULT '[]',
    color_identity JSON NOT NULL DEFAULT '[]',
    produced_mana JSON NOT NULL DEFAULT '[]',
    keywords JSON NOT NULL DEFAULT '[]',
    layout TEXT DEFAULT NULL,
    card_faces JSON NOT NULL DEFAULT '[]',
    power TEXT DEFAULT NULL,
    toughness TEXT DEFAULT NULL,
    loyalty TEXT DEFAULT NULL,
    defense TEXT DEFAULT NULL,
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
    data_hash TEXT NOT NULL,
    updated_at TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL,
    PRIMARY KEY (oracle_id)
)
SQL,
        );
        $connection->executeStatement('CREATE INDEX idx_card_oracle_profile_normalized_name ON card_oracle_profile (normalized_name)');
        $connection->executeStatement('CREATE INDEX idx_card_oracle_profile_commander_legal ON card_oracle_profile (commander_legal)');
        $connection->executeStatement('CREATE INDEX idx_card_oracle_profile_edhrec_rank_commander_legal ON card_oracle_profile (edhrec_rank) WHERE commander_legal = true');
        $connection->executeStatement('CREATE INDEX idx_card_oracle_profile_is_game_changer_true ON card_oracle_profile (is_game_changer) WHERE is_game_changer = true');
    }

    private static function ensureExternalSyncRunTable(Connection $connection): void
    {
        $schemaManager = $connection->createSchemaManager();
        if ($schemaManager->tablesExist(['external_sync_run'])) {
            return;
        }

        $connection->executeStatement(
            <<<'SQL'
CREATE TABLE external_sync_run (
    id VARCHAR(36) NOT NULL,
    source TEXT NOT NULL,
    started_at TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL,
    finished_at TIMESTAMP(0) WITHOUT TIME ZONE DEFAULT NULL,
    status TEXT NOT NULL,
    items_seen INT NOT NULL DEFAULT 0,
    items_inserted INT NOT NULL DEFAULT 0,
    items_updated INT NOT NULL DEFAULT 0,
    items_failed INT NOT NULL DEFAULT 0,
    error_summary TEXT DEFAULT NULL,
    metadata JSON NOT NULL DEFAULT '{}',
    PRIMARY KEY (id)
)
SQL,
        );
        $connection->executeStatement('CREATE INDEX idx_external_sync_run_source_started ON external_sync_run (source, started_at)');
        $connection->executeStatement('CREATE INDEX idx_external_sync_run_status ON external_sync_run (status)');
    }

    private static function ensureExternalCardTagTable(Connection $connection): void
    {
        $schemaManager = $connection->createSchemaManager();
        if ($schemaManager->tablesExist(['external_card_tag'])) {
            return;
        }

        $connection->executeStatement(
            <<<'SQL'
CREATE TABLE external_card_tag (
    id VARCHAR(36) NOT NULL,
    oracle_id VARCHAR(36) NOT NULL,
    source TEXT NOT NULL,
    tag_type TEXT NOT NULL,
    tag_slug TEXT NOT NULL,
    import_query TEXT NOT NULL,
    confidence NUMERIC(3,2) NOT NULL DEFAULT 1.0,
    active BOOLEAN NOT NULL DEFAULT true,
    imported_at TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL,
    PRIMARY KEY (id)
)
SQL,
        );
        $connection->executeStatement('CREATE INDEX idx_external_card_tag_oracle_id ON external_card_tag (oracle_id)');
        $connection->executeStatement('CREATE INDEX idx_external_card_tag_tag_slug ON external_card_tag (tag_slug)');
        $connection->executeStatement('CREATE INDEX idx_external_card_tag_source_slug ON external_card_tag (source, tag_slug)');
        $connection->executeStatement('CREATE UNIQUE INDEX uniq_external_card_tag_oracle_source_slug ON external_card_tag (oracle_id, source, tag_slug)');
    }

    private static function ensureInternalCardAnalysisTables(Connection $connection): void
    {
        $schemaManager = $connection->createSchemaManager();
        if (!$schemaManager->tablesExist(['card_role'])) {
            $connection->executeStatement(
                <<<'SQL'
CREATE TABLE card_role (
    id VARCHAR(36) NOT NULL,
    oracle_id VARCHAR(36) NOT NULL,
    role TEXT NOT NULL,
    subrole TEXT DEFAULT NULL,
    confidence NUMERIC(3,2) NOT NULL DEFAULT 1.0,
    source TEXT NOT NULL,
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL,
    updated_at TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL,
    PRIMARY KEY (id)
)
SQL,
            );
            $connection->executeStatement('CREATE INDEX idx_card_role_oracle_id ON card_role (oracle_id)');
            $connection->executeStatement('CREATE INDEX idx_card_role_role ON card_role (role)');
            $connection->executeStatement("CREATE UNIQUE INDEX uniq_card_role_active_oracle_role_subrole ON card_role (oracle_id, role, COALESCE(subrole, '')) WHERE active = true");
        }

        if (!$schemaManager->tablesExist(['card_role_quality'])) {
            $connection->executeStatement(
                <<<'SQL'
CREATE TABLE card_role_quality (
    id VARCHAR(36) NOT NULL,
    oracle_id VARCHAR(36) NOT NULL,
    role TEXT NOT NULL,
    quality TEXT NOT NULL,
    speed TEXT NOT NULL,
    repeatability TEXT NOT NULL,
    mana_efficiency TEXT NOT NULL,
    conditionality TEXT NOT NULL,
    score SMALLINT NOT NULL,
    source TEXT NOT NULL,
    notes TEXT DEFAULT NULL,
    updated_at TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL,
    PRIMARY KEY (id)
)
SQL,
            );
            $connection->executeStatement('CREATE INDEX idx_card_role_quality_oracle_id ON card_role_quality (oracle_id)');
            $connection->executeStatement('CREATE INDEX idx_card_role_quality_role ON card_role_quality (role)');
            $connection->executeStatement('CREATE UNIQUE INDEX uniq_card_role_quality_oracle_role ON card_role_quality (oracle_id, role)');
        }

        if (!$schemaManager->tablesExist(['card_condition'])) {
            $connection->executeStatement(
                <<<'SQL'
CREATE TABLE card_condition (
    id VARCHAR(36) NOT NULL,
    oracle_id VARCHAR(36) NOT NULL,
    condition_key TEXT NOT NULL,
    required_role TEXT DEFAULT NULL,
    required_count SMALLINT DEFAULT NULL,
    risk_if_unmet TEXT NOT NULL,
    description TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'rule',
    updated_at TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL,
    PRIMARY KEY (id)
)
SQL,
            );
            $connection->executeStatement('CREATE INDEX idx_card_condition_oracle_id ON card_condition (oracle_id)');
            $connection->executeStatement('CREATE INDEX idx_card_condition_condition_key ON card_condition (condition_key)');
            $connection->executeStatement('CREATE INDEX idx_card_condition_source ON card_condition (source)');
            $connection->executeStatement('CREATE UNIQUE INDEX uniq_card_condition_oracle_condition_source ON card_condition (oracle_id, condition_key, source)');
        }
        $connection->executeStatement("ALTER TABLE card_condition ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'rule'");
        $connection->executeStatement('DROP INDEX IF EXISTS uniq_card_condition_oracle_condition');
        $connection->executeStatement('CREATE INDEX IF NOT EXISTS idx_card_condition_source ON card_condition (source)');
        $connection->executeStatement('CREATE UNIQUE INDEX IF NOT EXISTS uniq_card_condition_oracle_condition_source ON card_condition (oracle_id, condition_key, source)');

        if (!$schemaManager->tablesExist(['card_archetype_signal'])) {
            $connection->executeStatement(
                <<<'SQL'
CREATE TABLE card_archetype_signal (
    id VARCHAR(36) NOT NULL,
    oracle_id VARCHAR(36) NOT NULL,
    archetype TEXT NOT NULL,
    weight SMALLINT NOT NULL,
    source TEXT NOT NULL,
    evidence TEXT DEFAULT NULL,
    updated_at TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL,
    PRIMARY KEY (id)
)
SQL,
            );
            $connection->executeStatement('CREATE INDEX idx_card_archetype_signal_oracle_id ON card_archetype_signal (oracle_id)');
            $connection->executeStatement('CREATE INDEX idx_card_archetype_signal_archetype ON card_archetype_signal (archetype)');
            $connection->executeStatement('CREATE UNIQUE INDEX uniq_card_archetype_signal_oracle_archetype ON card_archetype_signal (oracle_id, archetype)');
        }

        if (!$schemaManager->tablesExist(['card_power_flag'])) {
            $connection->executeStatement(
                <<<'SQL'
CREATE TABLE card_power_flag (
    id VARCHAR(36) NOT NULL,
    oracle_id VARCHAR(36) NOT NULL,
    flag TEXT NOT NULL,
    source TEXT NOT NULL,
    weight SMALLINT NOT NULL,
    updated_at TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL,
    PRIMARY KEY (id)
)
SQL,
            );
            $connection->executeStatement('CREATE INDEX idx_card_power_flag_oracle_id ON card_power_flag (oracle_id)');
            $connection->executeStatement('CREATE INDEX idx_card_power_flag_flag ON card_power_flag (flag)');
            $connection->executeStatement('CREATE UNIQUE INDEX uniq_card_power_flag_oracle_flag ON card_power_flag (oracle_id, flag)');
        }
    }

    private static function ensureCardAnalysisProfileTable(Connection $connection): void
    {
        $schemaManager = $connection->createSchemaManager();
        if ($schemaManager->tablesExist(['card_analysis_profile'])) {
            return;
        }

        $connection->executeStatement(
            <<<'SQL'
CREATE TABLE card_analysis_profile (
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
        $connection->executeStatement('CREATE INDEX idx_card_analysis_profile_commander_legal ON card_analysis_profile (commander_legal)');
        $connection->executeStatement('CREATE INDEX idx_card_analysis_profile_edhrec_rank_commander_legal ON card_analysis_profile (edhrec_rank) WHERE commander_legal = true');
        $connection->executeStatement('CREATE INDEX idx_card_analysis_profile_roles_gin ON card_analysis_profile USING GIN (roles)');
        $connection->executeStatement('CREATE INDEX idx_card_analysis_profile_color_identity_gin ON card_analysis_profile USING GIN (color_identity)');
        $connection->executeStatement('CREATE INDEX idx_card_analysis_profile_condition_keys_gin ON card_analysis_profile USING GIN (condition_keys)');
        $connection->executeStatement('CREATE INDEX idx_card_analysis_profile_power_flags_gin ON card_analysis_profile USING GIN (power_flags)');
    }

    private static function ensureAnalysisRuleTable(Connection $connection): void
    {
        $schemaManager = $connection->createSchemaManager();
        if ($schemaManager->tablesExist(['analysis_rule'])) {
            return;
        }

        $connection->executeStatement(
            <<<'SQL'
CREATE TABLE analysis_rule (
    id VARCHAR(36) NOT NULL,
    format TEXT NOT NULL,
    archetype TEXT DEFAULT NULL,
    power_band TEXT DEFAULT NULL,
    metric TEXT NOT NULL,
    min_recommended NUMERIC DEFAULT NULL,
    max_recommended NUMERIC DEFAULT NULL,
    severity TEXT NOT NULL,
    message_key TEXT NOT NULL,
    active BOOLEAN NOT NULL DEFAULT true,
    updated_at TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL,
    PRIMARY KEY (id)
)
SQL,
        );
        $connection->executeStatement('CREATE INDEX idx_analysis_rule_format ON analysis_rule (format)');
        $connection->executeStatement('CREATE INDEX idx_analysis_rule_archetype ON analysis_rule (archetype)');
        $connection->executeStatement('CREATE INDEX idx_analysis_rule_metric ON analysis_rule (metric)');
        $connection->executeStatement('CREATE INDEX idx_analysis_rule_active ON analysis_rule (active)');
        $connection->executeStatement("CREATE UNIQUE INDEX uniq_analysis_rule_identity ON analysis_rule (format, COALESCE(archetype, ''), COALESCE(power_band, ''), metric, message_key)");
    }

    private static function ensureSpellbookTables(Connection $connection): void
    {
        $schemaManager = $connection->createSchemaManager();
        if (!$schemaManager->tablesExist(['spellbook_combo_variant'])) {
            $connection->executeStatement(
                <<<'SQL'
CREATE TABLE spellbook_combo_variant (
    id VARCHAR(36) NOT NULL,
    external_id TEXT NOT NULL,
    identity JSONB NOT NULL DEFAULT '[]',
    status TEXT DEFAULT NULL,
    popularity INT DEFAULT NULL,
    bracket_tag TEXT DEFAULT NULL,
    description TEXT DEFAULT NULL,
    mana_needed TEXT DEFAULT NULL,
    mana_value_needed NUMERIC(5,1) DEFAULT NULL,
    easy_prerequisites TEXT DEFAULT NULL,
    notable_prerequisites TEXT DEFAULT NULL,
    variant_count INT DEFAULT NULL,
    source_hash TEXT NOT NULL,
    synced_at TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL,
    PRIMARY KEY (id)
)
SQL,
            );
            $connection->executeStatement('CREATE UNIQUE INDEX uniq_spellbook_combo_variant_external_id ON spellbook_combo_variant (external_id)');
        }

        if (!$schemaManager->tablesExist(['spellbook_feature'])) {
            $connection->executeStatement(
                <<<'SQL'
CREATE TABLE spellbook_feature (
    id VARCHAR(36) NOT NULL,
    external_id TEXT NOT NULL,
    name TEXT NOT NULL,
    normalized_name TEXT NOT NULL,
    feature_type TEXT DEFAULT NULL,
    uncountable BOOLEAN NOT NULL DEFAULT false,
    status TEXT DEFAULT NULL,
    PRIMARY KEY (id)
)
SQL,
            );
            $connection->executeStatement('CREATE UNIQUE INDEX uniq_spellbook_feature_external_id ON spellbook_feature (external_id)');
            $connection->executeStatement('CREATE INDEX idx_spellbook_feature_feature_type ON spellbook_feature (feature_type)');
        }

        if (!$schemaManager->tablesExist(['spellbook_template'])) {
            $connection->executeStatement(
                <<<'SQL'
CREATE TABLE spellbook_template (
    id VARCHAR(36) NOT NULL,
    external_id TEXT NOT NULL,
    name TEXT NOT NULL,
    scryfall_query TEXT DEFAULT NULL,
    scryfall_api TEXT DEFAULT NULL,
    PRIMARY KEY (id)
)
SQL,
            );
            $connection->executeStatement('CREATE UNIQUE INDEX uniq_spellbook_template_external_id ON spellbook_template (external_id)');
        }

        if (!$schemaManager->tablesExist(['spellbook_combo_card'])) {
            $connection->executeStatement(
                <<<'SQL'
CREATE TABLE spellbook_combo_card (
    id VARCHAR(36) NOT NULL,
    combo_variant_id VARCHAR(36) NOT NULL,
    oracle_id VARCHAR(36) NOT NULL,
    name TEXT NOT NULL,
    quantity SMALLINT NOT NULL DEFAULT 1,
    zone_locations JSONB NOT NULL DEFAULT '[]',
    must_be_commander BOOLEAN NOT NULL DEFAULT false,
    battlefield_card_state TEXT DEFAULT NULL,
    graveyard_card_state TEXT DEFAULT NULL,
    library_card_state TEXT DEFAULT NULL,
    exile_card_state TEXT DEFAULT NULL,
    PRIMARY KEY (id),
    CONSTRAINT fk_spellbook_combo_card_variant FOREIGN KEY (combo_variant_id) REFERENCES spellbook_combo_variant (id) ON DELETE CASCADE
)
SQL,
            );
            $connection->executeStatement('CREATE INDEX idx_spellbook_combo_card_oracle_id ON spellbook_combo_card (oracle_id)');
            $connection->executeStatement('CREATE INDEX idx_spellbook_combo_card_combo_variant_id ON spellbook_combo_card (combo_variant_id)');
        }

        if (!$schemaManager->tablesExist(['spellbook_combo_feature'])) {
            $connection->executeStatement(
                <<<'SQL'
CREATE TABLE spellbook_combo_feature (
    combo_variant_id VARCHAR(36) NOT NULL,
    feature_id VARCHAR(36) NOT NULL,
    quantity INT DEFAULT NULL,
    PRIMARY KEY (combo_variant_id, feature_id),
    CONSTRAINT fk_spellbook_combo_feature_variant FOREIGN KEY (combo_variant_id) REFERENCES spellbook_combo_variant (id) ON DELETE CASCADE,
    CONSTRAINT fk_spellbook_combo_feature_feature FOREIGN KEY (feature_id) REFERENCES spellbook_feature (id) ON DELETE CASCADE
)
SQL,
            );
        }

        if (!$schemaManager->tablesExist(['spellbook_combo_requirement'])) {
            $connection->executeStatement(
                <<<'SQL'
CREATE TABLE spellbook_combo_requirement (
    id VARCHAR(36) NOT NULL,
    combo_variant_id VARCHAR(36) NOT NULL,
    template_id VARCHAR(36) DEFAULT NULL,
    quantity SMALLINT NOT NULL DEFAULT 1,
    zone_locations JSONB NOT NULL DEFAULT '[]',
    must_be_commander BOOLEAN NOT NULL DEFAULT false,
    battlefield_card_state TEXT DEFAULT NULL,
    graveyard_card_state TEXT DEFAULT NULL,
    library_card_state TEXT DEFAULT NULL,
    exile_card_state TEXT DEFAULT NULL,
    PRIMARY KEY (id),
    CONSTRAINT fk_spellbook_combo_requirement_variant FOREIGN KEY (combo_variant_id) REFERENCES spellbook_combo_variant (id) ON DELETE CASCADE,
    CONSTRAINT fk_spellbook_combo_requirement_template FOREIGN KEY (template_id) REFERENCES spellbook_template (id) ON DELETE SET NULL
)
SQL,
            );
            $connection->executeStatement('CREATE INDEX idx_spellbook_combo_requirement_combo_variant_id ON spellbook_combo_requirement (combo_variant_id)');
            $connection->executeStatement('CREATE INDEX idx_spellbook_combo_requirement_template_id ON spellbook_combo_requirement (template_id)');
        }
    }

    private static function ensureComboAnalysisProfileTable(Connection $connection): void
    {
        $schemaManager = $connection->createSchemaManager();
        if ($schemaManager->tablesExist(['combo_analysis_profile'])) {
            return;
        }

        $connection->executeStatement(
            <<<'SQL'
CREATE TABLE combo_analysis_profile (
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
        $connection->executeStatement('CREATE INDEX idx_combo_analysis_profile_required_oracle_ids_gin ON combo_analysis_profile USING GIN (required_oracle_ids)');
        $connection->executeStatement('CREATE INDEX idx_combo_analysis_profile_features_gin ON combo_analysis_profile USING GIN (features)');
        $connection->executeStatement('CREATE INDEX idx_combo_analysis_profile_produces_win ON combo_analysis_profile (produces_win)');
        $connection->executeStatement('CREATE INDEX idx_combo_analysis_profile_produces_infinite_mana ON combo_analysis_profile (produces_infinite_mana)');
        $connection->executeStatement('CREATE INDEX idx_combo_analysis_profile_bracket_tag ON combo_analysis_profile (bracket_tag)');
    }

    private static function ensureDeckAnalysisDataVersionTable(Connection $connection): void
    {
        $schemaManager = $connection->createSchemaManager();
        if (!$schemaManager->tablesExist(['deck_analysis_data_version'])) {
            $connection->executeStatement(
                <<<'SQL'
CREATE TABLE deck_analysis_data_version (
    key TEXT NOT NULL,
    version TEXT NOT NULL,
    updated_at TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL,
    PRIMARY KEY (key)
)
SQL,
            );
        }

        $connection->executeStatement(
            <<<'SQL'
INSERT INTO deck_analysis_data_version (key, version, updated_at)
VALUES
    ('semantic', 'initial', NOW()),
    ('combo', 'initial', NOW()),
    ('rules', 'initial', NOW())
ON CONFLICT (key) DO NOTHING
SQL,
        );
    }

    private static function ensureDeckAdvancedAnalysisSnapshotTable(Connection $connection): void
    {
        $schemaManager = $connection->createSchemaManager();
        if ($schemaManager->tablesExist(['deck_advanced_analysis_snapshot'])) {
            return;
        }

        $connection->executeStatement(
            <<<'SQL'
CREATE TABLE deck_advanced_analysis_snapshot (
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
        $connection->executeStatement('CREATE UNIQUE INDEX uniq_deck_advanced_analysis_snapshot_deck_id ON deck_advanced_analysis_snapshot (deck_id)');
        $connection->executeStatement('CREATE INDEX idx_deck_advanced_analysis_snapshot_deck_hash ON deck_advanced_analysis_snapshot (deck_hash)');
        $connection->executeStatement('CREATE INDEX idx_deck_advanced_analysis_snapshot_analyzer_version ON deck_advanced_analysis_snapshot (analyzer_version)');
        $connection->executeStatement('CREATE INDEX idx_deck_advanced_analysis_snapshot_semantic_data_version ON deck_advanced_analysis_snapshot (semantic_data_version)');
        $connection->executeStatement('CREATE INDEX idx_deck_advanced_analysis_snapshot_combo_data_version ON deck_advanced_analysis_snapshot (combo_data_version)');
        $connection->executeStatement('CREATE INDEX idx_deck_advanced_analysis_snapshot_rules_version ON deck_advanced_analysis_snapshot (rules_version)');
    }
}
