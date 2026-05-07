<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20260506220000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Store Scryfall card face metadata for double-faced card images.';
    }

    public function up(Schema $schema): void
    {
        $this->addSql("ALTER TABLE card ADD COLUMN IF NOT EXISTS card_faces JSON NOT NULL DEFAULT '[]'");
    }

    public function down(Schema $schema): void
    {
        $this->addSql('ALTER TABLE card DROP COLUMN IF EXISTS card_faces');
    }
}
