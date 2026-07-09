<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20260709100000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Add manual review marker to board wipe read profiles.';
    }

    public function up(Schema $schema): void
    {
        $this->addSql('ALTER TABLE card_board_wipe_profile ADD COLUMN IF NOT EXISTS needs_manual_review BOOLEAN NOT NULL DEFAULT false');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('ALTER TABLE card_board_wipe_profile DROP COLUMN IF EXISTS needs_manual_review');
    }
}
