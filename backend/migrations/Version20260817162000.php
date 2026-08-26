<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20260817162000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Persist automatic commander damage life preference.';
    }

    public function up(Schema $schema): void
    {
        $this->addSql('ALTER TABLE app_user ADD COLUMN IF NOT EXISTS auto_apply_commander_damage_to_life BOOLEAN NOT NULL DEFAULT TRUE');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('ALTER TABLE app_user DROP COLUMN IF EXISTS auto_apply_commander_damage_to_life');
    }
}
