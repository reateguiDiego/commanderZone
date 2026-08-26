<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20260810130000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Persist the indexed game lifecycle control-plane projection and idempotency cursor.';
    }

    public function up(Schema $schema): void
    {
        $this->addSql(<<<'SQL'
ALTER TABLE game
    ADD COLUMN lifecycle_state JSON NOT NULL DEFAULT '{"players": {}}',
    ADD COLUMN winner_player_id VARCHAR(36) DEFAULT NULL,
    ADD COLUMN finished_at TIMESTAMP(0) WITHOUT TIME ZONE DEFAULT NULL,
    ADD COLUMN finish_reason VARCHAR(40) DEFAULT NULL,
    ADD COLUMN all_disconnected_since TIMESTAMP(0) WITHOUT TIME ZONE DEFAULT NULL,
    ADD COLUMN next_lifecycle_at TIMESTAMP(0) WITHOUT TIME ZONE DEFAULT NULL,
    ADD COLUMN lifecycle_generation INT NOT NULL DEFAULT 0,
    ADD COLUMN lifecycle_fencing BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN lifecycle_version INT NOT NULL DEFAULT 0,
    ADD COLUMN last_lifecycle_event_id VARCHAR(120) DEFAULT NULL,
    ADD COLUMN last_lifecycle_occurred_at TIMESTAMP(0) WITHOUT TIME ZONE DEFAULT NULL
SQL);
        $this->addSql(<<<'SQL'
ALTER TABLE game
    ALTER COLUMN lifecycle_state DROP DEFAULT,
    ALTER COLUMN lifecycle_generation DROP DEFAULT,
    ALTER COLUMN lifecycle_fencing DROP DEFAULT,
    ALTER COLUMN lifecycle_version DROP DEFAULT
SQL);
        $this->addSql('CREATE INDEX idx_game_next_lifecycle_at ON game (next_lifecycle_at) WHERE next_lifecycle_at IS NOT NULL');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('DROP INDEX IF EXISTS idx_game_next_lifecycle_at');
        $this->addSql(<<<'SQL'
ALTER TABLE game
    DROP COLUMN lifecycle_state,
    DROP COLUMN winner_player_id,
    DROP COLUMN finished_at,
    DROP COLUMN finish_reason,
    DROP COLUMN all_disconnected_since,
    DROP COLUMN next_lifecycle_at,
    DROP COLUMN lifecycle_generation,
    DROP COLUMN lifecycle_fencing,
    DROP COLUMN lifecycle_version,
    DROP COLUMN last_lifecycle_event_id,
    DROP COLUMN last_lifecycle_occurred_at
SQL);
    }
}
