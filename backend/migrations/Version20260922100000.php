<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20260922100000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Store each user\'s last selected battlefield view.';
    }

    public function up(Schema $schema): void
    {
        $this->addSql('ALTER TABLE app_user ADD COLUMN IF NOT EXISTS chosen_mode_view VARCHAR(16)');
        $this->addSql('UPDATE app_user SET chosen_mode_view = default_battlefield_layout WHERE chosen_mode_view IS NULL');
        $this->addSql("ALTER TABLE app_user ALTER COLUMN chosen_mode_view SET DEFAULT 'square'");
        $this->addSql('ALTER TABLE app_user ALTER COLUMN chosen_mode_view SET NOT NULL');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('ALTER TABLE app_user DROP COLUMN IF EXISTS chosen_mode_view');
    }
}
