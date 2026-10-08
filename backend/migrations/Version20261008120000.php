<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20261008120000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Track locale catalog changes without scanning the catalog on language requests.';
    }

    public function up(Schema $schema): void
    {
        $this->addSql('CREATE TABLE card_locale_revision (id SMALLINT PRIMARY KEY CHECK (id = 1), revision BIGINT NOT NULL)');
        // A fresh seed prevents reuse of an old coverage cache key if this
        // migration is rolled back and applied again while app cache survives.
        $this->addSql('INSERT INTO card_locale_revision (id, revision) VALUES (1, FLOOR(EXTRACT(EPOCH FROM clock_timestamp()) * 1000000)::BIGINT)');
        $this->addSql(<<<'SQL'
CREATE FUNCTION bump_card_locale_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    UPDATE public.card_locale_revision SET revision = revision + 1 WHERE id = 1;
    RETURN NULL;
END;
$$
SQL);
        // Statement-level also covers bulk imports and TRUNCATE, and rolls back
        // with the catalog write. No changes to individual importers are needed.
        $this->addSql(<<<'SQL'
CREATE TRIGGER card_locale_revision_changed
AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON card_print_locale
FOR EACH STATEMENT EXECUTE FUNCTION bump_card_locale_revision()
SQL);
    }

    public function down(Schema $schema): void
    {
        $this->addSql('DROP TRIGGER card_locale_revision_changed ON card_print_locale');
        $this->addSql('DROP FUNCTION bump_card_locale_revision()');
        $this->addSql('DROP TABLE card_locale_revision');
    }
}
