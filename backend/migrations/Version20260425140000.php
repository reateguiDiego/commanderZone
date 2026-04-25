<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20260425140000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Add card localization fields and print lookup index.';
    }

    public function up(Schema $schema): void
    {
        $this->addSql('ALTER TABLE card ADD lang VARCHAR(8) DEFAULT NULL');
        $this->addSql('ALTER TABLE card ADD printed_name VARCHAR(255) DEFAULT NULL');
        $this->addSql('ALTER TABLE card ADD flavor_name VARCHAR(255) DEFAULT NULL');
        $this->addSql('CREATE INDEX idx_card_print ON card (set_code, collector_number)');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('DROP INDEX idx_card_print');
        $this->addSql('ALTER TABLE card DROP lang');
        $this->addSql('ALTER TABLE card DROP printed_name');
        $this->addSql('ALTER TABLE card DROP flavor_name');
    }
}
