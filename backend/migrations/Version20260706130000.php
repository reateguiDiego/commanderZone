<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20260706130000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Create external functional card tags for deck analysis imports.';
    }

    public function up(Schema $schema): void
    {
        $this->addSql(
            <<<'SQL'
CREATE TABLE IF NOT EXISTS external_sync_run (
    id VARCHAR(36) NOT NULL,
    source TEXT NOT NULL,
    started_at TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL,
    finished_at TIMESTAMP(0) WITHOUT TIME ZONE DEFAULT NULL,
    status TEXT NOT NULL,
    items_seen INT NOT NULL DEFAULT 0,
    items_inserted INT NOT NULL DEFAULT 0,
    items_updated INT NOT NULL DEFAULT 0,
    items_failed INT NOT NULL DEFAULT 0,
    error_summary TEXT DEFAULT NULL,
    metadata JSON NOT NULL DEFAULT '{}',
    PRIMARY KEY (id)
)
SQL,
        );
        $this->addSql('CREATE INDEX IF NOT EXISTS idx_external_sync_run_source_started ON external_sync_run (source, started_at)');
        $this->addSql('CREATE INDEX IF NOT EXISTS idx_external_sync_run_status ON external_sync_run (status)');

        $this->addSql(
            <<<'SQL'
CREATE TABLE IF NOT EXISTS external_card_tag (
    id VARCHAR(36) NOT NULL,
    oracle_id VARCHAR(36) NOT NULL,
    source TEXT NOT NULL,
    tag_type TEXT NOT NULL,
    tag_slug TEXT NOT NULL,
    import_query TEXT NOT NULL,
    confidence NUMERIC(3,2) NOT NULL DEFAULT 1.0,
    active BOOLEAN NOT NULL DEFAULT true,
    imported_at TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL,
    PRIMARY KEY (id)
)
SQL,
        );
        $this->addSql('CREATE INDEX IF NOT EXISTS idx_external_card_tag_oracle_id ON external_card_tag (oracle_id)');
        $this->addSql('CREATE INDEX IF NOT EXISTS idx_external_card_tag_tag_slug ON external_card_tag (tag_slug)');
        $this->addSql('CREATE INDEX IF NOT EXISTS idx_external_card_tag_source_slug ON external_card_tag (source, tag_slug)');
        $this->addSql('CREATE UNIQUE INDEX IF NOT EXISTS uniq_external_card_tag_oracle_source_slug ON external_card_tag (oracle_id, source, tag_slug)');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('DROP TABLE IF EXISTS external_card_tag');
        $this->addSql('DROP TABLE IF EXISTS external_sync_run');
    }
}
