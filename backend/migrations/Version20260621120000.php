<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20260621120000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Add compact event-sourced gameplay persistence tables and versioned game events.';
    }

    public function up(Schema $schema): void
    {
        $this->addSql('ALTER TABLE game_event ADD COLUMN IF NOT EXISTS version INT DEFAULT NULL');
        $this->addSql(<<<'SQL'
UPDATE game_event
SET version = ranked.version
FROM (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY game_id ORDER BY created_at ASC, id ASC) AS version
    FROM game_event
) AS ranked
WHERE game_event.id = ranked.id
  AND game_event.version IS NULL
SQL);
        $this->addSql('ALTER TABLE game_event ALTER COLUMN version SET NOT NULL');
        $this->addSql('CREATE UNIQUE INDEX IF NOT EXISTS uniq_game_event_version ON game_event (game_id, version)');
        $this->addSql('CREATE INDEX IF NOT EXISTS idx_game_event_game_created_at ON game_event (game_id, created_at)');

        $this->addSql(<<<'SQL'
CREATE TABLE IF NOT EXISTS game_snapshot_compact (
    id VARCHAR(36) NOT NULL,
    game_id VARCHAR(36) NOT NULL,
    version INT NOT NULL,
    snapshot JSON NOT NULL,
    checksum VARCHAR(64) NOT NULL,
    created_at TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL,
    PRIMARY KEY(id)
)
SQL);
        $this->addSql('CREATE INDEX IF NOT EXISTS idx_game_snapshot_compact_game ON game_snapshot_compact (game_id)');
        $this->addSql('CREATE UNIQUE INDEX IF NOT EXISTS uniq_game_snapshot_compact_version ON game_snapshot_compact (game_id, version)');
        $this->addSql('CREATE INDEX IF NOT EXISTS idx_game_snapshot_compact_created_at ON game_snapshot_compact (game_id, created_at)');
        $this->addSql('ALTER TABLE game_snapshot_compact ADD CONSTRAINT FK_GAME_SNAPSHOT_COMPACT_GAME FOREIGN KEY (game_id) REFERENCES game (id) ON DELETE CASCADE NOT DEFERRABLE INITIALLY IMMEDIATE');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('ALTER TABLE game_snapshot_compact DROP CONSTRAINT IF EXISTS FK_GAME_SNAPSHOT_COMPACT_GAME');
        $this->addSql('DROP TABLE IF EXISTS game_snapshot_compact');
        $this->addSql('DROP INDEX IF EXISTS idx_game_event_game_created_at');
        $this->addSql('DROP INDEX IF EXISTS uniq_game_event_version');
        $this->addSql('ALTER TABLE game_event DROP COLUMN IF EXISTS version');
    }
}
