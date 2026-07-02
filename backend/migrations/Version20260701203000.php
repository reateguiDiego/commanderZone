<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20260701203000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Add external auth identities for social login.';
    }

    public function up(Schema $schema): void
    {
        $this->addSql(
            <<<'SQL'
CREATE TABLE auth_identity (
    id VARCHAR(36) NOT NULL,
    user_id VARCHAR(36) NOT NULL,
    provider VARCHAR(32) NOT NULL,
    provider_user_id VARCHAR(255) NOT NULL,
    provider_email VARCHAR(180) NOT NULL,
    provider_email_verified BOOLEAN NOT NULL,
    created_at TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL,
    updated_at TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL,
    last_used_at TIMESTAMP(0) WITHOUT TIME ZONE DEFAULT NULL,
    PRIMARY KEY(id)
)
SQL,
        );
        $this->addSql('CREATE UNIQUE INDEX uniq_auth_identity_provider_user ON auth_identity (provider, provider_user_id)');
        $this->addSql('CREATE INDEX idx_auth_identity_user ON auth_identity (user_id)');
        $this->addSql('ALTER TABLE auth_identity ADD CONSTRAINT FK_AUTH_IDENTITY_USER FOREIGN KEY (user_id) REFERENCES app_user (id) ON DELETE CASCADE NOT DEFERRABLE INITIALLY IMMEDIATE');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('DROP TABLE auth_identity');
    }
}
