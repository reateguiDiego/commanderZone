<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20260506110000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Add persisted room turn-order d20 rolls.';
    }

    public function up(Schema $schema): void
    {
        $this->addSql('ALTER TABLE room_player ADD COLUMN IF NOT EXISTS turn_roll INT DEFAULT NULL');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('ALTER TABLE room_player DROP COLUMN IF EXISTS turn_roll');
    }
}
