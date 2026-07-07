<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20260706133000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Create internal CommanderZone card analysis tables.';
    }

    public function up(Schema $schema): void
    {
        $this->addSql(
            <<<'SQL'
CREATE TABLE IF NOT EXISTS card_role (
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
        $this->addSql('CREATE INDEX IF NOT EXISTS idx_card_role_oracle_id ON card_role (oracle_id)');
        $this->addSql('CREATE INDEX IF NOT EXISTS idx_card_role_role ON card_role (role)');
        $this->addSql("CREATE UNIQUE INDEX IF NOT EXISTS uniq_card_role_active_oracle_role_subrole ON card_role (oracle_id, role, COALESCE(subrole, '')) WHERE active = true");

        $this->addSql(
            <<<'SQL'
CREATE TABLE IF NOT EXISTS card_role_quality (
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
        $this->addSql('CREATE INDEX IF NOT EXISTS idx_card_role_quality_oracle_id ON card_role_quality (oracle_id)');
        $this->addSql('CREATE INDEX IF NOT EXISTS idx_card_role_quality_role ON card_role_quality (role)');
        $this->addSql('CREATE UNIQUE INDEX IF NOT EXISTS uniq_card_role_quality_oracle_role ON card_role_quality (oracle_id, role)');

        $this->addSql(
            <<<'SQL'
CREATE TABLE IF NOT EXISTS card_condition (
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
        $this->addSql('CREATE INDEX IF NOT EXISTS idx_card_condition_oracle_id ON card_condition (oracle_id)');
        $this->addSql('CREATE INDEX IF NOT EXISTS idx_card_condition_condition_key ON card_condition (condition_key)');
        $this->addSql('CREATE INDEX IF NOT EXISTS idx_card_condition_source ON card_condition (source)');
        $this->addSql('CREATE UNIQUE INDEX IF NOT EXISTS uniq_card_condition_oracle_condition_source ON card_condition (oracle_id, condition_key, source)');

        $this->addSql(
            <<<'SQL'
CREATE TABLE IF NOT EXISTS card_archetype_signal (
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
        $this->addSql('CREATE INDEX IF NOT EXISTS idx_card_archetype_signal_oracle_id ON card_archetype_signal (oracle_id)');
        $this->addSql('CREATE INDEX IF NOT EXISTS idx_card_archetype_signal_archetype ON card_archetype_signal (archetype)');
        $this->addSql('CREATE UNIQUE INDEX IF NOT EXISTS uniq_card_archetype_signal_oracle_archetype ON card_archetype_signal (oracle_id, archetype)');

        $this->addSql(
            <<<'SQL'
CREATE TABLE IF NOT EXISTS card_power_flag (
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
        $this->addSql('CREATE INDEX IF NOT EXISTS idx_card_power_flag_oracle_id ON card_power_flag (oracle_id)');
        $this->addSql('CREATE INDEX IF NOT EXISTS idx_card_power_flag_flag ON card_power_flag (flag)');
        $this->addSql('CREATE UNIQUE INDEX IF NOT EXISTS uniq_card_power_flag_oracle_flag ON card_power_flag (oracle_id, flag)');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('DROP TABLE IF EXISTS card_power_flag');
        $this->addSql('DROP TABLE IF EXISTS card_archetype_signal');
        $this->addSql('DROP TABLE IF EXISTS card_condition');
        $this->addSql('DROP TABLE IF EXISTS card_role_quality');
        $this->addSql('DROP TABLE IF EXISTS card_role');
    }
}
