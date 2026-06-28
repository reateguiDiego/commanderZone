<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20260623120500 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Persist user gameplay preferences.';
    }

    public function up(Schema $schema): void
    {
        $this->addSql('ALTER TABLE app_user ADD show_mana_helper_on_startup BOOLEAN DEFAULT false NOT NULL');
        $this->addSql('ALTER TABLE app_user ADD enable_mana_row BOOLEAN DEFAULT true NOT NULL');
        $this->addSql('ALTER TABLE app_user ADD enable_stack_mana BOOLEAN DEFAULT false NOT NULL');
        $this->addSql('ALTER TABLE app_user ADD game_animations BOOLEAN DEFAULT true NOT NULL');
        $this->addSql('ALTER TABLE app_user ADD chat_notification_sounds BOOLEAN DEFAULT true NOT NULL');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('ALTER TABLE app_user DROP show_mana_helper_on_startup');
        $this->addSql('ALTER TABLE app_user DROP enable_mana_row');
        $this->addSql('ALTER TABLE app_user DROP enable_stack_mana');
        $this->addSql('ALTER TABLE app_user DROP game_animations');
        $this->addSql('ALTER TABLE app_user DROP chat_notification_sounds');
    }
}
