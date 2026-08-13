<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20260813090000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Hibernate all-disconnected runtimes after a short hot grace before final expiry.';
    }

    public function up(Schema $schema): void
    {
        $this->addSql('ALTER TABLE game ADD COLUMN all_disconnected_hibernate_requested_at TIMESTAMP(0) WITHOUT TIME ZONE DEFAULT NULL');
        $this->addSql("ALTER TABLE game_runtime_stop_queue ADD COLUMN action VARCHAR(16) NOT NULL DEFAULT 'stop'");
        $this->addSql("ALTER TABLE game_runtime_stop_queue ADD CONSTRAINT chk_game_runtime_stop_queue_action CHECK (action IN ('hibernate', 'stop'))");
    }

    public function down(Schema $schema): void
    {
        $this->addSql('ALTER TABLE game_runtime_stop_queue DROP CONSTRAINT IF EXISTS chk_game_runtime_stop_queue_action');
        $this->addSql('ALTER TABLE game_runtime_stop_queue DROP COLUMN action');
        $this->addSql('ALTER TABLE game DROP COLUMN all_disconnected_hibernate_requested_at');
    }
}
