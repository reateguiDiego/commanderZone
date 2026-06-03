<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20260602123000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Add persisted has_rulings metadata to card rows.';
    }

    public function up(Schema $schema): void
    {
        $this->addSql('ALTER TABLE card ADD COLUMN IF NOT EXISTS has_rulings BOOLEAN NOT NULL DEFAULT false');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('ALTER TABLE card DROP COLUMN IF EXISTS has_rulings');
    }
}
