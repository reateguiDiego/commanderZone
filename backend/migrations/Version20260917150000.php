<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20260917150000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Store each user\'s default battlefield layout preference.';
    }

    public function up(Schema $schema): void
    {
        $this->addSql("ALTER TABLE app_user ADD COLUMN IF NOT EXISTS default_battlefield_layout VARCHAR(16) NOT NULL DEFAULT 'square'");
    }

    public function down(Schema $schema): void
    {
        $this->addSql('ALTER TABLE app_user DROP COLUMN IF EXISTS default_battlefield_layout');
    }
}
