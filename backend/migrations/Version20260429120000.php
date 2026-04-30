<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20260429120000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Add friendships, room invites and user presence tracking.';
    }

    public function up(Schema $schema): void
    {
        $this->addSql('ALTER TABLE app_user ADD last_seen_at TIMESTAMP(0) WITHOUT TIME ZONE DEFAULT NULL');
        $this->addSql('CREATE TABLE room_invite (id VARCHAR(36) NOT NULL, room_id VARCHAR(36) NOT NULL, sender_id VARCHAR(36) NOT NULL, recipient_id VARCHAR(36) NOT NULL, status VARCHAR(24) NOT NULL, created_at TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL, updated_at TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL, PRIMARY KEY(id))');
        $this->addSql('CREATE INDEX idx_room_invite_recipient ON room_invite (recipient_id)');
        $this->addSql('CREATE INDEX idx_room_invite_room ON room_invite (room_id)');
        $this->addSql('ALTER TABLE room_invite ADD CONSTRAINT FK_85B2147554177093 FOREIGN KEY (room_id) REFERENCES room (id) ON DELETE CASCADE NOT DEFERRABLE INITIALLY IMMEDIATE');
        $this->addSql('ALTER TABLE room_invite ADD CONSTRAINT FK_85B21475F624B39D FOREIGN KEY (sender_id) REFERENCES app_user (id) ON DELETE CASCADE NOT DEFERRABLE INITIALLY IMMEDIATE');
        $this->addSql('ALTER TABLE room_invite ADD CONSTRAINT FK_85B21475E92F8F78 FOREIGN KEY (recipient_id) REFERENCES app_user (id) ON DELETE CASCADE NOT DEFERRABLE INITIALLY IMMEDIATE');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('ALTER TABLE room_invite DROP CONSTRAINT FK_85B2147554177093');
        $this->addSql('ALTER TABLE room_invite DROP CONSTRAINT FK_85B21475F624B39D');
        $this->addSql('ALTER TABLE room_invite DROP CONSTRAINT FK_85B21475E92F8F78');
        $this->addSql('DROP TABLE room_invite');
        $this->addSql('ALTER TABLE app_user DROP last_seen_at');
    }
}
