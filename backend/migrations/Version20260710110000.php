<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20260710110000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Create compact deck editor token snapshot cache.';
    }

    public function up(Schema $schema): void
    {
        $this->addSql(<<<'SQL'
CREATE TABLE IF NOT EXISTS deck_editor_token_snapshot (
    id VARCHAR(36) NOT NULL,
    deck_id VARCHAR(36) NOT NULL,
    deck_hash TEXT NOT NULL,
    card_language TEXT NOT NULL,
    payload_version TEXT NOT NULL,
    token_data_version TEXT NOT NULL,
    result_json JSONB NOT NULL,
    calculated_at TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL,
    created_at TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL,
    updated_at TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL,
    PRIMARY KEY (id),
    CONSTRAINT fk_deck_editor_token_snapshot_deck FOREIGN KEY (deck_id) REFERENCES deck (id) ON DELETE CASCADE
)
SQL);
        $this->addSql('CREATE UNIQUE INDEX IF NOT EXISTS uniq_deck_editor_token_snapshot_deck_language ON deck_editor_token_snapshot (deck_id, card_language)');
        $this->addSql('CREATE INDEX IF NOT EXISTS idx_deck_editor_token_snapshot_deck_hash ON deck_editor_token_snapshot (deck_hash)');
        $this->addSql('CREATE INDEX IF NOT EXISTS idx_deck_editor_token_snapshot_payload_version ON deck_editor_token_snapshot (payload_version)');
        $this->addSql('CREATE INDEX IF NOT EXISTS idx_deck_editor_token_snapshot_token_data_version ON deck_editor_token_snapshot (token_data_version)');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('DROP TABLE IF EXISTS deck_editor_token_snapshot');
    }
}
