<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20260926120000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Remove the legacy persisted battlefield session layout preference.';
    }

    public function up(Schema $schema): void
    {
        $this->addSql('ALTER TABLE app_user DROP COLUMN IF EXISTS chosen_mode_view');
    }

    public function down(Schema $schema): void
    {
        $this->addSql("ALTER TABLE app_user ADD COLUMN IF NOT EXISTS chosen_mode_view VARCHAR(16) NOT NULL DEFAULT 'grid'");
    }
}
