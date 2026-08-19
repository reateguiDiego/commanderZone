<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20260819093000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Add deterministic keyset index for paged chat history.';
    }

    public function up(Schema $schema): void
    {
        $this->addSql('DROP INDEX idx_game_chat_game_created_at');
        $this->addSql('CREATE INDEX idx_game_chat_game_created_at_message_id ON game_chat_message (game_id, created_at, message_id)');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('DROP INDEX idx_game_chat_game_created_at_message_id');
        $this->addSql('CREATE INDEX idx_game_chat_game_created_at ON game_chat_message (game_id, created_at)');
    }
}
