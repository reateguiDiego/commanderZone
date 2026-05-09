<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20260509150000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Add optional display name style text color';
    }

    public function up(Schema $schema): void
    {
        $this->addSql('ALTER TABLE app_user ADD display_name_style_text_color VARCHAR(7) DEFAULT NULL');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('ALTER TABLE app_user DROP display_name_style_text_color');
    }
}
