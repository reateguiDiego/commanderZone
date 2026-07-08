<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20260706143000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Create configurable deck analysis rules.';
    }

    public function up(Schema $schema): void
    {
        $this->addSql(
            <<<'SQL'
CREATE TABLE IF NOT EXISTS analysis_rule (
    id VARCHAR(36) NOT NULL,
    format TEXT NOT NULL,
    archetype TEXT DEFAULT NULL,
    power_band TEXT DEFAULT NULL,
    metric TEXT NOT NULL,
    min_recommended NUMERIC DEFAULT NULL,
    max_recommended NUMERIC DEFAULT NULL,
    severity TEXT NOT NULL,
    message_key TEXT NOT NULL,
    active BOOLEAN NOT NULL DEFAULT true,
    updated_at TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL,
    PRIMARY KEY (id)
)
SQL,
        );

        $this->addSql('CREATE INDEX IF NOT EXISTS idx_analysis_rule_format ON analysis_rule (format)');
        $this->addSql('CREATE INDEX IF NOT EXISTS idx_analysis_rule_archetype ON analysis_rule (archetype)');
        $this->addSql('CREATE INDEX IF NOT EXISTS idx_analysis_rule_metric ON analysis_rule (metric)');
        $this->addSql('CREATE INDEX IF NOT EXISTS idx_analysis_rule_active ON analysis_rule (active)');
        $this->addSql("CREATE UNIQUE INDEX IF NOT EXISTS uniq_analysis_rule_identity ON analysis_rule (format, COALESCE(archetype, ''), COALESCE(power_band, ''), metric, message_key)");
    }

    public function down(Schema $schema): void
    {
        $this->addSql('DROP TABLE IF EXISTS analysis_rule');
    }
}
