<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20261014120000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Cover language name counts without reading full locale payloads.';
    }

    public function isTransactional(): bool
    {
        return false;
    }

    public function up(Schema $schema): void
    {
        // Include the input columns so PostgreSQL can satisfy expression reads
        // from the index as well. No catalog scan is added to the write trigger.
        $this->addSql(<<<'SQL'
CREATE INDEX CONCURRENTLY idx_card_print_locale_coverage
ON card_print_locale (lang, (COALESCE(NULLIF(BTRIM(printed_name), ''), BTRIM(name))))
INCLUDE (name, printed_name)
WHERE lang IS NOT NULL
SQL);
    }

    public function down(Schema $schema): void
    {
        $this->addSql('DROP INDEX CONCURRENTLY idx_card_print_locale_coverage');
    }
}
