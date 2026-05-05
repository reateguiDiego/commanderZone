<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20260505090000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Normalize friendship schema and ensure idempotent game event action IDs.';
    }

    public function up(Schema $schema): void
    {
        $this->addSql('ALTER TABLE friendship ADD COLUMN IF NOT EXISTS relation_key VARCHAR(73)');
        $this->addSql("
            UPDATE friendship
            SET relation_key = CASE
                WHEN requester_id <= recipient_id THEN requester_id || ':' || recipient_id
                ELSE recipient_id || ':' || requester_id
            END
            WHERE relation_key IS NULL OR relation_key = ''
        ");
        $this->addSql('ALTER TABLE friendship ALTER COLUMN relation_key SET NOT NULL');
        $this->addSql('ALTER TABLE friendship ALTER COLUMN status TYPE VARCHAR(16)');
        $this->addSql('DROP INDEX IF EXISTS uniq_friendship_pair');
        $this->addSql('DROP INDEX IF EXISTS idx_friendship_requester');
        $this->addSql('DROP INDEX IF EXISTS idx_friendship_recipient');
        $this->addSql('CREATE UNIQUE INDEX IF NOT EXISTS uniq_friendship_relation_key ON friendship (relation_key)');
        $this->addSql('CREATE INDEX IF NOT EXISTS idx_friendship_requester_status ON friendship (requester_id, status)');
        $this->addSql('CREATE INDEX IF NOT EXISTS idx_friendship_recipient_status ON friendship (recipient_id, status)');
        $this->addSql('ALTER TABLE game_event ADD COLUMN IF NOT EXISTS client_action_id VARCHAR(120) DEFAULT NULL');
        $this->addSql('CREATE UNIQUE INDEX IF NOT EXISTS uniq_game_event_client_action ON game_event (game_id, client_action_id)');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('DROP INDEX IF EXISTS uniq_game_event_client_action');
        $this->addSql('ALTER TABLE game_event DROP COLUMN IF EXISTS client_action_id');
        $this->addSql('DROP INDEX IF EXISTS idx_friendship_requester_status');
        $this->addSql('DROP INDEX IF EXISTS idx_friendship_recipient_status');
        $this->addSql('DROP INDEX IF EXISTS uniq_friendship_relation_key');
        $this->addSql('CREATE INDEX IF NOT EXISTS idx_friendship_requester ON friendship (requester_id)');
        $this->addSql('CREATE INDEX IF NOT EXISTS idx_friendship_recipient ON friendship (recipient_id)');
        $this->addSql('CREATE UNIQUE INDEX IF NOT EXISTS uniq_friendship_pair ON friendship (LEAST(requester_id, recipient_id), GREATEST(requester_id, recipient_id))');
        $this->addSql('ALTER TABLE friendship DROP COLUMN IF EXISTS relation_key');
    }
}
