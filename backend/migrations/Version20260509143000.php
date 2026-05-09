<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20260509143000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Add display name style preset to users';
    }

    public function up(Schema $schema): void
    {
        $this->addSql("ALTER TABLE app_user ADD display_name_style_preset VARCHAR(48) NOT NULL DEFAULT 'plain'");
    }

    public function down(Schema $schema): void
    {
        $this->addSql('ALTER TABLE app_user DROP display_name_style_preset');
    }
}
