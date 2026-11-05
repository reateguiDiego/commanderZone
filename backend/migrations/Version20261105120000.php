<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20261105120000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Support ordered localized printing selection and covering locale metadata reads.';
    }

    public function isTransactional(): bool
    {
        return false;
    }

    public function up(Schema $schema): void
    {
        $this->addSql('CREATE INDEX CONCURRENTLY idx_card_print_localized_choice ON card_print (normalized_name, set_code, collector_number, scryfall_id)');
        $this->addSql('CREATE INDEX CONCURRENTLY idx_card_print_locale_choice ON card_print_locale (print_scryfall_id, lang) INCLUDE (image_status)');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('DROP INDEX CONCURRENTLY idx_card_print_locale_choice');
        $this->addSql('DROP INDEX CONCURRENTLY idx_card_print_localized_choice');
    }
}
