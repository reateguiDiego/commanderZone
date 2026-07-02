<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20260701133000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Add user messages.';
    }

    public function up(Schema $schema): void
    {
        $this->addSql(
            <<<'SQL'
CREATE TABLE user_message (
    id VARCHAR(36) NOT NULL,
    sender_id VARCHAR(36) NOT NULL,
    recipient_id VARCHAR(36) NOT NULL,
    subject VARCHAR(120) NOT NULL,
    body TEXT NOT NULL,
    created_at TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL,
    read_at TIMESTAMP(0) WITHOUT TIME ZONE DEFAULT NULL,
    PRIMARY KEY(id)
)
SQL,
        );
        $this->addSql('CREATE INDEX idx_user_message_recipient_created ON user_message (recipient_id, created_at)');
        $this->addSql('CREATE INDEX idx_user_message_recipient_read ON user_message (recipient_id, read_at)');
        $this->addSql('CREATE INDEX IDX_USER_MESSAGE_SENDER ON user_message (sender_id)');
        $this->addSql('ALTER TABLE user_message ADD CONSTRAINT FK_USER_MESSAGE_SENDER FOREIGN KEY (sender_id) REFERENCES app_user (id) ON DELETE CASCADE NOT DEFERRABLE INITIALLY IMMEDIATE');
        $this->addSql('ALTER TABLE user_message ADD CONSTRAINT FK_USER_MESSAGE_RECIPIENT FOREIGN KEY (recipient_id) REFERENCES app_user (id) ON DELETE CASCADE NOT DEFERRABLE INITIALLY IMMEDIATE');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('DROP TABLE user_message');
    }
}
