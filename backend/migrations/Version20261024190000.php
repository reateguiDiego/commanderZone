<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20261024190000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Index folded rules text and faces for canonical and localized card searches.';
    }

    public function isTransactional(): bool
    {
        return false;
    }

    public function up(Schema $schema): void
    {
        foreach (['card', 'card_print_locale'] as $table) {
            $this->addSql(sprintf(
                "CREATE INDEX CONCURRENTLY idx_%s_rules_unaccent_trgm ON %s USING gin ((LOWER(immutable_unaccent(COALESCE(oracle_text, '') || ' ' || COALESCE(card_faces::text, '')))) gin_trgm_ops)",
                $table,
                $table,
            ));
        }
    }

    public function down(Schema $schema): void
    {
        foreach (['card', 'card_print_locale'] as $table) {
            $this->addSql(sprintf('DROP INDEX CONCURRENTLY idx_%s_rules_unaccent_trgm', $table));
        }
    }
}
