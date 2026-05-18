<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20260517113000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Store waiting-room turn-order roll history for tie breakers.';
    }

    public function up(Schema $schema): void
    {
        $this->addSql("ALTER TABLE room_player ADD COLUMN IF NOT EXISTS turn_rolls JSON NOT NULL DEFAULT '[]'");
        $this->addSql("UPDATE room_player SET turn_rolls = jsonb_build_array(turn_roll)::json WHERE turn_roll IS NOT NULL AND turn_rolls::jsonb = '[]'::jsonb");
        $this->addSql('ALTER TABLE room_player ALTER COLUMN turn_rolls DROP DEFAULT');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('ALTER TABLE room_player DROP COLUMN IF EXISTS turn_rolls');
    }
}
