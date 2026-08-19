<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20260819090000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Add deterministic keyset index for paged game log history.';
    }

    public function up(Schema $schema): void
    {
        $this->addSql('DROP INDEX idx_game_log_game_created_at');
        $this->addSql('CREATE INDEX idx_game_log_game_created_at_id ON game_log_entry (game_id, created_at, id)');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('DROP INDEX idx_game_log_game_created_at_id');
        $this->addSql('CREATE INDEX idx_game_log_game_created_at ON game_log_entry (game_id, created_at)');
    }
}
