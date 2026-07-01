<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20260701190000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Add user reports.';
    }

    public function up(Schema $schema): void
    {
        $this->addSql(
            <<<'SQL'
CREATE TABLE user_report (
    id VARCHAR(36) NOT NULL,
    reporter_id VARCHAR(36) NOT NULL,
    reported_user_id VARCHAR(36) NOT NULL,
    reason VARCHAR(255) NOT NULL,
    created_at TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL,
    PRIMARY KEY(id)
)
SQL,
        );
        $this->addSql('CREATE INDEX idx_user_report_created ON user_report (created_at)');
        $this->addSql('CREATE INDEX idx_user_report_reported_user ON user_report (reported_user_id)');
        $this->addSql('CREATE INDEX IDX_USER_REPORT_REPORTER ON user_report (reporter_id)');
        $this->addSql('ALTER TABLE user_report ADD CONSTRAINT FK_USER_REPORT_REPORTER FOREIGN KEY (reporter_id) REFERENCES app_user (id) ON DELETE CASCADE NOT DEFERRABLE INITIALLY IMMEDIATE');
        $this->addSql('ALTER TABLE user_report ADD CONSTRAINT FK_USER_REPORT_REPORTED_USER FOREIGN KEY (reported_user_id) REFERENCES app_user (id) ON DELETE CASCADE NOT DEFERRABLE INITIALLY IMMEDIATE');
        $this->addSql('ALTER TABLE user_report ADD CONSTRAINT chk_user_report_distinct_users CHECK (reporter_id <> reported_user_id)');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('DROP TABLE user_report');
    }
}
