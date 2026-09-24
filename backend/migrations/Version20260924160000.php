<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20260924160000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Resolve unaccent function and dictionary explicitly during restricted-search-path maintenance.';
    }

    public function up(Schema $schema): void
    {
        // Keep the existing function identity and normalization used by expression indexes.
        $this->addSql(<<<'SQL'
CREATE OR REPLACE FUNCTION public.immutable_unaccent(text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
    SELECT public.unaccent('public.unaccent'::pg_catalog.regdictionary, $1)
$$
SQL);
    }

    public function down(Schema $schema): void
    {
        $this->addSql(<<<'SQL'
CREATE OR REPLACE FUNCTION public.immutable_unaccent(text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
    SELECT unaccent('unaccent', $1)
$$
SQL);
    }
}
