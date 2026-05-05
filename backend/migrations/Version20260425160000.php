<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20260425160000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Add user friendships.';
    }

    public function up(Schema $schema): void
    {
        $this->addSql('CREATE TABLE IF NOT EXISTS friendship (id VARCHAR(36) NOT NULL, requester_id VARCHAR(36) NOT NULL, recipient_id VARCHAR(36) NOT NULL, relation_key VARCHAR(73) NOT NULL, status VARCHAR(16) NOT NULL, created_at TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL, updated_at TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL, PRIMARY KEY(id))');
        $this->addSql('CREATE UNIQUE INDEX IF NOT EXISTS uniq_friendship_relation_key ON friendship (relation_key)');
        $this->addSql('CREATE INDEX IF NOT EXISTS idx_friendship_requester_status ON friendship (requester_id, status)');
        $this->addSql('CREATE INDEX IF NOT EXISTS idx_friendship_recipient_status ON friendship (recipient_id, status)');
        $this->addSql('CREATE INDEX IF NOT EXISTS IDX_7234A45FED442CF4 ON friendship (requester_id)');
        $this->addSql('CREATE INDEX IF NOT EXISTS IDX_7234A45FE92F8F78 ON friendship (recipient_id)');
        $this->addSql("
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1
                    FROM pg_constraint
                    WHERE conname = 'fk_65a8b1a4ed442cf4'
                ) THEN
                    ALTER TABLE friendship
                    ADD CONSTRAINT FK_65A8B1A4ED442CF4 FOREIGN KEY (requester_id) REFERENCES app_user (id) ON DELETE CASCADE NOT DEFERRABLE INITIALLY IMMEDIATE;
                END IF;
            END
            $$;
        ");
        $this->addSql("
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1
                    FROM pg_constraint
                    WHERE conname = 'fk_65a8b1a4e92f8f78'
                ) THEN
                    ALTER TABLE friendship
                    ADD CONSTRAINT FK_65A8B1A4E92F8F78 FOREIGN KEY (recipient_id) REFERENCES app_user (id) ON DELETE CASCADE NOT DEFERRABLE INITIALLY IMMEDIATE;
                END IF;
            END
            $$;
        ");
    }

    public function down(Schema $schema): void
    {
        $this->addSql('ALTER TABLE friendship DROP CONSTRAINT FK_65A8B1A4ED442CF4');
        $this->addSql('ALTER TABLE friendship DROP CONSTRAINT FK_65A8B1A4E92F8F78');
        $this->addSql('DROP TABLE friendship');
    }
}
