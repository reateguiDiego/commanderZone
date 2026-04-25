<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20260425131000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Normalize deck folder index names.';
    }

    public function up(Schema $schema): void
    {
        $this->addSql('ALTER INDEX idx_deck_folder RENAME TO IDX_4FAC3637162CB942');
        $this->addSql('ALTER INDEX idx_deck_folder_owner RENAME TO IDX_DCD6ABDE7E3C61F9');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('ALTER INDEX IDX_4FAC3637162CB942 RENAME TO idx_deck_folder');
        $this->addSql('ALTER INDEX IDX_DCD6ABDE7E3C61F9 RENAME TO idx_deck_folder_owner');
    }
}
