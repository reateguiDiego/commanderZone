<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20260509100000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Add profile avatar fields to app_user.';
    }

    public function up(Schema $schema): void
    {
        $this->addSql("ALTER TABLE app_user ADD avatar_type VARCHAR(16) DEFAULT 'initial' NOT NULL");
        $this->addSql('ALTER TABLE app_user ADD avatar_preset VARCHAR(160) DEFAULT NULL');
        $this->addSql('ALTER TABLE app_user ADD avatar_image_data TEXT DEFAULT NULL');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('ALTER TABLE app_user DROP avatar_image_data');
        $this->addSql('ALTER TABLE app_user DROP avatar_preset');
        $this->addSql('ALTER TABLE app_user DROP avatar_type');
    }
}
