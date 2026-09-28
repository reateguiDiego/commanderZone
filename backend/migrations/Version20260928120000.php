<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20260928120000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Create pre-aggregated Community lifetime leaderboard counters and their durable outbox.';
    }

    public function up(Schema $schema): void
    {
        // Previous prototype counters were populated with placeholder data.
        // Rankings must begin from real game starts only, so also replace any
        // manually-created pre-migration tables with the final schema.
        $this->addSql('DROP TABLE IF EXISTS community_statistics_outbox');
        $this->addSql('DROP TABLE IF EXISTS community_counter');
        $this->addSql(<<<'SQL'
CREATE TABLE community_counter (
    format VARCHAR(40) NOT NULL,
    metric VARCHAR(20) NOT NULL,
    period VARCHAR(20) NOT NULL,
    period_start DATE NOT NULL,
    subject_key VARCHAR(255) NOT NULL,
    usages BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (format, metric, period, period_start, subject_key),
    CONSTRAINT chk_community_counter_metric CHECK (metric IN ('card', 'commander', 'color', 'archetype')),
    CONSTRAINT chk_community_counter_period CHECK (period IN ('lifetime', 'month', 'year')),
    CONSTRAINT chk_community_counter_usages CHECK (usages >= 0)
)
SQL);
        $this->addSql('CREATE INDEX idx_community_counter_leaderboard ON community_counter (format, metric, period, period_start, usages DESC, subject_key ASC)');
        $this->addSql(<<<'SQL'
CREATE TABLE community_statistics_outbox (
    id BIGSERIAL PRIMARY KEY,
    payload_json JSONB NOT NULL,
    created_at TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
)
SQL);
    }

    public function down(Schema $schema): void
    {
        $this->addSql('DROP TABLE community_statistics_outbox');
        $this->addSql('DROP TABLE community_counter');
    }
}
