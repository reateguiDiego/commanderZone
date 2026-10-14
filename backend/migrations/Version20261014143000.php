<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20261014143000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Maintain locale visibility and statistics more frequently for coverage reads.';
    }

    public function up(Schema $schema): void
    {
        // Table-local thresholds only. Do not run VACUUM during deployment.
        $this->addSql(<<<'SQL'
ALTER TABLE card_print_locale SET (
    autovacuum_vacuum_scale_factor = 0.01,
    autovacuum_vacuum_threshold = 500,
    autovacuum_analyze_scale_factor = 0.02,
    autovacuum_analyze_threshold = 500
)
SQL);
    }

    public function down(Schema $schema): void
    {
        // Restore inherited defaults, as used before this migration.
        $this->addSql(<<<'SQL'
ALTER TABLE card_print_locale RESET (
    autovacuum_vacuum_scale_factor,
    autovacuum_vacuum_threshold,
    autovacuum_analyze_scale_factor,
    autovacuum_analyze_threshold
)
SQL);
    }
}
