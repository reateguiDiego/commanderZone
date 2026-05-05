<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20260429180000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Add idempotency key support to game events.';
    }

    public function up(Schema $schema): void
    {
        $this->addSql('ALTER TABLE game_event ADD COLUMN IF NOT EXISTS client_action_id VARCHAR(120) DEFAULT NULL');
        $this->addSql('CREATE UNIQUE INDEX IF NOT EXISTS uniq_game_event_client_action ON game_event (game_id, client_action_id)');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('DROP INDEX uniq_game_event_client_action');
        $this->addSql('ALTER TABLE game_event DROP client_action_id');
    }
}
