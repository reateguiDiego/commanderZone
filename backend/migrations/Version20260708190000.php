<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20260708190000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Track first authenticated user visit per day with privacy-preserving IP metadata.';
    }

    public function up(Schema $schema): void
    {
        $this->addSql('ALTER TABLE app_user ADD COLUMN IF NOT EXISTS last_seen_ip_hash VARCHAR(64) DEFAULT NULL');
        $this->addSql(
            <<<'SQL'
CREATE TABLE IF NOT EXISTS user_daily_visit (
    id VARCHAR(36) NOT NULL,
    user_id VARCHAR(36) NOT NULL,
    visit_date DATE NOT NULL,
    first_seen_at TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL,
    ip_hash VARCHAR(64) NOT NULL,
    ip_prefix VARCHAR(64) DEFAULT NULL,
    user_agent_hash VARCHAR(64) DEFAULT NULL,
    created_at TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL,
    PRIMARY KEY(id)
)
SQL,
        );
        $this->addSql('CREATE UNIQUE INDEX IF NOT EXISTS uniq_user_daily_visit_user_date ON user_daily_visit (user_id, visit_date)');
        $this->addSql('CREATE INDEX IF NOT EXISTS idx_user_daily_visit_date ON user_daily_visit (visit_date)');
        $this->addSql('CREATE INDEX IF NOT EXISTS idx_user_daily_visit_user_first_seen ON user_daily_visit (user_id, first_seen_at)');
        $this->addSql(
            <<<'SQL'
ALTER TABLE user_daily_visit
ADD CONSTRAINT FK_USER_DAILY_VISIT_USER
FOREIGN KEY (user_id) REFERENCES app_user (id) ON DELETE CASCADE NOT DEFERRABLE INITIALLY IMMEDIATE
SQL,
        );
        $this->addSql(
            <<<'SQL'
COMMENT ON TABLE user_daily_visit IS 'Daily authenticated visit metadata. IP hashes and prefixes are personal data and must be retained only as configured.'
SQL,
        );
    }

    public function down(Schema $schema): void
    {
        $this->addSql('DROP TABLE IF EXISTS user_daily_visit');
        $this->addSql('ALTER TABLE app_user DROP COLUMN IF EXISTS last_seen_ip_hash');
    }
}
