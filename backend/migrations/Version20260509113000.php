<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20260509113000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Add custom initial avatar fields to app_user.';
    }

    public function up(Schema $schema): void
    {
        $this->addSql('ALTER TABLE app_user ADD avatar_initial_letter VARCHAR(2) DEFAULT NULL');
        $this->addSql('ALTER TABLE app_user ADD avatar_initial_background_color VARCHAR(7) DEFAULT NULL');
        $this->addSql('ALTER TABLE app_user ADD avatar_initial_text_color VARCHAR(7) DEFAULT NULL');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('ALTER TABLE app_user DROP avatar_initial_text_color');
        $this->addSql('ALTER TABLE app_user DROP avatar_initial_background_color');
        $this->addSql('ALTER TABLE app_user DROP avatar_initial_letter');
    }
}
