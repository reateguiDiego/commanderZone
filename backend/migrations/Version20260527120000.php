<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20260527120000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Add persistent waiting room activity log entries.';
    }

    public function up(Schema $schema): void
    {
        $this->addSql("CREATE TABLE room_waiting_log_entry (id VARCHAR(36) NOT NULL, room_id VARCHAR(36) NOT NULL, label VARCHAR(255) NOT NULL, tone VARCHAR(20) NOT NULL, created_at TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL, PRIMARY KEY(id))");
        $this->addSql('CREATE INDEX idx_room_waiting_log_room_created ON room_waiting_log_entry (room_id, created_at)');
        $this->addSql('ALTER TABLE room_waiting_log_entry ADD CONSTRAINT FK_ROOM_WAITING_LOG_ROOM FOREIGN KEY (room_id) REFERENCES room (id) ON DELETE CASCADE NOT DEFERRABLE INITIALLY IMMEDIATE');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('ALTER TABLE room_waiting_log_entry DROP CONSTRAINT FK_ROOM_WAITING_LOG_ROOM');
        $this->addSql('DROP TABLE room_waiting_log_entry');
    }
}
