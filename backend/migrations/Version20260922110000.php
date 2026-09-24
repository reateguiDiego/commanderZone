<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20260922110000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Reset existing user game preferences and default new users to Grid.';
    }

    public function up(Schema $schema): void
    {
        $this->addSql("ALTER TABLE app_user ALTER COLUMN default_battlefield_layout SET DEFAULT 'grid'");
        $this->addSql("ALTER TABLE app_user ALTER COLUMN chosen_mode_view SET DEFAULT 'grid'");
        $this->addSql(<<<'SQL'
UPDATE app_user
SET default_battlefield_layout = 'grid',
    chosen_mode_view = 'grid',
    show_card_alignment_helper = TRUE,
    show_mana_helper_on_startup = FALSE,
    enable_mana_row = TRUE,
    auto_apply_commander_damage_to_life = TRUE,
    game_animations = TRUE,
    chat_notification_sounds = TRUE,
    combine_chat_and_game_log = FALSE,
    updated_at = CURRENT_TIMESTAMP
WHERE default_battlefield_layout IS DISTINCT FROM 'grid'
   OR chosen_mode_view IS DISTINCT FROM 'grid'
   OR show_card_alignment_helper IS DISTINCT FROM TRUE
   OR show_mana_helper_on_startup IS DISTINCT FROM FALSE
   OR enable_mana_row IS DISTINCT FROM TRUE
   OR auto_apply_commander_damage_to_life IS DISTINCT FROM TRUE
   OR game_animations IS DISTINCT FROM TRUE
   OR chat_notification_sounds IS DISTINCT FROM TRUE
   OR combine_chat_and_game_log IS DISTINCT FROM FALSE
SQL);
    }

    public function down(Schema $schema): void
    {
        $this->throwIrreversibleMigrationException(
            'This migration overwrites each user\'s saved game preferences.',
        );
    }
}
