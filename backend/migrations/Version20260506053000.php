<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20260506053000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Store printed card power and toughness from local Scryfall catalog data.';
    }

    public function up(Schema $schema): void
    {
        $this->addSql('ALTER TABLE card ADD COLUMN IF NOT EXISTS power VARCHAR(16) DEFAULT NULL');
        $this->addSql('ALTER TABLE card ADD COLUMN IF NOT EXISTS toughness VARCHAR(16) DEFAULT NULL');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('ALTER TABLE card DROP COLUMN IF EXISTS toughness');
        $this->addSql('ALTER TABLE card DROP COLUMN IF EXISTS power');
    }
}
