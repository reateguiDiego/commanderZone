<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20260506120000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Store full Scryfall card faces for double-faced and modal double-faced cards.';
    }

    public function up(Schema $schema): void
    {
        $this->addSql("ALTER TABLE card ADD COLUMN IF NOT EXISTS card_faces JSON NOT NULL DEFAULT '[]'");
        $this->addSql('ALTER TABLE card ALTER card_faces DROP DEFAULT');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('ALTER TABLE card DROP COLUMN IF EXISTS card_faces');
    }
}
