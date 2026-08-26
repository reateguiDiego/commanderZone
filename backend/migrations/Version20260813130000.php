<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20260813130000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Queue normal waiting rooms for low-cost inactivity cleanup.';
    }

    public function up(Schema $schema): void
    {
        $this->addSql('ALTER TABLE room ADD COLUMN IF NOT EXISTS waiting_expires_at TIMESTAMP(0) WITHOUT TIME ZONE DEFAULT NULL');
        $this->addSql('CREATE INDEX IF NOT EXISTS idx_room_waiting_expires_at ON room (waiting_expires_at) WHERE waiting_expires_at IS NOT NULL');
        $this->addSql(<<<'SQL'
UPDATE room
SET waiting_expires_at = updated_at + INTERVAL '30 minutes'
WHERE status = 'waiting'
  AND game_id IS NULL
  AND waiting_expires_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM table_assistant_room assistant WHERE assistant.room_id = room.id)
SQL);
    }

    public function down(Schema $schema): void
    {
        $this->addSql('DROP INDEX IF EXISTS idx_room_waiting_expires_at');
        $this->addSql('ALTER TABLE room DROP COLUMN IF EXISTS waiting_expires_at');
    }
}
