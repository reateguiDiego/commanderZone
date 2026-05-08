<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20260508060000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Add starting life configuration to Commander rooms.';
    }

    public function up(Schema $schema): void
    {
        $this->addSql('ALTER TABLE room ADD COLUMN IF NOT EXISTS starting_life INT DEFAULT 40');
        $this->addSql('UPDATE room SET starting_life = 40 WHERE starting_life IS NULL');
        $this->addSql('UPDATE room SET starting_life = 1 WHERE starting_life < 1');
        $this->addSql('UPDATE room SET starting_life = 999 WHERE starting_life > 999');
        $this->addSql('ALTER TABLE room ALTER COLUMN starting_life SET NOT NULL');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('ALTER TABLE room DROP COLUMN IF EXISTS starting_life');
    }
}
