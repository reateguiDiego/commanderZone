<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20260911130000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Cursor indexes for owned decks, with and without a folder filter.';
    }

    public function up(Schema $schema): void
    {
        $this->addSql('CREATE INDEX idx_deck_owner_folder_updated_id ON deck (owner_id, folder_id, updated_at, id)');
        $this->addSql('CREATE INDEX idx_deck_owner_updated_id ON deck (owner_id, updated_at, id)');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('DROP INDEX idx_deck_owner_folder_updated_id');
        $this->addSql('DROP INDEX idx_deck_owner_updated_id');
    }
}
