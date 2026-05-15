<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20260511193000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Add auth hardening schema for email verification, password reset tokens and throttling';
    }

    public function up(Schema $schema): void
    {
        $this->addSql('ALTER TABLE app_user ADD email_verified_at TIMESTAMP(0) WITHOUT TIME ZONE DEFAULT NULL');
        $this->addSql('ALTER TABLE app_user ADD pending_email VARCHAR(180) DEFAULT NULL');

        $this->addSql('CREATE TABLE password_reset_token (id VARCHAR(36) NOT NULL, user_id VARCHAR(36) NOT NULL, token_hash VARCHAR(64) NOT NULL, expires_at TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL, used_at TIMESTAMP(0) WITHOUT TIME ZONE DEFAULT NULL, created_at TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL, request_ip VARCHAR(64) DEFAULT NULL, request_user_agent VARCHAR(255) DEFAULT NULL, PRIMARY KEY(id))');
        $this->addSql('CREATE UNIQUE INDEX uniq_password_reset_token_hash ON password_reset_token (token_hash)');
        $this->addSql('CREATE INDEX idx_password_reset_user ON password_reset_token (user_id)');
        $this->addSql('CREATE INDEX idx_password_reset_expires_at ON password_reset_token (expires_at)');
        $this->addSql('ALTER TABLE password_reset_token ADD CONSTRAINT FK_712F8D3FA76ED395 FOREIGN KEY (user_id) REFERENCES app_user (id) ON DELETE CASCADE NOT DEFERRABLE INITIALLY IMMEDIATE');

        $this->addSql('CREATE TABLE email_verification_token (id VARCHAR(36) NOT NULL, user_id VARCHAR(36) NOT NULL, token_hash VARCHAR(64) NOT NULL, email VARCHAR(180) NOT NULL, purpose VARCHAR(24) NOT NULL, expires_at TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL, used_at TIMESTAMP(0) WITHOUT TIME ZONE DEFAULT NULL, created_at TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL, request_ip VARCHAR(64) DEFAULT NULL, request_user_agent VARCHAR(255) DEFAULT NULL, PRIMARY KEY(id))');
        $this->addSql('CREATE UNIQUE INDEX uniq_email_verification_token_hash ON email_verification_token (token_hash)');
        $this->addSql('CREATE INDEX idx_email_verification_user ON email_verification_token (user_id)');
        $this->addSql('CREATE INDEX idx_email_verification_expires_at ON email_verification_token (expires_at)');
        $this->addSql('ALTER TABLE email_verification_token ADD CONSTRAINT FK_E3A1B53FA76ED395 FOREIGN KEY (user_id) REFERENCES app_user (id) ON DELETE CASCADE NOT DEFERRABLE INITIALLY IMMEDIATE');

        $this->addSql('CREATE TABLE login_attempt (id VARCHAR(36) NOT NULL, scope VARCHAR(16) NOT NULL, identifier VARCHAR(191) NOT NULL, failure_count INT NOT NULL, lockout_until TIMESTAMP(0) WITHOUT TIME ZONE DEFAULT NULL, last_failed_at TIMESTAMP(0) WITHOUT TIME ZONE DEFAULT NULL, PRIMARY KEY(id))');
        $this->addSql('CREATE UNIQUE INDEX uniq_login_attempt_scope_identifier ON login_attempt (scope, identifier)');

        $this->addSql('CREATE TABLE auth_request_throttle (id VARCHAR(36) NOT NULL, scope VARCHAR(48) NOT NULL, identifier VARCHAR(191) NOT NULL, hits INT NOT NULL, window_started_at TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL, PRIMARY KEY(id))');
        $this->addSql('CREATE UNIQUE INDEX uniq_auth_request_throttle_scope_identifier ON auth_request_throttle (scope, identifier)');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('DROP TABLE auth_request_throttle');
        $this->addSql('DROP TABLE login_attempt');

        $this->addSql('ALTER TABLE email_verification_token DROP CONSTRAINT FK_E3A1B53FA76ED395');
        $this->addSql('DROP TABLE email_verification_token');

        $this->addSql('ALTER TABLE password_reset_token DROP CONSTRAINT FK_712F8D3FA76ED395');
        $this->addSql('DROP TABLE password_reset_token');

        $this->addSql('ALTER TABLE app_user DROP email_verified_at');
        $this->addSql('ALTER TABLE app_user DROP pending_email');
    }
}
