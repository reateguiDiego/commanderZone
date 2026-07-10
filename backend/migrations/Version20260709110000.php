<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20260709110000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Add country metadata to authenticated daily user visits.';
    }

    public function up(Schema $schema): void
    {
        $this->addSql('ALTER TABLE app_user ADD COLUMN IF NOT EXISTS last_seen_country_code VARCHAR(2) DEFAULT NULL');
        $this->addSql('ALTER TABLE app_user ADD COLUMN IF NOT EXISTS last_seen_ip_hash VARCHAR(64) DEFAULT NULL');
        $this->addSql('ALTER TABLE user_daily_visit ADD COLUMN IF NOT EXISTS country_code VARCHAR(2) DEFAULT NULL');
        $this->addSql('ALTER TABLE user_daily_visit ADD COLUMN IF NOT EXISTS country_name VARCHAR(120) DEFAULT NULL');
        $this->addSql('ALTER TABLE user_daily_visit ADD COLUMN IF NOT EXISTS continent_code VARCHAR(8) DEFAULT NULL');
        $this->addSql('ALTER TABLE user_daily_visit ADD COLUMN IF NOT EXISTS geo_source VARCHAR(64) DEFAULT NULL');
        $this->addSql('ALTER TABLE user_daily_visit ALTER COLUMN ip_hash DROP NOT NULL');
        $this->addSql('CREATE INDEX IF NOT EXISTS idx_user_daily_visit_country_code ON user_daily_visit (country_code)');
        $this->addSql(
            <<<'SQL'
COMMENT ON TABLE user_daily_visit IS 'Daily authenticated visit metadata for contextual moderation. IP hashes, prefixes, and geolocation are personal or potentially personal data; do not expose publicly or use for automatic moderation decisions.'
SQL,
        );
    }

    public function down(Schema $schema): void
    {
        $this->addSql('DROP INDEX IF EXISTS idx_user_daily_visit_country_code');
        $this->addSql('ALTER TABLE user_daily_visit DROP COLUMN IF EXISTS geo_source');
        $this->addSql('ALTER TABLE user_daily_visit DROP COLUMN IF EXISTS continent_code');
        $this->addSql('ALTER TABLE user_daily_visit DROP COLUMN IF EXISTS country_name');
        $this->addSql('ALTER TABLE user_daily_visit DROP COLUMN IF EXISTS country_code');
        $this->addSql("UPDATE user_daily_visit SET ip_hash = repeat('0', 64) WHERE ip_hash IS NULL");
        $this->addSql('ALTER TABLE user_daily_visit ALTER COLUMN ip_hash SET NOT NULL');
        $this->addSql('ALTER TABLE app_user DROP COLUMN IF EXISTS last_seen_country_code');
    }
}
