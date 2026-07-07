<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20260706123000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Create canonical card oracle profiles for deck analysis.';
    }

    public function up(Schema $schema): void
    {
        $this->addSql(
            <<<'SQL'
CREATE TABLE IF NOT EXISTS card_oracle_profile (
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

        $this->addSql('CREATE INDEX IF NOT EXISTS idx_card_oracle_profile_normalized_name ON card_oracle_profile (normalized_name)');
        $this->addSql('CREATE INDEX IF NOT EXISTS idx_card_oracle_profile_commander_legal ON card_oracle_profile (commander_legal)');
        $this->addSql('CREATE INDEX IF NOT EXISTS idx_card_oracle_profile_edhrec_rank_commander_legal ON card_oracle_profile (edhrec_rank) WHERE commander_legal = true');
        $this->addSql('CREATE INDEX IF NOT EXISTS idx_card_oracle_profile_is_game_changer_true ON card_oracle_profile (is_game_changer) WHERE is_game_changer = true');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('DROP TABLE IF EXISTS card_oracle_profile');
    }
}
