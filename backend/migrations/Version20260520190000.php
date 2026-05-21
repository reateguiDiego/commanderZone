<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20260520190000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Add refresh session persistence for rotated HttpOnly refresh tokens.';
    }

    public function up(Schema $schema): void
    {
        $this->addSql('CREATE TABLE refresh_session (id VARCHAR(36) NOT NULL, user_id VARCHAR(36) NOT NULL, token_hash VARCHAR(64) NOT NULL, replaced_by_token_hash VARCHAR(64) DEFAULT NULL, expires_at TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL, rotated_at TIMESTAMP(0) WITHOUT TIME ZONE DEFAULT NULL, revoked_at TIMESTAMP(0) WITHOUT TIME ZONE DEFAULT NULL, last_used_at TIMESTAMP(0) WITHOUT TIME ZONE DEFAULT NULL, created_at TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL, updated_at TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL, request_ip VARCHAR(64) DEFAULT NULL, request_user_agent VARCHAR(255) DEFAULT NULL, PRIMARY KEY(id))');
        $this->addSql('CREATE INDEX idx_refresh_session_user ON refresh_session (user_id)');
        $this->addSql('CREATE INDEX idx_refresh_session_expires_at ON refresh_session (expires_at)');
        $this->addSql('CREATE UNIQUE INDEX uniq_refresh_session_token_hash ON refresh_session (token_hash)');
        $this->addSql('ALTER TABLE refresh_session ADD CONSTRAINT FK_D271A7C9A76ED395 FOREIGN KEY (user_id) REFERENCES app_user (id) ON DELETE CASCADE NOT DEFERRABLE INITIALLY IMMEDIATE');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('ALTER TABLE refresh_session DROP CONSTRAINT FK_D271A7C9A76ED395');
        $this->addSql('DROP TABLE refresh_session');
    }
}
