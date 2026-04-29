<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20260429123000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Add table assistant rooms linked to existing rooms.';
    }

    public function up(Schema $schema): void
    {
        $this->addSql('CREATE TABLE table_assistant_room (id VARCHAR(36) NOT NULL, room_id VARCHAR(36) NOT NULL, snapshot JSON NOT NULL, applied_action_ids JSON NOT NULL, version INT NOT NULL, created_at TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL, updated_at TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL, PRIMARY KEY(id))');
        $this->addSql('CREATE UNIQUE INDEX uniq_table_assistant_room_room ON table_assistant_room (room_id)');
        $this->addSql('ALTER TABLE table_assistant_room ADD CONSTRAINT FK_7E7A17B454177093 FOREIGN KEY (room_id) REFERENCES room (id) ON DELETE CASCADE NOT DEFERRABLE INITIALLY IMMEDIATE');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('ALTER TABLE table_assistant_room DROP CONSTRAINT FK_7E7A17B454177093');
        $this->addSql('DROP TABLE table_assistant_room');
    }
}

