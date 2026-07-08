<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20260706150000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Create Commander Spellbook combo import tables.';
    }

    public function up(Schema $schema): void
    {
        $this->addSql(
            <<<'SQL'
CREATE TABLE IF NOT EXISTS spellbook_combo_variant (
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
        $this->addSql('CREATE UNIQUE INDEX IF NOT EXISTS uniq_spellbook_combo_variant_external_id ON spellbook_combo_variant (external_id)');

        $this->addSql(
            <<<'SQL'
CREATE TABLE IF NOT EXISTS spellbook_feature (
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
        $this->addSql('CREATE UNIQUE INDEX IF NOT EXISTS uniq_spellbook_feature_external_id ON spellbook_feature (external_id)');
        $this->addSql('CREATE INDEX IF NOT EXISTS idx_spellbook_feature_feature_type ON spellbook_feature (feature_type)');

        $this->addSql(
            <<<'SQL'
CREATE TABLE IF NOT EXISTS spellbook_template (
    id VARCHAR(36) NOT NULL,
    external_id TEXT NOT NULL,
    name TEXT NOT NULL,
    scryfall_query TEXT DEFAULT NULL,
    scryfall_api TEXT DEFAULT NULL,
    PRIMARY KEY (id)
)
SQL,
        );
        $this->addSql('CREATE UNIQUE INDEX IF NOT EXISTS uniq_spellbook_template_external_id ON spellbook_template (external_id)');

        $this->addSql(
            <<<'SQL'
CREATE TABLE IF NOT EXISTS spellbook_combo_card (
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
        $this->addSql('CREATE INDEX IF NOT EXISTS idx_spellbook_combo_card_oracle_id ON spellbook_combo_card (oracle_id)');
        $this->addSql('CREATE INDEX IF NOT EXISTS idx_spellbook_combo_card_combo_variant_id ON spellbook_combo_card (combo_variant_id)');

        $this->addSql(
            <<<'SQL'
CREATE TABLE IF NOT EXISTS spellbook_combo_feature (
    combo_variant_id VARCHAR(36) NOT NULL,
    feature_id VARCHAR(36) NOT NULL,
    quantity INT DEFAULT NULL,
    PRIMARY KEY (combo_variant_id, feature_id),
    CONSTRAINT fk_spellbook_combo_feature_variant FOREIGN KEY (combo_variant_id) REFERENCES spellbook_combo_variant (id) ON DELETE CASCADE,
    CONSTRAINT fk_spellbook_combo_feature_feature FOREIGN KEY (feature_id) REFERENCES spellbook_feature (id) ON DELETE CASCADE
)
SQL,
        );

        $this->addSql(
            <<<'SQL'
CREATE TABLE IF NOT EXISTS spellbook_combo_requirement (
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
        $this->addSql('CREATE INDEX IF NOT EXISTS idx_spellbook_combo_requirement_combo_variant_id ON spellbook_combo_requirement (combo_variant_id)');
        $this->addSql('CREATE INDEX IF NOT EXISTS idx_spellbook_combo_requirement_template_id ON spellbook_combo_requirement (template_id)');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('DROP TABLE IF EXISTS spellbook_combo_requirement');
        $this->addSql('DROP TABLE IF EXISTS spellbook_combo_feature');
        $this->addSql('DROP TABLE IF EXISTS spellbook_combo_card');
        $this->addSql('DROP TABLE IF EXISTS spellbook_template');
        $this->addSql('DROP TABLE IF EXISTS spellbook_feature');
        $this->addSql('DROP TABLE IF EXISTS spellbook_combo_variant');
    }
}
