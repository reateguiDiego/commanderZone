<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20260425150000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Add Scryfall related card parts for derived deck tokens.';
    }

    public function up(Schema $schema): void
    {
        $this->addSql("ALTER TABLE card ADD all_parts JSON NOT NULL DEFAULT '[]'");
        $this->addSql('ALTER TABLE card ALTER all_parts DROP DEFAULT');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('ALTER TABLE card DROP all_parts');
    }
}
