<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20260929140000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Freeze historical display names on moderation reports.';
    }

    public function up(Schema $schema): void
    {
        $this->addSql('ALTER TABLE user_report ADD COLUMN reporter_display_name VARCHAR(120) DEFAULT NULL');
        $this->addSql('ALTER TABLE user_report ADD COLUMN reported_user_display_name VARCHAR(120) DEFAULT NULL');
        $this->addSql('ALTER TABLE user_report ADD COLUMN resolved_by_display_name VARCHAR(120) DEFAULT NULL');

        $this->addSql(<<<'SQL'
UPDATE user_report report
SET reporter_display_name = user_row.display_name
FROM app_user user_row
WHERE user_row.id = report.reporter_id
SQL);
        $this->addSql(<<<'SQL'
UPDATE user_report report
SET reported_user_display_name = user_row.display_name
FROM app_user user_row
WHERE user_row.id = report.reported_user_id
SQL);
        $this->addSql(<<<'SQL'
UPDATE user_report report
SET resolved_by_display_name = user_row.display_name
FROM app_user user_row
WHERE user_row.id = report.resolved_by_id
SQL);

        // Old reports may already have nulled user relations after account
        // deletion. Keep them reviewable without inventing a real identity.
        $this->addSql("UPDATE user_report SET reporter_display_name = 'Unknown reporter' WHERE reporter_display_name IS NULL");
        $this->addSql("UPDATE user_report SET reported_user_display_name = 'Unknown reported user' WHERE reported_user_display_name IS NULL");
        $this->addSql('ALTER TABLE user_report ALTER COLUMN reporter_display_name SET NOT NULL');
        $this->addSql('ALTER TABLE user_report ALTER COLUMN reported_user_display_name SET NOT NULL');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('ALTER TABLE user_report DROP COLUMN resolved_by_display_name');
        $this->addSql('ALTER TABLE user_report DROP COLUMN reported_user_display_name');
        $this->addSql('ALTER TABLE user_report DROP COLUMN reporter_display_name');
    }
}
