<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20260907120000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Replace the unused mana stack preference with the combined chat and game log preference.';
    }

    public function up(Schema $schema): void
    {
        $this->addSql('ALTER TABLE app_user ADD COLUMN IF NOT EXISTS combine_chat_and_game_log BOOLEAN NOT NULL DEFAULT FALSE');
        $this->addSql('ALTER TABLE app_user DROP COLUMN IF EXISTS enable_stack_mana');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('ALTER TABLE app_user ADD COLUMN IF NOT EXISTS enable_stack_mana BOOLEAN NOT NULL DEFAULT FALSE');
        $this->addSql('ALTER TABLE app_user DROP COLUMN IF EXISTS combine_chat_and_game_log');
    }
}
