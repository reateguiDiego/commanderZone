<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20260813103500 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Remove orphaned runtime state and enforce game-owned persistence cleanup.';
    }

    public function up(Schema $schema): void
    {
        // Earlier local schemas could miss these constraints, leaving durable
        // runtime payloads behind when a game was deleted by another path.
        // Only rows whose parent game is already absent are removed here.
        $this->addSql('DELETE FROM game_snapshot_compact snapshot_row WHERE NOT EXISTS (SELECT 1 FROM game game_row WHERE game_row.id = snapshot_row.game_id)');
        $this->addSql('DELETE FROM game_event event_row WHERE NOT EXISTS (SELECT 1 FROM game game_row WHERE game_row.id = event_row.game_id)');
        $this->addSql(<<<'SQL'
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_game_snapshot_compact_game'
    ) THEN
        ALTER TABLE game_snapshot_compact
            ADD CONSTRAINT FK_GAME_SNAPSHOT_COMPACT_GAME
            FOREIGN KEY (game_id) REFERENCES game (id) ON DELETE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_game_event_game'
    ) THEN
        ALTER TABLE game_event
            ADD CONSTRAINT FK_GAME_EVENT_GAME
            FOREIGN KEY (game_id) REFERENCES game (id) ON DELETE CASCADE;
    END IF;
END $$;
SQL);
    }

    public function down(Schema $schema): void
    {
        $this->addSql('ALTER TABLE game_event DROP CONSTRAINT IF EXISTS FK_GAME_EVENT_GAME');
        $this->addSql('ALTER TABLE game_snapshot_compact DROP CONSTRAINT IF EXISTS FK_GAME_SNAPSHOT_COMPACT_GAME');
    }
}
