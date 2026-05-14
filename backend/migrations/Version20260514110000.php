<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20260514110000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Store printed card loyalty from local Scryfall catalog data.';
    }

    public function up(Schema $schema): void
    {
        $this->addSql('ALTER TABLE card ADD COLUMN IF NOT EXISTS loyalty VARCHAR(16) DEFAULT NULL');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('ALTER TABLE card DROP COLUMN IF EXISTS loyalty');
    }
}
