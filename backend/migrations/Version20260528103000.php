<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20260528103000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Add card localization lookup indexes for websocket runtime queries.';
    }

    public function up(Schema $schema): void
    {
        $this->addSql('CREATE INDEX IF NOT EXISTS idx_card_normalized_name_lang ON card (normalized_name, lang)');
        $this->addSql('CREATE INDEX IF NOT EXISTS idx_card_set_collector_lang ON card (set_code, collector_number, lang)');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('DROP INDEX IF EXISTS idx_card_set_collector_lang');
        $this->addSql('DROP INDEX IF EXISTS idx_card_normalized_name_lang');
    }
}

